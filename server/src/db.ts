/**
 * 📘 db.ts —— MySQL 连接与建库（技术栈：mysql2 原生驱动 + Sequelize ORM）
 *
 * 三层结构，按顺序理解：
 * 1. ensureDatabase()：先用原生 mysql2 连一次 MySQL（不指定库名），
 *    CREATE DATABASE IF NOT EXISTS 确保数据库存在（utf8mb4 支持中文/emoji）；
 * 2. sequelize = new Sequelize(...)：ORM 连接句柄——指定库名/账号/密码，
 *    timezone:+00:00 统一按 UTC 存取（与原 MongoDB 行为一致）；
 * 3. initDb()：authenticate() 验证连通 → sync() 按 models.ts 定义自动建表 →
 *    补一个幂等唯一索引（评论去重的 DB 层兜底）。
 * 之后所有数据库操作（models.ts 的模型查询）都经由这个 sequelize 实例。
 */
import mysql from "mysql2/promise";
import { Sequelize } from "sequelize";

// MySQL 连接配置（默认 root/1234@127.0.0.1:3306，库名 plfx；可用环境变量覆盖）
export const DB_CONFIG = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "1234",
  database: process.env.MYSQL_DATABASE ?? "plfx",
};

export function dbUriSummary(): string {
  return `${DB_CONFIG.user}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`;
}

/** 确保数据库存在（utf8mb4 支持中文与 emoji） */
async function ensureDatabase(): Promise<void> {
  const conn = await mysql.createConnection({
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
    charset: "utf8mb4",
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await conn.end();
  }
}

export const sequelize = new Sequelize(DB_CONFIG.database, DB_CONFIG.user, DB_CONFIG.password, {
  host: DB_CONFIG.host,
  port: DB_CONFIG.port,
  dialect: "mysql",
  timezone: "+00:00", // 统一 UTC 存储
  logging: false,
  define: {
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
  },
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
});

/**
 * 幂等补充评论表去重唯一索引（模拟原 MongoDB partialFilterExpression：
 * 仅对 sourceId 非空的评论生效）。MySQL 无部分索引，用生成列实现——
 * sourceId 为空时生成 NULL（唯一索引允许多个 NULL），非空时取 sourceId。
 * 注：Sequelize 默认列名与属性名一致（camelCase，如 datasetId/sourceId）。
 */
async function ensureCommentDedupIndex(): Promise<void> {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'comments' AND index_name = 'uniq_dataset_source'`
  );
  const exists = Number((rows as { n: number }[])[0]?.n ?? 0) > 0;
  if (exists) return;
  await sequelize.query(`
    ALTER TABLE comments
      ADD COLUMN source_key VARCHAR(191) GENERATED ALWAYS AS (IF(sourceId = '', NULL, sourceId)) STORED,
      ADD UNIQUE INDEX uniq_dataset_source (datasetId, source_key)
  `);//因为sourceId里面导入数据可能有空字符串会导致冲突，所以设一个source_key列，空字符串时生成NULL，非空时取sourceId，唯一索引是datasetId+source_key
}//datasetId为数据集id，source_key为评论id，唯一索引是datasetId+source_key，source_key为空时，唯一索引是datasetId+NULL
//这个数据集id怎么创建的？在导入数据时，创建数据集时，会自动生成一个随机字符串作为数据集id
//他是怎么生成的？答案：是用 uuid 函数生成的，返回一个 36进制字符串，长度为32，包含字母和数字

/**
 * 幂等补充 alert_rules.windowMin 列（评论量规则的「最近 N 分钟」窗口）。
 *
 * sequelize.sync() 只建缺失的表、不会给已存在的表加列，所以老库需要这条 ALTER；
 * 新库由 sync() 按 models.ts 直接建好，这里查到列已存在就跳过。
 * NOT NULL DEFAULT 10 让历史规则自动获得 10 分钟窗口（与模型默认值一致）。
 */
async function ensureAlertRuleWindowColumn(): Promise<void> {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'alert_rules' AND column_name = 'windowMin'`
  );
  const exists = Number((rows as { n: number }[])[0]?.n ?? 0) > 0;
  if (exists) return;
  await sequelize.query(`ALTER TABLE alert_rules ADD COLUMN windowMin INT NOT NULL DEFAULT 10`);
  console.log("[mysql] alert_rules 已补充 windowMin 列（默认 10 分钟）");
}

//连接 MySQL + 建库建表 + 索引（应用启动时调用一次） */
export async function initDb(): Promise<void> {
  await ensureDatabase();
  await sequelize.authenticate();
  await sequelize.sync(); // 创建缺失的表（模型定义见 models.ts）
  await ensureCommentDedupIndex();
  await ensureAlertRuleWindowColumn();
}
