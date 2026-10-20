import { cleanup, render, screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import HomeView from "../src/app/HomeView.vue";
import { useAuthStore } from "../src/auth/auth.store.js";
import { apiError, jsonResponse, sessionResponse } from "./helpers.js";

const workspaceId = "00000000-0000-7000-8000-000000000003";
const folderId = "00000000-0000-7000-8000-000000000020";

const folder = {
  id: folderId,
  workspaceId,
  name: "登录模块",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const documentRecord = {
  id: "00000000-0000-7000-8000-000000000010",
  workspaceId,
  folderId,
  name: "登录回归用例",
  currentVersion: 7,
  schemaVersion: 1,
  compatibilityStatus: "full" as const,
  nodeCount: 128,
  imageBytes: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-19T08:30:00.000Z",
};

const notification = {
  id: "00000000-0000-7000-8000-000000000030",
  title: "编辑权限已通过",
  body: "你现在可以编辑工作区文档。",
  readAt: null,
  createdAt: "2026-10-19T09:00:00.000Z",
};

function createTestRouter() {
  const view = { template: "<div />" };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/home", name: "home", component: HomeView },
      { path: "/workspace", name: "workspace", component: view },
      { path: "/workspace/documents/:documentId", name: "document", component: view },
      { path: "/admin/members", name: "members", component: view },
      { path: "/admin/phase2", name: "phase2-admin", component: view },
    ],
  });
}

function installHomeApi(
  options: {
    role?: "reader" | "editor" | "admin";
    notifications?: unknown[];
    unreadCount?: number;
    pendingEditRequests?: number;
  } = {},
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(requestUrl, location.origin);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.pathname === `/api/v1/workspaces/${workspaceId}/overview`) {
        return Promise.resolve(
          jsonResponse({
            workspaceId,
            folderCount: 1,
            documentCount: 2,
            nodeCount: 300,
            activeImportJobs: 3,
            pendingEditRequests: options.pendingEditRequests ?? 0,
          }),
        );
      }
      if (url.pathname.endsWith(`/workspaces/${workspaceId}/folders`)) {
        return Promise.resolve(jsonResponse({ folders: [folder] }));
      }
      if (url.pathname.endsWith(`/workspaces/${workspaceId}/documents`)) {
        return Promise.resolve(jsonResponse({ documents: [documentRecord], nextCursor: null }));
      }
      if (url.pathname.startsWith("/api/v1/notifications/")) {
        return Promise.resolve(jsonResponse({ ...notification, readAt: "2026-10-20T00:00:00.000Z" }));
      }
      if (url.pathname === "/api/v1/notifications") {
        return Promise.resolve(
          jsonResponse({
            notifications: options.notifications ?? [],
            unreadCount: options.unreadCount ?? 0,
            nextCursor: null,
          }),
        );
      }
      if (url.pathname.endsWith(`/workspaces/${workspaceId}/edit-requests`) && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              request: {
                id: "00000000-0000-7000-8000-000000000040",
                workspaceId,
                requesterId: "00000000-0000-7000-8000-000000000001",
                status: "pending",
                requestedAt: "2026-10-20T00:00:00.000Z",
              },
            },
            201,
          ),
        );
      }
      return Promise.resolve(apiError("NOT_FOUND", "not found", 404));
    }),
  );
}

async function renderHome(role: "reader" | "editor" | "admin" = "editor") {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().$patch({
    state: "authenticated",
    session: sessionResponse(role),
    csrfToken: "csrf",
  });
  const router = createTestRouter();
  await router.push({ name: "home" });
  await router.isReady();
  return { ...render(HomeView, { global: { plugins: [pinia, router] } }), router };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("home dashboard", () => {
  it("renders the greeting, KPI cards and recent documents", async () => {
    installHomeApi();
    await renderHome();

    expect(await screen.findByRole("heading", { name: /Reader One/ })).toBeInTheDocument();
    expect(await screen.findByText("登录回归用例")).toBeInTheDocument();
    expect(screen.getByText("文档总数")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("节点总数")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("执行中导入")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("登录模块")).toBeInTheDocument();
    expect(screen.getByText("v7")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("系统公告")).toBeInTheDocument();
    expect(screen.getByText("首页工作台上线")).toBeInTheDocument();
  });

  it("offers only the quick entries the current role can use", async () => {
    installHomeApi();
    await renderHome("reader");

    expect(await screen.findByRole("link", { name: /用例库/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /新建文档/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /导入 XMind/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /成员管理/ })).not.toBeInTheDocument();
  });

  it("shows admin approvals and links to the administration page", async () => {
    installHomeApi({ pendingEditRequests: 2 });
    await renderHome("admin");

    expect(
      await screen.findByText("2 条编辑权限申请待审批"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /权限与审计/ })).toBeInTheDocument();
    expect(screen.getByText("待审批申请")).toBeInTheDocument();
  });

  it("lets a reader request edit access from the todo panel", async () => {
    installHomeApi();
    await renderHome("reader");

    await userEvent.click(await screen.findByRole("button", { name: "申请编辑权限" }));

    await waitFor(() => {
      expect(screen.getByText("编辑权限申请已提交")).toBeInTheDocument();
    });
  });

  it("lists unread notifications and marks them read", async () => {
    installHomeApi({ notifications: [notification], unreadCount: 1 });
    await renderHome();

    expect(await screen.findByText("编辑权限已通过")).toBeInTheDocument();
    expect(screen.getByText("1 条未读通知")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "标为已读" }));

    await waitFor(() => {
      expect(screen.queryByText("编辑权限已通过")).not.toBeInTheDocument();
    });
  });
});
