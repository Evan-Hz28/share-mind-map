<script setup lang="ts">
import {
  createApiTestSchedule,
  previewApiTestSchedule,
  updateApiTestSchedule,
  type ApiTestCollectionResponseDto,
  type ApiTestEnvironmentResponseDto,
  type ApiTestScheduleResponseDto,
  type ApiTestSuiteResponseDto,
  type CreateApiTestScheduleDto,
} from "@share-mind-map/api-client";
import { ElButton, ElCheckbox, ElDialog, ElInput, ElRadioButton, ElRadioGroup } from "element-plus";
import { computed, ref, watch } from "vue";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";

const props = defineProps<{
  suites: ApiTestSuiteResponseDto[];
  collections: ApiTestCollectionResponseDto[];
  environments: ApiTestEnvironmentResponseDto[];
}>();

const emit = defineEmits<{ saved: [] }>();

const timezones = ["Asia/Shanghai", "Asia/Jakarta", "Asia/Singapore", "UTC"];

/** 常用周期做成快捷项，省得每个人都去写 cron。 */
const presets = [
  { label: "每天 02:00", cron: "0 2 * * *" },
  { label: "每天 09:00", cron: "0 9 * * *" },
  { label: "每周一 09:00", cron: "0 9 * * 1" },
  { label: "每小时整点", cron: "0 * * * *" },
];

const state = ref({
  open: false,
  mode: "create",
  id: "",
  name: "",
  targetType: "collection",
  targetId: "",
  environmentId: "",
  cron: "0 2 * * *",
  timezone: "Asia/Shanghai",
  syncBeforeRun: false,
  enabled: true,
});

const saving = ref(false);
const error = ref<RequestFailure | null>(null);
const preview = ref<{ nextRuns: string[]; error: string | null }>({
  nextRuns: [],
  error: null,
});
// 输入过程中每个字符都请求一次太浪费，停下来再验。
let previewTimer: ReturnType<typeof setTimeout> | null = null;

const targets = computed(() =>
  state.value.targetType === "suite"
    ? props.suites.map((suite) => ({ id: suite.id, name: suite.name, hint: suite.path }))
    : props.collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        hint: `${String(collection.suiteCount)} 个测试集`,
      })),
);

const title = computed(() => (state.value.mode === "create" ? "新建定时任务" : "编辑定时任务"));

const canSubmit = computed(
  () =>
    state.value.name.trim() !== "" &&
    state.value.targetId !== "" &&
    state.value.environmentId !== "" &&
    preview.value.error === null &&
    preview.value.nextRuns.length > 0,
);

function resetError(): void {
  error.value = null;
}

function openCreate(initial?: {
  targetType?: "suite" | "collection";
  targetId?: string;
  environmentId?: string;
}): void {
  const targetType = initial?.targetType ?? "collection";
  state.value = {
    open: true,
    mode: "create",
    id: "",
    name: "",
    targetType,
    targetId: initial?.targetId ?? "",
    environmentId: initial?.environmentId ?? props.environments[0]?.id ?? "",
    cron: "0 2 * * *",
    timezone: "Asia/Shanghai",
    syncBeforeRun: false,
    enabled: true,
  };
  resetError();
}

function openEdit(schedule: ApiTestScheduleResponseDto): void {
  state.value = {
    open: true,
    mode: "edit",
    id: schedule.id,
    name: schedule.name,
    targetType: schedule.targetType === "suite" ? "suite" : "collection",
    targetId: schedule.targetId,
    environmentId: schedule.environmentId,
    cron: schedule.cron,
    timezone: schedule.timezone,
    syncBeforeRun: schedule.syncBeforeRun,
    enabled: schedule.enabled,
  };
  resetError();
}

function pickType(next: unknown): void {
  state.value.targetType = next === "suite" ? "suite" : "collection";
  // 目标类型换了，原来的 id 一定不匹配，直接清空。
  state.value.targetId = "";
}

function applyPreset(cron: string): void {
  state.value.cron = cron;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

async function loadPreview(): Promise<void> {
  const cron = state.value.cron.trim();
  if (cron === "") {
    preview.value = { nextRuns: [], error: null };
    return;
  }
  const result = await previewApiTestSchedule({
    client: apiClient,
    body: { cron, timezone: state.value.timezone },
  });
  if (result.data === undefined) {
    const failure = toApiFailure(result.error);
    // 预览失败只提示表达式问题，不覆盖整个表单的提交入口。
    preview.value = { nextRuns: [], error: failure.message };
    return;
  }
  preview.value = { nextRuns: result.data.nextRuns, error: null };
}

watch(
  () => [state.value.cron, state.value.timezone, state.value.open],
  () => {
    if (!state.value.open) return;
    if (previewTimer !== null) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      void loadPreview().catch(() => undefined);
    }, 400);
  },
);

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  saving.value = true;
  error.value = null;
  const body: CreateApiTestScheduleDto = {
    name: state.value.name.trim(),
    targetType: state.value.targetType === "suite" ? "suite" : "collection",
    targetId: state.value.targetId,
    environmentId: state.value.environmentId,
    cron: state.value.cron.trim(),
    timezone: state.value.timezone,
    syncBeforeRun: state.value.syncBeforeRun,
    enabled: state.value.enabled,
  };
  try {
    const result =
      state.value.mode === "create"
        ? await createApiTestSchedule({ client: apiClient, body })
        : await updateApiTestSchedule({
            client: apiClient,
            path: { scheduleId: state.value.id },
            body,
          });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    state.value.open = false;
    emit("saved");
  } finally {
    saving.value = false;
  }
}

defineExpose({ openCreate, openEdit });
</script>

<template>
  <ElDialog v-model="state.open" :title="title" width="560px" destroy-on-close>
    <div class="schedule-form">
      <RequestErrorAlert :error="error" />

      <label class="schedule-form__field">
        <span class="schedule-form__label">名称</span>
        <ElInput v-model="state.name" placeholder="例如：核心回归每日巡检" maxlength="100" />
      </label>

      <div class="schedule-form__field">
        <span class="schedule-form__label">执行目标</span>
        <ElRadioGroup :model-value="state.targetType" @update:model-value="pickType">
          <ElRadioButton value="collection">测试集合</ElRadioButton>
          <ElRadioButton value="suite">单个测试集</ElRadioButton>
        </ElRadioGroup>
      </div>

      <label class="schedule-form__field">
        <span class="schedule-form__label">
          {{ state.targetType === "suite" ? "测试集" : "测试集合" }}
        </span>
        <select v-model="state.targetId" class="schedule-form__select">
          <option value="" disabled>选择要定时执行的目标</option>
          <option v-for="target in targets" :key="target.id" :value="target.id">
            {{ target.name }}（{{ target.hint }}）
          </option>
        </select>
      </label>

      <label class="schedule-form__field">
        <span class="schedule-form__label">环境</span>
        <select v-model="state.environmentId" class="schedule-form__select">
          <option
            v-for="environment in environments"
            :key="environment.id"
            :value="environment.id"
          >
            {{ environment.name }}
          </option>
        </select>
      </label>

      <div class="schedule-form__field">
        <span class="schedule-form__label">周期</span>
        <div class="schedule-form__presets">
          <button
            v-for="preset in presets"
            :key="preset.cron"
            type="button"
            class="schedule-form__preset"
            :class="{ 'is-active': state.cron === preset.cron }"
            @click="applyPreset(preset.cron)"
          >
            {{ preset.label }}
          </button>
        </div>
        <div class="schedule-form__row">
          <ElInput v-model="state.cron" placeholder="0 2 * * *" class="schedule-form__cron" />
          <select v-model="state.timezone" class="schedule-form__select schedule-form__tz">
            <option v-for="zone in timezones" :key="zone" :value="zone">{{ zone }}</option>
          </select>
        </div>
        <p v-if="preview.error !== null" class="schedule-form__invalid">
          {{ preview.error }}
        </p>
        <p v-else-if="preview.nextRuns.length > 0" class="schedule-form__next">
          接下来三次：
          <span v-for="run in preview.nextRuns" :key="run">{{ formatTime(run) }}</span>
        </p>
        <p v-else class="schedule-form__next">五段 cron，最小间隔 1 分钟。</p>
      </div>

      <div class="schedule-form__checks">
        <ElCheckbox v-model="state.syncBeforeRun">执行前先同步用例仓库</ElCheckbox>
        <ElCheckbox v-model="state.enabled">
          {{ state.mode === "create" ? "创建后立即启用" : "启用" }}
        </ElCheckbox>
      </div>
    </div>

    <template #footer>
      <ElButton @click="state.open = false">取消</ElButton>
      <ElButton type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">
        保存
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.schedule-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.schedule-form__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.schedule-form__label {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.schedule-form__cron {
  width: 100%;
}

.schedule-form__select {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
}

.schedule-form__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.schedule-form__preset {
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 12px;
  cursor: pointer;
}

.schedule-form__preset.is-active {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.schedule-form__row {
  display: flex;
  gap: 8px;
}

.schedule-form__tz {
  flex: none;
  width: 160px;
}

.schedule-form__next {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.schedule-form__invalid {
  margin: 0;
  color: var(--el-color-danger);
  font-size: 12px;
}

.schedule-form__checks {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
