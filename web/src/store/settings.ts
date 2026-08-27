/**
 * 📘 store/settings.ts —— 全局设置状态（技术栈：zustand + persist 中间件）
 *
 * 保存 AI 服务配置（baseUrl / apiKey / model / temperature）：
 * - zustand 比 redux 轻量：组件里 useSettings() 直接读、s.update() 直接改，无样板代码；
 * - persist 中间件自动把 state 写入 localStorage（key: insight-ai-settings），
 *   刷新页面不丢；apiKey 只存在浏览器本地，后端不落库。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

interface SettingsState extends AiConfig {
  update: (partial: Partial<AiConfig>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
      temperature: 0.2,
      update: (partial) => set(partial),
    }),
    { name: "insight-ai-settings" }
  )
);
