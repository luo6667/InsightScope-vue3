import { io, type Socket } from "socket.io-client";

import { getAccessToken, notifyUnauthorized } from "./auth";

let socket: Socket | null = null;

/**
 * socket.io 连接地址：
 * Next.js rewrites 不支持 WebSocket，socket 必须直连 Express（不走 /api 代理）。
 * 开发默认直连本地后端 5176；生产同域反代时设 NEXT_PUBLIC_SOCKET_URL=""（同源）即可。
 */
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5176";

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      // 握手携带访问口令（后端 ACCESS_TOKEN 启用时校验，未启用则忽略）
      auth: { token: getAccessToken() },
    });
    // 口令错误被拒：通知全局弹出口令输入
    socket.on("connect_error", (err) => {
      if (err.message === "unauthorized") notifyUnauthorized();
    });
  }
  return socket;
}

/** 访问口令变化后调用：更新握手凭据并重连（socket.io 重连是新连接） */
export function refreshSocketAuth(): void {
  if (!socket) return;
  socket.auth = { token: getAccessToken() };
  if (socket.connected) socket.disconnect();
  socket.connect();
}
