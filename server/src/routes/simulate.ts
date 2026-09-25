/**
 * 📘 routes/simulate.ts —— 实时模拟器（把已有评论按时间轴重放，制造“活”数据）
 *
 * 原理：tick() 循环——按 timestamp 升序一条条把评论通过 socket 的 comment:stream
 * 事件推给前端，推送间隔 = max(30, 1000/speed)ms（speed 1~20，20 倍速约 20 条/秒）。
 * 每条流入后调用共用告警引擎 services/alertEngine.ts 的 checkAlerts()：负面率 Z-score 异常 +
 * 规则阈值 + 敏感关键词/评论量 → 生成告警（带 60s 冷却）并推 alert:new。
 * 定时抓取入库（routes/feeds.ts）与 AI 分析写回（routes/analysis.ts）也调用同一个引擎。
 * 关键点：内存 Map sims 记录每个数据集的播放进度；stop/restart 时用对象引用
 * 比对丢弃旧链路，防止并发竞态（旧 tick 不再继续）。
 */
import { Router } from "express";
import { CommentModel } from "../models.js";
import { io } from "../index.js";
import { checkAlerts } from "../services/alertEngine.js";
import { validate, paramsOf, datasetIdParamSchema, speedBodySchema } from "../validation.js";

const router = Router();

// 模拟器状态：dataset -> { timer, index, speed }
const sims = new Map<string, { timer: ReturnType<typeof setTimeout> | null; index: number; speed: number }>();

function emit(datasetId: string, event: string, payload: unknown) {
  io.to(`dataset:${datasetId}`).emit(event, payload);
}

async function tick(datasetId: string) {
  const sim = sims.get(datasetId);
  if (!sim) return;
  const total = await CommentModel.count({ where: { datasetId } });
  if (sims.get(datasetId) !== sim) return; // 期间被 stop/restart，丢弃旧链
  if (sim.index >= total) {
    stopSim(datasetId);
    return;
  }
  const comment = await CommentModel.findOne({
    where: { datasetId },
    order: [["timestamp", "ASC"]],
    offset: sim.index,
  });
  if (sims.get(datasetId) !== sim) return;
  if (!comment) {
    stopSim(datasetId);
    return;
  }
  sim.index++;
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
  await checkAlerts(datasetId, comment.timestamp).catch((e) => {
    console.error("[simulate] checkAlerts failed", e instanceof Error ? e.message : e);
  });
  if (sims.get(datasetId) !== sim) return; // 竞态关键：checkAlerts 期间被 restart，旧链丢弃
  // 延迟下限 30ms：speed 20 → 50ms/条 ≈ 20 条/秒
  sim.timer = setTimeout(
    () =>
      void tick(datasetId).catch((e) => {
        console.error("[simulate] tick failed", e instanceof Error ? e.message : e);
      }),
    Math.max(30, Math.round(1000 / sim.speed))
  );
}

export function stopSim(datasetId: string) {
  const sim = sims.get(datasetId);
  if (sim?.timer) clearTimeout(sim.timer);
  sims.delete(datasetId);
  emit(datasetId, "sim:status", { running: false });
}

// 开始模拟：POST /:datasetId/simulate/start { speed }
router.post(
  "/:datasetId/simulate/start",
  validate({ params: datasetIdParamSchema, body: speedBodySchema }),
  async (req, res) => {
    const datasetId = paramsOf(req, "datasetId");
    const speed = req.body.speed; // schema 已 clamp 1-20，默认 5
    const count = await CommentModel.count({ where: { datasetId } });
    if (!count) return res.status(400).json({ error: "数据集没有评论" });
    stopSim(datasetId);
    sims.set(datasetId, { timer: null, index: 0, speed });
    emit(datasetId, "sim:status", { running: true, speed, total: count });
    void tick(datasetId).catch((e) => {
      console.error("[simulate] start tick failed", e instanceof Error ? e.message : e);
    });
    res.json({ ok: true, total: count, speed });
  }
);

// 停止模拟：POST /:datasetId/simulate/stop
router.post("/:datasetId/simulate/stop", validate({ params: datasetIdParamSchema }), (req, res) => {
  stopSim(paramsOf(req, "datasetId"));
  res.json({ ok: true });
});

// 播放中调整倍速：POST /:datasetId/simulate/speed { speed }
router.post(
  "/:datasetId/simulate/speed",
  validate({ params: datasetIdParamSchema, body: speedBodySchema }),
  (req, res) => {
    const sim = sims.get(paramsOf(req, "datasetId"));
    if (!sim) return res.status(404).json({ error: "模拟未在运行" });
    sim.speed = req.body.speed;
    res.json({ ok: true, speed: sim.speed });
  }
);

export default router;
