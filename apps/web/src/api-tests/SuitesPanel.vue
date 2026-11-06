<script setup lang="ts">
import {
  createApiTestRuns,
  listApiTestRuns,
  type ApiTestEnvironmentResponseDto,
  type ApiTestRunResponseDto,
  type ApiTestSuiteResponseDto,
} from "@share-mind-map/api-client";
import { ElButton, ElCheckbox, ElInput, ElTable, ElTableColumn, ElTag } from "element-plus";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import CaseTree from "./CaseTree.vue";

const props = defineProps<{
  suites: ApiTestSuiteResponseDto[];
  environments: ApiTestEnvironmentResponseDto[];
}>();

const environmentId = defineModel<string>("environmentId", { default: "" });

const emit = defineEmits<{
  "schedule-suite": [payload: { targetType: "suite"; targetId: string; environmentId: string }];
}>();

const router = useRouter();
const runs = ref<ApiTestRunResponseDto[]>([]);
const suiteId = ref("");
// 勾选只决定「组合执行」跑哪几个，行点击另管右侧详情，两者互不干扰。
const selectedIds = ref<string[]>([]);
// 当前测试集里勾选的文件/函数，和套件勾选互不影响。
const selectedCaseIds = ref<string[]>([]);
const keyword = ref("");
const tab = ref<"overview" | "cases" | "runs">("overview");
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
  () => props.suites.find((suite) => suite.id === suiteId.value) ?? null,
);

const latestRun = computed<ApiTestRunResponseDto | null>(() => runs.value[0] ?? null);

const filteredSuites = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (text === "") return props.suites;
  return props.suites.filter(
    (suite) =>
      suite.name.toLowerCase().includes(text) || suite.key.toLowerCase().includes(text),
  );
});

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

async function startRun(body: {
  suiteIds?: string[];
  caseIds?: string[];
}): Promise<void> {
  if (environmentId.value === "") return;
  starting.value = true;
  error.value = null;
  try {
    const result = await createApiTestRuns({
      client: apiClient,
      body: { ...body, environmentId: environmentId.value },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    await loadRuns();
    // 只跑一个进单套件详情；多个进批次报告，一次看完整批结果。
    const first = result.data.runs[0];
    if (result.data.runs.length === 1 && first !== undefined) {
      await router.push({ name: "api-test-run", params: { runId: first.id } });
      return;
    }
    await router.push({ name: "api-test-batch", params: { batchId: result.data.batchId } });
  } finally {
    starting.value = false;
  }
}

function runSelected(): void {
  if (selectedIds.value.length === 0) return;
  void startRun({ suiteIds: [...selectedIds.value] });
}

function runSelectedCases(): void {
  if (selectedCaseIds.value.length === 0) return;
  void startRun({ caseIds: [...selectedCaseIds.value] });
}

/** 只给当前详情里的这一个套件建定时任务，带到定时 tab 里预填。 */
function scheduleSelected(): void {
  if (selectedSuite.value === null || environmentId.value === "") return;
  emit("schedule-suite", {
    targetType: "suite",
    targetId: selectedSuite.value.id,
    environmentId: environmentId.value,
  });
}

function selectSuite(id: string): void {
  suiteId.value = id;
}

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id);
}

function toggleSelected(id: string, checked: boolean): void {
  const next = new Set(selectedIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  selectedIds.value = [...next];
}

function selectAllVisible(): void {
  selectedIds.value = [...new Set([...selectedIds.value, ...filteredSuites.value.map((s) => s.id)])];
}

function clearSelection(): void {
  selectedIds.value = [];
}

function openRun(run: unknown): void {
  const id = (run as ApiTestRunResponseDto).id;
  void router.push({ name: "api-test-run", params: { runId: id } });
}

// 同步只按 path upsert，套件 id 稳定；选中项还在就保留。
watch(
  () => props.suites,
  (value) => {
    if (!value.some((suite) => suite.id === suiteId.value)) {
      suiteId.value = value[0]?.id ?? "";
    }
    // 套件可能被同步任务停用，勾选集里已经不存在的 id 要摘掉，否则执行时报 404。
    const available = new Set(value.map((suite) => suite.id));
    selectedIds.value = selectedIds.value.filter((id) => available.has(id));
  },
  { immediate: true },
);

watch(suiteId, () => {
  // 用例 id 只在所属测试集里有效，切走就清掉，避免拿旧选择去执行。
  selectedCaseIds.value = [];
  void loadRuns().catch(() => undefined);
});

onMounted(() => {
  void loadRuns().catch(() => undefined);
  poll = setInterval(() => {
    const busy = runs.value.some((run) => run.status === "queued" || run.status === "running");
    if (busy) void loadRuns().catch(() => undefined);
  }, 2000);
});

onUnmounted(() => {
  if (poll !== null) clearInterval(poll);
});
</script>

<template>
  <div class="suites">
    <RequestErrorAlert :error="error" class="suites__error" />

    <div class="suites__body">
      <aside class="suites__list">
        <h2>测试套件（{{ suites.length }}）</h2>
        <ElInput v-model="keyword" placeholder="搜索测试套件" clearable />
        <div class="suites__selection">
          <span class="suites__selected-count">已选 {{ selectedIds.length }}</span>
          <button type="button" class="suites__link" @click="selectAllVisible">全选</button>
          <button type="button" class="suites__link" @click="clearSelection">清空</button>
        </div>
        <ul v-if="filteredSuites.length > 0" class="suites__items">
          <li v-for="suite in filteredSuites" :key="suite.id" class="suites__item-row">
            <ElCheckbox
              :model-value="isSelected(suite.id)"
              @update:model-value="(checked) => toggleSelected(suite.id, checked === true)"
            />
            <button
              type="button"
              class="suites__item"
              :class="{ 'is-active': suite.id === suiteId }"
              :aria-label="suite.name"
              @click="selectSuite(suite.id)"
            >
              <span class="suites__item-name">{{ suite.name }}</span>
              <span class="suites__item-count">{{ suite.caseCount }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="suites__empty">
          {{ suites.length === 0 ? "还没有套件，先同步用例。" : "没有匹配的套件。" }}
        </p>
      </aside>

      <div class="suites__detail">
        <div class="suites__detail-header">
          <div>
            <h2>{{ selectedSuite?.name ?? "未选择套件" }}</h2>
            <p v-if="selectedSuite !== null" class="suites__path">
              {{ selectedSuite.path }}
            </p>
          </div>
          <div class="suites__run-actions">
            <select v-model="environmentId" class="suites__select">
              <option
                v-for="environment in environments"
                :key="environment.id"
                :value="environment.id"
              >
                {{ environment.name }}
              </option>
            </select>
            <ElButton
              :disabled="selectedSuite === null || environmentId === ''"
              @click="scheduleSelected"
            >
              定时执行
            </ElButton>
            <ElButton
              type="primary"
              :loading="starting"
              :disabled="selectedIds.length === 0 || environmentId === ''"
              @click="runSelected"
            >
              执行所选（{{ selectedIds.length }}）
            </ElButton>
          </div>
        </div>

        <div class="suites__tabs">
          <button
            type="button"
            class="suites__tab"
            :class="{ 'is-active': tab === 'overview' }"
            @click="tab = 'overview'"
          >
            概览
          </button>
          <button
            type="button"
            class="suites__tab"
            :class="{ 'is-active': tab === 'cases' }"
            @click="tab = 'cases'"
          >
            用例（{{ selectedSuite?.caseCount ?? 0 }}）
          </button>
          <button
            type="button"
            class="suites__tab"
            :class="{ 'is-active': tab === 'runs' }"
            @click="tab = 'runs'"
          >
            执行记录
          </button>
        </div>

        <div v-if="tab === 'overview'" class="suites__panel">
          <section class="suites__latest">
            <h3>最近一次执行结果</h3>
            <p v-if="latestRun === null" class="suites__empty">这个套件还没有执行记录。</p>
            <div v-else class="suites__latest-body">
              <span class="suites__run-id">
                #{{ latestRun.id.slice(0, 8) }} ·
                {{ formatTime(latestRun.startedAt ?? latestRun.createdAt) }}
              </span>
              <ElTag :type="statusTypes[latestRun.status] ?? 'info'">
                {{ statusLabels[latestRun.status] ?? latestRun.status }}
              </ElTag>
              <span class="suites__stat">
                <strong>{{ latestRun.totalCount }}</strong> 总用例
              </span>
              <span class="suites__stat is-passed">
                <strong>{{ latestRun.passedCount }}</strong> 通过
              </span>
              <span class="suites__stat is-failed">
                <strong>{{ latestRun.failedCount }}</strong> 失败
              </span>
              <span class="suites__stat">
                <strong>{{ latestRun.skippedCount }}</strong> 跳过
              </span>
              <ElButton @click="openRun(latestRun)">查看报告</ElButton>
            </div>
          </section>
        </div>

        <div v-else-if="tab === 'cases'" class="suites__panel">
          <div class="suites__cases-toolbar">
            <span class="suites__stat">
              已选用例 <strong>{{ selectedCaseIds.length }}</strong>
            </span>
            <ElButton :disabled="selectedCaseIds.length === 0" @click="selectedCaseIds = []">
              清空
            </ElButton>
            <ElButton
              type="primary"
              :loading="starting"
              :disabled="selectedCaseIds.length === 0 || environmentId === ''"
              @click="runSelectedCases"
            >
              执行所选用例
            </ElButton>
          </div>
          <CaseTree
            v-if="selectedSuite !== null"
            v-model="selectedCaseIds"
            :suite-id="selectedSuite.id"
            :disabled="starting"
          />
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
  </div>
</template>

<style scoped>
.suites {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.suites__error {
  flex: none;
  margin-bottom: 16px;
}

.suites__body {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

.suites__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.suites__list h2 {
  margin: 0;
  font-size: 15px;
}

.suites__selection {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.suites__link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--el-color-primary);
  font-size: 12px;
  cursor: pointer;
}

.suites__items {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.suites__item-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.suites__item-row .el-checkbox {
  flex: none;
  height: auto;
}

.suites__item {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-primary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.suites__item:hover {
  background: var(--el-fill-color-light);
}

.suites__item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.suites__detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

.suites__detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.suites__detail-header h2 {
  margin: 0;
  font-size: 18px;
}

.suites__path {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

.suites__run-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.suites__select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
}

.suites__tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.suites__tab {
  padding: 8px 0;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 14px;
  cursor: pointer;
}

.suites__tab.is-active {
  border-bottom-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: 600;
}

.suites__panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.suites__item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suites__item-count {
  flex: none;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.suites__cases-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.suites__cases-toolbar .el-button:first-of-type {
  margin-left: auto;
}

.suites__latest {
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.suites__latest h3 {
  margin: 0 0 12px;
  font-size: 15px;
}

.suites__latest-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
}

.suites__run-id {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.suites__stat {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.suites__stat strong {
  margin-right: 4px;
  color: var(--el-text-color-primary);
  font-size: 18px;
}

.suites__stat.is-passed strong {
  color: var(--el-color-success);
}

.suites__stat.is-failed strong {
  color: var(--el-color-danger);
}

.suites__empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
