<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import {
  acquireDocumentLock,
  heartbeatDocumentLock,
  releaseDocumentLock,
  type LockDto,
} from "@share-mind-map/api-client";
import { cloneCloudDocument } from "@share-mind-map/document-model";

import { useAuthStore } from "../auth/auth.store.js";
import { apiClient } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { DraftStore } from "../editor/draft-store.js";
import { useEditorStore } from "../editor/editor.store.js";
import { SaveQueue } from "../editor/save-queue.js";
import LockStatus from "../editor/LockStatus.vue";
import ImageUploadControl from "../editor/assets/ImageUploadControl.vue";
import { MindElixirAdapter } from "../editor/adapters/mind-elixir.js";
import type { MindMapAdapter } from "../editor/adapters/types.js";
import { useUnsavedGuard } from "../editor/use-unsaved-guard.js";
import { DocumentRealtime } from "../realtime/document-realtime.js";
import { useDocumentStore } from "./document.store.js";

const properties = defineProps<{ documentId: string; workspaceId?: string }>();
const auth = useAuthStore();
const documents = useDocumentStore();
const editor = useEditorStore();
const drafts = new DraftStore();
const canvas = ref<HTMLDivElement | null>(null);
const mobile = ref(false);
const copiedDraft = ref(false);
const saveError = ref<string | null>(null);
const imageBytes = ref(0);
const lockState = ref<"idle" | "acquiring" | "held" | "lost" | "error">("idle");
let adapter: MindMapAdapter | null = null;
let unsubscribe: (() => void) | null = null;
let mediaQuery: MediaQueryList | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
let mounted = false;
const realtime = new DocumentRealtime({
  onVersionGap: () => void load(),
  onReconnect: () => {
    editor.stopEditing();
    editor.setMode("readonly");
  },
});

const currentWorkspaceId = computed(
  () => properties.workspaceId || auth.session?.defaultWorkspace.id || "",
);
const canEdit = computed(() => auth.role === "editor" || auth.role === "admin");
const lockOccupied = computed(() => documents.lock?.occupied ?? false);
const lockOccupiedByOther = computed(() => lockOccupied.value && !editor.canWrite);
const readOnly = computed(
  () => !canEdit.value || mobile.value || lockOccupiedByOther.value || !editor.canWrite,
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
const draftKey = computed(() => {
  const userId = auth.session?.user.id;
  if (userId === undefined || currentWorkspaceId.value === "") return null;
  return DraftStore.key(userId, currentWorkspaceId.value, properties.documentId);
});
const draftAvailable = computed(
  () => draftKey.value !== null && drafts.load(draftKey.value) !== null,
);

function saveErrorCode(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : "NETWORK_ERROR";
}

function handleSaveFailure(error: unknown): void {
  const code = saveErrorCode(error);
  saveError.value = code;
  if (code === "LOCK_LOST" || code === "PERMISSION_DENIED" || code === "AUTH_SESSION_EXPIRED") {
    stopLockTimer();
    editor.clearLockLease();
    editor.markLockLost();
    lockState.value = "lost";
    adapter?.setReadOnly(true);
  } else if (code === "DOCUMENT_VERSION_CONFLICT") {
    editor.markConflict();
    adapter?.setReadOnly(true);
  } else if (code === "NETWORK_ERROR") {
    editor.markOffline();
    adapter?.setReadOnly(true);
  } else {
    editor.markSaveFailed();
  }
}

const saveQueue = new SaveQueue(async (snapshot, kind) => {
  const lease = editor.lockLease;
  if (lease === null) throw new Error("LOCK_LOST");
  editor.setMode("saving");
  const result = await documents.saveSnapshot(
    snapshot,
    lease,
    kind,
    `document-save-${globalThis.crypto.randomUUID()}`,
    imageBytes.value,
    editor.currentVersion ?? snapshot.version,
  );
  const saved = cloneCloudDocument(snapshot);
  saved.version = result.version;
  documents.snapshot = saved;
  if (documents.metadata !== null) {
    documents.metadata = { ...documents.metadata, currentVersion: result.version };
  }
  const draftIsStillCurrent =
    editor.draft !== null && JSON.stringify(editor.draft) === JSON.stringify(snapshot);
  if (draftIsStillCurrent || !editor.dirty) {
    editor.markSaved(result.version);
    if (draftKey.value !== null) drafts.clear(draftKey.value);
    if (mounted) await adapter?.applySnapshot(saved);
  } else {
    editor.currentVersion = result.version;
    editor.setMode("editing-dirty");
  }
  saveError.value = null;
  return result;
});

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

const unsaved = useUnsavedGuard({
  dirty: () => editor.dirty,
  onDiscard: () => {
    if (draftKey.value !== null) drafts.clear(draftKey.value);
    editor.discardDraft();
  },
  onCopyJson: () => (draftKey.value === null ? undefined : drafts.copyJson(draftKey.value)),
  onExportDraft: async () => {
    if (editor.draft === null) return;
    const blob = await documents.exportDraft(editor.draft);
    downloadBlob(blob, `${documents.metadata?.name ?? "mind-map"}-draft.xmind`);
  },
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
    if (!readOnly.value) {
      editor.markChanged(snapshot);
      if (draftKey.value !== null) {
        const currentVersion = editor.currentVersion;
        drafts.save(draftKey.value, snapshot, currentVersion === null ? {} : { currentVersion });
      }
      void saveQueue.enqueue(snapshot, "auto").catch(handleSaveFailure);
    }
  });
}

function handleRealtimeSnapshot(event: {
  version: number;
  snapshot: NonNullable<typeof documents.snapshot>;
}): void {
  if (editor.dirty || editor.canWrite) {
    editor.markConflict();
    adapter?.setReadOnly(true);
    return;
  }
  documents.snapshot = event.snapshot;
  if (documents.metadata !== null) {
    documents.metadata = { ...documents.metadata, currentVersion: event.version };
  }
  editor.setDocument(event.snapshot, event.version);
  void adapter?.applySnapshot(event.snapshot);
}

function handleRealtimeLock(lock: {
  occupied: boolean;
  editorDisplayName: string | null;
  expiresAt: string | null;
  generation: number;
}): void {
  if (documents.lock === null) return;
  documents.lock = {
    ...documents.lock,
    occupied: lock.occupied,
    generation: lock.generation,
    expiresAt: lock.expiresAt ?? documents.lock.expiresAt,
    ...(lock.editorDisplayName === null ? {} : { editorDisplayName: lock.editorDisplayName }),
  };
  const lease = editor.lockLease;
  if (lease !== null && (!lock.occupied || lock.generation !== lease.generation)) {
    stopLockTimer();
    editor.clearLockLease();
    editor.markLockLost();
    lockState.value = "lost";
    adapter?.setReadOnly(true);
  }
}

async function load(): Promise<void> {
  if (currentWorkspaceId.value === "") return;
  await documents.load(currentWorkspaceId.value, properties.documentId);
  await nextTick();
  if (documents.snapshot !== null) {
    imageBytes.value = documents.metadata?.imageBytes ?? 0;
    editor.setDocument(documents.snapshot, documents.metadata?.currentVersion);
    await mountAdapter();
    realtime.join(
      currentWorkspaceId.value,
      properties.documentId,
      documents.metadata?.currentVersion ?? 0,
    );
  }
}

function stopLockTimer(): void {
  if (lockTimer !== null) clearTimeout(lockTimer);
  lockTimer = null;
}

function scheduleHeartbeat(ttlSeconds: number): void {
  stopLockTimer();
  lockTimer = setTimeout(() => void heartbeat(), Math.max(1_000, Math.floor(ttlSeconds * 500)));
}

async function heartbeat(): Promise<void> {
  const lease = editor.lockLease;
  if (lease === null || currentWorkspaceId.value === "") return;
  const result = await heartbeatDocumentLock({
    client: apiClient,
    path: { workspaceId: currentWorkspaceId.value, documentId: properties.documentId },
    body: lease,
  });
  if (result.data === undefined) {
    lockState.value = "lost";
    editor.clearLockLease();
    editor.markLockLost();
    stopLockTimer();
    adapter?.setReadOnly(true);
    return;
  }
  editor.setLockLease({ ...lease, generation: result.data.generation });
  if (documents.lock !== null) {
    documents.lock = {
      ...documents.lock,
      generation: result.data.generation,
      expiresAt: result.data.expiresAt,
      ttlSeconds: result.data.ttlSeconds,
    };
  }
  scheduleHeartbeat(result.data.ttlSeconds);
}

async function beginEditing(): Promise<void> {
  if (!canEdit.value || mobile.value || lockOccupied.value || documents.metadata === null) return;
  lockState.value = "acquiring";
  const browserEditSessionId = globalThis.crypto.randomUUID();
  const result = await acquireDocumentLock({
    client: apiClient,
    path: { workspaceId: currentWorkspaceId.value, documentId: properties.documentId },
    body: { browserEditSessionId },
  });
  if (result.data === undefined) {
    lockState.value = "error";
    return;
  }
  const lock = result.data.lock as LockDto & { token?: string };
  if (lock.token === undefined) {
    lockState.value = "error";
    return;
  }
  const publicLock: LockDto = {
    occupied: lock.occupied,
    generation: lock.generation,
    expiresAt: lock.expiresAt,
    ttlSeconds: lock.ttlSeconds,
    ...(lock.editorDisplayName === undefined ? {} : { editorDisplayName: lock.editorDisplayName }),
    ...(lock.heartbeatAt === undefined ? {} : { heartbeatAt: lock.heartbeatAt }),
  };
  editor.setLockLease({ browserEditSessionId, generation: lock.generation, token: lock.token });
  editor.startEditing(documents.metadata.currentVersion);
  saveError.value = null;
  documents.lock = publicLock;
  lockState.value = "held";
  adapter?.setReadOnly(false);
  scheduleHeartbeat(lock.ttlSeconds);
}

async function endEditing(): Promise<void> {
  const lease = editor.lockLease;
  if (lease !== null && editor.dirty && editor.draft !== null) {
    try {
      await saveQueue.enqueue(editor.draft, "manual");
    } catch (error) {
      handleSaveFailure(error);
      return;
    }
  }
  stopLockTimer();
  editor.stopEditing();
  adapter?.setReadOnly(true);
  lockState.value = "idle";
  if (lease === null || currentWorkspaceId.value === "") return;
  editor.clearLockLease();
  await releaseDocumentLock({
    client: apiClient,
    path: { workspaceId: currentWorkspaceId.value, documentId: properties.documentId },
    body: lease,
  });
}

async function uploadImage(file: File): Promise<string> {
  const lease = editor.lockLease;
  if (lease === null) throw new Error("编辑锁已失效");
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(
    `${apiClient.config.baseUrl}/api/v1/workspaces/${currentWorkspaceId.value}/documents/${properties.documentId}/assets`,
    {
      method: "POST",
      body: form,
      credentials: "include",
      headers: {
        "X-Asset-Path": file.name,
        "X-Browser-Edit-Session": lease.browserEditSessionId,
        "X-Lock-Token": lease.token,
        "X-Lock-Generation": String(lease.generation),
        ...(auth.csrfToken === null ? {} : { "X-CSRF-Token": auth.csrfToken }),
      },
    },
  );
  if (!response.ok) throw new Error("Image upload failed");
  const body = (await response.json()) as { asset?: { id?: unknown; byteSize?: unknown } };
  if (typeof body.asset?.id !== "string") throw new Error("Image asset id missing");
  if (typeof body.asset.byteSize === "number") imageBytes.value += body.asset.byteSize;
  return body.asset.id;
}

async function saveManually(): Promise<void> {
  if (editor.draft === null || !editor.canWrite) return;
  try {
    await saveQueue.enqueue(editor.draft, "manual");
  } catch (error) {
    handleSaveFailure(error);
  }
}

async function restoreDraft(): Promise<void> {
  if (draftKey.value === null) return;
  const stored = drafts.load(draftKey.value);
  if (stored === null) return;
  if (!editor.canWrite) await beginEditing();
  if (!editor.canWrite) return;
  editor.markChanged(stored.snapshot);
  await adapter?.applySnapshot(stored.snapshot);
}

function discardStoredDraft(): void {
  if (draftKey.value !== null) drafts.clear(draftKey.value);
}

async function insertImage(assetId: string): Promise<void> {
  const draft = editor.draft ?? documents.snapshot;
  const sheet = draft?.sheets[0];
  if (draft === null || sheet === undefined) return;
  const next = cloneCloudDocument(toRaw(draft));
  const nextSheet = next.sheets[0];
  if (nextSheet === undefined) return;
  const rootNode = nextSheet.nodes[nextSheet.rootNodeId];
  if (rootNode === undefined) return;
  rootNode.imageAssetId = assetId;
  editor.markChanged(next);
  if (adapter !== null) await adapter.applySnapshot(next);
}

async function copyDraftJson(): Promise<void> {
  const json = unsaved.copyJson();
  if (json === undefined) return;
  await navigator.clipboard.writeText(json);
  copiedDraft.value = true;
}

watch(readOnly, (value) => adapter?.setReadOnly(value));

onMounted(() => {
  mounted = true;
  realtime.onSnapshot(handleRealtimeSnapshot);
  realtime.onLock(handleRealtimeLock);
  realtime.connect();
  mediaQuery = window.matchMedia("(max-width: 767px)");
  mediaQuery.addEventListener("change", updateMobile);
  updateMobile();
  void load();
});

onBeforeUnmount(() => {
  mounted = false;
  stopLockTimer();
  void endEditing()
    .catch(handleSaveFailure)
    .finally(() => {
      saveQueue.dispose();
    });
  realtime.disconnect();
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
          <LockStatus
            :state="lockState"
            :lock="documents.lock"
            :can-edit="canEdit && !lockOccupiedByOther"
            :mobile="mobile"
            @begin="beginEditing"
            @end="endEditing"
          />
          <ImageUploadControl
            v-if="editor.canWrite"
            :disabled="!editor.canWrite"
            :upload="uploadImage"
            @asset-selected="insertImage"
          />
          <button
            v-if="editor.dirty && editor.canWrite"
            type="button"
            :disabled="editor.mode === 'saving'"
            @click="saveManually"
          >
            {{ editor.mode === "saving" ? "保存中…" : "保存" }}
          </button>
          <button v-if="editor.dirty" type="button" @click="copyDraftJson">复制草稿 JSON</button>
          <button v-if="editor.dirty" type="button" @click="unsaved.exportDraft">
            导出草稿 XMind
          </button>
        </div>
      </header>
      <div v-if="editor.dirty || draftAvailable" class="document-draft-bar" role="status">
        <span>{{
          editor.dirty ? "存在未保存修改，已保存在本机草稿中。" : "检测到本机草稿。"
        }}</span>
        <span v-if="copiedDraft">已复制</span>
        <button
          v-if="!editor.dirty && draftAvailable && canEdit && !mobile"
          type="button"
          @click="restoreDraft"
        >
          恢复草稿
        </button>
        <button v-if="!editor.dirty && draftAvailable" type="button" @click="discardStoredDraft">
          丢弃草稿
        </button>
        <button v-if="editor.dirty" type="button" @click="unsaved.discard">放弃草稿</button>
      </div>
      <div class="document-status-bar">
        <span>兼容性：{{ documents.compatibility }}</span>
        <template v-if="documents.lock?.occupied">
          <span>编辑锁：{{ documents.lock.editorDisplayName ?? "已占用" }}</span>
        </template>
        <template v-else><span>编辑锁：可获取</span></template>
        <span v-if="saveError">保存状态：{{ saveError }}</span>
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
