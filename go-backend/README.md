# Go 后端迁移：第一阶段

本目录正在按 [迁移计划](../GO_REDIS_MIGRATION_PLAN.md) 替换 `server/`。目前只实现只读数据集接口、健康检查和鉴权状态；前端仍由现有 Node 后端服务，暂时不要将 API 代理指向 Go。`go test ./...` 可以验证当前已实现的接口行为。

当前接口：

| 路径 | 行为 |
| --- | --- |
| `GET /healthz` | 检查 MySQL 连通性 |
| `GET /api/auth/status` | 返回访问口令是否启用 |
| `GET /api/datasets` | 返回数据集列表和评论计数 |
| `GET /api/datasets/:id` | 返回数据集详情和评论计数 |
| `GET /api/datasets/:id/comments` | 评论分页、时间、情感、主题及文字筛选 |
| `GET /api/alerts/rules` | 返回告警规则，可按数据集筛选 |
| `GET /api/alerts` | 返回告警列表，可按数据集筛选并设置 `limit`、`skip` |

本地试运行需先启动现有 MySQL，并用环境变量配置 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`ACCESS_TOKEN`（可选）和 `PORT`（默认 5176），然后在本目录执行 `go run ./cmd/api`。试运行时请改用其他 `PORT`，避免和现有 Node 后端冲突。当前服务不会自动创建或修改数据库表。

后续仍需完成写接口、评论/统计、告警、AI 流式报告、Socket.IO、Redis 任务、Worker、Scheduler、迁移脚本及真实 MySQL 契约回归；这些完成前不能移除 Node 后端。
