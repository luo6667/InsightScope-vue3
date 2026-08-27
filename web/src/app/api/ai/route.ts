import { z } from 'zod';

export const runtime = 'nodejs';

/**
 * AI 流式对话转发（Next route handler）
 *
 * 浏览器 → POST /api/ai → 服务端转发到 OpenAI / DeepSeek 兼容接口 → SSE 透传回浏览器。
 * - apiKey 由用户在前端填写，随请求体传给本服务端（仅本次请求内存使用，不落库、不打印）
 * - 解决了浏览器直连第三方 AI 的 CORS 问题（OpenAI 官方会拒绝浏览器直连）
 * - 客户端断开（AbortSignal）时同步中止上游请求，避免泄漏连接
 */

/** 客户端流式请求体（与前端 lib/ai.ts 的 AiConfig 对应） */
const chatSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  apiKey: z.string().trim().min(1).max(1024),
  model: z.string().trim().min(1).max(128),
  messages: z
    .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }))
    .min(1)
    .max(50),
  temperature: z.number().min(0).max(2).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? '参数校验失败';
    return Response.json({ error: `参数校验失败：${msg}` }, { status: 400 });
  }
  const { baseUrl, apiKey, model, messages, temperature } = parsed.data;
  const base = baseUrl.replace(/\/+$/, '');

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: temperature ?? 0.7,
        max_tokens: 2000,
      }),
      // 客户端断开时中止上游请求
      signal: req.signal,
    });
  } catch {
    return Response.json({ error: '无法连接 AI 服务，请检查 Base URL' }, { status: 502 });
  }

  if (!upstream.ok) {
    // 透传 AI 的错误响应（OpenAI 兼容格式多为 JSON：{ error: { message } }）
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  // SSE 透传：保持 AI 的 text/event-stream 原样返回给浏览器
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
