<script setup lang="ts">
/* 📘 PageHeader —— 对应 ui.tsx 的 PageHeader（extra 由具名插槽承载） */
defineProps<{ title: string; desc?: string }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold tracking-tight text-ink-100">{{ title }}</h1>
      <p v-if="desc" class="mt-0.5 text-[13px] text-ink-400">{{ desc }}</p>
    </div>
    <div v-if="$slots.extra" class="ml-auto flex items-center gap-2"><slot name="extra" /></div>
  </div>
</template>
