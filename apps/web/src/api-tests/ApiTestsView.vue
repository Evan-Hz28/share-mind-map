<script setup lang="ts">
import {
  createApiTestRun,
  listApiTestEnvironments,
  listApiTestRuns,
  listApiTestSuites,
  type ApiTestEnvironmentResponseDto,
  type ApiTestRunResponseDto,
  type ApiTestSuiteResponseDto,
} from "@share-mind-map/api-client";
import { ElAlert, ElButton, ElTable, ElTableColumn, ElTag } from "element-plus";
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";

const router = useRouter();
const suites = ref<ApiTestSuiteResponseDto[]>([]);
const environments = ref<ApiTestEnvironmentResponseDto[]>([]);
const runs = ref<ApiTestRunResponseDto[]>([]);
const suiteId = ref("");
const environmentId = ref("");
const loading = ref(true);
const starting = ref(false);
const error = ref<RequestFailure | null>(null);
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

async function loadOptions(): Promise<void> {
  const [suiteResult, environmentResult] = await Promise.all([
    listApiTestSuites({ client: apiClient }),
    listApiTestEnvironments({ client: apiClient }),
  ]);
  if (suiteResult.data === undefined) {
    error.value = toApiFailure(suiteResult.error);
    return;
  }
  if (environmentResult.data === undefined) {
    error.value = toApiFailure(environmentResult.error);
    return;
  }
  suites.value = suiteResult.data.suites;
  environments.value = environmentResult.data.environments;
  suiteId.value = suites.value[0]?.id ?? "";
  environmentId.value = environments.value[0]?.id ?? "";
}

async function loadRuns(): Promise<void> {
  const result = await listApiTestRuns({ client: apiClient, query: { limit: "30" } });
  if (result.data === undefined) {
    error.value = toApiFailure(result.error);
    return;
  }
  runs.value = result.data.runs;
}

async function startRun(): Promise<void> {
  if (suiteId.value === "" || environmentId.value === "") return;
  starting.value = true;
  error.value = null;
  try {
    const result = await createApiTestRun({
      client: apiClient,
      body: { suiteId: suiteId.value, environmentId: environmentId.value },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    await router.push({ name: "api-test-run", params: { runId: result.data.id } });
  } finally {
    starting.value = false;
  }
}

function openRun(run: unknown): void {
  const id = (run as ApiTestRunResponseDto).id;
  void router.push({ name: "api-test-run", params: { runId: id } });
}

function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Date(value).toLocaleString();
}

onMounted(async () => {
  error.value = null;
  try {
    await Promise.all([loadOptions(), loadRuns()]);
  } finally {
    loading.value = false;
  }
  poll = setInterval(() => {
    if (runs.value.some((run) => run.status === "queued" || run.status === "running")) {
      void loadRuns().catch(() => undefined);
    }
  }, 2000);
});

onUnmounted(() => {
  if (poll !== null) clearInterval(poll);
});
</script>

<template>
  <section class="api-tests">
    <header class="api-tests__header">
      <div>
        <h1>接口测试</h1>
        <p>选择套件和测试环境，执行结果会记录到下方列表。</p>
      </div>
      <div class="api-tests__actions">
        <select v-model="suiteId" class="api-tests__select">
          <option v-for="suite in suites" :key="suite.id" :value="suite.id">
            {{ suite.name }}
          </option>
        </select>
        <select v-model="environmentId" class="api-tests__select">
          <option
            v-for="environment in environments"
            :key="environment.id"
            :value="environment.id"
          >
            {{ environment.name }}
          </option>
        </select>
        <ElButton type="primary" :loading="starting" @click="startRun">执行</ElButton>
      </div>
    </header>

    <ElAlert v-if="error !== null" type="error" :closable="false" class="api-tests__error">
      {{ error.code }}
    </ElAlert>

    <p v-if="loading" class="api-tests__loading">加载中…</p>
    <ElTable
      v-else
      :data="runs"
      empty-text="还没有执行记录"
      row-key="id"
      @row-click="openRun"
    >
      <ElTableColumn prop="suiteName" label="套件" min-width="140" />
      <ElTableColumn prop="environmentKey" label="环境" width="100" />
      <ElTableColumn label="状态" width="110">
        <template #default="{ row }">
          <ElTag :type="statusTypes[row.status] ?? 'info'">
            {{ statusLabels[row.status] ?? row.status }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="结果" width="180">
        <template #default="{ row }">
          {{ row.passedCount }} 通过 / {{ row.failedCount }} 失败 / {{ row.skippedCount }} 跳过
        </template>
      </ElTableColumn>
      <ElTableColumn label="开始时间" min-width="180">
        <template #default="{ row }">{{ formatTime(row.startedAt ?? row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="100">
        <template #default="{ row }">
          <ElButton link type="primary" @click.stop="openRun(row)">查看</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
  </section>
</template>

<style scoped>
.api-tests {
  padding: 24px;
}

.api-tests__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.api-tests__header h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.api-tests__header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.api-tests__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.api-tests__error {
  margin-bottom: 16px;
}

.api-tests__loading {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.api-tests__select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
}
</style>
