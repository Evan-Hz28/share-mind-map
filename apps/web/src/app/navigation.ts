import { FolderOpened, House, Lock, UserFilled } from "@element-plus/icons-vue";
import type { SessionResponseDto } from "@share-mind-map/api-client";
import type { Component } from "vue";

export type AppRole = SessionResponseDto["role"];

export interface NavigationItem {
  /** 菜单文案，同时用作标签页标题的兜底值。 */
  title: string;
  /** 必须与 vue-router 的 route name 一致，点击菜单直接 `router.push({ name })`。 */
  name: string;
  icon: Component;
  /** 省略表示所有角色可见。 */
  roles?: readonly AppRole[];
}

export const navigationItems: readonly NavigationItem[] = [
  { title: "首页", name: "home", icon: House },
  { title: "用例库", name: "workspace", icon: FolderOpened },
  { title: "成员管理", name: "members", icon: UserFilled, roles: ["admin"] },
  { title: "权限与审计", name: "phase2-admin", icon: Lock, roles: ["admin"] },
];

export function filterNavigationByRole(
  items: readonly NavigationItem[],
  role: AppRole | null,
): NavigationItem[] {
  return items.filter(
    (item) => item.roles === undefined || (role !== null && item.roles.includes(role)),
  );
}
