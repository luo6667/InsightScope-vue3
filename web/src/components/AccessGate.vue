<script setup lang="ts">
/**
 * 📘 AccessGate.vue —— 取代 components/AccessGate.tsx
 *
 * 访问口令门禁（决策③A：真正的鉴权在后端 Express 的 requireAccessToken，这里只是体验层）：
 * - 启动时探测 GET /api/auth/status：后端未启用认证（开发模式）→ 直接放行；
 * - 已启用且无口令 → 全屏弹层要求输入 ACCESS_TOKEN；
 * - 任一 API 返回 401 或 socket 握手被拒（unauthorized）→ 弹层要求重新输入；
 * - 提交后用真实请求验证口令，通过才解锁并刷新数据。
 *
 * React → Vue：useState → ref，useEffect(挂载/卸载) → onMounted/onUnmounted，
 * useQueryClient() 在 vue-query 里同名同用法。
 */
import { useQueryClient } from '@tanstack/vue-query'
import { KeyRound, Loader2, Lock } from 'lucide-vue-next'
import { onMounted, onUnmounted, ref } from 'vue'

import { Button, Card, Field, Input } from '@/components/ui'
import { getAccessToken, setAccessToken, UNAUTHORIZED_EVENT } from '@/lib/auth'
import { refreshSocketAuth } from '@/lib/socket'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

type GateState = 'checking' | 'locked' | 'open'

const queryClient = useQueryClient()
const gate = ref<GateState>('checking')
const token = ref('')
const error = ref('')
const busy = ref(false)

let cancelled = false

// 启动探测：后端是否要求口令
onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE}/auth/status`)
    const data = (await res.json()) as { authRequired?: boolean }
    if (cancelled) return
    if (data.authRequired && !getAccessToken()) gate.value = 'locked'
    else gate.value = 'open'
  } catch {
    // 探测失败（后端未启动等）：先放行，让页面自身报错
    if (!cancelled) gate.value = 'open'
  }
})

// 401 / socket 拒绝 → 锁定
const onUnauthorized = () => {
  gate.value = 'locked'
}

onMounted(() => window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized))
onUnmounted(() => {
  cancelled = true
  window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
})

const submit = async () => {
  const t = token.value.trim()
  if (!t || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // 用真实受保护请求验证口令
    const res = await fetch(`${API_BASE}/scenarios`, {
      headers: { Authorization: `Bearer ${t}` },
    })
    if (res.status === 401) {
      error.value = '口令不正确，请重试'
      return
    }
    if (!res.ok) {
      error.value = '服务器响应异常，请稍后重试'
      return
    }
    setAccessToken(t)
    refreshSocketAuth() // 用新口令重连 socket
    void queryClient.invalidateQueries() // 刷新所有已失败的数据
    gate.value = 'open'
  } catch {
    error.value = '无法连接服务器，请检查网络'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    v-if="gate === 'checking'"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/90"
  >
    <Loader2 :size="22" class="animate-spin text-ink-400" />
  </div>

  <slot v-else-if="gate === 'open'" />

  <div v-else class="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/90 px-6">
    <Card class="w-full max-w-sm p-6">
      <div class="flex items-center gap-3">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400"
        >
          <Lock :size="18" />
        </span>
        <div>
          <div class="text-[15px] font-semibold text-ink-100">需要访问口令</div>
          <div class="text-xs text-ink-400">请输入管理员提供的访问口令（ACCESS_TOKEN）</div>
        </div>
      </div>
      <form class="mt-5 space-y-4" @submit.prevent="submit">
        <Field label="访问口令">
          <div class="relative">
            <KeyRound
              :size="14"
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
            />
            <Input v-model="token" type="password" autofocus placeholder="输入口令" class="pl-9" />
          </div>
        </Field>
        <div v-if="error" class="text-[13px] text-red-400">{{ error }}</div>
        <Button variant="primary" class="w-full" :disabled="!token.trim() || busy">
          <Loader2 v-if="busy" :size="15" class="animate-spin" />
          {{ busy ? '验证中…' : '进入系统' }}
        </Button>
      </form>
    </Card>
  </div>
</template>
