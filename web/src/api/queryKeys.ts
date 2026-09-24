/**
 * 📘 api/queryKeys.ts —— vue-query 的 queryKey 单一来源
 *
 * 之前各视图手写 `['stats', datasetId.value]` 之类的字面量（13 处 invalidate + useData 里的定义），
 * 拼错不会报错、只会静默失效。这里集中定义：
 * - `xxxAll(id)` 是**前缀键**，用于 invalidateQueries（vue-query 按前缀匹配，能一次失效该数据集的所有分页/筛选组合）；
 * - `stats/comments` 是**具体键**，用于 useQuery（带 params 的 JSON）。
 * 键结构与 React 版逐一对应，缓存语义不变。
 */
export const queryKeys = {
  /** 数据集列表 */
  datasets: () => ['datasets'] as const,

  /** 某数据集统计的缓存键前缀（失效用） */
  statsAll: (datasetId: string) => ['stats', datasetId] as const,
  /** 某数据集统计的具体缓存键（查询用；params 参与 key） */
  stats: (datasetId: string, params?: Record<string, unknown>) =>
    ['stats', datasetId, JSON.stringify(params ?? {})] as const,

  /** 某数据集评论列表的缓存键前缀（失效用） */
  commentsAll: (datasetId: string) => ['comments', datasetId] as const,
  /** 某数据集评论列表的具体缓存键（查询用；params 参与 key） */
  comments: (datasetId: string, params?: Record<string, unknown>) =>
    ['comments', datasetId, JSON.stringify(params ?? {})] as const,

  /** 最新分析任务 */
  job: (datasetId: string) => ['job', datasetId] as const,
  /** 告警规则列表 */
  rules: (datasetId: string) => ['rules', datasetId] as const,
  /** 告警记录列表 */
  alerts: (datasetId: string) => ['alerts', datasetId] as const,
}
