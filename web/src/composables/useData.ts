import { useQuery } from '@tanstack/vue-query'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'

import { getJob, getStats, listAlerts, listComments, listDatasets, listRules } from '@/api/api'
import { queryKeys } from '@/api/queryKeys'
import { ALERTS_POLL_MS, ANALYSIS_JOB_POLL_MS } from '@/lib/constants'

/**
 * 📘 composables/useData.ts —— 数据请求组合式函数（技术栈：@tanstack/vue-query）
 *
 * 与 React 版 hooks/useData.ts 一一对应，queryKey 结构与缓存语义完全保留
 * （key 由 api/queryKeys.ts 统一提供，失效入口见 useInvalidateDataset）。
 *
 * Vue 版的差别只有一个：参数可以是 ref / computed / getter（MaybeRefOrGetter），
 * 用 toValue() 取值后包进 computed，所以 queryKey 与 enabled 会随参数自动重算。
 */
type Params = MaybeRefOrGetter<Record<string, unknown> | undefined>

/** 数据集列表（可指定轮询间隔，如 feed 数据集 8s 刷新） */
export function useDatasets(refetchInterval = 0) {
  return useQuery({ queryKey: queryKeys.datasets(), queryFn: listDatasets, refetchInterval })
}

/** 数据集聚合统计（支持时间过滤 / 自定义词典参数） */
export function useDatasetStats(datasetId: MaybeRefOrGetter<string>, params?: Params) {
  return useQuery({
    queryKey: computed(() => queryKeys.stats(toValue(datasetId), toValue(params))),
    queryFn: () => getStats(toValue(datasetId), toValue(params)),
    enabled: computed(() => !!toValue(datasetId)),
  })
}

/** 评论分页列表 */
export function useComments(datasetId: MaybeRefOrGetter<string>, params?: Params) {
  return useQuery({
    queryKey: computed(() => queryKeys.comments(toValue(datasetId), toValue(params))),
    queryFn: () => listComments(toValue(datasetId), toValue(params)),
    enabled: computed(() => !!toValue(datasetId)),
  })
}

/** 最新分析任务（running/pending/paused 时轮询） */
export function useAnalysisJob(datasetId: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.job(toValue(datasetId))),
    queryFn: () => getJob(toValue(datasetId)),
    enabled: computed(() => !!toValue(datasetId)),
    refetchInterval: (query) => {
      const j = query.state.data as { status?: string } | null
      return j && ['running', 'pending', 'paused'].includes(j.status ?? '')
        ? ANALYSIS_JOB_POLL_MS
        : false
    },
  })
}

/** 告警规则列表 */
export function useAlertRules(datasetId: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.rules(toValue(datasetId))),
    queryFn: () => listRules(toValue(datasetId)),
    enabled: computed(() => !!toValue(datasetId)),
  })
}

/** 告警记录列表（定期轮询） */
export function useAlerts(datasetId: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => queryKeys.alerts(toValue(datasetId))),
    queryFn: () => listAlerts(toValue(datasetId)),
    enabled: computed(() => !!toValue(datasetId)),
    refetchInterval: ALERTS_POLL_MS,
  })
}
