<script setup lang="ts">
/**
 * 📘 LiveMonitor.vue —— 取代 src/components/dashboard/LiveMonitor.tsx
 *
 * 实时监控卡：模拟器控制 + 流入指标 + 告警横幅 + 实时评论流。
 * motion/react → motion-v（motion.div / AnimatePresence 同名同 props）；
 * Select 的受控写法改成 v-model + 可写 computed，回调仍是 props（onSpeedChange 等）。
 */
import { Activity, Bell, Pause, Play, X } from 'lucide-vue-next'
import { AnimatePresence, motion } from 'motion-v'
import { computed } from 'vue'

import type { Alert, CommentRow } from '@/api/types'
import { Badge, Button, Card, CardHeader, Select } from '@/components/ui'

import { SENTIMENT } from './options'

const props = defineProps<{
  simRunning: boolean
  speed: number
  onSpeedChange: (v: number) => void
  onToggleSim: () => void
  simError: string | null
  inflow: number
  windowNegRate: number
  alerts: Alert[]
  onDismissAlert: (id: string) => void
  liveComments: CommentRow[]
}>()

/** Select 走 v-model：把 speed + onSpeedChange 包成可写计算属性（等价 React 的受控 select） */
const speedModel = computed<string | number | undefined>({
  get: () => props.speed,
  set: (v) => props.onSpeedChange?.(Number(v)),
})
</script>

<template>
  <Card class="mt-4">
    <CardHeader title="实时监控">
      <template #icon><Activity :size="15" /></template>
    </CardHeader>
    <div class="p-4">
      <div class="flex flex-wrap items-center gap-2">
        <Select v-model="speedModel" class="h-8 w-28 text-xs">
          <option value="1">1x 慢速</option>
          <option value="5">5x 正常</option>
          <option value="10">10x 加速</option>
          <option value="20">20x 极速</option>
        </Select>
        <Button :variant="simRunning ? 'danger' : 'primary'" size="sm" @click="onToggleSim?.()">
          <Pause v-if="simRunning" :size="13" />
          <Play v-else :size="13" />
          {{ simRunning ? '停止' : '播放' }}
        </Button>
        <span class="flex items-center gap-1.5 text-[13px] text-ink-400">
          <span v-if="simRunning" class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          <span v-else class="h-1.5 w-1.5 rounded-full bg-ink-500" />
          {{ simRunning ? '评论实时流入中' : '待机，点击播放开始' }}
        </span>
      </div>

      <div class="mt-3 grid grid-cols-3 gap-2">
        <div class="rounded-lg border border-ink-800 bg-ink-950 px-3 py-2">
          <div class="text-xs font-medium uppercase tracking-wider text-ink-400">已流入</div>
          <div class="mt-0.5 text-lg font-semibold tabular-nums text-ink-100">{{ inflow }}</div>
        </div>
        <div class="rounded-lg border border-ink-800 bg-ink-950 px-3 py-2">
          <div class="text-xs font-medium uppercase tracking-wider text-ink-400">窗口负面率</div>
          <div
            class="mt-0.5 text-lg font-semibold tabular-nums"
            :class="
              windowNegRate > 40
                ? 'text-red-600 dark:text-red-400'
                : windowNegRate > 20
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
            "
          >
            {{ windowNegRate }}%
          </div>
        </div>
        <div class="rounded-lg border border-ink-800 bg-ink-950 px-3 py-2">
          <div class="text-xs font-medium uppercase tracking-wider text-ink-400">告警</div>
          <div
            class="mt-0.5 text-lg font-semibold tabular-nums"
            :class="alerts.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-ink-100'"
          >
            {{ alerts.length }}
          </div>
        </div>
      </div>

      <div v-if="simError" class="mb-3 mt-3 text-xs text-red-600 dark:text-red-400">
        {{ simError }}
      </div>

      <AnimatePresence>
        <motion.div
          v-for="a in alerts"
          :key="a.id"
          :initial="{ opacity: 0, y: -10, scale: 0.98 }"
          :animate="{ opacity: 1, y: 0, scale: 1 }"
          :exit="{ opacity: 0, height: 0, marginTop: 0 }"
          :transition="{ duration: 0.25 }"
          class="mb-2 flex items-start gap-2.5 overflow-hidden rounded-lg border px-3.5 py-2.5"
          :class="
            a.severity === 'critical'
              ? 'border-red-300 bg-red-50 dark:border-red-800/60 dark:bg-red-950/40'
              : 'border-amber-300 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30'
          "
        >
          <Bell
            :size="15"
            class="mt-0.5 shrink-0"
            :class="
              a.severity === 'critical'
                ? 'text-red-500 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400'
            "
          />
          <span
            class="flex-1 text-[13px] leading-snug"
            :class="
              a.severity === 'critical'
                ? 'text-red-800 dark:text-red-200'
                : 'text-amber-800 dark:text-amber-200'
            "
          >
            {{ a.message }}
          </span>
          <button
            class="shrink-0 text-ink-400 transition-colors hover:text-ink-200"
            @click="onDismissAlert?.(a.id)"
          >
            <X :size="14" />
          </button>
        </motion.div>
      </AnimatePresence>

      <div class="mt-3 h-56 overflow-hidden">
        <div
          v-if="liveComments.length === 0 && !simRunning"
          class="flex h-full items-center justify-center text-[13px] text-ink-400"
        >
          点击「播放」后，评论将按时间轴实时流入
        </div>
        <AnimatePresence :initial="false">
          <motion.div
            v-for="c in liveComments"
            :key="c.id"
            :layout="true"
            :initial="{ opacity: 0, y: -10, height: 0 }"
            :animate="{ opacity: 1, y: 0, height: 'auto' }"
            :exit="{ opacity: 0, y: -6, height: 0, marginTop: 0 }"
            :transition="{ duration: 0.2 }"
            class="mb-1.5 flex items-start gap-2.5 overflow-hidden rounded-lg border border-ink-800 bg-ink-950 px-3 py-2"
          >
            <span
              class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              :class="SENTIMENT[c.sentiment].dot"
            />
            <div class="min-w-0 flex-1">
              <div class="text-[13px] leading-snug text-ink-100">{{ c.content }}</div>
              <div class="mt-0.5 text-xs text-ink-400">{{ c.author }} · {{ c.platform }}</div>
            </div>
            <Badge :tone="c.sentiment">{{ SENTIMENT[c.sentiment].label }}</Badge>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  </Card>
</template>
