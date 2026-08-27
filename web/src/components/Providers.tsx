/**
 * 📘 Providers.tsx —— 全局客户端 Provider（技术栈：TanStack Query + sonner）
 *
 * 挂在根布局最外层，给整棵组件树提供两个全局能力：
 * - QueryClientProvider：React Query 的缓存/请求上下文——所有 useQuery / useMutation
 *   都依赖它；这里统一配置了 retry:1、refetchOnWindowFocus:false（别让窗口聚焦狂发请求）；
 * - Toaster：全局 toast 通知（导入成功 / 删除成功等提示统一出口）。
 * 为什么必须有它？React Query 的 hook 必须在 Provider 包裹范围内才能用。
 */
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

/** 全局客户端 Provider：React Query 缓存 + Toast 通知 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster theme="dark" position="top-center" richColors />
      {children}
    </QueryClientProvider>
  );
}
