<script setup lang="ts">
import { CardSkeleton } from '@/components/ui'

/**
 * 📘 components/PageLoading.vue —— 取代 Next 的 app/(site)/loading.tsx
 *
 * 路由切换时的页面级 loading（骨架屏，复用共享 CardSkeleton 保持视觉一致）。
 * 在 App.vue 里作为 <Suspense> 的 fallback，配合 router 的懒加载路由使用。
 */
</script>

<template>
  <div class="space-y-6">
    <!-- 页头骨架 -->
    <div class="animate-pulse">
      <div class="h-7 w-48 rounded-md bg-ink-800" />
      <div class="mt-2 h-3.5 w-72 rounded bg-ink-800" />
    </div>
    <div class="grid gap-4">
      <CardSkeleton :rows="3" />
      <CardSkeleton :rows="4" />
      <CardSkeleton :rows="2" />
    </div>
  </div>
</template>
