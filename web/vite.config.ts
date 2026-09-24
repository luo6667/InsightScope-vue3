import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import { defineConfig, loadEnv } from 'vite';

/**
 * 📘 vite.config.ts —— 取代 next.config.ts
 *
 * 与 Next 时期对应的三件事：
 * 1. rewrites('/api/:path*' → API_TARGET)  → server.proxy（同样只在 dev 生效，生产由 nginx 分发）；
 * 2. socket.io 不走代理（WebSocket 直连后端），前端用 VITE_SOCKET_URL 直连 5176；
 * 3. Element Plus 按需引入（决策①B：EP 只用于复杂交互组件）。
 */
export default defineConfig(({ mode }) => {
  // 第三个参数传 '' 才能读到不带 VITE_ 前缀的变量（API_TARGET 只在构建/dev 期用，不进客户端）
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_TARGET || 'http://localhost:5176';

  return {
    plugins: [
      vue(),
      tailwindcss(),
      // Element Plus 按需：组件 + ElMessage/ElMessageBox 等 API，dts 供 TS/编辑器识别
      AutoImport({
        resolvers: [ElementPlusResolver()],
        dts: 'src/types/auto-imports.d.ts',
      }),
      Components({
        // dirs 置空：本项目自己的组件走显式 import（@/components/ui），只让 EP 走自动注册
        dirs: [],
        resolvers: [ElementPlusResolver()],
        dts: 'src/types/components.d.ts',
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 3000,
      proxy: {
        // 对应 Next 的 rewrites：dev 下 /api/* 代理到 Express(5176)
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 3000,
    },
  };
});
