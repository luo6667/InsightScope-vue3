import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl } from "../src/utils/urlSafety.js";
import { HttpError } from "../src/utils/httpUtils.js";

function expectRejected(raw: string) {
  try {
    assertPublicHttpUrl(raw);
    return false;
  } catch (e) {
    return e instanceof HttpError && e.status === 400;
  }
}

function expectRejectedWithOpts(raw: string, opts?: { allowPrivate?: boolean }) {
  try {
    assertPublicHttpUrl(raw, "URL", opts);
    return false;
  } catch (e) {
    return e instanceof HttpError && e.status === 400;
  }
}

describe("assertPublicHttpUrl（SSRF 防护）", () => {
  it("接受公网 http/https", () => {
    expect(assertPublicHttpUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
    expect(assertPublicHttpUrl("http://example.com")).toBe("http://example.com");
  });

  it("去掉尾部斜杠", () => {
    expect(assertPublicHttpUrl("https://example.com/feed/")).toBe("https://example.com/feed");
  });

  it("拒绝非 http/https 协议", () => {
    expect(expectRejected("ftp://example.com")).toBe(true);
    expect(expectRejected("file:///etc/passwd")).toBe(true);
  });

  it("拒绝内网 IP 段", () => {
    expect(expectRejected("http://10.0.0.1/")).toBe(true);
    expect(expectRejected("http://127.0.0.1/")).toBe(true);
    expect(expectRejected("http://192.168.1.1/")).toBe(true);
    expect(expectRejected("http://172.16.0.1/")).toBe(true);
    expect(expectRejected("http://169.254.169.254/latest/meta-data/")).toBe(true); // 云元数据
    expect(expectRejected("http://0.0.0.0/")).toBe(true);
  });

  it("拒绝本地域名别名", () => {
    expect(expectRejected("http://localhost/")).toBe(true);
    expect(expectRejected("http://foo.localhost/")).toBe(true);
    expect(expectRejected("http://foo.internal/")).toBe(true);
    expect(expectRejected("http://foo.local/")).toBe(true);
  });

  it("拒绝 IPv6 环回/链路本地", () => {
    expect(expectRejected("http://[::1]/")).toBe(true);
    expect(expectRejected("http://[fe80::1]/")).toBe(true);
    expect(expectRejected("http://[fc00::1]/")).toBe(true);
  });

  it("拒绝带用户名密码的 URL", () => {
    expect(expectRejected("http://user:pass@example.com/")).toBe(true);
  });

  it("拒绝空值/非法格式", () => {
    expect(expectRejected("")).toBe(true);
    expect(expectRejected("not a url")).toBe(true);
  });

  it("allowPrivate=true 时允许本机/内网地址（feed 定时抓取本地评论服务）", () => {
    expect(assertPublicHttpUrl("http://127.0.0.1:8080/feed", "feedUrl", { allowPrivate: true })).toBe("http://127.0.0.1:8080/feed");
    expect(assertPublicHttpUrl("http://localhost:3000/api", "feedUrl", { allowPrivate: true })).toBe("http://localhost:3000/api");
    expect(assertPublicHttpUrl("http://192.168.1.10/feed.json", "feedUrl", { allowPrivate: true })).toBe("http://192.168.1.10/feed.json");
    expect(assertPublicHttpUrl("http://[::1]:3000/", "feedUrl", { allowPrivate: true })).toBe("http://[::1]:3000");
  });

  it("allowPrivate=true 仍保留协议/凭据/格式校验", () => {
    expect(expectRejectedWithOpts("ftp://127.0.0.1/", { allowPrivate: true })).toBe(true);
    expect(expectRejectedWithOpts("http://user:pass@127.0.0.1/", { allowPrivate: true })).toBe(true);
    expect(expectRejectedWithOpts("not a url", { allowPrivate: true })).toBe(true);
  });
});
