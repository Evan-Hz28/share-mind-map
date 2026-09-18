# Phase 3 XMind Import and Export Design

日期：2026-09-18

## 目标

把 Phase 0 的 XMind 安全解析和标准化能力接入真实产品流程：用户可以从 Web 预检并上传多个 `.xmind` 文件，系统通过 MinIO、BullMQ 和独立 Worker 处理导入，持久化原始文件、CloudDocumentV1 快照、图片资产和兼容性报告，并支持有读取权限的成员导出当前持久化版本为 `.xmind`。

本阶段不实现正式思维导图画布、编辑锁、在线节点编辑、多人实时协作、历史版本、搜索或回收站。

## 已确认的边界

- 单文件上传上限为 20 MB，扩展名、ZIP 签名、归档路径、压缩比、条目数、解压大小、加密状态和内容格式都由服务端验证。
- 导入批次中的每个文件独立成功或失败；单个文件失败不回滚其他成功文件。
- 有效文档名称和原始 SHA-256 在工作空间范围内去重。
- 文档、快照、原始文件、图片资产、兼容性报告和任务终态必须具备可审计关联。
- PostgreSQL 是任务状态和业务事实来源；Redis/BullMQ 只负责调度、租约和临时计数；Socket.IO 只负责实时推送，页面关闭或断线后通过 REST 恢复。
- Worker 只接收内部任务 ID 和对象键，不接收用户提供的宿主机路径。
- MinIO Bucket 保持私有；原始、临时、图片和导出对象只能通过服务端鉴权访问。
- 未经授权的真实业务 XMind 不进入仓库；现有合成 Fixture 只用于安全、转换和边界测试。

## 领域模型

### 导入批次和任务

`import_batches` 保存一个多文件操作的工作空间、发起人、总数、成功数、失败数、预计字节数和终态。批次状态由其任务聚合得到，并以条件更新避免迟到 Worker 覆盖终态。

`import_jobs` 保存一个文件的客户端名称、目标文档名称、目标文件夹、压缩字节数、实际字节数、SHA-256、临时对象键、正式原始对象键、当前阶段、错误码、安全错误提示、兼容性摘要和时间戳。状态只能沿以下路径变化：

```text
waiting -> uploading -> parsing -> persisting -> succeeded
                                      \-> failed
waiting -> cancelled
```

重试创建新的任务尝试记录或在同一业务任务上增加尝试代次，但始终以 `import_jobs.id` 作为持久化幂等键，不能重复创建同名文档或重复对象引用。

### 对象引用

`document_assets` 保存原始 XMind、图片和其他可下载资产的对象键、媒体类型、字节数、SHA-256、文档引用和清理状态。对象键由服务端生成，格式包含组织、工作空间、文档或任务和内部 UUID，不包含原始文件名。

快照继续使用 Phase2 的 JSON/对象二选一约束：小快照写 PostgreSQL，大快照写 MinIO；两者都记录 SHA-256、节点数和版本元数据。

### 导出任务

`export_jobs` 保存文档、版本、发起人、状态、对象键、兼容性报告和过期时间。导出只消费已提交的当前快照，不读取浏览器本地状态。结果对象短期保留，下载接口每次检查读取权限和任务归属。

## 数据流

### 导入

```text
Web 多选文件
  -> API 预检名称/目录/数量/配额/队列名额
  -> 创建 batch + jobs
  -> multipart 流式上传到 MinIO 临时对象
  -> PostgreSQL 条件更新为 waiting/parsing
  -> BullMQ import 队列
  -> Worker 从内部对象读取并调用 packages/xmind
  -> 安全解析、标准化、图片提取、CloudDocumentV1 校验
  -> PostgreSQL 事务写文档/快照/资产/兼容性/审计
  -> 原子复制临时对象为正式对象并清理临时对象
  -> 更新 job/batch 终态
  -> Socket.IO 推送，REST 可重建最终状态
```

上传请求中只允许有限的 multipart 字段和一个文件流；API 在收到流时计算哈希和字节数，并在超限或断开时终止流、删除临时对象和标记任务失败。解析和转换不在 API 进程执行。

### 导出

```text
Web 点击导出
  -> API 检查成员读取权限和当前快照
  -> 创建 export_job 并入队
  -> Worker 读取 JSON/MinIO 快照
  -> CloudDocumentV1 -> XMind ZIP
  -> 上传短期私有导出对象
  -> 更新任务为 succeeded
  -> Web 获取鉴权下载响应
```

## API 和事件边界

新增 API 模块：

- `POST /workspaces/:workspaceId/imports/preflight`
- `POST /workspaces/:workspaceId/import-batches`
- `POST /import-jobs/:jobId/upload`
- `GET /import-batches/:batchId`
- `POST /import-jobs/:jobId/cancel`
- `POST /import-jobs/:jobId/retry`
- `GET /admin/import-jobs`
- `POST /documents/:documentId/exports`
- `GET /exports/:exportId`
- `GET /exports/:exportId/download`

具体命名以现有 REST 资源风格和 OpenAPI 生成器约束为准；所有写接口继续使用 CSRF，所有资源接口重新校验工作空间归属和角色。

Socket.IO `/workspace` 事件：

- 客户端 `import:subscribe`，只接受批次发起人或有权管理该工作空间的 Admin。
- 服务端 `import:progress`、`import:completed`、`import:failed`、`import:cancelled`。
- 事件只携带批次/任务 ID、阶段、百分比、计数、稳定错误码和安全提示，不携带对象键、宿主机路径、堆栈、文档正文或图片字节。

## 兼容性和错误策略

兼容性状态使用 `full`、`partial`、`unsupported_online`。报告只描述被保留、标准化、无法在线表达但原文件仍保留的特性，不暴露原始正文或内部路径。

用户可见错误使用稳定错误码，例如文件损坏、格式不支持、路径不安全、归档超限、节点超限、名称冲突、配额不足、队列已满、任务已终态和导出版本不可用。底层错误写入结构化日志时必须脱敏。

导入失败不会创建文档、当前快照或半成品正式资产；如果对象已上传，清理操作幂等且可重试。Worker 重试和 API 重试都必须安全地返回现有任务事实。

## 生命周期

MinIO 初始化脚本继续确保 Bucket 私有，并增加临时对象和导出对象的生命周期规则。数据库中的引用在对象清理前进入明确状态；发现孤儿对象时记录诊断信息，不进行未知对象的无条件删除。

## Web 体验

工作台增加导入入口和导出动作：

- 预检页显示每个文件的名称、目标文档名、目标文件夹、预计大小和冲突。
- 用户可以逐项改名、改目录后重新预检。
- 批次页显示上传、解析、持久化阶段和成功/失败计数。
- 关闭页面不删除已成功任务；重新打开可通过 REST 恢复。
- 失败任务显示安全错误提示并支持修改名称/目录、替换文件或重试。
- 文档列表显示导入兼容性状态，导出结果显示兼容性提示和下载状态。
- Admin 页面显示分页导入失败记录，不显示内部对象键和堆栈。

## 测试策略

- `packages/xmind`：新增导出、图片提取、往返解析和兼容性报告测试。
- `packages/database`：迁移、状态约束、唯一性、任务幂等、对象引用和批次聚合测试。
- API：Reader/Editor/Admin 权限矩阵、流式上传边界、预检竞争、取消/重试、导出鉴权和 OpenAPI 测试。
- Worker：真实 MinIO/Redis/PostgreSQL 集成，验证并发 3、超时、重复投递、失败清理和事务回滚。
- Web：预检、批次进度、失败重试、导出状态和断线后的 REST 恢复。
- E2E：混合批次导入、管理员失败列表、权限拒绝、导出后重新解析和移动端只读流程。
- 运行 Phase0～2 回归、类型、Lint、格式、生成物检查和 Compose 健康检查。

