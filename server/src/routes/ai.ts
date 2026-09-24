/**
 * 📘 routes/ai.ts —— AI 流式对话转发（POST /api/ai，SSE 透传）
 *
 * 原为 Next.js Route Handler（web/src/app/api/ai/route.ts），前端改 Vue SPA 后搬进本服务，
 * 路径 /api/ai 与请求/响应格式保持不变（前端 web/src/lib/ai.ts 的 streamChat 对应）。
 * 链路：浏览器 → POST /api/ai（本文件）→ 转发到用户配置的 OpenAI 兼容接口
 *       → ${baseUrl}/chat/completions（stream: true）→ SSE 原样透传回浏览器。
 * 要点：
 * - apiKey 由前端随请求体传来，仅本次请求内存使用，不落库、不打印；
 * - baseUrl 走 SSRF 校验（与分析接口 analysis.ts 同一口径：只允许公网 http/https），
 *   防止把本服务当成访问内网的代理；
 * - 客户端断开（req 'close'）或上游流中断时 abort 上游请求，避免连接泄漏；
 * - 鉴权：挂在 app.use("/api", requireAccessToken) 之后，与其它 /api/* 一样受访问口令保护。
 */
import { Router } from "express";
import { pipeline } from "node:stream/promises";
import { validate, aiChatBodySchema } from "../validation.js";
import { assertPublicHttpUrl } from "../utils/urlSafety.js";

const router = Router();

// 转发 AI 流式对话：POST /api/ai
router.post("/", validate({ body: aiChatBodySchema }), async (req, res) => {
  const { baseUrl, apiKey, model, messages, temperature } = req.body;
  // SSRF 防护：只允许公网 http/https（与分析接口一致；返回去除尾部斜杠的规范化 URL）
  const base = assertPublicHttpUrl(baseUrl, "baseUrl");
  const key = String(apiKey).trim().replace(/\s+/g, "");

  // 客户端断开 → abort 上游请求（headers 尚未发出的阶段也生效，避免客户端走了上游还挂着）
  const controller = new AbortController();
  let streamDone = false; // SSE 是否已正常推完（区分 socket hang up 与业务错误）
  req.on("close", () => {
    if (!streamDone) controller.abort();
  });

  let upstream: Response;
  try {
    // 上游连接失败（DNS/拒连/证书/网络不可达）：502 交前端提示检查 Base URL
    upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: temperature ?? 0.7,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });
  } catch {
    // 客户端主动断开导致的 abort 不算上游故障
    if (!req.aborted) {
      res.status(502).json({ error: "无法连接 AI 服务，请检查 Base URL" });
    }
    return;
  }

  // 上游非 2xx：透传状态码与错误体（OpenAI 兼容格式多为 { error: { message } }，前端会解析显示）
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    if (req.aborted) return;
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    res.send(text);
    return;
  }

  // SSE 透传：保持上游 text/event-stream 原样返回给浏览器
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // 立刻把响应头发给浏览器，前端 fetch 随即拿到 res.body 可读流

  try {
    if (upstream.body) {
      await pipeline(upstream.body as unknown as NodeJS.ReadableStream, res);
    } else {
      res.end();
    }
  } catch (e) {
    // 响应头已发出，无法再走统一错误中间件：记日志即可（客户端断开是常见情况）
    console.warn("[ai] 流中断:", e instanceof Error ? e.message : e);
  } finally {
    streamDone = true;
  }
});

export default router;
