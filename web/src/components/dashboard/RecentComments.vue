<script setup lang="ts">
/**
 * 📘 RecentComments.vue —— 取代 src/components/dashboard/RecentComments.tsx
 *
 * 最近评论列表：可点击查看详情，主题钻取时展示筛选结果与清除按钮。
 * comments?.map → v-for（comments 为 undefined 时自然不渲染）；
 * 回调仍是 props（onTopicFilterChange / onSelect），与原 TSX 同名。
 */
import { Gauge } from 'lucide-vue-next'

import type { CommentRow } from '@/api/types'
import { Button, Card, CardHeader } from '@/components/ui'
import { formatTime } from '@/lib/format'

import { SENTIMENT } from './options'

defineProps<{
  comments?: CommentRow[]
  topicFilter: string | null
  onTopicFilterChange: (t: string | null) => void
  onSelect: (c: CommentRow) => void
}>()
</script>

<template>
  <Card class="mt-4">
    <CardHeader :title="topicFilter ? `「${topicFilter}」相关评论` : '最近评论'">
      <template #icon><Gauge :size="15" /></template>
      <template v-if="topicFilter" #extra>
        <Button size="sm" variant="ghost" @click="onTopicFilterChange?.(null)">清除筛选</Button>
      </template>
    </CardHeader>
    <div class="divide-y divide-ink-800">
      <button
        v-for="c in comments"
        :key="c.id"
        class="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-850"
        @click="onSelect?.(c)"
      >
        <span
          class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
          :class="SENTIMENT[c.sentiment].dot"
        />
        <div class="min-w-0 flex-1">
          <div class="text-[13px] text-ink-100">{{ c.content }}</div>
          <div class="mt-0.5 flex items-center gap-2 text-xs text-ink-400">
            <span>{{ c.author }}</span>
            <span>·</span>
            <span>{{ c.platform }}</span>
            <span class="ml-auto tabular-nums">{{ formatTime(c.timestamp) }}</span>
          </div>
          <div v-if="c.topics.length > 0" class="mt-1 flex flex-wrap gap-1">
            <span
              v-for="t in c.topics"
              :key="t"
              class="cursor-pointer rounded-md bg-ink-800 px-1.5 py-0.5 text-xs text-ink-300 hover:bg-ink-700"
            >
              {{ t }}
            </span>
          </div>
        </div>
      </button>
    </div>
  </Card>
</template>
