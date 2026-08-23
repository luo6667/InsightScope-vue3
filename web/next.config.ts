import type { NextConfig } from 'next';

/** 独立 Express 后端地址（insight-server，保留前后端分离架构） */
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:5176';

const nextConfig: NextConfig = {
  // React Compiler：编译期自动记忆化，组件里无需手写 useMemo / useCallback / memo（Next 16 顶层配置）
  reactCompiler: true,
  async rewrites() {
    return [
      // API 代理到 Express 后端（socket.io 不走这里——rewrites 不支持 WebSocket，
      // 由前端 socket.io-client 直连 Express，见 src/lib/socket.ts）
      { source: '/api/:path*', destination: `${API_TARGET}/api/:path*` },
    ];
  },
};

export default nextConfig;
