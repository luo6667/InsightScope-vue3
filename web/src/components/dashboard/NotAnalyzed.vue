<script setup lang="ts">
/**
 * 📘 NotAnalyzed.vue —— 取代 src/components/dashboard/NotAnalyzed.tsx
 *
 * 未分析占位（图表区域数据为空时展示）。
 * h 由调用方传入 Tailwind 高度类（如 h-56 / h-52），其余样式与 React 版逐字一致。
 */
defineProps<{ h: string }>()
</script>

<template>
  <div
    class="flex items-center justify-center rounded-lg border border-dashed border-ink-700 text-[13px] text-ink-400"
    :class="h"
  >
    尚未分析，待 AI 分析后展示
  </div>
</template>
