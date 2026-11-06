<script setup lang="ts">
import type { ApiTestRunItemResponseDto } from "@share-mind-map/api-client";
import { ElTable, ElTableColumn, ElTag } from "element-plus";
import { computed, ref } from "vue";

// 单套件报告和批次报告都要展示用例明细，这里统一一份，改列只改一处。
const props = defineProps<{ items: ApiTestRunItemResponseDto[] }>();

// 报告动辄上百条，通过的默认收起来，先让人看到失败的。
const showPassed = ref(false);

const passedCount = computed(
  () => props.items.filter((item) => item.status === "passed").length,
);

const visibleItems = computed(() =>
  showPassed.value ? props.items : props.items.filter((item) => item.status !== "passed"),
);

const emptyText = computed(() =>
  passedCount.value > 0 && !showPassed.value ? "全部通过，没有失败用例" : "暂时没有用例结果",
);

const itemStatusTypes: Record<string, "info" | "warning" | "success" | "danger"> = {
  passed: "success",
  failed: "danger",
  error: "danger",
  skipped: "info",
};

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "-";
  return JSON.stringify(value, null, 2);
}

function exchanges(item: unknown): string {
  const record = item as ApiTestRunItemResponseDto;
  return pretty({ request: record.request, response: record.response });
}
</script>

<template>
  <div class="run-items">
    <div v-if="passedCount > 0" class="run-items__toolbar">
      <button type="button" class="run-items__toggle" @click="showPassed = !showPassed">
        {{
          showPassed
            ? "只看失败用例"
            : `已折叠 ${String(passedCount)} 条通过用例，点击展开`
        }}
      </button>
    </div>
    <ElTable :data="visibleItems" row-key="id" :empty-text="emptyText">
      <ElTableColumn type="expand">
        <template #default="{ row }">
          <div class="run-items__detail">
            <p class="run-items__node">{{ row.nodeId }}</p>
            <pre v-if="row.failure" class="run-items__pre">{{ row.failure }}</pre>
            <pre class="run-items__pre">{{ exchanges(row) }}</pre>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="caseName" label="用例" min-width="320" />
      <ElTableColumn label="状态" width="100">
        <template #default="{ row }">
          <ElTag :type="itemStatusTypes[row.status] ?? 'info'">{{ row.status }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="耗时" width="110">
        <template #default="{ row }">
          {{ row.durationMs === null ? "-" : `${String(row.durationMs)} ms` }}
        </template>
      </ElTableColumn>
    </ElTable>
  </div>
</template>

<style scoped>
.run-items__toolbar {
  margin-bottom: 8px;
}

.run-items__toggle {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--el-color-primary);
  font-size: 13px;
  cursor: pointer;
}

.run-items__detail {
  padding: 12px 16px;
}

.run-items__node {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.run-items__pre {
  margin: 0;
  max-height: 420px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
}
</style>
