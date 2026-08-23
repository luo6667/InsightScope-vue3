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
});
