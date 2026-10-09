<script setup lang="ts">
/**
 * 📘 CommentsView.vue —— 评论浏览（无限滚动 + 虚拟滚动）
 *
 * 监控台的「最近评论」只按 8 条预览，看不到数据集里上千条评论的全貌，
 * 也没有搜索与筛选入口。这一页补齐「评论检索」这条链路，重点是**大数据量下的渲染与请求策略**：
 *
 * - 数据侧：useInfiniteComments（useInfiniteQuery）按页累积，触底自动取下一页；
 * - 渲染侧：虚拟滚动只渲染可视区的那十几项，DOM 节点数与总条数解耦；
 * - 请求侧：搜索 400ms 防抖后**把条件下推服务端**（复用后端既有的 q / sentiment / page / limit 契约），
 *   而不是把上千条拉到前端再过滤；筛选条件进 queryKey、页码进 pageParam，
 *   所以改条件时不需要手动 reset 分页，缓存也从第一页重新累积。
 *
 * 页面顶部显示「已加载 N / 共 M 条」与分页请求状态。
 */
import { useQueryClient } from '@tanstack/vue-query'
import { Loader2, MessageSquare, Search, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { CommentRow, Sentiment } from '@/api/types'
import CommentModal from '@/components/CommentModal.vue'
import DatasetPicker from '@/components/DatasetPicker.vue'
import VirtualList from '@/components/VirtualList.vue'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui'
import { SENTIMENT } from '@/components/dashboard/options'
import { useCurrentDataset } from '@/composables/useCurrentDataset'
import { useDatasets, useInfiniteComments } from '@/composables/useData'
import { useInvalidateDataset } from '@/composables/useInvalidateDataset'
import {
  COMMENTS_PAGE_SIZE,
  COMMENTS_PRELOAD_AHEAD,
  COMMENTS_SEARCH_DEBOUNCE_MS,
} from '@/lib/constants'
import { formatTime } from '@/lib/format'

/** 单条评论行的固定高度（虚拟滚动需要预先知道高度才能算总高与滚动位置） */
const ROW_HEIGHT = 104
/** 视口高度：随窗口自适应，最少 320px、最多 720px（移动端也留出页面滚动空间） */
const VIEWPORT_HEIGHT = 640

const { datasetId, setDatasetId } = useCurrentDataset()
const invalidate = useInvalidateDataset()
const queryClient = useQueryClient()

const { data: datasets } = useDatasets()

const searchInput = ref('')
const keyword = ref('')
const sentiment = ref<'' | Sentiment>('')

// 搜索防抖：输入停顿 COMMENTS_SEARCH_DEBOUNCE_MS 后才更新 keyword（keyword 决定 queryKey）
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (v) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    keyword.value = v.trim()
  }, COMMENTS_SEARCH_DEBOUNCE_MS)
})
onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

// 筛选条件：作为「下推到服务端的参数」传给后端（q / sentiment）
const filters = computed<Record<string, unknown>>(() => {
  const f: Record<string, unknown> = {}
  if (keyword.value) f.q = keyword.value
  if (sentiment.value) f.sentiment = sentiment.value
  return f
})

const {
  data,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  error,
} = useInfiniteComments(datasetId, filters, COMMENTS_PAGE_SIZE)

/** 所有已加载页拍平成一个数组（虚拟滚动与列表渲染都基于它） */
const comments = computed<CommentRow[]>(
  () => data.value?.pages.flatMap((p) => p.comments) ?? [],
)
const total = computed(() => data.value?.pages[0]?.total ?? 0)

const listRef = ref<{ scrollToTop: () => void } | null>(null)
/** 当前渲染窗口的最后一条下标（由 VirtualList 的 range 事件回报） */
const lastEndIndex = ref(0)

const loadMore = () => {
  if (hasNextPage.value && !isFetchingNextPage.value) void fetchNextPage()
}

/**
 * 触底预加载的判定：**不用 IntersectionObserver**。
 * 观察器只在相交状态发生变化时回调，而这里的预取判据是「渲染窗口逼近已加载尾部」，
 * 两者不是一回事 —— 早先那版因为哨兵元素要等数据集就绪才渲染，
 * observer.observe() 在挂载时拿到的是 null、之后又没人补挂，预取就永久停在了第二页。
 *
 * 现在直接依赖四个响应式事实：渲染窗口右端（VirtualList 的 range 事件）、
 * 已加载条数（分页结果是新引用，每页到达都会变）、是否还有下一页、本页是否正在请求。
 * 任何一项变化都会重新评估，所以「滚到底 → 请求 → 新页到达 → 继续滚」能一路续下去，
 * 而 hasNextPage 变 false 时自动短路。
 */
watch(
  [lastEndIndex, () => comments.value.length, hasNextPage, isFetchingNextPage],
  () => {
    const loaded = comments.value.length
    if (loaded === 0) return
    if (lastEndIndex.value >= loaded - COMMENTS_PRELOAD_AHEAD) loadMore()
  },
  { immediate: true },
)

// 筛选条件变化 → 缓存会从第一页重新累积，同时把滚动位置收回顶部
watch([keyword, sentiment, datasetId], () => {
  lastEndIndex.value = 0
  listRef.value?.scrollToTop()
})

const selected = ref<CommentRow | null>(null)
const handleSelect = (c: CommentRow) => {
  selected.value = c
}

/** 手动修正情感/主题后：失效该数据集的评论缓存（commentsAll 前缀同时覆盖无限列表的分页缓存） */
const handleSaved = () => {
  invalidate.comments(datasetId.value)
  invalidate.stats(datasetId.value)
  // 无限查询的每一页都挂在同一个 key 下，invalidate 后会自动重新拉取第一页
  void queryClient.invalidateQueries({ queryKey: ['comments', datasetId.value] })
}

const clearFilters = () => {
  searchInput.value = ''
  keyword.value = ''
  sentiment.value = ''
}
const hasFilter = computed(() => !!keyword.value || !!sentiment.value)
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <PageHeader title="评论浏览" desc="千条级评论的检索与浏览：无限滚动加载 + 虚拟滚动渲染">
      <template #extra>
        <DatasetPicker
          :datasets="datasets"
          :dataset-id="datasetId"
          :on-change="setDatasetId"
          :show-count="false"
        />
      </template>
    </PageHeader>

    <div v-if="!datasetId" class="mt-8">
      <EmptyState title="选择数据集浏览评论" desc="从右上角选择数据集，或先到「导入数据」创建内置场景">
        <template #icon><MessageSquare :size="26" :stroke-width="1.6" /></template>
      </EmptyState>
    </div>

    <template v-else>
      <!-- 检索条件：关键词下推服务端（LIKE 搜索），情感走后端 sentiment 过滤 -->
      <div class="mt-5 flex flex-wrap items-center gap-2">
        <div class="relative min-w-[220px] flex-1">
          <Search
            :size="15"
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <Input
            v-model="searchInput"
            placeholder="搜索评论内容，如 闪退、客服…"
            class="pl-9 pr-9"
          />
          <button
            v-if="searchInput"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-500 transition-colors hover:text-ink-200"
            @click="searchInput = ''"
          >
            <X :size="14" />
          </button>
        </div>
        <div class="w-36 shrink-0">
          <Select v-model="sentiment">
            <option value="">全部情感</option>
            <option v-for="(v, k) in SENTIMENT" :key="k" :value="k">{{ v.label }}</option>
          </Select>
        </div>
        <Button v-if="hasFilter" variant="ghost" size="sm" @click="clearFilters">
          <X :size="13" />
          清除筛选
        </Button>
      </div>

      <div class="mt-3 flex items-center gap-3 text-xs text-ink-400">
        <span>
          已加载
          <span class="tabular-nums text-ink-100">{{ comments.length }}</span>
          / 共 <span class="tabular-nums text-ink-100">{{ total }}</span> 条
        </span>
        <span
          v-if="isFetchingNextPage"
          class="flex items-center gap-1.5 text-accent-600 dark:text-accent-400"
        >
          <Loader2 :size="13" class="animate-spin" />
          正在加载下一页…
        </span>
        <span v-else-if="!hasNextPage && comments.length > 0" class="text-ink-500">
          已到底部
        </span>
      </div>

      <Card class="mt-3 overflow-hidden">
        <!-- 首屏骨架：条数与可视区能容纳的行数相当，避免加载完成时高度突跳 -->
        <div v-if="isLoading" class="divide-y divide-ink-800">
          <div v-for="i in 6" :key="i" class="flex items-start gap-3 px-4 py-4">
            <Skeleton class="mt-1.5 h-1.5 w-1.5 rounded-full" />
            <div class="min-w-0 flex-1 space-y-2">
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-3 w-1/3" />
            </div>
          </div>
        </div>

        <div v-else-if="error" class="px-4 py-10 text-center text-sm text-red-600 dark:text-red-400">
          评论加载失败：{{ (error as Error).message }}
        </div>

        <EmptyState
          v-else-if="comments.length === 0"
          title="没有匹配的评论"
          desc="换个关键词或清空筛选条件试试"
        />

        <!-- 虚拟滚动列表：只有可视区的十几项存在于 DOM 里 -->
        <VirtualList
          v-else
          ref="listRef"
          :items="comments"
          :item-height="ROW_HEIGHT"
          :height="VIEWPORT_HEIGHT"
          @select="handleSelect"
          @range="(r) => (lastEndIndex = r.end)"
        >
          <template #default="{ item }">
            <!-- 点击由 VirtualList 的 @select 统一派发，所以这里不再挂 click（避免触发两次） -->
            <button
              class="flex h-full w-full items-start gap-3 overflow-hidden border-b border-ink-800 px-4 py-3.5 text-left transition-colors hover:bg-ink-850"
            >
              <span
                class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                :class="SENTIMENT[(item as CommentRow).sentiment].dot"
              />
              <div class="min-w-0 flex-1">
                <div class="line-clamp-2 text-[13px] leading-snug text-ink-100">
                  {{ (item as CommentRow).content }}
                </div>
                <div class="mt-1 flex items-center gap-2 text-xs text-ink-400">
                  <span class="truncate">{{ (item as CommentRow).author }}</span>
                  <span>·</span>
                  <span class="truncate">{{ (item as CommentRow).platform }}</span>
                  <span class="ml-auto shrink-0 tabular-nums">
                    {{ formatTime((item as CommentRow).timestamp) }}
                  </span>
                </div>
                <div
                  v-if="(item as CommentRow).topics.length > 0"
                  class="mt-1 flex flex-wrap gap-1"
                >
                  <Badge v-for="t in (item as CommentRow).topics.slice(0, 4)" :key="t">
                    {{ t }}
                  </Badge>
                </div>
              </div>
            </button>
          </template>
        </VirtualList>

        <!-- 底部状态行：预取进行中给一条骨架，避免用户以为已经到底 -->
        <div
          v-if="isFetchingNextPage"
          class="flex items-center justify-center gap-2 border-t border-ink-800 py-3 text-xs text-ink-400"
        >
          <Loader2 :size="13" class="animate-spin" />
          正在加载下一页…
        </div>
      </Card>
    </template>

    <CommentModal
      :dataset-id="datasetId"
      :comment="selected"
      :on-close="() => (selected = null)"
      :on-saved="handleSaved"
    />
  </div>
</template>
