<script setup lang="ts">
import {
  cancelApiTestBatch,
  getApiTestBatch,
  getApiTestRun,
  type ApiTestBatchResponseDto,
  type ApiTestRunItemResponseDto,
  type ApiTestRunResponseDto,
} from "@share-mind-map/api-client";
import {
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElTable,
  ElTableColumn,
  ElTag,
} from "element-plus";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import { useAppTabsStore } from "../app/tabs.store.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import ApiTestErrorOutput from "./ApiTestErrorOutput.vue";
import ApiTestRunItemsTable from "./ApiTestRunItemsTable.vue";

const props = defineProps<{ batchId: string }>();

const route = useRoute();
const router = useRouter();
const tabs = useAppTabsStore();

const batch = ref<ApiTestBatchResponseDto | null>(null);
const error = ref<RequestFailure | null>(null);
const loading = ref(true);
const cancelling = ref(false);
// 用例明细按 run 展开时才拉，整批几千条一次性拿回来会把首屏拖死。
const itemsByRun = ref<Record<string, ApiTestRunItemResponseDto[]>>({});
const loadingItems = ref<Record<string, boolean>>({});
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
  () => batch.value !== null && !["queued", "running"].includes(batch.value.status),
);

async function load(): Promise<void> {
  const requestedBatchId = props.batchId;
  const result = await getApiTestBatch({
    client: apiClient,
    path: { batchId: requestedBatchId },
  });
  // 切换标签时旧请求可能后到，丢弃过期结果。
  if (requestedBatchId !== props.batchId) return;
  if (result.data === undefined) {
    error.value = toApiFailure(result.error);
    return;
  }
  batch.value = result.data;
}

async function loadItems(runId: string): Promise<void> {
  if (itemsByRun.value[runId] !== undefined || loadingItems.value[runId] === true) return;
  loadingItems.value = { ...loadingItems.value, [runId]: true };
  try {
    const result = await getApiTestRun({ client: apiClient, path: { runId } });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    itemsByRun.value = { ...itemsByRun.value, [runId]: result.data.items };
  } finally {
    loadingItems.value = { ...loadingItems.value, [runId]: false };
  }
}

// ElTable 的展开事件对普通表格收到的是「当前展开的行」，非树形不会给数组。
function onExpand(row: unknown, expandedRows: unknown): void {
  const run = row as ApiTestRunResponseDto;
  const rows = Array.isArray(expandedRows) ? expandedRows : [expandedRows];
  if (!rows.some((value) => (value as ApiTestRunResponseDto).id === run.id)) return;
  void loadItems(run.id).catch(() => undefined);
}

async function cancelBatch(): Promise<void> {
  cancelling.value = true;
  error.value = null;
  try {
    const result = await cancelApiTestBatch({
      client: apiClient,
      path: { batchId: props.batchId },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    batch.value = result.data;
  } finally {
    cancelling.value = false;
  }
}

function openRun(run: unknown): void {
  void router.push({
    name: "api-test-run",
    params: { runId: (run as ApiTestRunResponseDto).id },
  });
}

function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Date(value).toLocaleString();
}

function formatDuration(input: unknown): string {
  const run = input as { startedAt?: string | null; finishedAt?: string | null };
  if (run.startedAt === null || run.startedAt === undefined) return "-";
  const end =
    run.finishedAt === null || run.finishedAt === undefined
      ? Date.now()
      : new Date(run.finishedAt).getTime();
  const seconds = Math.max(0, Math.round((end - new Date(run.startedAt).getTime()) / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

function itemsOf(run: unknown): ApiTestRunItemResponseDto[] {
  return itemsByRun.value[(run as ApiTestRunResponseDto).id] ?? [];
}

watch(
  () => props.batchId,
  (batchId) => {
    batch.value = null;
    error.value = null;
    itemsByRun.value = {};
    loading.value = true;
    void load().finally(() => {
      if (props.batchId === batchId) loading.value = false;
    });
  },
);

watch(batch, (value) => {
  if (value !== null) {
    tabs.rename(route.path, `测试报告 · 组合执行 ${String(value.totals.suiteCount)} 个套件`);
  }
});

onMounted(async () => {
  loading.value = true;
  try {
    await load();
  } finally {
    loading.value = false;
  }
  poll = setInterval(() => {
    if (!terminal.value) void load().catch(() => undefined);
  }, 2000);
});

onUnmounted(() => {
  if (poll !== null) clearInterval(poll);
});
</script>

<template>
  <section class="api-test-batch">
    <header class="api-test-batch__header">
      <div>
        <h1>测试报告</h1>
        <p v-if="batch !== null">
          组合执行 · {{ batch.environmentName }} ·
          {{ formatTime(batch.runs[0]?.createdAt) }}
        </p>
      </div>
      <ElButton
        v-if="batch !== null && !terminal"
        type="danger"
        plain
        :loading="cancelling"
        @click="cancelBatch"
      >
        取消整批
      </ElButton>
    </header>

    <RequestErrorAlert :error="error" class="api-test-batch__error" />

    <p v-if="loading" class="api-test-batch__loading">加载中…</p>

    <div v-else-if="batch !== null">
      <ElDescriptions :column="6" border class="api-test-batch__summary">
        <ElDescriptionsItem label="状态">
          <ElTag :type="statusTypes[batch.status] ?? 'info'">
            {{ statusLabels[batch.status] ?? batch.status }}
          </ElTag>
        </ElDescriptionsItem>
        <ElDescriptionsItem label="套件">{{ batch.totals.suiteCount }}</ElDescriptionsItem>
        <ElDescriptionsItem label="总数">{{ batch.totals.totalCount }}</ElDescriptionsItem>
        <ElDescriptionsItem label="通过">{{ batch.totals.passedCount }}</ElDescriptionsItem>
        <ElDescriptionsItem label="失败">{{ batch.totals.failedCount }}</ElDescriptionsItem>
        <ElDescriptionsItem label="跳过">{{ batch.totals.skippedCount }}</ElDescriptionsItem>
      </ElDescriptions>

      <ElTable
        :data="batch.runs"
        row-key="id"
        empty-text="暂时没有执行记录"
        class="api-test-batch__table"
        @expand-change="onExpand"
      >
        <ElTableColumn type="expand">
          <template #default="{ row }">
            <div class="api-test-batch__items">
              <ApiTestErrorOutput
                v-if="row.errorMessage"
                :message="row.errorMessage"
                class="api-test-batch__run-error"
              />
              <p v-if="loadingItems[row.id]" class="api-test-batch__loading">加载用例明细…</p>
              <ApiTestRunItemsTable v-else :items="itemsOf(row)" />
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="suiteName" label="套件" min-width="220" />
        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag :type="statusTypes[row.status] ?? 'info'">
              {{ statusLabels[row.status] ?? row.status }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="totalCount" label="总数" width="80" />
        <ElTableColumn prop="passedCount" label="通过" width="80" />
        <ElTableColumn prop="failedCount" label="失败" width="80" />
        <ElTableColumn prop="skippedCount" label="跳过" width="80" />
        <ElTableColumn label="耗时" width="100">
          <template #default="{ row }">{{ formatDuration(row) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="100">
          <template #default="{ row }">
            <ElButton link type="primary" @click.stop="openRun(row)">查看</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>
  </section>
</template>

<style scoped>
.api-test-batch {
  padding: 24px;
}

.api-test-batch__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.api-test-batch__header h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.api-test-batch__header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.api-test-batch__summary,
.api-test-batch__error,
.api-test-batch__table {
  margin-bottom: 16px;
}

.api-test-batch__items {
  padding: 12px 16px;
}

.api-test-batch__run-error {
  margin-bottom: 12px;
}

.api-test-batch__loading {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
