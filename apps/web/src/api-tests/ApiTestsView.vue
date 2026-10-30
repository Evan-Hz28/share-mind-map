<script setup lang="ts">
import {
  createApiTestRuns,
  listApiTestEnvironments,
  listApiTestRuns,
  listApiTestSuites,
  listApiTestSyncs,
  syncApiTestRepository,
  type ApiTestEnvironmentResponseDto,
  type ApiTestRunResponseDto,
  type ApiTestSuiteResponseDto,
  type ApiTestSyncResponseDto,
} from "@share-mind-map/api-client";
import { ElButton, ElTable, ElTableColumn, ElTag } from "element-plus";
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";

const router = useRouter();
const suites = ref<ApiTestSuiteResponseDto[]>([]);
const environments = ref<ApiTestEnvironmentResponseDto[]>([]);
const runs = ref<ApiTestRunResponseDto[]>([]);
const lastSync = ref<ApiTestSyncResponseDto | null>(null);
const syncing = ref(false);
const suiteId = ref("");
const runAll = ref(false);
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
  // 同步后套件 id 会变，原来的选择可能已经不存在。
  if (!suites.value.some((suite) => suite.id === suiteId.value)) {
    suiteId.value = suites.value[0]?.id ?? "";
  }
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

const syncLabels: Record<string, string> = {
  queued: "排队中",
  running: "同步中",
  succeeded: "已同步",
  failed: "同步失败",
};

async function loadSyncs(): Promise<void> {
  const result = await listApiTestSyncs({ client: apiClient, query: { limit: "5" } });
  if (result.data === undefined) {
    error.value = toApiFailure(result.error);
    return;
  }
  lastSync.value = result.data.syncs[0] ?? null;
}

async function syncRepository(): Promise<void> {
  syncing.value = true;
  error.value = null;
  try {
    const result = await syncApiTestRepository({ client: apiClient });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    await loadSyncs();
  } finally {
    syncing.value = false;
  }
}

function syncRunning(sync: ApiTestSyncResponseDto | null): boolean {
  return sync !== null && (sync.status === "queued" || sync.status === "running");
}

function shortSha(sha: string | null | undefined): string {
  return sha === null || sha === undefined ? "-" : sha.slice(0, 7);
}

function selectedSuiteIds(): string[] {
  if (runAll.value) return suites.value.map((suite) => suite.id);
  return suiteId.value === "" ? [] : [suiteId.value];
}

async function startRun(): Promise<void> {
  const suiteIds = selectedSuiteIds();
  if (suiteIds.length === 0 || environmentId.value === "") return;
  starting.value = true;
  error.value = null;
  try {
    const result = await createApiTestRuns({
      client: apiClient,
      body: { suiteIds, environmentId: environmentId.value },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    // 只跑一个直接进详情；批量留在列表看串行进度。
    await loadRuns();
    if (result.data.runs.length === 1 && result.data.runs[0] !== undefined) {
      await router.push({ name: "api-test-run", params: { runId: result.data.runs[0].id } });
    }
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
    await Promise.all([loadOptions(), loadRuns(), loadSyncs()]);
  } finally {
    loading.value = false;
  }
  poll = setInterval(() => {
    const busy = runs.value.some((run) => run.status === "queued" || run.status === "running");
    if (busy) void loadRuns().catch(() => undefined);
    if (syncRunning(lastSync.value)) {
      void loadSyncs()
        .then(() => {
          // 同步结束后套件列表可能变化，顺手刷新下拉框。
          if (!syncRunning(lastSync.value)) return loadOptions();
          return undefined;
        })
        .catch(() => undefined);
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
        <p>选择套件和测试环境；勾选「全部套件」会按顺序逐个串行执行。</p>
      </div>
      <div class="api-tests__actions">
        <ElButton
          :loading="syncing || syncRunning(lastSync)"
          :disabled="syncRunning(lastSync)"
          @click="syncRepository"
        >
          同步用例
        </ElButton>
        <label class="api-tests__toggle">
          <input v-model="runAll" type="checkbox" :disabled="suites.length === 0" />
          全部套件
        </label>
        <select v-model="suiteId" class="api-tests__select" :disabled="runAll">
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

    <p v-if="lastSync !== null" class="api-tests__sync">
      仓库 {{ syncLabels[lastSync.status] ?? lastSync.status }} ·
      {{ shortSha(lastSync.commitSha) }} ·
      {{ formatTime(lastSync.finishedAt ?? lastSync.createdAt) }} ·
      套件 +{{ lastSync.suitesAdded }} / -{{ lastSync.suitesRemoved }}
      <span v-if="lastSync.message" class="api-tests__sync-note">{{ lastSync.message }}</span>
    </p>
    <p v-else class="api-tests__sync">
      还没有同步过用例仓库，点「同步用例」拉取上游 testcases。
    </p>

    <RequestErrorAlert :error="error" class="api-tests__error" />

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

.api-tests__sync {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.api-tests__sync-note {
  margin-left: 8px;
  color: var(--el-color-warning);
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

.api-tests__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
</style>
