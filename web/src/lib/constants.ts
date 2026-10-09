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

/**
 * 评论无限滚动每页条数。
 * 后端 limit 上限是 100（server/src/validation.ts 的 pagination），这里取 50：
 * 配合虚拟滚动，每页 50 条只增量渲染可视区的十几项，一次请求的体量也够小。
 */
export const COMMENTS_PAGE_SIZE = 50
/** 评论搜索防抖时长：输入停顿 400ms 才把关键词下推到服务端 */
export const COMMENTS_SEARCH_DEBOUNCE_MS = 400
/**
 * 触底预加载的提前量（单位：条）。
 * 当「当前渲染到的最后一条」距离已加载条数不足这么多时，就取下一页 ——
 * 按行高 104px 估算相当于提前约 800px 开始加载，用户滚到底之前新数据已经在路上。
 */
export const COMMENTS_PRELOAD_AHEAD = 8

/** 舆情报告历史：localStorage key 与最多保留条数 */
export const REPORT_HISTORY_KEY = 'insight-reports'
export const REPORT_HISTORY_MAX = 100
