import { cleanup, render, screen, waitFor } from "@testing-library/vue";
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
      { path: "/workspace/documents/:documentId", name: "document", component: { template: "<div />" } },
    ],
  });
}

function installWorkspaceApi(options: {
  folders?: unknown[];
  documents?: unknown[];
  failure?: boolean;
  requestFailure?: boolean;
  pending?: boolean;
  storageThreshold?: "normal" | "warning" | "critical" | "exceeded";
} = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(requestUrl, location.origin);
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
              : jsonResponse({ documents: options.documents ?? [documentRecord], nextCursor: null }),
        );
      }
      if (url.pathname === "/api/v1/notifications") {
        return Promise.resolve(jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }));
      }
      if (url.pathname.endsWith(`/documents/${documentId}/export`)) {
        return Promise.resolve(new Response(new Blob(["xmind"]), { status: 200 }));
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

    expect(await screen.findByRole("heading", { name: "全部文档" })).toBeInTheDocument();
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
    expect(screen.getByRole("region", { name: "文档" })).toHaveClass(
      "workspace-panel--documents",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[1]).toHaveClass("workspace-document-card");
    expect(screen.getByRole("link", { name: /ViewHistory客户端测试用例/iu })).toHaveClass(
      "workspace-document-card__link",
    );
    expect(screen.getByRole("button", { name: "导出 XMind" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /编辑 ViewHistory客户端测试用例/iu })).toBeInTheDocument();
    expect(document.querySelector(".workspace-document-card__more")).toBeInTheDocument();
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
});
