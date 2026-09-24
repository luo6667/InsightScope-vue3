<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

/**
 * 📘 components/ErrorBoundary.vue —— 取代 Next 的 app/error.tsx（错误边界）
 *
 * Next 的 error.tsx 会包住同层级的 page 并在渲染异常时展示可恢复错误页；
 * Vue 里对应的能力是 onErrorCaptured，包在 <RouterView> 外层即可。
 * 文案与 Tailwind class 逐字保留。
 */
const error = ref<Error | null>(null)

onErrorCaptured((err) => {
  console.error('[app] render error:', err)
  error.value = err as Error
  // 阻止继续向上冒泡，避免同一个错误被重复处理
  return false
})

function reset() {
  error.value = null
}
</script>

<template>
  <main
    v-if="error"
    class="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
  >
    <p class="text-6xl">😵</p>
    <h1 class="text-2xl font-bold tracking-[-0.02em]">页面出错了</h1>
    <p class="max-w-md text-sm text-ink-400">渲染时发生异常，可点击下方按钮重试。</p>
    <button
      type="button"
      class="cursor-pointer rounded-lg bg-accent-500 px-5 py-2 text-sm font-semibold text-accent-950 transition-opacity hover:opacity-90"
      @click="reset()"
    >
      重试
    </button>
  </main>
  <slot v-else />
</template>
