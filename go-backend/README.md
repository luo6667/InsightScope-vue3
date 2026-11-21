# Go 后端运行说明

Go + Gin + GORM 后端使用原有 MySQL 表，Redis 负责 Asynq 队列、统计缓存、实时广播、模拟状态和限流。Vue 的接口路径与 Socket.IO 客户端保持原样。API、Worker、Scheduler 是三个独立进程；Vue 仍用 Node.js 运行 Vite。迁移和验证详情见 [验证记录](VERIFICATION.md)。

当前接口：

| 路径 | 行为 |
| --- | --- |
| `GET /healthz` | 检查 MySQL 连通性 |
| `GET /readyz` | 检查 MySQL 与 Redis 连通性；任一不可用返回 503 |
| `GET /api/auth/status` | 返回访问口令是否启用 |
| `GET /api/datasets` | 返回数据集列表和评论计数 |
| `POST /api/datasets` | 创建内置场景、导入评论或创建定时抓取数据集 |
| `GET /api/scenarios` | 返回三个内置场景的名称、说明和评论数量 |
| `GET /api/datasets/:id` | 返回数据集详情和评论计数 |
| `DELETE /api/datasets/:id` | 在事务中删除数据集及关联的评论、分析任务和告警记录 |
| `GET /api/datasets/:id/comments` | 评论分页、时间、情感、主题及文字筛选 |
| `PATCH /api/datasets/:id/comments/:cid` | 人工修正评论情感与主题 |
| `GET /api/datasets/:id/export` | 按列表筛选条件导出完整 CSV 或 JSON |
| `GET /api/datasets/:id/stats` | 情感、主题、趋势和关键词统计 |
| `GET /api/datasets/:id/analysis` | 返回数据集最新分析任务，尚无任务时返回 `null` |
| `POST /api/datasets/:id/analysis` | 加密保存用户配置并投递分析任务 |
| `POST /api/datasets/:id/analysis/pause` | 暂停运行中任务 |
| `POST /api/datasets/:id/analysis/resume` | 恢复暂停任务并重新投递 |
| `POST /api/datasets/:id/analysis/cancel` | 取消任务并清除加密凭据 |
| `POST /api/datasets/:id/analysis/reset` | 清除任务与分析结果并发布重置事件 |
| `POST /api/datasets/:id/feed/start` | 启用定时抓取并立即抓取一次 |
| `POST /api/datasets/:id/feed/stop` | 停止后续定时抓取 |
| `POST /api/datasets/:id/feed/pull` | 立即抓取，返回新增条数及是否因互斥锁跳过 |
| `POST /api/datasets/:id/simulate/start` | 按时间顺序重放评论，速度默认 5、范围 1–20 |
| `POST /api/datasets/:id/simulate/stop` | 停止当前重放并发布状态事件 |
| `POST /api/datasets/:id/simulate/speed` | 播放期间调整速度 |
| `GET /api/alerts/rules` | 返回告警规则，可按数据集筛选 |
| `POST /api/alerts/rules` | 创建告警规则 |
| `PATCH /api/alerts/rules/:id` | 修改告警规则 |
| `DELETE /api/alerts/rules/:id` | 删除告警规则 |
| `GET /api/alerts` | 返回告警列表，可按数据集筛选并设置 `limit`、`skip` |
| `PATCH /api/alerts/:id/ack` | 确认告警 |
| `POST /api/ai` | 使用用户配置的模型转发 SSE 流式报告 |

## 本地启动（PowerShell）

先启动 MySQL 和 Redis，按 [.env.example](.env.example) 设置环境变量。`.env.example` 只是模板，Go 进程不会自动读取它。首次使用现有数据库前先用 `mysqldump --single-transaction` 备份；迁移仅新增 `schema_migrations`、`analysis_job_secrets` 和 `dataset_versions`，不会重建旧表。迁移命令本身不需要加密密钥：

```powershell
cd go-backend
go run ./cmd/migrate
```

只生成一次密钥，在本机安全保存生成的 Base64 字符串；不要把它发送到聊天、写进 Git 或放入前端环境变量：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

在 **API 终端和 Worker 终端分别粘贴刚才生成的同一串**，再启动进程。PowerShell 的 `$env:` 只对当前终端及其子进程生效；重新打开终端后需要重新设置。可用 `[Convert]::FromBase64String($env:ANALYSIS_ENCRYPTION_KEY).Length` 验证结果是 `32`。更换密钥会使未完成分析任务的临时密文无法解密。

```powershell
cd go-backend
$env:ANALYSIS_ENCRYPTION_KEY = Read-Host '粘贴刚才生成的 Base64 密钥'
go run ./cmd/api
```

```powershell
cd go-backend
$env:ANALYSIS_ENCRYPTION_KEY = Read-Host '粘贴同一串 Base64 密钥'
go run ./cmd/worker
```

Scheduler 不读取该密钥：

```powershell
cd go-backend
go run ./cmd/scheduler
```

另开终端在 `web/` 运行 `npm install`、`npm run dev`，访问 `http://localhost:3000`。Vite 开发代理和 Socket.IO 默认连接 Go API 的 `http://localhost:5176`。`GET /healthz` 检查 MySQL，`GET /readyz` 同时检查 MySQL 和 Redis。

`NODE_ENV=production` 或 `GO_ENV=production` 时，API 会拒绝默认 MySQL 密码、缺少 CORS 来源、关闭限流或短于 16 位的访问口令；与原 Node 的生产配置门槛一致。

新增的版本化数据库变更通过 `go run ./cmd/migrate` 手动执行。目前创建 `schema_migrations`、`analysis_job_secrets` 与 `dataset_versions`，不会清空或重建旧数据；执行前仍应备份现有 MySQL。`dataset_versions` 在评论写入、编辑、分析写回或重置的同一事务内推进，统计缓存键同时包含数据版本及完整查询条件；Redis 故障时统计从 MySQL 计算。后台分析加密主密钥仅由服务端环境变量 `ANALYSIS_ENCRYPTION_KEY` 提供，不能写入前端环境变量或提交到 Git。分析任务投递到 Asynq 队列时只放任务 ID，凭据不进入 Redis。

Socket.IO 采用 [zishang520/socket.io](https://github.com/zishang520/socket.io) 的 Go 服务端，沿用前端已有的 `socket.io-client 4.x`、`auth.token`、`join-dataset` / `leave-dataset` 和数据集房间。`internal/realtime` 中的本地互通测试使用前端安装的 Node 客户端验证鉴权、加入与离开房间；运行该测试前需在 `web/` 安装依赖。`CORS_ORIGIN` 可配置逗号分隔的允许来源，默认是两个本地开发地址。API 已订阅 Redis 实时事件频道并转发到数据集房间，后台分析 Worker 和抓取流程会发布进度及状态事件。

Scheduler 每分钟投递到期的抓取任务，并从 MySQL 补投 Redis 中丢失的未完成分析任务。补投使用固定 Asynq 任务 ID，已有任务不会重复入队。

Worker 已接入模型批量请求和单条兜底，按未分析评论恢复进度、事务写回成功结果，并在结束时清除加密凭据；暂停、取消、重置和数据集删除也会阻止旧 Worker 写回。同一分析任务由 Redis 持有者锁互斥，锁定期自动续租且仅持有者可释放，评论写回仍以数据库条件更新保证幂等。API 启动时会清理已结束任务的密文，并重新投递仍有密文的待处理或运行中任务，处理数据库提交后进程退出导致的漏投递。

抓取由独立 Scheduler 定时投递到 Asynq 的 `feed` 队列，Worker 处理抓取；手动抓取同步返回结果。抓取使用 Redis 数据集锁防止多实例和手动抓取重叠，长批次会续租；`FEED_MAX_ITEMS` 默认 2000，`ALLOW_PRIVATE_FEED_URL=0` 可启用严格 URL 检查。抓取入库与 AI 分析写回后会按原规则计算负面率、敏感关键词、评论量告警和 Z-score 异常，并发布 `alert:new` 事件。模拟器在 API 进程内按时间线播放已有评论，运行代次、进度和速度保存在 Redis；另一 API 实例的停止或调速会在下一次播放检查时生效，旧代次不会继续推送。
