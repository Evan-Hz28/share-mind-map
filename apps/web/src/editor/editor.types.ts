import type { CloudDocumentV1 } from "@share-mind-map/document-model";

export type EditorMode =
  | "readonly"
  | "acquiring-lock"
  | "editing-clean"
  | "editing-dirty"
  | "saving"
  | "save-failed"
  | "conflict"
  | "lock-lost"
  | "offline";

export interface EditorStateSnapshot {
  mode: EditorMode;
  dirty: boolean;
  canWrite: boolean;
  currentVersion: number | null;
  draft: CloudDocumentV1 | null;
}
