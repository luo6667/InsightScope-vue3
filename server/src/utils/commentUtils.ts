/**
 * 📘 utils/commentUtils.ts —— 评论“规范化 + 去重”的公共逻辑（导入 / 定时抓取共用）
 *
 * - normalizeComment()：把外部评论（字段名五花八门）统一成入库结构：
 *   content 兼容 text/comment 别名、作者兼容 author/name/nickname/user/username/email、
 *   来源兼容 platform/source/channel、缺省作者填“匿名用户”、非法时间戳回退当前时间、非法情感回退 neu 等；
 * - buildDedupFilter() / dedupKeyOf()：去重规则——
 *   数据源给了 id 按 id 去重；否则按评论“显式携带的全部字段”（内容/作者/平台/时间/情感…）
 *   完全重合才算重复，任一字段不同或字段集不同都保留（同一作者不同时间的评论不丢）。
 */
import type { Sentiment } from "../types.js";

/** 外部传入的原始评论（数据源 / 导入数组的一项） */
export interface RawComment {
  content?: unknown;
  text?: unknown;
  comment?: unknown;
  /** 作者：author / name / nickname / user / username / email 都认（见 authorOf） */
  author?: unknown;
  name?: unknown;
  nickname?: unknown;
  user?: unknown;
  username?: unknown;
  email?: unknown;
  /** 来源：platform / source / channel 都认（见 platformOf） */
  platform?: unknown;
  source?: unknown;
  channel?: unknown;
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

/**
 * 作者名（兼容数据源的各种字段名）。
 * 此前只认 author：像 jsonplaceholder 这样返回 { name, email, body } 的数据源，
 * 抓进来的评论作者会全部变成「匿名用户」。数字型作者（如 uid）也接受。
 */
export function authorOf(raw: RawComment): string {
  const candidates = [raw.author, raw.name, raw.nickname, raw.user, raw.username, raw.email];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, 64);
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return "";
}

/** 来源名（platform / source / channel 别名） */
export function platformOf(raw: RawComment): string {
  for (const c of [raw.platform, raw.source, raw.channel]) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, 64);
  }
  return "";
}

/**
 * 解析外部时间戳；缺失或非法（如 "abc" / "Invalid date"）时回退为「按流入顺序递推的当前时间」。
 * 直接 `new Date(非法字符串)` 得到 Invalid Date，Sequelize 会写成 "Invalid date" → MySQL 报
 * `Incorrect datetime value: 'Invalid date' for column 'timestamp'` 并让整批导入 500。
 */
function timestampOf(raw: RawComment, ctx: { now: number; index: number }): Date {
  const rawTs = raw.timestamp;
  if (rawTs !== undefined && rawTs !== null && String(rawTs).trim() !== "") {
    const d = new Date(typeof rawTs === "number" ? rawTs : String(rawTs));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(ctx.now + ctx.index * 1000);
}

/** 把外部评论规范化为入库文档（feeds / 导入 共用同一套字段映射） */
export function normalizeComment(raw: RawComment, ctx: { platform: string; now: number; index: number }): NormalizedComment {
  const content = String(raw.content ?? raw.text ?? raw.comment ?? "").slice(0, 2000);
  const author = authorOf(raw) || "匿名用户";
  const sourceId = raw.id ?? raw.commentId ? String(raw.id ?? raw.commentId) : "";
  const sentiment: Sentiment = ["pos", "neu", "neg"].includes(raw.sentiment as string)
    ? (raw.sentiment as Sentiment)
    : "neu";
  return {
    content,
    author,
    platform: platformOf(raw) || ctx.platform,
    timestamp: timestampOf(raw, ctx),
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
  const author = authorOf(raw);
  if (author) filter.author = author;
  const platform = platformOf(raw);
  if (platform) filter.platform = platform;
  if (raw.timestamp !== undefined && raw.timestamp !== null && String(raw.timestamp).trim() !== "") {
    const ts = new Date(typeof raw.timestamp === "number" ? raw.timestamp : String(raw.timestamp));
    if (!Number.isNaN(ts.getTime())) filter.timestamp = ts;
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
  const author = authorOf(raw);
  if (author) parts.push(`author:${author}`);
  const platform = platformOf(raw);
  if (platform) parts.push(`platform:${platform}`);
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
