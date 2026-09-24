import type { MaybeRefOrGetter } from 'vue'
import { shallowRef, toValue, watch } from 'vue'

import { getSocket } from '@/lib/socket'

/**
 * 📘 composables/useDatasetSocket.ts —— 取代旧 hooks/useDatasetSocket.ts
 *
 * 统一的数据集 socket 监听：
 * - join 当前数据集房间（断线重连后重新 join：socket.io 重连是新连接、房间成员已清空）；
 * - 订阅事件，卸载时自动 off + leave（Vue 用 watch 的 onCleanup，组件卸载时自动执行）。
 *
 * React 版用 ref 保存最新 handlers 以免父组件每次渲染都重订阅；
 * Vue 里父组件传入的对象本来就只在 setup 时创建一次，这里仍保留同步逻辑以对齐语义。
 * 供监控台（实时评论/告警/模拟状态）与智能分析页（进度推送）复用。
 */
export function useDatasetSocket(
  datasetId: MaybeRefOrGetter<string>,
  handlers: Record<string, (...args: unknown[]) => void>,
): void {
  const handlersRef = shallowRef(handlers)
  watch(
    () => handlers,
    (value) => {
      handlersRef.value = value
    },
  )

  watch(
    () => toValue(datasetId),
    (id, _previous, onCleanup) => {
      if (!id) return
      const socket = getSocket()
      const join = () => socket.emit('join-dataset', id)
      join()
      // 重连后重新加入房间，否则实时推送静默丢失
      socket.on('connect', join)
      const entries = Object.entries(handlersRef.value)
      for (const [event, fn] of entries) {
        socket.on(event, fn as never)
      }
      onCleanup(() => {
        socket.off('connect', join)
        for (const [event, fn] of entries) {
          socket.off(event, fn as never)
        }
        socket.emit('leave-dataset', id)
      })
    },
    { immediate: true },
  )
}
