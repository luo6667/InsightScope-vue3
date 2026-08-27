'use client';

import { useEffect } from 'react';

/**
 * 全局错误边界(global-error.tsx)：根 layout 层渲染异常时的兜底。
 * 与 error.tsx 不同,这里必须自带 <html>/<body>(根布局已失效),故样式不依赖共享令牌。
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[app] global render error:', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0b1220', color: '#eef2fa' }}>
        <main
          style={{
            minHeight: '60vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: '0 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 56, margin: 0 }}>💥</p>
          <h1 style={{ fontSize: 24, margin: 0 }}>应用启动失败</h1>
          <p style={{ maxWidth: 420, fontSize: 14, color: '#a2b2c9', margin: 0 }}>
            发生了一个无法恢复的错误,请刷新页面重试;若问题持续,请联系管理员。
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              borderRadius: 8,
              background: '#f59e0b',
              color: '#451a03',
              border: 'none',
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
