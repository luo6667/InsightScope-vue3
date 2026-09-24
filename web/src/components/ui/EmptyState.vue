<script setup lang="ts">
/* 📘 EmptyState —— 对应 ui.tsx 的 EmptyState（icon/action 由具名插槽承载） */
defineProps<{ title: string; desc?: string }>()
</script>

<template>
  <div
    class="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center"
  >
    <div v-if="$slots.icon" class="text-ink-500"><slot name="icon" /></div>
    <div class="mt-3 text-sm font-medium text-ink-200">{{ title }}</div>
    <div v-if="desc" class="mt-1 max-w-sm text-[13px] text-ink-400">{{ desc }}</div>
    <div v-if="$slots.action" class="mt-4"><slot name="action" /></div>
  </div>
</template>
