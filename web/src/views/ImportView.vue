<script setup lang="ts">
/**
 * 📘 ImportView.vue —— 取代 src/views/ImportPage.tsx
 *
 * 「导入数据」页：内置舆情场景（点卡片即建数据集）/ 粘贴评论 / CSV 文件上传 / URL 定时抓取，
 * 外加「导入评论字段说明」弹窗；四条入口成功后统一跳 `/dashboard?dataset=<id>`。
 * 与 React 版的差异：next/navigation → vue-router、@tanstack/react-query → @tanstack/vue-query
 * （返回值是 ref，脚本里取 .value）；原文件里的局部组件 ScenarioCard / Badge / PasteImport /
 * CsvImport / FeedImport 受 SFC 单组件限制改为本文件内联渲染（状态、校验、文案逐字保留）。
 */
import { useMutation, useQuery } from '@tanstack/vue-query'
import {
  ArrowRight,
  ClipboardPaste,
  Clock,
  FileDown,
  FileSpreadsheet,
  FileUp,
  Info,
  MessagesSquare,
  Radio,
  UploadCloud,
} from 'lucide-vue-next'
import { computed, ref, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'

import { createFeedDataset, createScenarioDataset, importComments, listScenarios } from '@/api/api'
import ImportFieldsModal from '@/components/ImportFieldsModal.vue'
import { Button, Card, Field, Input, PageHeader, Textarea } from '@/components/ui'
import { fieldCls } from '@/components/ui/field'
import { useImportForm } from '@/composables/useImportForm'
import { useInvalidateDataset } from '@/composables/useInvalidateDataset'
import { type CsvRow, downloadCsvTemplate, parseCsv } from '@/lib/csv'
import { csvImportSchema, feedImportSchema, firstError, pasteImportSchema } from '@/lib/validation'

const invalidate = useInvalidateDataset()
const router = useRouter()

/** 内置场景列表（queryKey 与 React 版一致：['scenarios']） */
const { data: scenarios } = useQuery({ queryKey: ['scenarios'], queryFn: listScenarios })

const showFields = ref(false)

/** 点场景卡 → 按场景创建数据集，成功后刷新数据集列表并跳监控台 */
const { mutate: createScenario, isPending: creating } = useMutation({
  mutationFn: (scenarioId: string) => createScenarioDataset(scenarioId),
  onSuccess: (r) => {
    invalidate.datasets()
    router.push({ path: '/dashboard', query: { dataset: r.id } })
  },
})

/** 三个导入表单共用的成功回调（React 的 onDone）：跳转到刚导入的数据集 */
const goDashboard = (id: string) => router.push({ path: '/dashboard', query: { dataset: id } })

/** 原 TSX 文件内局部 Badge（tone=accent）的配色，本页只用在一处，直接内联成 span */
const featuredBadgeCls =
  'rounded-md px-1.5 py-0.5 text-xs font-medium bg-accent-500/10 text-accent-600 dark:text-accent-400'

// ============ 粘贴评论导入（原 PasteImport） ============
const pasteName = ref('')
const pasteText = ref('')
const { loading: pasteLoading, error: pasteError, fail: pasteFail, run: pasteRun } = useImportForm()

/** React 里写在 placeholder 字符串里的换行，放进脚本避免模板属性里出现裸换行 */
const pastePlaceholder =
  '快递太慢了，等了三天才到\n客服态度很好，问题解决很快\n手机用起来很流畅，性能不错'

const submitPaste = async () => {
  const parsed = pasteImportSchema.safeParse({
    name: pasteName.value,
    comments: pasteText.value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  })
  if (!parsed.success) {
    pasteFail(firstError(parsed.error))
    return
  }
  const { name: n, comments } = parsed.data
  await pasteRun(
    () =>
      importComments(
        comments.map((content) => ({ content, analyzed: false })),
        n ?? '',
      ),
    (r) => `导入成功，共 ${r.count} 条评论`,
    goDashboard,
  )
}

// ============ CSV 文件导入（原 CsvImport） ============
const csvFileRef = useTemplateRef<HTMLInputElement>('csvFileRef')
const csvFileName = ref('')
const csvRows = ref<CsvRow[] | null>(null)
const { loading: csvLoading, error: csvError, fail: csvFail, run: csvRun } = useImportForm()

/** 原 `rows.slice(0, 3)`；顺带避免模板里对可能为 null 的 rows 取值 */
const csvPreview = computed(() => (csvRows.value ?? []).slice(0, 3))

const onCsvFile = (file: File | undefined) => {
  if (!file) return
  csvFileName.value = file.name
  csvFail(null)
  const reader = new FileReader()
  reader.onload = () => {
    // parseCsv 现在会在「多列但没有可识别的表头」时抛错（此前静默取第 0 列，
    // 会把整行数据塞进 content 并提示导入成功）。这里必须自己兜住：
    // reader.onload 的异常不会走到 useImportForm 的 try/catch，会变成未捕获错误。
    let parsed: CsvRow[]
    try {
      parsed = parseCsv(String(reader.result ?? ''))
    } catch (e) {
      csvRows.value = null
      csvFail(e instanceof Error ? e.message : 'CSV 解析失败')
      return
    }
    if (parsed.length === 0) {
      csvRows.value = null
      csvFail('未能解析出评论，请确认 CSV 首行包含列名（content / 评论 / 内容）')
      return
    }
    csvRows.value = parsed
  }
  reader.readAsText(file, 'utf-8')
}

/** 文件 input 的 change：React 的 e.target.files?.[0] 在 Vue 里从事件对象取 */
const onCsvFileChange = (e: Event) => {
  onCsvFile((e.target as HTMLInputElement).files?.[0])
}

const submitCsv = async () => {
  if (!csvRows.value || csvRows.value.length === 0) return
  const parsed = csvImportSchema.safeParse({ rows: csvRows.value })
  if (!parsed.success) {
    csvFail(firstError(parsed.error))
    return
  }
  // csvImportRowSchema 的 content 是可选的（与后端 importCommentSchema 对齐；CSV 解析层已滤掉空内容），
  // 这里用类型守卫收窄为 CsvRow（content 必填），提交的数据与收窄前完全一致，不做兜底改写。
  const rows = parsed.data.rows.filter((r): r is CsvRow => r.content !== undefined)
  await csvRun(
    () =>
      importComments(
        rows.map((row) => ({
          content: row.content,
          author: row.author,
          platform: row.platform,
          sentiment: row.sentiment,
          analyzed: false,
        })),
      ),
    (r) => `CSV 导入成功，共 ${r.count} 条评论`,
    goDashboard,
  )
}

// ============ URL 定时抓取（原 FeedImport） ============
const feedName = ref('')
const feedUrl = ref('')
const feedInterval = ref(5)
const { loading: feedLoading, error: feedError, fail: feedFail, run: feedRun } = useImportForm()

const submitFeed = async () => {
  const parsed = feedImportSchema.safeParse({
    name: feedName.value,
    url: feedUrl.value,
    intervalMin: feedInterval.value,
  })
  if (!parsed.success) {
    feedFail(firstError(parsed.error))
    return
  }
  const { name: n, url: u, intervalMin } = parsed.data
  await feedRun(
    () => createFeedDataset(n ?? '定时抓取数据源', u, intervalMin),
    (r) =>
      r.count > 0 ? `抓取导入成功，共 ${r.count} 条评论` : '数据集已创建，将按设定间隔自动抓取',
    goDashboard,
  )
}

const closeFields = () => {
  showFields.value = false
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <PageHeader
      title="导入数据"
      desc="内置舆情场景已预标注（免 key 演示），或粘贴 / CSV / URL 定时抓取导入"
    >
      <template #extra>
        <Button variant="outline" size="sm" @click="showFields = true">
          <Info :size="14" />
          导入字段说明
        </Button>
      </template>
    </PageHeader>

    <h2 class="mt-8 flex items-center gap-2 text-sm font-medium text-ink-200">
      <FileUp :size="15" class="text-accent-600 dark:text-accent-400" />
      内置舆情场景
    </h2>
    <div class="mt-3 grid gap-3 lg:grid-cols-2">
      <button
        v-for="(s, i) in scenarios ?? []"
        :key="s.id"
        :disabled="creating"
        class="group h-full text-left transition-all duration-150 disabled:opacity-50"
        :class="i === 0 ? 'lg:col-span-2' : ''"
        @click="createScenario(s.id)"
      >
        <Card
          hover
          class="flex h-full items-start gap-4 p-5"
          :class="i === 0 ? 'lg:flex-row lg:items-center' : ''"
        >
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-accent-600 dark:text-accent-400 transition-colors group-hover:bg-accent-500/15"
          >
            <MessagesSquare :size="20" :stroke-width="1.8" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium text-ink-100">{{ s.name }}</span>
              <span v-if="i === 0" :class="featuredBadgeCls">推荐演示</span>
            </div>
            <p
              class="mt-1 text-[13px] leading-relaxed text-ink-400"
              :class="i === 0 ? 'lg:max-w-xl' : ''"
            >
              {{ s.description }}
            </p>
            <div class="mt-3 flex items-center gap-4 text-[13px] text-ink-400">
              <span class="flex items-center gap-1.5">
                <MessagesSquare :size="12" class="text-ink-500" />
                <span class="tabular-nums">{{ s.count }}</span> 条评论
              </span>
              <span class="flex items-center gap-1.5">
                <Clock :size="12" class="text-ink-500" />
                {{ s.days }} 天时间线
              </span>
              <span
                class="ml-auto flex items-center gap-1 text-accent-600 dark:text-accent-400 opacity-0 transition-opacity group-hover:opacity-100"
              >
                导入
                <ArrowRight :size="13" />
              </span>
            </div>
          </div>
        </Card>
      </button>
    </div>

    <h2 class="mt-9 flex items-center gap-2 text-sm font-medium text-ink-200">
      <ClipboardPaste :size="15" class="text-accent-600 dark:text-accent-400" />
      粘贴评论导入
    </h2>
    <div class="mt-3">
      <Card class="p-5">
        <Field label="数据集名称（可选）">
          <input
            v-model="pasteName"
            placeholder="例如：某电商平台 7 月用户反馈"
            :class="['h-9', fieldCls]"
          />
        </Field>
        <div class="mt-3">
          <Field label="评论内容（每行一条）">
            <Textarea v-model="pasteText" :rows="7" :placeholder="pastePlaceholder" />
          </Field>
        </div>
        <div v-if="pasteError" class="mt-2 text-xs text-red-600 dark:text-red-400">
          {{ pasteError }}
        </div>
        <div class="mt-4">
          <Button
            variant="primary"
            :disabled="pasteLoading || !pasteText.trim()"
            @click="submitPaste"
          >
            <FileUp :size="15" />
            {{ pasteLoading ? '导入中…' : '导入评论' }}
          </Button>
        </div>
      </Card>
    </div>

    <h2 class="mt-9 flex items-center gap-2 text-sm font-medium text-ink-200">
      <FileSpreadsheet :size="15" class="text-accent-600 dark:text-accent-400" />
      CSV 文件导入
    </h2>
    <div class="mt-3">
      <Card class="p-5">
        <input
          ref="csvFileRef"
          type="file"
          accept=".csv,text/csv"
          class="hidden"
          @change="onCsvFileChange"
        />
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="outline" @click="csvFileRef?.click()">
            <UploadCloud :size="15" />
            选择 CSV 文件
          </Button>
          <Button variant="ghost" size="sm" @click="downloadCsvTemplate">
            <FileDown :size="13" />
            下载 CSV 模板
          </Button>
          <span v-if="csvFileName" class="text-xs text-ink-400">{{ csvFileName }}</span>
          <template v-if="csvRows && csvRows.length > 0">
            <span class="text-xs text-ink-400"
              >解析出
              <span class="tabular-nums text-ink-200">{{ csvRows.length }}</span> 条评论</span
            >
            <Button variant="primary" size="sm" :disabled="csvLoading" @click="submitCsv">
              <FileUp :size="13" />
              {{ csvLoading ? '导入中…' : '导入' }}
            </Button>
          </template>
        </div>
        <div v-if="csvError" class="mt-2 text-xs text-red-600 dark:text-red-400">
          {{ csvError }}
        </div>
        <div
          v-if="csvRows && csvRows.length > 0"
          class="mt-3 rounded-lg border border-ink-800 bg-ink-950 p-3"
        >
          <div class="mb-2 text-xs text-ink-400">预览（前 3 条）</div>
          <div class="space-y-1.5">
            <div v-for="(r, i) in csvPreview" :key="i" class="truncate text-[13px] text-ink-200">
              <span class="text-ink-500">{{ i + 1 }}.</span> {{ r.content }}
            </div>
          </div>
        </div>
      </Card>
    </div>

    <h2 class="mt-9 flex items-center gap-2 text-sm font-medium text-ink-200">
      <Radio :size="15" class="text-accent-600 dark:text-accent-400" />
      URL 定时抓取
    </h2>
    <div class="mt-3">
      <Card class="p-5">
        <div class="grid gap-3 lg:grid-cols-2">
          <Field label="数据集名称（可选）">
            <Input v-model="feedName" placeholder="例如：官网用户反馈" />
          </Field>
          <Field label="抓取间隔（分钟）">
            <Input v-model="feedInterval" type="number" :min="1" :max="1440" />
          </Field>
        </div>
        <div class="mt-3">
          <Field
            label="数据源 URL"
            hint="返回 JSON 数组（或 { comments: [...] }）的接口，字段支持 content/author/platform/sentiment"
          >
            <Input v-model="feedUrl" placeholder="https://example.com/comments" />
          </Field>
        </div>
        <div v-if="feedError" class="mt-2 text-xs text-red-600 dark:text-red-400">
          {{ feedError }}
        </div>
        <div class="mt-4">
          <Button variant="primary" :disabled="feedLoading || !feedUrl.trim()" @click="submitFeed">
            <Radio :size="15" />
            {{ feedLoading ? '创建中…' : '创建并开始定时抓取' }}
          </Button>
        </div>
      </Card>
    </div>

    <ImportFieldsModal :open="showFields" :on-close="closeFields" />
  </div>
</template>
