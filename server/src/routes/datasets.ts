/**
 * 📘 routes/datasets.ts —— 数据集路由（业务核心之一）
 *
 * POST /api/datasets 一个接口三种创建方式（body 里给什么就建什么）：
 * - { scenarioId }     → 内置场景：scenarioService 按剧本生成预标注评论；
 * - { comments[] }     → 粘贴/CSV 导入：dedupKeyOf 数组内去重 → normalizeComment → bulkCreate；
 * - { feedUrl }        → 定时抓取数据集：只建壳，feedRunning=false（手动启动，见 feeds.ts）。
 * 其它：列表（带统计）/ 删除（级联清理）/ 导出。
 */
import { Router } from "express";
import { ALLOW_PRIVATE_FEED_URL } from "../config.js";
import { sequelize } from "../db.js";
import { DatasetModel, CommentModel, AnalysisJobModel, AlertModel, AlertRuleModel } from "../models.js";
import { generateScenarioComments, getScenario } from "../services/scenarioService.js";
import { stopFeed } from "./feeds.js";
import { cancelJobsForDataset } from "./analysis.js";
import { normalizeComment, dedupKeyOf } from "../utils/commentUtils.js";
import { sourceLabelFromUrl } from "../utils/sourceLabel.js";
import { assertPublicHttpUrl } from "../utils/urlSafety.js";
import { validate, paramsOf, createDatasetBodySchema, idParamSchema } from "../validation.js";

const router = Router();

// 数据集列表（含统计）
router.get("/", async (_req, res) => {
  const datasets = await DatasetModel.findAll({ order: [["createdAt", "DESC"]] });
  const rows = await Promise.all(
    datasets.map(async (d) => {
      const [cnt, analyzed] = await Promise.all([
        CommentModel.count({ where: { datasetId: d.id } }),
        CommentModel.count({ where: { datasetId: d.id, analyzed: true } }),
      ]);
      return {
        id: d.id,
        name: d.name,
        platform: d.platform,
        type: d.type,
        scenarioId: d.scenarioId,
        feedUrl: d.feedUrl ?? "",
        feedIntervalMin: d.feedIntervalMin ?? 0,
        feedRunning: d.feedRunning ?? false,
        feedLastAt: d.feedLastAt ?? null,
        feedLastCount: d.feedLastCount ?? 0,
        feedLastError: d.feedLastError ?? "",
        commentCount: cnt,
        analyzedCount: analyzed,
        createdAt: d.createdAt,
      };
    })
  );
  res.json({ datasets: rows });
});

// 数据集详情
router.get("/:id", validate({ params: idParamSchema }), async (req, res) => {
  const d = await DatasetModel.findByPk(paramsOf(req, "id"));
  if (!d) return res.status(404).json({ error: "数据集不存在" });
  const [commentCount, analyzedCount] = await Promise.all([
    CommentModel.count({ where: { datasetId: d.id } }),
    CommentModel.count({ where: { datasetId: d.id, analyzed: true } }),
  ]);
  res.json({
    id: d.id,
    name: d.name,
    platform: d.platform,
    type: d.type,
    scenarioId: d.scenarioId,
    commentCount,
    analyzedCount,
    createdAt: d.createdAt,
  });
});

// 创建数据集：{ name?, scenarioId } 内置场景 | { name?, platform?, comments } 导入 | { name?, feedUrl, feedIntervalMin } 定时抓取
router.post("/", validate({ body: createDatasetBodySchema }), async (req, res) => {
  const { name, scenarioId, platform, comments, feedUrl, feedIntervalMin } = req.body;

  if (scenarioId) {
    const def = getScenario(scenarioId);
    if (!def) return res.status(400).json({ error: "场景不存在" });
    const generated = generateScenarioComments(def);
    // 事务：数据集与评论一起成功/回滚，避免失败时留下 0 评论的空壳数据集
    const dataset = await sequelize.transaction(async (t) => {
      const created = await DatasetModel.create(
        {
          name: name?.trim() || def.name,
          platform: platform || "混合来源",
          type: "builtin",
          scenarioId,
        },
        { transaction: t }
      );
      await CommentModel.bulkCreate(
        generated.map((g) => ({
          datasetId: created.id,
          content: g.content,
          author: g.author,
          platform: g.platform,
          timestamp: g.timestamp,
          sentiment: g.sentiment,
          sentimentScore: g.sentimentScore,
          topics: g.topics,
          keywords: g.keywords,
          analyzed: true, // 内置场景已预标注，无 key 也能完整演示
        })),
        { transaction: t }
      );
      return created;
    });
    return res.status(201).json({ id: dataset.id, count: generated.length });
  }

  if (Array.isArray(comments) && comments.length > 0) {
    const now = Date.now();
    // 去重规则（全项目统一）：评论显式携带的全部字段重合才算重复（见 commentUtils.dedupKeyOf）
    const seen = new Set<string>();
    let i = 0;
    const buildDocs = (datasetId: string) =>
      comments
        .filter((c) => {
          // 防御：导入数据可能混入 null / 标量元素
          if (!c || typeof c !== "object") return false;
          const key = dedupKeyOf(c as never);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((c) => {
          const doc = normalizeComment(c as never, { platform: platform || "导入来源", now, index: i });
          i++;
          return { datasetId, ...doc };
        });

    // 事务：数据集与评论一起提交或一起回滚。
    // 此前没有事务：导入批次里只要有一条数据非法（如 timestamp 无法解析 → "Invalid date"），
    // 整批 500 却会留下一个「0 评论」的空数据集，用户反复重试就越攒越多垃圾数据集。
    const created = await sequelize.transaction(async (t) => {
      const dataset = await DatasetModel.create(
        {
          name: name?.trim() || `导入数据 ${new Date().toLocaleDateString("zh-CN")}`,
          platform: platform || "导入来源",
          type: "imported",
        },
        { transaction: t }
      );
      const docs = buildDocs(String(dataset.id));
      await CommentModel.bulkCreate(docs, { transaction: t });
      return { id: dataset.id, count: docs.length };
    });
    return res.status(201).json({ id: created.id, count: created.count, deduped: comments.length - created.count });
  }

  // URL 定时抓取数据集
  if (typeof feedUrl === "string" && feedUrl.trim()) {
    // SSRF 防护：必须是 http/https 绝对地址（默认放行私网，见 ALLOW_PRIVATE_FEED_URL=0 可恢复严格校验）
    const trimmed = feedUrl.trim();
    assertPublicHttpUrl(trimmed, "feedUrl", { allowPrivate: ALLOW_PRIVATE_FEED_URL });
    const dataset = await DatasetModel.create({
      name: name?.trim() || `定时抓取 ${new Date().toLocaleDateString("zh-CN")}`,
      // 来源名：用户没指定时用数据源 host（旧实现无脑写「数据源」→ 抓来的整批评论来源全显示「数据源」）
      platform: platform || sourceLabelFromUrl(trimmed) || "数据源",
      type: "feed",
      feedUrl: trimmed,
      // schema 已保证为 1-1440 的整数（修复：此前 NaN 会入库、超大值会撑爆 setInterval）
      feedIntervalMin: feedIntervalMin ?? 5,
      // 手动启动：创建后不自动抓取，用户点「启动」才运行（避免“没启动却在抓”）
      feedRunning: false,
    });
    return res.status(201).json({ id: dataset.id, count: 0, feed: true });
  }

  res.status(400).json({ error: "需要 scenarioId / comments 数组 / feedUrl" });
});

// 删除数据集（级联清理）
router.delete("/:id", validate({ params: idParamSchema }), async (req, res) => {
  const d = await DatasetModel.findByPk(paramsOf(req, "id"));
  if (!d) return res.status(404).json({ error: "数据集不存在" });
  stopFeed(d.id);
  await cancelJobsForDataset(d.id); // 取消运行中的分析任务，防止旧 worker 继续写已删除数据
  await Promise.all([
    CommentModel.destroy({ where: { datasetId: d.id } }),
    AnalysisJobModel.destroy({ where: { datasetId: d.id } }),
    AlertModel.destroy({ where: { datasetId: d.id } }),
    AlertRuleModel.destroy({ where: { datasetId: d.id } }),
    DatasetModel.destroy({ where: { id: d.id } }),
  ]);
  res.json({ ok: true });
});

export default router;
