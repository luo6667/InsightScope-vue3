import type { MaybeRefOrGetter } from 'vue'
import { toValue, watch } from 'vue'

import { getSocket } from '@/lib/socket'

/** socket 事件回调：载荷形状由各视图自行收窄（后端事件载荷没有共享类型定义） */
export type SocketHandlers = Record<string, (...args: unknown[]) => void>

/**
 * 📘 composables/useDatasetSocket.ts —— 取代旧 hooks/useDatasetSocket.ts
 *
 * 统一的数据集 socket 监听：
 * - join 当前数据集房间（断线重连后重新 join：socket.io 重连是新连接、房间成员已清空）；
 * - 订阅事件，卸载时自动 off + leave（Vue 用 watch 的 onCleanup，组件卸载时自动执行）。
 *
 * React 版用 ref 保存最新 handlers 以免父组件每次渲染都重订阅；Vue 里 handlers 是
 * setup 作用域里的普通对象、引用恒定，因此直接闭包引用即可（原先同步 handlersRef 的
 * watch 永远不触发，已删除）。
 * 供监控台（实时评论/告警/模拟状态）与智能分析页（进度推送）复用。
 */
export function useDatasetSocket(
  datasetId: MaybeRefOrGetter<string>,
  handlers: SocketHandlers,
): void {
  watch(
    () => toValue(datasetId),
    (id, _previous, onCleanup) => {
      if (!id) return
      const socket = getSocket()
      const join = () => socket.emit('join-dataset', id)
      join()
      // 重连后重新加入房间，否则实时推送静默丢失
      socket.on('connect', join)
      const entries = Object.entries(handlers)
      for (const [event, fn] of entries) {
        socket.on(event, fn)
      }
      onCleanup(() => {
        socket.off('connect', join)
        for (const [event, fn] of entries) {
          socket.off(event, fn)
        }
        socket.emit('leave-dataset', id)
      })
    },
    { immediate: true },
  )
}
