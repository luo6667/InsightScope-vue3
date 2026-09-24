<script setup lang="ts">
/* 📘 Card —— 对应 ui.tsx 的 Card（父级传入的 class 会自动合并到根元素） */
const props = withDefaults(defineProps<{ hover?: boolean }>(), { hover: false })
</script>

<template>
  <div
    class="rounded-xl border border-ink-800 bg-ink-900"
    :class="
      props.hover ? 'transition-colors duration-150 hover:border-ink-600 hover:bg-ink-850' : ''
    "
  >
    <slot />
  </div>
</template>
