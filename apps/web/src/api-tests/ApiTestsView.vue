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
import { ElButton, ElInput, ElTable, ElTableColumn, ElTag } from "element-plus";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
const keyword = ref("");
const environmentId = ref("");
const tab = ref<"overview" | "runs">("overview");
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

const selectedSuite = computed<ApiTestSuiteResponseDto | null>(
  () => suites.value.find((suite) => suite.id === suiteId.value) ?? null,
);

const latestRun = computed<ApiTestRunResponseDto | null>(() => runs.value[0] ?? null);

const filteredSuites = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (text === "") return suites.value;
  return suites.value.filter(
    (suite) =>
      suite.name.toLowerCase().includes(text) || suite.key.toLowerCase().includes(text),
  );
});

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
  // 同步只按 path upsert，套件 id 稳定；选中项还在就保留。
  if (!suites.value.some((suite) => suite.id === suiteId.value)) {
    suiteId.value = suites.value[0]?.id ?? "";
  }
  environmentId.value = environments.value[0]?.id ?? "";
}

async function loadRuns(): Promise<void> {
  if (suiteId.value === "") {
    runs.value = [];
    return;
  }
  const result = await listApiTestRuns({
    client: apiClient,
    query: { limit: "30", suiteId: suiteId.value },
  });
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

async function startRun(target: string[]): Promise<void> {
  if (target.length === 0 || environmentId.value === "") return;
  starting.value = true;
  error.value = null;
  try {
    const result = await createApiTestRuns({
      client: apiClient,
      body: { suiteIds: target, environmentId: environmentId.value },
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

function runAllSuites(): void {
  void startRun(suites.value.map((suite) => suite.id));
}

function selectSuite(id: string): void {
  suiteId.value = id;
}

function openRun(run: unknown): void {
  const id = (run as ApiTestRunResponseDto).id;
  void router.push({ name: "api-test-run", params: { runId: id } });
}

function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Date(value).toLocaleString();
}

// 表格插槽的 row 是通用类型，这里统一转换一次。
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

watch(suiteId, () => {
  void loadRuns().catch(() => undefined);
});

onMounted(async () => {
  error.value = null;
  try {
    await Promise.all([loadOptions(), loadSyncs()]);
    await loadRuns();
  } finally {
    loading.value = false;
  }
  poll = setInterval(() => {
    const busy = runs.value.some((run) => run.status === "queued" || run.status === "running");
    if (busy) void loadRuns().catch(() => undefined);
    if (syncRunning(lastSync.value)) {
      void loadSyncs()
        .then(() => {
          // 同步结束后套件列表可能变化，顺手刷新左列。
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
        <p>管理测试套件，执行接口自动化测试</p>
      </div>
      <ElButton
        :loading="syncing || syncRunning(lastSync)"
        :disabled="syncRunning(lastSync)"
        @click="syncRepository"
      >
        同步用例
      </ElButton>
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

    <div v-else class="api-tests__body">
      <aside class="api-tests__suites">
        <h2>测试套件（{{ suites.length }}）</h2>
        <ElInput v-model="keyword" placeholder="搜索测试套件" clearable />
        <ul v-if="filteredSuites.length > 0" class="api-tests__suite-list">
          <li v-for="suite in filteredSuites" :key="suite.id">
            <button
              type="button"
              class="api-tests__suite"
              :class="{ 'is-active': suite.id === suiteId }"
              @click="selectSuite(suite.id)"
            >
              {{ suite.name }}
            </button>
          </li>
        </ul>
        <p v-else class="api-tests__empty">
          {{ suites.length === 0 ? "还没有套件，先同步用例。" : "没有匹配的套件。" }}
        </p>
      </aside>

      <div class="api-tests__detail">
        <div class="api-tests__suite-header">
          <div>
            <h2>{{ selectedSuite?.name ?? "未选择套件" }}</h2>
            <p v-if="selectedSuite !== null" class="api-tests__path">
              {{ selectedSuite.path }}
            </p>
          </div>
          <div class="api-tests__run-actions">
            <select v-model="environmentId" class="api-tests__select">
              <option
                v-for="environment in environments"
                :key="environment.id"
                :value="environment.id"
              >
                {{ environment.name }}
              </option>
            </select>
            <ElButton
              type="primary"
              :loading="starting"
              :disabled="selectedSuite === null || environmentId === ''"
              @click="startRun(suiteId === '' ? [] : [suiteId])"
            >
              执行测试
            </ElButton>
            <ElButton
              :loading="starting"
              :disabled="suites.length === 0 || environmentId === ''"
              @click="runAllSuites"
            >
              全部套件
            </ElButton>
          </div>
        </div>

        <div class="api-tests__tabs">
          <button
            type="button"
            class="api-tests__tab"
            :class="{ 'is-active': tab === 'overview' }"
            @click="tab = 'overview'"
          >
            概览
          </button>
          <button
            type="button"
            class="api-tests__tab"
            :class="{ 'is-active': tab === 'runs' }"
            @click="tab = 'runs'"
          >
            执行记录
          </button>
        </div>

        <div v-if="tab === 'overview'" class="api-tests__panel">
          <section class="api-tests__latest">
            <h3>最近一次执行结果</h3>
            <p v-if="latestRun === null" class="api-tests__empty">这个套件还没有执行记录。</p>
            <div v-else class="api-tests__latest-body">
              <span class="api-tests__run-id">
                #{{ latestRun.id.slice(0, 8) }} ·
                {{ formatTime(latestRun.startedAt ?? latestRun.createdAt) }}
              </span>
              <ElTag :type="statusTypes[latestRun.status] ?? 'info'">
                {{ statusLabels[latestRun.status] ?? latestRun.status }}
              </ElTag>
              <span class="api-tests__stat">
                <strong>{{ latestRun.totalCount }}</strong> 总用例
              </span>
              <span class="api-tests__stat is-passed">
                <strong>{{ latestRun.passedCount }}</strong> 通过
              </span>
              <span class="api-tests__stat is-failed">
                <strong>{{ latestRun.failedCount }}</strong> 失败
              </span>
              <span class="api-tests__stat">
                <strong>{{ latestRun.skippedCount }}</strong> 跳过
              </span>
              <ElButton @click="openRun(latestRun)">查看报告</ElButton>
            </div>
          </section>
        </div>

        <ElTable
          v-else
          :data="runs"
          empty-text="还没有执行记录"
          row-key="id"
          @row-click="openRun"
        >
          <ElTableColumn label="执行 ID" width="120">
            <template #default="{ row }">{{ row.id.slice(0, 8) }}</template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="110">
            <template #default="{ row }">
              <ElTag :type="statusTypes[row.status] ?? 'info'">
                {{ statusLabels[row.status] ?? row.status }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="结果" width="200">
            <template #default="{ row }">
              {{ row.passedCount }} 通过 / {{ row.failedCount }} 失败 /
              {{ row.skippedCount }} 跳过
            </template>
          </ElTableColumn>
          <ElTableColumn prop="environmentKey" label="环境" width="100" />
          <ElTableColumn label="耗时" width="100">
            <template #default="{ row }">{{ formatDuration(row) }}</template>
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
      </div>
    </div>
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

.api-tests__error {
  margin: 16px 0;
}

.api-tests__sync {
  margin: 12px 0 0;
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

.api-tests__body {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}

.api-tests__suites {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.api-tests__suites h2 {
  margin: 0;
  font-size: 15px;
}

.api-tests__suite-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.api-tests__suite {
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-primary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.api-tests__suite:hover {
  background: var(--el-fill-color-light);
}

.api-tests__suite.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.api-tests__detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.api-tests__suite-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.api-tests__suite-header h2 {
  margin: 0;
  font-size: 18px;
}

.api-tests__path {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

.api-tests__run-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.api-tests__select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
}

.api-tests__tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.api-tests__tab {
  padding: 8px 0;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 14px;
  cursor: pointer;
}

.api-tests__tab.is-active {
  border-bottom-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: 600;
}

.api-tests__panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.api-tests__latest {
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.api-tests__latest h3 {
  margin: 0 0 12px;
  font-size: 15px;
}

.api-tests__latest-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
}

.api-tests__run-id {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.api-tests__stat {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.api-tests__stat strong {
  margin-right: 4px;
  color: var(--el-text-color-primary);
  font-size: 18px;
}

.api-tests__stat.is-passed strong {
  color: var(--el-color-success);
}

.api-tests__stat.is-failed strong {
  color: var(--el-color-danger);
}

.api-tests__empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
