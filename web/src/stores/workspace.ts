import { defineStore } from 'pinia'

/**
 * 📘 stores/workspace.ts —— 取代旧 store/workspace.ts（zustand + persist）
 *
 * 全局工作区状态：当前数据集（监控台 / 智能分析 / 舆情报告 / 告警中心 四页共享，切换页面保持）。
 * Pinia 对应关系：
 * - zustand 的 `create(() => ({...}))` → `defineStore(id, { state })`；
 * - zustand 的 `set({ datasetId })` → action 里 `this.datasetId = id`；
 * - persist 中间件 → pinia-plugin-persistedstate 的 `persist` 选项。
 *
 * localStorage key 沿用旧值 insight-workspace（见 stores/legacy.ts 里的旧数据迁移）。
 */
export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    datasetId: '',
  }),
  actions: {
    setDatasetId(id: string) {
      this.datasetId = id
    },
  },
  persist: { key: 'insight-workspace' },
})
