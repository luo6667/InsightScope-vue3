import type { Sentiment } from '../lib/validation'
import { RULE_TYPES } from '../lib/validation'

/** 情感枚举：以 lib/validation.ts 的 SENTIMENTS 为单一来源,避免三处重复字面量 */
export type { Sentiment }

export interface DatasetInfo {
  id: string
  name: string
  platform: string
  type: 'builtin' | 'imported' | 'feed'
  scenarioId: string
  feedUrl: string
  feedIntervalMin: number
  feedRunning: boolean
  feedLastAt: string | null
  feedLastCount: number
  feedLastError: string
  commentCount: number
  analyzedCount: number
  createdAt: string
}

export interface CommentRow {
  id: string
  content: string
  author: string
  platform: string
  timestamp: string
  sentiment: Sentiment
  sentimentScore: number
  topics: string[]
  keywords: string[]
  analyzed: boolean
}

export interface DatasetStats {
  total: number
  analyzed: number
  sentiment: Record<Sentiment, number>
  topics: { name: string; count: number }[]
  keywords: { word: string; count: number }[]
  trend: { date: string; pos: number; neu: number; neg: number; total: number }[]
}

export interface ScenarioInfo {
  id: string
  name: string
  description: string
  count: number
  days: number
}

/**
 * 导入评论的载荷：前端解析 CSV / 粘贴文本后提交的字段，
 * 与后端 server/src/validation.ts 的 importCommentSchema 对齐。
 */
export interface ImportComment {
  content: string
  author?: string
  platform?: string
  sentiment?: Sentiment
  analyzed?: boolean
}

export interface AnalysisJob {
  id: string
  datasetId: string
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed'
  total: number
  processed: number
  failed: number
  concurrency: number
  createdAt: string
}

export interface AlertRule {
  id: string
  datasetId: string
  type: (typeof RULE_TYPES)[number]
  threshold: number
  keyword: string
  enabled: boolean
}

export interface Alert {
  id: string
  datasetId: string
  type: (typeof RULE_TYPES)[number]
  severity: 'critical' | 'warning' | 'info'
  message: string
  value: number
  triggeredAt: string
  acknowledged: boolean
}
