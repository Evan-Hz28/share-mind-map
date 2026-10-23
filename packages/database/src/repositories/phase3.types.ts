export type ImportJobPhase =
  "waiting" | "uploading" | "parsing" | "persisting" | "succeeded" | "failed" | "cancelled";

export type ImportBatchStatus =
  "pending" | "uploading" | "processing" | "succeeded" | "partial" | "failed" | "cancelled";

export type CompatibilityStatus = "full" | "partial" | "unsupported_online";

export type ImportRepositoryErrorCode =
  | "WORKSPACE_NOT_FOUND"
  | "IMPORT_BATCH_NOT_FOUND"
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_QUEUE_LIMIT_REACHED"
  | "IMPORT_STORAGE_QUOTA_EXCEEDED"
  | "IMPORT_TARGET_FOLDER_INVALID"
  | "IMPORT_TARGET_FOLDER_FULL"
  | "IMPORT_NAME_CONFLICT"
  | "INVALID_IMPORT_TRANSITION"
  | "IMPORT_RETRY_NOT_ALLOWED";

export class ImportRepositoryError extends Error {
  public constructor(
    public readonly code: ImportRepositoryErrorCode,
    message: string,
    public readonly conflictNames: readonly string[] = [],
  ) {
    super(message);
    this.name = "ImportRepositoryError";
  }
}
