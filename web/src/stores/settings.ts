import { defineStore } from 'pinia'

/**
 * 📘 stores/settings.ts —— 取代旧 store/settings.ts（zustand + persist）
 *
 * 保存 AI 服务配置（baseUrl / apiKey / model / temperature）：
 * - Pinia 的 state + action 直接对应 zustand 的 state + setter，无额外样板代码；
 * - persist 把 state 写入 localStorage（key: insight-ai-settings），刷新页面不丢；
 * - apiKey 只存在浏览器本地，后端不落库。
 */
export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

/** 默认值（与旧 store 逐字一致） */
export const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.2,
}

export const useSettingsStore = defineStore('settings', {
  state: (): AiConfig => ({ ...DEFAULT_AI_CONFIG }),
  actions: {
    /** 局部更新（对应旧的 zustand update(partial)） */
    update(partial: Partial<AiConfig>) {
      Object.assign(this, partial)
    },
  },
  persist: { key: 'insight-ai-settings' },
})
