<script setup lang="ts">
/**
 * 📘 SettingsView.vue —— 取代 src/views/SettingsPage.tsx
 *
 * 设置页：AI 服务配置（baseUrl / apiKey / model / temperature，zod 字段级校验）+ 自定义关键词词典。
 * 相比 React 版的差异：
 * - `useSettings()`（zustand hook）→ `useSettingsStore()`（Pinia store），保存走 `settings.update(partial)`；
 * - 表单草稿 `useState` → `reactive`，`setDraft({ ...draft, x })` 对应 `Object.assign(draft, { x })`；
 * - 校验结果 `parsed` / `errs` 在 React 里是每次渲染重算的普通变量，Vue 里改为 `computed`（随草稿自动重算）；
 * - `value` + `onChange` → `v-model`；文案、Tailwind class 与原 TSX 逐字一致。
 */
import { BookMarked, Check, KeyRound, ShieldCheck } from 'lucide-vue-next'
import { computed, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'

import { Button, Card, CardHeader, Field, Input, PageHeader, Textarea } from '@/components/ui'
import { getCustomDict, setCustomDict } from '@/lib/customDict'
import { aiSettingsSchema, fieldErrors } from '@/lib/validation'
import { type AiConfig, useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const draft = reactive<AiConfig>({
  baseUrl: settings.baseUrl,
  apiKey: settings.apiKey,
  model: settings.model,
  temperature: settings.temperature,
})
const dictText = ref(getCustomDict().join('\n'))

// zod 字段级校验（语义与原手写 ASCII 检查一致，并覆盖长度/范围）
const parsed = computed(() => aiSettingsSchema.safeParse(draft))
const errs = computed(() => {
  const result = parsed.value
  return result.success ? {} : fieldErrors(result.error)
})
const keyInvalid = computed(() => !!errs.value.apiKey)
const urlInvalid = computed(() => !!errs.value.baseUrl)

const save = () => {
  const result = parsed.value
  if (!result.success) return
  const { apiKey, baseUrl, model, temperature } = result.data
  // key 去掉所有空白（sk- 格式），其余字段已由 schema trim / 范围校验
  const cleanKey = apiKey.replace(/\s+/g, '')
  settings.update({ ...draft, apiKey: cleanKey, baseUrl, model, temperature })
  Object.assign(draft, { apiKey: cleanKey, baseUrl, model, temperature })
  toast.success('AI 服务设置已保存')
}

const saveDict = () => {
  const words = dictText.value
    .split(/[\n,，、]+/)
    .map((w) => w.trim())
    .filter(Boolean)
  setCustomDict(words)
  toast.success('自定义词典已保存（词云统计生效）')
}

// temperature 输入：空字符串按 0 处理，NaN 时保持原值（避免非法值进入状态）
const setTemperature = (v: string | number | undefined) => {
  const n = v === '' || v === undefined ? 0 : Number(v)
  draft.temperature = Number.isFinite(n) ? n : draft.temperature
}
</script>

<template>
  <div class="mx-auto max-w-xl px-6 py-8">
    <PageHeader title="设置" desc="AI 连接与关键词词典配置" />

    <Card class="mt-6">
      <CardHeader title="AI 服务">
        <template #icon>
          <KeyRound :size="15" />
        </template>
        <template #extra>
          <span class="flex items-center gap-1.5 text-xs text-ink-400">
            <ShieldCheck :size="12" />
            key 仅存本浏览器
          </span>
        </template>
      </CardHeader>
      <div class="space-y-4 p-5">
        <Field
          label="API Base URL"
          hint="兼容 OpenAI 协议即可，如 DeepSeek 填 https://api.deepseek.com/v1"
          :error="urlInvalid ? 'Base URL 含非 ASCII 字符，请检查' : undefined"
        >
          <Input v-model="draft.baseUrl" placeholder="https://api.openai.com/v1" />
        </Field>
        <Field
          label="API Key"
          hint="分析时随任务传给本地后端，仅内存不落库"
          :error="keyInvalid ? 'key 混入了非 ASCII 字符，只保留 sk-... 那段' : undefined"
        >
          <Input v-model="draft.apiKey" type="password" placeholder="sk-..." />
        </Field>
        <div class="grid grid-cols-2 gap-3">
          <Field label="模型">
            <Input v-model="draft.model" placeholder="gpt-4o-mini" />
          </Field>
          <Field label="temperature">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              :model-value="draft.temperature"
              @update:model-value="setTemperature"
            />
          </Field>
        </div>
        <div class="flex items-center gap-3 pt-1">
          <Button variant="primary" :disabled="keyInvalid || urlInvalid" @click="save">
            保存设置
          </Button>
        </div>
      </div>
    </Card>

    <Card class="mt-4">
      <CardHeader title="自定义关键词词典">
        <template #icon>
          <BookMarked :size="15" />
        </template>
        <template #extra>
          <span class="flex items-center gap-1.5 text-xs text-ink-400">
            <Check :size="12" />
            词云统计生效
          </span>
        </template>
      </CardHeader>
      <div class="p-5">
        <Field
          label="自定义关键词（每行一个，或逗号分隔）"
          hint="添加产品名、特定槽点等词，评论中出现该词就会计入关键词云统计（与内置评价词典合并）"
        >
          <Textarea
            v-model="dictText"
            :rows="6"
            :placeholder="'例如：\n某产品名\n发货慢\n包装破损\n客服敷衍'"
          />
        </Field>
        <div class="mt-4">
          <Button variant="primary" @click="saveDict"> 保存词典 </Button>
        </div>
      </div>
    </Card>
  </div>
</template>
