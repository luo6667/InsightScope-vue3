<script setup lang="ts">
/* 📘 StatCard —— 对应 ui.tsx 的 StatCard
 * 入场动画用 motion-v（Motion 官方 Vue 版），API 与 motion/react 一致：
 * initial / animate / transition。value 也支持默认插槽（放自定义节点）。 */
import { motion } from 'motion-v'

const props = withDefaults(
  defineProps<{ label: string; value?: string | number; sub?: string; accentCls?: string }>(),
  { value: '', sub: undefined, accentCls: 'text-ink-100' },
)
</script>

<template>
  <motion.div
    :initial="{ opacity: 0, y: 8 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="{ duration: 0.3 }"
    class="rounded-xl border border-ink-800 bg-ink-900 px-4 py-3"
  >
    <div class="text-xs font-medium uppercase tracking-wider text-ink-400">{{ props.label }}</div>
    <div class="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight" :class="props.accentCls">
      <slot>{{ props.value }}</slot>
    </div>
    <div v-if="props.sub" class="mt-0.5 text-xs text-ink-400">{{ props.sub }}</div>
  </motion.div>
</template>
