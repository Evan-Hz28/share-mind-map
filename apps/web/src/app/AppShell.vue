<script setup lang="ts">
import { ArrowDown, Menu, User } from "@element-plus/icons-vue";
import { computed, ref } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";

import AppLogo from "../components/AppLogo.vue";
import { useAuthStore } from "../auth/auth.store.js";

const auth = useAuthStore();
const router = useRouter();
const accountMenuOpen = ref(false);
const navigationOpen = ref(false);

const roleLabel = computed(() => {
  const labels = { admin: "管理员", editor: "编辑者", reader: "只读成员" } as const;
  return auth.role === null ? "" : labels[auth.role];
});

async function logout(): Promise<void> {
  if (await auth.logout()) await router.replace({ name: "login" });
}
</script>

<template>
  <div class="app-shell">
    <header class="top-bar">
      <div class="top-bar__brand">
        <AppLogo />
        <span class="top-bar__divider" aria-hidden="true" />
        <span class="workspace-name">{{ auth.session?.defaultWorkspace.name }}</span>
      </div>

      <nav class="desktop-navigation" aria-label="主导航">
        <RouterLink to="/workspace"> 工作区 </RouterLink>
        <RouterLink v-if="auth.role === 'admin'" to="/admin/members"> 成员管理 </RouterLink>
        <RouterLink v-if="auth.role === 'admin'" to="/admin/phase2"> 权限与审计 </RouterLink>
      </nav>

      <div class="top-bar__actions">
        <span class="role-status">{{ roleLabel }}</span>
        <div class="mobile-navigation">
          <button
            class="icon-button"
            type="button"
            aria-label="打开导航菜单"
            title="导航菜单"
            @click="navigationOpen = !navigationOpen"
          >
            <Menu aria-hidden="true" />
          </button>
          <nav v-if="navigationOpen" class="popover-menu" aria-label="移动导航">
            <RouterLink to="/workspace" @click="navigationOpen = false"> 工作区 </RouterLink>
            <RouterLink
              v-if="auth.role === 'admin'"
              to="/admin/members"
              @click="navigationOpen = false"
            >
              成员管理
            </RouterLink>
            <RouterLink
              v-if="auth.role === 'admin'"
              to="/admin/phase2"
              @click="navigationOpen = false"
              >权限与审计</RouterLink
            >
          </nav>
        </div>
        <div class="account-menu">
          <button
            class="account-button"
            type="button"
            aria-label="账户菜单"
            title="账户菜单"
            @click="accountMenuOpen = !accountMenuOpen"
          >
            <User aria-hidden="true" />
            <span>{{ auth.session?.user.displayName }}</span>
            <ArrowDown aria-hidden="true" />
          </button>
          <div v-if="accountMenuOpen" class="popover-menu popover-menu--right">
            <button type="button" @click="logout">退出登录</button>
          </div>
        </div>
      </div>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>
