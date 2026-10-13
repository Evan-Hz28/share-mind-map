<script setup lang="ts">
import { Close } from "@element-plus/icons-vue";
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { HOME_ROUTE_NAME, useAppTabsStore, type AppTab } from "./tabs.store.js";

const route = useRoute();
const router = useRouter();
const tabs = useAppTabsStore();

/** 编辑器独占视口，不进标签；其余页面必须声明 meta.title 才有标签文案。 */
function isTabbable(name: unknown): name is string {
  return typeof name === "string" && name !== "document" && typeof route.meta.title === "string";
}

watch(
  () => route.name,
  (name) => {
    if (isTabbable(name)) tabs.open(router, name);
  },
  { immediate: true },
);

function activate(tab: AppTab): void {
  if (route.name !== tab.name) void router.push({ name: tab.name });
}

function close(tab: AppTab): void {
  const wasActive = route.name === tab.name;
  const next = tabs.close(tab.name);
  if (wasActive && next !== null) void router.push({ name: next });
}

function closeAll(): void {
  tabs.closeAll(router);
  if (route.name !== HOME_ROUTE_NAME) void router.push({ name: HOME_ROUTE_NAME });
}
</script>

<template>
  <nav class="app-tabs" aria-label="页面标签">
    <div
      v-for="tab in tabs.tabs"
      :key="tab.name"
      class="app-tab"
      :class="{ 'app-tab--active': route.name === tab.name }"
    >
      <button class="app-tab__label" type="button" @click="activate(tab)">
        {{ tab.title }}
      </button>
      <button
        v-if="tab.name !== HOME_ROUTE_NAME"
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
