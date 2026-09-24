<script setup lang="ts">
/**
 * 📘 RangeField.vue —— 取代 src/components/dashboard/RangeField.tsx
 *
 * 时段对比的日期区间选择（两个原生 date input）。
 * React 的 value + onChange 受控写法 → :value + @input 回调；回调 prop 仍叫 onChange。
 */
const props = defineProps<{
  label: string
  range: { from: string; to: string }
  onChange: (r: { from: string; to: string }) => void
}>()

// 与 TSX 里共用的 inputCls 逐字一致
const inputCls =
  'h-8 rounded-lg border border-ink-700 bg-ink-950 px-2 text-xs text-ink-100 outline-none focus:border-accent-500'

const onFrom = (e: Event) =>
  props.onChange?.({ ...props.range, from: (e.target as HTMLInputElement).value })

const onTo = (e: Event) =>
  props.onChange?.({ ...props.range, to: (e.target as HTMLInputElement).value })
</script>

<template>
  <div class="flex items-end gap-2">
    <span class="pb-1.5 text-xs font-medium text-ink-300">{{ label }}</span>
    <input type="date" :value="range.from" :class="inputCls" @input="onFrom" />
    <span class="pb-1.5 text-ink-400">~</span>
    <input type="date" :value="range.to" :class="inputCls" @input="onTo" />
  </div>
</template>
