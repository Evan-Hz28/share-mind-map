import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

let realtimeLockListener:
  | ((lock: {
      occupied: boolean;
      editorDisplayName: string | null;
      expiresAt: string | null;
      generation: number;
    }) => void)
  | undefined;

vi.mock("../../src/editor/adapters/mind-elixir.js", () => ({
  MindElixirAdapter: class {
    async mount(): Promise<void> {}
    async applySnapshot(): Promise<void> {}
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
    onLock(listener: typeof realtimeLockListener): () => void {
      realtimeLockListener = listener;
      return () => undefined;
    }
  },
}));

import DocumentView from "../../src/documents/DocumentView.vue";
import { useAuthStore } from "../../src/auth/auth.store.js";
import { useEditorStore } from "../../src/editor/editor.store.js";
import { DraftStore } from "../../src/editor/draft-store.js";
import type { CloudDocumentV1 } from "@share-mind-map/document-model";
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
  realtimeLockListener = undefined;
  localStorage.clear();
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

  it("turns an active editor read-only when a forced-release lock event arrives", async () => {
    useAuthStore().$patch({ session: sessionResponse("admin") });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            document: {
              id: documentId,
              workspaceId,
              folderId: null,
              name: "强制释放文档",
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
            lock: { occupied: false, generation: 0, ttlSeconds: 900, expiresAt: "" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lock: {
              occupied: true,
              generation: 1,
              ttlSeconds: 900,
              expiresAt: "2026-09-20T00:15:00.000Z",
              token: "opaque-token",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(DocumentView, { props: { workspaceId, documentId } });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "强制释放文档" })).toBeInTheDocument(),
    );
    await fireEvent.click(screen.getByRole("button", { name: "开始编辑" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "结束编辑" })).toBeInTheDocument(),
    );

    realtimeLockListener?.({
      occupied: false,
      editorDisplayName: null,
      expiresAt: null,
      generation: 2,
    });
    await waitFor(() =>
      expect(screen.getByText("编辑锁已失效，当前修改已转为只读草稿。")).toBeInTheDocument(),
    );
  });

  it("offers recovery for a draft retained across a page reload", async () => {
    const administrator = sessionResponse("admin");
    useAuthStore().$patch({ session: administrator });
    const draft = { ...snapshot, version: 1 } as CloudDocumentV1;
    new DraftStore().save(DraftStore.key(administrator.user.id, workspaceId, documentId), draft, {
      currentVersion: 1,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            document: {
              id: documentId,
              workspaceId,
              folderId: null,
              name: "恢复草稿文档",
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
            lock: { occupied: false, generation: 0, ttlSeconds: 900, expiresAt: "" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lock: {
              occupied: true,
              generation: 1,
              ttlSeconds: 900,
              expiresAt: "2026-09-20T00:15:00.000Z",
              token: "opaque-token",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(DocumentView, { props: { workspaceId, documentId } });
    await waitFor(() => expect(screen.getByText("检测到本机草稿。")).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "恢复草稿" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument());
  });

  it("saves a dirty desktop draft after acquiring the edit lock", async () => {
    useAuthStore().$patch({ session: sessionResponse("admin") });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            document: {
              id: documentId,
              workspaceId,
              folderId: null,
              name: "可编辑文档",
              currentVersion: 3,
              schemaVersion: 1,
              compatibilityStatus: "full",
              nodeCount: 1,
              imageBytes: 0,
              createdAt: "2026-09-20T00:00:00.000Z",
              updatedAt: "2026-09-20T00:00:00.000Z",
              snapshot: { ...snapshot, version: 3 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lock: { occupied: false, generation: 0, ttlSeconds: 900, expiresAt: "" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lock: {
              occupied: true,
              generation: 1,
              ttlSeconds: 900,
              expiresAt: "2026-09-20T00:15:00.000Z",
              token: "opaque-token",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            idempotent: false,
            document: { currentVersion: 4 },
            snapshot: { id: "00000000-0000-7000-8000-000000000104", version: 4 },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(DocumentView, { props: { workspaceId, documentId } });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "可编辑文档" })).toBeInTheDocument(),
    );
    await fireEvent.click(screen.getByRole("button", { name: "开始编辑" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "结束编辑" })).toBeInTheDocument(),
    );

    useEditorStore().markChanged({ ...snapshot, version: 3 } as CloudDocumentV1);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    const fetchCalls = fetchMock.mock.calls as Array<[unknown, RequestInit | undefined]>;
    const saveRequest = fetchCalls
      .map(([input]) => input)
      .find(
        (input): input is Request =>
          input instanceof Request && input.url.includes(`/documents/${documentId}/snapshots`),
      );
    expect(saveRequest).toBeDefined();
    if (saveRequest === undefined) throw new Error("Save request is missing");
    expect(saveRequest.headers.get("Idempotency-Key")).toMatch(/^document-save-/);
    const requestBody = (await saveRequest.clone().json()) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      baseVersion: 3,
      generation: 1,
      saveKind: "manual",
      token: "opaque-token",
    });
    expect(typeof requestBody.browserEditSessionId).toBe("string");
    expect(requestBody.snapshot).toMatchObject({ documentId, version: 3 });
    expect(screen.getByText(/版本 4/)).toBeInTheDocument();

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            idempotent: false,
            document: { currentVersion: 5 },
            snapshot: { id: "00000000-0000-7000-8000-000000000105", version: 5 },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lock: { occupied: false, generation: 1, ttlSeconds: -2, expiresAt: "" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    useEditorStore().markChanged({ ...snapshot, version: 4 } as CloudDocumentV1);
    await fireEvent.click(screen.getByRole("button", { name: "结束编辑" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(6);
    });
    const snapshotRequests = fetchCalls.filter(
      ([input]) =>
        input instanceof Request && input.url.includes(`/documents/${documentId}/snapshots`),
    );
    expect(snapshotRequests).toHaveLength(2);
    expect((snapshotRequests[1]?.[0] as Request).method).toBe("POST");
    expect(screen.getByText(/版本 5/)).toBeInTheDocument();
  });

  it("protects a dirty draft when permission is revoked during save", async () => {
    useAuthStore().$patch({ session: sessionResponse("admin") });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            document: {
              id: documentId,
              workspaceId,
              folderId: null,
              name: "权限撤销文档",
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
            lock: { occupied: false, generation: 0, ttlSeconds: 900, expiresAt: "" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lock: {
              occupied: true,
              generation: 1,
              ttlSeconds: 900,
              expiresAt: "2026-09-20T00:15:00.000Z",
              token: "opaque-token",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "PERMISSION_DENIED", requestId: "request-1" } }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(DocumentView, { props: { workspaceId, documentId } });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "权限撤销文档" })).toBeInTheDocument(),
    );
    await fireEvent.click(screen.getByRole("button", { name: "开始编辑" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "结束编辑" })).toBeInTheDocument(),
    );
    useEditorStore().markChanged({ ...snapshot } as CloudDocumentV1);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(screen.getByText("编辑锁已失效，当前修改已转为只读草稿。")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "复制草稿 JSON" })).toBeInTheDocument();
  });
});
