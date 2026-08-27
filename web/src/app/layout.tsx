/**
 * 📘 app/layout.tsx —— 根布局（Server Component，无 'use client'）
 *
 * Next App Router 约定：layout.tsx 包裹所有页面，这里是全站 HTML 骨架：
 * - metadata：页面标题 / 描述（SEO）；
 * - 主题初始化脚本（beforeInteractive）：在 React 加载前读 localStorage 设置
 *   data-theme，避免首帧浅/深色闪烁（FOUC）；
 * - Providers（React Query + Toast）和 AccessGate（访问口令门禁）包住 children。
 * 这个文件本身在服务端渲染，子组件才是客户端边界（各自标 'use client'）。
 */
import '@/index.css';

import type { Metadata } from 'next';
import Script from 'next/script';

import AccessGate from '@/components/AccessGate';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: '舆情雷达 InsightScope',
  description: 'AI 用户评论分析与舆情监控平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* 主题初始化：在 CSS 与 React 加载前设置 data-theme，避免首帧浅/深色闪烁 */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('insight-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`}
        </Script>
        <Providers>
          <AccessGate>{children}</AccessGate>
        </Providers>
      </body>
    </html>
  );
}
