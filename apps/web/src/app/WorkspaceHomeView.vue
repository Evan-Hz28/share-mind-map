<script setup lang="ts">
import {
  Bell,
  Document,
  Download,
  Edit,
  Files,
  Folder,
  FolderOpened,
  Grid,
  List,
  MoreFilled,
  Plus,
  Search,
  Sort,
  Upload,
} from "@element-plus/icons-vue";
import { ElButton, ElDialog, ElIcon, ElInput, ElTag } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useAuthStore } from "../auth/auth.store.js";
import { getCompatibilityMeta } from "../documents/compatibility.js";
import {
  collectDroppedFiles,
  collectPickedFiles,
  describeCollected,
  type CollectedEntry,
  type CollectedFiles,
} from "../workspace/drop-collect.js";
import {
  IMPORT_BATCH_MAX_FILES,
  IMPORT_FILE_MAX_MEGABYTES,
  defaultImportNames,
  normalizeImportName,
  validateImportFile,
  validateImportName,
} from "../workspace/import-validation.js";
import { useWorkspaceStore } from "../workspace/workspace.store.js";

/** 待导入的一行:本地文件 + 目标文档名 + 目标文件夹。 */
interface ImportRow {
  /** 列表 key 和移除都按它来:文件名不足以区分,目录里可能有两份同名同大小的副本。 */
  id: number;
  /** 相对拖入/选入根的路径,重复内容和界面展示都靠它区分。 */
  path: string;
  file: File;
  name: string;
  folderId: string;
}

let nextImportRowId = 1;

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const dialogOpen = ref(false);
const dialogKind = ref<"folder" | "document">("folder");
const editingFolderId = ref<string | null>(null);
const editingDocumentId = ref<string | null>(null);
const form = reactive({ name: "", folderId: "" });
const notificationOpen = ref(false);
const importDialogOpen = ref(false);
const importRows = ref<ImportRow[]>([]);
const importFileInput = ref<HTMLInputElement | null>(null);
const importFolderInput = ref<HTMLInputElement | null>(null);
const importDragOver = ref(false);
const importSummary = ref<string | null>(null);
/** dragenter/dragleave 会在子元素之间反复冒泡,用计数抵消,免得高亮闪烁。 */
let importDragDepth = 0;
const moreMenuDocumentId = ref<string | null>(null);
/** "all" / "unassigned" / 文件夹 id。A 段先在已加载的文档上做筛选。 */
const selectedFolderId = ref<string>("all");
const folderSearch = ref("");
const documentSearch = ref("");
const viewMode = ref<"list" | "grid">("list");

const workspaceId = computed(() => auth.session?.defaultWorkspace.id ?? "");
const canEdit = computed(() => auth.role === "editor" || auth.role === "admin");
const isAdmin = computed(() => auth.role === "admin");
const dialogTitle = computed(() => {
  if (dialogKind.value === "folder")
    return editingFolderId.value === null ? "创建文件夹" : "重命名文件夹";
  return editingDocumentId.value === null ? "创建空白文档" : "编辑文档元数据";
});
const quotaMessage = computed(() => {
  const threshold = workspace.storage?.threshold;
  if (threshold === "exceeded") return "已达到配置配额；当前阶段不允许新增内容。";
  if (threshold === "critical") return "存储配额已使用 95% 以上，请联系管理员。";
  if (threshold === "warning") return "存储配额已使用 80% 以上。";
  return "";
});
/**
 * 与 importRows 按下标一一对应的逐行问题。
 * 一定要按下标对齐:workspace.store 是拿数组下标把 batch.jobs[index] 对回 files[index] 的,
 * 所以校验只能拦、不能把行过滤掉,否则文件和任务会错配。
 */
const importRowIssues = computed<Array<string | null>>(() => {
  const seenNames = new Set<string>();
  return importRows.value.map((row) => {
    const normalized = normalizeImportName(row.name);
    const duplicated = normalized !== null && seenNames.has(normalized);
    if (normalized !== null) seenNames.add(normalized);
    return (
      validateImportFile(row.file) ??
      validateImportName(row.name) ??
      (duplicated ? "与前面某一行的目标文档名重复。" : null)
    );
  });
});
const importBatchIssue = computed<string | null>(() => {
  const count = importRows.value.length;
  if (count <= IMPORT_BATCH_MAX_FILES) return null;
  const excess = count - IMPORT_BATCH_MAX_FILES;
  return `单次最多提交 ${String(IMPORT_BATCH_MAX_FILES)} 个文件，当前选了 ${String(count)} 个，请先移除 ${String(excess)} 个。`;
});
const canSubmitImport = computed(
  () =>
    importRows.value.length > 0 &&
    importBatchIssue.value === null &&
    !importRowIssues.value.some((issue) => issue !== null),
);
/** 本批还能再收几个;拖进来的目录按它截断,免得收下一堆永远提交不了的行。 */
const importSlotsLeft = computed(() =>
  Math.max(0, IMPORT_BATCH_MAX_FILES - importRows.value.length),
);

const selectedFolder = computed(
  () => workspace.folders.find((folder) => folder.id === selectedFolderId.value) ?? null,
);
const selectedFolderLabel = computed(() => {
  if (selectedFolderId.value === "all") return "全部文件";
  if (selectedFolderId.value === "unassigned") return "未归档";
  return selectedFolder.value?.name ?? "全部文件";
});
const libraryDescription = computed(() => {
  if (selectedFolderId.value === "all") return "浏览工作区内全部文件夹和未归档的文档。";
  if (selectedFolderId.value === "unassigned") return "查看尚未归入任何文件夹的文档。";
  return "查看该文件夹下的文档。";
});
const normalizedFolderQuery = computed(() => folderSearch.value.trim().toLocaleLowerCase("zh-CN"));
const visibleFolders = computed(() => {
  const query = normalizedFolderQuery.value;
  if (query === "") return workspace.folders;
  return workspace.folders.filter((folder) =>
    folder.name.toLocaleLowerCase("zh-CN").includes(query),
  );
});
/**
 * A 段没有按文件夹查询的 API,这里只统计已加载的文档。
 * 文档数超过一页时,「全部文件」用 `50+` 标出还有未加载的部分。
 */
const documentCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const document of workspace.documents) {
    if (document.folderId === null || document.folderId === undefined) continue;
    counts.set(document.folderId, (counts.get(document.folderId) ?? 0) + 1);
  }
  return counts;
});
const unassignedCount = computed(
  () =>
    workspace.documents.filter(
      (document) => document.folderId === null || document.folderId === undefined,
    ).length,
);
const totalCountLabel = computed(
  () =>
    `${String(workspace.documents.length)}${workspace.documentCursor === null ? "" : "+"}`,
);
const scopedDocuments = computed(() => {
  if (selectedFolderId.value === "all") return workspace.documents;
  if (selectedFolderId.value === "unassigned") {
    return workspace.documents.filter(
      (document) => document.folderId === null || document.folderId === undefined,
    );
  }
  return workspace.documents.filter((document) => document.folderId === selectedFolderId.value);
});
const visibleDocuments = computed(() => {
  const query = documentSearch.value.trim().toLocaleLowerCase("zh-CN");
  if (query === "") return scopedDocuments.value;
  return scopedDocuments.value.filter((document) =>
    document.name.toLocaleLowerCase("zh-CN").includes(query),
  );
});
const documentEmptyMessage = computed(() => {
  if (documentSearch.value.trim() !== "") return "没有匹配的文档。";
  if (selectedFolderId.value !== "all") return "此文件夹还没有文档。";
  return "暂无文档。";
});

const folderNames = computed(
  () => new Map(workspace.folders.map((folder) => [folder.id, folder.name])),
);

function folderLabel(folderId: string | null | undefined): string {
  if (folderId === null || folderId === undefined) return "未归档";
  return folderNames.value.get(folderId) ?? "未归档";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function folderCount(folderId: string): number {
  return documentCounts.value.get(folderId) ?? 0;
}

function selectAllDocuments(): void {
  selectedFolderId.value = "all";
  documentSearch.value = "";
}

function selectUnassigned(): void {
  selectedFolderId.value = "unassigned";
  documentSearch.value = "";
}

function selectFolder(folderId: string): void {
  selectedFolderId.value = folderId;
  documentSearch.value = "";
}

function openCreateFolder(): void {
  dialogKind.value = "folder";
  editingFolderId.value = null;
  editingDocumentId.value = null;
  form.name = "";
  form.folderId = "";
  dialogOpen.value = true;
}

/**
 * 去重用的身份。必须带上相对路径:文件名不足以区分,目录里很容易出现
 * 两份同名同大小的副本(子目录A/登录用例.xmind 和 子目录B/登录用例.xmind
 * 的 file.name 都是 登录用例.xmind)。名字里不可能出现 NUL,拿它当分隔符。
 */
function importRowKey(row: { path: string; file: File }): string {
  return `${row.path}\u0000${String(row.file.size)}\u0000${String(row.file.lastModified)}`;
}

/**
 * 原生 file input 的 value 不归 Vue 管,而弹窗用的 ElDialog 默认不销毁内容:
 * 关掉再打开时控件里还挂着上次选的文件名,但 @change 不会再触发,界面就和
 * importRows 对不上了(表现为「显示着文件名,却提示请选择至少一个文件」)。
 * 所以每次选中项被消费掉之后就把原生控件清空。
 */
function clearNativeInput(): void {
  if (importFileInput.value !== null) importFileInput.value.value = "";
  if (importFolderInput.value !== null) importFolderInput.value.value = "";
}

function resetImportDragState(): void {
  importDragDepth = 0;
  importDragOver.value = false;
}

function openImport(): void {
  importRows.value = [];
  importSummary.value = null;
  resetImportDragState();
  workspace.importProgress = null;
  workspace.importBatchId = null;
  workspace.importJobs = [];
  workspace.importSourceFiles = {};
  workspace.closeImportRealtime();
  workspace.error = null;
  clearNativeInput();
  importDialogOpen.value = true;
}

/**
 * 把一次拖拽/选择的结果并进待导入列表。
 * 去重和默认命名只在这里做一次,拖拽和两个原生控件的行为才会一致。
 */
function applyCollected(collected: CollectedFiles): void {
  const known = new Set(importRows.value.map((row) => importRowKey(row)));
  const fresh: CollectedEntry[] = [];
  let duplicate = 0;
  for (const entry of collected.entries) {
    const key = importRowKey(entry);
    if (known.has(key)) {
      duplicate += 1;
      continue;
    }
    known.add(key);
    fresh.push(entry);
  }
  const names = defaultImportNames(
    fresh.map((entry) => entry.path),
    importRows.value.map((row) => row.name),
  );
  for (const [index, entry] of fresh.entries()) {
    importRows.value.push({
      id: nextImportRowId,
      path: entry.path,
      file: entry.file,
      name: names[index] ?? entry.file.name,
      folderId: "",
    });
    nextImportRowId += 1;
  }
  importSummary.value = describeCollected(collected, {
    added: fresh.length,
    duplicate,
    limit: IMPORT_BATCH_MAX_FILES,
  });
}

/**
 * 「选择文件」和「选择文件夹」共用一个处理器:目录选择只是把层次写进了
 * File.webkitRelativePath,展开交给 collectPickedFiles。
 * 必须同步消费 input.files——清空原生控件之后就读不到了。
 */
function selectImportFiles(event: Event): void {
  const files = (event.target as HTMLInputElement).files;
  if (files !== null) applyCollected(collectPickedFiles(files, importSlotsLeft.value));
  clearNativeInput();
}

function handleImportDragEnter(): void {
  importDragDepth += 1;
  importDragOver.value = true;
}

/** dragover 会被高频触发,只用来把这里标记成合法放置目标,不参与计数。 */
function handleImportDragOver(): void {
  importDragOver.value = true;
}

function handleImportDragLeave(): void {
  importDragDepth = Math.max(0, importDragDepth - 1);
  if (importDragDepth === 0) importDragOver.value = false;
}

async function handleImportDrop(event: DragEvent): Promise<void> {
  // drop 之后不一定还会收到 dragleave,这里必须自己复位。
  resetImportDragState();
  const transfer = event.dataTransfer;
  if (transfer === null) return;
  const limit = importSlotsLeft.value;
  applyCollected(await collectDroppedFiles(transfer, limit));
}

function removeImportRow(id: number): void {
  importRows.value = importRows.value.filter((row) => row.id !== id);
}

function closeImportDialog(): void {
  workspace.error = null;
  resetImportDragState();
  importDialogOpen.value = false;
}

async function submitImport(): Promise<void> {
  if (!canSubmitImport.value) return;
  const ok = await workspace.importFiles(
    importRows.value.map((row) => ({
      file: row.file,
      targetName: row.name,
      targetFolderId: row.folderId || null,
    })),
  );
  if (ok) closeImportDialog();
}

async function cancelImport(jobId: string): Promise<void> {
  if (!globalThis.confirm("确定取消这个尚未开始处理的导入任务吗？")) return;
  await workspace.cancelImport(jobId);
}

async function retryImport(jobId: string): Promise<void> {
  await workspace.retryImport(jobId);
}

function replaceImportFile(jobId: string, event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file !== undefined) workspace.replaceImportSource(jobId, file);
}

function openRenameFolder(folderId: string, name: string): void {
  dialogKind.value = "folder";
  editingFolderId.value = folderId;
  editingDocumentId.value = null;
  form.name = name;
  form.folderId = "";
  dialogOpen.value = true;
}

function openDocument(documentId: string | null, name = "", folderId: string | null = null): void {
  dialogKind.value = "document";
  editingFolderId.value = null;
  editingDocumentId.value = documentId;
  form.name = name;
  form.folderId = folderId ?? "";
  dialogOpen.value = true;
}

function toggleDocumentMenu(documentId: string): void {
  moreMenuDocumentId.value = moreMenuDocumentId.value === documentId ? null : documentId;
}

async function deleteDocument(documentId: string, name: string): Promise<void> {
  if (!globalThis.confirm(`删除后不可恢复，确定删除「${name}」吗？`)) return;
  if (await workspace.deleteDocument(documentId)) moreMenuDocumentId.value = null;
}

async function deleteFolder(folderId: string, name: string): Promise<void> {
  const documentCount = await workspace.checkFolderDelete(folderId);
  if (documentCount === null) return;
  const message =
    documentCount === 0
      ? `确定删除空文件夹「${name}」吗？`
      : `删除后不可恢复，将同时永久删除文件夹内 ${String(documentCount)} 篇文档。确定删除「${name}」吗？`;
  if (!globalThis.confirm(message)) return;
  if (await workspace.deleteFolder(folderId, documentCount)) {
    if (selectedFolderId.value === folderId) selectedFolderId.value = "all";
  }
}

async function submitDialog(): Promise<void> {
  const name = form.name.trim();
  if (name === "") return;
  const succeeded =
    dialogKind.value === "folder"
      ? editingFolderId.value === null
        ? await workspace.createFolder(name)
        : await workspace.renameFolder(editingFolderId.value, name)
      : editingDocumentId.value === null
        ? await workspace.createDocument(name, form.folderId || null)
        : await workspace.updateDocument(editingDocumentId.value, {
            name,
            folderId: form.folderId || null,
          });
  if (succeeded) dialogOpen.value = false;
}

async function load(): Promise<void> {
  if (workspaceId.value === "") return;
  await workspace.loadWorkspace(workspaceId.value);
  await workspace.loadNotifications();
  if (isAdmin.value) await workspace.loadAdminData();
}

async function openNotifications(): Promise<void> {
  notificationOpen.value = true;
  if (workspace.notifications.length === 0) await workspace.loadNotifications();
}

/**
 * 首页的「新建文档 / 导入 XMind」快捷入口会带 `?action=` 跳过来。
 * 打开对应弹窗后立刻清掉查询参数,刷新或前进后退时不会再次弹出。
 */
async function runQuickAction(): Promise<void> {
  const action = route.query.action;
  if (typeof action !== "string") return;
  if (action === "import" && canEdit.value) openImport();
  else if (action === "create-document" && canEdit.value) openDocument(null);
  else return;
  await router.replace({ name: "workspace" });
}

onMounted(() => void load().then(runQuickAction));
</script>

<template>
  <section class="workspace-home" aria-labelledby="workspace-title">
    <header class="library-header page-heading page-heading--with-action">
      <div class="library-header__intro">
        <nav class="library-breadcrumb" aria-label="面包屑">
          <button type="button" @click="selectAllDocuments">用例库</button>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{{ selectedFolderLabel }}</span>
        </nav>
        <h1 id="workspace-title">{{ selectedFolderLabel }}</h1>
        <p>{{ libraryDescription }}</p>
      </div>
      <div class="workspace-actions">
        <ElButton v-if="auth.role === 'reader'" @click="workspace.requestEditPermission()">
          <ElIcon><Edit /></ElIcon>申请编辑权限
        </ElButton>
        <ElButton v-if="canEdit" class="workspace-action--secondary" @click="openCreateFolder">
          <ElIcon><Plus /></ElIcon>新建文件夹
        </ElButton>
        <ElButton v-if="canEdit" type="primary" @click="openDocument(null)">
          <ElIcon><Document /></ElIcon>新建文档
        </ElButton>
        <ElButton v-if="canEdit" class="workspace-action--secondary" @click="openImport">
          <ElIcon><Upload /></ElIcon>导入 XMind
        </ElButton>
      </div>
    </header>

    <RequestErrorAlert :error="workspace.error" />
    <div v-if="quotaMessage !== ''" class="quota-banner" role="status">
      <strong>配额提醒</strong><span>{{ quotaMessage }}</span>
    </div>

    <div v-if="workspace.loading" class="content-state" role="status">
      <span class="loading-indicator" aria-hidden="true" />正在加载工作台
    </div>
    <div v-else-if="workspace.error?.code === 'PERMISSION_DENIED'" class="content-state">
      <h2>无权访问此工作区</h2>
      <p>你的工作区权限可能已被撤销。</p>
    </div>
    <div v-else-if="!workspace.hasData" class="content-state">
      <Document class="state-icon" aria-hidden="true" />
      <h2>还没有文档</h2>
      <p>{{ canEdit ? "创建一个文件夹或空白文档开始整理。" : "等待编辑者创建文档。" }}</p>
    </div>
    <div v-else class="library-layout">
      <aside class="library-sidebar" aria-labelledby="library-folders-heading">
        <header class="library-sidebar__header">
          <h2 id="library-folders-heading"><FolderOpened aria-hidden="true" />用例库</h2>
          <button
            v-if="canEdit"
            class="library-sidebar__add"
            type="button"
            aria-label="在一级文件夹中新建"
            @click="openCreateFolder"
          >
            <Plus aria-hidden="true" />
          </button>
        </header>
        <div class="library-sidebar__search">
          <ElInput
            v-model="folderSearch"
            placeholder="搜索文件夹…"
            aria-label="搜索文件夹"
            clearable
          >
            <template #prefix><ElIcon><Search /></ElIcon></template>
          </ElInput>
        </div>
        <ul class="library-tree">
          <li>
            <button
              class="library-tree__item"
              :class="{ 'library-tree__item--active': selectedFolderId === 'all' }"
              type="button"
              @click="selectAllDocuments"
            >
              <Files aria-hidden="true" />
              <span class="library-tree__name">全部文件</span>
              <span class="library-tree__count">{{ totalCountLabel }}</span>
            </button>
          </li>
          <li>
            <button
              class="library-tree__item"
              :class="{ 'library-tree__item--active': selectedFolderId === 'unassigned' }"
              type="button"
              @click="selectUnassigned"
            >
              <Folder aria-hidden="true" />
              <span class="library-tree__name">未归档</span>
              <span class="library-tree__count">{{ unassignedCount }}</span>
            </button>
          </li>
          <li v-for="folder in visibleFolders" :key="folder.id" class="library-tree__folder">
            <div
              class="library-tree__row"
              :class="{ 'library-tree__row--active': selectedFolderId === folder.id }"
            >
              <button
                class="library-tree__item"
                type="button"
                @click="selectFolder(folder.id)"
              >
                <Folder aria-hidden="true" />
                <span class="library-tree__name">{{ folder.name }}</span>
                <span class="library-tree__count" :title="`已加载 ${folderCount(folder.id)} 篇`">{{
                  folderCount(folder.id)
                }}</span>
              </button>
              <button
                v-if="canEdit"
                class="library-tree__rename"
                type="button"
                :aria-label="`重命名 ${folder.name}`"
                @click="openRenameFolder(folder.id, folder.name)"
              >
                重命名
              </button>
              <button
                v-if="canEdit"
                class="library-tree__rename library-tree__delete"
                type="button"
                :aria-label="`删除 ${folder.name}`"
                @click="deleteFolder(folder.id, folder.name)"
              >
                删除
              </button>
            </div>
          </li>
        </ul>
        <div v-if="workspace.folders.length === 0" class="library-sidebar__empty">
          <p>暂无文件夹</p>
          <ElButton v-if="canEdit" size="small" @click="openCreateFolder">
            <Plus aria-hidden="true" />新建文件夹
          </ElButton>
        </div>
        <p v-else-if="visibleFolders.length === 0" class="library-sidebar__empty">
          没有匹配的文件夹
        </p>
        <p class="library-sidebar__hint">文件夹数量基于已加载的文档统计。</p>
      </aside>

      <section class="library-content" aria-labelledby="documents-heading">
        <h2 id="documents-heading" class="visually-hidden">文档</h2>
        <div class="library-toolbar">
          <ElInput
            v-model="documentSearch"
            class="library-toolbar__search"
            placeholder="搜索当前文件夹下的文档…"
            aria-label="搜索文档"
            clearable
          >
            <template #prefix><ElIcon><Search /></ElIcon></template>
          </ElInput>
          <div class="library-toolbar__actions">
            <ElIcon aria-hidden="true"><Sort /></ElIcon>
            <label for="document-sort" class="visually-hidden">文档排序</label>
            <select
              id="document-sort"
              :value="workspace.sort"
              @change="
                workspace.changeSort(($event.target as HTMLSelectElement).value as 'updatedAt' | 'name')
              "
            >
              <option value="updatedAt">更新时间倒序</option>
              <option value="name">名称正序</option>
            </select>
            <div class="view-toggle" role="group" aria-label="视图切换">
              <button
                type="button"
                :class="{ 'view-toggle__button--active': viewMode === 'list' }"
                :aria-pressed="viewMode === 'list'"
                aria-label="列表视图"
                title="列表视图"
                @click="viewMode = 'list'"
              >
                <List aria-hidden="true" />
              </button>
              <button
                type="button"
                :class="{ 'view-toggle__button--active': viewMode === 'grid' }"
                :aria-pressed="viewMode === 'grid'"
                aria-label="网格视图"
                title="网格视图"
                @click="viewMode = 'grid'"
              >
                <Grid aria-hidden="true" />
              </button>
            </div>
            <button
              class="notification-button"
              type="button"
              aria-label="通知"
              @click="openNotifications"
            >
              <Bell aria-hidden="true" />
              <span v-if="workspace.unreadCount > 0" class="notification-count">{{
                workspace.unreadCount
              }}</span>
            </button>
          </div>
        </div>

        <div v-if="visibleDocuments.length === 0" class="content-state library-empty">
          <Document class="state-icon" aria-hidden="true" />
          <p>{{ documentEmptyMessage }}</p>
        </div>
        <div
          v-else-if="viewMode === 'list'"
          class="doc-table-wrap"
          :class="{ 'doc-table-wrap--menu-open': moreMenuDocumentId !== null }"
        >
          <table class="doc-table">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">位置</th>
                <th scope="col">版本</th>
                <th scope="col">节点数</th>
                <th scope="col">最后更新</th>
                <th scope="col" class="doc-table__actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="document in visibleDocuments" :key="document.id">
                <td>
                  <div class="doc-table__name">
                    <span class="doc-table__icon" aria-hidden="true"><Document /></span>
                    <div>
                      <RouterLink
                        class="doc-table__link"
                        :to="{ name: 'document', params: { documentId: document.id } }"
                      >
                        {{ document.name }}
                      </RouterLink>
                      <div class="doc-table__tags">
                        <span
                          class="compatibility-status"
                          :title="getCompatibilityMeta(document.compatibilityStatus).description"
                          :aria-label="getCompatibilityMeta(document.compatibilityStatus).description"
                          tabindex="0"
                        >
                          <ElTag
                            size="small"
                            :type="document.compatibilityStatus === 'full' ? 'success' : 'warning'"
                          >
                            兼容性：{{ getCompatibilityMeta(document.compatibilityStatus).label }}
                          </ElTag>
                        </span>
                        <ElTag size="small" type="info">只读快照</ElTag>
                      </div>
                    </div>
                  </div>
                </td>
                <td class="doc-table__location">{{ folderLabel(document.folderId) }}</td>
                <td>v{{ document.currentVersion }}</td>
                <td>{{ document.nodeCount }}</td>
                <td class="doc-table__updated">{{ formatDateTime(document.updatedAt) }}</td>
                <td>
                  <div class="doc-table__actions">
                    <button
                      class="doc-table__action doc-table__action--icon"
                      type="button"
                      aria-label="导出 XMind"
                      title="导出 XMind"
                      @click="workspace.exportDocument(document.id)"
                    >
                      <Download aria-hidden="true" />
                    </button>
                    <button
                      v-if="canEdit"
                      class="doc-table__action doc-table__action--icon"
                      type="button"
                      :aria-label="`编辑 ${document.name}`"
                      :title="`编辑 ${document.name}`"
                      @click="openDocument(document.id, document.name, document.folderId)"
                    >
                      <Edit aria-hidden="true" />
                    </button>
                    <button
                      v-if="canEdit"
                      class="doc-table__more"
                      type="button"
                      :aria-label="`更多操作 ${document.name}`"
                      :aria-expanded="moreMenuDocumentId === document.id"
                      @click="toggleDocumentMenu(document.id)"
                    >
                      <MoreFilled />
                    </button>
                    <div
                      v-if="moreMenuDocumentId === document.id"
                      class="popover-menu popover-menu--right doc-table__menu"
                    >
                      <button type="button" @click="deleteDocument(document.id, document.name)">
                        删除文档
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="workspace-document-grid">
          <article
            v-for="document in visibleDocuments"
            :key="document.id"
            class="workspace-document-card"
          >
            <div class="workspace-document-card__icon" aria-hidden="true">
              <ElIcon><Document /></ElIcon>
            </div>
            <RouterLink
              class="workspace-document-card__link workspace-list__name workspace-list__name--link"
              :to="{ name: 'document', params: { documentId: document.id } }"
            >
              <strong>{{ document.name }}</strong>
              <small>
                版本 {{ document.currentVersion }} · {{ document.nodeCount }} 个节点 ·
                {{ folderLabel(document.folderId) }}
              </small>
            </RouterLink>
            <div class="workspace-document-card__meta">
              <span
                class="compatibility-status"
                :title="getCompatibilityMeta(document.compatibilityStatus).description"
                :aria-label="getCompatibilityMeta(document.compatibilityStatus).description"
                tabindex="0"
              >
                <ElTag
                  size="small"
                  :type="document.compatibilityStatus === 'full' ? 'success' : 'warning'"
                >
                  兼容性：{{ getCompatibilityMeta(document.compatibilityStatus).label }}
                </ElTag>
              </span>
              <ElTag size="small" type="info">只读快照</ElTag>
            </div>
            <div class="workspace-document-card__actions">
              <button
                class="workspace-document-card__action workspace-document-card__action--secondary"
                type="button"
                @click="workspace.exportDocument(document.id)"
              >
                导出 XMind
              </button>
              <button
                v-if="canEdit"
                class="workspace-document-card__action workspace-document-card__action--primary"
                type="button"
                :aria-label="`编辑 ${document.name}`"
                @click="openDocument(document.id, document.name, document.folderId)"
              >
                编辑元数据
              </button>
              <button
                v-if="canEdit"
                class="workspace-document-card__more"
                type="button"
                :aria-label="`更多操作 ${document.name}`"
                :aria-expanded="moreMenuDocumentId === document.id"
                @click="toggleDocumentMenu(document.id)"
              >
                <MoreFilled />
              </button>
              <div
                v-if="moreMenuDocumentId === document.id"
                class="popover-menu popover-menu--right workspace-document-card__menu"
              >
                <button type="button" @click="deleteDocument(document.id, document.name)">
                  删除文档
                </button>
              </div>
            </div>
          </article>
        </div>

        <footer class="library-footer">
          <span>共 {{ visibleDocuments.length }} 篇</span>
          <ElButton v-if="workspace.documentCursor" text @click="workspace.loadMoreDocuments"
            >加载更多</ElButton
          >
        </footer>
        <p v-if="isAdmin && workspace.permissionRequests.length > 0" class="admin-hint">
          有 {{ workspace.permissionRequests.length }} 条待审批申请，请前往管理面板处理。
        </p>
      </section>
    </div>

    <ElDialog
      v-model="importDialogOpen"
      title="导入 XMind 文件"
      width="min(92vw, 760px)"
      :close-on-click-modal="false"
      @close="closeImportDialog"
    >
      <div
        class="form-stack import-drop-zone"
        :class="{ 'import-drop-zone--over': importDragOver }"
        data-testid="xmind-import-dialog"
        @dragenter.prevent="handleImportDragEnter"
        @dragover.prevent="handleImportDragOver"
        @dragleave="handleImportDragLeave"
        @drop.prevent="handleImportDrop"
      >
        <RequestErrorAlert :error="workspace.error" />
        <p class="import-drop-hint">
          把 .xmind 文件或整个文件夹拖到这里，目录下的 .xmind 会自动展开。
        </p>
        <div class="field-group">
          <label for="xmind-files"
            >选择文件（可多选，单个不超过 {{ IMPORT_FILE_MAX_MEGABYTES }} MB，单次最多
            {{ IMPORT_BATCH_MAX_FILES }} 个）</label
          >
          <input
            id="xmind-files"
            ref="importFileInput"
            type="file"
            accept=".xmind"
            multiple
            @change="selectImportFiles"
          />
        </div>
        <div class="field-group">
          <label for="xmind-folder">选择文件夹（自动展开目录下所有 .xmind）</label>
          <input
            id="xmind-folder"
            ref="importFolderInput"
            type="file"
            webkitdirectory
            multiple
            @change="selectImportFiles"
          />
        </div>
        <p v-if="importSummary !== null" class="import-drop-summary" role="status">
          {{ importSummary }}
        </p>
        <div v-if="importRows.length > 0" class="import-list">
          <div v-for="(row, index) in importRows" :key="row.id" class="import-list__row">
            <span class="import-list__file">{{ row.path }}</span>
            <ElInput v-model="row.name" maxlength="100" aria-label="目标文档名" />
            <select v-model="row.folderId" aria-label="目标文件夹">
              <option value="">未归档</option>
              <option v-for="folder in workspace.folders" :key="folder.id" :value="folder.id">
                {{ folder.name }}
              </option>
            </select>
            <button
              type="button"
              class="import-list__remove"
              :aria-label="`移除 ${row.path}`"
              :disabled="workspace.importing"
              @click="removeImportRow(row.id)"
            >
              移除
            </button>
            <small v-if="importRowIssues[index]" class="import-row-error">{{
              importRowIssues[index]
            }}</small>
          </div>
          <p v-if="importBatchIssue" class="import-batch-warning">{{ importBatchIssue }}</p>
        </div>
        <p v-else class="panel-empty">请选择至少一个 .xmind 文件。</p>
        <p v-if="workspace.importProgress !== null" role="status">
          状态：{{ workspace.importProgress.status }}；成功
          {{ workspace.importProgress.succeededJobs }}，失败
          {{ workspace.importProgress.failedJobs }}，取消
          {{ workspace.importProgress.cancelledJobs }} / {{ workspace.importProgress.totalJobs }}
        </p>
        <ul v-if="workspace.importJobs.length > 0" class="import-job-list" aria-label="导入任务">
          <li v-for="job in workspace.importJobs" :key="job.id" class="import-job-list__item">
            <span class="workspace-list__name">
              <strong>{{ job.targetName }}</strong>
              <small>{{ job.clientFileName }} · {{ job.phase }}</small>
              <small v-if="job.errorMessage" class="import-job-error">{{ job.errorMessage }}</small>
            </span>
            <ElButton
              v-if="job.phase === 'waiting'"
              size="small"
              :disabled="workspace.importing"
              @click="cancelImport(job.id)"
              >取消</ElButton
            >
            <ElButton
              v-if="job.phase === 'failed'"
              size="small"
              type="primary"
              :disabled="workspace.importing"
              @click="retryImport(job.id)"
              >重试</ElButton
            >
            <label v-if="job.phase === 'failed'" class="import-replace-file">
              替换文件
              <input type="file" accept=".xmind" @change="replaceImportFile(job.id, $event)" />
            </label>
          </li>
        </ul>
      </div>
      <template #footer>
        <ElButton @click="closeImportDialog">取消</ElButton>
        <ElButton
          type="primary"
          :loading="workspace.importing"
          :disabled="!canSubmitImport || workspace.importing"
          @click="submitImport"
          >开始导入</ElButton
        >
      </template>
    </ElDialog>

    <ElDialog
      v-model="dialogOpen"
      :title="dialogTitle"
      width="min(92vw, 480px)"
      :close-on-click-modal="false"
    >
      <form class="form-stack" @submit.prevent="submitDialog">
        <div class="field-group">
          <label for="workspace-item-name">名称</label
          ><ElInput id="workspace-item-name" v-model="form.name" maxlength="100" show-word-limit />
        </div>
        <div v-if="dialogKind === 'document'" class="field-group">
          <label for="workspace-document-folder">一级文件夹</label>
          <select id="workspace-document-folder" v-model="form.folderId">
            <option value="">未归档</option>
            <option v-for="folder in workspace.folders" :key="folder.id" :value="folder.id">
              {{ folder.name }}
            </option>
          </select>
        </div>
      </form>
      <template #footer
        ><ElButton @click="dialogOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="workspace.mutating" @click="submitDialog"
          >保存</ElButton
        ></template
      >
    </ElDialog>

    <ElDialog v-model="notificationOpen" title="通知" width="min(92vw, 520px)">
      <div class="notification-list" data-testid="notification-dialog">
        <div class="notification-list__toolbar">
          <span>{{ workspace.unreadCount }} 条未读</span>
          <ElButton
            text
            :disabled="workspace.unreadCount === 0"
            @click="workspace.markAllNotificationsRead"
            >全部标为已读</ElButton
          >
        </div>
        <div v-if="workspace.notifications.length === 0" class="panel-empty">暂无通知</div>
        <ul v-else class="notification-list__items">
          <li
            v-for="notification in workspace.notifications"
            :key="notification.id"
            :class="{ 'notification-list__item--unread': notification.readAt === null }"
          >
            <div>
              <strong>{{ notification.title }}</strong>
              <p>{{ notification.body }}</p>
              <small>{{ new Date(notification.createdAt).toLocaleString("zh-CN") }}</small>
            </div>
            <ElButton
              v-if="notification.readAt === null"
              text
              size="small"
              @click="workspace.markNotificationRead(notification.id)"
              >标为已读</ElButton
            >
          </li>
        </ul>
      </div>
    </ElDialog>
  </section>
</template>
