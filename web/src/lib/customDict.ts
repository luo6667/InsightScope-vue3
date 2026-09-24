// 自定义关键词词典（存 localStorage，词云统计时传给后端合并匹配）
import { readJson, writeJson } from './storage'

const KEY = 'insight-custom-dict'

export function getCustomDict(): string[] {
  const v = readJson<string[]>(KEY, [])
  return Array.isArray(v) ? v.map((s) => s.trim()).filter(Boolean) : []
}

export function setCustomDict(words: string[]): void {
  writeJson(KEY, words.map((s) => s.trim()).filter(Boolean))
}

/** 用于 queryKey 的稳定串 */
export function customDictKey(): string {
  return getCustomDict().join(',')
}
