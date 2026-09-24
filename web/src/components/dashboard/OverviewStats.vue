<script setup lang="ts">
/**
 * 📘 OverviewStats.vue —— 取代 src/components/dashboard/OverviewStats.tsx
 *
 * 概览统计卡：评论总数 / 已分析 / 正负面占比；数据未就绪时显示骨架屏。
 * React 的 early return 拆成 v-if / v-else，文案与 Tailwind class 逐字保留。
 */
import type { DatasetInfo, DatasetStats } from '@/api/types'
import { Card, Skeleton, StatCard } from '@/components/ui'

import { pct } from './options'

defineProps<{ stats?: DatasetStats; current?: DatasetInfo }>()
</script>

<template>
  <div v-if="!stats || !current" class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
    <Card v-for="i in 4" :key="i" class="p-4">
      <Skeleton class="h-3 w-1/2" />
      <Skeleton class="mt-2 h-7 w-2/3" />
    </Card>
  </div>

  <div v-else class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
    <StatCard label="评论总数" :value="stats.total" :sub="current.platform" />
    <StatCard
      label="已分析"
      :value="stats.analyzed"
      :sub="`${stats.total ? Math.round((stats.analyzed / stats.total) * 100) : 0}% 覆盖率`"
    />
    <StatCard
      label="正面占比"
      :value="pct(stats, 'pos')"
      :sub="`${stats.sentiment.pos} 条`"
      accent-cls="text-emerald-400"
    />
    <StatCard
      label="负面占比"
      :value="pct(stats, 'neg')"
      :sub="`${stats.sentiment.neg} 条`"
      accent-cls="text-red-400"
    />
  </div>
</template>
