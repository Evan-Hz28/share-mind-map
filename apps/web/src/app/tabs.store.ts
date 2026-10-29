import { defineStore, type Pinia } from "pinia";
import type { Router } from "vue-router";

import type { AppRole } from "./navigation.js";

/** 首页标签固定存在且不可关闭。 */
export const HOME_PATH = "/home";

/** v2 起按完整路径存标签，带参数的页面（如测试报告）各自独立。 */
const STORAGE_KEY = "share-mind-map.app.tabs.v2";

export interface AppTab {
  /** 路由的完整路径，同时是标签主键。 */
  path: string;
  name: string;
  title: string;
  adminOnly: boolean;
}

interface AppTabsState {
  tabs: AppTab[];
}

function readStoredPaths(): string[] {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((path): path is string => typeof path === "string" && path.startsWith("/"));
  } catch {
    return [];
  }
}

function writeStoredPaths(tabs: AppTab[]): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.map((tab) => tab.path)));
  } catch {
    // 持久化失败不影响本次会话内的标签行为。
  }
}

/** 从路由表解析标签；路径不存在时返回 null，避免持久化的脏数据复活。 */
function resolveTab(router: Router, path: string): AppTab | null {
  try {
    const resolved = router.resolve(path);
    if (resolved.matched.length === 0) return null;
    if (typeof resolved.name !== "string") return null;
    return {
      path: resolved.path,
      name: resolved.name,
      title: resolved.meta.title ?? resolved.name,
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
      const paths = [HOME_PATH, ...readStoredPaths()];
      const tabs: AppTab[] = [];
      for (const path of paths) {
        if (tabs.some((tab) => tab.path === path)) continue;
        const tab = resolveTab(router, path);
        if (tab !== null) tabs.push(tab);
      }
      this.tabs = tabs;
      writeStoredPaths(tabs);
    },
    open(router: Router, path: string): void {
      if (this.tabs.some((tab) => tab.path === path)) return;
      const tab = resolveTab(router, path);
      if (tab === null) return;
      this.tabs.push(tab);
      writeStoredPaths(this.tabs);
    },
    /** 关闭标签，返回关闭后应该激活的邻居（调用方决定要不要跳转）。首页标签不可关闭。 */
    close(path: string): string | null {
      if (path === HOME_PATH) return null;
      const index = this.tabs.findIndex((tab) => tab.path === path);
      if (index === -1) return null;
      this.tabs.splice(index, 1);
      writeStoredPaths(this.tabs);
      return this.tabs[index - 1]?.path ?? HOME_PATH;
    },
    /** 页面数据到位后把标签名改得更具体，比如带上套件名。 */
    rename(path: string, title: string): void {
      const tab = this.tabs.find((candidate) => candidate.path === path);
      if (tab === undefined || tab.title === title) return;
      tab.title = title;
    },
    closeAll(router: Router): void {
      const home = resolveTab(router, HOME_PATH);
      this.tabs = home === null ? [] : [home];
      writeStoredPaths(this.tabs);
    },
    /** 角色变化后丢掉越权标签，避免只读成员看到点不开的后台标签。 */
    prune(role: AppRole | null): void {
      const kept = this.tabs.filter((tab) => !tab.adminOnly || role === "admin");
      if (kept.length === this.tabs.length) return;
      this.tabs = kept;
      writeStoredPaths(this.tabs);
    },
  },
});

export function useAppTabsStore(pinia?: Pinia): ReturnType<typeof useAppTabsStoreDefinition> {
  return useAppTabsStoreDefinition(pinia);
}
