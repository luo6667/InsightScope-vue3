/**
 * 📘 next.config.ts —— Next.js 16 配置文件
 *
 * 两个关键配置：
 * - reactCompiler: true：React Compiler 在编译期自动记忆化，组件里不用手写
 *   useMemo / useCallback / memo，写“直觉的代码”也不担心多余重渲染（Next 16 顶层开关）；
 * - rewrites（仅开发模式）：把 /api/* 代理到 Express(5176)，让前端页面里直接
 *   fetch('/api/...') 就能同源请求；生产由 nginx 分发（见 README），Next 不再代理。
 * 注意：socket.io 不走 rewrites（它不支持 WebSocket），前端 socket 直连后端（见 lib/socket.ts）。
 */
import type { NextConfig } from 'next';

/** 独立 Express 后端地址（insight-server，保留前后端分离架构） */
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:5176';

const nextConfig: NextConfig = {
  // React Compiler：编译期自动记忆化，组件里无需手写 useMemo / useCallback / memo（Next 16 顶层配置）
  reactCompiler: true,
  devIndicators: false,
  async rewrites() {
    // 开发模式：Next 直接代理 /api 到 Express（socket.io 不走这里——rewrites 不支持 WebSocket，
    // 由前端 socket.io-client 直连 Express，见 src/lib/socket.ts）。
    // 生产模式：nginx 反代分发（/api/*、/socket.io/* → Express，/api/ai → 本 Next 的 route handler），
    //           Next 不再代理任何请求，故这里返回空。
    if (process.env.NODE_ENV === 'development') {
      return [{ source: '/api/:path*', destination: `${API_TARGET}/api/:path*` }];
    }
    return [];
  },
};

export default nextConfig;
