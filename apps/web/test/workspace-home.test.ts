import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import WorkspaceHomeView from "../src/app/WorkspaceHomeView.vue";
import { useAuthStore } from "../src/auth/auth.store.js";
import { sessionResponse, apiError, jsonResponse } from "./helpers.js";

const workspaceId = "00000000-0000-7000-8000-000000000003";
const documentId = "00000000-0000-7000-8000-000000000010";

const folder = {
  id: "00000000-0000-7000-8000-000000000020",
  workspaceId,
  name: "测试文件夹",
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
};

const documentRecord = {
  id: documentId,
  workspaceId,
  folderId: null,
  name: "ViewHistory客户端测试用例",
  currentVersion: 28,
  schemaVersion: 1,
  compatibilityStatus: "partial" as const,
  nodeCount: 127,
  imageBytes: 0,
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
};

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/workspace", name: "workspace", component: WorkspaceHomeView },
      {
        path: "/workspace/documents/:documentId",
        name: "document",
        component: { template: "<div />" },
      },
    ],
  });
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  return typeof body === "string" ? JSON.parse(body) : {};
}

function installWorkspaceApi(
  options: {
    folders?: unknown[];
    documents?: unknown[];
    failure?: boolean;
    requestFailure?: boolean;
    pending?: boolean;
    storageThreshold?: "normal" | "warning" | "critical" | "exceeded";
    importFailureCode?: string;
    folderDeleteDocumentCount?: number;
    folderDeleteDescendantCount?: number;
    /** 第一次创建这个名称时返回 409,并把文件夹写进列表,模拟并发创建。 */
    folderConflictOnce?: string;
  } = {},
): void {
  const folderState = [...((options.folders ?? [folder]) as Array<Record<string, unknown>>)];
  let createdFolderCount = 0;
  let conflictServed = false;
  const nextFolderId = (): string =>
    `00000000-0000-7000-8000-${String(40 + createdFolderCount++).padStart(12, "0")}`;
  const createFolderRecord = (name: string, parentId: string | null): Record<string, unknown> => {
    const record = {
      id: nextFolderId(),
      workspaceId,
      parentId,
      name,
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    };
    folderState.push(record);
    return record;
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(requestUrl, location.origin);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (options.pending) return new Promise<Response>(() => undefined);
      if (url.pathname.endsWith("/folders/order") && method === "PATCH") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.pathname.endsWith("/folders") && method === "POST") {
        const body = parseRequestBody(init?.body) as {
          name?: string;
          parentId?: string | null;
        };
        const name = body.name ?? "";
        if (!conflictServed && options.folderConflictOnce === name) {
          conflictServed = true;
          createFolderRecord(name, body.parentId ?? null);
          return Promise.resolve(apiError("FOLDER_NAME_CONFLICT", "conflict", 409));
        }
        return Promise.resolve(
          jsonResponse({ folder: createFolderRecord(name, body.parentId ?? null) }, 201),
        );
      }
      const parentMatch = /\/folders\/([^/]+)\/parent$/u.exec(url.pathname);
      if (parentMatch !== null && method === "PATCH") {
        const folderId = parentMatch[1];
        const body = parseRequestBody(init?.body) as { parentId?: string | null };
        const record = folderState.find((item) => item.id === folderId);
        if (record === undefined) return Promise.resolve(apiError("NOT_FOUND", "missing", 404));
        record.parentId = body.parentId ?? null;
        return Promise.resolve(jsonResponse({ folder: record }));
      }
      if (url.pathname.endsWith(`/folders/${folder.id}/delete-check`) && method === "POST") {
        return Promise.resolve(
          jsonResponse({
            folder,
            documentCount: options.folderDeleteDocumentCount ?? 0,
            descendantFolderCount: options.folderDeleteDescendantCount ?? 0,
            canDelete: (options.folderDeleteDocumentCount ?? 0) === 0,
          }),
        );
      }
      if (url.pathname.endsWith(`/folders/${folder.id}`) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.pathname.endsWith(`/workspaces/${workspaceId}/folders`) && method === "GET") {
        return Promise.resolve(
          options.failure
            ? apiError("PERMISSION_DENIED", "denied", 403)
            : options.requestFailure
              ? apiError("INTERNAL_ERROR", "failed", 500)
              : jsonResponse({ folders: folderState }),
        );
      }
      if (url.pathname.endsWith(`/workspaces/${workspaceId}/documents`)) {
        return Promise.resolve(
          options.failure
            ? apiError("PERMISSION_DENIED", "denied", 403)
            : options.requestFailure
              ? apiError("INTERNAL_ERROR", "failed", 500)
              : jsonResponse({
                  documents: options.documents ?? [documentRecord],
                  nextCursor: null,
                }),
        );
      }
      if (url.pathname === "/api/v1/notifications") {
        return Promise.resolve(
          jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }),
        );
      }
      if (url.pathname.endsWith(`/documents/${documentId}/export`)) {
        return Promise.resolve(new Response(new Blob(["xmind"]), { status: 200 }));
      }
      if (url.pathname.endsWith(`/documents/${documentId}`) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.pathname === "/api/v1/admin/edit-requests") {
        return Promise.resolve(jsonResponse({ requests: [], nextCursor: null }));
      }
      if (url.pathname === "/api/v1/admin/audit-logs") {
        return Promise.resolve(jsonResponse({ logs: [], nextCursor: null }));
      }
      if (url.pathname === "/api/v1/admin/storage") {
        return Promise.resolve(
          jsonResponse({
            workspaceId,
            folderCount: 1,
            documentCount: 1,
            knownObjectBytes: 800,
            quotaBytes: 1000,
            usagePercent: 80,
            threshold: options.storageThreshold ?? "normal",
            reconciliationStatus: "pending",
          }),
        );
      }
      if (url.pathname === "/api/v1/admin/import-failures") {
        return Promise.resolve(jsonResponse({ failures: [], nextCursor: null }));
      }
      if (url.pathname.endsWith("/import-batches")) {
        return Promise.resolve(
          options.importFailureCode === undefined
            ? jsonResponse({}, 201)
            : apiError(options.importFailureCode, "rejected", 409),
        );
      }
      return Promise.resolve(apiError("NOT_FOUND", "not found", 404));
    }),
  );
}

async function renderWorkspace(role: "admin" | "editor" | "reader" = "editor") {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().$patch({
    state: "authenticated",
    session: sessionResponse(role),
    csrfToken: "csrf",
  });
  const router = createTestRouter();
  await router.push({ name: "workspace" });
  await router.isReady();
  return { ...render(WorkspaceHomeView, { global: { plugins: [pinia, router] } }), router };
}

describe("workspace home", () => {
  it("renders the existing workspace actions and document metadata", async () => {
    installWorkspaceApi();
    await renderWorkspace();

    expect(await screen.findByRole("heading", { name: "用例库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建文档" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入 XMind" })).toBeInTheDocument();
    expect(await screen.findByText("ViewHistory客户端测试用例")).toBeInTheDocument();
    const compatibilityTag = screen.getByText("兼容性：部分兼容").closest(".compatibility-status");
    expect(compatibilityTag).not.toBeNull();
    if (compatibilityTag === null) throw new Error("Compatibility tag was not rendered.");
    expect(compatibilityTag).toHaveAttribute(
      "title",
      "部分内容已标准化或无法在线完整编辑，导出时可能存在差异。",
    );
    expect(screen.getByRole("button", { name: "在一级文件夹中新建" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "用例库" })).toHaveClass("library-sidebar");
    expect(screen.getByRole("region", { name: "文档" })).toHaveClass("library-content");
    expect(screen.getByRole("table")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /ViewHistory客户端测试用例/u });
    expect(within(row).getByRole("cell", { name: "未归档" })).toBeInTheDocument();
    expect(within(row).getByRole("cell", { name: "v28" })).toBeInTheDocument();
    expect(within(row).getByRole("cell", { name: "127" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "ViewHistory客户端测试用例" })).toHaveClass(
      "doc-table__link",
    );
    expect(screen.getByRole("button", { name: "导出 XMind" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /编辑 ViewHistory客户端测试用例/iu }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "更多操作 ViewHistory客户端测试用例" }),
    ).toBeInTheDocument();
  });

  it("filters the table by folder and restores it from the breadcrumb", async () => {
    const folderDocument = {
      ...documentRecord,
      id: "00000000-0000-7000-8000-000000000011",
      folderId: folder.id,
      name: "客户端登录用例",
    };
    installWorkspaceApi({ documents: [documentRecord, folderDocument] });
    await renderWorkspace();

    await userEvent.click(await screen.findByRole("button", { name: /^测试文件夹/u }));

    expect(screen.getByRole("heading", { level: 1, name: "测试文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /客户端登录用例/u })).toBeInTheDocument();
    expect(
      screen.queryByRole("row", { name: /ViewHistory客户端测试用例/u }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "用例库" }));

    expect(screen.getByRole("heading", { level: 1, name: "全部文件" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /ViewHistory客户端测试用例/u })).toBeInTheDocument();
  });

  it("filters folders and documents with the two search boxes", async () => {
    installWorkspaceApi();
    await renderWorkspace();

    await userEvent.type(await screen.findByLabelText("搜索文件夹"), "不存在");
    expect(screen.getByText("没有匹配的文件夹")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("搜索文件夹"));
    await userEvent.type(screen.getByLabelText("搜索文档"), "不匹配");
    expect(screen.getByText("没有匹配的文档。")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("搜索文档"));
    expect(screen.getByRole("row", { name: /ViewHistory客户端测试用例/u })).toBeInTheDocument();
  });

  it("renders nested folders, expands them and filters documents by subtree", async () => {
    const sibling = {
      id: "00000000-0000-7000-8000-000000000021",
      workspaceId,
      parentId: null,
      name: "另一个文件夹",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    };
    const child = {
      id: "00000000-0000-7000-8000-000000000022",
      workspaceId,
      parentId: folder.id,
      name: "子目录",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    };
    const grandchild = {
      id: "00000000-0000-7000-8000-000000000023",
      workspaceId,
      parentId: child.id,
      name: "深层目录",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    };
    const childDocument = {
      ...documentRecord,
      id: "00000000-0000-7000-8000-000000000011",
      folderId: child.id,
      name: "子目录用例",
    };
    const grandchildDocument = {
      ...documentRecord,
      id: "00000000-0000-7000-8000-000000000012",
      folderId: grandchild.id,
      name: "深层用例",
    };
    installWorkspaceApi({
      folders: [{ ...folder, parentId: null }, sibling, child, grandchild],
      documents: [documentRecord, childDocument, grandchildDocument],
    });
    await renderWorkspace();

    expect(await screen.findByRole("button", { name: /^测试文件夹/u })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^子目录/u })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开 测试文件夹" }));

    expect(screen.getByRole("button", { name: /^子目录/u })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^子目录/u }).closest(".library-tree__row"),
    ).toHaveStyle({ paddingLeft: "18px" });
    await userEvent.click(screen.getByRole("button", { name: "展开 子目录" }));
    expect(screen.getByRole("button", { name: /^深层目录/u })).toBeInTheDocument();

    const rootRow = screen
      .getByRole("button", { name: /^测试文件夹/u })
      .closest(".library-tree__row");
    expect(within(rootRow as HTMLElement).getByTitle("已加载 2 篇")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^测试文件夹/u }));

    expect(screen.getByRole("heading", { level: 1, name: "测试文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /子目录用例/u })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /深层用例/u })).toBeInTheDocument();
    expect(
      screen.queryByRole("row", { name: /ViewHistory客户端测试用例/u }),
    ).not.toBeInTheDocument();
  });

  it("moves a folder into another folder when dropped on the middle of its row", async () => {
    const target = {
      id: "00000000-0000-7000-8000-000000000024",
      workspaceId,
      parentId: null,
      name: "目标文件夹",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    };
    installWorkspaceApi({ folders: [{ ...folder, parentId: null }, target] });
    await renderWorkspace();

    const sourceItem = await screen.findByRole("button", { name: /^测试文件夹/u });
    const targetItem = screen.getByRole("button", { name: /^目标文件夹/u });
    const sourceRow = sourceItem.closest("li");
    const targetRow = targetItem.closest("li");
    if (sourceRow === null || targetRow === null) throw new Error("文件夹行没有渲染。");

    sourceRow.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    Object.defineProperty(targetRow, "getBoundingClientRect", {
      value: () => ({ top: 0, height: 100, left: 0, right: 100, bottom: 100, width: 100 }),
    });
    const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, "clientY", { value: 50 });
    targetRow.dispatchEvent(dragOver);

    await waitFor(() => {
      expect(targetRow.querySelector(".library-tree__row")).toHaveClass(
        "library-tree__row--drop-inside",
      );
    });

    await fireEvent.drop(targetRow);

    await waitFor(async () => {
      const bodies = (await requestBodies("PATCH", `/folders/${folder.id}/parent`)) as Array<{
        parentId: string | null;
      }>;
      expect(bodies).toEqual([{ parentId: target.id }]);
    });
  });

  it("switches between the table and the card grid", async () => {
    installWorkspaceApi();
    await renderWorkspace();

    expect(await screen.findByRole("table")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "网格视图" }));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-document-card")).not.toBeNull();
    expect(screen.getByText(/版本 28 · 127 个节点 · 未归档/u)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("keeps document actions independent from document navigation", async () => {
    installWorkspaceApi();
    const { router } = await renderWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "导出 XMind" }));

    expect(router.currentRoute.value.name).toBe("workspace");
  });

  it("opens a document from its title without hijacking card actions", async () => {
    installWorkspaceApi();
    const { router } = await renderWorkspace();

    await userEvent.click(await screen.findByRole("link", { name: /ViewHistory客户端测试用例/iu }));

    expect(router.currentRoute.value.name).toBe("document");
    expect(router.currentRoute.value.params.documentId).toBe(documentId);
  });

  it("hides workspace write actions from readers", async () => {
    installWorkspaceApi();
    await renderWorkspace("reader");

    expect(await screen.findByText("ViewHistory客户端测试用例")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建文件夹" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建文档" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入 XMind" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑元数据" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "更多操作 ViewHistory客户端测试用例" }),
    ).not.toBeInTheDocument();
  });

  it("confirms and permanently deletes a document from its more-actions menu", async () => {
    installWorkspaceApi();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(
      await screen.findByRole("button", { name: "更多操作 ViewHistory客户端测试用例" }),
    );
    await user.click(await screen.findByRole("button", { name: "删除文档" }));

    expect(confirm).toHaveBeenCalledWith(
      "删除后不可恢复，确定删除「ViewHistory客户端测试用例」吗？",
    );
    await waitFor(() => {
      expect(screen.queryByText("ViewHistory客户端测试用例")).not.toBeInTheDocument();
    });
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.some(
          ([request]) =>
            request instanceof Request &&
            request.method === "DELETE" &&
            request.url.endsWith(`/workspaces/${workspaceId}/documents/${documentId}`),
        ),
    ).toBe(true);
  });

  it("opens folder actions from a single more menu", async () => {
    installWorkspaceApi();
    await renderWorkspace();

    const more = await screen.findByRole("button", { name: "更多操作 测试文件夹" });
    expect(screen.queryByRole("button", { name: "新建子文件夹" })).not.toBeInTheDocument();

    await userEvent.click(more);

    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "新建子文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "新建子文件夹" }));

    expect(screen.queryByRole("button", { name: "新建子文件夹" })).not.toBeInTheDocument();
    expect(await screen.findByText("创建文件夹")).toBeInTheDocument();
  });

  it("checks the document count and permanently deletes a folder after confirmation", async () => {
    installWorkspaceApi({ folderDeleteDocumentCount: 2 });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "更多操作 测试文件夹" }));
    await user.click(await screen.findByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        "删除后不可恢复，将同时永久删除 2 篇文档。确定删除「测试文件夹」吗？",
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^测试文件夹/u })).not.toBeInTheDocument();
    });
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.some(
          ([request]) =>
            request instanceof Request &&
            request.method === "DELETE" &&
            request.url.endsWith(
              `/workspaces/${workspaceId}/folders/${folder.id}?expectedDocumentCount=2`,
            ),
        ),
    ).toBe(true);
  });

  it("reorders folders by dragging and blocks dragging while filtering", async () => {
    const alpha = {
      ...folder,
      id: "00000000-0000-7000-8000-000000000021",
      name: "Alpha",
    };
    const beta = {
      ...folder,
      id: "00000000-0000-7000-8000-000000000022",
      name: "Beta",
    };
    installWorkspaceApi({ folders: [alpha, beta] });
    await renderWorkspace();

    const folderNames = (): (string | null)[] =>
      Array.from(document.querySelectorAll(".library-tree__folder .library-tree__name")).map(
        (node) => node.textContent,
      );
    await screen.findByText("Alpha");
    expect(folderNames()).toEqual(["Alpha", "Beta"]);

    const alphaItem = screen.getByText("Alpha").closest("li");
    const betaItem = screen.getByText("Beta").closest("li");
    if (alphaItem === null || betaItem === null) throw new Error("Folder rows were not rendered.");
    expect(betaItem).toHaveAttribute("draggable", "true");

    await fireEvent.dragStart(betaItem);
    await fireEvent.dragOver(alphaItem);
    await fireEvent.drop(alphaItem);

    await waitFor(() => {
      expect(folderNames()).toEqual(["Beta", "Alpha"]);
    });

    const reorderRequest = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([request]) => request)
      .find(
        (request) =>
          request instanceof Request &&
          request.method === "PATCH" &&
          request.url.endsWith(`/workspaces/${workspaceId}/folders/order`),
      );
    if (!(reorderRequest instanceof Request)) throw new Error("Reorder request was not sent.");
    expect(await reorderRequest.clone().json()).toEqual({
      parentId: null,
      folderIds: [beta.id, alpha.id],
    });

    await userEvent.type(screen.getByLabelText("搜索文件夹"), "Al");
    expect(alphaItem).toHaveAttribute("draggable", "false");
  });

  it("renders loading, denied, and empty states", async () => {
    installWorkspaceApi({ pending: true });
    await renderWorkspace();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载工作台");
    cleanup();

    installWorkspaceApi({ failure: true });
    await renderWorkspace();
    expect(await screen.findByText("无权访问此工作区")).toBeInTheDocument();
    cleanup();

    installWorkspaceApi({ folders: [], documents: [] });
    await renderWorkspace();
    expect(await screen.findByText("还没有文档")).toBeInTheDocument();
  });

  it("keeps request failure feedback visible", async () => {
    installWorkspaceApi({ requestFailure: true });
    await renderWorkspace();

    expect(await screen.findByText("操作未完成，请稍后重试。")).toBeInTheDocument();
  });

  it("keeps the folder empty state and editor actions visible", async () => {
    installWorkspaceApi({ folders: [] });
    await renderWorkspace();

    expect(await screen.findByText("暂无文件夹")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建文件夹" })).toHaveLength(2);
  });

  it("keeps quota warning visible for administrators", async () => {
    installWorkspaceApi({ storageThreshold: "warning" });
    await renderWorkspace("admin");

    expect(await screen.findByText("存储配额已使用 80% 以上。")).toBeInTheDocument();
  });

  it("opens the notification dialog", async () => {
    installWorkspaceApi();
    await renderWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "通知" }));

    expect(await screen.findByTestId("notification-dialog")).toBeInTheDocument();
  });

  it("opens the existing XMind import dialog", async () => {
    installWorkspaceApi();
    await renderWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "导入 XMind" }));

    await waitFor(() => {
      expect(screen.getByTestId("xmind-import-dialog")).toBeInTheDocument();
    });
  });

  async function openImportDialog(
    options: Parameters<typeof installWorkspaceApi>[0] = {},
  ): Promise<HTMLInputElement> {
    installWorkspaceApi(options);
    await renderWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "导入 XMind" }));
    const input = await screen.findByLabelText(/可多选/u);
    if (!(input instanceof HTMLInputElement)) throw new Error("文件输入框没有渲染。");
    return input;
  }

  /** @testing-library/vue 的 fireEvent 是异步的,必须 await 才能等到 Vue 重渲染。 */
  async function pickFiles(input: HTMLInputElement, files: File[]): Promise<void> {
    await fireEvent.change(input, { target: { files } });
  }

  /** jsdom 里没有 DragEvent / DataTransfer,只能自己造事件再挂上 dataTransfer。 */
  async function dropOnImportDialog(dataTransfer: unknown): Promise<void> {
    const zone = screen.getByTestId("xmind-import-dialog");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    zone.dispatchEvent(event);
    // 展开目录是异步的,多等两个宏任务让 Vue 把结果渲染出来。
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function fakeFileEntry(file: File): FileSystemEntry {
    return {
      isFile: true,
      isDirectory: false,
      name: file.name,
      file: (success: (file: File) => void): void => {
        success(file);
      },
    } as unknown as FileSystemEntry;
  }

  function fakeDirectoryEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
    let drained = false;
    return {
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => ({
        readEntries: (success: (entries: FileSystemEntry[]) => void): void => {
          success(drained ? [] : children);
          drained = true;
        },
      }),
    } as unknown as FileSystemEntry;
  }

  function entryItem(entry: FileSystemEntry): {
    kind: string;
    webkitGetAsEntry: () => FileSystemEntry;
    getAsFile: () => null;
  } {
    return { kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => null };
  }

  function importRows(): HTMLElement[] {
    return [
      ...screen
        .getByTestId("xmind-import-dialog")
        .querySelectorAll<HTMLElement>(".import-list__row"),
    ];
  }

  /** 第 index 行当前的目标文档名。 */
  function rowName(index: number): string {
    return importRows()[index]?.querySelector("input")?.value ?? "";
  }

  function importBatchRequestCount(): number {
    return vi.mocked(fetch).mock.calls.filter(([target]) => {
      const url =
        typeof target === "string" ? target : target instanceof URL ? target.href : target.url;
      return url.includes("/import-batches");
    }).length;
  }

  function submitButton(): HTMLElement {
    return screen.getByRole("button", { name: "开始导入" });
  }

  /** 找到指定方法 + 路径后缀的请求体;生成器可能用 Request,也可能用 url + init。 */
  async function requestBodies(method: string, pathSuffix: string): Promise<unknown[]> {
    const bodies: unknown[] = [];
    for (const [target, init] of vi.mocked(fetch).mock.calls) {
      const request = target instanceof Request ? target : null;
      let rawUrl: string;
      if (target instanceof Request) rawUrl = target.url;
      else if (target instanceof URL) rawUrl = target.href;
      else rawUrl = target;
      const requestMethod = request?.method ?? init?.method ?? "GET";
      if (requestMethod !== method) continue;
      if (!new URL(rawUrl, location.origin).pathname.endsWith(pathSuffix)) continue;
      if (request !== null) bodies.push(await request.clone().json());
      else bodies.push(parseRequestBody(init?.body));
    }
    return bodies;
  }

  it("reopening the import dialog drops the previous file selection", async () => {
    const input = await openImportDialog();
    await pickFiles(input, [new File(["x"], "old.xmind")]);
    expect(screen.getByText("old.xmind")).toBeInTheDocument();

    // jsdom 不允许给 file input 赋非空 value,只能伪造关闭前残留的显示值:
    // ElDialog 默认不销毁内容,控件里会一直挂着上次选的文件名。
    Object.defineProperty(input, "value", {
      value: "C:\\fakepath\\old.xmind",
      writable: true,
      configurable: true,
    });

    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "导入 XMind" }));

    expect(input.value).toBe("");
    expect(screen.queryByText("old.xmind")).not.toBeInTheDocument();
    expect(screen.getByText("请选择至少一个 .xmind 文件。")).toBeInTheDocument();
  });

  it("blocks a file that is not .xmind and never calls the API", async () => {
    const input = await openImportDialog();
    await pickFiles(input, [new File(["x"], "notes.txt")]);

    expect(screen.getByText("不是 .xmind 文件，不能导入。")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await userEvent.click(submitButton());
    expect(importBatchRequestCount()).toBe(0);
  });

  it("blocks a file larger than 20 MiB", async () => {
    const input = await openImportDialog();
    const oversized = new File(["x"], "big.xmind");
    Object.defineProperty(oversized, "size", { value: 20 * 1024 * 1024 + 1 });
    await pickFiles(input, [oversized]);

    expect(screen.getByText("超过 20 MB 上限。")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("accepts a hundred files in one batch but blocks a hundred and one", async () => {
    const input = await openImportDialog();
    await pickFiles(
      input,
      Array.from({ length: 100 }, (_, index) => new File(["x"], `case-${String(index)}.xmind`)),
    );

    expect(importRows()).toHaveLength(100);
    expect(submitButton()).toBeEnabled();

    await pickFiles(input, [new File(["x"], "one-too-many.xmind")]);

    expect(screen.getByText(/单次最多提交 100 个文件，当前选了 101 个/u)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("drops a whole folder onto the dialog and expands every .xmind inside", async () => {
    await openImportDialog();
    await dropOnImportDialog({
      items: [
        entryItem(
          fakeDirectoryEntry("用例集", [
            fakeFileEntry(new File(["x"], "b.xmind")),
            fakeFileEntry(new File(["x"], "notes.txt")),
            fakeDirectoryEntry("sub", [fakeFileEntry(new File(["x"], "c.xmind"))]),
          ]),
        ),
      ],
      files: [],
    });

    // 目录 API 返回的顺序是乱的,展开后会按路径重排。
    expect(importRows()).toHaveLength(2);
    expect(rowName(0)).toBe("b");
    expect(rowName(1)).toBe("c");
    expect(screen.getByText(/已加入 2 个文件/u)).toBeInTheDocument();
    expect(screen.getByText(/忽略 1 个非 \.xmind 文件/u)).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("disambiguates same-named files from different folders with a path suffix", async () => {
    await openImportDialog();
    await dropOnImportDialog({
      items: [
        entryItem(
          fakeDirectoryEntry("用例集", [
            fakeDirectoryEntry("子目录A", [fakeFileEntry(new File(["x"], "登录用例.xmind"))]),
            fakeDirectoryEntry("子目录B", [fakeFileEntry(new File(["x"], "登录用例.xmind"))]),
          ]),
        ),
      ],
      files: [],
    });

    expect(rowName(0)).toBe("子目录A/登录用例");
    expect(rowName(1)).toBe("子目录B/登录用例");
    expect(submitButton()).toBeEnabled();
  });

  it("highlights the drop zone while dragging and resets when the drag leaves", async () => {
    await openImportDialog();
    const zone = screen.getByTestId("xmind-import-dialog");

    await fireEvent.dragEnter(zone);
    expect(zone).toHaveClass("import-drop-zone--over");

    await fireEvent.dragEnter(zone);
    await fireEvent.dragLeave(zone);
    // 只离开一层还应该保持高亮(dragenter/dragleave 会在子元素间来回冒泡)。
    expect(zone).toHaveClass("import-drop-zone--over");

    await fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass("import-drop-zone--over");
  });

  it("expands a whole folder picked through the directory input", async () => {
    const filePicker = await openImportDialog();
    expect(filePicker).toBeInTheDocument();
    const folderInput = screen.getByLabelText(/选择文件夹/u);
    if (!(folderInput instanceof HTMLInputElement)) throw new Error("目录输入框没有渲染。");

    const nested = new File(["x"], "a.xmind");
    Object.defineProperty(nested, "webkitRelativePath", { value: "用例集/sub/a.xmind" });
    const sketch = new File(["x"], "sketch.txt");
    Object.defineProperty(sketch, "webkitRelativePath", { value: "用例集/sketch.txt" });
    Object.defineProperty(folderInput, "files", {
      value: [nested, sketch],
      writable: true,
      configurable: true,
    });

    await fireEvent.change(folderInput);

    expect(importRows()).toHaveLength(1);
    expect(screen.getByText("用例集/sub/a.xmind")).toBeInTheDocument();
    expect(rowName(0)).toBe("a");
  });

  it("clears both native file inputs when the dialog is reopened", async () => {
    const filePicker = await openImportDialog();
    await pickFiles(filePicker, [new File(["x"], "old.xmind")]);
    const folderInput = screen.getByLabelText(/选择文件夹/u);
    if (!(folderInput instanceof HTMLInputElement)) throw new Error("目录输入框没有渲染。");

    // jsdom 不允许给 file input 赋非空 value,只能伪造关闭前残留的显示值。
    for (const input of [filePicker, folderInput]) {
      Object.defineProperty(input, "value", {
        value: "C:\\fakepath\\old.xmind",
        writable: true,
        configurable: true,
      });
    }

    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "导入 XMind" }));

    expect(filePicker.value).toBe("");
    expect(folderInput.value).toBe("");
    expect(screen.queryByText("old.xmind")).not.toBeInTheDocument();
  });

  it("blocks two rows targeting the same document name", async () => {
    const input = await openImportDialog();
    await pickFiles(input, [new File(["x"], "a.xmind"), new File(["x"], "A.xmind")]);

    expect(screen.getByText("与前面某一行的目标文档名重复。")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("appends a second selection instead of replacing it", async () => {
    const input = await openImportDialog();
    // 复用同一个 File 实例,保证「再选一次」的 lastModified 完全相同,能被去重掉。
    const repeated = new File(["x"], "a.xmind");
    await pickFiles(input, [repeated]);
    await pickFiles(input, [new File(["x"], "b.xmind"), repeated]);

    expect(screen.getByText("a.xmind")).toBeInTheDocument();
    expect(screen.getByText("b.xmind")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^移除 /u })).toHaveLength(2);
    expect(submitButton()).toBeEnabled();
  });

  it("drops a row from the removal button", async () => {
    const input = await openImportDialog();
    await pickFiles(input, [new File(["x"], "a.xmind"), new File(["x"], "b.xmind")]);

    await userEvent.click(screen.getByRole("button", { name: "移除 a.xmind" }));

    expect(screen.queryByText("a.xmind")).not.toBeInTheDocument();
    expect(screen.getByText("b.xmind")).toBeInTheDocument();
  });

  it("shows an import failure inside the dialog and keeps it open", async () => {
    const input = await openImportDialog({ importFailureCode: "IMPORT_QUEUE_LIMIT_REACHED" });
    await pickFiles(input, [new File(["x"], "用例.xmind")]);

    await userEvent.click(submitButton());

    const dialog = screen.getByTestId("xmind-import-dialog");
    expect(await within(dialog).findByText(/导入队列已满/u)).toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
    expect(within(dialog).getByText("用例.xmind")).toBeInTheDocument();
  });

  it("reuses an existing folder path and creates only the missing levels on import", async () => {
    const existingRoot = {
      id: "00000000-0000-7000-8000-000000000030",
      workspaceId,
      parentId: null,
      name: "用例集",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    };
    await openImportDialog({
      folders: [existingRoot],
      importFailureCode: "IMPORT_QUEUE_LIMIT_REACHED",
    });
    const folderInput = screen.getByLabelText(/选择文件夹/u);
    if (!(folderInput instanceof HTMLInputElement)) throw new Error("目录输入框没有渲染。");
    const nested = new File(["x"], "a.xmind");
    Object.defineProperty(nested, "webkitRelativePath", { value: "用例集/子目录/a.xmind" });
    const topLevel = new File(["x"], "b.xmind");
    Object.defineProperty(topLevel, "webkitRelativePath", { value: "用例集/b.xmind" });
    Object.defineProperty(folderInput, "files", {
      value: [nested, topLevel],
      writable: true,
      configurable: true,
    });
    await fireEvent.change(folderInput);

    const rowSelect = (path: string): HTMLSelectElement => {
      const row = importRows().find((element) =>
        element.querySelector(".import-list__file")?.textContent.includes(path),
      );
      const select = row?.querySelector<HTMLSelectElement>('select[aria-label="目标文件夹"]');
      if (select === null || select === undefined) throw new Error(`没找到 ${path} 的行。`);
      return select;
    };
    expect(rowSelect("用例集/b.xmind").value).toBe(`id:${existingRoot.id}`);
    expect(rowSelect("用例集/子目录/a.xmind").value).toBe("path:用例集/子目录");
    // 每个目标文件夹下拉都渲染同一组待创建路径。
    expect(screen.getAllByRole("option", { name: "新建：用例集/子目录" })).toHaveLength(2);

    await userEvent.click(submitButton());

    const created = (await requestBodies("POST", "/folders")) as Array<{
      name: string;
      parentId: string | null;
    }>;
    expect(created).toEqual([{ name: "子目录", parentId: existingRoot.id }]);
    const batches = (await requestBodies("POST", "/import-batches")) as Array<{
      files: Array<{ clientFileName: string; targetFolderId: string | null }>;
    }>;
    expect(batches).toHaveLength(1);
    const targetByFile = Object.fromEntries(
      (batches[0]?.files ?? []).map((entry) => [entry.clientFileName, entry.targetFolderId]),
    );
    expect(targetByFile).toEqual({
      "b.xmind": existingRoot.id,
      "a.xmind": "00000000-0000-7000-8000-000000000040",
    });
  });

  it("reuses a folder created concurrently instead of failing the whole import", async () => {
    await openImportDialog({
      folders: [],
      folderConflictOnce: "用例集",
      importFailureCode: "IMPORT_QUEUE_LIMIT_REACHED",
    });
    const folderInput = screen.getByLabelText(/选择文件夹/u);
    if (!(folderInput instanceof HTMLInputElement)) throw new Error("目录输入框没有渲染。");
    const file = new File(["x"], "a.xmind");
    Object.defineProperty(file, "webkitRelativePath", { value: "用例集/a.xmind" });
    Object.defineProperty(folderInput, "files", {
      value: [file],
      writable: true,
      configurable: true,
    });
    await fireEvent.change(folderInput);

    await userEvent.click(submitButton());

    const batches = (await requestBodies("POST", "/import-batches")) as Array<{
      files: Array<{ targetFolderId: string | null }>;
    }>;
    expect(batches).toHaveLength(1);
    expect(batches[0]?.files[0]?.targetFolderId).toBe("00000000-0000-7000-8000-000000000040");
    expect(screen.queryByText(/无法自动创建/u)).not.toBeInTheDocument();
  });

  it("falls back to unassigned when a directory name cannot become a folder", async () => {
    await openImportDialog({ importFailureCode: "IMPORT_QUEUE_LIMIT_REACHED" });
    const folderInput = screen.getByLabelText(/选择文件夹/u);
    if (!(folderInput instanceof HTMLInputElement)) throw new Error("目录输入框没有渲染。");
    const file = new File(["x"], "a.xmind");
    Object.defineProperty(file, "webkitRelativePath", {
      value: `${"目录".repeat(30)}/a.xmind`,
    });
    Object.defineProperty(folderInput, "files", {
      value: [file],
      writable: true,
      configurable: true,
    });
    await fireEvent.change(folderInput);

    await userEvent.click(submitButton());

    expect(screen.getByText(/有 1 个目录无法自动创建，相关文件改为未归档。/u)).toBeInTheDocument();
    expect(await requestBodies("POST", "/folders")).toEqual([]);
    const batches = (await requestBodies("POST", "/import-batches")) as Array<{
      files: Array<{ targetFolderId: string | null }>;
    }>;
    expect(batches[0]?.files[0]?.targetFolderId).toBeNull();
  });
});
