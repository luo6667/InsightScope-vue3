/**
 * 📘 validation.ts —— 请求校验层（技术栈：zod）
 *
 * 为每个接口的 body / query / params 写一个 zod schema（描述“合法参数长什么样”），
 * validate({...}) 中间件负责：解析 → 校验 → 不合法抛 HttpError(400) → 合法则替换 req.body。
 * 好处：
 * - 路由代码不用手写一堆 if/else 判参数（长度、枚举、范围、必填）；
 * - 前端可 import 同一份 schema 用 z.infer 派生 TS 类型，前后端校验口径一致。
 */
import { z } from "zod";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { HttpError } from "./utils/httpUtils.js";

/**
 * 统一请求校验层：
 * - 所有接口的 body / query / params 用 zod schema 定义，前端可用 z.infer 共享类型；
 * - validate() 中间件解析并替换 req.body / req.params（Express 5 中 req.query 是只读
 *   getter，不能整体赋值，解析结果挂到 req.validatedQuery）；
 * - 校验失败抛 HttpError(400)，由统一错误中间件响应。
 */

export const SENTIMENTS = ["pos", "neu", "neg"] as const;
export const RULE_TYPES = ["negativity", "volume", "keyword"] as const;

export interface ValidatedRequest extends Request {
  validatedQuery?: Record<string, unknown>;
}

/**
 * 类型收窄：Express 5 的类型声明里 params 值为 string | string[]（支持重复参数），
 * 但实际路由参数是单值字符串。统一在此收窄，避免各路由重复断言。
 */
export function paramsOf(req: Request, name: string): string {
  const v = (req.params as Record<string, unknown>)[name];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

// ============ params ============

/** 数据集 id 为自增数字（对外字符串） */
const idString = z.string().regex(/^\d+$/, "ID 不合法").max(64);

export const idParamSchema = z.object({ id: idString });
export const datasetIdParamSchema = z.object({ datasetId: idString });
export const commentParamSchema = z.object({
  datasetId: idString,
  cid: idString,
});

// ============ query ============

/** 分页参数（clamp 上限，防超大 page/offset 拖慢 MySQL） */
const pagination = {
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const timeRange = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

export const commentListQuerySchema = z.object({
  ...pagination,
  ...timeRange,
  sentiment: z.enum(SENTIMENTS).optional(),
  topic: z.string().trim().min(1).max(50).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export const exportQuerySchema = z.object({
  ...timeRange,
  format: z.enum(["csv", "json"]).default("json"),
  sentiment: z.enum(SENTIMENTS).optional(),
  topic: z.string().trim().min(1).max(50).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export const statsQuerySchema = z.object({
  ...timeRange,
  dictionary: z.string().trim().max(1000).optional(),
});

export const ruleListQuerySchema = z.object({
  datasetId: z.string().regex(/^\d+$/, "数据集 ID 不合法").max(64).optional(),
});

export const alertListQuerySchema = z.object({
  datasetId: z.string().regex(/^\d+$/, "数据集 ID 不合法").max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// ============ body ============

/** 时间戳：字符串或毫秒数，且必须是能解析出有效日期的值 */
const rawTimestampSchema = z
  .union([z.string(), z.number()])
  .refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: "timestamp 不是可解析的日期（支持 ISO 日期字符串或毫秒时间戳）",
  });

/** 导入/抓取的原始评论（字段可缺省，normalizeComment 会兜底） */
const importCommentSchema = z.object({
  content: z.string().max(2000).optional(),
  text: z.string().max(2000).optional(),
  comment: z.string().max(2000).optional(),
  author: z.string().max(64).optional(),
  // 作者/平台别名：不少数据源用 name/nickname/username/email 与 source/channel
  // （例如 jsonplaceholder 的评论字段是 name）。zod 会剥掉未声明的键，
  // 只声明 author/platform 会让这些数据全部落成「匿名用户 / 数据源」。
  name: z.string().max(64).optional(),
  nickname: z.string().max(64).optional(),
  user: z.union([z.string().max(64), z.number()]).optional(),
  username: z.string().max(64).optional(),
  email: z.string().max(64).optional(),
  platform: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  channel: z.string().max(64).optional(),
  timestamp: rawTimestampSchema.optional(),
  sentiment: z.enum(SENTIMENTS).optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  topics: z.array(z.string().max(50)).max(20).optional(),
  keywords: z.array(z.string().max(50)).max(20).optional(),
  id: z.union([z.string().max(191), z.number()]).optional(),
  commentId: z.union([z.string().max(191), z.number()]).optional(),
});

/**
 * 创建数据集：内置场景 / 导入 / 定时抓取 三分支，至少提供其一。
 * 修复：feedIntervalMin 此前 Math.max(1, Number(x)) 对非数字得 NaN；且无上限，
 * 大值会导致 setInterval 的 delay 超过 2^31-1ms 溢出成 1ms 疯狂抓取。
 */
export const createDatasetBodySchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    platform: z.string().trim().max(64).optional(),
    scenarioId: z.string().trim().min(1).max(64).optional(),
    comments: z.array(importCommentSchema).max(5000).optional(),
    feedUrl: z.string().trim().min(1).max(2048).optional(),
    feedIntervalMin: z.coerce.number().int().min(1).max(1440).optional(),
  })
  .superRefine((v, ctx) => {
    const hasScenario = !!v.scenarioId;
    const hasImport = Array.isArray(v.comments) && v.comments.length > 0;
    const hasFeed = typeof v.feedUrl === "string" && v.feedUrl.trim().length > 0;
    if (!hasScenario && !hasImport && !hasFeed) {
      ctx.addIssue({ code: "custom", message: "需要 scenarioId / comments 数组 / feedUrl 三者之一", path: [] });
    }
  });

export const patchCommentBodySchema = z
  .object({
    sentiment: z.enum(SENTIMENTS).optional(),
    sentimentScore: z.number().min(-1).max(1).optional(),
    topics: z.array(z.string().trim().min(1).max(50)).max(5).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "没有可更新的字段" });

/** 创建规则：keyword 类型必须带关键词（与前端 alertRuleSchema 的 superRefine 对齐） */
export const createRuleBodySchema = z
  .object({
    datasetId: z.string().regex(/^\d+$/, "数据集 ID 不合法").max(64),
    type: z.enum(RULE_TYPES),
    threshold: z.number().min(0).max(100_000),
    keyword: z.string().max(255).optional(),
    /** 评论量规则的时间窗口（分钟）：判定「最近 N 分钟新增条数 ≥ threshold」，默认 10 */
    windowMin: z.coerce.number().int().min(1).max(1440, "时间窗口需在 1 ~ 1440 分钟之间").default(10),
    enabled: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "keyword" && !v.keyword) {
      ctx.addIssue({ code: "custom", message: "敏感关键词规则必须填写关键词", path: ["keyword"] });
    }
  });

export const updateRuleBodySchema = z
  .object({
    type: z.enum(RULE_TYPES).optional(),
    threshold: z.number().min(0).max(100_000).optional(),
    keyword: z.string().max(255).optional(),
    windowMin: z.coerce.number().int().min(1).max(1440, "时间窗口需在 1 ~ 1440 分钟之间").optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "没有可更新的字段" });

export const createAnalysisBodySchema = z.object({
  apiKey: z.string().trim().min(1).max(1024),
  baseUrl: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(128),
  temperature: z.number().min(0).max(2).default(0.2),
  concurrency: z.coerce.number().int().min(1).max(8).default(6),
});

export const speedBodySchema = z.object({
  speed: z.coerce.number().min(1).max(20).default(5),
});

/**
 * AI 流式对话转发（POST /api/ai）：与原 Next.js route handler 的 chatSchema 保持同一口径，
 * 前端 lib/ai.ts 的 streamChat 按此字段发送（apiKey 仅本次请求内存使用，不落库、不打印）。
 */
export const aiChatBodySchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  apiKey: z.string().trim().min(1).max(1024),
  model: z.string().trim().min(1).max(128),
  messages: z
    .array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() }))
    .min(1)
    .max(50),
  temperature: z.number().min(0).max(2).optional(),
});

// ============ validate 中间件 ============

interface ValidateSchemas {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

function formatZodError(e: z.ZodError): string {
  const issue = e.issues[0];
  if (!issue) return "参数校验失败";
  const path = issue.path.length > 0 ? issue.path.join(".") : "";
  return path ? `参数 ${path} 校验失败：${issue.message}` : issue.message;
}

export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req: ValidatedRequest, _res: Response, next: NextFunction) => {
    try {
      // params 仅校验（schema 无转换；不覆盖 req.params 以保留 Express 原生类型）
      if (schemas.params) schemas.params.parse(req.params);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
      next();
    } catch (e) {
      next(e instanceof z.ZodError ? new HttpError(400, formatZodError(e)) : e);
    }
  };
}
