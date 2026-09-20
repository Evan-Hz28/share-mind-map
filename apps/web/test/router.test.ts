import { render, screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
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
    },
  );

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
