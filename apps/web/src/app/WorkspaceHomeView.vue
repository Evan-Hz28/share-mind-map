<script setup lang="ts">
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Document,
  Files,
  Folder,
  FolderOpened,
  Grid,
  List,
  MoreFilled,
  Plus,
  Search,
} from "@element-plus/icons-vue";
import { ElButton, ElDialog, ElIcon, ElInput, ElTag } from "element-plus";
import type { FolderDto } from "@share-mind-map/api-client";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useAuthStore } from "../auth/auth.store.js";
import LibraryHeader from "./LibraryHeader.vue";
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
  IMPORT_FOLDER_MAX_DEPTH,
  defaultImportNames,
  importFolderPath,
  normalizeFolderName,
  normalizeFolderPath,
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
  /** 目录路径(不含文件名);顶层文件为空串。 */
  folderPath: string;
  /** "" 未归档 / "id:<uuid>" 已存在 / "path:<目录路径>" 提交时再创建。 */
  folderValue: string;
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
/** 新建文件夹时选定的父文件夹;重命名不使用。 */
const creatingFolderParentId = ref<string | null>(null);
const notificationOpen = ref(false);
const importDialogOpen = ref(false);
const importRows = ref<ImportRow[]>([]);
const importFileInput = ref<HTMLInputElement | null>(null);
const importFolderInput = ref<HTMLInputElement | null>(null);
const importDragOver = ref(false);
const importSummary = ref<string | null>(null);
/** 打开弹窗时选中的文件夹,本批默认归档到它;null 表示未归档/全部文件。 */
const importBaseFolderId = ref<string | null>(null);
/** 服务端 409 返回的具体冲突名,用来把错误标到对应行。 */
const serverConflictNames = ref<string[]>([]);
/** dragenter/dragleave 会在子元素之间反复冒泡,用计数抵消,免得高亮闪烁。 */
let importDragDepth = 0;
const moreMenuDocumentId = ref<string | null>(null);
const moreMenuFolderId = ref<string | null>(null);
/** 菜单用 fixed 定位,避开侧栏和表格的 overflow 裁剪。 */
const folderMenuStyle = ref<Record<string, string> | null>(null);
const documentMenuStyle = ref<Record<string, string> | null>(null);
/** "all" / "unassigned" / 文件夹 id。A 段先在已加载的文档上做筛选。 */
const selectedFolderId = ref<string>("all");
const folderSearch = ref("");
const documentSearch = ref("");
const viewMode = ref<"list" | "grid">("list");
/** 只对已加载的文档分页;游标还有下一页时在页脚额外提供「加载更多」。 */
const documentPage = ref(1);
const documentPageSize = ref(20);
/** 文件夹拖拽排序的临时状态:不依赖 dataTransfer,jsdom 里也能直接派发事件。 */
const draggingFolderId = ref<string | null>(null);
const dragOverFolderId = ref<string | null>(null);
const folderDropMode = ref<"before" | "after" | "inside">("before");
/** 展开的文件夹 id。Set 原地增删不会触发更新,每次都换一个新 Set。 */
const expandedFolderIds = ref<Set<string>>(new Set());

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
/** 工作区里已占用的文档名(只含已加载的),以及服务端刚返回的冲突名。 */
const existingImportNames = computed(() => {
  const names = new Set<string>();
  for (const document of workspace.documents) {
    const normalized = normalizeImportName(document.name);
    if (normalized !== null) names.add(normalized);
  }
  for (const value of serverConflictNames.value) {
    const normalized = normalizeImportName(value);
    if (normalized !== null) names.add(normalized);
  }
  return names;
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
      (duplicated ? "与前面某一行的目标文档名重复。" : null) ??
      (normalized !== null && existingImportNames.value.has(normalized)
        ? "工作区已存在同名文档，请改名。"
        : null)
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
/** 待创建的目录路径,父目录排在子目录之前。 */
const pendingImportFolderPaths = computed(() => {
  const paths = new Set<string>();
  for (const row of importRows.value) {
    if (row.folderValue.startsWith("path:")) paths.add(row.folderValue.slice(5));
  }
  return [...paths].sort(
    (left, right) =>
      left.split("/").length - right.split("/").length || left.localeCompare(right, "zh"),
  );
});

const selectedFolder = computed(
  () => workspace.folders.find((folder) => folder.id === selectedFolderId.value) ?? null,
);
const selectedFolderLabel = computed(() => {
  if (selectedFolderId.value === "all") return "全部文件";
  if (selectedFolderId.value === "unassigned") return "未归档";
  return selectedFolder.value?.name ?? "全部文件";
});
/** 面包屑展开完整祖先链,顺序从根到当前文件夹。 */
const selectedFolderChain = computed<FolderDto[]>(() => {
  if (selectedFolder.value === null) return [];
  const byId = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  const chain: FolderDto[] = [];
  let cursor: FolderDto | undefined = selectedFolder.value;
  let guard = 0;
  while (cursor !== undefined && guard <= 64) {
    chain.unshift(cursor);
    guard += 1;
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return chain;
});
const libraryDescription = computed(() => {
  if (selectedFolderId.value === "all") return "浏览工作区内全部文件夹和未归档的文档。";
  if (selectedFolderId.value === "unassigned") return "查看尚未归入任何文件夹的文档。";
  return "查看该文件夹下的子文件夹和文档。";
});
const normalizedFolderQuery = computed(() => folderSearch.value.trim().toLocaleLowerCase("zh-CN"));

interface FolderTreeRow {
  folder: FolderDto;
  depth: number;
  hasChildren: boolean;
}

const folderChildren = computed<Map<string, FolderDto[]>>(() => {
  const map = new Map<string, FolderDto[]>();
  for (const folder of workspace.folders) {
    const key = folder.parentId ?? "";
    const list = map.get(key);
    if (list === undefined) map.set(key, [folder]);
    else list.push(folder);
  }
  return map;
});

/** 每个文件夹的展示路径与归一化路径键,建一次给所有地方复用。 */
const folderIndex = computed(() => {
  const byId = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  const pathById = new Map<string, string>();
  const keyById = new Map<string, string>();
  const idByKey = new Map<string, string>();
  for (const folder of workspace.folders) {
    const chain: FolderDto[] = [];
    let cursor: FolderDto | undefined = folder;
    let guard = 0;
    while (cursor !== undefined && guard <= 64) {
      chain.unshift(cursor);
      guard += 1;
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
    pathById.set(folder.id, chain.map((node) => node.name).join(" / "));
    const keys = chain.map((node) => normalizeFolderName(node.name));
    if (keys.every((key) => key !== null)) {
      const key = keys.join("/");
      keyById.set(folder.id, key);
      idByKey.set(key, folder.id);
    }
  }
  return { pathById, keyById, idByKey };
});

const folderIdByPath = computed(() => folderIndex.value.idByKey);

function folderPath(folderId: string): string {
  return folderIndex.value.pathById.get(folderId) ?? "";
}

const importBaseFolder = computed(
  () => workspace.folders.find((folder) => folder.id === importBaseFolderId.value) ?? null,
);
/** base 的归一化路径键;祖先链里有非法段时是 null,此时不自动建子目录。 */
const importBaseKey = computed(() => {
  const folder = importBaseFolder.value;
  return folder === null ? null : (folderIndex.value.keyById.get(folder.id) ?? null);
});
/** base 在树里的层级(根为 1);服务端 MAX_FOLDER_DEPTH 也按这个算。 */
const importBaseLevel = computed(() => {
  const byId = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  let level = 0;
  let cursor: FolderDto | null | undefined = importBaseFolder.value;
  while (cursor !== null && cursor !== undefined && level < 64) {
    level += 1;
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return level;
});
const importBaseDisplayPath = computed(() => {
  const folder = importBaseFolder.value;
  return folder === null ? null : folderPath(folder.id);
});

/** 待创建目录的完整展示路径:base 和相对路径都用 " / " 分段。 */
function pendingFolderLabel(path: string): string {
  const prefix = importBaseDisplayPath.value;
  if (prefix === null) return path;
  const suffix = path
    .split("/")
    .filter((segment) => segment !== "")
    .join(" / ");
  return `${prefix} / ${suffix}`;
}

/** 按树序展开成可渲染的行;搜索时只保留命中节点和它们的祖先,并强制展开。 */
const folderTreeRows = computed<FolderTreeRow[]>(() => {
  const query = normalizedFolderQuery.value;
  const byId = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  const visible = new Set<string>();
  if (query !== "") {
    for (const folder of workspace.folders) {
      if (!folder.name.toLocaleLowerCase("zh-CN").includes(query)) continue;
      let cursor: FolderDto | undefined = folder;
      let guard = 0;
      while (cursor !== undefined && guard <= 64) {
        visible.add(cursor.id);
        guard += 1;
        cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
      }
    }
  }
  const rows: FolderTreeRow[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const folder of folderChildren.value.get(parentId ?? "") ?? []) {
      if (query !== "" && !visible.has(folder.id)) continue;
      const children = folderChildren.value.get(folder.id) ?? [];
      rows.push({ folder, depth, hasChildren: children.length > 0 });
      if (query !== "" || expandedFolderIds.value.has(folder.id)) walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
});

/** 下拉选择器用全量树,不受搜索和展开状态影响。 */
const folderSelectOptions = computed<Array<{ id: string; path: string; depth: number }>>(() => {
  const options: Array<{ id: string; path: string; depth: number }> = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const folder of folderChildren.value.get(parentId ?? "") ?? []) {
      options.push({ id: folder.id, path: folderPath(folder.id), depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return options;
});

/** 过滤后列表是子集,下标映射不到全量顺序,搜索时直接禁用拖拽。 */
const canReorderFolders = computed(
  () => canEdit.value && normalizedFolderQuery.value === "" && !workspace.mutating,
);
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
/** 文件夹计数按整棵子树聚合,侧栏能看出文件夹总共装了多少文档。 */
const folderSubtreeCounts = computed(() => {
  const counts = new Map<string, number>();
  const sum = (folderId: string, guard: number): number => {
    let total = documentCounts.value.get(folderId) ?? 0;
    if (guard <= 64) {
      for (const child of folderChildren.value.get(folderId) ?? []) {
        total += sum(child.id, guard + 1);
      }
    }
    counts.set(folderId, total);
    return total;
  };
  for (const root of folderChildren.value.get("") ?? []) sum(root.id, 0);
  return counts;
});
/** 右侧内容区展示当前文件夹的直接子文件夹,点击继续下钻。 */
const directChildFolders = computed<FolderDto[]>(() => {
  if (selectedFolder.value === null) return [];
  return folderChildren.value.get(selectedFolder.value.id) ?? [];
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
  // 选中文件夹只看直接属于它的文档;子文件夹在内容区单独列出,点击再下钻。
  return workspace.documents.filter((document) => document.folderId === selectedFolderId.value);
});
const visibleDocuments = computed(() => {
  const query = documentSearch.value.trim().toLocaleLowerCase("zh-CN");
  if (query === "") return scopedDocuments.value;
  return scopedDocuments.value.filter((document) =>
    document.name.toLocaleLowerCase("zh-CN").includes(query),
  );
});
const documentPageCount = computed(() =>
  Math.max(1, Math.ceil(visibleDocuments.value.length / documentPageSize.value)),
);
const pagedDocuments = computed(() => {
  const start = (documentPage.value - 1) * documentPageSize.value;
  return visibleDocuments.value.slice(start, start + documentPageSize.value);
});
const pageNumbers = computed(() =>
  Array.from({ length: documentPageCount.value }, (_, index) => index + 1),
);
watch([selectedFolderId, documentSearch, documentPageSize, () => workspace.sort], () => {
  documentPage.value = 1;
});
watch(documentPageCount, (count) => {
  if (documentPage.value > count) documentPage.value = count;
});

function goToDocumentPage(page: number): void {
  documentPage.value = Math.min(Math.max(1, page), documentPageCount.value);
}

const showLibraryLayout = computed(
  () =>
    !workspace.loading &&
    workspace.error?.code !== "PERMISSION_DENIED" &&
    workspace.hasData,
);
const documentEmptyMessage = computed(() => {
  if (documentSearch.value.trim() !== "") return "没有匹配的文档。";
  if (selectedFolderId.value !== "all") return "此文件夹还没有文档。";
  return "暂无文档。";
});
const hasDocumentResults = computed(
  () => visibleDocuments.value.length > 0 || directChildFolders.value.length > 0,
);

function folderLabel(folderId: string | null | undefined): string {
  if (folderId === null || folderId === undefined) return "未归档";
  return folderPath(folderId) || "未归档";
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
  return folderSubtreeCounts.value.get(folderId) ?? 0;
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
  // 从内容区的子文件夹卡片进入时,顺便在侧栏展开祖先,保持两边状态一致。
  const byId = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  const next = new Set(expandedFolderIds.value);
  let cursor: FolderDto | undefined = byId.get(folderId);
  let guard = 0;
  while (cursor?.parentId != null && guard <= 64) {
    next.add(cursor.parentId);
    cursor = byId.get(cursor.parentId);
    guard += 1;
  }
  expandedFolderIds.value = next;
}

function openCreateFolder(parentId: string | null = null): void {
  dialogKind.value = "folder";
  editingFolderId.value = null;
  editingDocumentId.value = null;
  creatingFolderParentId.value = parentId;
  form.name = "";
  form.folderId = "";
  dialogOpen.value = true;
}

function toggleFolderExpanded(folderId: string): void {
  const next = new Set(expandedFolderIds.value);
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  expandedFolderIds.value = next;
}

/** 目标是不是源自己或源的后代,用来拦掉「拖进自己的子树」这种非法移动。 */
function isSelfOrDescendant(folderId: string, ancestorId: string): boolean {
  const byId = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  let cursor: FolderDto | undefined = byId.get(folderId);
  let guard = 0;
  while (cursor !== undefined && guard <= 64) {
    if (cursor.id === ancestorId) return true;
    guard += 1;
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return false;
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

function conflictNamesFromError(): string[] {
  const value = workspace.error?.details.conflictingNames;
  if (!Array.isArray(value)) return [];
  return value.filter((name): name is string => typeof name === "string");
}

/** 改名后先把旧的 409 横幅收掉;行级冲突提示仍保留到对应名称被改掉。 */
function clearImportNameError(): void {
  if (workspace.error?.code === "DOCUMENT_NAME_CONFLICT") workspace.error = null;
}

function openImport(): void {
  // 选中「全部文件」或「未归档」时 selectedFolder 为 null,退回原来的行为。
  importBaseFolderId.value = selectedFolder.value?.id ?? null;
  importRows.value = [];
  importSummary.value = null;
  serverConflictNames.value = [];
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
  const baseFolder = importBaseFolder.value;
  const baseId = baseFolder?.id ?? null;
  const baseKey = importBaseKey.value;
  const rootName = collected.roots.length === 1 ? (collected.roots[0] ?? "") : "";
  const rootKey = rootName === "" ? null : normalizeFolderName(rootName);
  // 在 IM 里导入磁盘上的 IM 时,别把根目录名再套成 IM/IM。
  const stripRoot =
    baseFolder !== null && rootKey !== null && rootKey === normalizeFolderName(baseFolder.name);
  for (const [index, entry] of fresh.entries()) {
    const rawFolderPath = importFolderPath(entry.path);
    const entryFolderPath = stripRoot
      ? rawFolderPath
          .split("/")
          .filter((segment) => segment !== "")
          .slice(1)
          .join("/")
      : rawFolderPath;
    const key = normalizeFolderPath(entryFolderPath);
    const lookupKey =
      key === null
        ? undefined
        : baseKey === null
          ? (baseId === null ? key : undefined)
          : key === ""
            ? baseKey
            : `${baseKey}/${key}`;
    const existingId = lookupKey === undefined ? undefined : folderIdByPath.value.get(lookupKey);
    importRows.value.push({
      id: nextImportRowId,
      path: entry.path,
      file: entry.file,
      name: names[index] ?? entry.file.name,
      folderPath: entryFolderPath,
      folderValue:
        existingId !== undefined
          ? `id:${existingId}`
          : entryFolderPath === ""
            ? baseId === null
              ? ""
              : `id:${baseId}`
            : `path:${entryFolderPath}`,
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

/**
 * 按目录自动归档:把 "path:" 的行从 base 往下逐级落成真实文件夹。
 * 撞名(别处刚建了同名)就重拉列表复用;层级超限/名字超长/数量到顶则放弃,
 * 该路径下的行退回 base(没选文件夹时才是未归档),不让整批导入失败。
 */
async function ensureFolderPath(
  path: string,
  baseId: string | null,
  baseKey: string | null,
  baseLevel: number,
): Promise<string | null> {
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return baseId;
  // 服务端限制整棵树最深 8 层,base 已经占掉的层级要算进去。
  if (baseLevel + segments.length > IMPORT_FOLDER_MAX_DEPTH) return null;
  // base 的路径键算不出来就解释不了冲突,宁可整体退回 base 也别在根下建重名目录。
  if (baseId !== null && baseKey === null) return null;
  let parentId: string | null = baseId;
  let key = baseKey ?? "";
  for (const segment of segments) {
    const segmentKey = normalizeFolderName(segment);
    if (segmentKey === null) return null;
    key = key === "" ? segmentKey : `${key}/${segmentKey}`;
    const existing = folderIdByPath.value.get(key);
    if (existing !== undefined) {
      parentId = existing;
      continue;
    }
    const folder = await workspace.createFolder(segment, parentId);
    if (folder === null) {
      if (workspace.error?.code === "FOLDER_NAME_CONFLICT") {
        await workspace.reloadFolders();
        const retry = folderIdByPath.value.get(key);
        if (retry !== undefined) {
          parentId = retry;
          continue;
        }
      }
      return null;
    }
    parentId = folder.id;
  }
  return parentId;
}

async function prepareImportFolders(): Promise<void> {
  const baseFolder = importBaseFolder.value;
  const baseId = baseFolder?.id ?? null;
  const baseKey = importBaseKey.value;
  const baseLevel = importBaseLevel.value;
  // 弹窗开着时 base 不该消失(模态挡住了删除),真丢了也别把行指向不存在的目录。
  if (importBaseFolderId.value !== null && baseId === null) {
    const stale = `id:${importBaseFolderId.value}`;
    for (const row of importRows.value) {
      if (row.folderValue === stale) row.folderValue = "";
    }
  }
  let abandoned = 0;
  for (const path of pendingImportFolderPaths.value) {
    const folderId = await ensureFolderPath(path, baseId, baseKey, baseLevel);
    for (const row of importRows.value) {
      if (row.folderValue !== `path:${path}`) continue;
      row.folderValue =
        folderId !== null ? `id:${folderId}` : baseId === null ? "" : `id:${baseId}`;
    }
    if (folderId === null) abandoned += 1;
  }
  if (abandoned > 0) {
    const fallback = baseId === null ? "未归档" : `归入「${baseFolder?.name ?? ""}」`;
    importSummary.value = `${importSummary.value ?? ""}有 ${String(abandoned)} 个目录无法自动创建，相关文件改为${fallback}。`;
  }
}

async function submitImport(): Promise<void> {
  if (!canSubmitImport.value) return;
  serverConflictNames.value = [];
  await prepareImportFolders();
  const ok = await workspace.importFiles(
    importRows.value.map((row) => ({
      file: row.file,
      targetName: row.name,
      targetFolderId: row.folderValue.startsWith("id:") ? row.folderValue.slice(3) : null,
    })),
  );
  if (ok) closeImportDialog();
  else serverConflictNames.value = conflictNamesFromError();
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

const MENU_GAP = 6;
const MENU_ITEM_HEIGHT = 40;
const MENU_CHROME_HEIGHT = 12;

/**
 * 计算 fixed 菜单坐标。空间不够时向上展开,并夹在视口内。
 * 宽度用于右对齐,高度用于判断下方空间。
 */
function menuPosition(
  event: MouseEvent,
  width: number,
  height: number,
): Record<string, string> | null {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return null;
  const rect = target.getBoundingClientRect();
  const flipUp = rect.bottom + MENU_GAP + height > window.innerHeight && rect.top > height;
  const top = flipUp ? rect.top - height - MENU_GAP : rect.bottom + MENU_GAP;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const left = Math.min(Math.max(8, rect.right - width), maxLeft);
  return { top: `${String(Math.round(top))}px`, left: `${String(Math.round(left))}px` };
}

function closeMenus(): void {
  moreMenuDocumentId.value = null;
  moreMenuFolderId.value = null;
}

function toggleDocumentMenu(documentId: string, event: MouseEvent): void {
  const opening = moreMenuDocumentId.value !== documentId;
  moreMenuDocumentId.value = opening ? documentId : null;
  if (!opening) {
    documentMenuStyle.value = null;
    return;
  }
  moreMenuFolderId.value = null;
  const itemCount = canEdit.value ? 3 : 1;
  documentMenuStyle.value = menuPosition(
    event,
    180,
    itemCount * MENU_ITEM_HEIGHT + MENU_CHROME_HEIGHT,
  );
}

function toggleFolderMenu(folderId: string, event: MouseEvent): void {
  const opening = moreMenuFolderId.value !== folderId;
  moreMenuFolderId.value = opening ? folderId : null;
  if (!opening) {
    folderMenuStyle.value = null;
    return;
  }
  moreMenuDocumentId.value = null;
  folderMenuStyle.value = menuPosition(event, 150, 3 * MENU_ITEM_HEIGHT + MENU_CHROME_HEIGHT);
}

function createSubfolder(folderId: string): void {
  moreMenuFolderId.value = null;
  openCreateFolder(folderId);
}

function renameFolderFromMenu(folderId: string, name: string): void {
  moreMenuFolderId.value = null;
  openRenameFolder(folderId, name);
}

async function deleteFolderFromMenu(folderId: string, name: string): Promise<void> {
  moreMenuFolderId.value = null;
  await deleteFolder(folderId, name);
}

function exportDocumentFromMenu(documentId: string): void {
  moreMenuDocumentId.value = null;
  void workspace.exportDocument(documentId);
}

function editDocumentFromMenu(
  documentId: string,
  name: string,
  folderId: string | null | undefined,
): void {
  moreMenuDocumentId.value = null;
  openDocument(documentId, name, folderId ?? null);
}

async function deleteDocument(documentId: string, name: string): Promise<void> {
  if (!globalThis.confirm(`删除后不可恢复，确定删除「${name}」吗？`)) return;
  if (await workspace.deleteDocument(documentId)) moreMenuDocumentId.value = null;
}

async function deleteFolder(folderId: string, name: string): Promise<void> {
  const counts = await workspace.checkFolderDelete(folderId);
  if (counts === null) return;
  const details: string[] = [];
  if (counts.descendantFolderCount > 0) {
    details.push(`${String(counts.descendantFolderCount)} 个子文件夹`);
  }
  if (counts.documentCount > 0) details.push(`${String(counts.documentCount)} 篇文档`);
  const message =
    details.length === 0
      ? `确定删除空文件夹「${name}」吗？`
      : `删除后不可恢复，将同时永久删除 ${details.join("、")}。确定删除「${name}」吗？`;
  if (!globalThis.confirm(message)) return;
  const selectionWasInside =
    selectedFolderId.value === folderId ||
    (selectedFolderId.value !== "all" &&
      selectedFolderId.value !== "unassigned" &&
      isSelfOrDescendant(selectedFolderId.value, folderId));
  if (await workspace.deleteFolder(folderId, counts.documentCount)) {
    if (selectionWasInside) selectedFolderId.value = "all";
  }
}

function folderDragStart(event: DragEvent, folderId: string): void {
  if (!canReorderFolders.value) {
    event.preventDefault();
    return;
  }
  draggingFolderId.value = folderId;
  folderDropMode.value = "before";
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // 只在拖出侧边栏时有用;内部排序不读它,所以测试不用造 DataTransfer。
    event.dataTransfer.setData("text/plain", folderId);
  }
}

function siblingIdsOf(parentId: string | null): string[] {
  return workspace.folders
    .filter((folder) => (folder.parentId ?? null) === parentId)
    .map((folder) => folder.id);
}

/**
 * 行上分三段:上 30% 插到前面、下 30% 插到后面、中间放进文件夹。
 * 目标在源的子树里时不允许「放进」,退化成插到后面。
 */
function folderDragOver(event: DragEvent, folderId: string): void {
  if (draggingFolderId.value === null || draggingFolderId.value === folderId) return;
  const row = event.currentTarget as HTMLElement | null;
  const rect = row?.getBoundingClientRect();
  dragOverFolderId.value = folderId;
  if (rect === undefined || rect.height <= 0) {
    folderDropMode.value = "before";
    return;
  }
  const ratio = (event.clientY - rect.top) / rect.height;
  if (ratio < 0.3) folderDropMode.value = "before";
  else if (ratio > 0.7) folderDropMode.value = "after";
  else {
    folderDropMode.value = isSelfOrDescendant(folderId, draggingFolderId.value)
      ? "after"
      : "inside";
  }
}

function folderDragLeave(folderId: string): void {
  if (dragOverFolderId.value !== folderId) return;
  dragOverFolderId.value = null;
  folderDropMode.value = "before";
}

function resetFolderDragState(): void {
  draggingFolderId.value = null;
  dragOverFolderId.value = null;
  folderDropMode.value = "before";
}

async function folderDrop(event: DragEvent, targetId: string): Promise<void> {
  event.preventDefault();
  const sourceId = draggingFolderId.value;
  const mode = folderDropMode.value;
  resetFolderDragState();
  if (sourceId === null || sourceId === targetId) return;
  const byId = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  const source = byId.get(sourceId);
  const target = byId.get(targetId);
  if (source === undefined || target === undefined) return;

  if (mode === "inside") {
    if (isSelfOrDescendant(targetId, sourceId)) return;
    if (await workspace.moveFolder(sourceId, targetId)) {
      expandedFolderIds.value = new Set([...expandedFolderIds.value, targetId]);
    }
    return;
  }

  const parentId = target.parentId ?? null;
  const ids = siblingIdsOf(parentId).filter((id) => id !== sourceId);
  const at = ids.indexOf(targetId);
  if (at < 0) return;
  ids.splice(mode === "after" ? at + 1 : at, 0, sourceId);
  if ((source.parentId ?? null) !== parentId) {
    if (!(await workspace.moveFolder(sourceId, parentId))) return;
  }
  await workspace.reorderFolders(parentId, ids);
}

/** 拖到「全部文件」＝移回顶层。 */
async function folderDropOnRoot(event: DragEvent): Promise<void> {
  event.preventDefault();
  const sourceId = draggingFolderId.value;
  resetFolderDragState();
  if (sourceId === null) return;
  const source = workspace.folders.find((folder) => folder.id === sourceId);
  if (source === undefined || (source.parentId ?? null) === null) return;
  const ids = siblingIdsOf(null).filter((id) => id !== sourceId);
  ids.push(sourceId);
  if (!(await workspace.moveFolder(sourceId, null))) return;
  await workspace.reorderFolders(null, ids);
}

async function submitDialog(): Promise<void> {
  const name = form.name.trim();
  if (name === "") return;
  const createdFolder =
    dialogKind.value === "folder" && editingFolderId.value === null
      ? await workspace.createFolder(name, creatingFolderParentId.value)
      : null;
  if (createdFolder !== null && creatingFolderParentId.value !== null) {
    expandedFolderIds.value = new Set([...expandedFolderIds.value, creatingFolderParentId.value]);
  }
  const succeeded =
    dialogKind.value === "folder"
      ? editingFolderId.value === null
        ? createdFolder !== null
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

onMounted(() => {
  void load().then(runQuickAction);
  window.addEventListener("scroll", closeMenus, true);
  window.addEventListener("resize", closeMenus);
});
onUnmounted(() => {
  window.removeEventListener("scroll", closeMenus, true);
  window.removeEventListener("resize", closeMenus);
});
</script>

<template>
  <section class="workspace-home" aria-labelledby="workspace-title">
    <h1 v-if="workspace.loading" id="workspace-title" class="visually-hidden">用例库</h1>
    <LibraryHeader
      v-if="!workspace.loading && !showLibraryLayout"
      :folder-chain="selectedFolderChain"
      :label="selectedFolderLabel"
      :description="libraryDescription"
      :can-edit="canEdit"
      :is-reader="auth.role === 'reader'"
      :unread-count="workspace.unreadCount"
      @select-all="selectAllDocuments"
      @select-folder="selectFolder"
      @create-folder="openCreateFolder()"
      @create-document="openDocument(null)"
      @import-xmind="openImport"
      @request-edit="workspace.requestEditPermission()"
      @open-notifications="openNotifications"
      @refresh="load"
    />

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
            @click="openCreateFolder()"
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
          <li @dragover.prevent @drop.prevent="folderDropOnRoot">
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
          <li v-if="folderTreeRows.some((row) => row.depth === 0)" class="library-tree__group">
            一级文件夹
          </li>
          <li
            v-for="row in folderTreeRows"
            :key="row.folder.id"
            class="library-tree__folder"
            :class="{ 'library-tree__folder--dragging': draggingFolderId === row.folder.id }"
            :draggable="canReorderFolders"
            @dragstart="folderDragStart($event, row.folder.id)"
            @dragover.prevent="folderDragOver($event, row.folder.id)"
            @dragleave="folderDragLeave(row.folder.id)"
            @drop.prevent="folderDrop($event, row.folder.id)"
            @dragend="resetFolderDragState"
          >
            <div
              class="library-tree__row"
              :style="{ paddingLeft: `${row.depth * 18}px` }"
              :class="{
                'library-tree__row--active': selectedFolderId === row.folder.id,
                'library-tree__row--drop-before':
                  dragOverFolderId === row.folder.id && folderDropMode === 'before',
                'library-tree__row--drop-after':
                  dragOverFolderId === row.folder.id && folderDropMode === 'after',
                'library-tree__row--drop-inside':
                  dragOverFolderId === row.folder.id && folderDropMode === 'inside',
              }"
            >
              <button
                v-if="row.hasChildren"
                class="library-tree__toggle"
                type="button"
                :aria-label="`${expandedFolderIds.has(row.folder.id) ? '收起' : '展开'} ${row.folder.name}`"
                :aria-expanded="expandedFolderIds.has(row.folder.id)"
                @click="toggleFolderExpanded(row.folder.id)"
              >
                <ElIcon>
                  <ArrowDown v-if="expandedFolderIds.has(row.folder.id)" />
                  <ArrowRight v-else />
                </ElIcon>
              </button>
              <span v-else class="library-tree__spacer" aria-hidden="true" />
              <button
                class="library-tree__item"
                type="button"
                @click="selectFolder(row.folder.id)"
              >
                <Folder aria-hidden="true" />
                <span class="library-tree__name" :title="row.folder.name">{{ row.folder.name }}</span>
                <span
                  class="library-tree__count"
                  :title="`已加载 ${folderCount(row.folder.id)} 篇`"
                  >{{ folderCount(row.folder.id) }}</span
                >
              </button>
              <button
                v-if="canEdit"
                class="library-tree__more"
                type="button"
                :aria-label="`更多操作 ${row.folder.name}`"
                :aria-expanded="moreMenuFolderId === row.folder.id"
                @click.stop="toggleFolderMenu(row.folder.id, $event)"
              >
                <MoreFilled />
              </button>
              <div
                v-if="canEdit && moreMenuFolderId === row.folder.id"
                class="popover-menu library-tree__menu library-tree__menu--fixed"
                :style="folderMenuStyle ?? undefined"
              >
                <button type="button" @click="createSubfolder(row.folder.id)">
                  新建子文件夹
                </button>
                <button
                  type="button"
                  @click="renameFolderFromMenu(row.folder.id, row.folder.name)"
                >
                  重命名
                </button>
                <button
                  type="button"
                  class="library-tree__menu-delete"
                  @click="deleteFolderFromMenu(row.folder.id, row.folder.name)"
                >
                  删除
                </button>
              </div>
            </div>
          </li>
        </ul>
        <div v-if="workspace.folders.length === 0" class="library-sidebar__empty">
          <p>暂无文件夹</p>
          <ElButton v-if="canEdit" size="small" @click="openCreateFolder()">
            <Plus aria-hidden="true" />新建文件夹
          </ElButton>
        </div>
        <p v-else-if="folderTreeRows.length === 0" class="library-sidebar__empty">
          没有匹配的文件夹
        </p>
        <p class="library-sidebar__hint">文件夹数量基于已加载的文档统计。</p>
      </aside>

      <section class="library-content" aria-labelledby="documents-heading">
        <LibraryHeader
          :folder-chain="selectedFolderChain"
          :label="selectedFolderLabel"
          :description="libraryDescription"
          :can-edit="canEdit"
          :is-reader="auth.role === 'reader'"
          :unread-count="workspace.unreadCount"
          @select-all="selectAllDocuments"
          @select-folder="selectFolder"
          @create-folder="openCreateFolder()"
          @create-document="openDocument(null)"
          @import-xmind="openImport"
          @request-edit="workspace.requestEditPermission()"
          @open-notifications="openNotifications"
          @refresh="load"
        />
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
            <span
              class="sort-direction"
              :title="workspace.sort === 'name' ? '名称正序' : '更新时间倒序'"
              aria-hidden="true"
            >
              <ArrowUp v-if="workspace.sort === 'name'" />
              <ArrowDown v-else />
            </span>
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
          </div>
        </div>

        <section
          v-if="directChildFolders.length > 0"
          class="library-subfolders"
          aria-label="子文件夹"
        >
          <button
            v-for="child in directChildFolders"
            :key="child.id"
            class="library-subfolder"
            type="button"
            @click="selectFolder(child.id)"
          >
            <Folder aria-hidden="true" />
            <span class="library-subfolder__name">{{ child.name }}</span>
            <span class="library-subfolder__count">{{ folderCount(child.id) }} 篇</span>
          </button>
        </section>

        <div v-if="!hasDocumentResults" class="content-state library-empty">
          <Document class="state-icon" aria-hidden="true" />
          <p>{{ documentEmptyMessage }}</p>
        </div>
        <p
          v-else-if="visibleDocuments.length === 0"
          class="library-inline-empty"
          role="status"
        >
          {{ documentEmptyMessage }}
        </p>
        <div v-else-if="viewMode === 'list'" class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">版本</th>
                <th scope="col">节点数</th>
                <th scope="col">最后更新</th>
                <th scope="col" class="doc-table__actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="document in pagedDocuments" :key="document.id">
                <td>
                  <div class="doc-table__name">
                    <span class="doc-table__icon" aria-hidden="true"><Document /></span>
                    <div class="doc-table__body">
                      <div class="doc-table__title-row">
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
                            :aria-label="
                              getCompatibilityMeta(document.compatibilityStatus).description
                            "
                            tabindex="0"
                          >
                            <ElTag
                              size="small"
                              :type="document.compatibilityStatus === 'full' ? 'success' : 'warning'"
                            >
                              {{ getCompatibilityMeta(document.compatibilityStatus).label }}
                            </ElTag>
                          </span>
                        </div>
                      </div>
                      <div class="doc-table__path">{{ folderLabel(document.folderId) }}</div>
                    </div>
                  </div>
                </td>
                <td>v{{ document.currentVersion }}</td>
                <td>{{ document.nodeCount }}</td>
                <td class="doc-table__updated">{{ formatDateTime(document.updatedAt) }}</td>
                <td>
                  <div class="doc-table__actions">
                    <button
                      class="doc-table__more"
                      type="button"
                      :aria-label="`更多操作 ${document.name}`"
                      :aria-expanded="moreMenuDocumentId === document.id"
                      @click="toggleDocumentMenu(document.id, $event)"
                    >
                      <MoreFilled />
                    </button>
                    <div
                      v-if="moreMenuDocumentId === document.id"
                      class="popover-menu doc-table__menu doc-table__menu--fixed"
                      :style="documentMenuStyle ?? undefined"
                    >
                      <button type="button" @click="exportDocumentFromMenu(document.id)">
                        导出 XMind
                      </button>
                      <button
                        v-if="canEdit"
                        type="button"
                        @click="editDocumentFromMenu(document.id, document.name, document.folderId)"
                      >
                        编辑元数据
                      </button>
                      <button
                        v-if="canEdit"
                        type="button"
                        class="doc-table__menu-delete"
                        @click="deleteDocument(document.id, document.name)"
                      >
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
            v-for="document in pagedDocuments"
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
                  {{ getCompatibilityMeta(document.compatibilityStatus).label }}
                </ElTag>
              </span>
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
                @click="toggleDocumentMenu(document.id, $event)"
              >
                <MoreFilled />
              </button>
              <div
                v-if="moreMenuDocumentId === document.id"
                class="popover-menu workspace-document-card__menu workspace-document-card__menu--fixed"
                :style="documentMenuStyle ?? undefined"
              >
                <button type="button" @click="deleteDocument(document.id, document.name)">
                  删除文档
                </button>
              </div>
            </div>
          </article>
        </div>

        <footer class="library-footer">
          <div class="library-footer__summary">
            <span
              >共 {{ visibleDocuments.length
              }}{{ workspace.documentCursor === null ? "" : "+" }} 篇</span
            >
            <ElButton v-if="workspace.documentCursor" text @click="workspace.loadMoreDocuments"
              >加载更多</ElButton
            >
          </div>
          <div v-if="visibleDocuments.length > 0" class="library-pagination">
            <button
              class="library-pagination__arrow"
              type="button"
              aria-label="上一页"
              :disabled="documentPage === 1"
              @click="goToDocumentPage(documentPage - 1)"
            >
              <ArrowLeft aria-hidden="true" />
            </button>
            <button
              v-for="pageNumber in pageNumbers"
              :key="pageNumber"
              class="library-pagination__page"
              :class="{ 'library-pagination__page--active': pageNumber === documentPage }"
              type="button"
              :aria-label="`第 ${String(pageNumber)} 页`"
              :aria-current="pageNumber === documentPage ? 'page' : undefined"
              @click="goToDocumentPage(pageNumber)"
            >
              {{ pageNumber }}
            </button>
            <button
              class="library-pagination__arrow"
              type="button"
              aria-label="下一页"
              :disabled="documentPage === documentPageCount"
              @click="goToDocumentPage(documentPage + 1)"
            >
              <ArrowRight aria-hidden="true" />
            </button>
            <select v-model.number="documentPageSize" aria-label="每页条数">
              <option :value="20">20 条/页</option>
              <option :value="50">50 条/页</option>
              <option :value="100">100 条/页</option>
            </select>
          </div>
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
            <ElInput
              v-model="row.name"
              maxlength="100"
              aria-label="目标文档名"
              @input="clearImportNameError"
            />
            <select v-model="row.folderValue" aria-label="目标文件夹">
              <option value="">未归档</option>
              <option
                v-for="option in folderSelectOptions"
                :key="option.id"
                :value="`id:${option.id}`"
              >
                {{ option.path }}
              </option>
              <option
                v-for="path in pendingImportFolderPaths"
                :key="`new:${path}`"
                :value="`path:${path}`"
              >
                新建：{{ pendingFolderLabel(path) }}
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
          <label for="workspace-document-folder">文件夹</label>
          <select id="workspace-document-folder" v-model="form.folderId">
            <option value="">未归档</option>
            <option v-for="option in folderSelectOptions" :key="option.id" :value="option.id">
              {{ option.path }}
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
