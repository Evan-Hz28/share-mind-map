<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{ message: string }>();

const open = ref(false);

/** 折叠时只留第一行非空内容，避免整段 pytest 输出把用例表格挤到屏幕外。 */
const headline = computed(() => {
  const line = props.message.split("\n").find((item) => item.trim() !== "");
  return line ?? "";
});
</script>

<template>
  <section class="error-output">
    <div class="error-output__bar">
      <span class="error-output__title">执行错误</span>
      <span v-if="!open" class="error-output__headline">{{ headline }}</span>
      <button type="button" class="error-output__toggle" @click="open = !open">
        {{ open ? "收起" : "展开完整输出" }}
      </button>
    </div>
    <pre v-if="open" class="error-output__pre">{{ message }}</pre>
  </section>
</template>

<style scoped>
.error-output {
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: 4px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: 13px;
}

.error-output__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.error-output__title {
  flex: none;
  font-weight: 600;
}

.error-output__headline {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error-output__toggle {
  flex: none;
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--el-color-primary);
  font-size: 13px;
  cursor: pointer;
}

.error-output__pre {
  max-height: 420px;
  margin: 0;
  padding: 0 12px 12px;
  overflow: auto;
  color: var(--el-text-color-primary);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
