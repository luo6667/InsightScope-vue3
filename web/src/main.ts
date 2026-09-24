import '@/index.css'
import '@/styles/element-overrides.css'

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import App from '@/App.vue'
import router from '@/router'
import { migrateLegacyStorage } from '@/stores'

/**
 * 📘 main.ts —— 取代 Next 的启动链路
 *
 * Next 时期的全局能力分散在三处，这里统一在这里装配：
 * - app/(site)/layout.tsx 的 <Providers>（React Query + sonner Toaster）→ VueQueryPlugin + App.vue 里的 <Toaster>；
 * - zustand persist（workspace / settings 两个 store）→ Pinia + pinia-plugin-persistedstate；
 * - Next 的文件路由 → vue-router。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 与 Providers.tsx 保持一致
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// 迁移旧的 zustand persist 数据（必须在 Pinia 水合之前执行）
migrateLegacyStorage()

const app = createApp(App)

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

/**
 * 取代 Next 的 app/global-error.tsx（根布局层异常兜底）。
 * Next 那边根布局已失效，所以必须自带 <html>/<body> 且样式不依赖共享令牌；
 * SPA 里根布局就是 #app，因此同样用内联样式重绘一份，不引用任何 Tailwind class。
 */
function renderFatalFallback(): void {
  const root = document.getElementById('app')
  if (!root) return

  Object.assign(document.body.style, {
    margin: '0',
    fontFamily: 'system-ui, sans-serif',
    background: '#0b1220',
    color: '#eef2fa',
  })

  root.innerHTML = `
    <main style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 24px;text-align:center">
      <p style="font-size:56px;margin:0">💥</p>
      <h1 style="font-size:24px;margin:0">应用启动失败</h1>
      <p style="max-width:420px;font-size:14px;color:#a2b2c9;margin:0">
        发生了一个无法恢复的错误,请刷新页面重试;若问题持续,请联系管理员。
      </p>
      <button
        type="button"
        id="fatal-retry"
        style="cursor:pointer;border-radius:8px;background:#f59e0b;color:#451a03;border:none;padding:8px 20px;font-size:14px;font-weight:600"
      >
        重试
      </button>
    </main>`

  // Next 版调用 reset() 重新渲染；SPA 里重新挂载不可靠，直接刷新等价
  document.getElementById('fatal-retry')?.addEventListener('click', () => location.reload())
}

app.config.errorHandler = (err) => {
  console.error('[app] global render error:', err)
  renderFatalFallback()
}

app.use(pinia)
app.use(router)
app.use(VueQueryPlugin, { queryClient })

try {
  app.mount('#app')
} catch (err) {
  console.error('[app] global render error:', err)
  renderFatalFallback()
}
