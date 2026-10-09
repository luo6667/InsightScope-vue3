import { createRouter, createWebHistory } from 'vue-router'

/**
 * 📘 router/index.ts —— 取代 Next 的 App Router 文件路由
 *
 * 对应关系（旧 app/(site)/<name>/page.tsx 只是 200B 的薄壳，真正内容在 src/views/*.tsx）：
 *   /datasets  → views/DatasetsView.vue
 *   /import    → views/ImportView.vue
 *   /comments  → views/CommentsView.vue（评论浏览：无限滚动 + 虚拟滚动）
 *   /dashboard → views/DashboardView.vue
 *   /analysis  → views/AnalysisView.vue
 *   /reports   → views/ReportsView.vue
 *   /alerts    → views/AlertCenterView.vue
 *   /settings  → views/SettingsView.vue
 *   兜底        → views/NotFoundView.vue（对应 app/not-found.tsx）
 *
 * 视图全部改为动态 import：配合 App.vue 里 <Suspense> + PageLoading 的骨架屏，
 * 等价于 Next 时代 app/(site)/loading.tsx 的路由级 loading，同时天然做了代码分割。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/datasets' },
    {
      path: '/datasets',
      name: 'datasets',
      component: () => import('@/views/DatasetsView.vue'),
      meta: { title: '数据集' },
    },
    {
      path: '/import',
      name: 'import',
      component: () => import('@/views/ImportView.vue'),
      meta: { title: '导入数据' },
    },
    {
      path: '/comments',
      name: 'comments',
      component: () => import('@/views/CommentsView.vue'),
      meta: { title: '评论浏览' },
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: { title: '监控台' },
    },
    {
      path: '/analysis',
      name: 'analysis',
      component: () => import('@/views/AnalysisView.vue'),
      meta: { title: '智能分析' },
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('@/views/ReportsView.vue'),
      meta: { title: '舆情报告' },
    },
    {
      path: '/alerts',
      name: 'alerts',
      component: () => import('@/views/AlertCenterView.vue'),
      meta: { title: '告警中心' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: '设置' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: '页面不存在' },
    },
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    // 仅查询参数变化（切换数据集 useCurrentDataset 用的是 router.replace）时不滚动
    if (to.path === from.path) return false
    return { top: 0 }
  },
})

// 对应 Next 的 metadata.title（document.title 随路由更新）
router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · 舆情雷达 InsightScope` : '舆情雷达 InsightScope'
})

export default router
