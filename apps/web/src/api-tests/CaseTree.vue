<script setup lang="ts">
import {
  listApiTestCases,
  type ApiTestCaseResponseDto,
} from "@share-mind-map/api-client";
import { ArrowDown, ArrowRight } from "@element-plus/icons-vue";
import { ElCheckbox } from "element-plus";
import { computed, ref, watch } from "vue";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";

const props = withDefaults(
  defineProps<{
    suiteId: string;
    /** 已选中的用例 id（文件行和函数行都算）。 */
    modelValue: string[];
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
  /** 加载完成时回传，父组件据此知道哪些用例属于这个测试集。 */
  loaded: [cases: ApiTestCaseResponseDto[]];
}>();

interface FileGroup {
  filePath: string;
  file: ApiTestCaseResponseDto | null;
  cases: ApiTestCaseResponseDto[];
}

const cases = ref<ApiTestCaseResponseDto[]>([]);
const loading = ref(false);
const error = ref<RequestFailure | null>(null);
let requestId = 0;

/** 接口按 file_path / ordinal 返回，这里保持顺序并补上文件行。 */
const groups = computed<FileGroup[]>(() => {
  const result: FileGroup[] = [];
  let current: FileGroup | null = null;
  for (const item of cases.value) {
    if (current === null || current.filePath !== item.filePath) {
      current = { filePath: item.filePath, file: null, cases: [] };
      result.push(current);
    }
    if (item.kind === "file") current.file = item;
    else current.cases.push(item);
  }
  return result;
});

const selected = computed(() => new Set(props.modelValue));

// 文件默认收起：一个测试集动辄上百个文件，全展开会淹没页面。
const expandedFiles = ref<Set<string>>(new Set());

function isExpanded(group: FileGroup): boolean {
  return expandedFiles.value.has(group.filePath);
}

function toggleGroup(filePath: string): void {
  const next = new Set(expandedFiles.value);
  if (next.has(filePath)) next.delete(filePath);
  else next.add(filePath);
  expandedFiles.value = next;
}

/** 编辑集合成员时，把已经选中的函数所在文件展开，否则看不到勾选结果。 */
function expandSelectedFiles(items: ApiTestCaseResponseDto[]): void {
  const selectedIds = new Set(props.modelValue);
  const paths = new Set<string>();
  for (const item of items) {
    if (item.kind !== "file" && selectedIds.has(item.id)) paths.add(item.filePath);
  }
  expandedFiles.value = paths;
}

async function load(): Promise<void> {
  const id = props.suiteId;
  if (id === "") {
    cases.value = [];
    return;
  }
  const ticket = ++requestId;
  loading.value = true;
  error.value = null;
  expandedFiles.value = new Set();
  try {
    const result = await listApiTestCases({ client: apiClient, query: { suiteId: id } });
    if (ticket !== requestId) return;
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      cases.value = [];
      return;
    }
    cases.value = result.data.cases;
    expandSelectedFiles(result.data.cases);
    emit("loaded", result.data.cases);
  } finally {
    if (ticket === requestId) loading.value = false;
  }
}

/** 选整个文件时不再保留它下面的函数行，否则执行时同一批用例会跑两遍。 */
function toggleFile(group: FileGroup, checked: boolean): void {
  if (group.file === null) return;
  const next = new Set(props.modelValue);
  if (checked) {
    next.add(group.file.id);
    for (const item of group.cases) next.delete(item.id);
  } else {
    next.delete(group.file.id);
  }
  emit("update:modelValue", [...next]);
}

/** 反过来，单独选一个函数时把所属文件行退掉，让选择含义保持唯一。 */
function toggleCase(file: ApiTestCaseResponseDto | null, caseId: string, checked: boolean): void {
  const next = new Set(props.modelValue);
  if (checked) {
    next.add(caseId);
    if (file !== null) next.delete(file.id);
  } else {
    next.delete(caseId);
  }
  emit("update:modelValue", [...next]);
}

function fileName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

watch(
  () => props.suiteId,
  () => {
    void load().catch(() => undefined);
  },
  { immediate: true },
);
</script>

<template>
  <div class="case-tree">
    <RequestErrorAlert :error="error" class="case-tree__error" />
    <p v-if="loading" class="case-tree__empty">加载用例中…</p>
    <p v-else-if="cases.length === 0" class="case-tree__empty">
      这个测试集还没有编目用例，先执行一次同步。
    </p>
    <ul v-else class="case-tree__groups">
      <li v-for="group in groups" :key="group.filePath" class="case-tree__group">
        <div class="case-tree__file">
          <button
            v-if="group.cases.length > 0"
            type="button"
            class="case-tree__toggle"
            :aria-expanded="isExpanded(group)"
            :aria-label="`${isExpanded(group) ? '收起' : '展开'} ${fileName(group.filePath)}`"
            @click="toggleGroup(group.filePath)"
          >
            <ArrowDown v-if="isExpanded(group)" aria-hidden="true" />
            <ArrowRight v-else aria-hidden="true" />
          </button>
          <span v-else class="case-tree__toggle-space" aria-hidden="true" />
          <ElCheckbox
            :model-value="group.file !== null && selected.has(group.file.id)"
            :disabled="disabled || group.file === null"
            @update:model-value="(checked) => toggleFile(group, checked === true)"
          >
            <span class="case-tree__file-name" :title="group.filePath">
              {{ fileName(group.filePath) }}
            </span>
          </ElCheckbox>
          <span class="case-tree__file-count">{{ group.cases.length }} 个用例</span>
        </div>
        <p class="case-tree__path" :title="group.filePath">{{ group.filePath }}</p>
        <ul v-if="group.cases.length > 0 && isExpanded(group)" class="case-tree__cases">
          <li v-for="item in group.cases" :key="item.id" class="case-tree__case">
            <ElCheckbox
              :model-value="selected.has(item.id)"
              :disabled="disabled"
              @update:model-value="(checked) => toggleCase(group.file, item.id, checked === true)"
            >
              <span :title="item.nodeId">{{ item.name }}</span>
            </ElCheckbox>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.case-tree {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.case-tree__error {
  margin-bottom: 4px;
}

.case-tree__empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.case-tree__groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.case-tree__group {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.case-tree__file {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.case-tree__toggle,
.case-tree__toggle-space {
  flex: none;
  width: 18px;
  height: 18px;
}

.case-tree__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.case-tree__toggle:hover {
  background: var(--el-fill-color-light);
}

.case-tree__toggle svg {
  width: 14px;
  height: 14px;
}

.case-tree__file-name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-tree__file-count {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.case-tree__file :deep(.el-checkbox) {
  min-width: 0;
}

.case-tree__file :deep(.el-checkbox__label) {
  overflow: hidden;
}

.case-tree__path {
  overflow: hidden;
  margin: 2px 0 6px 50px;
  color: var(--el-text-color-secondary);
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-tree__cases {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0 0 0 50px;
  list-style: none;
}

.case-tree__case {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
</style>
