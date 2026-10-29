import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppTabsStore } from "../../src/app/tabs.store.js";
import { createAppRouter } from "../../src/router.js";

const STORAGE_KEY = "share-mind-map.app.tabs.v2";

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createAppRouter({ pinia, history: createMemoryHistory() });
  return { router, tabs: useAppTabsStore(pinia) };
}

function paths(tabs: { tabs: { path: string }[] }): string[] {
  return tabs.tabs.map((tab) => tab.path);
}

beforeEach(() => {
  localStorage.clear();
});

describe("app tabs store", () => {
  it("seeds the pinned home tab with the route title", () => {
    const { router, tabs } = setup();

    tabs.load(router);

    expect(paths(tabs)).toEqual(["/home"]);
    expect(tabs.tabs.map((tab) => tab.title)).toEqual(["首页"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(["/home"]);
  });

  it("appends a tab once per route and keeps the home tab first", () => {
    const { router, tabs } = setup();
    tabs.load(router);

    tabs.open(router, "/admin/members");
    tabs.open(router, "/admin/members");
    tabs.open(router, "/admin/phase2");

    expect(paths(tabs)).toEqual(["/home", "/admin/members", "/admin/phase2"]);
    expect(tabs.tabs.map((tab) => tab.title)).toEqual(["首页", "成员管理", "权限与审计"]);
  });

  it("keeps one tab per parameterised route instead of collapsing them", () => {
    const { router, tabs } = setup();
    tabs.load(router);

    tabs.open(router, "/api-tests/runs/run-a");
    tabs.open(router, "/api-tests/runs/run-b");

    expect(paths(tabs)).toEqual(["/home", "/api-tests/runs/run-a", "/api-tests/runs/run-b"]);
    expect(tabs.tabs.map((tab) => tab.name)).toEqual(["home", "api-test-run", "api-test-run"]);
  });

  it("returns the left neighbour when a tab closes and never closes home", () => {
    const { router, tabs } = setup();
    tabs.load(router);
    tabs.open(router, "/admin/members");
    tabs.open(router, "/admin/phase2");

    expect(tabs.close("/admin/phase2")).toBe("/admin/members");
    expect(paths(tabs)).toEqual(["/home", "/admin/members"]);
    expect(tabs.close("/home")).toBeNull();
    expect(paths(tabs)).toEqual(["/home", "/admin/members"]);
    expect(tabs.close("/admin/members")).toBe("/home");
  });

  it("drops admin-only tabs for readers and editors", () => {
    const { router, tabs } = setup();
    tabs.load(router);
    tabs.open(router, "/admin/members");
    tabs.open(router, "/admin/phase2");

    tabs.prune("reader");
    expect(paths(tabs)).toEqual(["/home"]);

    tabs.open(router, "/admin/members");
    tabs.prune("editor");
    expect(paths(tabs)).toEqual(["/home"]);

    tabs.open(router, "/admin/members");
    tabs.prune("admin");
    expect(paths(tabs)).toEqual(["/home", "/admin/members"]);
  });

  it("discards persisted paths that no longer resolve", () => {
    const { router, tabs } = setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["/admin/members", "/gone-route"]));

    tabs.load(router);

    expect(paths(tabs)).toEqual(["/home", "/admin/members"]);
  });

  it("resets to the home tab on closeAll", () => {
    const { router, tabs } = setup();
    tabs.load(router);
    tabs.open(router, "/admin/members");

    tabs.closeAll(router);

    expect(paths(tabs)).toEqual(["/home"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(["/home"]);
  });
});
