import { describe, expect, it } from "vitest";
import { normalizeComment, dedupKeyOf, buildDedupFilter } from "../src/utils/commentUtils.js";

const ctx = { platform: "测试源", now: 1_700_000_000_000, index: 0 };

describe("normalizeComment", () => {
  it("字段缺省时兜底", () => {
    const r = normalizeComment({}, ctx);
    expect(r.content).toBe("");
    expect(r.author).toBe("匿名用户");
    expect(r.platform).toBe("测试源");
    expect(r.sentiment).toBe("neu");
    expect(r.analyzed).toBe(false);
  });

  it("content 超长截断到 2000", () => {
    const r = normalizeComment({ content: "x".repeat(3000) }, ctx);
    expect(r.content).toHaveLength(2000);
  });

  it("兼容 text/comment 别名", () => {
    expect(normalizeComment({ text: "文本" }, ctx).content).toBe("文本");
    expect(normalizeComment({ comment: "评论" }, ctx).content).toBe("评论");
  });

  it("非法 sentiment 回退 neu", () => {
    expect(normalizeComment({ sentiment: "evil" }, ctx).sentiment).toBe("neu");
  });

  it("sourceId 取值优先 id", () => {
    expect(normalizeComment({ id: "a1", commentId: "b2" }, ctx).sourceId).toBe("a1");
    expect(normalizeComment({ commentId: "b2" }, ctx).sourceId).toBe("b2");
  });
});

describe("dedupKeyOf", () => {
  it("带 id 按 id 去重", () => {
    expect(dedupKeyOf({ id: "x" }, "作者")).toBe("id:x");
  });

  it("无 id 按 内容+作者 去重", () => {
    expect(dedupKeyOf({ content: " 相同内容 " }, "作者")).toBe("ca:作者||相同内容");
  });

  it("不同作者相同内容 key 不同（都保留）", () => {
    expect(dedupKeyOf({ content: "相同内容" }, "A")).not.toBe(dedupKeyOf({ content: "相同内容" }, "B"));
  });
});

describe("buildDedupFilter", () => {
  it("带 id 返回 sourceId 过滤", () => {
    expect(buildDedupFilter({ id: "x" }, "作者")).toEqual({ sourceId: "x" });
  });

  it("无 id 返回 内容+作者 过滤", () => {
    const f = buildDedupFilter({ content: "内容" }, "作者");
    expect(f.content).toBe("内容");
    expect(f.author).toBe("作者");
  });
});
