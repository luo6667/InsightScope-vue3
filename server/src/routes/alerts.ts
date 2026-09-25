/**
 * 📘 routes/alerts.ts —— 告警规则 CRUD + 告警记录 + 人工确认
 *
 * - /rules：负面率阈值 / 评论量 / 敏感关键词 三种规则的增删改查（zod 校验，keyword 规则必填关键词；
 *   评论量规则带 windowMin 时间窗口，语义是「最近 N 分钟新增条数 ≥ 阈值」）；
 * - /：告警记录列表（分页、可查未确认）；
 * - /:id/ack：人工“确认”告警（确认后前端不再高亮）。
 * 规则触发检测在 services/alertEngine.ts 的 checkAlerts 里（实时模拟 / 定时抓取入库 / AI 分析写回都会调用）。
 */
import { Router } from "express";
import { AlertModel, AlertRuleModel, DatasetModel } from "../models.js";
import { DEFAULT_VOLUME_WINDOW_MIN } from "../services/alertEngine.js";
import {
  validate,
  paramsOf,
  ValidatedRequest,
  idParamSchema,
  ruleListQuerySchema,
  alertListQuerySchema,
  createRuleBodySchema,
  updateRuleBodySchema,
} from "../validation.js";

const router = Router();

// 规则 CRUD
router.get("/rules", validate({ query: ruleListQuerySchema }), async (req, res) => {
  const q = (req as ValidatedRequest).validatedQuery ?? {};
  const filter = q.datasetId ? { datasetId: q.datasetId } : {};
  const rules = await AlertRuleModel.findAll({ where: filter });
  res.json({
    rules: rules.map((r) => ({
      id: r.id,
      datasetId: r.datasetId,
      type: r.type,
      threshold: r.threshold,
      keyword: r.keyword,
      windowMin: r.windowMin,
      enabled: r.enabled,
    })),
  });
});

router.post("/rules", validate({ body: createRuleBodySchema }), async (req, res) => {
  const { datasetId, type, threshold, keyword, windowMin, enabled } = req.body;
  // 数据集存在性校验：此前对任意 datasetId 都直接 201，会留下永不触发的「幽灵规则」
  const dataset = await DatasetModel.findByPk(datasetId, { attributes: ["id"] });
  if (!dataset) return res.status(404).json({ error: "数据集不存在" });
  const rule = await AlertRuleModel.create({
    datasetId,
    type,
    threshold,
    keyword: keyword ?? "",
    windowMin: windowMin ?? DEFAULT_VOLUME_WINDOW_MIN,
    enabled: enabled === undefined ? true : enabled,
  });
  res.status(201).json({ id: rule.id });
});

router.patch("/rules/:id", validate({ params: idParamSchema, body: updateRuleBodySchema }), async (req, res) => {
  const rule = await AlertRuleModel.findByPk(paramsOf(req, "id"));
  if (!rule) return res.status(404).json({ error: "规则不存在" });
  const { threshold, keyword, enabled, type, windowMin } = req.body;
  if (threshold !== undefined) rule.threshold = threshold;
  if (keyword !== undefined) rule.keyword = keyword;
  if (enabled !== undefined) rule.enabled = enabled;
  if (type !== undefined) rule.type = type;
  if (windowMin !== undefined) rule.windowMin = windowMin;
  await rule.save();
  res.json({ ok: true });
});

router.delete("/rules/:id", validate({ params: idParamSchema }), async (req, res) => {
  // 存在性校验：此前对不存在的 id 也返回 {"ok":true}，前端会以为删除成功
  const rule = await AlertRuleModel.findByPk(paramsOf(req, "id"), { attributes: ["id"] });
  if (!rule) return res.status(404).json({ error: "规则不存在" });
  await rule.destroy();
  res.json({ ok: true });
});

// 告警列表（分页）
router.get("/", validate({ query: alertListQuerySchema }), async (req, res) => {
  const q = (req as ValidatedRequest).validatedQuery ?? {};
  const filter = q.datasetId ? { datasetId: q.datasetId } : {};
  const limit = q.limit as number;
  const skip = q.skip as number;
  const alerts = await AlertModel.findAll({
    where: filter,
    order: [["triggeredAt", "DESC"]],
    offset: skip,
    limit,
  });
  res.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      datasetId: a.datasetId,
      type: a.type,
      severity: a.severity,
      message: a.message,
      value: a.value,
      triggeredAt: a.triggeredAt,
      acknowledged: a.acknowledged,
    })),
  });
});

// 确认告警
router.patch("/:id/ack", validate({ params: idParamSchema }), async (req, res) => {
  // 存在性校验：此前对不存在的告警也返回 {"ok":true}
  const alert = await AlertModel.findByPk(paramsOf(req, "id"), { attributes: ["id"] });
  if (!alert) return res.status(404).json({ error: "告警不存在" });
  await alert.update({ acknowledged: true });
  res.json({ ok: true });
});

export default router;
