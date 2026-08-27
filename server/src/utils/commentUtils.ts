import type { Sentiment } from "../types.js";

/** 外部传入的原始评论（数据源 / 导入数组的一项） */
export interface RawComment {
  content?: unknown;
  text?: unknown;
  comment?: unknown;
  author?: unknown;
  platform?: unknown;
  timestamp?: unknown;
  sentiment?: unknown;
  sentimentScore?: unknown;
  topics?: unknown;
  keywords?: unknown;
  analyzed?: unknown;
  id?: unknown;
  commentId?: unknown;
}

export interface NormalizedComment {
  content: string;
  author: string;
  platform: string;
  timestamp: Date;
  sentiment: Sentiment;
  sentimentScore: number;
  topics: string[];
  keywords: string[];
  analyzed: boolean;
  sourceId: string;
}

/** 把外部评论规范化为入库文档（feeds / 导入 共用同一套字段映射） */
export function normalizeComment(raw: RawComment, ctx: { platform: string; now: number; index: number }): NormalizedComment {
  const content = String(raw.content ?? raw.text ?? raw.comment ?? "").slice(0, 2000);
  const author = raw.author ? String(raw.author) : "匿名用户";
  const sourceId = raw.id ?? raw.commentId ? String(raw.id ?? raw.commentId) : "";
  const sentiment: Sentiment = ["pos", "neu", "neg"].includes(raw.sentiment as string)
    ? (raw.sentiment as Sentiment)
    : "neu";
  return {
    content,
    author,
    platform: raw.platform ? String(raw.platform) : ctx.platform,
    timestamp: raw.timestamp ? new Date(String(raw.timestamp)) : new Date(ctx.now + ctx.index * 1000),
    sentiment,
    sentimentScore: typeof raw.sentimentScore === "number" ? raw.sentimentScore : 0,
    topics: Array.isArray(raw.topics) ? raw.topics.map(String) : [],
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String) : [],
    analyzed: Boolean(raw.analyzed) || Boolean(raw.sentiment),
    sourceId,
  };
}

/**
 * 去重规则（导入 / URL 抓取 统一）：
 * - 数据源提供 id/commentId → 按 id 去重（数据源显式给出的唯一标识,优先信任）
 * - 否则 → 评论「显式携带的所有字段」全部重合才算重复：
 *   content(含 text/comment 别名) / author / platform / timestamp / sentiment /
 *   sentimentScore / topics / keywords,哪几个字段存在就按哪几个比较;
 *   字段集不同(如一条带时间一条不带)或任一字段值不同 → 都保留。
 * 系统兜底值(匿名用户/neu/空数组等)不参与——它们不是数据源提供的“条件”。
 */

/** 返回可直接用于数据库查询的 filter（与 datasetId 合并使用）；空对象 = 无任何显式条件 */
export function buildDedupFilter(raw: RawComment): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {}; // 防御数据源混入 null/标量
  const sourceId = raw.id ?? raw.commentId;
  if (sourceId) return { sourceId: String(sourceId) };
  const filter: Record<string, unknown> = {};
  const content = String(raw.content ?? raw.text ?? raw.comment ?? "").slice(0, 2000);
  if (content.trim()) filter.content = content;
  const author = raw.author ? String(raw.author).trim() : "";
  if (author) filter.author = author;
  if (typeof raw.platform === "string" && raw.platform.trim()) filter.platform = raw.platform.trim();
  if (raw.timestamp !== undefined && raw.timestamp !== null && String(raw.timestamp).trim() !== "") {
    filter.timestamp = new Date(String(raw.timestamp));
  }
  const sent = raw.sentiment;
  if (typeof sent === "string" && ["pos", "neu", "neg"].includes(sent)) filter.sentiment = sent;
  if (typeof raw.sentimentScore === "number" && Number.isFinite(raw.sentimentScore)) filter.sentimentScore = raw.sentimentScore;
  if (Array.isArray(raw.topics) && raw.topics.length > 0) filter.topics = raw.topics.map(String);
  if (Array.isArray(raw.keywords) && raw.keywords.length > 0) filter.keywords = raw.keywords.map(String);
  return filter;
}

/** 内存去重 key（导入数组内去重用,与 buildDedupFilter 同一套“显式字段”口径） */
export function dedupKeyOf(raw: RawComment): string {
  if (!raw || typeof raw !== "object") return ""; // 防御数据源混入 null/标量
  const sourceId = raw.id ?? raw.commentId;
  if (sourceId) return `id:${sourceId}`;
  const parts: string[] = [];
  const content = String(raw.content ?? raw.text ?? raw.comment ?? "").trim();
  if (content) parts.push(`content:${content}`);
  const author = raw.author ? String(raw.author).trim() : "";
  if (author) parts.push(`author:${author}`);
  if (typeof raw.platform === "string" && raw.platform.trim()) parts.push(`platform:${raw.platform.trim()}`);
  if (raw.timestamp !== undefined && raw.timestamp !== null && String(raw.timestamp).trim() !== "") {
    parts.push(`ts:${String(raw.timestamp).trim()}`);
  }
  const sent = raw.sentiment;
  if (typeof sent === "string" && ["pos", "neu", "neg"].includes(sent)) parts.push(`sentiment:${sent}`);
  if (typeof raw.sentimentScore === "number" && Number.isFinite(raw.sentimentScore)) parts.push(`score:${raw.sentimentScore}`);
  if (Array.isArray(raw.topics) && raw.topics.length > 0) parts.push(`topics:${raw.topics.map(String).join(",")}`);
  if (Array.isArray(raw.keywords) && raw.keywords.length > 0) parts.push(`keywords:${raw.keywords.map(String).join(",")}`);
  return parts.join("|");
}
