/**
 * 📘 stores —— 全局状态（Pinia 取代 zustand）
 */
export { migrateLegacyStorage } from './legacy'
export { type AiConfig, DEFAULT_AI_CONFIG, useSettingsStore } from './settings'
export { useWorkspaceStore } from './workspace'
