import type { ComputedRef } from 'vue'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useWorkspaceStore } from '@/stores/workspace'

/**
 * 📘 composables/useCurrentDataset.ts —— 取代旧 hooks/useCurrentDataset.ts
 *
 * 统一的「当前数据集」选择状态：
 * - URL `?dataset=` 优先（从数据集页跳转带参）；
 * - 否则用全局 store（跨页面保持）；
 * - 选择器变更时同步 URL + store（保留其他查询参数）。
 *
 * Vue 版对应关系：useSearchParams() → route.query，useRouter() → vue-router，
 * router.replace(...) 的 `{ scroll: false }` 由 router/index.ts 的 scrollBehavior
 * （to.path === from.path 时不滚动）统一处理。
 */
export function useCurrentDataset(): {
  datasetId: ComputedRef<string>
  setDatasetId: (id: string) => void
} {
  const route = useRoute()
  const router = useRouter()
  const store = useWorkspaceStore()

  const urlDs = computed(() => {
    const raw = route.query.dataset
    return typeof raw === 'string' ? raw : ''
  })

  // URL 带参（跳转）时同步进 store
  watch(
    urlDs,
    (value) => {
      if (value && value !== store.datasetId) store.setDatasetId(value)
    },
    { immediate: true },
  )

  const datasetId = computed(() => urlDs.value || store.datasetId)

  const setDatasetId = (id: string) => {
    store.setDatasetId(id)
    // 同步 URL ?dataset=（保留其他查询参数）
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(route.query)) {
      if (typeof value === 'string') next[key] = value
    }
    if (id) next.dataset = id
    else delete next.dataset
    void router.replace({ query: next })
  }

  return { datasetId, setDatasetId }
}
