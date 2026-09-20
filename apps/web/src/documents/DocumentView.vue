<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useAuthStore } from "../auth/auth.store.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useEditorStore } from "../editor/editor.store.js";
import { MindElixirAdapter } from "../editor/adapters/mind-elixir.js";
import type { MindMapAdapter } from "../editor/adapters/types.js";
import { useDocumentStore } from "./document.store.js";

const properties = defineProps<{ documentId: string; workspaceId?: string }>();
const auth = useAuthStore();
const documents = useDocumentStore();
const editor = useEditorStore();
const canvas = ref<HTMLDivElement | null>(null);
const mobile = ref(false);
let adapter: MindMapAdapter | null = null;
let unsubscribe: (() => void) | null = null;
let mediaQuery: MediaQueryList | null = null;

const currentWorkspaceId = computed(
  () => properties.workspaceId || auth.session?.defaultWorkspace.id || "",
);
const canEdit = computed(() => auth.role === "editor" || auth.role === "admin");
const lockOccupied = computed(() => documents.lock?.occupied ?? false);
const readOnly = computed(
  () => !canEdit.value || mobile.value || lockOccupied.value || !editor.canWrite,
);
const notes = computed(() => {
  const result: Array<{ id: string; text: string }> = [];
  for (const sheet of documents.snapshot?.sheets ?? []) {
    for (const node of Object.values(sheet.nodes)) {
      if (node.notes !== null && node.notes.text !== "")
        result.push({ id: node.id, text: node.notes.text });
    }
  }
  return result;
});

function updateMobile(): void {
  mobile.value = mediaQuery?.matches ?? window.innerWidth < 768;
}

async function mountAdapter(): Promise<void> {
  if (canvas.value === null || documents.snapshot === null) return;
  adapter?.destroy();
  unsubscribe?.();
  adapter = new MindElixirAdapter(canvas.value);
  await adapter.mount(documents.snapshot);
  adapter.setReadOnly(readOnly.value);
  unsubscribe = adapter.onChange((snapshot) => {
    if (!readOnly.value) editor.markChanged(snapshot);
  });
}

async function load(): Promise<void> {
  if (currentWorkspaceId.value === "") return;
  await documents.load(currentWorkspaceId.value, properties.documentId);
  await nextTick();
  if (documents.snapshot !== null) await mountAdapter();
}

function beginEditing(): void {
  if (!canEdit.value || mobile.value || lockOccupied.value || documents.metadata === null) return;
  editor.startEditing(documents.metadata.currentVersion);
  adapter?.setReadOnly(false);
}

function endEditing(): void {
  editor.stopEditing();
  adapter?.setReadOnly(true);
}

watch(readOnly, (value) => adapter?.setReadOnly(value));

onMounted(() => {
  mediaQuery = window.matchMedia("(max-width: 767px)");
  mediaQuery.addEventListener("change", updateMobile);
  updateMobile();
  void load();
});

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener("change", updateMobile);
  unsubscribe?.();
  adapter?.destroy();
});
</script>

<template>
  <section class="document-view" aria-labelledby="document-title">
    <div
      v-if="documents.connection === 'idle' || documents.connection === 'loading'"
      class="content-state"
      role="status"
    >
      <span class="loading-indicator" aria-hidden="true" />正在加载文档
    </div>
    <template v-else-if="documents.connection === 'error'">
      <RequestErrorAlert :error="documents.error" />
      <div class="content-state">
        <h1>文档加载失败</h1>
        <button type="button" @click="load">重新加载</button>
      </div>
    </template>
    <template v-else-if="documents.metadata !== null">
      <header class="document-heading">
        <div>
          <a class="document-back-link" href="/workspace">返回工作区</a>
          <p class="eyebrow">文档</p>
          <h1 id="document-title">{{ documents.metadata.name }}</h1>
          <p class="document-meta">
            版本 {{ documents.metadata.currentVersion }} · 更新于
            {{ new Date(documents.metadata.updatedAt).toLocaleString("zh-CN") }}
          </p>
        </div>
        <div class="document-actions">
          <span class="document-connection" role="status">{{
            readOnly ? "只读模式" : "编辑中"
          }}</span>
          <button
            v-if="canEdit && !editor.canWrite"
            type="button"
            :disabled="mobile || lockOccupied"
            @click="beginEditing"
          >
            {{
              lockOccupied
                ? `由 ${documents.lock?.editorDisplayName ?? "其他成员"} 编辑中`
                : "开始编辑"
            }}
          </button>
          <button v-if="editor.canWrite" type="button" @click="endEditing">结束编辑</button>
        </div>
      </header>
      <div class="document-status-bar">
        <span>兼容性：{{ documents.compatibility }}</span>
        <span v-if="documents.lock?.occupied"
          >编辑锁：{{ documents.lock.editorDisplayName ?? "已占用" }}</span
        >
        <span v-else>编辑锁：可获取</span>
      </div>
      <div
        ref="canvas"
        class="document-canvas"
        :class="{ 'document-canvas--readonly': readOnly }"
        aria-label="思维导图画布"
      />
      <section v-if="notes.length > 0" class="document-notes" aria-labelledby="notes-title">
        <h2 id="notes-title">节点备注</h2>
        <article v-for="note in notes" :key="note.id">
          <p>{{ note.text }}</p>
        </article>
      </section>
    </template>
  </section>
</template>
