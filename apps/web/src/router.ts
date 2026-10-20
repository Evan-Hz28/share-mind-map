import type { Pinia } from "pinia";
import {
  createRouter,
  createWebHistory,
  type Router,
  type RouterHistory,
  type RouteRecordRaw,
} from "vue-router";

import MembersView from "./admin/MembersView.vue";
import Phase2AdminView from "./admin/Phase2AdminView.vue";
import AppShell from "./app/AppShell.vue";
import HomeView from "./app/HomeView.vue";
import WorkspaceHomeView from "./app/WorkspaceHomeView.vue";
import DocumentView from "./documents/DocumentView.vue";
import ChangePasswordView from "./auth/ChangePasswordView.vue";
import LoginView from "./auth/LoginView.vue";
import SessionExpiredView from "./auth/SessionExpiredView.vue";
import { useAuthStore } from "./auth/auth.store.js";

declare module "vue-router" {
  interface RouteMeta {
    publicOnly?: boolean;
    requiresAuth?: boolean;
    requiresAdmin?: boolean;
    allowsForcedChange?: boolean;
    title?: string;
  }
}

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/home" },
  { path: "/login", name: "login", component: LoginView, meta: { publicOnly: true } },
  {
    path: "/change-password",
    name: "change-password",
    component: ChangePasswordView,
    meta: { requiresAuth: true, allowsForcedChange: true },
  },
  {
    path: "/session-expired",
    name: "session-expired",
    component: SessionExpiredView,
    meta: { publicOnly: true },
  },
  {
    path: "/",
    component: AppShell,
    meta: { requiresAuth: true },
    children: [
      {
        path: "home",
        name: "home",
        component: HomeView,
        meta: { title: "首页" },
      },
      {
        path: "workspace",
        name: "workspace",
        component: WorkspaceHomeView,
        meta: { title: "用例库" },
      },
      {
        path: "workspace/documents/:documentId",
        name: "document",
        component: DocumentView,
        props: (route) => ({ documentId: String(route.params.documentId) }),
        meta: { title: "文档" },
      },
      {
        path: "admin/members",
        name: "members",
        component: MembersView,
        meta: { requiresAdmin: true, title: "成员管理" },
      },
      {
        path: "admin/phase2",
        name: "phase2-admin",
        component: Phase2AdminView,
        meta: { requiresAdmin: true, title: "权限与审计" },
      },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: "/home" },
];

export interface CreateAppRouterOptions {
  pinia: Pinia;
  history?: RouterHistory;
}

export function createAppRouter(options: CreateAppRouterOptions): Router {
  const router = createRouter({
    history: options.history ?? createWebHistory(),
    routes,
  });
  router.beforeEach(async (to) => {
    const auth = useAuthStore(options.pinia);
    await auth.bootstrap();

    if (auth.state === "expired" && to.name !== "session-expired") {
      return { name: "session-expired" };
    }
    if (auth.state === "anonymous" && to.meta.requiresAuth) return { name: "login" };
    if (auth.state !== "authenticated") return true;
    if (auth.mustChangePassword && !to.meta.allowsForcedChange) {
      return { name: "change-password" };
    }
    if (!auth.mustChangePassword && to.name === "change-password") return { name: "home" };
    if (to.meta.requiresAdmin && auth.role !== "admin") return { name: "home" };
    if (to.meta.publicOnly) return { name: auth.mustChangePassword ? "change-password" : "home" };
    return true;
  });
  return router;
}
