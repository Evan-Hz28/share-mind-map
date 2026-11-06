<script setup lang="ts">
import {
  listApiTestEnvironments,
  listApiTestSuites,
  listApiTestSyncs,
  syncApiTestRepository,
  type ApiTestEnvironmentResponseDto,
  type ApiTestSuiteResponseDto,
  type ApiTestSyncResponseDto,
} from "@share-mind-map/api-client";
import { ElButton, ElPopover, ElTooltip } from "element-plus";
import { computed, onMounted, onUnmounted, ref } from "vue";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import CollectionsPanel from "./CollectionsPanel.vue";
import SchedulesPanel from "./SchedulesPanel.vue";
import SuitesPanel from "./SuitesPanel.vue";

const suites = ref<ApiTestSuiteResponseDto[]>([]);
const environments = ref<ApiTestEnvironmentResponseDto[]>([]);
const lastSync = ref<ApiTestSyncResponseDto | null>(null);
const syncing = ref(false);
const environmentId = ref("");
const tab = ref<"collections" | "suites" | "schedules">("suites");
const loading = ref(true);
const error = ref<RequestFailure | null>(null);
const collectionsRef = ref<InstanceType<typeof CollectionsPanel> | null>(null);
const schedulesRef = ref<InstanceType<typeof SchedulesPanel> | null>(null);
const now = ref(Date.now());
let poll: ReturnType<typeof setInterval> | null = null;
let clock: ReturnType<typeof setInterval> | null = null;

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
  // 环境是用户主动选的，还在就保留；只有失效时才退回第一个。
  if (!environments.value.some((item) => item.id === environmentId.value)) {
    environmentId.value = environments.value[0]?.id ?? "";
  }
}

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

function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Date(value).toLocaleString();
}

/** 胶囊上只放相对时间，精确时间留给 tooltip。 */
function relativeTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const date = new Date(value);
  const elapsed = now.value - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "刚刚";
  if (elapsed < hour) return `${String(Math.floor(elapsed / minute))} 分钟前`;
  if (elapsed < day) return `${String(Math.floor(elapsed / hour))} 小时前`;
  if (elapsed < 7 * day) return `${String(Math.floor(elapsed / day))} 天前`;
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${String(date.getMonth() + 1)}/${String(date.getDate())} ${time}`;
}

const hasSync = computed(() => lastSync.value !== null);
const syncFailed = computed(() => lastSync.value?.status === "failed");
const syncActive = computed(() => syncRunning(lastSync.value));
const syncMessage = computed(() => lastSync.value?.message ?? "");

const syncChipLabel = computed(() => {
  const sync = lastSync.value;
  if (sync === null) return "";
  if (sync.status === "queued") return "排队中…";
  if (sync.status === "running") return "同步中…";
  if (sync.status === "failed") return "同步失败";
  return `已同步 · ${relativeTime(sync.finishedAt ?? sync.createdAt)}`;
});

/** tooltip / 失败弹层里的明细；套件增删为 0 时不占字数。 */
const syncDetail = computed(() => {
  const sync = lastSync.value;
  if (sync === null) return "";
  const parts = [shortSha(sync.commitSha), formatTime(sync.finishedAt ?? sync.createdAt)];
  if (sync.suitesAdded !== 0 || sync.suitesRemoved !== 0) {
    parts.push(`套件 +${String(sync.suitesAdded)} / -${String(sync.suitesRemoved)}`);
  }
  if (sync.casesAdded !== 0 || sync.casesRemoved !== 0) {
    parts.push(`用例 +${String(sync.casesAdded)} / -${String(sync.casesRemoved)}`);
  }
  return parts.join(" · ");
});

function createCollection(): void {
  tab.value = "collections";
  // 面板是 v-if 挂载的，切过去之后组件才存在，等下一拍再调。
  requestAnimationFrame(() => {
    collectionsRef.value?.openCreate();
  });
}

function createSchedule(initial?: {
  targetType?: "suite" | "collection";
  targetId?: string;
  environmentId?: string;
}): void {
  tab.value = "schedules";
  requestAnimationFrame(() => {
    schedulesRef.value?.openCreate(initial);
  });
}

onMounted(async () => {
  error.value = null;
  try {
    await Promise.all([loadOptions(), loadSyncs()]);
  } finally {
    loading.value = false;
  }
  poll = setInterval(() => {
    if (syncRunning(lastSync.value)) {
      void loadSyncs()
        .then(() => {
          // 同步结束后套件列表可能变化，刷新一次共享数据。
          if (!syncRunning(lastSync.value)) return loadOptions();
          return undefined;
        })
        .catch(() => undefined);
    }
  }, 2000);
  // 相对时间每分钟重算一次，长时间挂着页面也不会停在「刚刚」。
  clock = setInterval(() => {
    now.value = Date.now();
  }, 60_000);
});

onUnmounted(() => {
  if (poll !== null) clearInterval(poll);
  if (clock !== null) clearInterval(clock);
});
</script>

<template>
  <section class="api-tests" :class="{ 'api-tests--fit': tab === 'suites' }">
    <header class="api-tests__header">
      <div>
        <h1>接口测试</h1>
        <p>管理测试套件，执行接口自动化测试</p>
      </div>
      <div class="api-tests__header-actions">
        <ElPopover v-if="syncFailed" placement="bottom-end" trigger="click" width="360">
          <template #reference>
            <button type="button" class="api-tests__sync-chip is-failed">
              <span class="api-tests__sync-dot" />
              {{ syncChipLabel }}
            </button>
          </template>
          <div class="api-tests__sync-detail">
            <p v-if="syncMessage" class="api-tests__sync-message">{{ syncMessage }}</p>
            <p class="api-tests__sync-meta">{{ syncDetail }}</p>
          </div>
        </ElPopover>
        <ElTooltip v-else-if="hasSync" placement="bottom-end" :content="syncDetail">
          <span class="api-tests__sync-chip" :class="{ 'is-running': syncActive }">
            <span class="api-tests__sync-dot" />
            {{ syncChipLabel }}
          </span>
        </ElTooltip>
        <ElButton
          :loading="syncing || syncRunning(lastSync)"
          :disabled="syncRunning(lastSync)"
          @click="syncRepository"
        >
          同步用例
        </ElButton>
        <ElButton v-if="tab === 'collections'" type="primary" @click="createCollection">
          新建测试集合
        </ElButton>
        <ElButton v-if="tab === 'schedules'" type="primary" @click="createSchedule()">
          新建定时任务
        </ElButton>
      </div>
    </header>

    <RequestErrorAlert :error="error" class="api-tests__error" />

    <p v-if="loading" class="api-tests__loading">加载中…</p>

    <template v-else>
      <div class="api-tests__tabs">
        <button
          type="button"
          class="api-tests__tab"
          :class="{ 'is-active': tab === 'suites' }"
          @click="tab = 'suites'"
        >
          测试集（{{ suites.length }}）
        </button>
        <button
          type="button"
          class="api-tests__tab"
          :class="{ 'is-active': tab === 'collections' }"
          @click="tab = 'collections'"
        >
          测试集合
        </button>
        <button
          type="button"
          class="api-tests__tab"
          :class="{ 'is-active': tab === 'schedules' }"
          @click="tab = 'schedules'"
        >
          定时任务
        </button>
      </div>

      <div class="api-tests__body">
        <SuitesPanel
          v-if="tab === 'suites'"
          v-model:environment-id="environmentId"
          :suites="suites"
          :environments="environments"
          @schedule-suite="createSchedule"
        />
        <CollectionsPanel
          v-else-if="tab === 'collections'"
          ref="collectionsRef"
          v-model:environment-id="environmentId"
          :suites="suites"
          :environments="environments"
        />
        <SchedulesPanel v-else ref="schedulesRef" :suites="suites" :environments="environments" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.api-tests {
  padding: 24px;
}

/* 测试集视图固定成一屏：标题/tab 不动，左右两栏各自滚动。 */
.api-tests--fit {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--app-topbar-height) - var(--app-tabs-height));
  height: calc(100dvh - var(--app-topbar-height) - var(--app-tabs-height));
  overflow: hidden;
}

.api-tests--fit .api-tests__body {
  flex: 1 1 auto;
  min-height: 0;
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

.api-tests__header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.api-tests__error {
  margin: 16px 0;
}

.api-tests__sync-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  cursor: default;
}

button.api-tests__sync-chip {
  cursor: pointer;
}

.api-tests__sync-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-text-color-placeholder);
}

.api-tests__sync-chip.is-running .api-tests__sync-dot {
  background: var(--el-color-primary);
}

.api-tests__sync-chip.is-failed {
  color: var(--el-color-danger);
}

.api-tests__sync-chip.is-failed .api-tests__sync-dot {
  background: var(--el-color-danger);
}

.api-tests__sync-detail {
  font-size: 13px;
}

.api-tests__sync-detail p {
  margin: 0;
}

.api-tests__sync-message {
  margin-bottom: 4px !important;
  color: var(--el-color-danger);
}

.api-tests__sync-meta {
  color: var(--el-text-color-secondary);
}

.api-tests__loading {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.api-tests__tabs {
  display: flex;
  gap: 24px;
  margin-top: 16px;
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

.api-tests__body {
  margin-top: 16px;
}
</style>
