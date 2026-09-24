// 访问口令（ACCESS_TOKEN）的浏览器端存储
// 与后端「访问口令认证」配套：请求带 Authorization: Bearer <token>，socket 握手带 auth.token
import { readStorage, removeStorage, writeStorage } from './storage'

const STORAGE_KEY = 'insight-access-token'

/** 401 时派发的事件名：AccessGate 监听后展示口令输入 */
export const UNAUTHORIZED_EVENT = 'insight:unauthorized'
/** 口令已设置/更新后派发：各页面可据此重试 */
export const TOKEN_SET_EVENT = 'insight:token-set'

export function getAccessToken(): string {
  return readStorage(STORAGE_KEY) ?? ''
}

export function setAccessToken(token: string): void {
  const t = token.trim()
  if (t) writeStorage(STORAGE_KEY, t)
  else removeStorage(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent(TOKEN_SET_EVENT, { detail: { token: t } }))
}

export function clearAccessToken(): void {
  removeStorage(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent(TOKEN_SET_EVENT, { detail: { token: '' } }))
}

/** 通知全局进入未授权状态（401 / socket 拒绝时调用，去抖避免并发请求触发多次弹层） */
let lastUnauthorizedAt = 0
export function notifyUnauthorized(): void {
  const now = Date.now()
  if (now - lastUnauthorizedAt < 1500) return
  lastUnauthorizedAt = now
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
}
