import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  validate,
  createDatasetBodySchema,
  createAnalysisBodySchema,
  commentListQuerySchema,
  speedBodySchema,
  patchCommentBodySchema,
} from "../src/validation.js"
import { HttpError } from "../src/utils/httpUtils.js";

/** 与 index.ts 一致：HttpError → 对应状态码，其余 500 */
function errorJson(): express.ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err.message });
  };
}

describe("createDatasetBodySchema（三分支）", () => {
  it("接受内置场景分支", () => {
    expect(createDatasetBodySchema.parse({ scenarioId: "app-update" }).scenarioId).toBe("app-update");
  });

  it("接受导入分支并 trim name", () => {
    const r = createDatasetBodySchema.parse({ name: "  导入  ", comments: [{ content: "不错" }] });
    expect(r.name).toBe("导入");
    expect(r.comments).toHaveLength(1);
  });

  it("接受定时抓取分支", () => {
    const r = createDatasetBodySchema.parse({ feedUrl: "https://example.com/feed.json", feedIntervalMin: 10 });
    expect(r.feedIntervalMin).toBe(10);
  });

  it("三个分支都没有时拒绝", () => {
    expect(() => createDatasetBodySchema.parse({ name: "x" })).toThrow();
  });

  it("feedIntervalMin：非数字拒绝（修复 NaN 入库）", () => {
    expect(() => createDatasetBodySchema.parse({ feedUrl: "https://a.com", feedIntervalMin: "abc" })).toThrow();
  });

  it("feedIntervalMin：超过 1440 拒绝（修复 setInterval 溢出）", () => {
    expect(() => createDatasetBodySchema.parse({ feedUrl: "https://a.com", feedIntervalMin: 40000 })).toThrow();
  });

  it("feedIntervalMin：数字字符串可被 coerce", () => {
    const r = createDatasetBodySchema.parse({ feedUrl: "https://a.com", feedIntervalMin: "10" });
    expect(r.feedIntervalMin).toBe(10);
  });

  it("导入评论超过 5000 条拒绝", () => {
    const comments = Array.from({ length: 5001 }, (_, i) => ({ content: `c${i}` }));
    expect(() => createDatasetBodySchema.parse({ comments })).toThrow();
  });

  it("name 超过 100 字符拒绝", () => {
    expect(() => createDatasetBodySchema.parse({ scenarioId: "s", name: "x".repeat(101) })).toThrow();
  });

  it("非法 sentiment 拒绝", () => {
    expect(() => createDatasetBodySchema.parse({ comments: [{ content: "x", sentiment: "evil" }] })).toThrow();
  });
});

describe("createAnalysisBodySchema", () => {
  it("接受合法配置并应用默认值", () => {
    const r = createAnalysisBodySchema.parse({ apiKey: "k", baseUrl: "https://api.openai.com", model: "gpt" });
    expect(r.temperature).toBe(0.2);
    expect(r.concurrency).toBe(6);
  });

  it("temperature 超出 0-2 拒绝", () => {
    expect(() => createAnalysisBodySchema.parse({ apiKey: "k", baseUrl: "https://a.com", model: "m", temperature: 99 })).toThrow();
  });

  it("concurrency 超过 8 拒绝", () => {
    expect(() => createAnalysisBodySchema.parse({ apiKey: "k", baseUrl: "https://a.com", model: "m", concurrency: 100 })).toThrow();
  });

  it("缺必填项拒绝", () => {
    expect(() => createAnalysisBodySchema.parse({})).toThrow();
  });
});

describe("commentListQuerySchema", () => {
  it("缺省参数应用默认分页", () => {
    const r = commentListQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
  });

  it("q 超过 200 字符拒绝", () => {
    expect(() => commentListQuerySchema.parse({ q: "x".repeat(201) })).toThrow();
  });

  it("无效日期拒绝", () => {
    expect(() => commentListQuerySchema.parse({ from: "not-a-date" })).toThrow();
  });

  it("非法 sentiment 拒绝", () => {
    expect(() => commentListQuerySchema.parse({ sentiment: "bad" })).toThrow();
  });

  it("page 上限 clamp", () => {
    expect(() => commentListQuerySchema.parse({ page: 10 ** 9 })).toThrow();
  });
});

describe("patchCommentBodySchema", () => {
  it("至少一个字段", () => {
    expect(() => patchCommentBodySchema.parse({})).toThrow();
  });

  it("非法 sentiment 拒绝", () => {
    expect(() => patchCommentBodySchema.parse({ sentiment: "evil" })).toThrow();
  });
});

describe("speedBodySchema", () => {
  it("默认 5", () => {
    expect(speedBodySchema.parse({}).speed).toBe(5);
  });
  it("超过 20 拒绝", () => {
    expect(() => speedBodySchema.parse({ speed: 999 })).toThrow();
  });
});

describe("validate 中间件", () => {
  it("body 合法时通过并替换 req.body（默认值生效）", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/t",
      validate({ body: createAnalysisBodySchema }),
      (req, res) => res.json({ temperature: req.body.temperature, concurrency: req.body.concurrency })
    );
    app.use(errorJson());
    const res = await request(app)
      .post("/t")
      .send({ apiKey: "k", baseUrl: "https://api.openai.com", model: "gpt" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ temperature: 0.2, concurrency: 6 });
  });

  it("body 非法时返回 400 且带 error 消息", async () => {
    const app = express();
    app.use(express.json());
    app.post("/t", validate({ body: createAnalysisBodySchema }), (_req, res) => res.json({ ok: true }));
    app.use(errorJson());
    const res = await request(app).post("/t").send({ apiKey: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("校验失败");
  });

  it("query 非法时返回 400", async () => {
    const app = express();
    app.use(express.json());
    app.get("/t", validate({ query: commentListQuerySchema }), (_req, res) => res.json({ ok: true }));
    app.use(errorJson());
    const res = await request(app).get("/t?from=not-a-date");
    expect(res.status).toBe(400);
  });

  it("query 合法时挂载 validatedQuery", async () => {
    const app = express();
    app.use(express.json());
    app.get("/t", validate({ query: commentListQuerySchema }), (req, res) =>
      res.json({ page: (req as unknown as { validatedQuery: { page: number } }).validatedQuery.page })
    );
    app.use(errorJson());
    const res = await request(app).get("/t?page=3");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(3);
  });
});
