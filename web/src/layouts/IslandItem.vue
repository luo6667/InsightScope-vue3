<script setup lang="ts">
/**
 * 📘 IslandItem.vue —— 悬浮岛的单个导航项（对应 (site)/layout.tsx 里的 IslandItem）
 *
 * 选中态用 motion-v 的 `layout-id="nav-active"` 做跨项滑动的共享布局动画，
 * 与 React 版 `motion.span layoutId="nav-active"` 一一对应。
 */
import { motion } from 'motion-v'
import type { Component } from 'vue'

defineProps<{ to: string; label: string; icon: Component; active: boolean }>()
</script>

<template>
  <RouterLink :to="to" class="block">
    <span
      class="relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all duration-150"
      :class="
        active
          ? 'bg-accent-500/12 font-medium text-accent-300'
          : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-200'
      "
    >
      <motion.span
        v-if="active"
        layout-id="nav-active"
        class="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent-400"
        :transition="{ type: 'spring', stiffness: 420, damping: 34 }"
      />
      <component :is="icon" :size="17" :stroke-width="2" class="shrink-0" />
      <span>{{ label }}</span>
    </span>
  </RouterLink>
</template>
