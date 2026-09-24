<script setup lang="ts">
/**
 * 📘 AlertCenterView.vue —— 取代 src/views/AlertCenterPage.tsx
 *
 * 告警中心：左侧规则列表（内联原 RuleForm 的创建表单 + 启停 + 删除），右侧告警时间线（确认）。
 * 相比 React 版：useCurrentDataset 返回 ComputedRef（脚本里要 .value）；原同文件的 RuleForm
 * 子组件内联进本文件（避免新增文件）；数据集选择继续用 DatasetPicker，规则类型下拉改用
 * Element Plus 的 <el-select>；文案与 Tailwind class 逐字保留。
 */
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { Bell, BellRing, Check, Plus, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'

import { ackAlert, createRule, deleteRule, updateRule } from '@/api/api'
import DatasetPicker from '@/components/DatasetPicker.vue'
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader } from '@/components/ui'
import { useCurrentDataset } from '@/composables/useCurrentDataset'
import { useAlertRules, useAlerts, useDatasets } from '@/composables/useData'
import { errMsg } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { alertRuleSchema, firstError } from '@/lib/validation'

const typeLabel: Record<string, string> = {
  negativity: '负面率阈值',
  volume: '评论量',
  keyword: '敏感关键词',
}

const ruleTone: Record<string, 'neg' | 'neutral' | 'accent'> = {
  negativity: 'neg',
  volume: 'neutral',
  keyword: 'accent',
}

const { datasetId, setDatasetId } = useCurrentDataset()
const qc = useQueryClient()

const { data: datasets } = useDatasets()
const { data: rules } = useAlertRules(datasetId)
const { data: alerts } = useAlerts(datasetId)

const del = useMutation({
  mutationFn: deleteRule,
  onSuccess: () => qc.invalidateQueries({ queryKey: ['rules', datasetId.value] }),
})
const toggle = useMutation({
  mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateRule(id, { enabled }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['rules', datasetId.value] }),
})
const ack = useMutation({
  mutationFn: ackAlert,
  onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', datasetId.value] }),
})

const unacked = computed(() => alerts.value?.filter((a) => !a.acknowledged).length ?? 0)

// ============ 原 AlertCenterPage 里的 RuleForm 子组件（内联，表单状态同名） ============
const ruleType = ref('negativity')
const threshold = ref('50')
const keyword = ref('')
const formError = ref<string | null>(null)

const add = useMutation({
  mutationFn: createRule,
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['rules', datasetId.value] })
    keyword.value = ''
    toast.success('告警规则已创建')
  },
  onError: (e) => {
    formError.value = errMsg(e)
  },
})

const submit = () => {
  formError.value = null
  const parsed = alertRuleSchema.safeParse({
    type: ruleType.value,
    threshold: ruleType.value === 'keyword' ? 1 : Number(threshold.value),
    keyword: ruleType.value === 'keyword' ? keyword.value.trim() : '',
  })
  if (!parsed.success) {
    formError.value = firstError(parsed.error)
    return
  }
  add.mutate({
    datasetId: datasetId.value,
    ...parsed.data,
  })
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <PageHeader title="告警中心" desc="配置规则，实时模拟或分析时会自动检测并推送">
      <template #extra>
        <div class="flex items-center gap-3">
          <span v-if="unacked > 0" class="flex items-center gap-1.5 text-xs text-red-400">
            <span class="relative flex h-2 w-2">
              <span
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60"
              />
              <span class="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            {{ unacked }} 条未确认
          </span>
          <DatasetPicker
            :datasets="datasets"
            :dataset-id="datasetId"
            :on-change="setDatasetId"
            :show-count="false"
          />
        </div>
      </template>
    </PageHeader>

    <div v-if="!datasetId" class="mt-8">
      <EmptyState
        title="选择数据集配置告警"
        desc="支持负面率阈值 / 评论量 / 敏感关键词三种规则，实时模拟时自动检测"
      >
        <template #icon>
          <Bell :size="26" :stroke-width="1.6" />
        </template>
      </EmptyState>
    </div>

    <div v-if="datasetId" class="mt-6 grid gap-4 lg:grid-cols-2">
      <!-- 规则 -->
      <Card>
        <CardHeader title="告警规则">
          <template #icon>
            <BellRing :size="15" />
          </template>
        </CardHeader>
        <div class="space-y-2 p-4">
          <div class="rounded-lg border border-ink-800 bg-ink-950 p-3.5">
            <div class="flex gap-2">
              <el-select v-model="ruleType" class="h-8 w-32 text-xs">
                <el-option label="负面率阈值" value="negativity" />
                <el-option label="评论量" value="volume" />
                <el-option label="敏感关键词" value="keyword" />
              </el-select>
              <Input
                v-if="ruleType === 'keyword'"
                v-model="keyword"
                placeholder="关键词，如 闪退"
                class="h-8 min-w-0 flex-1 text-xs"
              />
              <Input
                v-else
                v-model="threshold"
                type="number"
                :placeholder="ruleType === 'negativity' ? '百分比' : '条数'"
                class="h-8 w-24 text-xs"
              />
              <Button
                size="sm"
                variant="primary"
                :disabled="ruleType === 'keyword' ? !keyword.trim() : !threshold"
                @click="submit"
              >
                <Plus :size="13" />
                添加
              </Button>
            </div>
            <div v-if="formError" class="mt-2 text-xs text-red-400">{{ formError }}</div>
          </div>
          <div
            v-for="r in rules || []"
            :key="r.id"
            class="flex items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-950 px-3 py-2.5"
          >
            <Badge :tone="ruleTone[r.type]">{{ typeLabel[r.type] }}</Badge>
            <span class="flex-1 text-sm text-ink-200">
              <template v-if="r.type === 'keyword'">
                含「<span class="text-ink-100">{{ r.keyword }}</span>」
              </template>
              <template v-else>
                阈值 <span class="tabular-nums text-ink-100">{{ r.threshold }}</span
                >{{ r.type === 'negativity' ? '%' : ' 条' }}
              </template>
            </span>
            <button
              class="rounded-md px-2 py-1 text-xs transition-colors"
              :class="r.enabled ? 'bg-accent-500/15 text-accent-400' : 'bg-ink-800 text-ink-400'"
              @click="toggle.mutate({ id: r.id, enabled: !r.enabled })"
            >
              {{ r.enabled ? '启用中' : '已停用' }}
            </button>
            <button
              class="text-ink-400 transition-colors hover:text-red-400"
              @click="del.mutate(r.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
          <div v-if="rules?.length === 0" class="py-4 text-center text-xs text-ink-400">
            暂无规则，添加一条试试
          </div>
        </div>
      </Card>

      <!-- 告警记录（时间线） -->
      <Card>
        <CardHeader title="告警记录">
          <template #icon>
            <Bell :size="15" />
          </template>
          <template #extra>
            <span class="text-xs text-ink-400">{{ alerts?.length ?? 0 }} 条</span>
          </template>
        </CardHeader>
        <div class="max-h-[420px] overflow-y-auto p-4">
          <div v-if="alerts?.length === 0" class="py-6 text-center text-xs text-ink-400">
            暂无告警
          </div>
          <div class="relative space-y-3 pl-4">
            <div class="absolute bottom-1 left-[5px] top-1 w-px bg-ink-800" />
            <div v-for="a in alerts || []" :key="a.id" class="relative">
              <span
                class="absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-ink-900"
                :class="a.severity === 'critical' ? 'bg-red-400' : 'bg-amber-400'"
              />
              <div
                class="rounded-lg border px-3 py-2.5"
                :class="
                  a.severity === 'critical'
                    ? 'border-red-800/50 bg-red-950/25'
                    : 'border-amber-800/40 bg-amber-950/15'
                "
              >
                <div class="flex items-start gap-2">
                  <span
                    class="flex-1 text-sm leading-snug"
                    :class="a.severity === 'critical' ? 'text-red-200' : 'text-amber-200'"
                  >
                    {{ a.message }}
                  </span>
                  <Button
                    v-if="!a.acknowledged"
                    size="sm"
                    variant="outline"
                    @click="ack.mutate(a.id)"
                  >
                    <Check :size="12" />
                    确认
                  </Button>
                </div>
                <div class="mt-1 text-xs text-ink-400">
                  {{ typeLabel[a.type] }} · {{ formatTime(a.triggeredAt) }}
                  <template v-if="a.acknowledged"> · 已确认</template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  </div>
</template>
