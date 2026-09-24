<script setup lang="ts">
/**
 * 📘 DatasetsView.vue —— 取代 src/views/DatasetsPage.tsx
 *
 * 数据集列表页：卡片列表 + 定时抓取的启停/立即抓取 + 导出 CSV + 跳转监控台/分析 + 删除。
 * 相比 React 版：next/link 的 <Link> → 全局注册的 <RouterLink>；React Query 的
 * data/isLoading/error 变成 ref（模板自动解包）；useMutation 语义不变（mutate）；
 * 两处原生 title 提示气泡改为 Element Plus 的 <el-tooltip>，其余文案与 Tailwind 逐字保留。
 */
import { useMutation } from '@tanstack/vue-query'
import {
  AlertTriangle,
  ArrowRight,
  Database,
  Download,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'

import { deleteDataset, exportComments, pullFeedNow, startFeedPull, stopFeedPull } from '@/api/api'
import type { DatasetInfo } from '@/api/types'
import { Badge, Button, Card, CardSkeleton, EmptyState, PageHeader } from '@/components/ui'
import { useDatasets } from '@/composables/useData'
import { useInvalidateDataset } from '@/composables/useInvalidateDataset'
import { errMsg } from '@/lib/errors'

const typeLabel: Record<string, string> = {
  builtin: '内置场景',
  imported: '导入数据',
  feed: '定时抓取',
}

const invalidate = useInvalidateDataset()
const { data: datasets, isLoading, error } = useDatasets(8000)
const actionError = ref<string | null>(null)

const queryError = computed(() => (error.value ? errMsg(error.value) : ''))

const del = useMutation({
  mutationFn: deleteDataset,
  onSuccess: () => {
    invalidate.datasets()
    toast.success('数据集已删除')
  },
  onError: (e) => {
    actionError.value = `删除失败：${errMsg(e)}`
  },
})
const feedStart = useMutation({
  mutationFn: startFeedPull,
  onSuccess: () => invalidate.datasets(),
  onError: (e) => {
    actionError.value = `启动抓取失败：${errMsg(e)}`
  },
})
const feedStop = useMutation({
  mutationFn: stopFeedPull,
  onSuccess: () => invalidate.datasets(),
  onError: (e) => {
    actionError.value = `停止抓取失败：${errMsg(e)}`
  },
})
const feedPull = useMutation({
  mutationFn: pullFeedNow,
  onSuccess: (r) => {
    invalidate.datasets()
    // 后端带锁：定时抓取正在跑时手动点击会被跳过（skipped），此时弹「新增 0 条」的成功提示是误导
    if (r.skipped) toast.info('已有抓取任务正在进行，本次未重复抓取')
    else if (r.count === 0) toast.info('抓取完成，没有新增评论')
    else toast.success(`抓取完成，新增 ${r.count} 条评论`)
  },
  onError: (e) => {
    actionError.value = `抓取失败：${errMsg(e)}`
  },
})

/** React 版里是内联的 onClick 闭包；Vue 模板取不到全局 confirm，抽成函数（文案不变） */
const confirmDelete = (d: DatasetInfo) => {
  if (confirm(`确认删除「${d.name}」及其评论？`)) del.mutate(d.id)
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-8">
    <PageHeader title="数据集" desc="评论数据源，选择后进入监控台与分析">
      <template #extra>
        <RouterLink to="/import">
          <Button variant="primary">
            <Plus :size="15" />
            导入数据
          </Button>
        </RouterLink>
      </template>
    </PageHeader>

    <div class="mt-6 space-y-2.5">
      <CardSkeleton v-if="isLoading" :rows="3" />
      <div
        v-if="error"
        class="rounded-lg border border-red-600/40 bg-red-100 px-4 py-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
      >
        {{ queryError }}
      </div>
      <div
        v-if="actionError"
        class="rounded-lg border border-red-600/40 bg-red-100 px-4 py-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
      >
        {{ actionError }}
        <button class="ml-2 underline" @click="actionError = null">关闭</button>
      </div>

      <EmptyState
        v-if="datasets && datasets.length === 0"
        title="还没有数据集"
        desc="导入内置场景 / 粘贴评论 / CSV 文件 / URL 定时抓取，四种方式任选"
      >
        <template #icon>
          <Database :size="26" :stroke-width="1.6" />
        </template>
        <template #action>
          <RouterLink to="/import">
            <Button variant="primary">
              <Plus :size="15" />
              去导入
            </Button>
          </RouterLink>
        </template>
      </EmptyState>

      <Card v-for="d in datasets || []" :key="d.id" hover class="flex items-center gap-4 px-4 py-3">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-accent-600 dark:text-accent-400"
        >
          <Database :size="16" :stroke-width="2" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium text-ink-100">{{ d.name }}</span>
            <Badge :tone="d.type === 'builtin' ? 'accent' : d.type === 'feed' ? 'pos' : 'neutral'">
              {{ typeLabel[d.type] }}
            </Badge>
            <span
              v-if="d.type === 'feed' && d.feedRunning"
              class="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
            >
              <span class="relative flex h-2 w-2">
                <span
                  class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60"
                />
                <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              运行中
            </span>
          </div>
          <div class="mt-0.5 text-[13px] text-ink-400">
            <span class="tabular-nums">{{ d.commentCount }}</span> 条评论 · 已分析
            <span class="tabular-nums">{{ d.analyzedCount }}</span>
            <template v-if="d.type === 'feed' && d.feedLastAt">
              · 最近抓取
              <span class="tabular-nums text-ink-200">{{ d.feedLastCount }}</span> 条（{{
                new Date(d.feedLastAt).toLocaleTimeString('zh-CN')
              }}）
            </template>
            <div
              v-if="d.type === 'feed' && d.feedLastError"
              class="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
            >
              <AlertTriangle :size="11" />
              抓取失败：{{ d.feedLastError }}
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <template v-if="d.type === 'feed'">
            <Button v-if="d.feedRunning" size="sm" variant="ghost" @click="feedStop.mutate(d.id)">
              <Pause :size="12" />
              停止
            </Button>
            <Button v-else size="sm" variant="ghost" @click="feedStart.mutate(d.id)">
              <Play :size="12" />
              启动
            </Button>
            <el-tooltip content="立即抓取一次" placement="top">
              <Button size="sm" variant="ghost" @click="feedPull.mutate(d.id)">
                <RefreshCw :size="12" />
              </Button>
            </el-tooltip>
          </template>
          <el-tooltip content="导出 CSV" placement="top">
            <Button size="sm" variant="ghost" @click="exportComments(d.id, 'csv')">
              <Download :size="12" />
            </Button>
          </el-tooltip>
          <RouterLink :to="`/dashboard?dataset=${d.id}`">
            <Button size="sm">
              监控台
              <ArrowRight :size="13" />
            </Button>
          </RouterLink>
          <RouterLink :to="`/analysis?dataset=${d.id}`">
            <Button size="sm">分析</Button>
          </RouterLink>
          <Button size="sm" variant="ghost" @click="confirmDelete(d)">
            <Trash2 :size="13" class="text-ink-400 hover:text-red-600 dark:hover:text-red-400" />
          </Button>
        </div>
      </Card>
    </div>
  </div>
</template>
