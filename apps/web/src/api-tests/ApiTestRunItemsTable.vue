<script setup lang="ts">
import type { ApiTestRunItemResponseDto } from "@share-mind-map/api-client";
import { computed, reactive } from "vue";

import ApiTestRunItemsGrid from "./ApiTestRunItemsGrid.vue";

// 单套件报告和批次报告都要展示用例明细，这里统一一份，改列只改一处。
const props = defineProps<{ items: ApiTestRunItemResponseDto[] }>();

type GroupKey = "failed" | "passed" | "skipped";

// 失败、通过、跳过各自独立成组：默认只展开失败，其它点哪个开哪个，互不影响。
const open = reactive<Record<GroupKey, boolean>>({
  failed: true,
  passed: false,
  skipped: false,
});

const groups = computed(() =>
  [
    {
      key: "failed" as const,
      title: "失败用例",
      items: props.items.filter((item) => item.status === "failed" || item.status === "error"),
    },
    {
      key: "passed" as const,
      title: "通过用例",
      items: props.items.filter((item) => item.status === "passed"),
    },
    {
      key: "skipped" as const,
      title: "跳过用例",
      items: props.items.filter((item) => item.status === "skipped"),
    },
  ].filter((group) => group.items.length > 0),
);
</script>

<template>
  <div class="run-items">
    <p v-if="items.length === 0" class="run-items__empty">暂时没有用例结果</p>
    <template v-else>
      <section v-for="group in groups" :key="group.key" class="run-items__group">
        <button
          type="button"
          class="run-items__bar"
          :class="`is-${group.key}`"
          @click="open[group.key] = !open[group.key]"
        >
          <span class="run-items__bar-title">{{ group.title }}</span>
          <span class="run-items__bar-count">{{ group.items.length }}</span>
          <span class="run-items__bar-hint">{{ open[group.key] ? "收起" : "点击展开" }}</span>
        </button>
        <ApiTestRunItemsGrid
          v-if="open[group.key]"
          :items="group.items"
          :show-reason="group.key === 'failed'"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.run-items {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.run-items__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.run-items__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.run-items__bar:hover {
  background: var(--el-fill-color-light);
}

.run-items__bar-title {
  font-weight: 600;
}

.run-items__bar-count {
  color: var(--el-text-color-secondary);
}

.run-items__bar-hint {
  margin-left: auto;
  color: var(--el-color-primary);
}

.run-items__bar.is-failed {
  border-color: var(--el-color-danger-light-7);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.run-items__bar.is-passed {
  border-color: var(--el-color-success-light-7);
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

.run-items__bar.is-skipped {
  border-color: var(--el-border-color-light);
  color: var(--el-text-color-secondary);
}

.run-items__empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
