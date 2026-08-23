'use client';

import { useEffect } from 'react';

/** 全局错误边界（Next.js App Router error.tsx）：渲染异常时展示可恢复错误页 */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[app] render error:', error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-6xl">😵</p>
      <h1 className="text-2xl font-bold tracking-[-0.02em]">页面出错了</h1>
      <p className="max-w-md text-sm text-ink-400">渲染时发生异常，可点击下方按钮重试。</p>
      <button
        type="button"
        onClick={() => { reset(); }}
        className="cursor-pointer rounded-lg bg-accent-500 px-5 py-2 text-sm font-semibold text-accent-950 transition-opacity hover:opacity-90"
      >
        重试
      </button>
    </main>
  );
}
