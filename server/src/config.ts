/**
 * 📘 config.ts —— 运行配置中心（技术栈：Node 环境变量 + dotenv）
 *
 * 整个 server 的“开关面板”，集中读取环境变量（.env 文件或系统环境）并导出常量：
 * - PORT / MySQL 连接 / CORS 白名单 / 写接口限流 / 访问口令 ACCESS_TOKEN / feed 私网开关等；
 * - 约定：NODE_ENV=production 时做“生产强校验”，密钥、口令没配就拒绝启动，
 *   防止开发默认值（如 root/1234、无口令）被带到线上。
 * 小白看项目建议先读这里：了解 server 有哪些可配置项、各默认值是什么。
 */
import "dotenv/config"; // 加载 server/.env（不覆盖已存在的环境变量）；.env.example 见仓库

/**
 * 运行配置集中读取。
 * NODE_ENV=production 时执行生产强校验（assertProductionConfig）：
 * 密钥、CORS、限流、访问口令必须显式配置，不满足直接拒绝启动，
 * 避免把「开发默认值」带到生产环境。
 */

export const isProd = process.env.NODE_ENV === "production";

export const PORT = Number(process.env.PORT ?? 5176);

/** CORS 白名单：逗号分隔；默认仅允许本地 dev 前后端 */
export const CORS_ORIGINS = (
  process.env.CORS_ORIGIN ?? "http://localhost:5175,http://localhost:5176"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** 写接口简单限流：次/分钟/IP（0 关闭） */
export const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 0);

/**
 * feedUrl 定时抓取是否允许私网/内网/本机地址（如 http://127.0.0.1:8080 的本地评论服务）。
 * 默认允许（本地/演示场景开箱即用）；生产环境如需恢复 SSRF 严格校验，设为 0。
 * 仅影响 feedUrl（定时抓取），AI 服务的 baseUrl 校验始终严格（analysis.ts）。
 */
export const ALLOW_PRIVATE_FEED_URL = (process.env.ALLOW_PRIVATE_FEED_URL ?? "1") !== "0";

/**
 * 单次定时抓取最多入库多少条数据源条目（默认 2000）。
 * 旧实现硬编码 slice(0, 200)：像 jsonplaceholder（500 条）这样的数据源会被静默截断，
 * 用户只看到 200 条且没有任何提示；现在改为可配置，超出时会打 warn 日志。
 */
export const FEED_MAX_ITEMS = Math.max(1, Number(process.env.FEED_MAX_ITEMS ?? 2000));

/**
 * 访问口令（Bearer token）：设置后所有 /api/* 与 socket.io 连接必须携带，
 * 否则返回 401。未设置 = 开发模式，不启用认证（启动时有警告）。
 */
export const ACCESS_TOKEN = (process.env.ACCESS_TOKEN ?? "").trim();

/** 是否要求访问口令（ACCESS_TOKEN 已设置 = 认证启用） */
export const authRequired = ACCESS_TOKEN.length > 0;

/** 生产强校验：列出所有未满足项并退出，一条不漏 */
export function assertProductionConfig(): void {
  if (!isProd) return;
  const problems: string[] = [];
  if (!process.env.MYSQL_PASSWORD || process.env.MYSQL_PASSWORD === "1234") {
    problems.push("MYSQL_PASSWORD 必须显式设置（禁止使用默认密码 1234）");
  }
  if (!process.env.CORS_ORIGIN) {
    problems.push("CORS_ORIGIN 必须设置（逗号分隔允许访问的前端域名）");
  }
  if (!(RATE_LIMIT_PER_MIN > 0)) {
    problems.push("RATE_LIMIT_PER_MIN 必须大于 0（公网部署建议 60）");
  }
  if (!ACCESS_TOKEN) {
    problems.push("ACCESS_TOKEN 必须设置（访问口令，所有 /api 与 socket 连接凭此鉴权）");
  } else if (ACCESS_TOKEN.length < 16) {
    problems.push("ACCESS_TOKEN 长度必须 ≥ 16 位（防暴力破解，建议随机串）");
  }
  if (problems.length > 0) {
    console.error(
      "\n[config] NODE_ENV=production 生产配置校验未通过，拒绝启动：\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n"
    );
    process.exit(1);
  }
}
