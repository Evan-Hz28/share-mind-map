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
import { ElButton } from "element-plus";
import { onMounted, onUnmounted, ref } from "vue";

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
let poll: ReturnType<typeof setInterval> | null = null;

const syncLabels: Record<string, string> = {
  queued: "排队中",
  running: "同步中",
  succeeded: "已同步",
  failed: "同步失败",
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
});

onUnmounted(() => {
  if (poll !== null) clearInterval(poll);
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
        <SchedulesPanel
          v-else
          ref="schedulesRef"
          :suites="suites"
          :environments="environments"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.api-tests {
  padding: 24px;
}

/* 测试集视图固定成一屏：标题/同步状态/tab 不动，左右两栏各自滚动。 */
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
