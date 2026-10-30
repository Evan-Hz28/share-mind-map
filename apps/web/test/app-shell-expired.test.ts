import { render } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";

import AppShell from "../src/app/AppShell.vue";
import { useAuthStore } from "../src/auth/auth.store.js";

const Stub = { template: "<div />" };

async function settle(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("app shell", () => {
  // 路由守卫只在导航时检查登录态，页面停在原地被 401 时得靠这里跳转。
  it("leaves for the session expired page when a request expires the session", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/home", name: "home", component: Stub, meta: { requiresAuth: true } },
        { path: "/session-expired", name: "session-expired", component: Stub },
      ],
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    await router.push("/home");

    const auth = useAuthStore();
    auth.state = "authenticated";

    render(AppShell, {
      global: {
        plugins: [pinia, router],
        stubs: { AppSidebar: true, AppTabs: true, AppTopBar: true, RouterView: true },
      },
    });
    await settle();
    expect(router.currentRoute.value.name).toBe("home");

    auth.handleUnauthorized();
    await settle();

    expect(auth.state).toBe("expired");
    expect(router.currentRoute.value.name).toBe("session-expired");
  });
});
