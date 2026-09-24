<script setup lang="ts">
/**
 * 📘 views/NotFoundView.vue —— 取代 Next 的 app/not-found.tsx
 *
 * 404 页面：路由不存在时的统一兜底（由 router 的 /:pathMatch(.*)* 命中）。
 * 文案与 Tailwind class 逐字保留，只把 next/link 换成 vue-router 的 RouterLink。
 */
</script>

<template>
  <main class="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
    <p class="text-6xl">🧭</p>
    <h1 class="text-2xl font-bold tracking-[-0.02em]">页面不存在</h1>
    <p class="max-w-md text-sm text-ink-400">你访问的地址不存在或已被移动,请检查链接是否正确。</p>
    <RouterLink
      to="/datasets"
      class="rounded-lg bg-accent-500 px-5 py-2 text-sm font-semibold text-accent-950 transition-opacity hover:opacity-90"
    >
      返回监控台
    </RouterLink>
  </main>
</template>
