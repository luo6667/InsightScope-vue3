<script setup lang="ts">
/**
 * 📘 AnalysisView.vue —— 取代 src/views/AnalysisPage.tsx
 *
 * 批量分析任务控制台：启动 / 暂停 / 恢复 / 取消 / 清空分析结果，展示进度条、失败数与并发数，
 * 并通过 socket 的 `analysis:progress` 事件实时刷新任务查询。
 *
 * React → Vue：useState → ref；useQuery 的 data 在模板里自动解包（脚本内写 .value）；
 * zustand 的 useSettings → Pinia 的 useSettingsStore；socket 回调里按调用时读 datasetId.value，
 * 等价于 React 每次渲染重建回调（切换数据集后 invalidate 的仍是当前 key）。
 * 本页没有原生下拉/分页/弹窗，故不直接使用 Element Plus（数据集下拉由 DatasetPicker 内部承担）。
 */
import { useQueryClient } from '@tanstack/vue-query'
import {
  AlertTriangle,
  BrainCircuit,
  Eraser,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-vue-next'
import { motion } from 'motion-v'
import { computed, ref } from 'vue'

import {
  cancelAnalysis,
  pauseAnalysis,
  resetAnalysis,
  resumeAnalysis,
  startAnalysis,
} from '@/api/api'
import DatasetPicker from '@/components/DatasetPicker.vue'
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui'
import { useCurrentDataset } from '@/composables/useCurrentDataset'
import { useAnalysisJob, useDatasets } from '@/composables/useData'
import { useDatasetSocket } from '@/composables/useDatasetSocket'
import { errMsg } from '@/lib/errors'
import { analysisRunSchema, firstError } from '@/lib/validation'
import { useSettingsStore } from '@/stores/settings'

const jobTone: Record<string, 'neutral' | 'pos' | 'neg' | 'accent'> = {
  pending: 'neutral',
  running: 'accent',
  paused: 'neutral',
  done: 'pos',
  failed: 'neg',
}

const { datasetId, setDatasetId } = useCurrentDataset()
const settings = useSettingsStore()
const qc = useQueryClient()

const { data: datasets } = useDatasets()
const { data: job } = useAnalysisJob(datasetId)

const busy = ref(false)
const error = ref<string | null>(null)

// socket 进度实时推送（datasetId 变化由 useDatasetSocket 内部自动重订阅）
useDatasetSocket(datasetId, {
  'analysis:progress': () => qc.invalidateQueries({ queryKey: ['job', datasetId.value] }),
})

const run = async (fn: () => Promise<unknown>) => {
  busy.value = true
  error.value = null
  try {
    await fn()
    qc.invalidateQueries({ queryKey: ['job', datasetId.value] })
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

const pct = computed(() => {
  const j = job.value
  return j && j.total > 0 ? Math.min(100, Math.round((j.processed / j.total) * 100)) : 0
})
const active = computed(() => {
  const j = job.value
  return !!j && ['running', 'pending', 'paused'].includes(j.status)
})

const jobTitle = computed(() => {
  const j = job.value
  if (!j) return ''
  const label =
    j.status === 'done'
      ? '已完成'
      : j.status === 'failed'
        ? '失败'
        : j.status === 'paused'
          ? '已暂停'
          : '进行中'
  return `分析任务 · ${label}`
})

// 运行前必填校验（与后端 createAnalysisBodySchema 对齐）:设置页允许留空,但分析必须填齐
const start = () => {
  void run(() => {
    const parsed = analysisRunSchema.safeParse({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      temperature: settings.temperature,
    })
    if (!parsed.success) throw new Error(firstError(parsed.error))
    return startAnalysis(datasetId.value, { ...parsed.data, concurrency: 6 })
  })
}

const pause = () => {
  void run(() => pauseAnalysis(datasetId.value))
}

const resume = () => {
  void run(() => resumeAnalysis(datasetId.value))
}

const cancel = () => {
  void run(() => cancelAnalysis(datasetId.value))
}

const clearResults = () => {
  if (confirm('确认清空该数据集的全部分析结果？评论将重置为未分析状态，可重新分析。')) {
    void run(() => resetAnalysis(datasetId.value)).then(() =>
      qc.invalidateQueries({ queryKey: ['stats', datasetId.value] }),
    )
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-8">
    <PageHeader title="智能分析" desc="AI 批量分析评论：情感 / 主题 / 关键词">
      <template #extra>
        <DatasetPicker :datasets="datasets" :dataset-id="datasetId" :on-change="setDatasetId" />
      </template>
    </PageHeader>

    <div v-if="!datasetId" class="mt-8">
      <EmptyState
        title="选择数据集开始分析"
        desc="内置场景已预标注可直接查看，导入数据需配置 API key 后分析"
      >
        <template #icon>
          <BrainCircuit :size="26" :stroke-width="1.6" />
        </template>
      </EmptyState>
    </div>

    <template v-if="datasetId">
      <div class="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" :disabled="busy || !!active" @click="start">
          <Play :size="15" />
          开始分析
        </Button>
        <Button v-if="job?.status === 'running'" variant="outline" @click="pause">
          <Pause :size="14" />
          暂停
        </Button>
        <Button v-if="job?.status === 'paused'" variant="outline" @click="resume">
          <RotateCcw :size="14" />
          恢复
        </Button>
        <Button v-if="active" variant="danger" @click="cancel">
          <Square :size="14" />
          取消
        </Button>
        <Button variant="ghost" :disabled="busy" @click="clearResults">
          <Eraser :size="14" />
          清空分析结果
        </Button>
      </div>

      <div
        v-if="!settings.apiKey"
        class="mt-3 flex items-center gap-2 rounded-lg border border-amber-600/50 bg-amber-100 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/25 dark:text-amber-300"
      >
        <AlertTriangle :size="14" class="shrink-0" />
        尚未配置 API key（内置场景已预标注，无需分析）。到「设置」填入后即可分析导入的数据。
      </div>
      <div v-if="error" class="mt-3 text-xs text-red-400">{{ error }}</div>

      <Card v-if="job" class="mt-5">
        <CardHeader :title="jobTitle">
          <template #icon>
            <BrainCircuit :size="15" />
          </template>
          <template #extra>
            <Badge :tone="jobTone[job.status]">{{ job.status }}</Badge>
          </template>
        </CardHeader>
        <div class="p-5">
          <div class="flex items-center justify-between text-[13px] text-ink-300">
            <span class="tabular-nums">{{ job.processed }} / {{ job.total }} 条</span>
            <span class="tabular-nums">{{ pct }}%</span>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
            <motion.div
              class="h-full rounded-full bg-accent-500"
              :initial="false"
              :animate="{ width: `${pct}%` }"
              :transition="{ duration: 0.4, ease: 'easeOut' }"
            />
          </div>
          <div class="mt-3 flex gap-4 text-xs text-ink-400">
            <span
              >失败 <span class="tabular-nums text-red-400">{{ job.failed }}</span></span
            >
            <span
              >并发 <span class="tabular-nums">{{ job.concurrency }}</span></span
            >
          </div>
        </div>
      </Card>

      <div
        v-if="job?.status === 'done'"
        class="mt-4 rounded-lg border border-emerald-600/50 bg-emerald-100 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/20 dark:text-emerald-300"
      >
        分析完成，去「监控台」查看情感分布 / 主题 / 趋势图表
      </div>
    </template>
  </div>
</template>
