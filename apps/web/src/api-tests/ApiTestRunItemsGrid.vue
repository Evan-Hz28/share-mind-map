<script setup lang="ts">
import type { ApiTestRunItemResponseDto } from "@share-mind-map/api-client";
import { ElTable, ElTableColumn, ElTag } from "element-plus";
import { computed } from "vue";

import ApiTestItemDetail from "./ApiTestItemDetail.vue";
import { failureKind, failureLabel, failureTagType, type FailureView } from "./failure";

const props = withDefaults(
  defineProps<{ items: ApiTestRunItemResponseDto[]; emptyText?: string; showReason?: boolean }>(),
  { emptyText: "", showReason: false },
);

// 分类只算一次，滚动和展开不会重复解析 16 KB 的 traceback。
const reasons = computed(() => {
  const map = new Map<string, { label: string; type: FailureView["tagType"] }>();
  for (const item of props.items) {
    const kind = failureKind(item);
    if (kind !== null) {
      map.set(item.id, { label: failureLabel(kind), type: failureTagType(kind) });
    }
  }
  return map;
});

const NO_REASON = { label: "", type: "info" as const };

// ElTable 的 slot row 是宽泛类型，这里收窄一次，模板里不用到处断言。
function asItem(row: unknown): ApiTestRunItemResponseDto {
  return row as ApiTestRunItemResponseDto;
}

function reasonOf(row: unknown): { label: string; type: FailureView["tagType"] } {
  return reasons.value.get(asItem(row).id) ?? NO_REASON;
}

const itemStatusTypes: Record<string, "info" | "warning" | "success" | "danger"> = {
  passed: "success",
  failed: "danger",
  error: "danger",
  skipped: "info",
};
</script>

<template>
  <ElTable :data="items" row-key="id" :empty-text="emptyText || '暂时没有用例结果'">
    <ElTableColumn type="expand">
      <template #default="{ row }">
        <ApiTestItemDetail :item="asItem(row)" />
      </template>
    </ElTableColumn>
    <ElTableColumn prop="caseName" label="用例" min-width="320" />
    <ElTableColumn label="状态" width="100">
      <template #default="{ row }">
        <ElTag :type="itemStatusTypes[row.status] ?? 'info'">{{ row.status }}</ElTag>
      </template>
    </ElTableColumn>
    <ElTableColumn v-if="showReason" label="Failure" width="150">
      <template #default="{ row }">
        <ElTag v-if="reasonOf(row).label" :type="reasonOf(row).type" size="small">
          {{ reasonOf(row).label }}
        </ElTag>
      </template>
    </ElTableColumn>
    <ElTableColumn label="耗时" width="110">
      <template #default="{ row }">
        {{ row.durationMs === null ? "-" : `${String(row.durationMs)} ms` }}
      </template>
    </ElTableColumn>
  </ElTable>
</template>
