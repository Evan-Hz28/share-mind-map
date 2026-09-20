import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { saveDocumentSnapshot } = vi.hoisted(() => ({ saveDocumentSnapshot: vi.fn() }));

vi.mock("@share-mind-map/api-client", async () => {
  const actual = await vi.importActual<typeof import("@share-mind-map/api-client")>(
    "@share-mind-map/api-client",
  );
  return { ...actual, saveDocumentSnapshot };
});

import { useDocumentStore } from "../../src/documents/document.store.js";
import { apiClient } from "../../src/api.js";
import type { CloudDocumentV1 } from "@share-mind-map/document-model";

const documentId = "00000000-0000-7000-8000-000000000101";
const workspaceId = "00000000-0000-7000-8000-000000000003";
const snapshot: CloudDocumentV1 = {
  schemaVersion: 1,
  documentId,
  version: 3,
  sheets: [],
  extensions: {},
};

describe("DocumentStore.saveSnapshot", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    saveDocumentSnapshot.mockReset();
    saveDocumentSnapshot.mockResolvedValue({
      data: {
        idempotent: false,
        snapshot: { id: "00000000-0000-7000-8000-000000000104", version: 4 },
      },
    });
  });

  it("submits the base version, lock lease, idempotency key, and asset references", async () => {
    const store = useDocumentStore();
    store.workspaceId = workspaceId;
    store.documentId = documentId;

    await expect(
      store.saveSnapshot(
        snapshot,
        {
          browserEditSessionId: "browser-session",
          generation: 7,
          token: "opaque-token",
        },
        "manual",
        "save-key-1",
        123,
      ),
    ).resolves.toEqual({ version: 4, idempotent: false });

    expect(saveDocumentSnapshot).toHaveBeenCalledWith({
      client: apiClient,
      path: { workspaceId, documentId },
      headers: { "Idempotency-Key": "save-key-1" },
      body: {
        baseVersion: 3,
        browserEditSessionId: "browser-session",
        generation: 7,
        imageBytes: 123,
        saveKind: "manual",
        snapshot,
        token: "opaque-token",
        assetIds: [],
      },
    });
  });
});
