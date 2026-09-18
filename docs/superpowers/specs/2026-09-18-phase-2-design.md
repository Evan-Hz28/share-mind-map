# Phase 2 工作台与权限设计规格

## 目标与边界

本规格实现 `docs/dev/Phase2.md` 定义的阶段 2：工作台、一级文件夹、文档元数据、编辑权限申请、平台通知、管理员审计查询和配额读取。阶段 1 的认证、成员管理、OpenAPI、迁移、Compose 和测试能力必须保持兼容。

本阶段明确不实现 XMind 导入/导出、正式画布编辑、编辑锁、历史版本、搜索、回收站和生产告警。文档只提供合法的 `CloudDocumentV1` 初始快照只读数据；删除入口不进入工作台，文件夹只提供删除前置检查所需的非空/容量判定。

## 已确认的产品解释

- 工作空间内有效文档名称全局唯一；有效一级文件夹名称全局唯一。
- 名称标准化统一为 Unicode NFC、去除首尾空白、连续空白折叠为一个空格，并使用小写冲突键；原名称保留用于展示。
- 空白文档创建必须在同一个数据库事务中写入文档、版本 1 初始快照、当前版本指针和审计记录。
- 初始快照是单 Sheet、单根节点、合法且可通过 `document-model` Schema V1 校验的最小文档。
- 文件夹/文档数量上限由工作空间行锁串行化检查与数据库唯一约束共同保证：文件夹 500、单文件夹文档 1,000、工作空间文档 20,000。
- 权限申请只能由 Reader 发起；同一用户同一工作空间只能有一条 pending 申请。审批通过将成员角色改为 Editor，拒绝保留终态；撤销将 Editor 恢复为 Reader。
- 审批、拒绝、撤销和重复请求均是幂等终态操作；业务状态、Outbox 和审计必须在同一事务内写入。
- 平台通知不发送外部邮件。业务事务只写持久化 Outbox，Worker 以幂等方式把待投递事件物化为站内通知。
- 审计查询只返回安全元数据，不包含密码、会话凭证、文档正文或对象存储路径。
- 配额读取区分数据库已知用量和待对账的对象存储用量；阶段 2 不伪造导入/图片产生的对象字节。

## 组件与依赖方向

```text
web -> api-client + document-model
api -> database + document-model
worker -> database
```

数据库新增表及关系：

- `edit_permission_requests`
- `folders`
- `documents`
- `document_snapshots`
- `notification_outbox`
- `notifications`

审计继续使用阶段 1 的 `audit_logs`。文档快照在阶段 2 以 JSONB 存储，后续大型快照/对象存储迁移不改变 API 契约。

后端模块职责：

- `membership`：申请、待审列表、审批、拒绝、撤销。
- `folders`：一级文件夹创建、列表、重命名、删除前置检查。
- `documents`：创建空白文档、列表/游标、详情、重命名和移动。
- `notifications`：列表、未读数、单条已读、全部已读。
- `audit`：管理员安全筛选与游标查询。
- `storage`：文件夹数、文档数、已知对象字节和阈值状态。

## 数据与事务设计

所有新增写仓储接受 `DatabaseTransaction`，命令服务只在事务内完成归属校验、锁定、约束检查、写模型、Outbox 和审计。创建/重命名/移动前锁定所属 workspace 行；移动跨文件夹时同时校验目标文件夹属于同一 workspace。有效数据的名称唯一通过部分唯一索引抵御并发冲突。

文档创建顺序：

1. 锁定 workspace，确认有效文档总数未超过 20,000。
2. 规范化并检查文档名称唯一性。
3. 若指定 folder，锁定并确认归属及有效文档数小于 1,000。
4. 创建文档版本 1 的初始快照。
5. 创建文档并回填 `current_snapshot_id`，或先插入文档再插入快照并在同一事务推进指针。
6. 写 `document.created` 审计。

任一步失败整体回滚，不遗留半成品。初始快照的 `snapshot_json` 必须通过 `document-model` 的 `validateCloudDocument`，其中 `documentId`、`version` 与文档记录一致。

权限审批顺序：锁定申请、成员和 workspace 相关行，检查申请当前状态；状态已是目标终态时返回当前结果且不重复副作用；状态冲突返回稳定业务错误。通过时更新角色并写通知 Outbox、审计；拒绝不改角色但写通知 Outbox、审计；撤销仅允许 active Editor，更新角色为 Reader 并写通知 Outbox、审计。

## API 契约

统一前缀为 `/api/v1`，DTO 使用 camelCase，由 Nest Swagger 生成 OpenAPI，再生成 `packages/api-client`。

```text
GET  /workspaces/{workspaceId}/folders
POST /workspaces/{workspaceId}/folders
PATCH /workspaces/{workspaceId}/folders/{folderId}
POST /workspaces/{workspaceId}/folders/{folderId}/delete-check

GET  /workspaces/{workspaceId}/documents
POST /workspaces/{workspaceId}/documents
GET  /workspaces/{workspaceId}/documents/{documentId}
PATCH /workspaces/{workspaceId}/documents/{documentId}

POST /workspaces/{workspaceId}/edit-requests
GET  /admin/edit-requests
POST /admin/edit-requests/{requestId}/approve
POST /admin/edit-requests/{requestId}/reject
POST /admin/members/{membershipId}/revoke-editing

GET  /notifications
POST /notifications/{notificationId}/read
POST /notifications/read-all

GET  /admin/audit-logs
GET  /admin/storage
```

列表游标编码排序值和 UUID；文档列表排序支持 `updatedAt`（默认降序）和 `name`，每种排序都追加唯一 ID 作为稳定 tie-breaker。默认返回文件夹与未归档文档两个集合，前端保证文件夹优先。

新增错误码：`FOLDER_LIMIT_REACHED`、`FOLDER_DOCUMENT_LIMIT_REACHED`、`WORKSPACE_DOCUMENT_LIMIT_REACHED`、`FOLDER_NAME_CONFLICT`、`DOCUMENT_NAME_CONFLICT`、`FOLDER_NOT_EMPTY`、`DOCUMENT_FOLDER_INVALID`、`EDIT_REQUEST_PENDING`、`EDIT_REQUEST_TERMINAL`、`NOTIFICATION_NOT_FOUND`、`AUDIT_FILTER_INVALID`、`QUOTA_EXCEEDED`。原阶段 1 错误码语义不改变。

## 前端设计

`WorkspaceHomeView` 变为工作台：加载 workspace 数据，展示加载、空、失败、无权限和配额受限状态；文件夹在文档前，支持更新时间/名称排序和加载更多游标。Reader 隐藏写操作并显示申请入口；Editor/Admin 显示创建、重命名和移动入口。服务端返回 403 时统一显示安全错误，不依赖按钮隐藏保证权限。

工作区页面新增：文件夹创建/改名弹窗、文档创建/改名/移动弹窗、Reader 编辑权限申请、Admin 待审申请面板、通知抽屉、Admin 审计和用量面板。阶段 2 不显示删除文档、删除文件夹、导入、编辑器、历史和搜索入口。

Pinia 仅保存可重建的工作台列表、申请和通知状态；不保存会话凭证或文档正文之外的编辑草稿。

## 错误、审计与安全

所有请求重新从 session 校验 workspace/member 归属；所有新增 controller 使用 `SessionGuard`、`PasswordChangeGuard` 和适当的 `RolesGuard`。Reader 可 GET 与申请，Editor 可工作台写操作，Admin 具有工作台写操作、审批、审计和用量查询。

审计 action 使用稳定命名：`folder.created`、`folder.renamed`、`folder.delete_checked`、`document.created`、`document.renamed`、`document.moved`、`edit_request.created`、`edit_request.approved`、`edit_request.rejected`、`edit_permission.revoked`、`notification.read`、`notification.read_all`。metadata 只包含 ID、名称冲突/数量结果、版本和安全状态，不包含正文、密码、Cookie、token 或对象 key。

Outbox 事件使用唯一幂等键（业务事件类型 + 目标用户 + 目标对象 + 业务状态版本），Worker 处理时先尝试插入通知唯一键，重复事件视为成功。平台通知正文为安全、短文本，目标对象只返回允许的 ID 和类型。

## 测试与验收

- database：迁移空库/重复迁移、schema 约束、名称标准化、并发唯一性和数量上限事务。
- api：Reader/Editor/Admin 权限矩阵、越权 workspace ID、创建/重命名/移动、快照事务回滚、申请终态幂等、通知和审计脱敏。
- worker：Outbox 投递幂等、失败可重试、不生成重复通知。
- web：工作台列表排序、游标加载、各状态、角色感知操作和移动端只读布局。
- e2e：Reader 申请、Admin 审批、Editor 创建文件夹/文档、Admin 撤销后服务端拒绝写操作。
- 全局：格式、Lint、类型、阶段 1 回归、OpenAPI 生成无漂移、Compose 健康检查。

