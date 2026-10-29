import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppTabs from "../src/app/AppTabs.vue";
import { useAppTabsStore } from "../src/app/tabs.store.js";

const Stub = { template: "<div />" };

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/home", name: "home", component: Stub, meta: { title: "首页" } },
      { path: "/api-tests", name: "api-tests", component: Stub, meta: { title: "接口测试" } },
      {
        path: "/api-tests/runs/:runId",
        name: "api-test-run",
        component: Stub,
        meta: { title: "测试报告" },
      },
    ],
  });
}

async function renderTabs(router: Router) {
  const pinia = createPinia();
  setActivePinia(pinia);
  await router.push("/home");
  render(AppTabs, { global: { plugins: [pinia, router] } });
  await nextTick();
  return useAppTabsStore();
}

beforeEach(() => {
  localStorage.clear();
});

describe("application tabs", () => {
  it("keeps one tab per run and switches back by path", async () => {
    const router = createTestRouter();
    await renderTabs(router);

    await router.push("/api-tests/runs/run-a");
    await nextTick();
    await router.push("/api-tests/runs/run-b");
    await nextTick();

    const runTabs = screen.getAllByRole("button", { name: "测试报告" });
    expect(runTabs).toHaveLength(2);

    const firstRunTab = runTabs[0];
    const secondRunTab = runTabs[1];
    if (firstRunTab === undefined || secondRunTab === undefined) {
      throw new Error("缺少测试报告标签");
    }
    // 高亮必须跟着当前路径走，而不是两个报告同为 api-test-run 就一起亮
    expect(secondRunTab.closest(".app-tab")).toHaveClass("app-tab--active");
    expect(firstRunTab.closest(".app-tab")).not.toHaveClass("app-tab--active");

    await fireEvent.click(firstRunTab);
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe("/api-tests/runs/run-a");
    });
    expect(firstRunTab.closest(".app-tab")).toHaveClass("app-tab--active");
    expect(secondRunTab.closest(".app-tab")).not.toHaveClass("app-tab--active");
  });

  it("renames a run tab once the report loads", async () => {
    const router = createTestRouter();
    const tabs = await renderTabs(router);

    await router.push("/api-tests/runs/run-a");
    await nextTick();
    tabs.rename("/api-tests/runs/run-a", "测试报告 · 认证");

    expect(await screen.findByRole("button", { name: "测试报告 · 认证" })).toBeTruthy();
  });

  it("restores persisted tabs including their run ids", async () => {
    const router = createTestRouter();
    const tabs = await renderTabs(router);
    await router.push("/api-tests/runs/run-a");
    await nextTick();
    expect(tabs.tabs.map((tab) => tab.path)).toEqual(["/home", "/api-tests/runs/run-a"]);

    const pinia = createPinia();
    setActivePinia(pinia);
    const restored = useAppTabsStore();
    restored.load(router);

    expect(restored.tabs.map((tab) => tab.path)).toEqual(["/home", "/api-tests/runs/run-a"]);
  });
});
