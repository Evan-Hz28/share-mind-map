import {
  cloneCloudDocument,
  validateCloudDocumentSnapshot,
  type CloudDocumentV1,
} from "@share-mind-map/document-model";

export interface DraftMetadata {
  currentVersion?: number;
  savedAt?: string;
}

export interface StoredDraft {
  snapshot: CloudDocumentV1;
  currentVersion: number | null;
  savedAt: string;
}

function cloneSnapshot(snapshot: CloudDocumentV1): CloudDocumentV1 {
  return cloneCloudDocument(validateCloudDocumentSnapshot(snapshot));
}

export class DraftStore {
  private readonly storage: Storage;

  public constructor(storage: Storage = globalThis.localStorage) {
    this.storage = storage;
  }

  public static key(userId: string, workspaceId: string, documentId: string): string {
    return ["share-mind-map", "draft", userId, workspaceId, documentId]
      .map((value) => encodeURIComponent(value))
      .join(":");
  }

  public save(key: string, snapshot: CloudDocumentV1, metadata: DraftMetadata = {}): void {
    const record: StoredDraft = {
      snapshot: cloneSnapshot(snapshot),
      currentVersion: metadata.currentVersion ?? null,
      savedAt: metadata.savedAt ?? new Date().toISOString(),
    };
    this.storage.setItem(key, JSON.stringify(record));
  }

  public load(key: string): StoredDraft | null {
    const serialized = this.storage.getItem(key);
    if (serialized === null) return null;
    try {
      const parsed = JSON.parse(serialized) as Partial<StoredDraft>;
      if (parsed.snapshot === undefined) throw new Error("Missing snapshot");
      return {
        snapshot: cloneSnapshot(parsed.snapshot),
        currentVersion: typeof parsed.currentVersion === "number" ? parsed.currentVersion : null,
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      };
    } catch {
      this.storage.removeItem(key);
      return null;
    }
  }

  public clear(key: string): void {
    this.storage.removeItem(key);
  }

  public copyJson(key: string): string {
    const draft = this.load(key);
    if (draft === null) throw new Error("Draft not found");
    return JSON.stringify(draft.snapshot, null, 2);
  }
}
