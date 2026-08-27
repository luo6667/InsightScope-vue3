/**
 * 📘 hooks/useDatasetSocket.ts —— socket 事件订阅封装（技术栈：socket.io-client）
 *
 * 把“加入数据集房间 + 订阅事件 + 清理退订”封装成一个 hook：
 * - 进入时 emit('join-dataset')，断线重连后自动重新 join（socket.io 重连是新连接，房间会丢）；
 * - handlers 用 ref 保存最新引用：只在 datasetId 变化时重新订阅，
 *   避免父组件每次渲染（handlers 新引用）都重订阅导致事件抖动；
 * - 卸载时自动 off + leave。
 * 监控台（实时评论/告警）和分析页（进度推送）都复用它。
 */
import { useEffect, useRef } from "react";

import { getSocket } from "../lib/socket";

/**
 * 统一的数据集 socket 监听：
 * - join 当前数据集房间（含断线重连后重新 join，socket.io 重连是新连接、房间成员已清空）
 * - 订阅事件，卸载时自动 off + leave
 * 供监控台（实时评论/告警/模拟状态）与分析页（进度推送）复用。
 *
 * handlers 用 ref 保存最新引用：订阅/退订只在 datasetId 变化时进行，
 * 避免父组件每次渲染（handlers 新引用）都重订阅导致事件抖动。
 */
export function useDatasetSocket(
  datasetId: string,
  handlers: Record<string, (...args: unknown[]) => void>
) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!datasetId) return;
    const socket = getSocket();
    const join = () => socket.emit("join-dataset", datasetId);
    join();
    // 重连后重新加入房间，否则实时推送静默丢失
    socket.on("connect", join);
    for (const [event, fn] of Object.entries(handlersRef.current)) {
      socket.on(event, fn as never);
    }
    return () => {
      socket.off("connect", join);
      for (const [event, fn] of Object.entries(handlersRef.current)) {
        socket.off(event, fn as never);
      }
      socket.emit("leave-dataset", datasetId);
    };
  }, [datasetId]);
}
