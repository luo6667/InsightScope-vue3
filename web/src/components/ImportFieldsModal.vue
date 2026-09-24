<script setup lang="ts">
/**
 * 📘 ImportFieldsModal.vue —— 取代 src/components/ImportFieldsModal.tsx
 *
 * 导入评论字段说明弹窗：字段表（字段名 / 必需 / 说明）与三种导入方式的提示文案。
 *
 * React → Vue：AnimatePresence / motion.div → motion-v（initial/animate/exit/transition 同名），
 * FIELDS 常量与全部中文文案逐字保留。弹窗外壳保留原 TSX 的「自定义遮罩 + 自绘标题栏」结构
 * （fixed inset-0 z-50 …），不换 el-dialog：见报告「el-dialog 取舍」一节。
 * 对外契约不变：props(open/onClose)，onClose 仍是回调 prop（不是 emit）。
 */
import { Info, X } from 'lucide-vue-next'
import { AnimatePresence, motion } from 'motion-v'

import { Badge } from '@/components/ui'

interface FieldSpec {
  name: string
  aliases: string
  required: boolean
  desc: string
}

const props = defineProps<{ open: boolean; onClose: () => void }>()

/** 导入/抓取评论支持的字段（与后端 importCommentSchema、CSV 解析层保持一致） */
const FIELDS: FieldSpec[] = [
  {
    name: 'content',
    aliases: '评论 / 内容 / text',
    required: true,
    desc: '评论正文，最长 2000 字；CSV 中该列为空的行会被跳过',
  },
  {
    name: 'author',
    aliases: '作者 / 用户 / 昵称',
    required: false,
    desc: '评论者昵称，最长 64 字',
  },
  {
    name: 'platform',
    aliases: '平台 / 来源',
    required: false,
    desc: '发布平台或来源，最长 64 字',
  },
  {
    name: 'sentiment',
    aliases: '情感 / 情绪',
    required: false,
    desc: 'pos / neu / neg（也支持「正面 / 好评 / 中性 / 负面 / 差评」等中文写法），缺省按中性（neu）处理',
  },
  {
    name: 'timestamp',
    aliases: '时间',
    required: false,
    desc: '时间戳（字符串或数字），缺省为导入时间',
  },
  {
    name: 'sentimentScore',
    aliases: '—',
    required: false,
    desc: '情感得分，范围 -1 ~ 1',
  },
  {
    name: 'topics',
    aliases: '—',
    required: false,
    desc: '主题标签数组，最多 20 个，每个最长 50 字',
  },
  {
    name: 'keywords',
    aliases: '—',
    required: false,
    desc: '关键词数组，最多 20 个，每个最长 50 字',
  },
  {
    name: 'commentId',
    aliases: '—',
    required: false,
    desc: '外部评论 ID（如平台评论编号），用于精确去重；不填则系统自动分配内部 ID，去重退化为按内容等字段组合判断',
  },
]

/** 原 TSX 里 `{"{ comments: [...] }"}` 的那段 JSON 示例（放进脚本避免模板里出现 {{ 歧义） */
const jsonExample = '{ comments: [...] }'
</script>

<template>
  <AnimatePresence>
    <motion.div
      v-if="props.open"
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
        class="w-full max-w-2xl rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        @click.stop
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-sm font-medium text-ink-100">
            <Info :size="15" class="text-accent-400" />
            导入评论字段说明
          </div>
          <button class="text-ink-400 hover:text-ink-100" @click="props.onClose">
            <X :size="16" />
          </button>
        </div>

        <div class="mt-4 overflow-hidden rounded-xl border border-ink-800">
          <div
            class="grid grid-cols-[120px_56px_minmax(0,1fr)] gap-2 bg-ink-800/60 px-4 py-2 text-xs font-medium text-ink-300"
          >
            <span>字段名</span>
            <span>必需</span>
            <span>说明</span>
          </div>
          <div
            v-for="f in FIELDS"
            :key="f.name"
            class="grid grid-cols-[120px_56px_minmax(0,1fr)] gap-2 border-t border-ink-800 px-4 py-2.5 text-[13px]"
          >
            <div class="min-w-0">
              <span class="font-mono text-ink-100">{{ f.name }}</span>
              <span v-if="f.aliases !== '—'" class="block truncate text-xs text-ink-500">
                {{ f.aliases }}
              </span>
            </div>
            <div>
              <Badge v-if="f.required" tone="accent">必需</Badge>
              <Badge v-else>可选</Badge>
            </div>
            <span class="text-ink-400">{{ f.desc }}</span>
          </div>
        </div>

        <div
          class="mt-4 space-y-1.5 rounded-xl border border-ink-800 bg-ink-950 p-3 text-xs leading-relaxed text-ink-400"
        >
          <div class="flex gap-2">
            <span class="shrink-0 font-medium text-ink-300">粘贴导入</span>
            <span>每行一条评论内容（content）即可，其余字段自动为空</span>
          </div>
          <div class="flex gap-2">
            <span class="shrink-0 font-medium text-ink-300">CSV 导入</span>
            <span
              >首行表头，支持 content / author / platform / sentiment（中英文列名均可，如「评论 /
              作者 / 平台 / 情感」）</span
            >
          </div>
          <div class="flex gap-2">
            <span class="shrink-0 font-medium text-ink-300">URL 抓取</span>
            <span>返回 JSON 数组（或 {{ jsonExample }}），支持上表全部字段</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>
