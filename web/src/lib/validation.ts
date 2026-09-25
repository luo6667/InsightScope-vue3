import { z } from 'zod'

/**
 * 前端表单校验 schema（与后端 server/src/validation.ts 保持一致）。
 * 前后端各自维护：改后端校验时同步改这里（或抽成共享包）。
 * 校验失败统一走 zod 的 safeParse，错误信息在表单字段旁展示。
 */

export const SENTIMENTS = ['pos', 'neu', 'neg'] as const
export const RULE_TYPES = ['negativity', 'volume', 'keyword'] as const

/** 情感取值（由 SENTIMENTS 派生，全前端唯一来源；api/types.ts 直接再导出） */
export type Sentiment = (typeof SENTIMENTS)[number]

// ============ 分析运行：必填校验（对应后端 createAnalysisBodySchema,与设置页可留空的 aiSettingsSchema 互补） ============

/**
 * 运行分析时必须填齐 API 配置（与后端 createAnalysisBodySchema 的约束一致）：
 * 设置页允许留空保存,但点击「开始分析」前必须校验必填,避免把空配置发给后端。
 */
export const analysisRunSchema = z.object({
  apiKey: z.string().trim().min(1).max(1024),
  baseUrl: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(128),
  temperature: z.number().min(0).max(2),
})
export type AnalysisRunInput = z.infer<typeof analysisRunSchema>

// ============ 设置页：AI 服务配置（对应后端 createAnalysisBodySchema） ============

/**
 * 设置页允许字段留空（未配置时保存），仅在非空时校验格式。
 * key 校验与后端一致：去掉空白后只允许可打印 ASCII（sk-... 格式）。
 */
export const aiSettingsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((v) => v === '' || /^[\x20-\x7e]+$/.test(v), 'Base URL 含非 ASCII 字符，请检查'),
  apiKey: z
    .string()
    .trim()
    .max(1024)
    .refine(
      (v) => v === '' || /^[\x20-\x7e]+$/.test(v.replace(/\s+/g, '')),
      'key 混入了非 ASCII 字符，只保留 sk-... 那段',
    ),
  model: z.string().trim().max(128),
  temperature: z.number().min(0).max(2, 'temperature 需在 0 ~ 2 之间'),
})
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>

// ============ 导入页：粘贴导入（对应后端 createDatasetBodySchema 的 comments 分支） ============

export const pasteImportSchema = z.object({
  name: z.string().trim().max(100).optional(),
  comments: z.array(z.string().trim().min(1).max(2000)).min(1).max(5000),
})
export type PasteImportInput = z.infer<typeof pasteImportSchema>

// ============ 导入页：CSV 导入（每条评论字段同后端 importCommentSchema,content 可缺省由解析层兜底） ============

export const csvImportRowSchema = z.object({
  content: z.string().max(2000).optional(),
  text: z.string().max(2000).optional(),
  author: z.string().max(64).optional(),
  platform: z.string().max(64).optional(),
  sentiment: z.enum(SENTIMENTS).optional(),
})

export const csvImportSchema = z.object({
  rows: z.array(csvImportRowSchema).min(1).max(5000),
})
export type CsvImportInput = z.infer<typeof csvImportSchema>

// ============ 导入页：URL 定时抓取（对应后端 createDatasetBodySchema 的 feed 分支） ============

export const feedImportSchema = z.object({
  name: z.string().trim().max(100).optional(),
  url: z
    .string()
    .trim()
    .min(1, '数据源 URL 不能为空')
    .max(2048)
    .refine(
      (v) => /^https?:\/\/.+/i.test(v),
      '需为 http/https 绝对地址（如 https://example.com/comments）',
    ),
  intervalMin: z.coerce.number().int().min(1).max(1440, '抓取间隔需在 1 ~ 1440 分钟之间'),
})
export type FeedImportInput = z.infer<typeof feedImportSchema>

// ============ 告警中心：创建规则（对应后端 createRuleBodySchema） ============

export const alertRuleSchema = z
  .object({
    type: z.enum(RULE_TYPES),
    threshold: z.coerce.number().min(0).max(100000),
    keyword: z.string().trim().max(255),
    /** 评论量规则的时间窗口（分钟）：语义为「最近 N 分钟新增条数 ≥ 阈值」，默认 10 */
    windowMin: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440, '时间窗口需在 1 ~ 1440 分钟之间')
      .default(10),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'keyword' && !v.keyword) {
      ctx.addIssue({ code: 'custom', message: '敏感关键词规则必须填写关键词', path: ['keyword'] })
    }
  })
export type AlertRuleInput = z.infer<typeof alertRuleSchema>

// ============ 工具 ============

/** 把 ZodError 摊平成 { 字段路径: 第一条错误信息 }，便于表单逐字段展示 */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

/** 取校验错误的第一条消息（用于非表单场景的统一错误提示） */
export function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? '参数校验失败'
}
