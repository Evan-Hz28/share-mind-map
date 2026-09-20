# Phase 4：查看、编辑、锁与图片设计

日期：2026-09-20
状态：设计稿
对应基线：`docs/dev/Phase4.md`、`docs/adr/0001-canvas-component.md`、`packages/document-model/schema/cloud-document-v1.schema.json`

## 1. 目标与边界

Phase 4 将阶段 3 已持久化的 `CloudDocumentV1` 接入正式文档页面，提供单编辑会话的安全编辑、版本保存、图片资产和已提交内容的实时只读同步。

本阶段必须保证：

- Reader、未持锁用户和移动端只能查看；只有持有有效编辑锁的桌面会话可以保存。
- 每次成功保存创建不可变快照，文档版本严格递增，并在事务提交后广播。
- 锁过期、强制释放、权限撤销、版本冲突、断网和服务异常都保留本地未保存内容。
- 画布只消费和产生 `CloudDocumentV1`，不得把 MindElixir 私有结构写入数据库、API 或 Socket.IO 事件。
- 图片只允许 PNG、JPEG、WebP；单张最多 5 MiB，单文档在线图片最多 50 MiB。

明确不在本阶段实现：阶段 5 历史浏览和恢复、搜索、回收站、多人同时写入、CRDT/OT、离线编辑、复杂 XMind 私有主题和移动端编辑。

## 2. 当前系统约束

阶段 3 已有：

- `documents`、`document_snapshots`、`document_assets` 数据表和文档详情 API。
- MinIO 私有对象存储与原始 XMind 资产。
- `CloudDocumentV1` Schema 和树结构不变量校验。
- `WorkspaceRealtimeGateway`，目前只负责导入批次进度。
- `MindElixirAdapter` PoC，已验证标准模型导入、替换、视图状态和销毁。

正式实现沿用现有 NestJS、Drizzle/PostgreSQL、Redis、MinIO、Vue/Pinia、Socket.IO 和 Playwright 技术栈，不引入新的协作协议。

## 3. 纵向切片

按以下顺序交付，每个切片都有独立测试和可运行结果：

1. 正式文档查看页与画布适配器。
2. Redis 编辑锁和 PostgreSQL 版本安全保存。
3. 图片上传、引用、配额和对象生命周期状态。
4. 文档房间、presence、版本广播、重连和未保存内容保护。
5. 端到端故障矩阵、性能证据、文档和全量回归。

## 4. 模块边界

### API

```text
apps/api/src/documents/     # 详情读取、快照保存、文档事件
apps/api/src/locks/         # Redis 锁获取、心跳、释放和强制释放
apps/api/src/assets/        # 图片检测、上传、引用和配额
apps/api/src/realtime/      # 文档房间和提交后广播
```

### Web

```text
apps/web/src/documents/     # 文档页面和导航
apps/web/src/editor/        # 编辑状态、保存队列和草稿保护
apps/web/src/editor/adapters/ # MindElixir 唯一边界
apps/web/src/editor/assets/ # 文件、剪贴板和拖拽入口
apps/web/src/realtime/      # 连接、重连和高版本过滤
```

### Database/model

```text
packages/database/src/schema/       # Phase4 资产引用和保存元数据
packages/database/src/repositories/ # 锁外的事务读写边界
packages/document-model/            # Schema、不变量和快照转换
```

## 5. 正式画布适配器

适配器接口扩展为：

```ts
interface MindMapAdapter {
  mount(document: CloudDocumentV1): Promise<void>;
  applySnapshot(document: CloudDocumentV1): Promise<void>;
  exportSnapshot(): CloudDocumentV1;
  onChange(listener: (document: CloudDocumentV1) => void): () => void;
  focusNode(nodeId: string): Promise<boolean>;
  getViewState(): MindMapViewState;
  restoreViewState(state: MindMapViewState): Promise<void>;
  setReadOnly(readOnly: boolean): void;
  destroy(): void;
}
```

适配器内部持有标准模型副本。MindElixir 只负责渲染和交互，使用其公开的 `operation`、`selectNodes` 和 `expandNode` 事件转换回标准模型；每次操作后从稳定 ID 树重建标准快照并执行 Schema/不变量校验。若第三方事件无法表达某项能力，由适配器维护标准模型并刷新第三方视图，禁止把第三方对象直接上送 API。

编辑页面只在桌面视口且 `editor.canWrite === true` 时启用适配器写操作。移动端、Reader、锁被占用和失去锁的状态调用 `setReadOnly(true)`。

视图状态按 `{userId, workspaceId, documentId}` 隔离保存，包含选中节点、展开节点、滚动位置和缩放，不包含 `CloudDocumentV1` 内容；节点消失时选择最近祖先，否则回退根节点并提示。

## 6. 文档 API 与保存事务

保留现有详情端点，并增加以下契约：

```text
GET    /api/v1/workspaces/:workspaceId/documents/:documentId
POST   /api/v1/workspaces/:workspaceId/documents/:documentId/snapshots
POST   /api/v1/workspaces/:workspaceId/documents/:documentId/draft-export
```

保存请求：

```json
{
  "lockToken": "opaque-random-token",
  "lockGeneration": 7,
  "baseVersion": 12,
  "saveKind": "auto",
  "snapshot": { "schemaVersion": 1, "documentId": "...", "version": 12, "sheets": [], "extensions": {} }
}
```

客户端不能决定新版本号；服务端将快照版本设置为 `currentVersion + 1`，并拒绝请求体中的不一致版本或 documentId。

保存事务：

1. `SessionGuard`、密码状态和工作空间成员权限校验。
2. Redis 原子校验锁凭证、会话、编辑会话和 generation。
3. PostgreSQL `SELECT ... FOR UPDATE` 锁定有效文档并比较 `baseVersion`。
4. 解析并校验 `CloudDocumentV1` Schema、树不变量、节点数、图片引用和请求体上限。
5. 计算标准化 JSON 的 SHA-256；小快照存 `snapshot_json`，超过数据库 JSON 阈值时先写 MinIO 私有对象，再在事务中存对象键和摘要。
6. 创建新的 `document_snapshots` 行，`save_kind` 为 `auto` 或 `manual`，并建立该快照的图片引用。
7. 更新 `documents.current_version`、`current_snapshot_id`、`node_count`、`image_bytes` 和 `updated_by`。
8. 写入不包含锁令牌、完整快照或图片对象键的审计记录。
9. 提交事务后向文档房间广播完整已提交快照。

重复请求使用 `Idempotency-Key` 请求头和 `(documentId, lockGeneration, baseVersion, snapshotSha256)` 的幂等判断；同一保存结果重复到达时返回原版本，不创建第二个快照。旧版本、旧 generation、无锁和失效会话均返回稳定错误码，不能修改数据库。

导出最新内容前，页面必须确认没有待保存修改；保存失败时默认阻止最新内容导出，只有用户明确选择草稿导出才使用本地快照。

## 7. 编辑锁

Redis 键：

```text
lock:document:{documentId}
```

值为 Hash，字段包括 `documentId`、`userId`、`platformSessionId`、`browserEditSessionId`、`tokenDigest`、`generation` 和 `heartbeatAt`，TTL 为 15 分钟。浏览器编辑会话启动时生成随机 token 和随机编辑会话 ID，token 仅保存在 JS 内存中。

接口：

```text
POST   /api/v1/workspaces/:workspaceId/documents/:documentId/lock
POST   /api/v1/workspaces/:workspaceId/documents/:documentId/lock/heartbeat
DELETE /api/v1/workspaces/:workspaceId/documents/:documentId/lock
POST   /api/v1/workspaces/:workspaceId/documents/:documentId/lock/force-release
GET    /api/v1/workspaces/:workspaceId/documents/:documentId/lock
```

获取、心跳、释放和强制释放使用 Lua 脚本或等价的单条 Redis 原子操作。心跳间隔明显小于 TTL；锁失效或心跳失败立即切换只读，并保留脏草稿。强制释放将 generation 加一，原会话的迟到心跳和保存确定性失败。Admin 强制释放需要二次确认并写审计。

锁查询只返回是否占用、当前编辑者展示名、generation、心跳时间和剩余 TTL，不返回令牌、摘要或 Redis 内容。

## 8. 图片资产

上传接口：

```text
POST /api/v1/workspaces/:workspaceId/documents/:documentId/assets
GET  /api/v1/workspaces/:workspaceId/documents/:documentId/assets/:assetId
```

上传同时校验当前锁；请求采用流式大小限制，服务端计算 SHA-256 并解析真实媒体类型和尺寸。对象先写入不可变内部键：

```text
org/{orgId}/workspace/{workspaceId}/document/{documentId}/asset/{assetId}
```

数据库保留 `document_assets`，增加工作空间和 SHA-256 查询索引，并增加快照引用表：

```text
snapshot_asset_refs(snapshot_id, asset_id, primary key(snapshot_id, asset_id))
```

`pending` 不新增可变状态字段，而是由“尚未出现在任何 `snapshot_asset_refs` 中”派生；一旦建立引用即为 `referenced`。删除节点只影响未来快照引用，不物理删除对象。清理任务只删除超过保留窗口、没有快照引用且没有进行中上传的对象。引用表使用 `snapshot_id` 和 `asset_id` 外键，并在同一保存事务中写入。

图片读取端点只允许当前工作空间成员访问，并确认资产属于指定文档且出现在当前快照引用中；服务端从私有 MinIO 流式返回正确 `Content-Type`，不返回内部对象键或永久公开 URL。

资产复用按工作空间和 SHA-256 查找相同字节，但每个文档的引用关系仍必须单独建立。总图片大小由当前快照引用的资产计算，并在事务中校验 50 MiB；达到组织存储 100% 时拒绝图片上传，但不拒绝纯文本保存。

## 9. 实时只读同步

扩展现有 `/workspace` Socket.IO 网关，新增文档事件：

```text
document:join    { workspaceId, documentId }
document:leave   { documentId }
document:presence
document:snapshot { documentId, version, snapshot }
document:lock
```

加入房间必须通过当前会话和成员关系校验；每个文档房间最多 100 个实时成员，超额用户仍可使用 REST 读取。服务端只广播已提交快照，不广播编辑中的浏览器状态。

客户端保存 `lastAcceptedVersion`，只接受更高版本。收到版本跳跃、Schema 不兼容、documentId 不符或解析失败时丢弃推送，调用 REST 重新拉取并根据节点 ID 恢复视图状态。重连必须重新鉴权、重新加入和 REST 拉取；编辑锁不会自动恢复。

## 10. Web 编辑状态与故障保护

编辑 Store 使用以下状态：

```text
loading → readonly
readonly → acquiring-lock → editing-clean
editing-clean → editing-dirty → saving → editing-clean
editing-dirty → save-failed | conflict | lock-lost | offline
```

自动保存使用防抖队列并串行发送；手动保存先等待队列完成并使用 `saveKind=manual`。请求失败不删除本地快照。草稿键按用户、工作空间和文档隔离，成功保存或用户明确丢弃后才删除。

页面关闭、路由跳转、退出登录和权限撤销时，如果存在脏数据，先尝试保存；无法保存则显示离开确认，并保留复制 JSON 和导出草稿入口。网络断开后立即只读，恢复连接时只重新拉取，不自动重新获取编辑锁。

备注以纯文本渲染；所有用户可控标题、标签、备注和资产展示不通过 `v-html` 注入。

## 11. 测试与验收证据

### 单元和集成测试

- 适配器操作后稳定 ID、层级、顺序、属性和标准快照不变量保持正确。
- 锁获取、重复获取、心跳、过期、释放、强制释放和 generation 递增。
- 旧 token、旧 generation、失效会话和无权限保存全部拒绝。
- `baseVersion` 冲突、重复请求和更高版本竞争不会覆盖当前快照。
- 每次成功保存产生一个不可变快照和单调版本。
- 图片真实类型、伪造 MIME、5 MiB/50 MiB边界、重复字节和引用生命周期。
- Socket.IO 房间权限、100/101 人边界、版本过滤、版本跳跃重载和重连。
- 自动保存串行、防抖、失败重试和草稿保留。

### E2E 与性能

Playwright Chromium 覆盖桌面查看/编辑、移动只读、双浏览器锁竞争、强制释放、版本冲突、断网和图片上传；数据库和 MinIO 集成测试使用真实 Compose 依赖。

性能证据记录 CPU、内存、Node、浏览器和构建版本，分别测量 5,000 节点 3 秒内可操作、20,000 节点 5 秒内出现可操作首屏。未达标时记录实际指标和明确收缩结论，不用 PoC 合成数据冒充业务文档验收。

最终门禁：阶段 0～3 回归、format、lint、typecheck、build、API 契约漂移检查、全部单元/集成/E2E 测试和阶段验证报告均通过；README、接口/事件契约和 ADR 若发生变化同步更新。
