<script setup lang="ts">
/**
 * 📘 ReportsView.vue —— 取代 src/views/ReportsPage.tsx
 *
 * 舆情报告页：AI 基于统计数据流式生成五段式周报，按数据集隔离保存历史（localStorage）。
 * 相比 React 版的差异：
 * - `useSettings()`（zustand）→ `useSettingsStore()`（Pinia）；
 * - `useState` → `ref`，`useRef`（AbortController / 生成代数）→ `shallowRef` / `ref`；
 * - `useEffect(..., [datasetId])` → `watch(datasetId, ..., { immediate: true })`（React 首渲染也会跑，
 *   所以补 `immediate`）；卸载终止流 → `onUnmounted`；
 * - 自动存历史 effect（依赖 report/generating/datasetId）→ `watch([...])`，不再需要 useRef 冻结
 *   datasets 引用：Vue 里 `datasets` 是稳定的 ref，读取它不会给 watch 增加依赖；
 * - `{data: datasets}` 直接解构 vue-query 的 ref，`stats.value` 在模板里自动解包。
 */
import { Clock, FileDown, FileText, Loader2, Trash2, Wand2 } from 'lucide-vue-next'
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { toast } from 'vue-sonner'

import type { DatasetStats } from '@/api/types'
import DatasetPicker from '@/components/DatasetPicker.vue'
import { Button, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui'
import { useCurrentDataset } from '@/composables/useCurrentDataset'
import { useDatasets, useDatasetStats } from '@/composables/useData'
import { streamChat } from '@/lib/ai'
import { REPORT_HISTORY_KEY, REPORT_HISTORY_MAX } from '@/lib/constants'
import { downloadText } from '@/lib/download'
import { errMsg } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { readJson, writeJson } from '@/lib/storage'
import { useSettingsStore } from '@/stores/settings'

const REPORT_SYSTEM = `你是舆情分析专家。基于用户提供的评论统计数据，用中文 Markdown 输出一份「舆情周报」，结构：
# 舆情周报
## 一、总体态势（2-3 句话概述）
## 二、情感分析（正面/中性/负面占比 + 解读）
## 三、热点主题（top 主题及原因推测）
## 四、风险与负面问题（重点列负面主题/高发问题）
## 五、改进建议（3-5 条可执行建议）
要求：数据必须来自给定统计，禁止编造数字；语言简洁专业；用 Markdown 标题与列表。`

interface SavedReport {
  id: string
  datasetId: string
  datasetName: string
  createdAt: string
  content: string
}

function loadHistory(): SavedReport[] {
  return readJson<SavedReport[]>(REPORT_HISTORY_KEY, [])
}

function buildStatsText(stats: DatasetStats): string {
  const total = Math.max(1, stats.total)
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`
  const topics = stats.topics
    .slice(0, 8)
    .map((t) => `${t.name}(${t.count})`)
    .join('、')
  const lastDays = stats.trend.slice(-7)
  const trendText = lastDays.length
    ? lastDays.map((d) => `${d.date}: 正${d.pos}/中${d.neu}/负${d.neg}`).join('；')
    : '无趋势数据'
  return [
    `评论总数：${stats.total}（已分析 ${stats.analyzed}）`,
    `情感分布：正面 ${stats.sentiment.pos}（${pct(stats.sentiment.pos)}）、中性 ${stats.sentiment.neu}（${pct(stats.sentiment.neu)}）、负面 ${stats.sentiment.neg}（${pct(stats.sentiment.neg)}）`,
    `热点主题：${topics || '无'}`,
    `近 7 天趋势：${trendText}`,
  ].join('\n')
}

const { datasetId, setDatasetId } = useCurrentDataset()
const settings = useSettingsStore()

const { data: datasets } = useDatasets()
const { data: stats } = useDatasetStats(datasetId)

const report = ref('')
const generating = ref(false)
const error = ref<string | null>(null)
// 历史记录按数据集各自隔离
const history = ref<SavedReport[]>([])
const activeHistory = ref<SavedReport | null>(null)
const abortRef = shallowRef<AbortController | null>(null)
// 生成代数：切换数据集/重复点击时使旧流失效，防止增量错写进新数据集
const genIdRef = ref(0)
const genDatasetRef = ref('')

watch(
  datasetId,
  () => {
    history.value = loadHistory().filter((h) => h.datasetId === datasetId.value)
    activeHistory.value = null
    // 切换数据集时终止仍在跑的旧流
    abortRef.value?.abort()
  },
  { immediate: true },
)

// 卸载时终止流
onUnmounted(() => abortRef.value?.abort())

const generate = async () => {
  if (!datasetId.value || !stats.value || generating.value) return
  abortRef.value?.abort() // 终止旧流（若有）
  const genId = ++genIdRef.value
  genDatasetRef.value = datasetId.value
  const curDataset = datasetId.value
  generating.value = true
  error.value = null
  report.value = ''
  activeHistory.value = null
  const ac = new AbortController()
  abortRef.value = ac
  try {
    await streamChat(
      settings,
      [
        { role: 'system', content: REPORT_SYSTEM },
        { role: 'user', content: buildStatsText(stats.value) },
      ],
      (d) => {
        // 已切换到其他数据集或已被 abort：丢弃过期增量，避免污染新报告
        if (genIdRef.value !== genId || genDatasetRef.value !== curDataset || ac.signal.aborted)
          return
        report.value += d
      },
      ac.signal,
    )
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    error.value = errMsg(e)
  } finally {
    // 只有最新一次生成才复位按钮状态
    if (genIdRef.value === genId) generating.value = false
  }
}

// 生成完成时自动存入历史（绑定生成时所属数据集，防止切数据集后错存）
watch([report, generating, datasetId], () => {
  if (!report.value || generating.value || !datasetId.value) return
  if (genDatasetRef.value !== datasetId.value) return // 本次报告属于其他数据集，不写入当前数据集历史
  const datasetName = datasets.value?.find((d) => d.id === datasetId.value)?.name ?? '数据集'
  const item: SavedReport = {
    id: `${Date.now()}`,
    datasetId: datasetId.value,
    datasetName,
    createdAt: formatTime(Date.now()),
    content: report.value,
  }
  const next = [item, ...loadHistory()].slice(0, REPORT_HISTORY_MAX)
  writeJson(REPORT_HISTORY_KEY, next)
  history.value = next.filter((h) => h.datasetId === datasetId.value)
  toast.success('舆情周报已生成并保存到历史')
})

const exportMd = (text: string) => {
  downloadText(
    text,
    `舆情周报-${new Date().toLocaleDateString('zh-CN')}.md`,
    'text/markdown;charset=utf-8',
  )
}

const removeHistory = (id: string) => {
  const next = loadHistory().filter((h) => h.id !== id)
  writeJson(REPORT_HISTORY_KEY, next)
  history.value = next.filter((h) => h.datasetId === datasetId.value)
  if (activeHistory.value?.id === id) activeHistory.value = null
}

const onDatasetChange = (id: string) => {
  setDatasetId(id)
  report.value = ''
}

// 侧栏标题：选中数据集且能在列表里找到时才显示「<名称> 的历史（n）」
const historyTitle = computed(() => {
  const found = datasetId.value ? datasets.value?.find((d) => d.id === datasetId.value) : undefined
  return datasetId.value && found
    ? `${found?.name} 的历史（${history.value.length}）`
    : `历史报告（${history.value.length}）`
})
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-8">
    <PageHeader title="舆情报告" desc="AI 基于统计数据自动生成舆情周报（流式输出，自动保存历史）">
      <template #extra>
        <DatasetPicker
          :datasets="datasets"
          :dataset-id="datasetId"
          :on-change="onDatasetChange"
          :show-count="false"
        />
      </template>
    </PageHeader>

    <div v-if="!datasetId && history.length === 0" class="mt-8">
      <EmptyState
        title="选择数据集生成报告"
        desc="报告为五段式结构：总体态势 / 情感分析 / 热点主题 / 风险与负面 / 改进建议"
      >
        <template #icon>
          <FileText :size="26" :stroke-width="1.6" />
        </template>
      </EmptyState>
    </div>

    <div class="mt-6 grid gap-4 lg:grid-cols-[1fr_260px]">
      <!-- 生成区 -->
      <div>
        <div v-if="datasetId" class="flex flex-wrap items-center gap-2">
          <Button variant="primary" :disabled="!stats || generating" @click="generate">
            <Loader2 v-if="generating" :size="15" class="animate-spin" />
            <Wand2 v-else :size="15" />
            {{ generating ? '生成中…' : '生成舆情周报' }}
          </Button>
          <Button v-if="report" variant="outline" @click="exportMd(report)">
            <FileDown :size="15" />
            导出 Markdown
          </Button>
        </div>

        <div
          v-if="datasetId && !settings.apiKey"
          class="mt-3 rounded-lg border border-amber-600/50 bg-amber-100 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/25 dark:text-amber-300"
        >
          尚未配置 API key，先到「设置」填入
        </div>
        <div v-if="error" class="mt-3 text-xs text-red-600 dark:text-red-400">{{ error }}</div>

        <Card class="mt-4">
          <CardHeader
            :title="activeHistory ? `历史报告 · ${activeHistory.datasetName}` : '舆情周报'"
          >
            <template #icon>
              <FileText :size="15" />
            </template>
          </CardHeader>
          <div class="min-h-40 p-5">
            <div
              v-if="!report && !generating && !activeHistory"
              class="flex h-40 items-center justify-center text-xs text-ink-400"
            >
              {{
                datasetId
                  ? '点击上方「生成舆情周报」开始生成'
                  : '从右侧历史记录查看，或选择数据集生成'
              }}
            </div>
            <div
              v-if="generating && !report"
              class="flex h-40 items-center justify-center gap-2 text-xs text-ink-400"
            >
              <Loader2 :size="14" class="animate-spin text-accent-600 dark:text-accent-400" />
              AI 正在撰写报告…
            </div>
            <div
              v-if="report || activeHistory"
              class="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-100"
            >
              {{ activeHistory ? activeHistory.content : report }}
            </div>
          </div>
        </Card>
      </div>

      <!-- 历史列表（当前数据集） -->
      <div>
        <div class="mb-2 flex items-center gap-2 text-xs font-medium text-ink-300">
          <Clock :size="13" class="text-ink-400" />
          {{ historyTitle }}
        </div>
        <div class="space-y-2">
          <div
            v-if="history.length === 0"
            class="rounded-lg border border-dashed border-ink-700 p-4 text-center text-xs text-ink-400"
          >
            暂无历史报告
          </div>
          <div
            v-for="h in history"
            :key="h.id"
            class="rounded-lg border border-ink-800 bg-ink-900 p-3"
          >
            <button class="w-full text-left" @click="activeHistory = h">
              <div class="truncate text-[13px] font-medium text-ink-100">{{ h.datasetName }}</div>
              <div class="mt-0.5 text-[11px] text-ink-400">{{ h.createdAt }}</div>
            </button>
            <div class="mt-2 flex gap-1">
              <button
                class="rounded bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-700"
                @click="exportMd(h.content)"
              >
                导出
              </button>
              <button
                class="rounded px-2 py-0.5 text-[11px] text-ink-400 hover:text-red-600 dark:hover:text-red-400"
                @click="removeHistory(h.id)"
              >
                <Trash2 :size="11" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
