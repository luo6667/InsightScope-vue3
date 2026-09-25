/**
 * 📘 services/alertEngine.ts —— 告警规则检测引擎（实时模拟 / 定时抓取 / AI 分析 共用）
 *
 * 此前 checkAlerts() 只写在 routes/simulate.ts 的 tick 里，于是「URL 定时抓取入库」与
 * 「AI 分析写回」这两条真实数据链路永远不评估规则——给真实 feed 数据集配了负面率规则，
 * 抓进来的负面评论也不会产生任何告警（告警中心/监控台横幅永远安静）。现在抽成公共模块，
 * 三条链路在写完数据后都调用一次 checkAlerts()。
 *
 * 三类规则的判定口径（本次一并修正）：
 * - 负面率：最近 WINDOW 条评论的负面占比 ≥ 阈值；外加 Z-score 突增（每 5 条采样）判定；
 * - 敏感关键词：在**整份数据**里找命中（此前只在「最近 20 条」里 find，
 *   关键词出现在稍早的评论里规则就形同虚设）；
 * - 评论量：**最近 N 分钟**（规则自带的 windowMin，默认 10 分钟）内新增的评论条数 ≥ 阈值。
 *   口径变迁：最初是「最近 20 条里比条数」（UI 默认阈值 50 → 永远不可能成立），
 *   中间一版改成「累计条数 ≥ 阈值」（450 条的存量数据集配默认阈值 50 会一配就触发、
 *   告警从此永远处于触发态、失去含义）；现在改为真正的「最近 N 分钟新增条数」，
 *   既能在实时链路上反映"突然涌入"，也不会被历史存量喂饱。
 *
 * 冷却：同一数据集 + 同一规则类型 COOLDOWN_MS 内只告警一次，避免刷屏。
 */
import { Op } from "sequelize";
import { AlertModel, AlertRuleModel, CommentModel } from "../models.js";
import { io } from "../index.js";
import { detectAnomaly } from "./anomalyService.js";

/** 负面率 / Z-score 检测窗口：最近 N 条评论 */
export const WINDOW = 20;
/** 同数据集 + 同类型告警的冷却时间 */
export const COOLDOWN_MS = 60_000;
/** 评论量规则的默认时间窗口（分钟）：规则未带 windowMin（老数据 / 未传）时使用 */
export const DEFAULT_VOLUME_WINDOW_MIN = 10;

function emit(datasetId: string, event: string, payload: unknown) {
  io.to(`dataset:${datasetId}`).emit(event, payload);
}

interface Trigger {
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
  value: number;
}

/**
 * 触发告警检测。
 * cutoff：模拟器重放时只检测「已流入」的评论（timestamp <= cutoff），保证演示时序正确；
 * 真实数据链路（抓取 / 分析）不传，统计到当前为止的全部评论。
 * 它对评论量规则同时也是「窗口锚点」：窗口 = [anchor - N 分钟, anchor]。
 */
export async function checkAlerts(datasetId: string, cutoff?: Date): Promise<void> {
  const rules = await AlertRuleModel.findAll({ where: { datasetId, enabled: true } });
  if (rules.length === 0) return;

  const timeFilter = cutoff ? { timestamp: { [Op.lte]: cutoff } } : {};
  // 评论量窗口的锚点：模拟器重放时是「当前重放到的那条评论的时间」，
  // 真实链路是当前时刻 —— 这样演示时序与真实场景的「最近 N 分钟」口径一致。
  const anchor = cutoff ?? new Date();

  // 最近 WINDOW 条：负面率与 Z-score 的检测样本
  const recent = await CommentModel.findAll({
    where: { datasetId, ...timeFilter },
    order: [["timestamp", "DESC"]],
    limit: WINDOW,
  });
  const negRate = recent.length > 0 ? recent.filter((c) => c.sentiment === "neg").length / recent.length : 0;

  // Z-score：滑动窗口负面率序列（每 5 条采样）检测突增（只统计已流入/已入库的评论）
  let anomalyMsg: string | null = null;
  if (recent.length >= 5) {
    try {
      if (!/^\d+$/.test(datasetId)) throw new Error("invalid dataset id");
      const rows = await CommentModel.findAll({
        where: { datasetId, ...timeFilter },
        attributes: ["sentiment"],
        order: [["timestamp", "ASC"]],
        raw: true,
      });
      const items = rows.map((r) => r.sentiment);
      const seq: number[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const slice = items.slice(Math.max(0, i - WINDOW), i + 1);
        seq.push(slice.filter((s) => s === "neg").length / slice.length);
      }
      const sampled: number[] = [];
      for (let i = 0; i < seq.length; i += 5) sampled.push(Math.round(seq[i] * 100) / 100);
      const res = detectAnomaly(sampled, 2);
      if (res?.isAnomaly && res.current > res.mean) {
        anomalyMsg = `负面率异常突增：当前 ${Math.round(res.current * 100)}%，基线 ${Math.round(res.mean * 100)}%（Z=${res.zScore.toFixed(1)}）`;
      }
    } catch {
      /* Z-score 失败不影响规则检测 */
    }
  }

  const triggers: Trigger[] = [];

  // 冷却检查：同一数据集 + 类型最近 COOLDOWN_MS 是否已触发
  const inCooldown = async (type: string) => {
    const recentAlert = await AlertModel.findOne({
      where: { datasetId, type, triggeredAt: { [Op.gte]: new Date(Date.now() - COOLDOWN_MS) } },
    });
    return !!recentAlert;
  };

  if (anomalyMsg && !(await inCooldown("negativity"))) {
    triggers.push({ type: "negativity", severity: "critical", message: anomalyMsg, value: Math.round(negRate * 100) });
  }

  for (const rule of rules) {
    if (await inCooldown(rule.type)) continue;

    if (rule.type === "negativity") {
      // 样本太少时负面率没有意义（1 条负面就是 100%），不足 WINDOW 的一半直接跳过
      if (recent.length >= 5 && negRate >= rule.threshold / 100) {
        triggers.push({
          type: "negativity",
          severity: "warning",
          message: `负面率超过阈值 ${rule.threshold}%：当前 ${Math.round(negRate * 100)}%`,
          value: Math.round(negRate * 100),
        });
      }
    } else if (rule.type === "keyword" && rule.keyword) {
      // 全量扫描（Op.substring 由 Sequelize 转义 LIKE 通配符），不再只看最近 20 条
      const hit = await CommentModel.findOne({
        where: { datasetId, ...timeFilter, content: { [Op.substring]: rule.keyword } },
        order: [["timestamp", "DESC"]],
      });
      if (hit) {
        triggers.push({
          type: "keyword",
          severity: "info",
          message: `检测到敏感关键词「${rule.keyword}」：${hit.content.slice(0, 40)}…`,
          value: 1,
        });
      }
    } else if (rule.type === "volume") {
      // 最近 N 分钟新增条数（N = 规则自带窗口，缺省 10 分钟；锚点见上方 anchor 注释）
      const windowMin = Number(rule.windowMin) > 0 ? Number(rule.windowMin) : DEFAULT_VOLUME_WINDOW_MIN;
      const from = new Date(anchor.getTime() - windowMin * 60_000);
      const volume = await CommentModel.count({
        where: { datasetId, timestamp: { [Op.gte]: from, [Op.lte]: anchor } },
      });
      if (volume >= rule.threshold) {
        triggers.push({
          type: "volume",
          severity: "warning",
          message: `最近 ${windowMin} 分钟新增评论 ${volume} 条（阈值 ${rule.threshold}）`,
          value: volume,
        });
      }
    }
  }

  for (const t of triggers) {
    const alert = await AlertModel.create({
      datasetId,
      type: t.type,
      severity: t.severity,
      message: t.message,
      value: t.value,
    });
    emit(datasetId, "alert:new", {
      id: String(alert.id),
      datasetId,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      value: alert.value,
      triggeredAt: alert.triggeredAt,
      acknowledged: false,
    });
  }
}
