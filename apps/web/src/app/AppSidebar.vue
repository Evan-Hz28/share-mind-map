<script setup lang="ts">
import { Expand, Fold } from "@element-plus/icons-vue";
import { RouterLink } from "vue-router";

import AppLogo from "../components/AppLogo.vue";
import type { NavigationItem } from "./navigation.js";

defineProps<{
  items: NavigationItem[];
  workspaceName: string | undefined;
  collapsed: boolean;
}>();

defineEmits<{ toggleCollapse: []; navigate: [] }>();
</script>

<template>
  <aside class="app-sidebar" :class="{ 'app-sidebar--collapsed': collapsed }" aria-label="侧边导航">
    <div class="app-sidebar__brand">
      <AppLogo tagline="Recycling the world" />
      <button
        class="icon-button app-sidebar__collapse"
        type="button"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="$emit('toggleCollapse')"
      >
        <component :is="collapsed ? Expand : Fold" aria-hidden="true" />
      </button>
    </div>
    <span class="workspace-name app-sidebar__workspace" :title="workspaceName">
      {{ workspaceName }}
    </span>
    <nav class="app-sidebar__menu" aria-label="主导航">
      <RouterLink
        v-for="item in items"
        :key="item.name"
        class="app-menu-item"
        :to="{ name: item.name }"
        :title="item.title"
        @click="$emit('navigate')"
      >
        <component :is="item.icon" class="app-menu-item__icon" aria-hidden="true" />
        <span class="app-menu-item__label">{{ item.title }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>
