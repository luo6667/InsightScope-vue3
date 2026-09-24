<script setup lang="ts">
/**
 * 📘 SiteLayout.vue —— 取代 app/(site)/layout.tsx
 *
 * 主站布局：桌面悬浮岛导航 + 移动端底部 Tab + 内容区路由淡入。
 * React → Vue 的对应关系：
 * - next/link 的 <Link> → vue-router 的 <RouterLink>（全局注册，无需 import）；
 * - usePathname() → useRoute().path；
 * - motion/react 的 motion.div/motion.span + layoutId → motion-v（同名 API）；
 * - lucide-react 图标 → lucide-vue-next（同名图标、同名 props）。
 */
import {
  Bell,
  BrainCircuit,
  Database,
  FileText,
  Gauge,
  Moon,
  Radar,
  Settings,
  Sun,
  Upload,
} from 'lucide-vue-next'
import { motion } from 'motion-v'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useTheme } from '@/composables/useTheme'
import IslandItem from '@/layouts/IslandItem.vue'

interface NavItem {
  to: string
  label: string
  icon: typeof Database
  mobile?: boolean
}

const nav: NavItem[] = [
  { to: '/datasets', label: '数据集', icon: Database, mobile: true },
  { to: '/import', label: '导入数据', icon: Upload },
  { to: '/dashboard', label: '监控台', icon: Gauge, mobile: true },
  { to: '/analysis', label: '智能分析', icon: BrainCircuit, mobile: true },
  { to: '/reports', label: '舆情报告', icon: FileText, mobile: true },
  { to: '/alerts', label: '告警中心', icon: Bell, mobile: true },
]

const route = useRoute()
const { theme, toggleTheme } = useTheme()

const mobileNav = computed(() => nav.filter((n) => n.mobile))
const isActive = (to: string) => route.path === to
</script>

<template>
  <div class="min-h-[100dvh]">
    <!-- 桌面悬浮岛（lg 以上） -->
    <nav
      class="island-glass fixed left-6 top-1/2 z-50 hidden w-56 -translate-y-1/2 rounded-3xl py-5 lg:block"
    >
      <div class="mb-3 flex items-center gap-3 border-b border-ink-800/80 px-4 pb-4">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-400 to-accent-600 text-accent-950 shadow-[0_4px_14px_-4px_rgba(245,158,11,0.55)]"
        >
          <Radar :size="18" :stroke-width="2.4" />
        </span>
        <div class="min-w-0">
          <div class="text-[15px] font-semibold tracking-tight text-ink-100">舆情雷达</div>
          <div class="text-[11.5px] text-ink-400">InsightScope</div>
        </div>
      </div>

      <div
        class="px-2.5 pb-1.5 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-500"
      >
        数据
      </div>
      <div class="space-y-1 px-2.5">
        <IslandItem
          v-for="item in nav.slice(0, 2)"
          :key="item.to"
          :to="item.to"
          :label="item.label"
          :icon="item.icon"
          :active="isActive(item.to)"
        />
      </div>

      <div
        class="px-2.5 pb-1.5 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-500"
      >
        洞察
      </div>
      <div class="space-y-1 px-2.5">
        <IslandItem
          v-for="item in nav.slice(2)"
          :key="item.to"
          :to="item.to"
          :label="item.label"
          :icon="item.icon"
          :active="isActive(item.to)"
        />
      </div>

      <div class="mt-4 border-t border-ink-800/80 px-2.5 pt-3">
        <div class="flex items-center gap-1.5">
          <RouterLink to="/settings" class="flex-1">
            <span
              class="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all duration-150"
              :class="
                isActive('/settings')
                  ? 'bg-accent-500/12 font-medium text-accent-300'
                  : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-200'
              "
            >
              <Settings :size="17" :stroke-width="2" />
              设置
            </span>
          </RouterLink>
          <button
            :title="theme === 'dark' ? '切换浅色' : '切换深色'"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ink-700 text-ink-400 transition-colors hover:text-accent-600 dark:hover:text-accent-400"
            @click="toggleTheme"
          >
            <Sun v-if="theme === 'dark'" :size="15" />
            <Moon v-else :size="15" />
          </button>
        </div>
      </div>
    </nav>

    <!-- 移动端底部 Tab（lg 以下） -->
    <nav class="island-glass fixed bottom-3 left-3 right-3 z-50 rounded-2xl px-2 py-2 lg:hidden">
      <div class="flex items-center justify-around">
        <RouterLink
          v-for="item in mobileNav"
          :key="item.to"
          :to="item.to"
          class="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px]"
          :class="isActive(item.to) ? 'text-accent-600 dark:text-accent-400' : 'text-ink-400'"
        >
          <component :is="item.icon" :size="18" :stroke-width="2" />
          {{ item.label }}
        </RouterLink>
        <button
          class="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] text-ink-400"
          @click="toggleTheme"
        >
          <Sun v-if="theme === 'dark'" :size="18" />
          <Moon v-else :size="18" />
          主题
        </button>
      </div>
    </nav>

    <!-- 内容区（路由切换淡入，key=当前路径，对应 React 版 key={pathname}） -->
    <main class="px-4 pb-24 pt-2 sm:px-6 lg:pl-28 lg:pb-6">
      <motion.div
        :key="route.path"
        :initial="{ opacity: 0, y: 8 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.18, ease: 'easeOut' }"
      >
        <slot />
      </motion.div>
    </main>
  </div>
</template>
