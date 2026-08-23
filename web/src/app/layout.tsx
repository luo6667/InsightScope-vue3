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
