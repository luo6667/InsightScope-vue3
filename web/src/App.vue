<script setup lang="ts">
/**
 * 📘 App.vue —— 取代 app/layout.tsx + app/(site)/layout.tsx 的根结构
 *
 * 层级与 Next 时期一致：
 *   Providers（react-query + Toaster）→ 现在由 main.ts 的 VueQueryPlugin + 这里的 <Toaster> 承担
 *   └ AccessGate（访问口令门禁）
 *     └ SiteLayout（悬浮岛导航 + 内容区）
 *       └ RouterView（当前视图）
 */
import { Toaster } from 'vue-sonner'

import AccessGate from '@/components/AccessGate.vue'
import ErrorBoundary from '@/components/ErrorBoundary.vue'
import PageLoading from '@/components/PageLoading.vue'
import SiteLayout from '@/layouts/SiteLayout.vue'
</script>

<template>
  <Toaster theme="dark" position="top-center" rich-colors />
  <AccessGate>
    <SiteLayout>
      <!-- ErrorBoundary ↔ Next 的 app/error.tsx；Suspense 的 fallback ↔ app/(site)/loading.tsx（路由懒加载） -->
      <ErrorBoundary>
        <Suspense>
          <RouterView />
          <template #fallback>
            <PageLoading />
          </template>
        </Suspense>
      </ErrorBoundary>
    </SiteLayout>
  </AccessGate>
</template>
