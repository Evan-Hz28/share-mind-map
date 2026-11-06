<script setup lang="ts">
import {
  createApiTestCollection,
  deleteApiTestCollection,
  getApiTestCollection,
  listApiTestCollectionExecutions,
  listApiTestCollections,
  runApiTestCollection,
  setApiTestCollectionSuites,
  updateApiTestCollection,
  type ApiTestCollectionDetailResponseDto,
  type ApiTestCollectionExecutionResponseDto,
  type ApiTestCollectionResponseDto,
  type ApiTestCollectionSuiteResponseDto,
  type ApiTestEnvironmentResponseDto,
  type ApiTestSuiteResponseDto,
} from "@share-mind-map/api-client";
import {
  ElButton,
  ElCheckbox,
  ElDialog,
  ElInput,
  ElTable,
  ElTableColumn,
  ElTag,
} from "element-plus";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";

const props = defineProps<{
  suites: ApiTestSuiteResponseDto[];
  environments: ApiTestEnvironmentResponseDto[];
}>();

const environmentId = defineModel<string>("environmentId", { default: "" });

const router = useRouter();

const collections = ref<ApiTestCollectionResponseDto[]>([]);
const selectedId = ref("");
const detail = ref<ApiTestCollectionDetailResponseDto | null>(null);
const executions = ref<ApiTestCollectionExecutionResponseDto[]>([]);
const detailTab = ref<"suites" | "executions">("suites");
const keyword = ref("");
const loading = ref(true);
const busy = ref(false);
const error = ref<RequestFailure | null>(null);
// 成员表里勾选的行，用来批量移出集合。
const checkedSuites = ref<string[]>([]);
let poll: ReturnType<typeof setInterval> | null = null;

const dialog = ref<{
  open: boolean;
  mode: "create" | "edit" | "suites";
  name: string;
  description: string;
  suiteIds: string[];
}>({ open: false, mode: "create", name: "", description: "", suiteIds: [] });

const dialogTitle = computed(() => {
  if (dialog.value.mode === "create") return "新建测试集合";
  if (dialog.value.mode === "edit") return "编辑测试集合";
  return "添加测试集";
});

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

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (text === "") return collections.value;
  return collections.value.filter((item) => item.name.toLowerCase().includes(text));
});

async function loadCollections(): Promise<void> {
  const result = await listApiTestCollections({ client: apiClient });
  if (result.data === undefined) {
    error.value = toApiFailure(result.error);
    return;
  }
  collections.value = result.data.collections;
  // 同步可能导致集合消失；选中的不在了就退回第一个。
  if (!collections.value.some((item) => item.id === selectedId.value)) {
    selectedId.value = collections.value[0]?.id ?? "";
  }
}

async function loadDetail(): Promise<void> {
  if (selectedId.value === "") {
    detail.value = null;
    executions.value = [];
    return;
  }
  const requestedId = selectedId.value;
  const [detailResult, executionResult] = await Promise.all([
    getApiTestCollection({ client: apiClient, path: { collectionId: requestedId } }),
    listApiTestCollectionExecutions({
      client: apiClient,
      path: { collectionId: requestedId },
      query: { limit: "20" },
    }),
  ]);
  if (requestedId !== selectedId.value) return;
  if (detailResult.data === undefined) {
    error.value = toApiFailure(detailResult.error);
    return;
  }
  if (executionResult.data === undefined) {
    error.value = toApiFailure(executionResult.error);
    return;
  }
  detail.value = detailResult.data;
  executions.value = executionResult.data.executions;
  checkedSuites.value = [];
}

function openCreate(): void {
  dialog.value = { open: true, mode: "create", name: "", description: "", suiteIds: [] };
}

function openEdit(): void {
  if (detail.value === null) return;
  dialog.value = {
    open: true,
    mode: "edit",
    name: detail.value.name,
    description: detail.value.description,
    suiteIds: detail.value.suites.map((suite) => suite.suiteId),
  };
}

function openAddSuites(): void {
  if (detail.value === null) return;
  dialog.value = {
    open: true,
    mode: "suites",
    name: detail.value.name,
    description: detail.value.description,
    suiteIds: detail.value.suites.map((suite) => suite.suiteId),
  };
}

function toggleDialogSuite(id: string, checked: boolean): void {
  const next = new Set(dialog.value.suiteIds);
  if (checked) next.add(id);
  else next.delete(id);
  dialog.value.suiteIds = [...next];
}

async function saveDialog(): Promise<void> {
  const { mode, name, description, suiteIds } = dialog.value;
  busy.value = true;
  error.value = null;
  try {
    if (mode === "create") {
      const result = await createApiTestCollection({
        client: apiClient,
        body: { name, description, suiteIds },
      });
      if (result.data === undefined) {
        error.value = toApiFailure(result.error);
        return;
      }
      await loadCollections();
      selectedId.value = result.data.id;
    } else if (mode === "edit") {
      const result = await updateApiTestCollection({
        client: apiClient,
        path: { collectionId: selectedId.value },
        body: { name, description },
      });
      if (result.data === undefined) {
        error.value = toApiFailure(result.error);
        return;
      }
      await loadCollections();
    } else {
      const result = await setApiTestCollectionSuites({
        client: apiClient,
        path: { collectionId: selectedId.value },
        body: { suiteIds },
      });
      if (result.data === undefined) {
        error.value = toApiFailure(result.error);
        return;
      }
      await loadCollections();
    }
    await loadDetail();
    dialog.value = { ...dialog.value, open: false };
  } finally {
    busy.value = false;
  }
}

async function removeCollection(): Promise<void> {
  if (detail.value === null) return;
  if (!window.confirm(`确定删除测试集合「${detail.value.name}」？执行历史会保留。`)) return;
  busy.value = true;
  error.value = null;
  try {
    const result = await deleteApiTestCollection({
      client: apiClient,
      path: { collectionId: selectedId.value },
    });
    if (result.error !== undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    selectedId.value = "";
    detail.value = null;
    await loadCollections();
    await loadDetail();
  } finally {
    busy.value = false;
  }
}

async function removeCheckedSuites(): Promise<void> {
  if (detail.value === null || checkedSuites.value.length === 0) return;
  const remaining = detail.value.suites
    .map((suite) => suite.suiteId)
    .filter((id) => !checkedSuites.value.includes(id));
  busy.value = true;
  error.value = null;
  try {
    const result = await setApiTestCollectionSuites({
      client: apiClient,
      path: { collectionId: selectedId.value },
      body: { suiteIds: remaining },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    await loadCollections();
    await loadDetail();
  } finally {
    busy.value = false;
  }
}

async function execute(): Promise<void> {
  if (selectedId.value === "" || environmentId.value === "") return;
  busy.value = true;
  error.value = null;
  try {
    const result = await runApiTestCollection({
      client: apiClient,
      path: { collectionId: selectedId.value },
      body: { environmentId: environmentId.value },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    await router.push({ name: "api-test-batch", params: { batchId: result.data.batchId } });
  } finally {
    busy.value = false;
  }
}

function toggleCheckedSuite(id: string, checked: boolean): void {
  const next = new Set(checkedSuites.value);
  if (checked) next.add(id);
  else next.delete(id);
  checkedSuites.value = [...next];
}

function openRun(run: unknown): void {
  const latest = (run as ApiTestCollectionSuiteResponseDto).lastRunId;
  if (latest === null) return;
  void router.push({ name: "api-test-run", params: { runId: latest } });
}

function openExecution(execution: unknown): void {
  const batchId = (execution as ApiTestCollectionExecutionResponseDto).batchId;
  void router.push({ name: "api-test-batch", params: { batchId } });
}

function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Date(value).toLocaleString();
}

watch(selectedId, () => {
  void loadDetail().catch(() => undefined);
});

// 同步会改套件集合，集合的用例数也跟着变，重新拉一遍。
watch(
  () => props.suites,
  () => {
    void loadCollections().catch(() => undefined);
  },
);

onMounted(async () => {
  loading.value = true;
  try {
    await loadCollections();
    await loadDetail();
  } finally {
    loading.value = false;
  }
  poll = setInterval(() => {
    const running = executions.value.some((item) => item.status === "running");
    if (running) void loadDetail().catch(() => undefined);
  }, 2000);
});

onUnmounted(() => {
  if (poll !== null) clearInterval(poll);
});

defineExpose({ openCreate });
</script>

<template>
  <div class="collections">
    <aside class="collections__list">
      <h2>测试集合（{{ collections.length }}）</h2>
      <ElInput v-model="keyword" placeholder="搜索测试集合" clearable />
      <ul v-if="filtered.length > 0" class="collections__items">
        <li v-for="item in filtered" :key="item.id">
          <button
            type="button"
            class="collections__item"
            :class="{ 'is-active': item.id === selectedId }"
            @click="selectedId = item.id"
          >
            <span class="collections__item-name">{{ item.name }}</span>
            <span class="collections__item-desc">{{ item.description || "—" }}</span>
            <span class="collections__item-count">{{ item.suiteCount }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="collections__empty">
        {{ collections.length === 0 ? "还没有测试集合，点右上角新建。" : "没有匹配的集合。" }}
      </p>
    </aside>

    <div class="collections__detail">
      <RequestErrorAlert :error="error" class="collections__error" />

      <p v-if="loading" class="collections__empty">加载中…</p>
      <p v-else-if="detail === null" class="collections__empty">先在左侧选择一个测试集合。</p>

      <template v-else>
        <header class="collections__header">
          <div class="collections__title">
            <h2>{{ detail.name }}</h2>
            <p>{{ detail.description || "暂无描述" }}</p>
          </div>
          <div class="collections__actions">
            <select v-model="environmentId" class="collections__select">
              <option
                v-for="environment in environments"
                :key="environment.id"
                :value="environment.id"
              >
                {{ environment.name }}
              </option>
            </select>
            <ElButton :disabled="busy" @click="openEdit">编辑</ElButton>
            <ElButton :disabled="busy" @click="removeCollection">删除</ElButton>
            <ElButton
              type="primary"
              :loading="busy"
              :disabled="environmentId === '' || detail.suiteCount === 0"
              @click="execute"
            >
              执行集合
            </ElButton>
          </div>
        </header>

        <p class="collections__stats">
          包含测试集 {{ detail.suiteCount }} ·
          总用例数 {{ detail.caseCount }} ·
          最后更新 {{ formatTime(detail.updatedAt) }}
        </p>

        <div class="collections__tabs">
          <button
            type="button"
            class="collections__tab"
            :class="{ 'is-active': detailTab === 'suites' }"
            @click="detailTab = 'suites'"
          >
            测试集列表（{{ detail.suiteCount }}）
          </button>
          <button
            type="button"
            class="collections__tab"
            :class="{ 'is-active': detailTab === 'executions' }"
            @click="detailTab = 'executions'"
          >
            执行记录
          </button>
        </div>

        <div v-if="detailTab === 'suites'">
          <div class="collections__toolbar">
            <span class="collections__hint">已选 {{ checkedSuites.length }}</span>
            <ElButton
              v-if="checkedSuites.length > 0"
              :disabled="busy"
              @click="removeCheckedSuites"
            >
              移除所选
            </ElButton>
            <ElButton :disabled="busy" @click="openAddSuites">添加测试集</ElButton>
          </div>

          <ElTable
            :data="detail.suites"
            row-key="suiteId"
            empty-text="这个集合还没有测试集"
          >
            <ElTableColumn width="48">
              <template #default="{ row }">
                <input
                  type="checkbox"
                  :checked="checkedSuites.includes(row.suiteId)"
                  @change="
                    toggleCheckedSuite(row.suiteId, ($event.target as HTMLInputElement).checked)
                  "
                />
              </template>
            </ElTableColumn>
            <ElTableColumn label="测试集名称" min-width="220">
              <template #default="{ row }">
                <div class="collections__suite-name">
                  {{ row.name }}
                  <ElTag v-if="!row.enabled" type="info">已停用</ElTag>
                </div>
                <div class="collections__path">{{ row.path }}</div>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="totalCount" label="用例数" width="90" />
            <ElTableColumn label="最近执行结果" width="140">
              <template #default="{ row }">
                <template v-if="row.lastRunStatus === null">-</template>
                <template v-else>
                  <ElTag :type="statusTypes[row.lastRunStatus] ?? 'info'">
                    {{ statusLabels[row.lastRunStatus] ?? row.lastRunStatus }}
                  </ElTag>
                  <span class="collections__result">
                    {{ row.passedCount }} / {{ row.failedCount }} / {{ row.skippedCount }}
                  </span>
                </template>
              </template>
            </ElTableColumn>
            <ElTableColumn label="最近执行时间" min-width="170">
              <template #default="{ row }">{{ formatTime(row.lastRunAt) }}</template>
            </ElTableColumn>
            <ElTableColumn label="操作" width="170">
              <template #default="{ row }">
                <ElButton
                  link
                  type="primary"
                  :disabled="environmentId === ''"
                  @click="execute"
                >
                  执行
                </ElButton>
                <ElButton
                  link
                  type="primary"
                  :disabled="row.lastRunId === null"
                  @click="openRun(row)"
                >
                  查看报告
                </ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>

        <ElTable
          v-else
          :data="executions"
          row-key="batchId"
          empty-text="还没有执行记录"
          @row-click="openExecution"
        >
          <ElTableColumn label="执行 ID" width="120">
            <template #default="{ row }">{{ row.batchId.slice(0, 8) }}</template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="110">
            <template #default="{ row }">
              <ElTag :type="statusTypes[row.status] ?? 'info'">
                {{ statusLabels[row.status] ?? row.status }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="结果" min-width="200">
            <template #default="{ row }">
              {{ row.passedCount }} 通过 / {{ row.failedCount }} 失败 /
              {{ row.skippedCount }} 跳过
            </template>
          </ElTableColumn>
          <ElTableColumn prop="suiteCount" label="套件数" width="90" />
          <ElTableColumn label="开始时间" min-width="170">
            <template #default="{ row }">{{ formatTime(row.startedAt ?? row.createdAt) }}</template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="100">
            <template #default="{ row }">
              <ElButton link type="primary" @click.stop="openExecution(row)">查看</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </template>
    </div>

    <ElDialog v-model="dialog.open" :title="dialogTitle" width="560px">
      <div class="collections__dialog">
        <label class="collections__label">名称</label>
        <ElInput v-model="dialog.name" maxlength="100" placeholder="例如：核心接口回归" />

        <template v-if="dialog.mode !== 'suites'">
          <label class="collections__label">描述</label>
          <ElInput
            v-model="dialog.description"
            type="textarea"
            :rows="2"
            maxlength="500"
            placeholder="这个集合用来做什么"
          />
        </template>

        <label class="collections__label">测试集（已选 {{ dialog.suiteIds.length }}）</label>
        <ul class="collections__picker">
          <li v-for="suite in suites" :key="suite.id">
            <label class="collections__pick">
              <ElCheckbox
                :model-value="dialog.suiteIds.includes(suite.id)"
                @update:model-value="(checked) => toggleDialogSuite(suite.id, checked === true)"
              />
              <span>{{ suite.name }}</span>
              <span class="collections__path">{{ suite.path }}</span>
            </label>
          </li>
        </ul>
      </div>

      <template #footer>
        <ElButton @click="dialog.open = false">取消</ElButton>
        <ElButton
          type="primary"
          :loading="busy"
          :disabled="dialog.name.trim() === ''"
          @click="saveDialog"
        >
          保存
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.collections {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
}

.collections__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.collections__list h2 {
  margin: 0;
  font-size: 15px;
}

.collections__items {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.collections__item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
}

.collections__item:hover {
  background: var(--el-fill-color-light);
}

.collections__item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.collections__item-name {
  font-size: 14px;
  font-weight: 600;
}

.collections__item-desc {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collections__item-count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.collections__detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.collections__error {
  margin-bottom: 4px;
}

.collections__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.collections__title h2 {
  margin: 0;
  font-size: 18px;
}

.collections__title p {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.collections__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.collections__select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
}

.collections__stats {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.collections__tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.collections__tab {
  padding: 8px 0;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 14px;
  cursor: pointer;
}

.collections__tab.is-active {
  border-bottom-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: 600;
}

.collections__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.collections__hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.collections__toolbar .el-button + .el-button,
.collections__toolbar .el-button:first-of-type {
  margin-left: auto;
}

.collections__suite-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.collections__path {
  color: var(--el-text-color-secondary);
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

.collections__result {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.collections__empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.collections__dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.collections__label {
  margin-top: 8px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.collections__picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  list-style: none;
}

.collections__pick {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
</style>
