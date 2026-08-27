import Link from 'next/link';

/** 404 页面：路由不存在时的统一兜底 */
export default function NotFoundPage() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-6xl">🧭</p>
      <h1 className="text-2xl font-bold tracking-[-0.02em]">页面不存在</h1>
      <p className="max-w-md text-sm text-ink-400">你访问的地址不存在或已被移动,请检查链接是否正确。</p>
      <Link
        href="/datasets"
        className="rounded-lg bg-accent-500 px-5 py-2 text-sm font-semibold text-accent-950 transition-opacity hover:opacity-90"
      >
        返回监控台
      </Link>
    </main>
  );
}
