# 📖 InsightScope 从零吃透指南

> 面向想彻底搞懂这个项目的人。按本文顺序读，配合代码里 `📘` 开头的教学注释，半天到一天可以建立完整心智模型。
> 前提：会一点 TypeScript / React 基础即可，遇到不懂的库查一下官方文档也行。

---

## 0. 这项目是什么（一句话）

一个 **AI 用户评论分析与舆情监控平台**：导入/抓取评论 → AI 分析情感与主题 → 大盘可视化 → 负面异常自动告警 → 一键生成周报。

**整体架构（先记住这张图）**：

```
┌─────────────────────────────────────────────────────────┐
│  浏览器（Next.js 16 前端，端口 3000）                      │
│  app/(site)/* 页面 → views/ 组件 → hooks → api/client    │
│         │                        │                        │
│     /api 请求(HTTP)          socket 直连(实时)            │
└─────────┼────────────────────────┼───────────────────────┘
          │ 开发: Next rewrites 代理 │ 生产: nginx 反代
          ▼                        ▼
┌─────────────────────────────────────────────────────────┐
│  Express 后端（端口 5176）                                │
│  index.ts(入口) → routes/*(路由) → models.ts(ORM)        │
│                     ↓                                    │
│              MySQL（Sequelize，库名 plfx）                │
└─────────────────────────────────────────────────────────┘
```

两个服务：`server/`(Express + socket.io + Sequelize/MySQL)、`web/`(Next.js 16 + React 19)。

---

## 1. 技术栈总表（每项解决什么问题）

| 技术 | 在哪用 | 解决什么问题 | 替代者/备注 |
|---|---|---|---|
| **Next.js 16 (App Router)** | web | 页面路由、SSR/流式、API 路由(route.ts)、middleware(proxy) | 替代了旧 Vite(纯 SPA) |
| **React 19 + React Compiler** | web | UI 渲染；编译器自动记忆化，不用手写 useMemo | 可对比 React 18 的优化方式 |
| **TanStack Query** | web | 请求后端 + 缓存 + 轮询 + 重试 | 替代手写 fetch + useState |
| **zustand** | web | 轻量全局状态(localStorage 持久化) | 替代 redux |
| **socket.io-client** | web | 与后端建立 WebSocket 长连接，实时收数据 | 与后端 socket.io 配对 |
| **ECharts + echarts-wordcloud** | web | 图表(情感环形图/趋势/主题/词云) | 备选 chart.js / recharts |
| **Tailwind CSS 4** | web | 样式(原子类)，深浅主题靠 CSS 变量 | 备选 CSS Modules |
| **zod** | web+server | 请求参数校验 + 类型派生 | 前后端各一份，已尽量对齐 |
| **axios** | web | HTTP 请求封装(拦截器统一带 token/处理 401) | 备选原生 fetch |
| **Express 5** | server | REST API 框架 | 备选 Fastify/Nest |
| **socket.io** | server | 实时推送(评论流入/告警/进度) | 备选 ws |
| **Sequelize (MySQL)** | server | ORM：把表映射成 TS 类，写查询不用 SQL 字符串 | 备选 Prisma/TypeORM/原生 mysql2 |
| **mysql2** | server | 底层 MySQL 驱动(建库时直接用) | Sequelize 的方言驱动 |
| **helmet / cors / express-rate-limit** | server | 安全响应头 / 跨域白名单 / 写接口限流 | 生产必需 |
| **sonner** | web | 全局 toast 提示 | — |

---

## 2. 怎么跑起来（先跑通再看代码）

前置：Node 18+，本地有 MySQL（默认账号 `root/1234@127.0.0.1:3306`，库 `plfx`，**启动时自动建库建表，不用手动建**）。

```bash
# 后端（http://localhost:5176）
cd server && npm install && npm run dev

# 前端（http://localhost:3000，/api 由 Next 开发代理到后端）
cd web && npm install && npm run dev
```

打开 `http://localhost:3000` → 导入一个内置场景 → 点「▶ 播放模拟」→ 就能看到评论流入 + 告警。

> 第一次跑后建议用 Navicat / mysql cli 看一眼 `plfx` 库：`datasets`、`comments`、`analysis_jobs`、`alert_rules`、`alerts` 五张表，和 models.ts 一一对应。

---

## 3. 阅读路径（推荐顺序，共 8 步）

### 第 1 步：先看入口，建立"服务端长什么样"的框架
**文件**：`server/src/index.ts`（📘）
**要点**：中间件链(helmet→cors→json→限流→鉴权) → 挂 6 组路由 → socket.io 同端口 → `main()` 启动。
看明白"请求进来先过什么、再到哪个路由"。

### 第 2 步：看配置与数据库，搞懂"数据存在哪"
**文件**：`server/src/config.ts`(📘) → `server/src/db.ts`(📘) → `server/src/models.ts`(📘)
**要点**：
- config：环境变量开关面板（端口、MySQL 账号、口令、限流）；
- **db.ts 就是"怎么连 MySQL"的答案**：`ensureDatabase` 建库 → `new Sequelize(...)` 连接 → `sync()` 建表；
- models：5 张表 ↔ 5 个 TS 类，`id` 返回字符串、`topics/keywords` 是 JSON 列。

### 第 3 步：看校验层，理解"参数怎么被把关"
**文件**：`server/src/validation.ts`(📘)
**要点**：zod schema 描述每个接口的合法参数，`validate()` 中间件统一校验，不合法 400。前端 `web/src/lib/validation.ts` 是它的镜像。

### 第 4 步：看业务路由，走一遍"数据从哪来"
按依赖顺序读（**这是核心，花最多时间**）：

| 顺序 | 文件 | 看什么 |
|---|---|---|
| ① | `routes/datasets.ts`(📘) | 一个 POST 三种建数据集方式（场景/导入/feed），导入去重逻辑 |
| ② | `routes/comments.ts`(📘) | Sequelize 复杂查询：分页、JSON_CONTAINS、LIKE 转义、按天统计 |
| ③ | `routes/feeds.ts`(📘) | 定时抓取：SSRF 校验→fetch→去重→入库→socket 推送 |
| ④ | `routes/simulate.ts`(📘) | 实时模拟器：tick 循环 + 每条流入触发告警检测 |
| ⑤ | `routes/analysis.ts`(📘) | AI 批量分析：内存任务队列、每批 8 条、暂停/恢复/取消 |
| ⑥ | `routes/alerts.ts`(📘) | 告警规则 CRUD + 记录 + 确认 |

配套的纯逻辑文件：`utils/commentUtils.ts`(📘 规范化+去重)、`services/anomalyService.ts`(📘 Z-score)、`services/scenarioService.ts`(内置场景剧本生成)、`utils/auth.ts`(口令鉴权)、`utils/urlSafety.ts`(SSRF 防护)。

### 第 5 步：看前后端怎么连，搞懂"数据怎么从后端到页面"
**文件**：`web/next.config.ts`(📘 rewrites 代理) → `web/src/api/client.ts`(📘 axios 拦截器) → `web/src/api/api.ts`(📘 业务函数)
**要点**：页面里 `fetch('/api/...')` 是**同源**的——开发由 Next 代理转发到 5176，生产由 nginx 转发。socket 不走代理，直连后端（`web/src/lib/socket.ts` 📘）。

### 第 6 步：看前端数据流，搞懂"页面怎么拿到数据并渲染"
**文件**：`web/src/components/Providers.tsx`(📘) → `web/src/hooks/useData.ts`(📘) → `web/src/views/DashboardPage.tsx`(📘)
**要点**：
- Providers 提供 React Query 上下文 → hooks 里 `useQuery` 请求 + 缓存 + 轮询；
- 页面组件只用 `const { data } = useDatasetStats(id)` 就拿到数据；
- 实时部分走 `useDatasetSocket.ts`(📘) 订阅 socket 事件，setState 增量更新；
- 图表：`components/dashboard/options.ts` 是纯函数生成 ECharts option。

### 第 7 步：看 Next.js 特有的"后端能力"
**文件**：`web/src/app/api/ai/route.ts`(📘 route handler 转发 AI) → `web/src/proxy.ts`(访问控制) → `web/src/app/layout.tsx`(📘 根布局)
**要点**：route.ts = Next 自带的 API 端点；proxy.ts = middleware，拦 `/api/*` 校验口令；layout 是服务端组件，Providers/AccessGate 是客户端边界。

### 第 8 步：走一遍业务闭环（把上面串起来）
跟着 README 的"三分钟演示"操作，同时开着后端日志（`server` 终端）看每个请求：
1. **导入**：页面 POST `/api/datasets` → `routes/datasets.ts` → `comments` 表；
2. **模拟**：POST `/simulate/start` → `simulate.ts` tick 推 `comment:stream` → 前端实时列表 + 图表联动；
3. **告警**：负面率突增 → `simulate.checkAlerts` → Z-score → `alerts` 表 + `alert:new` → 前端横幅 + 浏览器通知；
4. **分析**：POST `/analysis` → `analysis.ts` 队列调 AI → 写回 `comments` → socket 推进度；
5. **报告**：前端 `streamChat` → `/api/ai` → AI 服务 SSE 逐字输出 → 保存 localStorage 历史。

---

## 4. 核心机制详解（小白重点）

### 4.1 MySQL 是怎么连上的（最常见疑问）
```
server/src/config.ts  → MYSQL_HOST/PORT/USER/PASSWORD/DATABASE（默认 root/1234/plfx）
        ↓
server/src/db.ts
  ① ensureDatabase()：mysql2 裸连（不指定库）→ CREATE DATABASE IF NOT EXISTS plfx
  ② new Sequelize(...)：ORM 连接，timezone:'+00:00'（统一 UTC 存取）
  ③ initDb()：authenticate() 验证 → sync() 按 models.ts 建表 → 补唯一索引
        ↓
server/src/models.ts  → 每张表一个 Model（Dataset/Comment/AnalysisJob/AlertRule/Alert）
        ↓
routes/*.ts          → CommentModel.findAll({...}) 等 ORM 查询
```
改数据库密码/库名 → 改 `server/.env`（参考 `.env.example`）。

### 4.2 请求校验（zod）为什么这么写
`validation.ts` 里每个 schema 描述"合法参数"，`validate()` 中间件：
```
请求进来 → validate({ body: createDatasetBodySchema })
         → parse() 成功：req.body 变成规范化后的数据，进路由
         → parse() 失败：抛 HttpError(400)，错误消息进统一错误处理
```
路由代码因此干净：只管业务，不管"参数有没有传对"。

### 4.3 去重规则（导入 & 抓取共用）
`utils/commentUtils.ts`：
- 数据源给了 `id` → 按 id 去重（DB 唯一索引兜底）；
- 没给 id → 按评论**显式携带的全部字段**（内容/作者/平台/时间/情感…）完全重合才去重；
- 任一字段不同、或字段集不同 → 保留。
> 所以"同内容同作者但时间不同"的评论会被保留——去重键是"全字段相等"。

### 4.4 SSRF 防护（为什么本地 URL 之前被抓不到）
`utils/urlSafety.ts`：默认拒绝内网/私网/环回地址（防止服务器被当代理扫内网）。
`config.ts` 的 `ALLOW_PRIVATE_FEED_URL=1`（默认开）可放行 feed 抓取本地服务；AI 的 baseUrl 始终强制公网。

### 4.5 实时推送（socket.io 全链路）
```
后端：CommentModel.create → emit("comment:stream", {...})  → 发到 room "dataset:<id>"
前端：useDatasetSocket(id, handlers) → 进入房间 join-dataset → 监听 comment:stream → setState
```
关键：socket 直连后端（不走 Next rewrites，因为 rewrites 不支持 WebSocket）；生产用 nginx 反代带 Upgrade 头。

### 4.6 AI 流式（SSE 打字机）
```
前端 lib/ai.ts fetch('/api/ai')
   → Next route handler 转发到 AI 的 /chat/completions (stream:true)
   → 响应体 text/event-stream 透传回浏览器
   → 前端 reader 逐块读，按行解析 "data: {...}"，取 delta 增量逐字追加
```
好处：浏览器不直接碰 AI 服务（避开 CORS），apiKey 只在内存流转。

### 4.7 前端缓存（React Query）为什么这样配
`Providers.tsx`：`retry:1`、`refetchOnWindowFocus:false`、默认 staleTime 0。
`useData.ts` 的 queryKey 是缓存标识；写操作后用 `invalidateQueries({queryKey:[...]})` 让对应数据失效重拉，页面自动更新。

---

## 5. 常用调试技巧

| 需求 | 做法 |
|---|---|
| 看后端收到了什么请求/参数 | 看 server 终端日志（每个请求一行 `[req] GET /api/...`）；或 curl / Postman 直接打 |
| 直接查数据 | `mysql -h 127.0.0.1 -u root -p1234 plfx -e "SELECT * FROM comments LIMIT 5;"` |
| 手动触发一次抓取 | `POST http://localhost:5176/api/datasets/{id}/feed/pull` |
| 测试接口参数校验 | 故意传错参数，看返回的 400 error 消息 |
| 前端报错定位 | 浏览器 Network 面板看请求/响应；Console 看 React Query 报错 |
| 改完后端代码 | `tsx watch`（npm run dev）自动重载；改了数据库结构需重启 |
| 检查类型/规范 | `cd web && npm run type-check && npm run lint`；server 同理 |

---

## 6. 教学注释索引（代码里搜 `📘`）

| 层 | 文件 |
|---|---|
| server 配置/数据 | `config.ts` `db.ts` `models.ts` `validation.ts` `index.ts` |
| server 路由 | `routes/datasets.ts` `routes/comments.ts` `routes/feeds.ts` `routes/simulate.ts` `routes/analysis.ts` `routes/alerts.ts` |
| server 工具/服务 | `utils/commentUtils.ts` `services/anomalyService.ts` |
| web 配置/入口 | `next.config.ts` `app/layout.tsx` `app/api/ai/route.ts` `components/Providers.tsx` |
| web 数据层 | `api/client.ts` `api/api.ts` `hooks/useData.ts` `hooks/useDatasetSocket.ts` `lib/socket.ts` `lib/ai.ts` `store/settings.ts` |
| web 页面示例 | `views/DashboardPage.tsx` |

> 想深入某块：`routes/comments.ts` 学 Sequelize 高级查询；`simulate.ts` 学"定时器 + 竞态防护"；`app/api/ai/route.ts` 学 Next route handler；`hooks/useData.ts` 学 TanStack Query 轮询。

---

## 7. 学习路线图（建议投入时间）

```
半小时  跑起来 + 看 index.ts / config / db / models（建立骨架）
2-3 小时 第 4 步：6 个路由文件逐个读透（业务核心）
1 小时   第 5-6 步：前后端数据流（client → hooks → 页面 → 图表）
1 小时   第 7-8 步：Next 后端能力 + 业务闭环走一遍
1 小时   对照 4.x 详解过一遍核心机制（去重/SSRF/socket/SSE/缓存）
之后     按兴趣深入：ECharts 图表工厂、AI 批量队列、Z-score 检测
```
