# Go 后端迁移验证记录

验证日期：2026-11-21。所有实际 MySQL 测试均在独立的 `plfx_go_it` 测试库中运行，端口 13306；Redis 测试实例使用端口 16379。测试库由原 Node Sequelize 模型建表，再执行 Go 的版本化迁移。没有修改现有 `plfx` 数据库，也没有使用 Docker。

| 检查 | 结果 |
| --- | --- |
| 原 Node 后端 | Vitest 4 个文件、66 项通过 |
| Vue 前端 | `npm run build` 通过（Vite 有单个大于 500 KB 的 bundle 提示） |
| Go 后端 | `go test ./...`、`go vet ./...` 通过 |
| 原表结构契约 | 导入、评论 JSON 字段、编辑、统计缓存失效、Redis 故障回退、抓取去重、告警、分析写回、重置通过 |
| 实际进程联调 | Go API 的 `/healthz`、`/readyz`、鉴权状态、场景列表通过；API → Asynq → Worker → MySQL 的定时抓取通过 |

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

## 仍需验证

- 原有用户数据库的备份、迁移及数据抽样对照；当前只验证了原 Sequelize 模型创建的隔离库。
- 浏览器内的完整页面交互和断线重连；本环境暂未提供浏览器自动化工具。
- Redis 数据丢失和 Worker 强制退出后的任务恢复，以及多 API 实例的完整 Socket.IO 事件链路。
