<script setup lang="ts">
import { ArrowDown, Menu, User } from "@element-plus/icons-vue";
import { computed, ref } from "vue";

import { useAuthStore } from "../auth/auth.store.js";
import AppLogo from "../components/AppLogo.vue";

defineProps<{
  /** 编辑器态没有侧边栏，品牌标回落到顶栏。 */
  showBrand?: boolean;
  /** 只有渲染了侧边栏的布局才需要移动端抽屉按钮。 */
  showNavigationToggle?: boolean;
}>();

defineEmits<{ openDrawer: []; logout: [] }>();

const auth = useAuthStore();
const accountMenuOpen = ref(false);

const roleLabel = computed(() => {
  const labels = { admin: "管理员", editor: "编辑者", reader: "只读成员" } as const;
  return auth.role === null ? "" : labels[auth.role];
});
</script>

<template>
  <header class="top-bar" aria-label="应用顶部导航">
    <div v-if="showNavigationToggle" class="mobile-navigation">
      <button
        class="icon-button"
        type="button"
        aria-label="打开导航菜单"
        title="导航菜单"
        @click="$emit('openDrawer')"
      >
        <Menu aria-hidden="true" />
      </button>
    </div>
    <AppLogo v-if="showBrand" />
    <div class="top-bar__actions">
      <span class="role-status">{{ roleLabel }}</span>
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
          <button type="button" @click="$emit('logout')">退出登录</button>
        </div>
      </div>
    </div>
  </header>
</template>
