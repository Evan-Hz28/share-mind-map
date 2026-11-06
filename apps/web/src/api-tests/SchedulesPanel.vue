<script setup lang="ts">
import {
  deleteApiTestSchedule,
  listApiTestCollections,
  listApiTestSchedules,
  runApiTestScheduleNow,
  setApiTestScheduleEnabled,
  type ApiTestCollectionResponseDto,
  type ApiTestEnvironmentResponseDto,
  type ApiTestScheduleResponseDto,
  type ApiTestSuiteResponseDto,
} from "@share-mind-map/api-client";
import { ElButton, ElSwitch, ElTable, ElTableColumn, ElTag } from "element-plus";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import ScheduleDialog from "./ScheduleDialog.vue";

defineProps<{
  suites: ApiTestSuiteResponseDto[];
  environments: ApiTestEnvironmentResponseDto[];
}>();

const router = useRouter();

const schedules = ref<ApiTestScheduleResponseDto[]>([]);
const collections = ref<ApiTestCollectionResponseDto[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref<RequestFailure | null>(null);
const dialogRef = ref<InstanceType<typeof ScheduleDialog> | null>(null);

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

function targetLabel(schedule: ApiTestScheduleResponseDto): string {
  return schedule.targetType === "suite" ? "测试集" : "集合";
}

async function loadSchedules(): Promise<void> {
  const result = await listApiTestSchedules({ client: apiClient });
  if (result.data === undefined) {
    error.value = toApiFailure(result.error);
    return;
  }
  schedules.value = result.data.schedules;
}

async function loadCollections(): Promise<void> {
  const result = await listApiTestCollections({ client: apiClient });
  if (result.data === undefined) {
    error.value = toApiFailure(result.error);
    return;
  }
  collections.value = result.data.collections;
}

async function reload(): Promise<void> {
  try {
    await loadSchedules();
  } catch {
    // 网络异常由 apiClient 统一记录，这里只保证 finally 能收尾。
  }
}

async function toggleEnabled(schedule: ApiTestScheduleResponseDto, enabled: boolean): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const result = await setApiTestScheduleEnabled({
      client: apiClient,
      path: { scheduleId: schedule.id },
      body: { enabled },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      // 写失败时把开关拨回去，别让人以为已经改了。
      await reload();
      return;
    }
    await reload();
  } finally {
    busy.value = false;
  }
}

async function runNow(schedule: ApiTestScheduleResponseDto): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const result = await runApiTestScheduleNow({
      client: apiClient,
      path: { scheduleId: schedule.id },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    await reload();
    await router.push({ name: "api-test-batch", params: { batchId: result.data.batchId } });
  } finally {
    busy.value = false;
  }
}

async function remove(schedule: ApiTestScheduleResponseDto): Promise<void> {
  if (!window.confirm(`确定删除定时任务「${schedule.name}」？已产生的执行记录会保留。`)) return;
  busy.value = true;
  error.value = null;
  try {
    const result = await deleteApiTestSchedule({
      client: apiClient,
      path: { scheduleId: schedule.id },
    });
    if (result.error !== undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    await reload();
  } finally {
    busy.value = false;
  }
}

function openBatch(schedule: ApiTestScheduleResponseDto): void {
  if (schedule.lastBatchId === null || schedule.lastBatchId === undefined) return;
  void router.push({ name: "api-test-batch", params: { batchId: schedule.lastBatchId } });
}

function openCreate(initial?: {
  targetType?: "suite" | "collection";
  targetId?: string;
  environmentId?: string;
}): void {
  dialogRef.value?.openCreate(initial);
}

function formatTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Date(value).toLocaleString();
}

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([loadSchedules(), loadCollections()]);
  } finally {
    loading.value = false;
  }
});

defineExpose({ openCreate, reload });
</script>

<template>
  <div class="schedules">
    <RequestErrorAlert :error="error" class="schedules__error" />

    <p v-if="loading" class="schedules__empty">加载中…</p>

    <ElTable
      v-else
      :data="schedules"
      row-key="id"
      empty-text="还没有定时任务，点右上角新建。"
    >
      <ElTableColumn label="名称" min-width="200">
        <template #default="{ row }">
          <div class="schedules__name">{{ row.name }}</div>
          <div v-if="row.lastError" class="schedules__error-note">{{ row.lastError }}</div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="执行目标" min-width="220">
        <template #default="{ row }">
          <div class="schedules__target">
            <ElTag size="small" type="info">
              {{ targetLabel(row as ApiTestScheduleResponseDto) }}
            </ElTag>
            <span>{{ row.targetName ?? "目标已删除" }}</span>
          </div>
          <div class="schedules__path">{{ row.targetPath ?? "-" }}</div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="环境" min-width="120">
        <template #default="{ row }">{{ row.environmentName ?? "-" }}</template>
      </ElTableColumn>
      <ElTableColumn label="周期" min-width="160">
        <template #default="{ row }">
          <code class="schedules__cron">{{ row.cron }}</code>
          <div class="schedules__path">{{ row.timezone }}</div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="下次执行" min-width="170">
        <template #default="{ row }">
          {{ row.enabled ? formatTime(row.nextRunAt) : "已停用" }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="上次结果" min-width="200">
        <template #default="{ row }">
          <template v-if="row.lastRunStatus === null || row.lastRunStatus === undefined">
            <span class="schedules__path">还没执行过</span>
          </template>
          <template v-else>
            <ElTag :type="statusTypes[row.lastRunStatus] ?? 'info'">
              {{ statusLabels[row.lastRunStatus] ?? row.lastRunStatus }}
            </ElTag>
            <span class="schedules__result">
              {{ row.lastPassedCount }} 通过 / {{ row.lastFailedCount }} 失败 /
              {{ row.lastSkippedCount }} 跳过
            </span>
            <div class="schedules__path">{{ formatTime(row.lastRunAt) }}</div>
          </template>
        </template>
      </ElTableColumn>
      <ElTableColumn label="启用" width="80">
        <template #default="{ row }">
          <ElSwitch
            :model-value="row.enabled"
            :disabled="busy"
            @update:model-value="
              (value) => toggleEnabled(row as ApiTestScheduleResponseDto, value === true)
            "
          />
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="190">
        <template #default="{ row }">
          <ElButton
            link
            type="primary"
            :disabled="busy"
            @click="runNow(row as ApiTestScheduleResponseDto)"
          >
            立即执行
          </ElButton>
          <ElButton
            link
            type="primary"
            :disabled="busy"
            @click="dialogRef?.openEdit(row as ApiTestScheduleResponseDto)"
          >
            编辑
          </ElButton>
          <ElButton
            link
            type="primary"
            :disabled="busy || !row.lastBatchId"
            @click="openBatch(row as ApiTestScheduleResponseDto)"
          >
            报告
          </ElButton>
          <ElButton
            link
            type="danger"
            :disabled="busy"
            @click="remove(row as ApiTestScheduleResponseDto)"
          >
            删除
          </ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ScheduleDialog ref="dialogRef" :suites="suites" :collections="collections" :environments="environments" @saved="reload" />
  </div>
</template>

<style scoped>
.schedules {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.schedules__error {
  margin-bottom: 4px;
}

.schedules__empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.schedules__name {
  font-weight: 600;
}

.schedules__error-note {
  margin-top: 2px;
  color: var(--el-color-danger);
  font-size: 12px;
}

.schedules__target {
  display: flex;
  align-items: center;
  gap: 8px;
}

.schedules__path {
  color: var(--el-text-color-secondary);
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

.schedules__cron {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

.schedules__result {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
