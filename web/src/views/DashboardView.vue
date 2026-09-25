<script setup lang="ts">
/**
 * 📘 DashboardView.vue —— 取代 src/views/DashboardPage.tsx
 *
 * 舆情监控台：useDatasets / useDatasetStats 拉数据 → 四张 ECharts 图表（option 工厂在
 * components/dashboard/options.ts）；useDatasetSocket 订阅评论流入 / 告警 / 模拟器状态并用 ref 增量更新；
 * 渲染拆成 OverviewStats / LiveMonitor / ChartGrid / RecentComments 四个子组件，回调仍是 props（与 React 同名）。
 * 相比 React 版：useState → ref、useEffect(deps) → watch + onCleanup、chartOptions 的 IIFE → computed
 * （承担 React Compiler 的记忆化语义：stats 不变则引用稳定）、query 的 data 是 Ref（脚本 .value / 模板自动解包）。
 */
import { Radar } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import { setSimSpeed, startSimulate, stopSimulate } from '@/api/api'
import type { Alert, CommentRow } from '@/api/types'
import CommentModal from '@/components/CommentModal.vue'
import ChartGrid from '@/components/dashboard/ChartGrid.vue'
import LiveMonitor from '@/components/dashboard/LiveMonitor.vue'
import {
  CHART_PALETTES,
  donutOption,
  topicOption,
  trendOption,
  wordcloudOption,
} from '@/components/dashboard/options'
import OverviewStats from '@/components/dashboard/OverviewStats.vue'
import RecentComments from '@/components/dashboard/RecentComments.vue'
import type { RangeValue } from '@/components/dashboard/types'
import DatasetPicker from '@/components/DatasetPicker.vue'
import { EmptyState, PageHeader } from '@/components/ui'
import { useCurrentDataset } from '@/composables/useCurrentDataset'
import { useComments, useDatasets, useDatasetStats } from '@/composables/useData'
import { useDatasetSocket } from '@/composables/useDatasetSocket'
import { useInvalidateDataset } from '@/composables/useInvalidateDataset'
import { useTheme } from '@/composables/useTheme'
import { customDictKey } from '@/lib/customDict'
import { errMsg } from '@/lib/errors'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * 时间范围口径（E2）：把「本地日历日」的边界转成带时区的 ISO 时刻再发给后端。
 * 原先发 `${date}T00:00:00`（无时区）会被后端按**服务器时区**解析，浏览器与服务器时区不一致时，
 * 「最近 7 天」会整体偏移；这里统一按浏览器本地日边界取绝对时刻（同 TZ 下结果完全一致）。
 */
function localDayStart(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString()
}

function localDayEnd(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString()
}

const invalidate = useInvalidateDataset()
// 当前主题（模块级单例）：图表的调色板依赖它，切换深浅色时自动重算
const { theme } = useTheme()
const { datasetId, setDatasetId } = useCurrentDataset()

const { data: datasets } = useDatasets()
// 自定义词典：加入词云统计（localStorage，设置页配置）
const dictKey = customDictKey()
const dictParam: Record<string, unknown> | undefined = dictKey ? { dictionary: dictKey } : undefined

const { data: stats } = useDatasetStats(datasetId, dictParam)
// 主题钻取：点击主题图后按主题筛选评论
const topicFilter = ref<string | null>(null)
const commentParams = computed<Record<string, unknown>>(() => ({
  limit: 8,
  topic: topicFilter.value ?? undefined,
}))
const { data: commentsRes } = useComments(datasetId, commentParams)

// 时段对比：最近 7 天 vs 前 7 天
const rangeA = ref<RangeValue>({ from: daysAgo(7), to: daysAgo(0) })
const rangeB = ref<RangeValue>({ from: daysAgo(14), to: daysAgo(8) })
const rangeAParams = computed<Record<string, unknown>>(() => ({
  from: localDayStart(rangeA.value.from),
  to: localDayEnd(rangeA.value.to),
  ...dictParam,
}))
const rangeBParams = computed<Record<string, unknown>>(() => ({
  from: localDayStart(rangeB.value.from),
  to: localDayEnd(rangeB.value.to),
  ...dictParam,
}))
const { data: statsA } = useDatasetStats(datasetId, rangeAParams)
const { data: statsB } = useDatasetStats(datasetId, rangeBParams)

// 评论详情弹窗
const selectedComment = ref<CommentRow | null>(null)

// 实时监控状态
const liveComments = ref<CommentRow[]>([])
const alerts = ref<Alert[]>([])
const simRunning = ref(false)
const speed = ref(5)
const simError = ref<string | null>(null)
const inflow = ref(0)
const windowSentiments = ref<CommentRow['sentiment'][]>([])

const windowNegRate = computed(() => {
  const list = windowSentiments.value
  return list.length ? Math.round((list.filter((s) => s === 'neg').length / list.length) * 100) : 0
})

// 切换数据集时重置实时状态 + 停止旧模拟器
// React 的 useEffect(fn, [datasetId]) → watch + onCleanup：immediate 对齐「挂载时也执行一次」，
// onCleanup 在下次触发前与组件卸载时执行，等价于 React effect 的 cleanup。
watch(
  datasetId,
  (id, _prev, onCleanup) => {
    liveComments.value = []
    alerts.value = []
    simRunning.value = false
    inflow.value = 0
    windowSentiments.value = []
    simError.value = null
    topicFilter.value = null
    selectedComment.value = null
    // 切走时停止该数据集的模拟器（重新播放从头开始）；无数据集时跳过空 id 请求
    onCleanup(() => {
      if (!id) return
      void stopSimulate(id).catch(() => {})
    })
  },
  { immediate: true },
)

// socket 订阅：实时评论 / 告警（含浏览器通知）/ 模拟状态
useDatasetSocket(datasetId, {
  'comment:stream': (payload) => {
    const c = payload as CommentRow
    liveComments.value = [c, ...liveComments.value].slice(0, 6)
    inflow.value += 1
    windowSentiments.value = [...windowSentiments.value, c.sentiment].slice(-20)
  },
  'alert:new': (payload) => {
    const a = payload as Alert
    alerts.value = [a, ...alerts.value].slice(0, 3)
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(`舆情告警${a.severity === 'critical' ? '（严重）' : ''}`, {
          body: a.message,
        })
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission()
      }
    }
  },
  'sim:status': (payload) => {
    simRunning.value = (payload as { running: boolean }).running
  },
})

const changeSpeed = async (v: number) => {
  speed.value = v
  if (simRunning.value) {
    try {
      await setSimSpeed(datasetId.value, v)
    } catch {
      /* 忽略 */
    }
  }
}

const toggleSim = async () => {
  simError.value = null
  try {
    if (simRunning.value) {
      await stopSimulate(datasetId.value)
      simRunning.value = false
    } else {
      const r = await startSimulate(datasetId.value, speed.value)
      simRunning.value = true
      speed.value = r.speed
    }
  } catch (e) {
    simError.value = errMsg(e)
  }
}

const current = computed(() => datasets.value?.find((d) => d.id === datasetId.value))

// 图表 option（computed 承担 React Compiler 的记忆化：stats 不变时引用稳定，避免实时流入触发全图重绘）
// 额外依赖 theme：ECharts 画在 canvas 上读不到 CSS 变量，切换深浅色时必须用新调色板重算 option
const chartOptions = computed(() => {
  const s = stats.value
  if (!s) return null
  const palette = CHART_PALETTES[theme.value]
  return {
    donut: donutOption(s, palette),
    trend: trendOption(s, palette),
    topic: topicOption(s, palette),
    wordcloud: wordcloudOption(s, palette),
  }
})

// 子组件回调仍是 props（与 React 契约同名），这里统一包一层，避免在模板里写行内箭头函数
const handleSpeedChange = (v: number) => {
  void changeSpeed(v)
}
const handleToggleSim = () => {
  void toggleSim()
}
const handleDismissAlert = (id: string) => {
  alerts.value = alerts.value.filter((x) => x.id !== id)
}
const handleTopicFilterChange = (t: string | null) => {
  topicFilter.value = t
}
const handleSelectComment = (c: CommentRow) => {
  selectedComment.value = c
}
const handleRangeAChange = (r: RangeValue) => {
  rangeA.value = r
}
const handleRangeBChange = (r: RangeValue) => {
  rangeB.value = r
}
const handleCloseModal = () => {
  selectedComment.value = null
}
const handleSaved = () => {
  invalidate.comments(datasetId.value)
  invalidate.stats(datasetId.value)
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-8">
    <PageHeader title="舆情监控台" desc="情感、主题与实时舆情走势一览">
      <template #extra>
        <DatasetPicker :datasets="datasets" :dataset-id="datasetId" :on-change="setDatasetId" />
      </template>
    </PageHeader>

    <div v-if="!datasetId" class="mt-8">
      <EmptyState
        title="选择数据集开始监控"
        desc="从右上角选择一个数据集，或先到「导入数据」创建内置场景"
      >
        <template #icon><Radar :size="28" :stroke-width="1.6" /></template>
      </EmptyState>
    </div>

    <template v-if="datasetId && current">
      <OverviewStats :stats="stats" :current="current" />
      <LiveMonitor
        :sim-running="simRunning"
        :speed="speed"
        :on-speed-change="handleSpeedChange"
        :on-toggle-sim="handleToggleSim"
        :sim-error="simError"
        :inflow="inflow"
        :window-neg-rate="windowNegRate"
        :alerts="alerts"
        :on-dismiss-alert="handleDismissAlert"
        :live-comments="liveComments"
      />
      <ChartGrid
        :stats="stats"
        :chart-options="chartOptions"
        :topic-filter="topicFilter"
        :on-topic-filter-change="handleTopicFilterChange"
        :range-a="rangeA"
        :range-b="rangeB"
        :on-range-a-change="handleRangeAChange"
        :on-range-b-change="handleRangeBChange"
        :stats-a="statsA"
        :stats-b="statsB"
      />
      <RecentComments
        :comments="commentsRes?.comments"
        :topic-filter="topicFilter"
        :on-topic-filter-change="handleTopicFilterChange"
        :on-select="handleSelectComment"
      />
    </template>

    <!-- 这里刻意不写 :key="selectedComment?.id"：父级换 key 会让 Vue 直接重建整个组件，
         内部的 AnimatePresence 永远拿不到「移除」这一帧，关闭时的淡出动画就会失效。
         表单重置已由 CommentModal 内部 watch(props.comment?.id) 负责（与带 key 的行为一致）。 -->
    <CommentModal
      :dataset-id="datasetId"
      :comment="selectedComment"
      :on-close="handleCloseModal"
      :on-saved="handleSaved"
    />
  </div>
</template>
