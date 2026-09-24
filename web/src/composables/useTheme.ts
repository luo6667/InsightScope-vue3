import { ref, watch } from 'vue'

/**
 * 📘 composables/useTheme.ts —— 取代旧 hooks/useTheme.ts
 *
 * 深浅主题：切换 document.documentElement.dataset.theme + localStorage 记忆。
 * React 版每个组件各持一份 useState；Vue 版改成**模块级单例 ref**，
 * 主站布局与移动端 Tab 共享同一份状态，切换后两处同时生效。
 */
export type Theme = 'dark' | 'light'

const KEY = 'insight-theme'

function readStored(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

// 模块加载即先行设置 data-theme，避免首帧浅/深色闪烁（FOUC）；
// index.html 里的内联脚本做同一件事，两者互为兜底。
const theme = ref<Theme>(readStored())
document.documentElement.dataset.theme = theme.value

watch(theme, (value) => {
  document.documentElement.dataset.theme = value
  try {
    localStorage.setItem(KEY, value)
  } catch {
    /* ignore */
  }
})

export function useTheme(): { theme: typeof theme; toggleTheme: () => void } {
  return {
    theme,
    toggleTheme: () => {
      theme.value = theme.value === 'dark' ? 'light' : 'dark'
    },
  }
}
