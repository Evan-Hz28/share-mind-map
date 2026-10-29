<script setup lang="ts">
import { Close } from "@element-plus/icons-vue";
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { HOME_PATH, useAppTabsStore, type AppTab } from "./tabs.store.js";

const route = useRoute();
const router = useRouter();
const tabs = useAppTabsStore();

/** 编辑器独占视口，不进标签；其余页面必须声明 meta.title 才有标签文案。 */
function isTabbable(name: unknown): name is string {
  return typeof name === "string" && name !== "document" && typeof route.meta.title === "string";
}

watch(
  () => route.path,
  () => {
    if (isTabbable(route.name)) tabs.open(router, route.path);
  },
  { immediate: true },
);

function activate(tab: AppTab): void {
  if (route.path !== tab.path) void router.push(tab.path);
}

function close(tab: AppTab): void {
  const wasActive = route.path === tab.path;
  const next = tabs.close(tab.path);
  if (wasActive && next !== null) void router.push(next);
}

function closeAll(): void {
  tabs.closeAll(router);
  if (route.path !== HOME_PATH) void router.push(HOME_PATH);
}
</script>

<template>
  <nav class="app-tabs" aria-label="页面标签">
    <div
      v-for="tab in tabs.tabs"
      :key="tab.path"
      class="app-tab"
      :class="{ 'app-tab--active': route.path === tab.path }"
    >
      <button class="app-tab__label" type="button" @click="activate(tab)">
        {{ tab.title }}
      </button>
      <button
        v-if="tab.path !== HOME_PATH"
        class="app-tab__close"
        type="button"
        :aria-label="`关闭 ${tab.title}`"
        @click="close(tab)"
      >
        <Close aria-hidden="true" />
      </button>
    </div>
    <button class="app-tabs__close-all" type="button" @click="closeAll">关闭全部</button>
  </nav>
</template>
