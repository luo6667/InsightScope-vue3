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
    expect(dedupKeyOf({ id: "x" })).toBe("id:x");
  });

  it("无 id 时按显式字段去重：内容+作者", () => {
    expect(dedupKeyOf({ content: " 相同内容 ", author: "作者" })).toBe("content:相同内容|author:作者");
  });

  it("相同内容不同作者 key 不同（都保留）", () => {
    expect(dedupKeyOf({ content: "相同内容", author: "A" })).not.toBe(dedupKeyOf({ content: "相同内容", author: "B" }));
  });

  it("相同内容+作者、不同时间 key 不同（时间也参与）", () => {
    const a = dedupKeyOf({ content: "c", author: "a", timestamp: "2026-08-15T10:00:00" });
    const b = dedupKeyOf({ content: "c", author: "a", timestamp: "2026-08-16T10:00:00" });
    expect(a).not.toBe(b);
  });

  it("字段集不同 key 不同（带 sentiment 与不带不算重复）", () => {
    expect(dedupKeyOf({ content: "c", author: "a", sentiment: "pos" })).not.toBe(
      dedupKeyOf({ content: "c", author: "a" })
    );
  });
});

describe("buildDedupFilter", () => {
  it("带 id 返回 sourceId 过滤", () => {
    expect(buildDedupFilter({ id: "x" })).toEqual({ sourceId: "x" });
  });

  it("无 id 且不带 author 时 filter 不含 author（字段集不同不误伤）", () => {
    const f = buildDedupFilter({ content: "内容" });
    expect(f.content).toBe("内容");
    expect(f.author).toBeUndefined();
    expect(f.timestamp).toBeUndefined();
  });

  it("无 id 时按 内容+作者 过滤", () => {
    const f = buildDedupFilter({ content: "内容", author: "作者" });
    expect(f.content).toBe("内容");
    expect(f.author).toBe("作者");
  });

  it("无 id 但带 timestamp 时按 内容+作者+时间 三重去重", () => {
    const f = buildDedupFilter({ content: "内容", author: "作者", timestamp: "2026-08-15T10:00:00" });
    expect(f.content).toBe("内容");
    expect(f.author).toBe("作者");
    expect(f.timestamp).toEqual(new Date("2026-08-15T10:00:00"));
  });

  it("相同内容+作者、不同时间 的 filter 不同（都保留）", () => {
    const a = buildDedupFilter({ content: "内容", author: "作者", timestamp: "2026-08-15T10:00:00" });
    const b = buildDedupFilter({ content: "内容", author: "作者", timestamp: "2026-08-16T10:00:00" });
    expect(a.timestamp).not.toEqual(b.timestamp);
  });

  it("相同内容+时间、不同作者 的 filter 不同（都保留）", () => {
    const a = buildDedupFilter({ content: "内容", author: "作者A", timestamp: "2026-08-15T10:00:00" });
    const b = buildDedupFilter({ content: "内容", author: "作者B", timestamp: "2026-08-15T10:00:00" });
    expect(a).not.toEqual(b);
  });

  it("带 sentiment 时 sentiment 也参与去重", () => {
    const f = buildDedupFilter({ content: "c", author: "a", sentiment: "pos" });
    expect(f.sentiment).toBe("pos");
  });

  it("null / 非对象输入不抛错（数据源混入脏数据）", () => {
    expect(buildDedupFilter(null as never)).toEqual({});
    expect(buildDedupFilter("oops" as never)).toEqual({});
    expect(dedupKeyOf(null as never)).toBe("");
    expect(dedupKeyOf(42 as never)).toBe("");
  });
});
