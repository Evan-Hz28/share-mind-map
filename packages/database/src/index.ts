export { createDatabase, type Database } from "./client.js";
export { newId } from "./id.js";
export { migrateDatabase } from "./migrate.js";
export { schema } from "./schema/index.js";
export * from "./schema/index.js";
export {
  ApiTestRepository,
  type ApiTestEnvironmentRecord,
  type ApiTestItemStatus,
  type ApiTestRunItemRecord,
  type ApiTestRunRecord,
  type ApiTestRunStatus,
  type ApiTestSuiteRecord,
} from "./repositories/api-test.repository.js";
export { AuditRepository, type AuditEvent } from "./repositories/audit.repository.js";
export { IdentityRepository, type LocalPrincipal } from "./repositories/identity.repository.js";
export {
  MemberRepository,
  type DatabaseTransaction,
  type MemberRecord,
} from "./repositories/member.repository.js";
export { decodeCursor, encodeCursor, type CursorValue } from "./repositories/cursor.js";
export {
  EntityNameValidationError,
  normalizeEntityName,
  type NormalizedEntityName,
} from "./repositories/name-normalization.js";
export { QuotaRepository } from "./repositories/quota.repository.js";
export {
  Phase2RepositoryError,
  type Phase2RepositoryErrorCode,
  type QuotaThreshold,
  type WorkspaceUsage,
} from "./repositories/phase2.types.js";
export {
  DocumentRepository,
  type DocumentDetail,
  type DocumentListResult,
  type DocumentRecord,
} from "./repositories/document.repository.js";
export {
  Phase4RepositoryError,
  type Phase4RepositoryErrorCode,
  type Phase4SaveKind,
  type SaveSnapshotDocument,
  type SaveSnapshotInput,
  type SaveSnapshotResult,
  type SnapshotRecord,
} from "./repositories/phase4.types.js";
export { FolderRepository, type FolderRecord } from "./repositories/folder.repository.js";
export {
  NotificationRepository,
  type NotificationOutboxInput,
} from "./repositories/notification.repository.js";
export {
  PermissionRequestRepository,
  type PermissionDecisionResult,
  type PermissionRequestRecord,
  type PermissionRequestStatus,
  type RevokeEditingResult,
} from "./repositories/permission-request.repository.js";
export {
  ImportRepository,
  type ImportBatchRecord,
  type ImportJobRecord,
} from "./repositories/import.repository.js";
export {
  ImportRepositoryError,
  type CompatibilityStatus,
  type ImportBatchStatus,
  type ImportJobPhase,
} from "./repositories/phase3.types.js";
