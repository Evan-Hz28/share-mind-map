import { render, screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppShell from "../src/app/AppShell.vue";
import { useAuthStore } from "../src/auth/auth.store.js";
import { createAppRouter } from "../src/router.js";
import { sessionResponse } from "./helpers.js";

beforeEach(() => {
  document.body.replaceChildren();
});

function setup(role: "reader" | "editor" | "admin", mustChangePassword = false) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.$patch({
    state: "authenticated",
    session: sessionResponse(role, mustChangePassword),
    csrfToken: "csrf",
  });
  const router = createAppRouter({ pinia, history: createMemoryHistory() });
  return { auth, pinia, router };
}

describe("application routing and shell", () => {
  it("redirects forced-change sessions away from workspace and administration", async () => {
    const { router } = setup("admin", true);

    await router.push("/admin/members");

    expect(router.currentRoute.value.path).toBe("/change-password");
  });

  it("redirects anonymous users to login and non-Admins to workspace", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const auth = useAuthStore();
    auth.$patch({ state: "anonymous", session: null, csrfToken: null });
    const anonymousRouter = createAppRouter({ pinia, history: createMemoryHistory() });
    await anonymousRouter.push("/workspace");
    expect(anonymousRouter.currentRoute.value.path).toBe("/login");

    auth.$patch({ state: "authenticated", session: sessionResponse("reader"), csrfToken: "csrf" });
    await anonymousRouter.push("/admin/members");
    expect(anonymousRouter.currentRoute.value.path).toBe("/workspace");
  });

  it("registers an authenticated document detail route", async () => {
    const { router } = setup("reader");
    await router.push("/workspace/documents/00000000-0000-7000-8000-000000000101");

    expect(router.currentRoute.value.name).toBe("document");
    expect(router.currentRoute.value.params.documentId).toBe(
      "00000000-0000-7000-8000-000000000101",
    );
  });

  it("marks the document route as the fullscreen editor shell", async () => {
    const { pinia, router } = setup("reader");
    await router.push("/workspace/documents/00000000-0000-7000-8000-000000000101");

    render(AppShell, {
      global: { plugins: [pinia, router], stubs: { RouterView: true } },
    });

    expect(document.querySelector(".app-shell")).toHaveClass("app-shell--editor");
  });

  it.each(["reader", "editor"] as const)(
    "does not render Admin navigation for %s",
    async (role) => {
      const { pinia, router } = setup(role);
      await router.push("/workspace");

      render(AppShell, {
        global: { plugins: [pinia, router], stubs: { RouterView: true } },
      });

      expect(screen.queryByRole("link", { name: "成员管理" })).not.toBeInTheDocument();
      expect(screen.getByText("产品工作区")).toBeInTheDocument();
      expect(screen.getByRole("banner", { name: "应用顶部导航" })).toBeInTheDocument();
    },
  );

  it("renders the branded admin shell and keeps workspace navigation active", async () => {
    const { pinia, router } = setup("admin");
    await router.push("/workspace");
    render(AppShell, {
      global: { plugins: [pinia, router], stubs: { RouterView: true } },
    });

    expect(screen.getByLabelText("Kitar TestHub")).toBeInTheDocument();
    expect(screen.getByText("产品工作区")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用例库" })).toHaveClass("router-link-active");
    expect(screen.getByRole("link", { name: "成员管理" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "权限与审计" })).toBeInTheDocument();
    expect(screen.getByText("管理员")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "账户菜单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开导航菜单" })).toBeInTheDocument();
  });

  it("renders the sidebar and tab bar outside the editor, and hides both inside it", async () => {
    const { pinia, router } = setup("admin");
    await router.push("/workspace");
    render(AppShell, {
      global: { plugins: [pinia, router], stubs: { RouterView: true } },
    });

    expect(screen.getByRole("complementary", { name: "侧边导航" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "页面标签" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭 用例库" })).not.toBeInTheDocument();

    await router.push("/workspace/documents/00000000-0000-7000-8000-000000000101");
    await nextTick();

    expect(screen.queryByRole("complementary", { name: "侧边导航" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "页面标签" })).not.toBeInTheDocument();
    // 编辑器仍然要能退出登录。
    expect(screen.getByRole("button", { name: "账户菜单" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kitar TestHub")).toBeInTheDocument();
  });

  it("opens a closable tab for each visited page", async () => {
    const { pinia, router } = setup("admin");
    await router.push("/workspace");
    render(AppShell, {
      global: { plugins: [pinia, router], stubs: { RouterView: true } },
    });

    await router.push("/admin/members");
    await nextTick();

    // 首页标签固定，不可关闭；新页面各带一个关闭按钮。
    expect(screen.queryByRole("button", { name: "关闭 用例库" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭 成员管理" }));

    expect(router.currentRoute.value.name).toBe("workspace");
    expect(screen.queryByRole("button", { name: "关闭 成员管理" })).not.toBeInTheDocument();
  });

  it("logs out through the account menu and returns to login", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 204 })));
    const { pinia, router } = setup("admin");
    await router.push("/workspace");
    render(AppShell, {
      global: { plugins: [pinia, router], stubs: { RouterView: true } },
    });

    await userEvent.click(screen.getByRole("button", { name: "账户菜单" }));
    await userEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(router.currentRoute.value.path).toBe("/login");
  });
});
