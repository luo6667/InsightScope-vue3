import { Router } from "express";
import { AlertModel, AlertRuleModel } from "../models.js";
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
  res.json({ rules: rules.map((r) => ({ id: r.id, datasetId: r.datasetId, type: r.type, threshold: r.threshold, keyword: r.keyword, enabled: r.enabled })) });
});

router.post("/rules", validate({ body: createRuleBodySchema }), async (req, res) => {
  const { datasetId, type, threshold, keyword, enabled } = req.body;
  const rule = await AlertRuleModel.create({
    datasetId,
    type,
    threshold,
    keyword: keyword ?? "",
    enabled: enabled === undefined ? true : enabled,
  });
  res.status(201).json({ id: rule.id });
});

router.patch("/rules/:id", validate({ params: idParamSchema, body: updateRuleBodySchema }), async (req, res) => {
  const rule = await AlertRuleModel.findByPk(paramsOf(req, "id"));
  if (!rule) return res.status(404).json({ error: "规则不存在" });
  const { threshold, keyword, enabled, type } = req.body;
  if (threshold !== undefined) rule.threshold = threshold;
  if (keyword !== undefined) rule.keyword = keyword;
  if (enabled !== undefined) rule.enabled = enabled;
  if (type !== undefined) rule.type = type;
  await rule.save();
  res.json({ ok: true });
});

router.delete("/rules/:id", validate({ params: idParamSchema }), async (req, res) => {
  await AlertRuleModel.destroy({ where: { id: paramsOf(req, "id") } });
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
  await AlertModel.update({ acknowledged: true }, { where: { id: paramsOf(req, "id") } });
  res.json({ ok: true });
});

export default router;
