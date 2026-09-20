import { render, screen, waitFor } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/editor/adapters/mind-elixir.js", () => ({
  MindElixirAdapter: class {
    async mount(): Promise<void> {}
    setReadOnly(): void {}
    onChange(): () => void {
      return () => undefined;
    }
    destroy(): void {}
  },
}));

vi.mock("../../src/realtime/document-realtime.js", () => ({
  DocumentRealtime: class {
    connect(): void {}
    join(): void {}
    disconnect(): void {}
    onSnapshot(): () => void {
      return () => undefined;
    }
    onLock(): () => void {
      return () => undefined;
    }
  },
}));

import DocumentView from "../../src/documents/DocumentView.vue";
import { useAuthStore } from "../../src/auth/auth.store.js";
import { sessionResponse } from "../helpers.js";

const documentId = "00000000-0000-7000-8000-000000000101";
const workspaceId = "00000000-0000-7000-8000-000000000003";
const snapshot = {
  schemaVersion: 1,
  documentId,
  version: 1,
  sheets: [
    {
      id: "00000000-0000-7000-8000-000000000102",
      title: "Sheet",
      rootNodeId: "00000000-0000-7000-8000-000000000103",
      nodes: {
        "00000000-0000-7000-8000-000000000103": {
          id: "00000000-0000-7000-8000-000000000103",
          parentId: null,
          childIds: [],
          title: "安全文本",
          priority: null,
          notes: { format: "plain", text: "普通备注" },
          labels: [],
          icons: [],
          style: {},
          imageAssetId: null,
          extensions: {},
        },
      },
      relationships: [],
      extensions: {},
    },
  ],
  extensions: {},
};

beforeEach(() => {
  setActivePinia(createPinia());
  useAuthStore().$patch({
    state: "authenticated",
    session: sessionResponse("reader"),
    csrfToken: "csrf",
  });
});

describe("DocumentView", () => {
  it("shows loading and then a reader-safe document presentation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            document: {
              id: documentId,
              workspaceId,
              folderId: null,
              name: "安全文档",
              currentVersion: 1,
              schemaVersion: 1,
              compatibilityStatus: "full",
              nodeCount: 1,
              imageBytes: 0,
              createdAt: "2026-09-20T00:00:00.000Z",
              updatedAt: "2026-09-20T00:00:00.000Z",
              snapshot,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lock: { occupied: false, generation: 0, ttlSeconds: -2, expiresAt: "" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(DocumentView, { props: { workspaceId, documentId } });
    expect(screen.getByRole("status")).toHaveTextContent("加载");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "安全文档" })).toBeInTheDocument(),
    );
    expect(screen.getByText("只读模式")).toBeInTheDocument();
    expect(screen.getByText(/版本 1/)).toBeInTheDocument();
    expect(screen.getByText("普通备注")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("v-html");
  });
});
