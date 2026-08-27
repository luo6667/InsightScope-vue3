import { CardSkeleton } from '@/components/ui';

/** 路由切换时的页面级 loading(骨架屏,复用共享 CardSkeleton 保持视觉一致) */
export default function SiteLoading() {
  return (
    <div className="space-y-6">
      {/* 页头骨架 */}
      <div className="animate-pulse">
        <div className="h-7 w-48 rounded-md bg-ink-800" />
        <div className="mt-2 h-3.5 w-72 rounded bg-ink-800" />
      </div>
      <div className="grid gap-4">
        <CardSkeleton rows={3} />
        <CardSkeleton rows={4} />
        <CardSkeleton rows={2} />
      </div>
    </div>
  );
}
