<script setup lang="ts">
/**
 * 📘 CommentModal.vue —— 取代 src/components/CommentModal.tsx
 *
 * 评论详情弹窗：展示评论原文 / 关键词，手动修正情感与主题，保存后 600ms 自动关闭并触发列表刷新。
 *
 * React → Vue：useState → ref；useRef 存定时器 → 模块内的 let；useEffect(卸载清理) → onUnmounted；
 * AnimatePresence / motion.div → motion-v（initial/animate/exit/transition 同名）。
 * 弹窗外壳保留原 TSX 的「自定义遮罩 + 自绘标题栏」结构（fixed inset-0 z-50 …），不换 el-dialog：
 * 见报告「el-dialog 取舍」一节。
 * 对外契约不变：props(datasetId/comment/onClose/onSaved) 与原 TSX 同名同义（回调仍是 props 函数）。
 */
import { Check, Pencil, X } from 'lucide-vue-next'
import { AnimatePresence, motion } from 'motion-v'
import { onUnmounted, ref, watch } from 'vue'

import { updateComment } from '@/api/api'
import type { CommentRow } from '@/api/types'
import { Badge, Button, Input } from '@/components/ui'
import { errMsg } from '@/lib/errors'
import { formatTime } from '@/lib/format'

const props = defineProps<{
  datasetId: string
  comment: CommentRow | null
  onClose: () => void
  onSaved: () => void
}>()

const sentimentOptions = [
  { value: 'pos', label: '正面', cls: 'text-emerald-400 border-emerald-800' },
  { value: 'neu', label: '中性', cls: 'text-sky-400 border-sky-800' },
  { value: 'neg', label: '负面', cls: 'text-red-400 border-red-800' },
] as const

const sentiment = ref<string>(props.comment?.sentiment ?? 'neu')
const topicsText = ref(props.comment?.topics.join('、') ?? '')
const saving = ref(false)
const error = ref<string | null>(null)
const saved = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | null = null

// 卸载时清理延迟关闭定时器，避免卸载后仍触发 onSaved/onClose
onUnmounted(() => {
  if (closeTimer) clearTimeout(closeTimer)
})

// 原 React 版靠父级的 key={comment?.id} 重新挂载来重置表单；这里额外 watch 一次，
// 即使调用方没写 key，切换评论时也不会残留上一条的修正内容（行为与带 key 的原版一致）。
watch(
  () => props.comment?.id,
  () => {
    sentiment.value = props.comment?.sentiment ?? 'neu'
    topicsText.value = props.comment?.topics.join('、') ?? ''
    error.value = null
    saved.value = false
  },
)

const save = async () => {
  if (!props.comment) return
  saving.value = true
  error.value = null
  try {
    await updateComment(props.datasetId, props.comment.id, {
      sentiment: sentiment.value,
      topics: topicsText.value
        .split(/[、,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 5),
    })
    saved.value = true
    closeTimer = setTimeout(() => {
      props.onSaved()
      props.onClose()
    }, 600)
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AnimatePresence>
    <motion.div
      v-if="props.comment"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click="props.onClose"
    >
      <motion.div
        :initial="{ opacity: 0, y: 12, scale: 0.98 }"
        :animate="{ opacity: 1, y: 0, scale: 1 }"
        :exit="{ opacity: 0, y: 8, scale: 0.98 }"
        :transition="{ duration: 0.18 }"
        class="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        @click.stop
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-sm font-medium text-ink-100">
            <Pencil :size="15" class="text-accent-400" />
            评论详情
          </div>
          <button class="text-ink-400 hover:text-ink-100" @click="props.onClose">
            <X :size="16" />
          </button>
        </div>

        <div class="mt-4 rounded-xl border border-ink-800 bg-ink-950 p-4">
          <p class="text-[15px] leading-relaxed text-ink-100">{{ props.comment.content }}</p>
          <div class="mt-2 flex items-center gap-2 text-xs text-ink-400">
            <span>{{ props.comment.author }}</span>
            <span>·</span>
            <span>{{ props.comment.platform }}</span>
            <span class="ml-auto tabular-nums">{{ formatTime(props.comment.timestamp) }}</span>
          </div>
          <div v-if="props.comment.keywords.length > 0" class="mt-2 flex flex-wrap gap-1">
            <Badge v-for="k in props.comment.keywords" :key="k">{{ k }}</Badge>
          </div>
        </div>

        <div class="mt-4">
          <div class="mb-1.5 text-[13px] font-medium text-ink-300">手动修正情感</div>
          <div class="flex gap-2">
            <button
              v-for="o in sentimentOptions"
              :key="o.value"
              class="rounded-lg border px-4 py-1.5 text-sm transition-colors"
              :class="
                sentiment === o.value
                  ? `${o.cls} bg-ink-800`
                  : 'border-ink-700 text-ink-400 hover:text-ink-200'
              "
              @click="sentiment = o.value"
            >
              {{ o.label }}
            </button>
          </div>
        </div>

        <div class="mt-4">
          <div class="mb-1.5 text-[13px] font-medium text-ink-300">主题（顿号分隔）</div>
          <Input v-model="topicsText" placeholder="如：闪退、性能" />
        </div>

        <div v-if="error" class="mt-2 text-xs text-red-400">{{ error }}</div>

        <div class="mt-5 flex justify-end gap-2">
          <Button variant="ghost" @click="props.onClose">取消</Button>
          <Button variant="primary" :disabled="saving" @click="save">
            <Check v-if="saved" :size="14" />
            {{ saved ? '已保存' : '保存修正' }}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>
