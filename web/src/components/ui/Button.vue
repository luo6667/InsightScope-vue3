<script setup lang="ts">
/* 📘 Button —— 对应 ui.tsx 的 Button（variant/size 两套变体，样式逐字保留） */
type BtnVariant = 'primary' | 'ghost' | 'danger' | 'outline'
type BtnSize = 'sm' | 'md'

const props = withDefaults(defineProps<{ variant?: BtnVariant; size?: BtnSize }>(), {
  variant: 'outline',
  size: 'md',
})

const btnBase =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500'
const btnVariants: Record<BtnVariant, string> = {
  primary:
    'bg-accent-500 text-accent-950 hover:bg-accent-400 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_4px_14px_-4px_rgba(245,158,11,0.45)]',
  outline: 'border border-ink-700 text-ink-300 hover:bg-ink-850 hover:text-ink-100',
  ghost: 'text-ink-400 hover:bg-ink-850 hover:text-ink-100',
  danger: 'border border-red-800/70 text-red-300 hover:bg-red-950/50',
}
const btnSizes: Record<BtnSize, string> = { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4 text-sm' }
</script>

<template>
  <button :class="[btnBase, btnVariants[props.variant], btnSizes[props.size]]">
    <slot />
  </button>
</template>
