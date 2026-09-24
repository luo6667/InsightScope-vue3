<script setup lang="ts">
/* 📘 Badge —— 对应 ui.tsx 的 Badge（tone 五选一） */
type Tone = 'neutral' | 'pos' | 'neu' | 'neg' | 'accent'

const props = withDefaults(defineProps<{ tone?: Tone }>(), { tone: 'neutral' })

const tones: Record<Tone, string> = {
  neutral: 'bg-ink-800 text-ink-300',
  pos: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  neu: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  neg: 'bg-red-500/10 text-red-600 dark:text-red-400',
  accent: 'bg-accent-500/10 text-accent-600 dark:text-accent-400',
}
</script>

<template>
  <span
    class="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium"
    :class="tones[props.tone]"
  >
    <slot />
  </span>
</template>
