<div align="center">

# 📡 舆情雷达 InsightScope

**AI 用户评论分析与舆情监控平台**

把散落的用户评论，变成一条「**采集 → 分析 → 监控 → 告警 → 报告**」的完整舆情处置链路。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![MySQL](https://img.shields.io/badge/MySQL-Sequelize-4479A1?logo=mysql&logoColor=white)](https://sequelize.org)
[![Socket.io](https://img.shields.io/badge/Socket.io-实时-010101?logo=socket.io&logoColor=white)](https://socket.io)
[![ECharts](https://img.shields.io/badge/ECharts-5-AA344D?logo=apacheecharts&logoColor=white)](https://echarts.apache.org)

</div>

---

## 💡 这是什么？

InsightScope 是一个前端为主的 AI 全栈项目，帮助产品 / 运营 / 公关团队**把用户评论变成可执行的舆情判断**：

- 📥 **采集**：一键导入 3 个内置舆情场景（App 更新 / 新品发布 / 公关危机，1300+ 条真实格式评论），也支持粘贴导入
- 🧠 **分析**：调用 OpenAI 兼容接口（OpenAI / DeepSeek 均可）对评论做批量情感 / 主题 / 关键词分析
- 📊 **监控**：可视化大盘实时呈现情感分布、趋势、热门主题与关键词词云
- 🚨 **告警**：负面率异常自动触发告警，支持规则配置与确认流转
- 📝 **报告**：一键生成 AI 舆情周报（流式输出），导出 Markdown

内置数据**已预标注，无需 API key 即可完整体验**；配合实时模拟器，能直观看到"评论流入 → 负面激增 → 告警弹出"的全过程。

## ✨ 特性

- 🎬 **实时模拟器** — 按时间轴重放评论（1x–20x 加速），流入动画 + 告警实时弹窗
- ⚙️ **批量分析队列** — 并发限流、断点续跑、失败重试，WebSocket 实时推送进度，可暂停 / 恢复 / 取消
- 🚨 **智能告警** — 负面率阈值 / 评论量（最近 N 分钟新增条数 ≥ 阈值，窗口 1~1440 分钟可配）/ 敏感关键词规则 + 滑动窗口 **Z-score 异常检测** + 60s 冷却防抖
- 🖥 **可视化大盘** — 情感环形图 · 按天趋势 · 热门主题 · 关键词云四图联动
- 📝 **AI 周报** — 五段式结构流式生成，一键导出 Markdown
- 🔒 **安全设计** — API key 只存浏览器、仅内存不落库；可选 `ACCESS_TOKEN` 访问口令保护全部接口
- 🧩 **零门槛演示** — 内置 3 个预标注场景，免 key 开箱即用

## 🖼 界面预览

> 💡 把你的截图放到 `docs/screenshots/`，替换下面两行即可。

![监控台](docs/screenshots/dashboard.png)

![舆情报告](docs/screenshots/report.png)

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 (Composition API) · Vite · TypeScript · Tailwind CSS 4 · Pinia · TanStack Vue Query · Element Plus · ECharts（词云）· motion-v · socket.io-client |
| 后端 | Express · Sequelize (MySQL) · socket.io · axios |
| AI | OpenAI 兼容 `/chat/completions`（OpenAI / DeepSeek）· SSE 流式输出 |

## 🚀 快速开始

> 依赖：Node 18+ 与本地 MySQL（启动时自动建库建表，默认 `root/1234@127.0.0.1:3306/plfx`）

```bash
# 1. 启动后端（http://localhost:5176）
cd server
npm install
npm run dev

# 2. 启动前端（http://localhost:3000，/api 由 Vite dev 代理到 5176；socket.io 直连后端）
cd web
npm install
npm run dev
```

> 前端是纯 SPA（Vue 3 + Vite），`/api` 的转发只在开发期由 Vite 代理完成（见 `web/vite.config.ts` 的 `server.proxy`，
> 目标地址取 `web/.env` 里的 `API_TARGET`，默认 `http://localhost:5176`）。

然后打开 `http://localhost:3000` → 导入一个内置场景 → 点「▶ 播放模拟」→ 看监控台"活"起来。

## 🚀 生产部署（nginx 反代）

三个角色：前端静态产物（由 nginx 托管）、Express（API + socket.io，5176）、nginx（入口 80）。

```bash
# 1. 构建前端（产物是纯静态文件，落在 web/dist/，交给 nginx 托管）
cd web && npm run build

# 2. 构建并启动后端（API + socket.io + /api/ai 流式转发）
cd server && npm run build && npm start
```

前端环境变量（构建时注入，写在 `web/.env`）：`VITE_API_BASE=/api`、`VITE_SOCKET_URL=`（同源走 nginx，留空）。
访问控制完全由后端 `ACCESS_TOKEN` 负责，前端不再持有任何构建期口令。

nginx 示例（前端静态文件 + 全部 API 与 socket 都转 Express；`/api/ai` 已由 Express 提供，不再需要特殊转发）：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  # Vue 3 SPA 静态产物（history 路由需回退到 index.html）
  root /var/www/insightscope;      # 指向 web/dist
  index index.html;
  location / { try_files $uri $uri/ /index.html; }

  # Express API（含 /api/ai 的 SSE 流式转发）
  location /api/ {
    proxy_pass http://127.0.0.1:5176;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;           # AI 分析 / 周报是流式输出，必须关闭缓冲
    proxy_read_timeout 300s;
  }

  # socket.io（WebSocket 需要 Upgrade 头）
  location /socket.io/ {
    proxy_pass http://127.0.0.1:5176;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

> 后端 `ACCESS_TOKEN` 启用后，所有 `/api/*`（含 `/api/ai`）统一由 Express 的 `requireAccessToken` 校验；
> 前端 `AccessGate` 只做体验层——探测 `/api/auth/status` 提示输入口令，不参与真正的鉴权。

## 🧭 三分钟演示

1. **导入数据**：选「某 App 大版本更新」，自动进入监控台
2. **看大盘**：情感分布 / 趋势 / 主题 / 词云四张图表
3. **实时监控**：播放模拟，评论流入，负面激增触发告警横幅
4. **告警中心**：确认告警、配置负面率规则
5. **AI 分析**：填 key 跑批量分析（内置场景已预标注，可跳过）
6. **生成周报**：一键生成 AI 舆情周报并导出 Markdown

## 📁 目录结构

```
├── server/               # Express + socket.io + Sequelize(MySQL)
│   └── src/
│       ├── models.ts     # Dataset / Comment / AnalysisJob / Alert / AlertRule
│       ├── routes/       # datasets / comments / analysis / alerts / simulate / feeds / ai
│       ├── services/     # 场景生成器 / Z-score 异常检测
│       └── index.ts      # 入口（Express + socket.io + MySQL）
└── web/                  # Vue 3 + Vite + Tailwind CSS 4 单页应用
    └── src/
        ├── router/       # vue-router 路由表（7 个业务页面 + 兜底）
        ├── layouts/      # SiteLayout（悬浮岛导航）/ IslandItem
        ├── views/        # 各页面组件（监控台 / 导入 / 报告 / 告警 / 分析 / 设置）
        ├── components/   # 公共组件（ui 设计系统 / EChart 封装 / dashboard 子组件 / 弹窗）
        ├── composables/  # useData（TanStack Vue Query）/ useDatasetSocket / useTheme 等
        ├── api/          # axios 封装与 API 层
        ├── stores/       # Pinia 状态（workspace / AI 设置，localStorage 持久化）
        └── lib/          # AI 流式调用 / echarts / 校验 / 工具
```
