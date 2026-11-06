<script setup lang="ts">
import {
  cancelApiTestRun,
  getApiTestRun,
  type ApiTestRunDetailResponseDto,
} from "@share-mind-map/api-client";
import { ElButton, ElDescriptions, ElDescriptionsItem, ElTag } from "element-plus";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import { useAppTabsStore } from "../app/tabs.store.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import ApiTestErrorOutput from "./ApiTestErrorOutput.vue";
import ApiTestRunItemsTable from "./ApiTestRunItemsTable.vue";

const props = defineProps<{ runId: string }>();

const route = useRoute();
const tabs = useAppTabsStore();

const run = ref<ApiTestRunDetailResponseDto | null>(null);
const error = ref<RequestFailure | null>(null);
const loading = ref(true);
const cancelling = ref(false);
let poll: ReturnType<typeof setInterval> | null = null;

const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "通过",
  failed: "失败",
  cancelled: "已取消",
};

const statusTypes: Record<string, "info" | "warning" | "success" | "danger"> = {
  queued: "info",
  running: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "info",
};

const terminal = computed(
  () =>
    run.value !== null &&
    !["queued", "running"].includes(run.value.status),
);

async function load(): Promise<void> {
  const requestedRunId = props.runId;
  const result = await getApiTestRun({ client: apiClient, path: { runId: requestedRunId } });
  // 切换标签时旧请求可能后到，丢弃过期结果
  if (requestedRunId !== props.runId) return;
  if (result.data === undefined) {
    error.value = toApiFailure(result.error);
    return;
  }
  run.value = result.data;
}

// 报告页复用同一个组件实例，只换 runId 时 onMounted 不会再跑，必须手动重载
watch(
  () => props.runId,
  (runId) => {
    run.value = null;
    error.value = null;
    loading.value = true;
    void load().finally(() => {
      if (props.runId === runId) loading.value = false;
    });
  },
);

async function cancel(): Promise<void> {
  cancelling.value = true;
  error.value = null;
  try {
    const result = await cancelApiTestRun({ client: apiClient, path: { runId: props.runId } });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    await load();
  } finally {
    cancelling.value = false;
  }
}

// 报告标签默认都叫「测试报告」，补上套件名，同时开多个报告时能区分
watch(run, (value) => {
  if (value !== null) tabs.rename(route.path, `测试报告 · ${value.suiteName}`);
});

function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Date(value).toLocaleString();
}

onMounted(async () => {
  loading.value = true;
  try {
    await load();
  } finally {
    loading.value = false;
  }
  poll = setInterval(() => {
    if (!terminal.value) void load().catch(() => undefined);
  }, 1000);
});

onUnmounted(() => {
  if (poll !== null) clearInterval(poll);
});
</script>

<template>
  <section class="api-test-run">
    <header class="api-test-run__header">
      <div>
        <h1>测试报告</h1>
        <p v-if="run !== null">
          {{ run.suiteName }} · {{ run.environmentName }} · {{ formatTime(run.startedAt) }}
          <template v-if="run.repoCommit"> · {{ run.repoCommit.slice(0, 7) }}</template>
        </p>
      </div>
      <ElButton
        v-if="run !== null && !terminal"
        type="danger"
        plain
        :loading="cancelling"
        @click="cancel"
      >
        取消执行
      </ElButton>
    </header>

    <RequestErrorAlert :error="error" class="api-test-run__error" />

    <div>
      <p v-if="loading" class="api-test-run__loading">加载中…</p>
      <ElDescriptions v-if="run !== null" :column="5" border class="api-test-run__summary">
        <ElDescriptionsItem label="状态">
          <ElTag :type="statusTypes[run.status] ?? 'info'">
            {{ statusLabels[run.status] ?? run.status }}
          </ElTag>
        </ElDescriptionsItem>
        <ElDescriptionsItem label="总数">{{ run.totalCount }}</ElDescriptionsItem>
        <ElDescriptionsItem label="通过">{{ run.passedCount }}</ElDescriptionsItem>
        <ElDescriptionsItem label="失败">{{ run.failedCount }}</ElDescriptionsItem>
        <ElDescriptionsItem label="跳过">{{ run.skippedCount }}</ElDescriptionsItem>
      </ElDescriptions>

      <ApiTestErrorOutput
        v-if="run?.errorMessage"
        :message="run.errorMessage"
        class="api-test-run__error"
      />

      <ApiTestRunItemsTable v-if="run !== null" :items="run.items" class="api-test-run__table" />
    </div>
  </section>
</template>

<style scoped>
.api-test-run {
  padding: 24px;
}

.api-test-run__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.api-test-run__header h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.api-test-run__header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.api-test-run__summary,
.api-test-run__error,
.api-test-run__table {
  margin-bottom: 16px;
}

.api-test-run__loading {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
