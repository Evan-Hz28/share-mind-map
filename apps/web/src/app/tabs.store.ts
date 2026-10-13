import { defineStore, type Pinia } from "pinia";
import type { Router } from "vue-router";

import type { AppRole } from "./navigation.js";

/** 首页标签固定存在且不可关闭。 */
export const HOME_ROUTE_NAME = "workspace";

const STORAGE_KEY = "share-mind-map.app.tabs";

export interface AppTab {
  name: string;
  title: string;
  adminOnly: boolean;
}

interface AppTabsState {
  tabs: AppTab[];
}

function readStoredNames(): string[] {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}

function writeStoredNames(tabs: AppTab[]): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.map((tab) => tab.name)));
  } catch {
    // 持久化失败不影响本次会话内的标签行为。
  }
}

/** 从路由表解析标签；名字不存在时返回 null，避免持久化的脏数据复活。 */
function resolveTab(router: Router, name: string): AppTab | null {
  try {
    const resolved = router.resolve({ name });
    if (resolved.matched.length === 0) return null;
    return {
      name,
      title: resolved.meta.title ?? name,
      adminOnly: resolved.meta.requiresAdmin === true,
    };
  } catch {
    return null;
  }
}

const useAppTabsStoreDefinition = defineStore("app-tabs", {
  state: (): AppTabsState => ({ tabs: [] }),
  actions: {
    /** 冷启动：读回本地标签，丢掉解析不了的，保证首页标签在第一位。 */
    load(router: Router): void {
      const names = [HOME_ROUTE_NAME, ...readStoredNames()];
      const tabs: AppTab[] = [];
      for (const name of names) {
        if (tabs.some((tab) => tab.name === name)) continue;
        const tab = resolveTab(router, name);
        if (tab !== null) tabs.push(tab);
      }
      this.tabs = tabs;
      writeStoredNames(tabs);
    },
    open(router: Router, name: string): void {
      if (this.tabs.some((tab) => tab.name === name)) return;
      const tab = resolveTab(router, name);
      if (tab === null) return;
      this.tabs.push(tab);
      writeStoredNames(this.tabs);
    },
    /** 关闭标签，返回关闭后应该激活的邻居（调用方决定要不要跳转）。首页标签不可关闭。 */
    close(name: string): string | null {
      if (name === HOME_ROUTE_NAME) return null;
      const index = this.tabs.findIndex((tab) => tab.name === name);
      if (index === -1) return null;
      this.tabs.splice(index, 1);
      writeStoredNames(this.tabs);
      return this.tabs[index - 1]?.name ?? HOME_ROUTE_NAME;
    },
    closeAll(router: Router): void {
      const home = resolveTab(router, HOME_ROUTE_NAME);
      this.tabs = home === null ? [] : [home];
      writeStoredNames(this.tabs);
    },
    /** 角色变化后丢掉越权标签，避免只读成员看到点不开的后台标签。 */
    prune(role: AppRole | null): void {
      const kept = this.tabs.filter((tab) => !tab.adminOnly || role === "admin");
      if (kept.length === this.tabs.length) return;
      this.tabs = kept;
      writeStoredNames(this.tabs);
    },
  },
});

export function useAppTabsStore(pinia?: Pinia): ReturnType<typeof useAppTabsStoreDefinition> {
  return useAppTabsStoreDefinition(pinia);
}
