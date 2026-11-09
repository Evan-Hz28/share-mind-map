<script setup lang="ts">
import {
  rerunApiTestRunItem,
  type ApiTestRunItemResponseDto,
} from "@share-mind-map/api-client";
import { ElTag } from "element-plus";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import { writeClipboard } from "../clipboard.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { curlFromRequest, extractCurl, parseFailure } from "./failure";

const props = defineProps<{ item: ApiTestRunItemResponseDto }>();

const router = useRouter();

const view = computed(() =>
  parseFailure(props.item.failure, props.item.request, props.item.response),
);

const showExchanges = ref(false);
const showRaw = ref(false);

const canRerun = computed(() => props.item.status === "failed" || props.item.status === "error");

/** 优先用上游断言附带的完整 curl；没有时用采集到的请求拼，鉴权头已脱敏。 */
const curlSource = computed<{ text: string; redacted: boolean } | null>(() => {
  const fromRaw = extractCurl(view.value?.raw ?? null);
  if (fromRaw !== null) return { text: fromRaw, redacted: false };
  const fromCapture = curlFromRequest(props.item.request);
  return fromCapture === null ? null : { text: fromCapture, redacted: true };
});

const curlCopied = ref(false);

async function copyCurl(): Promise<void> {
  const source = curlSource.value;
  if (source === null) return;
  curlCopied.value = await writeClipboard(source.text);
}

const rerunning = ref(false);
const rerunError = ref<RequestFailure | null>(null);

/** 沿用原 report 的测试集、环境和 node id，等于把这条结果原样再跑一次。 */
async function rerun(): Promise<void> {
  if (rerunning.value) return;
  rerunning.value = true;
  rerunError.value = null;
  try {
    const result = await rerunApiTestRunItem({
      client: apiClient,
      path: { itemId: props.item.id },
    });
    if (result.data === undefined) {
      rerunError.value = toApiFailure(result.error);
      return;
    }
    const run = result.data.runs[0];
    if (run !== undefined) {
      await router.push({ name: "api-test-run", params: { runId: run.id } });
    }
  } finally {
    rerunning.value = false;
  }
}

function hasData(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

// 采集默认只记失败用例（API_TEST_CAPTURE=failures），通过用例是空数组，不展示空壳 JSON。
const hasExchanges = computed(() => hasData(props.item.request) || hasData(props.item.response));

const exchangeText = computed(() =>
  JSON.stringify({ request: props.item.request, response: props.item.response }, null, 2),
);

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${String(ms)} ms`;
}

const meta = computed(() => {
  const value = view.value;
  if (value === null) return "";
  const parts: string[] = [];
  if (value.method !== null) parts.push([value.method, value.path].filter(Boolean).join(" "));
  if (value.status !== null) parts.push(`HTTP ${String(value.status)}`);
  const duration = formatDuration(value.durationMs);
  if (duration !== null) parts.push(duration);
  if (value.location !== null) parts.push(value.location);
  return parts.join(" · ");
});

const rawLabel = computed(() => {
  const raw = view.value?.raw ?? "";
  if (raw.length < 1024) return `完整 pytest 输出（${String(raw.length)} 字符）`;
  return `完整 pytest 输出（${(raw.length / 1024).toFixed(1)} KB）`;
});
</script>

<template>
  <div class="item-detail">
    <p class="item-detail__node">{{ item.nodeId }}</p>

    <template v-if="view">
      <div class="item-detail__head">
        <ElTag :type="view.tagType" size="small" effect="dark">{{ view.label }}</ElTag>
        <span class="item-detail__headline">{{ view.headline }}</span>
      </div>

      <p v-if="meta" class="item-detail__meta">{{ meta }}</p>
      <p v-if="view.detail" class="item-detail__hint">{{ view.detail }}</p>
      <pre v-if="view.sources.length > 0" class="item-detail__source">{{
        view.sources.join("\n")
      }}</pre>
    </template>

    <div v-if="hasExchanges || view" class="item-detail__toggles">
      <button
        v-if="hasExchanges"
        type="button"
        class="item-detail__toggle"
        @click="showExchanges = !showExchanges"
      >
        {{ showExchanges ? "收起请求 / 响应" : "请求 / 响应" }}
      </button>
      <button v-if="view" type="button" class="item-detail__toggle" @click="showRaw = !showRaw">
        {{ showRaw ? "收起完整输出" : rawLabel }}
      </button>
      <button
        v-if="curlSource"
        type="button"
        class="item-detail__toggle"
        :title="
          curlSource.redacted
            ? '鉴权头已脱敏，复制后需要手动补 token'
            : '复制失败请求的 curl 命令'
        "
        @click="copyCurl"
      >
        {{ curlCopied ? "已复制 curl" : "复制 curl" }}
      </button>
      <button
        v-if="canRerun"
        type="button"
        class="item-detail__toggle"
        :disabled="rerunning"
        @click="rerun"
      >
        {{ rerunning ? "重跑中…" : "重跑此用例" }}
      </button>
    </div>

    <RequestErrorAlert :error="rerunError" />

    <pre v-if="showExchanges" class="item-detail__pre">{{ exchangeText }}</pre>
    <pre v-if="view && showRaw" class="item-detail__pre">{{ view.raw }}</pre>
  </div>
</template>

<style scoped>
.item-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
}

.item-detail__node {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.item-detail__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.item-detail__headline {
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: 600;
  word-break: break-word;
}

.item-detail__meta {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  word-break: break-all;
}

.item-detail__hint {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.item-detail__source {
  max-height: 200px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.item-detail__toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.item-detail__toggle {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--el-color-primary);
  font-size: 12px;
  cursor: pointer;
}

.item-detail__toggle:disabled {
  color: var(--el-text-color-disabled);
  cursor: not-allowed;
}

.item-detail__pre {
  max-height: 420px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-primary);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
