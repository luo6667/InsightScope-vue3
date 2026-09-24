/**
 * 📘 api/api.ts —— 业务 API 函数（对后端每个 REST 接口，一接口一函数）
 *
 * 页面 / hooks 不直接碰 axios，只 import 这里具名导出的函数（如 listDatasets()）。
 * 好处：后端接口地址或参数变了只改这一处；返回类型从 api/types.ts 对齐。
 * 按业务分块：数据集 / 定时抓取 / 评论与统计 / 导出 / 场景 / 分析任务 / 模拟器 / 告警。
 */
import { downloadUrl } from '../lib/download'
import { apiUrl } from '../lib/env'
import { del, get, patch, post } from './client'
import type {
  Alert,
  AlertRule,
  AnalysisJob,
  CommentRow,
  DatasetInfo,
  DatasetStats,
  ImportComment,
  ScenarioInfo,
  Sentiment,
} from './types'

// 数据集
export const listDatasets = () =>
  get<{ datasets: DatasetInfo[] }>('/datasets').then((r) => r.datasets)
export const createScenarioDataset = (scenarioId: string, name?: string) =>
  post<{ id: string; count: number }>('/datasets', { scenarioId, name })
export const importComments = (comments: ImportComment[], name?: string, platform?: string) =>
  post<{ id: string; count: number }>('/datasets', { comments, name, platform })
export const deleteDataset = (id: string) => del<{ ok: boolean }>(`/datasets/${id}`)

// URL 定时抓取
export const createFeedDataset = (name: string, feedUrl: string, feedIntervalMin: number) =>
  post<{ id: string; count: number }>('/datasets', { name, feedUrl, feedIntervalMin })
export const startFeedPull = (id: string) => post<{ ok: boolean }>(`/datasets/${id}/feed/start`)
export const stopFeedPull = (id: string) => post<{ ok: boolean }>(`/datasets/${id}/feed/stop`)
/** skipped=true 表示该数据集已有抓取在跑，后端未重复执行（此时 count 恒为 0） */
export const pullFeedNow = (id: string) =>
  post<{ ok: boolean; count: number; skipped?: boolean }>(`/datasets/${id}/feed/pull`)

// 评论与统计
export const listComments = (datasetId: string, params?: Record<string, unknown>) =>
  get<{ total: number; page: number; limit: number; comments: CommentRow[] }>(
    `/datasets/${datasetId}/comments`,
    params,
  )
export const getStats = (datasetId: string, params?: Record<string, unknown>) =>
  get<DatasetStats>(`/datasets/${datasetId}/stats`, params)

// 手动修正评论
export const updateComment = (
  datasetId: string,
  cid: string,
  body: { sentiment?: Sentiment; topics?: string[]; sentimentScore?: number },
) => patch<{ ok: boolean }>(`/datasets/${datasetId}/comments/${cid}`, body)

/**
 * 导出评论（浏览器原生下载）。
 * baseURL 取 lib/env.ts 的 API_BASE，与 axios 请求保持一致；
 * 注意 `<a download>` 不会带 Authorization 头 —— 后端启用 ACCESS_TOKEN 时这里会被 401 拒绝
 * （属已知待办「导出鉴权」，未包含在本次内部重构范围内）。
 */
export function exportComments(datasetId: string, format: 'csv' | 'json'): void {
  downloadUrl(
    apiUrl(`/datasets/${datasetId}/export?format=${format}`),
    `comments-${datasetId}.${format}`,
  )
}

// 场景
export const listScenarios = () =>
  get<{ scenarios: ScenarioInfo[] }>('/scenarios').then((r) => r.scenarios)

// 分析任务
export const startAnalysis = (
  datasetId: string,
  cfg: {
    apiKey: string
    baseUrl: string
    model: string
    temperature: number
    concurrency?: number
  },
) => post<{ job: AnalysisJob }>(`/datasets/${datasetId}/analysis`, cfg).then((r) => r.job)
export const getJob = (datasetId: string) =>
  get<{ job: AnalysisJob | null }>(`/datasets/${datasetId}/analysis`).then((r) => r.job)
export const pauseAnalysis = (datasetId: string) => post(`/datasets/${datasetId}/analysis/pause`)
export const resumeAnalysis = (datasetId: string) => post(`/datasets/${datasetId}/analysis/resume`)
export const cancelAnalysis = (datasetId: string) => post(`/datasets/${datasetId}/analysis/cancel`)
export const resetAnalysis = (datasetId: string) =>
  post<{ ok: boolean; reset: number }>(`/datasets/${datasetId}/analysis/reset`)

// 实时模拟器
export const startSimulate = (datasetId: string, speed?: number) =>
  post<{ ok: boolean; total: number; speed: number }>(`/datasets/${datasetId}/simulate/start`, {
    speed,
  })
export const stopSimulate = (datasetId: string) =>
  post<{ ok: boolean }>(`/datasets/${datasetId}/simulate/stop`)
export const setSimSpeed = (datasetId: string, speed: number) =>
  post<{ ok: boolean; speed: number }>(`/datasets/${datasetId}/simulate/speed`, { speed })

// 告警
export const listRules = (datasetId?: string) =>
  get<{ rules: AlertRule[] }>('/alerts/rules', { datasetId }).then((r) => r.rules)
export const createRule = (body: {
  datasetId: string
  type: string
  threshold: number
  keyword?: string
}) => post<{ id: string }>('/alerts/rules', body)
export const updateRule = (id: string, body: Partial<AlertRule>) =>
  patch<{ ok: boolean }>(`/alerts/rules/${id}`, body)
export const deleteRule = (id: string) => del<{ ok: boolean }>(`/alerts/rules/${id}`)
export const listAlerts = (datasetId?: string) =>
  get<{ alerts: Alert[] }>('/alerts', { datasetId }).then((r) => r.alerts)
export const ackAlert = (id: string) => patch<{ ok: boolean }>(`/alerts/${id}/ack`)
