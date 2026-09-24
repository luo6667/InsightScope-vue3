<script setup lang="ts">
/* 📘 Field —— 对应 ui.tsx 的 Field（label + 控件 + error/hint 三行结构） */
defineProps<{ label: string; hint?: string; error?: string }>()
</script>

<template>
  <label class="block">
    <span class="mb-1 block text-[13px] font-medium text-ink-300">{{ label }}</span>
    <slot />
    <span v-if="error" class="mt-1 block text-xs text-red-600 dark:text-red-400">{{ error }}</span>
    <span v-else-if="hint" class="mt-1 block text-xs text-ink-400">{{ hint }}</span>
  </label>
</template>
