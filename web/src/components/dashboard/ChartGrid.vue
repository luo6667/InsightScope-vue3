<script setup lang="ts">
/**
 * 📘 ChartGrid.vue —— 取代 src/components/dashboard/ChartGrid.tsx
 *
 * 图表区：情感分布 / 趋势 / 主题 / 词云四图 + 时段对比；未分析时提示，无数据时骨架屏。
 * React 的 early return → v-if / v-else；className → class；onEvents={{...}} → :on-events。
 * 回调仍是 props（onTopicFilterChange / onRangeAChange / onRangeBChange），与 React 契约同名。
 */
import { Activity, Info, MessageSquareText, Radar, Scale, Tags, X } from 'lucide-vue-next'
import { computed } from 'vue'

import type { DatasetStats } from '@/api/types'
import EChart from '@/components/EChart.vue'
import { Card, CardHeader, Skeleton } from '@/components/ui'
import { useTheme } from '@/composables/useTheme'

import NotAnalyzed from './NotAnalyzed.vue'
import { CHART_PALETTES, compareDonut } from './options'
import RangeField from './RangeField.vue'
import type { ChartOptions, RangeValue } from './types'

const props = defineProps<{
  stats?: DatasetStats
  chartOptions: ChartOptions | null
  topicFilter: string | null
  onTopicFilterChange: (t: string | null) => void
  rangeA: RangeValue
  rangeB: RangeValue
  onRangeAChange: (r: RangeValue) => void
  onRangeBChange: (r: RangeValue) => void
  statsA?: DatasetStats
  statsB?: DatasetStats
}>()

// 时段对比两图的配色也要随主题切换：palette 变化会让模板里的 compareDonut 重新推导 option
const { theme } = useTheme()
const palette = computed(() => CHART_PALETTES[theme.value])

/** 主题条形图点击钻取（等价 TSX 里内联的 onEvents.click） */
const onTopicClick = (p: unknown) => {
  const name = (p as { name?: string })?.name
  if (name) props.onTopicFilterChange?.(name)
}

// 静态事件表：引用恒定，EChart 只会绑一次
const topicEvents = { click: onTopicClick }
</script>

<template>
  <div v-if="!stats || !chartOptions" class="mt-4 grid gap-4 lg:grid-cols-2">
    <Card class="p-4">
      <Skeleton class="h-52 w-full" />
    </Card>
    <Card class="p-4">
      <Skeleton class="h-52 w-full" />
    </Card>
  </div>

  <div v-else class="mt-4">
    <div
      v-if="stats.analyzed === 0"
      class="mb-3 flex items-center gap-2 rounded-lg border border-amber-600/50 bg-amber-100 px-3.5 py-2.5 text-[13px] text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300"
    >
      <Info :size="14" class="shrink-0" />
      该数据集尚未分析（{{ stats.total }} 条评论待处理），去「智能分析」开始后情感 / 趋势 /
      主题将出现数据
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="情感分布">
          <template #icon><Radar :size="15" /></template>
        </CardHeader>
        <div class="p-3">
          <NotAnalyzed v-if="stats.analyzed === 0" h="h-56" />
          <EChart v-else :option="chartOptions.donut" class="h-56" />
        </div>
      </Card>
      <Card>
        <CardHeader title="评论趋势（按天）">
          <template #icon><Activity :size="15" /></template>
        </CardHeader>
        <div class="p-3">
          <NotAnalyzed v-if="stats.analyzed === 0" h="h-56" />
          <EChart v-else :option="chartOptions.trend" class="h-56" />
        </div>
      </Card>
      <Card>
        <CardHeader title="热门主题">
          <template #icon><Tags :size="15" /></template>
          <template v-if="topicFilter" #extra>
            <span class="flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400">
              {{ topicFilter }}
              <button class="hover:text-ink-100" @click="onTopicFilterChange?.(null)">
                <X :size="12" />
              </button>
            </span>
          </template>
        </CardHeader>
        <div class="p-3">
          <NotAnalyzed v-if="stats.analyzed === 0" h="h-52" />
          <EChart v-else :option="chartOptions.topic" class="h-52" :on-events="topicEvents" />
        </div>
      </Card>
      <Card>
        <CardHeader title="关键词云（内容词频）">
          <template #icon><MessageSquareText :size="15" /></template>
        </CardHeader>
        <div class="p-3">
          <EChart :option="chartOptions.wordcloud" class="h-52" />
        </div>
      </Card>
    </div>

    <!-- 时段对比 -->
    <Card class="mt-4">
      <CardHeader title="时段对比">
        <template #icon><Scale :size="15" /></template>
        <template #extra>
          <span class="text-xs text-ink-400">两个时间段的评论情况对比</span>
        </template>
      </CardHeader>
      <div class="p-4">
        <div class="flex flex-wrap items-end gap-4">
          <RangeField label="时段 A" :range="rangeA" :on-change="onRangeAChange" />
          <RangeField label="时段 B" :range="rangeB" :on-change="onRangeBChange" />
        </div>
        <div v-if="statsA && statsB" class="mt-4 grid gap-4 lg:grid-cols-2">
          <div class="rounded-xl border border-ink-800 bg-ink-950 p-3">
            <div class="mb-2 text-xs font-medium text-ink-300">
              {{ rangeA.from }} ~ {{ rangeA.to }}（{{ statsA.total }} 条）
            </div>
            <EChart :option="compareDonut(statsA, palette)" class="h-40" />
          </div>
          <div class="rounded-xl border border-ink-800 bg-ink-950 p-3">
            <div class="mb-2 text-xs font-medium text-ink-300">
              {{ rangeB.from }} ~ {{ rangeB.to }}（{{ statsB.total }} 条）
            </div>
            <EChart :option="compareDonut(statsB, palette)" class="h-40" />
          </div>
        </div>
      </div>
    </Card>
  </div>
</template>
