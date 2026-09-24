/**
 * 📘 lib/env.ts —— 运行期配置（Vite 构建时注入的 import.meta.env，单一来源）
 *
 * 之前 baseURL 在 api/client.ts、lib/ai.ts、api/api.ts 各写一份，改一处漏一处；
 * 现在统一从这里取。`.env` / `.env.example` 见仓库根目录说明：
 * - VITE_API_BASE：REST 基础路径，默认同源 `/api`（生产 nginx 把 /api 反代到后端）；
 * - VITE_SOCKET_URL：socket.io 地址（见 lib/socket.ts，开发默认直连 5176）。
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api'

/**
 * 把接口路径拼成可请求的 URL（fetch / `<a href>` 等不走 axios 的场景使用）。
 * 例：apiUrl('/ai') → '/api/ai'；VITE_API_BASE 配成绝对地址时自动跟随。
 */
export function apiUrl(path: string): string {
  const base = API_BASE.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
