/**
 * 📘 lib/constants.ts —— 跨模块共享的常量
 *
 * 只收「多处共用」或「语义需要命名」的值；页面内一次性的数字不往这里塞。
 */

/** 数据集列表轮询间隔：数据集页要看到定时抓取的运行状态变化 */
export const DATASETS_POLL_MS = 8000
/** 告警记录轮询间隔 */
export const ALERTS_POLL_MS = 5000
/** 分析任务进行中（pending/running/paused）的轮询间隔 */
export const ANALYSIS_JOB_POLL_MS = 3000
/** 分析并发默认值（与后端 server/src/validation.ts 的 default(6) 保持一致） */
export const ANALYSIS_CONCURRENCY = 6

/** 舆情报告历史：localStorage key 与最多保留条数 */
export const REPORT_HISTORY_KEY = 'insight-reports'
export const REPORT_HISTORY_MAX = 100
