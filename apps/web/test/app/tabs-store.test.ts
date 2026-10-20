import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it } from "vitest";

import { HOME_ROUTE_NAME, useAppTabsStore } from "../../src/app/tabs.store.js";
import { createAppRouter } from "../../src/router.js";

const STORAGE_KEY = "share-mind-map.app.tabs";

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createAppRouter({ pinia, history: createMemoryHistory() });
  return { router, tabs: useAppTabsStore(pinia) };
}

function names(tabs: { tabs: { name: string }[] }): string[] {
  return tabs.tabs.map((tab) => tab.name);
}

beforeEach(() => {
  localStorage.clear();
});

describe("app tabs store", () => {
  it("seeds the pinned home tab with the route title", () => {
    const { router, tabs } = setup();

    tabs.load(router);

    expect(names(tabs)).toEqual([HOME_ROUTE_NAME]);
    expect(tabs.tabs.map((tab) => tab.title)).toEqual(["首页"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(["home"]);
  });

  it("appends a tab once per route and keeps the home tab first", () => {
    const { router, tabs } = setup();
    tabs.load(router);

    tabs.open(router, "members");
    tabs.open(router, "members");
    tabs.open(router, "phase2-admin");

    expect(names(tabs)).toEqual(["home", "members", "phase2-admin"]);
    expect(tabs.tabs.map((tab) => tab.title)).toEqual(["首页", "成员管理", "权限与审计"]);
  });

  it("returns the left neighbour when a tab closes and never closes home", () => {
    const { router, tabs } = setup();
    tabs.load(router);
    tabs.open(router, "members");
    tabs.open(router, "phase2-admin");

    expect(tabs.close("phase2-admin")).toBe("members");
    expect(names(tabs)).toEqual(["home", "members"]);
    expect(tabs.close(HOME_ROUTE_NAME)).toBeNull();
    expect(names(tabs)).toEqual(["home", "members"]);
    expect(tabs.close("members")).toBe("home");
  });

  it("drops admin-only tabs for readers and editors", () => {
    const { router, tabs } = setup();
    tabs.load(router);
    tabs.open(router, "members");
    tabs.open(router, "phase2-admin");

    tabs.prune("reader");
    expect(names(tabs)).toEqual(["home"]);

    tabs.open(router, "members");
    tabs.prune("editor");
    expect(names(tabs)).toEqual(["home"]);

    tabs.open(router, "members");
    tabs.prune("admin");
    expect(names(tabs)).toEqual(["home", "members"]);
  });

  it("discards persisted names that no longer resolve", () => {
    const { router, tabs } = setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["members", "gone-route"]));

    tabs.load(router);

    expect(names(tabs)).toEqual(["home", "members"]);
  });

  it("resets to the home tab on closeAll", () => {
    const { router, tabs } = setup();
    tabs.load(router);
    tabs.open(router, "members");

    tabs.closeAll(router);

    expect(names(tabs)).toEqual([HOME_ROUTE_NAME]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(["home"]);
  });
});
