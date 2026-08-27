/**
 * 📘 routes/feeds.ts —— 定时抓取（feedUrl → 拉取评论入库） + 内置演示数据源
 *
 * 核心 doFetchFeed()：
 * 1. 取数据集的 feedUrl：绝对 URL 走 SSRF 校验（可放行私网，见 config.ALLOW_PRIVATE_FEED_URL）；
 * 2. fetch 数据源（15s 超时）→ 解析 JSON 数组或 { comments: [] }；
 * 3. 逐条去重（commentUtils.buildDedupFilter：评论显式携带的字段全部重合才算重复）
 *    → normalizeComment 规范化 → 入库 → socket 推 comment:stream；
 * 4. 记录 feedLastCount / feedLastError 供前端展示。
 * 手动启动模式：startFeed() 由「启动」按钮触发并定时循环；server 重启不自动恢复。
 * 文件底部还内置了 /api/demo/feed 演示数据源（14 条固定评论池，字段稳定可去重）。
 */
import { Router, type RequestHandler } from "express";
import { ALLOW_PRIVATE_FEED_URL } from "../config.js";
import { CommentModel, DatasetModel } from "../models.js";
import { io } from "../index.js";
import { normalizeComment, buildDedupFilter } from "../utils/commentUtils.js";
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

/** 抓取一次数据源（带锁，防并发） */
async function fetchFeed(datasetId: string): Promise<number> {
  if (feedLocks.has(datasetId)) return 0;
  feedLocks.add(datasetId);
  try {
    return await doFetchFeed(datasetId);
  } finally {
    feedLocks.delete(datasetId);
  }
}

async function doFetchFeed(datasetId: string): Promise<number> {
  const ds = await DatasetModel.findByPk(datasetId);
  if (!ds || !ds.feedUrl) return 0;

  // 兼容相对路径（如 /api/demo/feed）：补全为后端自身地址
  const raw = ds.feedUrl.trim();
  let url: string;
  if (raw.startsWith("/")) {
    url = `http://127.0.0.1:${Number(process.env.PORT ?? 5176)}${raw}`;
  } else {
    // SSRF 防护：绝对 URL 默认必须为公网地址;ALLOW_PRIVATE_FEED_URL=1 时允许抓取本地/内网评论服务
    url = assertPublicHttpUrl(raw, "feedUrl", { allowPrivate: ALLOW_PRIVATE_FEED_URL });
  }

  try {
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
    let inserted = 0;
    for (const item of arr.slice(0, 200)) {
      // 防御：数据源可能混入 null / 标量元素,跳过而非报错
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const dup = await CommentModel.findOne({
        where: { datasetId, ...buildDedupFilter(raw) },
        attributes: ["id"],
      });
      if (dup) continue;
      const doc = normalizeComment(raw, { platform: ds.platform || "数据源", now, index: inserted });
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
  const count = await fetchFeed(paramsOf(req, "datasetId"));
  res.json({ ok: true, count });
});

// 本地演示数据源：GET /api/demo/feed（每次随机返回池中若干条,字段稳定——内容/作者/情感绑定、
// 不带动态时间戳,因此定时抓取可按「显式字段全部重合」规则去重,不会无限增长）
const DEMO_POOL: { content: string; author: string; sentiment: "pos" | "neu" | "neg" }[] = [
  { content: "新版本用起来很顺手，给个好评", author: "青柠", sentiment: "pos" },
  { content: "客服响应很及时，问题马上解决了", author: "小鹿", sentiment: "pos" },
  { content: "功能越来越完善，推荐", author: "Nova", sentiment: "pos" },
  { content: "物流很快，第二天就到了", author: "老白", sentiment: "pos" },
  { content: "质量超出预期，会回购", author: "阿茶", sentiment: "pos" },
  { content: "一般般吧，没什么特别的", author: "格子衫", sentiment: "neu" },
  { content: "观望中，等后续版本看看", author: "青柠", sentiment: "neu" },
  { content: "中规中矩，能用", author: "小鹿", sentiment: "neu" },
  { content: "包装有点简陋，其他还好", author: "Nova", sentiment: "neu" },
  { content: "等待时间太久了，体验很差", author: "老白", sentiment: "neg" },
  { content: "质量有问题，联系客服半天没人理", author: "阿茶", sentiment: "neg" },
  { content: "更新后反而卡顿了，后悔升级", author: "格子衫", sentiment: "neg" },
  { content: "货不对板，和描述不符", author: "青柠", sentiment: "neg" },
  { content: "售后流程太繁琐，浪费时间", author: "小鹿", sentiment: "neg" },
];
// 挂载到 /api 下（index.ts 注册）
export const demoFeedHandler: RequestHandler = (_req, res) => {
  // 每次随机返回 3~5 条；字段固定(content/author/platform/sentiment,无 timestamp)→ 已入库的会被去重跳过
  const n = 3 + Math.floor(Math.random() * 3);
  const comments = Array.from({ length: n }, () => {
    const item = DEMO_POOL[Math.floor(Math.random() * DEMO_POOL.length)];
    return {
      content: item.content,
      author: item.author,
      platform: "演示数据源",
      sentiment: item.sentiment,
    };
  });
  res.json({ comments });
};

export default router;
