# Go 后端迁移：第一阶段

本目录正在按 [迁移计划](../GO_REDIS_MIGRATION_PLAN.md) 替换 `server/`。目前实现了数据集与评论的部分接口、告警接口、健康检查、鉴权状态和 Socket.IO 连接；前端仍由现有 Node 后端服务，暂时不要将 API 代理指向 Go。`go test ./...` 可以验证当前已实现的接口行为。

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
| `GET /api/alerts/rules` | 返回告警规则，可按数据集筛选 |
| `POST /api/alerts/rules` | 创建告警规则 |
| `PATCH /api/alerts/rules/:id` | 修改告警规则 |
| `DELETE /api/alerts/rules/:id` | 删除告警规则 |
| `GET /api/alerts` | 返回告警列表，可按数据集筛选并设置 `limit`、`skip` |
| `PATCH /api/alerts/:id/ack` | 确认告警 |
| `POST /api/ai` | 使用用户配置的模型转发 SSE 流式报告 |

本地试运行需先启动现有 MySQL 和 Redis，并用环境变量配置 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`REDIS_ADDR`（默认 `127.0.0.1:6379`）、`REDIS_PASSWORD`（可选）、`ANALYSIS_ENCRYPTION_KEY`（32 字节密钥的 Base64 编码）、`ACCESS_TOKEN`（可选）、`CORS_ORIGIN`（逗号分隔，默认本地前端地址）和 `PORT`（默认 5176），然后分别执行 `go run ./cmd/api` 与 `go run ./cmd/worker`。试运行时请改用其他 `PORT`，避免和现有 Node 后端冲突。当前服务不会自动创建或修改数据库表。

新增的版本化数据库变更通过 `go run ./cmd/migrate` 手动执行。目前仅创建 `schema_migrations` 与 `analysis_job_secrets`，不会清空或重建旧数据；执行前仍应备份现有 MySQL。后台分析加密主密钥仅由服务端环境变量 `ANALYSIS_ENCRYPTION_KEY` 提供，不能写入前端环境变量或提交到 Git。分析任务投递到 Asynq 队列时只放任务 ID，凭据不进入 Redis。

Socket.IO 采用 [zishang520/socket.io](https://github.com/zishang520/socket.io) 的 Go 服务端，沿用前端已有的 `socket.io-client 4.x`、`auth.token`、`join-dataset` / `leave-dataset` 和数据集房间。`internal/realtime` 中的本地互通测试使用前端安装的 Node 客户端验证鉴权、加入与离开房间；运行该测试前需在 `web/` 安装依赖。`CORS_ORIGIN` 可配置逗号分隔的允许来源，默认是两个本地开发地址。API 已订阅 Redis 实时事件频道并转发到数据集房间；后台 Worker 尚未接入事件发布。

后续仍需完成分析任务互斥与恢复、抓取与模拟、Scheduler、告警计算、真实 MySQL 契约回归及故障测试；这些完成前不能移除 Node 后端。Worker 已接入模型批量请求和单条兜底，按未分析评论恢复进度、事务写回成功结果，并在结束时清除加密凭据；暂停、取消、重置和数据集删除也会阻止旧 Worker 写回。
