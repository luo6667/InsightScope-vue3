# Go 后端迁移验证记录

验证日期：2026-11-21。写入式功能测试在独立的 `plfx_go_it` 测试库（端口 13306）和 Redis 测试实例（端口 16379）运行。测试库由原 Node Sequelize 模型建表，再执行 Go 的版本化迁移。原 `plfx` 数据库先备份，再执行只新增表的迁移与只读 API 核对。没有使用 Docker。

| 检查 | 结果 |
| --- | --- |
| 原 Node 后端 | Vitest 4 个文件、66 项通过 |
| Vue 前端 | `npm run build` 通过（Vite 有单个大于 500 KB 的 bundle 提示） |
| Go 后端 | `go test ./...`、`go vet ./...` 通过 |
| 原表结构契约 | 导入、评论 JSON 字段、编辑、统计缓存失效、Redis 故障回退、抓取去重、告警、分析写回、重置通过 |
| 实际进程联调 | Go API 的 `/healthz`、`/readyz`、鉴权状态、场景列表通过；API → Asynq → Worker → MySQL 的定时抓取通过 |
| 实时联调 | Node `socket.io-client 4.x` 连接 Go API，在另一 Go API 实例触发模拟后收到 `comment:stream`；Redis 重启后再次通过 |
| 浏览器渲染 | Headless Chrome 经 Vite → Go API 打开数据集、评论、监控台、分析、报告、告警、设置 7 个页面，均渲染；前 6 个显示隔离测试数据集 |
| Redis 中断 | 统计查询回退 MySQL；`/readyz` 和新分析任务返回 503；恢复后跨实例实时事件恢复 |
| 队列数据丢失 | 自动补投使用 MySQL 未完成任务和固定 Asynq 任务 ID；测试覆盖队列项丢失后恢复、重复扫描不产生重复任务 |

## 原数据库迁移与对照

迁移前使用 `mysqldump --single-transaction` 备份到 Git 忽略的 `.backups/plfx-2026-11-21-before-go.sql`（329,613 字节；SHA-256 `4131F9116D9BE0DA9EF4EACB3B4E6360C5B2587A6C85172332C9EAF1710FB474`）。该文件包含用户数据，不应提交。迁移前后原表的精确行数与最大 ID 完全一致：

| 表 | 行数 | 最大 ID |
| --- | ---: | ---: |
| datasets | 4 | 28 |
| comments | 1,332 | 4,805 |
| analysis_jobs | 5 | 23 |
| alerts | 16 | 49 |
| alert_rules | 4 | 51 |

迁移新增 `schema_migrations`、`analysis_job_secrets`、`dataset_versions`；旧表没有重建。Go API 在独立端口连接原库时，`/healthz`、`/readyz` 正常，返回 4 个数据集；抽查数据集 5 的评论分页与统计均为 420 条。

## 1 万条评论负载测试

环境：Windows/amd64、16 个逻辑 CPU、Go 1.27.1、MySQL 8.0.44、Redis 8.10.3。单数据集 10,000 条未分析评论，另有一个 100 条评论数据集；模型为本地模拟 HTTP 服务，无真实模型费用。测试命令为设置隔离测试库的 `GO_INTEGRATION_DSN`、`GO_INTEGRATION_REDIS` 和 `GO_LOAD_TEST=1` 后运行 `go test ./internal/api -run TestTenThousandCommentsAndBackgroundAnalysis -count=1 -timeout=8m -v`。

| 操作 | 结果 |
| --- | ---: |
| 插入 10,000 + 100 条 | 601 ms |
| 第 3 页、每页 50 条，按情感筛选 | 30 ms |
| 统计 | 57 ms |
| 导出 10,000 条 JSON | 413 ms |
| 后台分析 10,000 条 | 19.18 s，约 521 条/秒 |

以上是单机、模拟模型、隔离数据库的测量值；不代表用户模型的网络耗时或生产并发性能。负载测试会删除自己创建的数据集。

## 已发现并修复

- GORM `map` 更新 MySQL JSON 字段时把 `[]string` 当成 SQL 元组；改为显式 JSON 字符串，并用原表结构重测分析写回及重置。
- 原 `datasets.updatedAt` 只有秒级精度，无法安全地充当缓存版本；增量增加 `dataset_versions` 表，在评论变更事务中递增版本，并验证编辑后统计不命中旧缓存。

## 验证边界

- 浏览器已验证页面加载，尚未自动点击覆盖每个表单和弹窗；这些行为由 Go API 契约测试及前端构建覆盖。
- Redis 队列丢失的补投通过测试验证；尚未对真实模型请求执行 Worker 进程强制退出和继续分析的端到端演练。1 万条测试使用本地模拟模型。
