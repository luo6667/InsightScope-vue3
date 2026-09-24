import { useQueryClient } from '@tanstack/vue-query'

import { queryKeys } from '@/api/queryKeys'

/**
 * 📘 composables/useInvalidateDataset.ts —— 数据集相关缓存失效的统一入口
 *
 * 取代各视图里手写的 `qc.invalidateQueries({ queryKey: ['stats', datasetId.value] })`：
 * key 由 api/queryKeys.ts 统一提供，改 key 结构时不会漏掉某个调用点。
 * 方法名对应「要刷新的数据」，语义与原先的手写调用完全一致。
 */
export function useInvalidateDataset() {
  const qc = useQueryClient()
  const invalidate = (queryKey: readonly unknown[]) => void qc.invalidateQueries({ queryKey })

  return {
    /** 数据集列表（新建 / 删除 / 导入 / 抓取后） */
    datasets: () => invalidate(queryKeys.datasets()),
    /** 某数据集的聚合统计（评论被修正、分析完成后） */
    stats: (datasetId: string) => invalidate(queryKeys.statsAll(datasetId)),
    /** 某数据集的评论列表（所有分页 / 筛选组合） */
    comments: (datasetId: string) => invalidate(queryKeys.commentsAll(datasetId)),
    /** 最新分析任务 */
    job: (datasetId: string) => invalidate(queryKeys.job(datasetId)),
    /** 告警规则 */
    rules: (datasetId: string) => invalidate(queryKeys.rules(datasetId)),
    /** 告警记录 */
    alerts: (datasetId: string) => invalidate(queryKeys.alerts(datasetId)),
    /** 口令变化后刷新全部已缓存查询（AccessGate 用） */
    all: () => void qc.invalidateQueries(),
  }
}
