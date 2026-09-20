# Shared Mind Map

Shared Mind Map 已完成阶段 0-4：可复现的技术验证、独立文档模型、XMind Worker、导入导出平台基础，以及正式文档查看/编辑页、编辑锁、未保存草稿保护、图片资产和已提交快照实时同步。

阶段 2 已提供一级文件夹、文档元数据与合法空白快照、编辑权限申请/审批/撤销、平台通知、审计查询和数据库已知用量读取。阶段 3 增加真实 `.xmind` 多文件导入、流式上传、Worker 解析持久化、进度/失败重试、图片资产、兼容性报告和鉴权导出。阶段 4 增加正式文档页、mind-elixir 标准快照编辑边界、Redis 单编辑锁、串行保存/本地草稿、PNG/JPEG/WebP 图片上传和 Socket.IO 已提交版本同步。

## 环境要求

- Node.js `24.x`，当前验证版本 `24.16.0`
- Corepack 与 pnpm `11.5.0`（根 `packageManager` 已固定）
- Docker Engine 与 Docker Compose v2/v5
- Chromium 浏览器由 Playwright `1.63.0` 管理
- Linux、macOS 或启用 Docker 集成的 WSL2

首次安装：

```bash
corepack enable
corepack prepare pnpm@11.5.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

## 配置

`.env.example` 只含明确的本地测试值和占位值，可直接用于自动化验收。日常运行应创建不提交 Git 的 `.env`，不要在终端或 CI 日志中打印它：

```bash
install -m 600 .env.example .env
```

编辑 `.env` 并替换数据库、Redis、MinIO 和会话密钥。生产环境还必须使用 HTTPS、`COOKIE_SECURE=true`、足够强且非占位的密码/密钥，并按真实代理层级设置 `TRUST_PROXY_COUNT`；API 的生产配置校验会拒绝本地占位值、弱密码、HTTP 公网 URL 和不安全 Cookie。

CSRF 值由服务端按会话随机生成并只保存在浏览器内存中，不需要静态 CSRF 密钥。`WEB_ORIGIN` 是唯一允许的 CORS Origin。

## 一键启动

本地验收可使用示例环境：

```bash
docker compose --env-file .env.example build
docker compose --env-file .env.example up -d
pnpm compose:health
docker compose --env-file .env.example ps
```

日常运行将命令中的 `.env.example` 换成 `.env`。API 容器每次启动都会在 PostgreSQL advisory lock 下幂等执行迁移，再启动 NestJS；Worker 不导入或启动 API 代码。MinIO 初始化器创建私有桶后正常退出。

可访问地址：

| 服务          | 地址                                 |
| ------------- | ------------------------------------ |
| Web           | `http://127.0.0.1:8080`              |
| API 就绪      | `http://127.0.0.1:3000/health/ready` |
| Worker 就绪   | `http://127.0.0.1:3001/health/ready` |
| Mailpit       | `http://127.0.0.1:8025`              |
| MinIO Console | `http://127.0.0.1:9001`              |
| PostgreSQL    | `127.0.0.1:15432`                    |
| Redis         | `127.0.0.1:16379`                    |

所有宿主机端口只绑定回环地址。Web 由非 root Nginx 提供静态文件、history fallback、CSP、`/health` 和 `/api/` 反向代理；API 与 Worker 同样以非 root 用户运行。

## 首位管理员

系统不提供开放注册。首次启动后，在 API 容器中执行交互式初始化：

```bash
docker compose --env-file .env exec api node dist/cli/init-admin.js
```

命令会创建首个组织、默认工作区和 Admin，只显示一次临时密码。首次登录必须修改密码。重复初始化是幂等操作，不会创建第二套组织数据。

维护人员需要恢复现有 Admin 时执行：

```bash
docker compose --env-file .env exec api node dist/cli/recover-admin.js
```

恢复命令要求交互确认，会恢复账号、设置新的一次性临时密码、强制改密、撤销该用户全部会话并写入审计记录。密码不能通过 CLI 参数或长期环境变量传入。

Admin 登录后可在“成员管理”创建 Reader、一次性重置临时密码、禁用/恢复账号和撤销全部会话，并在“权限与审计”处理编辑权限申请、查看审计和用量。系统拒绝禁用最后一个有效 Admin；撤销编辑权限会立即影响后续 REST 请求。正式画布编辑和未保存内容保护已在阶段 4 提供。

## 阶段 3：XMind 导入与导出

Editor/Admin 在工作台点击“导入 XMind”即可一次选择多个 `.xmind` 文件，并为每个文件修改目标名称和一级文件夹。单文件上限为 20 MB；上传后由独立 Worker 解析，页面可通过 Socket.IO 看到批次和逐项结果，断线时自动用 REST 回补。失败任务可取消或重试，成功导入的文档仍是当前阶段的只读持久化快照。

Reader、Editor、Admin 都可以在文档列表点击“导出 XMind”。导出读取最近一次已保存快照，不包含阶段 4 的未保存画布状态。MinIO Bucket 保持私有，临时 `tmp/` 和导出 `exports/` 对象配置 24 小时生命周期；队列前缀由 `XMIND_QUEUE_PREFIX` 统一配置，默认值为 `smm`。

阶段 3 的 API 主要端点包括：

- `POST /api/v1/workspaces/:workspaceId/import-batches`：创建多文件批次。
- `POST /api/v1/workspaces/:workspaceId/import-batches/:batchId/jobs/:jobId/upload`：流式上传单个任务。
- `GET /api/v1/workspaces/:workspaceId/import-batches/:batchId`：读取权威进度。
- `POST .../cancel`、`POST .../retry`：取消等待任务或重试失败任务。
- `GET /api/v1/workspaces/:workspaceId/documents/:documentId/export`：鉴权导出 `.xmind`。

## 阶段 4：正式查看与编辑

工作区文档名称进入 `/workspace/documents/:documentId` 正式页面。Reader、移动端、未持锁成员和锁被占用的 Editor/Admin 为只读；桌面 Editor/Admin 点击“开始编辑”后获取 15 分钟 Redis 锁并持续心跳。锁失效、版本冲突或网络故障会立即停止写入并保留本机草稿，可复制 JSON 或明确导出草稿 XMind。

图片控件只接受 PNG、JPEG、WebP，单张不超过 5 MiB；上传请求携带内存中的锁租约，快照只保存服务端返回的资产 ID。Socket.IO 只广播数据库事务成功后的完整快照，旧版本和版本跳跃会被丢弃或触发 REST 回补。阶段 5 的历史、搜索、回收站和分享功能不在本阶段范围内。

## 本机开发

只启动依赖服务：

```bash
docker compose --env-file .env up -d postgres redis minio minio-init mailpit
set -a
. ./.env
set +a
```

前端开发时将 `.env` 的 `WEB_ORIGIN` 改为 `http://127.0.0.1:5173`，然后分别启动：

```bash
pnpm --filter @share-mind-map/api... build
pnpm --filter @share-mind-map/database exec node --input-type=module -e 'import {createDatabase,migrateDatabase} from "./dist/index.js"; const db=createDatabase(process.env.DATABASE_URL); try { await migrateDatabase(db); } finally { await db.$client.end(); }'
pnpm --filter @share-mind-map/api start

pnpm --filter @share-mind-map/worker... build
pnpm --filter @share-mind-map/worker start

pnpm --filter @share-mind-map/web dev
```

主机开发使用 `DATABASE_URL`、`REDIS_URL`、`MINIO_ENDPOINT`；Compose 容器使用对应的 `COMPOSE_*` 内部 URL。不要把真实 `.env` 内容粘贴到问题报告或日志中。

## 生成物与漂移检查

OpenAPI 是 API 契约的来源，前端不手写重复 DTO：

```bash
pnpm api:generate
pnpm api:check
```

`api:check` 在临时目录重新生成 OpenAPI 与 TypeScript Client，并进行字节级比较，不依赖 Git 工作树是否干净。

标准文档 JSON Schema 与 XMind 合成样本同样可确定性再生成：

```bash
pnpm --filter @share-mind-map/document-model generate:schema
pnpm --filter @share-mind-map/document-model check:schema
pnpm generate:xmind-fixtures
pnpm check:xmind-fixtures
pnpm verify:xmind-worker
```

画布证据与 ADR：

```bash
pnpm canvas:licenses
pnpm canvas:benchmark
pnpm canvas:adr
pnpm canvas:check
```

当前 ADR 选择 `mind-elixir` 作为阶段 4 的候选画布边界。原始结果在 `docs/benchmarks/canvas/`；该结论仍需真实业务文档验证。

## 测试与质量门禁

常用命令：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm check
pnpm test:compose-structure
pnpm exec playwright test tests/e2e --project=chromium
pnpm exec playwright test tests/e2e/responsive.spec.ts --project=mobile-chrome
pnpm verify:phase-0-1
```

数据库迁移的空库与重复执行验证：

```bash
pnpm --filter @share-mind-map/database test:integration -- --run migrations
```

完整浏览器验收会通过容器内交互 CLI 初始化或恢复 Admin，并在本地卷中创建测试 Reader/Editor。它不会删除命名卷，也不会把临时密码写入测试日志。

## 健康检查与排障

```bash
pnpm compose:health
docker compose --env-file .env ps --all
docker compose --env-file .env logs --no-color api worker web
docker compose --env-file .env logs --no-color postgres redis minio mailpit
```

`/health/live` 只证明进程能响应；`/health/ready` 才验证 API 的 PostgreSQL、Redis、MinIO、SMTP，以及 Worker 的 PostgreSQL、Redis、MinIO、BullMQ 连接。常见排查顺序：

1. 确认 `minio-init` 退出码为 0，长期服务为 `healthy`。
2. 检查内部 `COMPOSE_*` URL 是否使用 Compose 服务名，而非 `localhost`。
3. 检查宿主端口是否冲突、Docker 是否有足够内存。
4. 只分享脱敏日志；不得分享密码、Cookie、CSRF、会话令牌、文档正文或图片字节。

安全停止且保留数据：

```bash
docker compose --env-file .env stop
# 或移除容器和网络，但保留命名卷
docker compose --env-file .env down
```

不要使用 `down -v`，除非明确要删除 PostgreSQL、Redis、MinIO 和 Mailpit 的本地持久数据。

## 外部集成与限制

- XMind 与画布样本均为确定性合成数据，不代表公司真实文档、图片分布、扩展或性能特征。
- Mailpit 只用于本地 SMTP 捕获。接入真实 SMTP 时设置 TLS、认证和发件地址，在预发布环境验证退信、超时、证书、限流和脱敏日志。
- 生产服务器需要外部 TLS 终止、强密钥、备份、监控、容量规划、漏洞扫描和最小权限网络策略；本地 Compose 不是生产编排方案。
- MinIO 当前使用单节点本地卷；尚未验证生产对象存储的版本控制、生命周期、跨区或恢复行为。
- Redis 保存会话、限流与队列协调状态；阶段 1 未提供 Redis 高可用或灾难切换。
- 浏览器证据来自当前 Playwright Chromium；真实 Chrome/Edge 多版本兼容尚未完成。

接入真实业务 XMind 样本时，先取得数据授权并在隔离环境脱敏，保存预期兼容性结论，不要把样本提交仓库；然后重跑 Worker 限制、安全、转换和 5,000/20,000 节点性能验证。

## 阶段 6 发布门禁

以下项目保持“未验证”，不阻止阶段 0-1 本地交付，但阻止生产上线结论：

- 代表性业务 XMind 样本与真实图片兼容验收
- 类生产服务器容量、并发、长稳和故障注入测试
- 真实 SMTP 与对象存储集成验收
- Chrome/Edge 支持版本矩阵与 Pilot 用户确认
- PostgreSQL/MinIO/Redis 备份、恢复、RPO/RTO 演练
- TLS、密钥轮换、监控告警、安全扫描与发布回滚演练

## 后续阶段范围

阶段 5-6 的历史浏览/恢复、分享链接、评论、搜索、回收站、测试执行管理、生产部署与运维自动化仍未实现。阶段 3 的验收证据见 `docs/verification/phase-3-2026-09-18.md`，阶段 4 证据见 `docs/verification/phase-4-2026-09-20.md`；真实业务 XMind 保真度仍需授权 Pilot 验证。
