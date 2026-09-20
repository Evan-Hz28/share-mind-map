import {
  exportDocumentDraft,
  getDocumentMetadata,
  inspectDocumentLock,
  type DocumentDetailDto,
  type LockDto,
} from "@share-mind-map/api-client";
import { defineStore, type Pinia } from "pinia";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import {
  validateCloudDocumentSnapshot,
  type CloudDocumentV1,
} from "@share-mind-map/document-model";

export type DocumentConnectionState = "idle" | "loading" | "connected" | "error";

export interface DocumentViewModel {
  metadata: DocumentDetailDto | null;
  snapshot: CloudDocumentV1 | null;
  compatibility: DocumentDetailDto["compatibilityStatus"] | null;
  connection: DocumentConnectionState;
  lock: LockDto | null;
}

interface DocumentState extends DocumentViewModel {
  workspaceId: string | null;
  documentId: string | null;
  error: RequestFailure | null;
}

export const useDocumentStoreDefinition = defineStore("document", {
  state: (): DocumentState => ({
    workspaceId: null,
    documentId: null,
    metadata: null,
    snapshot: null,
    compatibility: null,
    connection: "idle",
    lock: null,
    error: null,
  }),
  getters: {
    viewModel: (state): DocumentViewModel => ({
      metadata: state.metadata,
      snapshot: state.snapshot,
      compatibility: state.compatibility,
      connection: state.connection,
      lock: state.lock,
    }),
  },
  actions: {
    async load(workspaceId: string, documentId: string): Promise<void> {
      this.workspaceId = workspaceId;
      this.documentId = documentId;
      this.connection = "loading";
      this.error = null;
      const [detail, lock] = await Promise.all([
        getDocumentMetadata({ client: apiClient, path: { workspaceId, documentId } }),
        inspectDocumentLock({ client: apiClient, path: { workspaceId, documentId } }),
      ]);
      if (detail.data === undefined) {
        this.error = toApiFailure(detail.error);
        this.connection = "error";
        return;
      }
      this.metadata = detail.data.document;
      try {
        this.snapshot = validateCloudDocumentSnapshot(detail.data.document.snapshot);
      } catch {
        this.error = { code: "DOCUMENT_SCHEMA_INVALID", message: "", details: {}, requestId: "" };
        this.connection = "error";
        return;
      }
      this.compatibility = detail.data.document.compatibilityStatus;
      this.lock = lock.data?.lock ?? null;
      this.connection = "connected";
    },

    async refresh(): Promise<void> {
      if (this.workspaceId !== null && this.documentId !== null)
        await this.load(this.workspaceId, this.documentId);
    },

    async exportDraft(snapshot: CloudDocumentV1): Promise<Blob> {
      if (this.workspaceId === null || this.documentId === null)
        throw new Error("Document identity is not loaded");
      const result = await exportDocumentDraft({
        client: apiClient,
        path: { workspaceId: this.workspaceId, documentId: this.documentId },
        body: { snapshot: snapshot as unknown as Record<string, unknown> },
      });
      if (result.data === undefined) throw toApiFailure(result.error);
      return result.data;
    },
  },
});

export function useDocumentStore(pinia?: Pinia): ReturnType<typeof useDocumentStoreDefinition> {
  return useDocumentStoreDefinition(pinia);
}
