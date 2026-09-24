/**
 * 📘 lib/storage.ts —— localStorage 的安全读写
 *
 * 隐私模式 / 配额写满 / 浏览器禁用 storage 时 localStorage 会抛异常，
 * 这些数据都是「记忆性」的（主题、口令、自定义词典、报告历史），失败不该影响主流程，
 * 所以统一在这里吞掉异常。原先各模块自己写 try/catch，有几处漏了。
 */

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 配额满或 storage 被禁用：静默（不影响页面功能，只是这次没记住） */
  }
}

export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* noop */
  }
}

/** 读 JSON：不存在 / 解析失败时返回 fallback，绝不抛异常 */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readStorage(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 写 JSON（配额满时静默失败，见 writeStorage） */
export function writeJson(key: string, value: unknown): void {
  writeStorage(key, JSON.stringify(value))
}
