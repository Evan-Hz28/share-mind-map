import {
  cloneCloudDocument,
  validateCloudDocumentSnapshot,
  type CloudDocumentV1,
} from "@share-mind-map/document-model";
import type { LockLeaseDto } from "@share-mind-map/api-client";
import { defineStore, type Pinia } from "pinia";

import type { EditorMode } from "./editor.types.js";

interface EditorState {
  mode: EditorMode;
  dirty: boolean;
  currentVersion: number | null;
  draft: CloudDocumentV1 | null;
  lockLease: LockLeaseDto | null;
}

export const useEditorStoreDefinition = defineStore("editor", {
  state: (): EditorState => ({
    mode: "readonly",
    dirty: false,
    currentVersion: null,
    draft: null,
    lockLease: null,
  }),
  getters: {
    canWrite: (state): boolean => state.mode === "editing-clean" || state.mode === "editing-dirty",
  },
  actions: {
    setDocument(document: CloudDocumentV1, currentVersion = document.version): void {
      validateCloudDocumentSnapshot(document);
      this.currentVersion = currentVersion;
      this.draft = null;
      this.dirty = false;
      this.mode = "readonly";
      this.lockLease = null;
    },

    startEditing(currentVersion: number): void {
      this.currentVersion = currentVersion;
      this.mode = "editing-clean";
      this.dirty = false;
      this.draft = null;
    },

    stopEditing(): void {
      this.mode = "readonly";
      this.lockLease = null;
    },

    markChanged(document: CloudDocumentV1): void {
      const validated = validateCloudDocumentSnapshot(document);
      this.draft = cloneCloudDocument(validated);
      this.dirty = true;
      this.mode = "editing-dirty";
    },

    markSaved(version: number): void {
      this.currentVersion = version;
      this.draft = null;
      this.dirty = false;
      this.mode = "editing-clean";
    },

    setMode(mode: EditorMode): void {
      this.mode = mode;
    },

    discardDraft(): void {
      this.draft = null;
      this.dirty = false;
      this.mode = "readonly";
      this.lockLease = null;
    },

    setLockLease(lease: LockLeaseDto): void {
      this.lockLease = { ...lease };
    },

    clearLockLease(): void {
      this.lockLease = null;
    },

    markLockLost(): void {
      this.mode = "lock-lost";
    },

    markConflict(): void {
      this.mode = "conflict";
    },

    markOffline(): void {
      this.mode = "offline";
    },

    markSaveFailed(): void {
      this.mode = "save-failed";
    },
  },
});

export function useEditorStore(pinia?: Pinia): ReturnType<typeof useEditorStoreDefinition> {
  return useEditorStoreDefinition(pinia);
}
