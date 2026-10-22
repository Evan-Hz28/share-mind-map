export type QuotaThreshold = "normal" | "warning" | "critical" | "exceeded";

export type Phase2RepositoryErrorCode =
  | "WORKSPACE_NOT_FOUND"
  | "FOLDER_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "FOLDER_LIMIT_REACHED"
  | "FOLDER_DOCUMENT_LIMIT_REACHED"
  | "WORKSPACE_DOCUMENT_LIMIT_REACHED"
  | "FOLDER_NOT_IN_WORKSPACE"
  | "FOLDER_DELETE_BLOCKED"
  | "FOLDER_DELETE_CONFLICT"
  | "FOLDER_ORDER_CONFLICT"
  | "FOLDER_DEPTH_EXCEEDED"
  | "FOLDER_MOVE_CYCLE"
  | "DOCUMENT_NOT_IN_WORKSPACE"
  | "EDIT_PERMISSION_ALREADY_GRANTED";

export class Phase2RepositoryError extends Error {
  public constructor(
    public readonly code: Phase2RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "Phase2RepositoryError";
  }
}

export interface WorkspaceUsage {
  workspaceId: string;
  folderCount: number;
  documentCount: number;
  knownObjectBytes: number;
  quotaBytes: number;
  usagePercent: number;
  threshold: QuotaThreshold;
  reconciliationStatus: "pending";
}
