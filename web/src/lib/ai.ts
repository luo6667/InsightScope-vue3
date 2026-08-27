/**
 * 📘 lib/ai.ts —— AI 流式对话（SSE 打字机效果）
 *
 * 请求 Next 的 /api/ai（route handler 转发到 AI 服务），响应是 text/event-stream：
 * - 用 ReadableStream 的 reader 逐块读，按 \n 切行，解析以 data: 开头的行里的 JSON；
 * - 每次取 delta 增量内容回调 onDelta()，前端逐字追加，形成打字机效果；
 * - 处理了：多 data 块跨 chunk 拼接、[DONE] 结束标记、AbortSignal 中止、
 *   附加访问口令（proxy 启用时 /api/* 需要 Bearer）。
 */
import type { AiConfig } from "../store/settings";
import { getAccessToken } from "./auth";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * AI 流式对话（SSE 打字机效果）
 *
 * 浏览器 → POST /api/ai（Next route handler）→ 服务端转发到 OpenAI / DeepSeek 兼容接口 → SSE 透传。
 * apiKey 由用户在前端「设置」页填写（存 localStorage），随请求体传给服务端，仅本次请求内存使用、不落库。
 * 好处：解决浏览器直连第三方 AI 的 CORS 问题（OpenAI 官方会拒绝），key 不直接暴露在请求 URL。
 */
export async function streamChat(
  cfg: AiConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, "");
  const key = cfg.apiKey.trim().replace(/\s+/g, "");
  if (!key) throw new Error("请先在「设置」中填入 API key");
  if (!base) throw new Error("请先在「设置」中填写 Base URL");
  if (!/^https?:\/\//i.test(base)) {
    throw new Error("Base URL 需以 http(s):// 开头（如 https://api.openai.com/v1）");
  }
  if (!/^[\x20-\x7e]+$/.test(key)) {
    throw new Error("API key 包含非 ASCII 字符（可能复制带了多余文字/换行），请重新粘贴纯 key");
  }
  if (!/^[\x20-\x7e]+$/.test(base)) {
    throw new Error("Base URL 包含非 ASCII 字符，请检查");
  }

  const token = getAccessToken();
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // proxy(访问控制)启用时 /api/* 需要 Bearer token,与 axios 拦截器行为一致
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      baseUrl: base,
      apiKey: key,
      model: cfg.model.trim(),
      messages,
      temperature: cfg.temperature,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    // 优先提取 AI / route handler 返回的错误信息
    let msg = `AI 请求失败（${res.status}）`;
    try {
      const j = JSON.parse(text) as { error?: string | { message?: string } };
      if (typeof j.error === "string" && j.error) msg = j.error;
      else if (j.error && typeof j.error === "object" && j.error.message) msg = j.error.message;
    } catch {
      if (text) msg = `${msg}：${text.slice(0, 200)}`;
    }
    throw new Error(msg);
  }

  // SSE 解析（route handler 透传 AI 的 data: 行，格式与直连一致）
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const delta = j.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return full;
}
