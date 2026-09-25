/**
 * 📘 routes/feeds.ts —— 定时抓取（feedUrl → 拉取评论入库） + 内置演示数据源
 *
 * 核心 doFetchFeed()：
 * 1. 取数据集的 feedUrl：绝对 URL 走 SSRF 校验（可放行私网，见 config.ALLOW_PRIVATE_FEED_URL）；
 * 2. fetch 数据源（15s 超时）→ 解析 JSON 数组或 { comments: [] }；
 * 3. 逐条去重（commentUtils.buildDedupFilter：评论显式携带的字段全部重合才算重复）
 *    → normalizeComment 规范化 → 入库 → socket 推 comment:stream；
 * 4. 记录 feedLastCount / feedLastError 供前端展示。
 * 定时循环：startFeed() 由「启动」按钮触发；server 启动时 resumeFeeds() 会把 DB 里
 * feedRunning=true 的任务重新挂上（否则进程重启后内存定时器丢失，卡片一直显示「运行中」却永不再抓取）。
 */
import { Router } from "express";
import { ALLOW_PRIVATE_FEED_URL, FEED_MAX_ITEMS } from "../config.js";
import { CommentModel, DatasetModel } from "../models.js";
import { io } from "../index.js";
import { checkAlerts } from "../services/alertEngine.js";
import { normalizeComment, buildDedupFilter } from "../utils/commentUtils.js";
import { feedSourceLabel } from "../utils/sourceLabel.js";
import { assertPublicHttpUrl } from "../utils/urlSafety.js";
import { validate, paramsOf, datasetIdParamSchema } from "../validation.js";

const router = Router();

// 定时器注册表：datasetId -> { timer, running }
const feedTimers = new Map<string, { timer: ReturnType<typeof setInterval> | null }>();
// 抓取锁：同一数据集同时只允许一个抓取在跑，避免并发竞态导致去重失效
const feedLocks = new Set<string>();

function emit(datasetId: string, event: string, payload: unknown) {
  io.to(`dataset:${datasetId}`).emit(event, payload);
}

/**
 * 抓取一次数据源（带锁，防并发）。
 * skipped=true 表示该数据集已有抓取在跑、本次直接跳过（此时 count 恒为 0），
 * 便于调用方区分「没抢到锁」与「真的抓到 0 条新数据」。
 */
export type FeedFetchResult = { count: number; skipped: boolean };

async function fetchFeed(datasetId: string): Promise<FeedFetchResult> {
  if (feedLocks.has(datasetId)) return { count: 0, skipped: true };
  feedLocks.add(datasetId);
  try {
    return { count: await doFetchFeed(datasetId), skipped: false };
  } finally {
    feedLocks.delete(datasetId);
  }
}

async function doFetchFeed(datasetId: string): Promise<number> {
  const ds = await DatasetModel.findByPk(datasetId);
  if (!ds || !ds.feedUrl) return 0;

  try {
    // SSRF 防护：feedUrl 必须是 http/https 绝对地址；默认放行私网（ALLOW_PRIVATE_FEED_URL=0 恢复严格校验）
    const url = assertPublicHttpUrl(ds.feedUrl.trim(), "feedUrl", {
      allowPrivate: ALLOW_PRIVATE_FEED_URL,
    });
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`数据源返回 ${res.status}`);
    const text = await res.text();
    let arr: unknown[] = [];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) arr = parsed;
      else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { comments?: unknown[] }).comments)) {
        arr = (parsed as { comments: unknown[] }).comments;
      } else {
        throw new Error("数据格式不是数组");
      }
    } catch {
      throw new Error("数据源不是合法 JSON 数组（或 { comments: [...] }）");
    }

    // 去重规则（全项目统一）：评论显式携带的全部字段重合才算重复（见 commentUtils.buildDedupFilter）
    const now = Date.now();
    // 来源名：数据源条目自带的 platform/source/channel 优先（normalizeComment 里处理），
    // 否则退化为 feedUrl 的 host；否则整批评论来源都会是数据集兜底值「数据源」
    const sourceLabel = feedSourceLabel(ds.platform, ds.feedUrl);
    let inserted = 0;
    // 单次抓取上限：此前硬编码 slice(0, 200)，返回 500 条的数据源会被静默截断成 200 条
    const items = arr.slice(0, FEED_MAX_ITEMS);
    if (arr.length > items.length) {
      console.warn(
        `[feeds] 数据集 ${datasetId} 数据源返回 ${arr.length} 条，本次只抓前 ${items.length} 条（FEED_MAX_ITEMS=${FEED_MAX_ITEMS}）`
      );
    }
    for (const item of items) {
      // 防御：数据源可能混入 null / 标量元素,跳过而非报错
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const dup = await CommentModel.findOne({
        where: { datasetId, ...buildDedupFilter(raw) },
        attributes: ["id"],
      });
      if (dup) continue;
      const doc = normalizeComment(raw, { platform: sourceLabel, now, index: inserted });
      const comment = await CommentModel.create({ datasetId, ...doc });
      inserted++;
      emit(datasetId, "comment:stream", {
        id: String(comment.id),
        content: comment.content,
        author: comment.author,
        platform: comment.platform,
        timestamp: comment.timestamp,
        sentiment: comment.sentiment,
        sentimentScore: comment.sentimentScore,
        topics: comment.topics,
      });
    }

    await DatasetModel.update(
      { feedLastAt: new Date(), feedLastCount: inserted, feedLastError: "" },
      { where: { id: datasetId } }
    );
    emit(datasetId, "feed:status", { running: true, lastAt: new Date(), count: inserted });
    // 真实抓取入库的数据同样要评估告警规则（此前只有实时模拟器会评估 → feed 数据永远不告警）
    if (inserted > 0) {
      await checkAlerts(datasetId).catch((e) => {
        console.error("[feeds] checkAlerts failed", e instanceof Error ? e.message : e);
      });
    }
    return inserted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await DatasetModel.update({ feedLastError: msg }, { where: { id: datasetId } }).catch(() => {});
    throw new Error(msg);
  }
}

/** 启动定时抓取（先抓一次，再按间隔循环） */
export async function startFeed(datasetId: string) {
  stopFeed(datasetId);
  const ds = await DatasetModel.findByPk(datasetId);
  if (!ds || !ds.feedUrl) return;
  const intervalMs = Math.min(1440, Math.max(1, ds.feedIntervalMin || 5)) * 60 * 1000; // 防御旧数据超限导致 setInterval 溢出
  await DatasetModel.update({ feedRunning: true }, { where: { id: datasetId } });
  emit(String(datasetId), "feed:status", { running: true });
  const run = async () => {
    try {
      await fetchFeed(datasetId);
    } catch (e) {
      emit(String(datasetId), "feed:error", { message: e instanceof Error ? e.message : String(e) });
    }
  };
  void run(); // 立即抓一次
  const timer = setInterval(() => void run(), intervalMs);
  feedTimers.set(datasetId, { timer });
}

export function stopFeed(datasetId: string) {
  const reg = feedTimers.get(datasetId);
  if (reg?.timer) clearInterval(reg.timer);
  feedTimers.delete(datasetId);
  void DatasetModel.update({ feedRunning: false }, { where: { id: datasetId } }).catch(() => {});
}

/**
 * 服务启动时恢复定时抓取任务。
 *
 * 定时器只存在于内存里，进程重启后 DB 的 feedRunning 仍是 true → 前端卡片显示「运行中」、
 * 但永远不会再抓取（实测中数据集就停在这个状态）。修复：启动时把所有 feedRunning=true 的
 * 数据集重新挂上定时器。
 * 放在 httpServer.listen 回调里调用：确保端口已就绪、DB 初始化已完成后再发起抓取。
 */
export async function resumeFeeds(): Promise<void> {
  const running = await DatasetModel.findAll({
    where: { feedRunning: true },
    attributes: ["id", "feedUrl"],
  });
  for (const ds of running) {
    const id = String(ds.id);
    if (!ds.feedUrl) {
      // 没有数据源 URL 的任务无法抓取，纠正 DB 状态让前端别再显示「运行中」
      await DatasetModel.update({ feedRunning: false }, { where: { id } }).catch(() => {});
      continue;
    }
    try {
      await startFeed(id);
      console.log(`[feeds] 已恢复数据集 ${id} 的定时抓取`);
    } catch (e) {
      console.error(`[feeds] 恢复数据集 ${id} 的定时抓取失败`, e instanceof Error ? e.message : e);
    }
  }
}

// 创建 feed 数据集：POST /api/datasets 已支持（feedUrl + feedIntervalMin）由 datasets 路由处理；
// 这里提供启动/停止/状态

// 启动：POST /:id/feed/start
router.post("/:datasetId/feed/start", validate({ params: datasetIdParamSchema }), async (req, res) => {
  const ds = await DatasetModel.findByPk(paramsOf(req, "datasetId"));
  if (!ds) return res.status(404).json({ error: "数据集不存在" });
  if (!ds.feedUrl) return res.status(400).json({ error: "该数据集未配置数据源 URL" });
  await startFeed(ds.id);
  res.json({ ok: true });
});

// 停止：POST /:id/feed/stop
router.post("/:datasetId/feed/stop", validate({ params: datasetIdParamSchema }), (req, res) => {
  stopFeed(paramsOf(req, "datasetId"));
  res.json({ ok: true });
});

// 立即抓取一次：POST /:id/feed/pull
router.post("/:datasetId/feed/pull", validate({ params: datasetIdParamSchema }), async (req, res) => {
  const { count, skipped } = await fetchFeed(paramsOf(req, "datasetId"));
  res.json({ ok: true, count, skipped });
});

export default router;
