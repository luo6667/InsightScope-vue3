import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import request from "supertest";
import aiRouter from "../src/routes/ai.js";
import { HttpError } from "../src/utils/httpUtils.js";
import { aiChatBodySchema } from "../src/validation.js";

/** 与 index.ts 一致：HttpError → 对应状态码，其余 500 */
function errorJson(): express.ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err.message });
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  app.use(errorJson());
  return app;
}

const validBody = {
  baseUrl: "https://api.example.com/v1/",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "你好" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aiChatBodySchema", () => {
  it("接受合法请求体，temperature 可选", () => {
    const r = aiChatBodySchema.parse(validBody);
    expect(r.baseUrl).toBe("https://api.example.com/v1/");
    expect(r.messages).toHaveLength(1);
    expect(r.temperature).toBeUndefined();
  });

  it("messages 为空数组拒绝", () => {
    expect(() => aiChatBodySchema.parse({ ...validBody, messages: [] })).toThrow();
  });

  it("非法 role 拒绝", () => {
    expect(() =>
      aiChatBodySchema.parse({ ...validBody, messages: [{ role: "tool", content: "x" }] })
    ).toThrow();
  });

  it("temperature 超出 0-2 拒绝", () => {
    expect(() => aiChatBodySchema.parse({ ...validBody, temperature: 9 })).toThrow();
  });
});

describe("POST /api/ai", () => {
  it("SSE 透传：Content-Type 为 text/event-stream 且内容原样转发", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: [DONE]\n\n';
    const upstream = new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const fetchMock = vi.fn(async () => upstream);
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(buildApp()).post("/api/ai").send(validBody);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.text).toContain("[DONE]");

    // 转发到 ${baseUrl}/chat/completions，去掉尾部斜杠；body 带 stream/max_tokens/temperature 默认 0.7
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: "gpt-4o-mini", stream: true, max_tokens: 2000, temperature: 0.7 });
  });

  it("temperature 显式传入时透传", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await request(buildApp()).post("/api/ai").send({ ...validBody, temperature: 0.2 });
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.temperature).toBe(0.2);
  });

  it("上游连接失败返回 502 与原文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const res = await request(buildApp()).post("/api/ai").send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("无法连接 AI 服务，请检查 Base URL");
  });

  it("上游非 2xx 时透传状态码与错误体", async () => {
    const upstream = new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn(async () => upstream));

    const res = await request(buildApp()).post("/api/ai").send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("invalid api key");
  });

  it("参数不合法返回 400（消息沿用 validate 口径）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await request(buildApp()).post("/api/ai").send({ baseUrl: "https://a.com" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("校验失败");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("baseUrl 为内网地址时返回 400（SSRF 防护，不发起请求）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await request(buildApp())
      .post("/api/ai")
      .send({ ...validBody, baseUrl: "http://127.0.0.1:8080/v1" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("私网/内网");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("客户端断开时 abort 上游请求", async () => {
    const upstream = new Response("", { status: 200 });
    let captured: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        captured = init?.signal ?? undefined;
        upstream.body?.cancel().catch(() => {});
        return upstream;
      })
    );

    const app = express();
    app.use(express.json());
    app.use("/api/ai", aiRouter);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    await new Promise<void>((resolve) => {
      const req = httpRequest(
        { port, method: "POST", path: "/api/ai", headers: { "content-type": "application/json" } },
        (res: IncomingMessage) => {
          res.resume();
          // 拿到响应头后立即断开（headers 已 flush，模拟前端中止）
          setTimeout(() => {
            req.destroy();
            resolve();
          }, 30);
        }
      );
      req.end(JSON.stringify(validBody));
    });

    await new Promise((r) => setTimeout(r, 50));
    server.close();
    const signal = captured as AbortSignal | undefined;
    expect(signal?.aborted).toBe(true);
  });
});
