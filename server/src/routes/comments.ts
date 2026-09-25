/**
 * 📘 routes/comments.ts —— 评论查询 / 统计 / 手动修正
 *
 * 这是 Sequelize 复杂查询的“教学窗口”：
 * - 列表：分页 + 时间范围 + 情感过滤 + 主题过滤(JSON_CONTAINS) + 关键词搜索(LIKE 转义)；
 * - 统计 /stats：情感分组计数、按天趋势、主题与关键词词频（textService 提取）；
 * - 修正 PATCH：人工改情感/主题（前端弹窗保存）。
 */
import { Router, type Request, type Response } from "express";
import { Op } from "sequelize";
import { sequelize } from "../db.js";
import { CommentModel, DatasetModel } from "../models.js";
import { countKeywords } from "../services/textService.js";
import {
  validate,
  paramsOf,
  ValidatedRequest,
  commentListQuerySchema,
  exportQuerySchema,
  statsQuerySchema,
  datasetIdParamSchema,
  commentParamSchema,
  patchCommentBodySchema,
} from "../validation.js";

const router = Router();

/** 导出分批大小：边查边写，避免一次性把整份数据读进内存 */
const EXPORT_BATCH = 1000;

/**
 * 数据集存在性校验。
 * 此前对任意 datasetId 都返回 200（空列表 / 空 CSV / 全 0 统计），前端只能显示「没有数据」，
 * 无法区分「数据集不存在」与「数据集是空的」。
 */
async function requireDataset(req: Request, res: Response): Promise<string | null> {
  const id = paramsOf(req, "datasetId");
  const exists = await DatasetModel.findByPk(id, { attributes: ["id"] });
  if (!exists) {
    res.status(404).json({ error: "数据集不存在" });
    return null;
  }
  return id;
}

/** MySQL LIKE 转义：% _ \（保证与原先正则字面量搜索行为一致） */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** 时间过滤（query 已由 zod 校验为 Date） */
function timeFilter(q: Record<string, unknown>): { timestamp?: { [Op.gte]?: Date; [Op.lte]?: Date } } {
  const f: { timestamp?: { [Op.gte]?: Date; [Op.lte]?: Date } } = {};
  if (q.from) f.timestamp = { ...f.timestamp, [Op.gte]: q.from as Date };
  if (q.to) f.timestamp = { ...f.timestamp, [Op.lte]: q.to as Date };
  return f.timestamp ? f : {};
}

/** 构造评论列表共用过滤条件（datasetId + 时间 + 情感 + 主题 + 关键词搜索） */
function buildFilter(q: Record<string, unknown>, datasetId: string): Record<string, unknown> {
  const filter: Record<PropertyKey, unknown> = { datasetId, ...timeFilter(q) };
  if (q.sentiment) filter.sentiment = q.sentiment;
  if (q.topic) {
    // topics 为 JSON 数组列：JSON_CONTAINS 判断是否包含该主题（等价于原先 Mongo 数组包含语义）
    filter[Op.and] = sequelize.where(
      sequelize.fn("JSON_CONTAINS", sequelize.col("topics"), sequelize.fn("JSON_QUOTE", String(q.topic))),
      1
    );
  }
  if (q.q) {
    // 不区分大小写：utf8mb4_unicode_ci 排序规则下 LIKE 天然忽略大小写（长度上限由 zod 保证）
    filter.content = { [Op.like]: `%${escapeLike(String(q.q))}%` };
  }
  return filter as Record<string, unknown>;
}

// 评论分页列表：GET /:datasetId/comments?page=&limit=&sentiment=&topic=&q=&from=&to=
router.get(
  "/:datasetId/comments",
  validate({ params: datasetIdParamSchema, query: commentListQuerySchema }),
  async (req, res) => {
    const datasetId = await requireDataset(req, res);
    if (!datasetId) return;
    const q = (req as ValidatedRequest).validatedQuery ?? {};
    const page = q.page as number;
    const limit = q.limit as number;
    const filter = buildFilter(q, datasetId);
    const { count: total, rows } = await CommentModel.findAndCountAll({
      where: filter,
      order: [["timestamp", "DESC"]],
      offset: (page - 1) * limit,
      limit,
      raw: true,
    });
    res.json({
      total,
      page,
      limit,
      comments: rows.map((c) => ({
        id: c.id,
        content: c.content,
        author: c.author,
        platform: c.platform,
        timestamp: c.timestamp,
        sentiment: c.sentiment,
        sentimentScore: c.sentimentScore,
        topics: c.topics,
        keywords: c.keywords,
        analyzed: c.analyzed,
      })),
    });
  }
);

// 手动修正评论：PATCH /:datasetId/comments/:cid  { sentiment?, topics?, sentimentScore? }
router.patch(
  "/:datasetId/comments/:cid",
  validate({ params: commentParamSchema, body: patchCommentBodySchema }),
  async (req, res) => {
    const { sentiment, topics, sentimentScore } = req.body;
    const set: Record<string, unknown> = {};
    if (sentiment) {
      set.sentiment = sentiment;
      const score =
        typeof sentimentScore === "number"
          ? Math.max(-1, Math.min(1, sentimentScore))
          : sentiment === "pos" ? 0.8 : sentiment === "neg" ? -0.8 : 0;
      set.sentimentScore = Math.round(score * 100) / 100;
    }
    if (Array.isArray(topics)) set.topics = topics.map(String).slice(0, 5);
    if (Object.keys(set).length === 0) return res.status(400).json({ error: "没有可更新的字段" });
    set.analyzed = true;
    const [affected] = await CommentModel.update(set, {
      where: { id: paramsOf(req, "cid"), datasetId: paramsOf(req, "datasetId") },
    });
    if (affected === 0) return res.status(404).json({ error: "评论不存在" });
    res.json({ ok: true });
  }
);

// 导出评论：GET /:datasetId/export?format=csv|json&sentiment=&topic=&q=&from=&to=
router.get(
  "/:datasetId/export",
  validate({ params: datasetIdParamSchema, query: exportQuerySchema }),
  async (req, res) => {
    const datasetId = await requireDataset(req, res);
    if (!datasetId) return;
    const q = (req as ValidatedRequest).validatedQuery ?? {};
    const format = q.format as "csv" | "json";
    const filter = buildFilter(q, datasetId);

    if (format === "csv") {
      const header = ["content", "author", "platform", "timestamp", "sentiment", "topics"];
      // 防 CSV 公式注入：以 = + - @ 开头的单元格加前缀单引号
      const escape = (v: unknown) => {
        const s = String(v ?? "");
        const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      res.setHeader("Content-Type", "text/csv;charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=comments-${datasetId}.csv`);
      res.write("\uFEFF" + header.join(",") + "\r\n");
      // 分批查询 + 边查边写：此前是 findAll({ limit: 5000 })，
      // 超过 5000 条的导出会被静默截断（按 timestamp DESC 丢掉最旧的数据：
      // /stats 显示 5600 条而 CSV 只有 5000 行）。现在导出全部匹配行。
      // 排序里带 id 兜底：timestamp 可能重复，否则分批分页会漏行/重复行。
      for (let offset = 0; ; offset += EXPORT_BATCH) {
        const rows = await CommentModel.findAll({
          where: filter,
          order: [["timestamp", "DESC"], ["id", "DESC"]],
          limit: EXPORT_BATCH,
          offset,
          raw: true,
        });
        if (rows.length === 0) break;
        const chunk = rows
          .map((c) =>
            [
              c.content,
              c.author,
              c.platform,
              c.timestamp ? new Date(c.timestamp).toISOString() : "",
              c.sentiment,
              (c.topics ?? []).join("|"),
            ]
              .map(escape)
              .join(",")
          )
          .join("\r\n");
        res.write(chunk + "\r\n");
        if (rows.length < EXPORT_BATCH) break;
      }
      res.end();
      return;
    }

    // JSON 导出同样不再限制条数（分批累加，避免一次性把大结果集读进内存）
    const comments: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += EXPORT_BATCH) {
      const rows = await CommentModel.findAll({
        where: filter,
        order: [["timestamp", "DESC"], ["id", "DESC"]],
        limit: EXPORT_BATCH,
        offset,
        raw: true,
      });
      if (rows.length === 0) break;
      for (const c of rows) {
        comments.push({
          id: c.id,
          content: c.content,
          author: c.author,
          platform: c.platform,
          timestamp: c.timestamp,
          sentiment: c.sentiment,
          sentimentScore: c.sentimentScore,
          topics: c.topics,
        });
      }
      if (rows.length < EXPORT_BATCH) break;
    }
    res.json({ comments });
  }
);

// 聚合统计：GET /:datasetId/stats?from=&to=（支持时间过滤，供时段对比）
router.get(
  "/:datasetId/stats",
  validate({ params: datasetIdParamSchema, query: statsQuerySchema }),
  async (req, res) => {
    const q = (req as ValidatedRequest).validatedQuery ?? {};
    const id = await requireDataset(req, res);
    if (!id) return;
    const tf = timeFilter(q);
    const where: Record<string, unknown> = { datasetId: id, ...tf };
    const [total, analyzed, rows] = await Promise.all([
      CommentModel.count({ where: { datasetId: id, ...tf } }),
      CommentModel.count({ where: { datasetId: id, ...tf, analyzed: true } }),
      // 单次拉取所需字段，内存聚合情感/主题/趋势（单数据集量级小，行为与原先聚合管道一致）
      CommentModel.findAll({
        where,
        attributes: ["sentiment", "topics", "timestamp"],
        raw: true,
      }),
    ]);

    const sentiment = { pos: 0, neu: 0, neg: 0 };
    const topicCount = new Map<string, number>();
    const trendMap = new Map<string, { date: string; pos: number; neu: number; neg: number; total: number }>();
    for (const r of rows) {
      const s = r.sentiment as "pos" | "neu" | "neg";
      if (s in sentiment) sentiment[s]++;
      for (const t of r.topics ?? []) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
      // 趋势按 UTC 日期分组（与原 $dateToString 默认 UTC 行为一致）
      const date = new Date(r.timestamp).toISOString().slice(0, 10);
      const row = trendMap.get(date) ?? { date, pos: 0, neu: 0, neg: 0, total: 0 };
      if (s in row) row[s]++;
      row.total++;
      trendMap.set(date, row);
    }

    const topics = [...topicCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    const trend = [...trendMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    // 关键词云：从评论内容按评价词典统计词频（支持 ?dictionary= 自定义词，逗号分隔）
    const customDict = q.dictionary
      ? String(q.dictionary).split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const contentRows = await CommentModel.findAll({
      where: { datasetId: id, ...tf },
      attributes: ["content"],
      order: [["timestamp", "DESC"]],
      limit: 1000,
      raw: true,
    });
    const keywords = countKeywords(contentRows.map((c) => c.content), 20, customDict);

    res.json({
      total,
      analyzed,
      sentiment,
      topics,
      keywords,
      trend,
    });
  }
);

export default router;
