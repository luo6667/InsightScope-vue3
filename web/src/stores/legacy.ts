/**
 * 📘 stores/legacy.ts —— 旧 zustand persist 数据的兼容迁移
 *
 * zustand 的 persist 中间件把 state 包在 `{ state: {...}, version: 0 }` 里写进 localStorage，
 * 而 pinia-plugin-persistedstate 期望的是**裸 state 对象**。两者 key 同名（为了不丢用户已填的
 * API key），所以首次启动时把包了一层壳的旧值摊平，否则 Pinia 水合时会读到不存在的字段。
 *
 * 只需跑一次（迁移后值已是裸对象，再跑不会被二次处理）；在 main.ts 里 app.use(pinia) 之前调用。
 */
const LEGACY_KEYS = ['insight-workspace', 'insight-ai-settings']

export function migrateLegacyStorage(): void {
  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && 'state' in parsed) {
        const inner = (parsed as { state?: unknown }).state
        if (inner && typeof inner === 'object') {
          localStorage.setItem(key, JSON.stringify(inner))
        }
      }
    } catch {
      /* 旧值损坏就直接忽略，Pinia 会用默认值 */
    }
  }
}
