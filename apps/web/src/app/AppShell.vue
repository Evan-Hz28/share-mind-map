<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

import { useAuthStore } from "../auth/auth.store.js";
import AppSidebar from "./AppSidebar.vue";
import AppTabs from "./AppTabs.vue";
import AppTopBar from "./AppTopBar.vue";
import { filterNavigationByRole, navigationItems } from "./navigation.js";
import { useAppTabsStore } from "./tabs.store.js";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const tabs = useAppTabsStore();

const sidebarCollapsed = ref(false);
const drawerOpen = ref(false);
const isEditorRoute = computed(() => route.name === "document");
const menuItems = computed(() => filterNavigationByRole(navigationItems, auth.role));

// 先于 AppTabs 的 setup 执行，保证标签回填发生在当前路由入栈之前。
tabs.load(router);
tabs.prune(auth.role);

watch(
  () => auth.role,
  (role) => {
    tabs.prune(role);
    if (role !== "admin") drawerOpen.value = false;
  },
);

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function closeDrawer(): void {
  drawerOpen.value = false;
}

async function logout(): Promise<void> {
  const signedOut = await auth.logout();
  closeDrawer();
  if (!signedOut) return;
  tabs.closeAll(router);
  await router.replace({ name: "login" });
}
</script>

<template>
  <div v-if="isEditorRoute" class="app-shell app-shell--editor">
    <AppTopBar show-brand @logout="logout" />
    <main class="app-main">
      <RouterView />
    </main>
  </div>

  <div v-else class="app-shell" :class="{ 'app-drawer-open': drawerOpen }">
    <AppSidebar
      :items="menuItems"
      :workspace-name="auth.session?.defaultWorkspace.name"
      :collapsed="sidebarCollapsed"
      @toggle-collapse="toggleSidebar"
      @navigate="closeDrawer"
    />
    <div class="app-body">
      <AppTopBar show-navigation-toggle @open-drawer="drawerOpen = true" @logout="logout" />
      <AppTabs />
      <main class="app-main">
        <RouterView />
      </main>
    </div>
    <div v-if="drawerOpen" class="app-drawer-backdrop" @click="closeDrawer" />
  </div>
</template>
