import type { DatabaseTransaction } from "./member.repository.js";
import type { DocumentRecord } from "./document.repository.js";

export type Phase4SaveKind = "auto" | "manual" | "restore";

export type Phase4RepositoryErrorCode =
  | "DOCUMENT_VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "DOCUMENT_ASSET_INVALID"
  | "DOCUMENT_IMAGE_QUOTA_EXCEEDED";

export class Phase4RepositoryError extends Error {
  public constructor(
    public readonly code: Phase4RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "Phase4RepositoryError";
  }
}

export interface SaveSnapshotDocument {
  schemaVersion: number;
  sheets: readonly { nodes: Record<string, unknown> }[];
}

export interface SaveSnapshotInput {
  workspaceId: string;
  documentId: string;
  actorUserId: string;
  baseVersion: number;
  saveKind: Phase4SaveKind;
  snapshot: SaveSnapshotDocument;
  snapshotSha256: string;
  snapshotJson: unknown;
  snapshotObjectKey: string | null;
  imageBytes: number;
  assetIds: readonly string[];
  idempotencyKey: string;
}

export interface SnapshotRecord {
  id: string;
  documentId: string;
  version: number;
  schemaVersion: number;
  snapshot: unknown;
  snapshotObjectKey: string | null;
  snapshotSha256: string;
  nodeCount: number;
  saveKind: Phase4SaveKind;
}

export interface SaveSnapshotResult {
  document: DocumentRecord;
  snapshot: SnapshotRecord;
  idempotent: boolean;
}

export type SaveSnapshotTransaction = DatabaseTransaction;
