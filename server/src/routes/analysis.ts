/**
 * 📘 routes/analysis.ts —— AI 批量分析（技术栈：axios 调 OpenAI 兼容接口 + 内存任务队列）
 *
 * 流程：
 * 1. 前端把 API key / baseUrl / model 随请求发来，key 只存内存 Map（jobConfigs），不落库；
 * 2. 创建 AnalysisJob 任务 → 后台循环：每批 8 条评论一次请求（BATCH=8 降请求数）
 *    → 解析 AI 返回的 JSON → 写回评论的 sentiment/topics/keywords；
 * 3. 并发限流、暂停/恢复/取消（pauseFlags / cancelFlags / runningJobs 内存标记）；
 * 4. 进度通过 socket 推 analysis:progress，前端用 useAnalysisJob 轮询任务状态。
 * baseUrl 同样做 SSRF 校验（只允许公网地址）。
 */
import { Router } from "express";
import axios from "axios";
import { Op } from "sequelize";
import { AnalysisJobModel, CommentModel, DatasetModel } from "../models.js";
import { io } from "../index.js";
import { HttpError } from "../utils/httpUtils.js";
import { assertPublicHttpUrl } from "../utils/urlSafety.js";
import { parseJsonArray } from "../utils/jsonUtils.js";
import { validate, paramsOf, datasetIdParamSchema, createAnalysisBodySchema } from "../validation.js";
import { checkAlerts } from "../services/alertEngine.js";
import type { Sentiment } from "../types.js";

const router = Router();

// 临时内存：jobId -> AI 配置（key 不落库，仅内存）
const jobConfigs = new Map<string, { apiKey: string; baseUrl: string; model: string; temperature: number }>();
const cancelFlags = new Set<string>();
const pauseFlags = new Set<string>();
const runningJobs = new Set<string>();

const BATCH = 8; // 批量：一次请求分析 8 条（请求数降为原来的 1/8）

const SYSTEM_PROMPT = `你是用户评论分析师。给定一个评论列表（每行编号），为每条评论输出分析结果，整体输出一个 JSON 数组：
[{"sentiment":"pos|neu|neg","sentimentScore":-1到1的小数,"topics":["1-2个主题词"],"keywords":["2-4个关键词"]},...]
硬性要求：
1. 数组顺序必须与评论列表顺序一致，数量相同
2. 只输出 JSON 数组，禁止 markdown 代码块、禁止解释文字
3. 主题如"性能/价格/客服/界面/闪退/耗电/物流/质量"等`;

/** 单条分析（批量失败时的兜底） */
async function analyzeOne(
  cfg: { apiKey: string; baseUrl: string; model: string; temperature: number },
  content: string
): Promise<{ sentiment: Sentiment; sentimentScore: number; topics: string[]; keywords: string[] }> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, "");
  const key = cfg.apiKey.trim().replace(/\s+/g, "");
  const res = await axios.post(
    `${base}/chat/completions`,
    {
      model: cfg.model.trim(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `评论列表：\n1. ${content.slice(0, 500)}` },
      ],
      temperature: cfg.temperature ?? 0.2,
      max_tokens: 300,
      stream: false,
    },
    { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 20000 }
  );
  const raw = res.data?.choices?.[0]?.message?.content ?? "";
  const arr = parseJsonArray(raw);
  const obj = arr?.[0];
  if (typeof obj !== "object" || obj === null) throw new Error("解析失败");
  return normalize(obj as Record<string, unknown>);
}

/** 批量分析：一次请求分析 items 全部（最多 BATCH 条），返回与 items 对齐的结果（失败项为 null） */
async function analyzeBatch(
  cfg: { apiKey: string; baseUrl: string; model: string; temperature: number },
  items: { content: string }[]
): Promise<(ReturnType<typeof normalize> | null)[] | null> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, "");
  const key = cfg.apiKey.trim().replace(/\s+/g, "");
  const listText = items.map((it, i) => `${i + 1}. ${it.content.slice(0, 200)}`).join("\n");
  const res = await axios.post(
    `${base}/chat/completions`,
    {
      model: cfg.model.trim(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `评论列表：\n${listText}` },
      ],
      temperature: cfg.temperature ?? 0.2,
      max_tokens: 1100,
      stream: false,
    },
    { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 30000 }
  );
  const raw = res.data?.choices?.[0]?.message?.content ?? "";
  const arr = parseJsonArray(raw);
  if (!arr || arr.length === 0) return null;
  return items.map((_, i) => {
    const obj = arr[i];
    if (!obj || typeof obj !== "object") return null;
    try {
      return normalize(obj as Record<string, unknown>);
    } catch {
      return null;
    }
  });
}

function normalize(obj: Record<string, unknown>) {
  const sentiment: Sentiment = ["pos", "neu", "neg"].includes(obj.sentiment as string)
    ? (obj.sentiment as Sentiment)
    : "neu";
  const score = typeof obj.sentimentScore === "number" && Number.isFinite(obj.sentimentScore)
    ? Math.max(-1, Math.min(1, obj.sentimentScore))
    : sentiment === "pos" ? 0.7 : sentiment === "neg" ? -0.7 : 0;
  const topics = Array.isArray(obj.topics)
    ? obj.topics.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 3).map((t) => t.trim())
    : [];
  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 5).map((t) => t.trim())
    : [];
  return { sentiment, sentimentScore: Math.round(score * 100) / 100, topics, keywords };
}

function emit(datasetId: string, event: string, payload: unknown) {
  io.to(`dataset:${datasetId}`).emit(event, payload);
}

async function writeResult(id: string, result: { sentiment: Sentiment; sentimentScore: number; topics: string[]; keywords: string[] }) {
  await CommentModel.update(
    {
      sentiment: result.sentiment,
      sentimentScore: result.sentimentScore,
      topics: result.topics,
      keywords: result.keywords,
      analyzed: true,
    },
    { where: { id } }
  );
}

async function runJob(jobId: string) {
  if (runningJobs.has(jobId)) return; // 已在运行，防重复启动
  runningJobs.add(jobId);
  try {
    const job = await AnalysisJobModel.findByPk(jobId);
    if (!job) return;
    const cfg = jobConfigs.get(jobId);
    if (!cfg) {
      // AI 配置在内存中丢失（如进程重启后 resume）：回滚为 paused，避免永久卡死 running
      await AnalysisJobModel.update({ status: "paused" }, { where: { id: jobId } }).catch(() => {});
      emit(String(job.datasetId), "analysis:error", {
        jobId,
        error: "AI 配置已丢失，请取消任务后重新发起分析",
      });
      return;
    }

    // 断点续跑：只处理未分析评论
    const ids = await CommentModel.findAll({
      where: { datasetId: job.datasetId, analyzed: false },
      attributes: ["id", "content"],
      raw: true,
    });
    job.total = ids.length + job.processed;
    job.status = "running";
    await job.save();

    let processed = job.processed;
    let failed = job.failed;
    const concurrency = Math.max(1, Math.min(8, job.concurrency || 6));
    let cursor = 0;

    const worker = async () => {
      while (cursor < ids.length) {
        if (cancelFlags.has(jobId)) return;
        if (pauseFlags.has(jobId)) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        const batch = ids.slice(cursor, cursor + BATCH);
        cursor += batch.length;

        // 批量分析（一次请求多条，大幅减少请求数）
        let pending = [...batch];
        if (batch.length > 1) {
          try {
            const results = await analyzeBatch(cfg, batch);
            if (results) {
              const rest: typeof batch = [];
              for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (cancelFlags.has(jobId)) return; // 已取消/重置，丢弃本批结果
                if (r) {
                  void writeResult(batch[i].id, r).catch((e) => {
                    console.error("[analysis] writeResult failed", e instanceof Error ? e.message : e);
                  });
                  processed++;
                } else {
                  rest.push(batch[i]);
                }
              }
              pending = rest;
            }
          } catch {
            /* 批量失败，全部走单条兜底 */
          }
        }

        // 单条兜底（批量失败/解析失败的条目）：只试一次，失败即计入 failed，避免长时间卡顿
        for (const item of pending) {
          if (cancelFlags.has(jobId)) return;
          if (pauseFlags.has(jobId)) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          try {
            const result = await analyzeOne(cfg, item.content);
            await writeResult(item.id, result);
            processed++;
          } catch {
            failed++;
          }
        }

        // 每批完成即保存并推送进度（细粒度，前端进度条实时动，不会"看起来卡住"）
        job.processed = processed;
        job.failed = failed;
        await AnalysisJobModel.update({ processed, failed }, { where: { id: jobId } });
        emit(String(job.datasetId), "analysis:progress", {
          jobId,
          status: "running",
          processed,
          total: job.total,
          failed,
        });
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));

    const finalStatus = cancelFlags.has(jobId) ? "failed" : "done";
    await AnalysisJobModel.update({ status: finalStatus, processed, failed }, { where: { id: jobId } });
    emit(String(job.datasetId), "analysis:progress", {
      jobId,
      status: finalStatus,
      processed,
      total: job.total,
      failed,
    });
    // 分析写回后重新评估告警规则：此前只有「实时监控」播放时才检测规则，
    // 真实数据（AI 分析完）永远不会触发告警
    if (finalStatus === "done") {
      await checkAlerts(String(job.datasetId)).catch((e) =>
        console.error("[analysis] checkAlerts failed", jobId, e instanceof Error ? e.message : e)
      );
    }
  } catch (e) {
    // 兜底：任务异常不崩进程，置失败
    console.error("[analysis] job crashed", jobId, e instanceof Error ? e.message : e);
    await AnalysisJobModel.update({ status: "failed" }, { where: { id: jobId } }).catch(() => {});
  } finally {
    cancelFlags.delete(jobId);
    pauseFlags.delete(jobId);
    jobConfigs.delete(jobId);
    runningJobs.delete(jobId);
  }
}

// 创建/复用分析任务：POST /:datasetId/analysis
router.post(
  "/:datasetId/analysis",
  validate({ params: datasetIdParamSchema, body: createAnalysisBodySchema }),
  async (req, res) => {
    const { apiKey, baseUrl, model, temperature, concurrency } = req.body;
    // SSRF 防护：baseUrl 必须是公网 http/https，不允许内网地址
    const safeBase = assertPublicHttpUrl(baseUrl, "baseUrl");
    const datasetId = paramsOf(req, "datasetId");
    // 数据集存在性校验：此前对不存在的 id 也返回 201，会创建出永远跑不完的「幽灵分析任务」
    const dataset = await DatasetModel.findByPk(datasetId, { attributes: ["id"] });
    if (!dataset) return res.status(404).json({ error: "数据集不存在" });
    const existing = await AnalysisJobModel.findOne({
      where: { datasetId, status: { [Op.in]: ["pending", "running"] } },
    });
    if (existing) return res.json({ job: existing });

    const job = await AnalysisJobModel.create({
      datasetId,
      status: "pending",
      concurrency,
    });
    jobConfigs.set(job.id, {
      apiKey,
      baseUrl: safeBase,
      model,
      temperature,
    });
    void runJob(job.id).catch((e) => {
      console.error("[analysis] runJob crashed", e instanceof Error ? e.message : e);
    });
    res.status(201).json({ job });
  }
);

// 最新任务状态：GET /:datasetId/analysis
router.get("/:datasetId/analysis", validate({ params: datasetIdParamSchema }), async (req, res) => {
  const job = await AnalysisJobModel.findOne({
    where: { datasetId: paramsOf(req, "datasetId") },
    order: [["createdAt", "DESC"]],
  });
  res.json({ job: job ?? null });
});

// 暂停：worker 检测到 flag 后停止处理（单例运行，不重复启动）
router.post("/:datasetId/analysis/pause", validate({ params: datasetIdParamSchema }), async (req, res) => {
  const job = await AnalysisJobModel.findOne({ where: { datasetId: paramsOf(req, "datasetId"), status: "running" } });
  if (!job) return res.status(404).json({ error: "没有运行中的任务" });
  pauseFlags.add(String(job.id));
  job.status = "paused";
  await job.save();
  res.json({ ok: true });
});

// 恢复：清 flag 让现有 worker 继续；若 worker 已退出（异常）则重启
router.post("/:datasetId/analysis/resume", validate({ params: datasetIdParamSchema }), async (req, res) => {
  const job = await AnalysisJobModel.findOne({ where: { datasetId: paramsOf(req, "datasetId"), status: "paused" } });
  if (!job) return res.status(404).json({ error: "没有暂停的任务" });
  pauseFlags.delete(String(job.id));
  job.status = "running";
  await job.save();
  if (!runningJobs.has(String(job.id))) {
    void runJob(String(job.id));
  }
  res.json({ ok: true });
});

// 取消
router.post("/:datasetId/analysis/cancel", validate({ params: datasetIdParamSchema }), async (req, res) => {
  const job = await AnalysisJobModel.findOne({
    where: { datasetId: paramsOf(req, "datasetId"), status: { [Op.in]: ["running", "paused"] } },
  });
  if (!job) return res.status(404).json({ error: "没有运行中的任务" });
  cancelFlags.add(String(job.id));
  pauseFlags.delete(String(job.id));
  job.status = "failed";
  await job.save();
  res.json({ ok: true });
});

// 一键清空分析结果：停止任务 + 删除任务记录 + 评论重置为未分析（可重新分析）
router.post("/:datasetId/analysis/reset", validate({ params: datasetIdParamSchema }), async (req, res) => {
  const jobs = await AnalysisJobModel.findAll({
    where: { datasetId: paramsOf(req, "datasetId"), status: { [Op.in]: ["pending", "running", "paused"] } },
  });
  for (const j of jobs) {
    cancelFlags.add(String(j.id));
    pauseFlags.delete(String(j.id));
  }
  await AnalysisJobModel.destroy({ where: { datasetId: paramsOf(req, "datasetId") } });
  const [affected] = await CommentModel.update(
    { analyzed: false, sentiment: "neu", sentimentScore: 0, topics: [], keywords: [] },
    { where: { datasetId: paramsOf(req, "datasetId") } }
  );
  emit(paramsOf(req, "datasetId"), "analysis:reset", { count: affected });
  res.json({ ok: true, reset: affected });
});

/** 删除数据集时调用：取消该数据集下所有分析任务（防止旧 worker 继续写已删除数据） */
export async function cancelJobsForDataset(datasetId: string) {
  const jobs = await AnalysisJobModel.findAll({
    where: { datasetId, status: { [Op.in]: ["pending", "running", "paused"] } },
  });
  for (const j of jobs) {
    cancelFlags.add(String(j.id));
    pauseFlags.delete(String(j.id));
  }
}

export default router;
