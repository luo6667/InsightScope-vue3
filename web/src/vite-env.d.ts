/// <reference types="vite/client" />

/**
 * 📘 vite-env.d.ts —— 环境变量类型
 *
 * 对应 Next 时期的 NEXT_PUBLIC_*：Vite 只注入 VITE_ 前缀的变量，且从 import.meta.env 读取。
 */
interface ImportMetaEnv {
  /** 前端请求 API 的公共前缀，默认 /api */
  readonly VITE_API_BASE?: string
  /** socket.io 直连地址；生产同源反代时留空 */
  readonly VITE_SOCKET_URL?: string
}
