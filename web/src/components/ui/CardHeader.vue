<script setup lang="ts">
/* 📘 CardHeader —— 对应 ui.tsx 的 CardHeader（icon/extra 由具名插槽承载） */
defineProps<{ title: string }>()
</script>

<template>
  <div class="flex items-center gap-2 border-b border-ink-800 px-4 py-2.5">
    <span v-if="$slots.icon" class="text-ink-400"><slot name="icon" /></span>
    <span class="text-sm font-medium text-ink-100">{{ title }}</span>
    <span v-if="$slots.extra" class="ml-auto"><slot name="extra" /></span>
  </div>
</template>
