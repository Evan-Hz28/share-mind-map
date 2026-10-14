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

function installWorkspaceApi(
  options: {
    folders?: unknown[];
    documents?: unknown[];
    failure?: boolean;
    requestFailure?: boolean;
    pending?: boolean;
    storageThreshold?: "normal" | "warning" | "critical" | "exceeded";
    importFailureCode?: string;
  } = {},
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(requestUrl, location.origin);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (options.pending) return new Promise<Response>(() => undefined);
      if (url.pathname.endsWith(`/workspaces/${workspaceId}/folders`)) {
        return Promise.resolve(
          options.failure
            ? apiError("PERMISSION_DENIED", "denied", 403)
            : options.requestFailure
              ? apiError("INTERNAL_ERROR", "failed", 500)
              : jsonResponse({ folders: options.folders ?? [folder] }),
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
    expect(screen.getByRole("region", { name: "工作区统计" })).toHaveClass(
      "workspace-toolbar--summary",
    );
    expect(await screen.findByText("ViewHistory客户端测试用例")).toBeInTheDocument();
    const compatibilityTag = screen.getByText("兼容性：部分兼容").closest(".compatibility-status");
    expect(compatibilityTag).not.toBeNull();
    if (compatibilityTag === null) throw new Error("Compatibility tag was not rendered.");
    expect(compatibilityTag).toHaveAttribute(
      "title",
      "部分内容已标准化或无法在线完整编辑，导出时可能存在差异。",
    );
    expect(screen.getByRole("button", { name: "在一级文件夹中新建" })).toBeInTheDocument();
    expect(screen.getByText("版本 28 · 127 个节点")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "一级文件夹" })).toHaveClass(
      "workspace-panel--folders",
    );
    expect(screen.getByRole("region", { name: "文档" })).toHaveClass("workspace-panel--documents");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[1]).toHaveClass("workspace-document-card");
    expect(screen.getByRole("link", { name: /ViewHistory客户端测试用例/iu })).toHaveClass(
      "workspace-document-card__link",
    );
    expect(screen.getByRole("button", { name: "导出 XMind" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /编辑 ViewHistory客户端测试用例/iu }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "更多操作 ViewHistory客户端测试用例" }),
    ).toBeInTheDocument();
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
});
