import {
  adminListAuditLogs,
  adminListEditPermissionRequests,
  adminListImportFailures,
  adminReadStorageUsage,
  approveEditPermissionRequest,
  cancelImportJob,
  checkFolderDelete,
  createBlankDocument,
  createEditPermissionRequest,
  createFolder,
  createImportBatch,
  deleteDocument as deleteWorkspaceDocument,
  deleteFolder as deleteWorkspaceFolder,
  getImportBatch,
  listDocumentCounts,
  listDocuments,
  listFolders,
  listNotifications,
  moveFolder as moveWorkspaceFolder,
  readAllNotifications,
  readNotification,
  renameFolder,
  reorderFolders as reorderWorkspaceFolders,
  rejectEditPermissionRequest,
  retryImportJob,
  revokeMemberEditing,
  updateDocumentMetadata,
  uploadImportJob,
  type AuditLogDto,
  type AdminImportFailureDto,
  type DocumentDto,
  type FolderDto,
  type ImportJobResponseDto,
  type NotificationDto,
  type PermissionRequestDto,
  type StorageUsageDto,
} from "@share-mind-map/api-client";
import { defineStore, type Pinia } from "pinia";
import { io, type Socket } from "socket.io-client";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import { randomUuid } from "../utils/uuid.js";

let importRealtimeSocket: Socket | null = null;

const IMPORT_POLL_INTERVAL_MS = 500;
const IMPORT_TERMINAL_STATUSES = new Set(["succeeded", "partial", "failed", "cancelled"]);

function isImportTerminal(status: string | undefined): boolean {
  return status !== undefined && IMPORT_TERMINAL_STATUSES.has(status);
}

/**
 * 轮询预算。以前是固定 600 次(≈5 分钟),对整目录导入太紧:批量跑完了预算也过期,
 * importProgress 停在非终态,即使全部成功弹窗也不会自动关。改成按任务数放大,
 * 每个任务留 30 秒,上限一小时。
 */
function importPollRounds(totalJobs: number): number {
  return Math.min(Math.max(600, Math.trunc(totalJobs) * 60), 7_200);
}

interface DocumentCountSummary {
  total: number;
  unfiled: number;
  folderCounts: Record<string, number>;
}

interface WorkspaceState {
  workspaceId: string | null;
  folders: FolderDto[];
  documents: DocumentDto[];
  documentCursor: string | null;
  /** 侧栏当前选中的范围:"all" / "unassigned" / 文件夹 id。 */
  activeScope: string;
  /** 文件夹范围自己的分页结果,和全局 documents 分开维护。 */
  scopedDocuments: DocumentDto[];
  scopedCursor: string | null;
  scopedLoading: boolean;
  /** 服务端返回的精确文档计数;null 表示还没拿到。 */
  documentCounts: DocumentCountSummary | null;
  scopeRequestSeq: number;
  sort: "updatedAt" | "name";
  loading: boolean;
  loadingMore: boolean;
  mutating: boolean;
  error: RequestFailure | null;
  notifications: NotificationDto[];
  unreadCount: number;
  permissionRequests: PermissionRequestDto[];
  auditLogs: AuditLogDto[];
  importFailures: AdminImportFailureDto[];
  storage: StorageUsageDto | null;
  importing: boolean;
  importBatchId: string | null;
  importJobs: ImportJobResponseDto[];
  importSourceFiles: Record<string, File>;
  importProgress: {
    status: string;
    totalJobs: number;
    succeededJobs: number;
    failedJobs: number;
    cancelledJobs: number;
  } | null;
}

const useWorkspaceStoreDefinition = defineStore("workspace", {
  state: (): WorkspaceState => ({
    workspaceId: null,
    folders: [],
    documents: [],
    documentCursor: null,
    activeScope: "all",
    scopedDocuments: [],
    scopedCursor: null,
    scopedLoading: false,
    documentCounts: null,
    scopeRequestSeq: 0,
    sort: "updatedAt",
    loading: false,
    loadingMore: false,
    mutating: false,
    error: null,
    notifications: [],
    unreadCount: 0,
    permissionRequests: [],
    auditLogs: [],
    importFailures: [],
    storage: null,
    importing: false,
    importBatchId: null,
    importJobs: [],
    importSourceFiles: {},
    importProgress: null,
  }),
  getters: {
    hasData: (state): boolean => state.folders.length > 0 || state.documents.length > 0,
  },
  actions: {
    async loadWorkspace(workspaceId: string, sort?: "updatedAt" | "name"): Promise<void> {
      const requestedSort = sort ?? this.sort;
      if (this.workspaceId !== null && this.workspaceId !== workspaceId) {
        this.activeScope = "all";
        this.scopedDocuments = [];
        this.scopedCursor = null;
        this.documentCounts = null;
      }
      this.workspaceId = workspaceId;
      this.sort = requestedSort;
      this.loading = true;
      this.error = null;
      this.documentCursor = null;
      try {
        const [folders, documents, counts] = await Promise.all([
          listFolders({ client: apiClient, path: { workspaceId } }),
          listDocuments({
            client: apiClient,
            path: { workspaceId },
            query: { sort: requestedSort, limit: 50 },
          }),
          // 计数是辅助信息,失败时不影响工作区主体加载。
          listDocumentCounts({ client: apiClient, path: { workspaceId } }).catch(() => undefined),
        ]);
        if (folders.data === undefined || documents.data === undefined) {
          this.error = toApiFailure(folders.error ?? documents.error);
          return;
        }
        this.folders = folders.data.folders;
        this.documents = documents.data.documents;
        this.documentCursor = documents.data.nextCursor ?? null;
        if (counts?.data !== undefined) this.applyDocumentCounts(counts.data);
        if (this.activeScope !== "all") await this.loadScopedDocuments(this.activeScope);
      } catch {
        this.error = toApiFailure(undefined);
      } finally {
        this.loading = false;
      }
    },

    applyDocumentCounts(counts: {
      total: number;
      unfiled: number;
      folders: Array<{ folderId: string; documentCount: number }>;
    }): void {
      const folderCounts: Record<string, number> = {};
      for (const folder of counts.folders) folderCounts[folder.folderId] = folder.documentCount;
      this.documentCounts = {
        total: counts.total,
        unfiled: counts.unfiled,
        folderCounts,
      };
    },

    async refreshDocumentCounts(): Promise<void> {
      if (this.workspaceId === null) return;
      try {
        const result = await listDocumentCounts({
          client: apiClient,
          path: { workspaceId: this.workspaceId },
        });
        if (result.data !== undefined) this.applyDocumentCounts(result.data);
      } catch {
        // 计数失败不阻塞已经成功的增删改操作。
      }
    },

    /**
     * 切换侧栏范围。文件夹/未归档由服务端过滤并各自分页,
     * 不再在已经加载的前 50 篇里做客户端筛选。
     */
    async setScope(scope: string): Promise<void> {
      this.activeScope = scope;
      this.scopeRequestSeq += 1;
      this.scopedDocuments = [];
      this.scopedCursor = null;
      this.scopedLoading = false;
      if (scope === "all") return;
      await this.loadScopedDocuments(scope);
    },

    async loadScopedDocuments(scope: string, cursor: string | null = null): Promise<void> {
      if (this.workspaceId === null || scope === "all") return;
      const workspaceId = this.workspaceId;
      const requestSeq = this.scopeRequestSeq + 1;
      this.scopeRequestSeq = requestSeq;
      if (cursor === null) this.scopedDocuments = [];
      this.scopedLoading = true;
      try {
        const query =
          scope === "unassigned"
            ? { sort: this.sort, scope: "unfiled" as const, limit: 50 }
            : { sort: this.sort, scope: "folder" as const, folderId: scope, limit: 50 };
        const result = await listDocuments({
          client: apiClient,
          path: { workspaceId },
          query: { ...query, ...(cursor === null ? {} : { cursor }) },
        });
        if (requestSeq !== this.scopeRequestSeq || this.activeScope !== scope) return;
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return;
        }
        this.scopedDocuments =
          cursor === null
            ? result.data.documents
            : [...this.scopedDocuments, ...result.data.documents];
        this.scopedCursor = result.data.nextCursor ?? null;
      } catch {
        if (requestSeq === this.scopeRequestSeq) this.error = toApiFailure(undefined);
      } finally {
        if (requestSeq === this.scopeRequestSeq) this.scopedLoading = false;
      }
    },

    async loadMoreScopedDocuments(): Promise<void> {
      if (this.activeScope === "all" || this.scopedCursor === null || this.scopedLoading) return;
      await this.loadScopedDocuments(this.activeScope, this.scopedCursor);
    },

    /** 文档增删改后刷新计数;当前正在看文件夹时顺手重拉它的第一页。 */
    async refreshAfterDocumentMutation(): Promise<void> {
      await this.refreshDocumentCounts();
      if (this.activeScope !== "all") await this.loadScopedDocuments(this.activeScope);
    },

    async changeSort(sort: "updatedAt" | "name"): Promise<void> {
      if (this.workspaceId !== null) await this.loadWorkspace(this.workspaceId, sort);
    },

    async loadMoreDocuments(): Promise<void> {
      if (this.workspaceId === null || this.documentCursor === null || this.loadingMore) return;
      this.loadingMore = true;
      try {
        const result = await listDocuments({
          client: apiClient,
          path: { workspaceId: this.workspaceId },
          query: { sort: this.sort, cursor: this.documentCursor, limit: 50 },
        });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return;
        }
        this.documents.push(...result.data.documents);
        this.documentCursor = result.data.nextCursor ?? null;
      } finally {
        this.loadingMore = false;
      }
    },

    async createFolder(name: string, parentId: string | null = null): Promise<FolderDto | null> {
      if (this.workspaceId === null) return null;
      this.mutating = true;
      this.error = null;
      try {
        const result = await createFolder({
          client: apiClient,
          path: { workspaceId: this.workspaceId },
          body: { name, parentId },
        });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return null;
        }
        this.folders.push(result.data.folder);
        return result.data.folder;
      } finally {
        this.mutating = false;
      }
    },

    /** 重新拉一次文件夹列表,用于并发建文件夹撞名之后重新对号。 */
    async reloadFolders(): Promise<void> {
      if (this.workspaceId === null) return;
      const result = await listFolders({
        client: apiClient,
        path: { workspaceId: this.workspaceId },
      });
      if (result.data === undefined) {
        this.error = toApiFailure(result.error);
        return;
      }
      this.folders = result.data.folders;
    },

    async renameFolder(folderId: string, name: string): Promise<boolean> {
      if (this.workspaceId === null) return false;
      this.mutating = true;
      this.error = null;
      try {
        const result = await renameFolder({
          client: apiClient,
          path: { workspaceId: this.workspaceId, folderId },
          body: { name },
        });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        const index = this.folders.findIndex((folder) => folder.id === folderId);
        if (index >= 0) this.folders[index] = result.data.folder;
        return true;
      } finally {
        this.mutating = false;
      }
    },

    async reorderFolders(parentId: string | null, folderIds: string[]): Promise<boolean> {
      if (this.workspaceId === null) return false;
      if (new Set(folderIds).size !== folderIds.length) return false;
      const previous = [...this.folders];
      const byId = new Map(previous.map((folder) => [folder.id, folder]));
      const siblings = previous.filter((folder) => (folder.parentId ?? null) === parentId);
      if (
        siblings.length !== folderIds.length ||
        folderIds.some((id) => byId.get(id) === undefined)
      ) {
        return false;
      }
      // 只替换同级节点占据的位置,其他层级和顺序原样保留。
      let cursor = 0;
      const siblingIds = new Set(folderIds);
      this.folders = previous.map((folder) => {
        if (!siblingIds.has(folder.id)) return folder;
        const next = folderIds[cursor];
        cursor += 1;
        return next === undefined ? folder : (byId.get(next) ?? folder);
      });
      this.mutating = true;
      this.error = null;
      try {
        const result = await reorderWorkspaceFolders({
          client: apiClient,
          path: { workspaceId: this.workspaceId },
          body: { parentId, folderIds },
        });
        if (result.error !== undefined) {
          this.folders = previous;
          this.error = toApiFailure(result.error);
          return false;
        }
        return true;
      } catch {
        this.folders = previous;
        this.error = toApiFailure(undefined);
        return false;
      } finally {
        this.mutating = false;
      }
    },

    async moveFolder(folderId: string, parentId: string | null): Promise<boolean> {
      if (this.workspaceId === null) return false;
      this.mutating = true;
      this.error = null;
      try {
        const result = await moveWorkspaceFolder({
          client: apiClient,
          path: { workspaceId: this.workspaceId, folderId },
          body: { parentId },
        });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        const index = this.folders.findIndex((folder) => folder.id === folderId);
        if (index >= 0) this.folders[index] = result.data.folder;
        return true;
      } finally {
        this.mutating = false;
      }
    },

    async checkFolderDelete(
      folderId: string,
    ): Promise<{ documentCount: number; descendantFolderCount: number } | null> {
      if (this.workspaceId === null) return null;
      this.error = null;
      const result = await checkFolderDelete({
        client: apiClient,
        path: { workspaceId: this.workspaceId, folderId },
      });
      if (result.data === undefined) {
        this.error = toApiFailure(result.error);
        return null;
      }
      return {
        documentCount: result.data.documentCount,
        descendantFolderCount: result.data.descendantFolderCount,
      };
    },

    async deleteFolder(folderId: string, expectedDocumentCount: number): Promise<boolean> {
      if (this.workspaceId === null) return false;
      this.mutating = true;
      this.error = null;
      try {
        const result = await deleteWorkspaceFolder({
          client: apiClient,
          path: { workspaceId: this.workspaceId, folderId },
          query: { expectedDocumentCount },
        });
        if (result.error !== undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        const removed = new Set<string>();
        let frontier = [folderId];
        while (frontier.length > 0) {
          const next: string[] = [];
          for (const id of frontier) {
            if (removed.has(id)) continue;
            removed.add(id);
            for (const child of this.folders) {
              if (child.parentId === id) next.push(child.id);
            }
          }
          frontier = next;
        }
        this.folders = this.folders.filter((folder) => !removed.has(folder.id));
        this.documents = this.documents.filter((document) => {
          const target = document.folderId;
          return target === null || target === undefined || !removed.has(target);
        });
        if (removed.has(this.activeScope)) {
          this.activeScope = "all";
          this.scopedDocuments = [];
          this.scopedCursor = null;
        }
        await this.refreshAfterDocumentMutation();
        return true;
      } finally {
        this.mutating = false;
      }
    },

    async createDocument(name: string, folderId: string | null): Promise<boolean> {
      if (this.workspaceId === null) return false;
      this.mutating = true;
      this.error = null;
      try {
        const result = await createBlankDocument({
          client: apiClient,
          path: { workspaceId: this.workspaceId },
          body: { name, folderId },
        });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        this.documents.unshift(result.data.document);
        await this.refreshAfterDocumentMutation();
        return true;
      } finally {
        this.mutating = false;
      }
    },

    async updateDocument(
      documentId: string,
      input: { name?: string; folderId?: string | null },
    ): Promise<boolean> {
      if (this.workspaceId === null) return false;
      this.mutating = true;
      this.error = null;
      try {
        const result = await updateDocumentMetadata({
          client: apiClient,
          path: { workspaceId: this.workspaceId, documentId },
          body: input,
        });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        const index = this.documents.findIndex((document) => document.id === documentId);
        if (index >= 0) this.documents[index] = result.data.document;
        await this.refreshAfterDocumentMutation();
        return true;
      } finally {
        this.mutating = false;
      }
    },

    async deleteDocument(documentId: string): Promise<boolean> {
      if (this.workspaceId === null) return false;
      this.mutating = true;
      this.error = null;
      try {
        const result = await deleteWorkspaceDocument({
          client: apiClient,
          path: { workspaceId: this.workspaceId, documentId },
        });
        if (result.error !== undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        this.documents = this.documents.filter((document) => document.id !== documentId);
        await this.refreshAfterDocumentMutation();
        return true;
      } finally {
        this.mutating = false;
      }
    },

    async importFiles(
      files: Array<{ file: File; targetName: string; targetFolderId: string | null }>,
    ): Promise<boolean> {
      if (this.workspaceId === null || files.length === 0) return false;
      this.importing = true;
      this.error = null;
      this.importBatchId = null;
      this.importJobs = [];
      this.importSourceFiles = {};
      this.closeImportRealtime();
      try {
        const created = await createImportBatch({
          client: apiClient,
          path: { workspaceId: this.workspaceId },
          body: {
            files: files.map(({ file, targetName, targetFolderId }) => ({
              clientFileName: file.name,
              targetName,
              targetFolderId,
              expectedBytes: file.size,
            })),
          },
        });
        if (created.data === undefined) {
          this.error = toApiFailure(created.error);
          return false;
        }
        const batch = created.data;
        this.importBatchId = batch.id;
        this.importJobs = batch.jobs;
        this.connectImportRealtime(batch.id);
        this.importSourceFiles = Object.fromEntries(
          batch.jobs.flatMap((job, index) => {
            const selection = files[index];
            return selection === undefined ? [] : [[job.id, selection.file]];
          }),
        );
        this.importProgress = {
          status: batch.status,
          totalJobs: batch.totalJobs,
          succeededJobs: batch.succeededJobs,
          failedJobs: batch.failedJobs,
          cancelledJobs: batch.cancelledJobs,
        };
        for (const [index, job] of batch.jobs.entries()) {
          const selection = files[index];
          if (selection === undefined) continue;
          const upload = await uploadImportJob({
            client: apiClient,
            path: { workspaceId: this.workspaceId, batchId: batch.id, jobId: job.id },
            body: { file: selection.file },
          });
          if (upload.data === undefined) this.error = toApiFailure(upload.error);
        }
        const rounds = importPollRounds(batch.totalJobs);
        for (let attempt = 0; attempt < rounds; attempt += 1) {
          // 实时推送往往已经先把终态写进来了,先看一眼可以少一次往返、也少等一轮。
          if (isImportTerminal(this.importProgress.status)) break;
          const progress = await getImportBatch({
            client: apiClient,
            path: { workspaceId: this.workspaceId, batchId: batch.id },
          });
          if (progress.data !== undefined) {
            this.importProgress = progress.data;
            this.importJobs = progress.data.jobs;
            if (isImportTerminal(progress.data.status)) break;
          }
          await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_INTERVAL_MS));
        }
        await this.loadWorkspace(this.workspaceId);
        this.closeImportRealtime();
        return this.importProgress.status === "succeeded";
      } catch {
        this.error = {
          code: "NETWORK_ERROR",
          message: "网络连接失败。",
          details: {},
          requestId: "",
        };
        return false;
      } finally {
        this.importing = false;
      }
    },

    async cancelImport(jobId: string): Promise<boolean> {
      if (this.workspaceId === null || this.importBatchId === null) return false;
      const result = await cancelImportJob({
        client: apiClient,
        path: { workspaceId: this.workspaceId, batchId: this.importBatchId, jobId },
      });
      if (result.data === undefined) {
        this.error = toApiFailure(result.error);
        return false;
      }
      this.importJobs = this.importJobs.map((job) => (job.id === jobId ? result.data : job));
      await this.refreshImportProgress();
      return true;
    },

    replaceImportSource(jobId: string, file: File): void {
      this.importSourceFiles = { ...this.importSourceFiles, [jobId]: file };
      this.importJobs = this.importJobs.map((job) =>
        job.id === jobId ? { ...job, clientFileName: file.name } : job,
      );
    },

    connectImportRealtime(batchId: string): void {
      this.closeImportRealtime();
      const apiUrl = new URL(apiClient.config.baseUrl, globalThis.location.origin);
      const socket = io(`${apiUrl.origin}/workspace`, {
        path: "/socket.io",
        withCredentials: true,
      });
      importRealtimeSocket = socket;
      const applyProgress = (payload: unknown): void => {
        if (payload === null || typeof payload !== "object") return;
        const state = payload as Record<string, unknown>;
        if (state.id !== batchId || typeof state.status !== "string") return;
        this.importProgress = {
          status: state.status,
          totalJobs: Number(state.total_jobs ?? 0),
          succeededJobs: Number(state.succeeded_jobs ?? 0),
          failedJobs: Number(state.failed_jobs ?? 0),
          cancelledJobs: Number(state.cancelled_jobs ?? 0),
        };
      };
      socket.on("connect", () => {
        socket.emit("import:subscribe", { batchId });
      });
      socket.on("import:progress", applyProgress);
      socket.on("disconnect", () => {
        void this.refreshImportProgress();
      });
      socket.on("connect_error", () => {
        void this.refreshImportProgress();
      });
      socket.on("import:error", (payload: unknown) => {
        if (payload !== null && typeof payload === "object") {
          const error = payload as { code?: unknown; message?: unknown };
          if (typeof error.code === "string" && typeof error.message === "string") {
            this.error = {
              code: error.code,
              message: error.message,
              details: {},
              requestId: "",
            };
          }
        }
      });
    },

    closeImportRealtime(): void {
      importRealtimeSocket?.removeAllListeners();
      importRealtimeSocket?.disconnect();
      importRealtimeSocket = null;
    },

    async refreshImportProgress(): Promise<void> {
      if (this.workspaceId === null || this.importBatchId === null) return;
      const progress = await getImportBatch({
        client: apiClient,
        path: { workspaceId: this.workspaceId, batchId: this.importBatchId },
      });
      if (progress.data !== undefined) {
        this.importProgress = progress.data;
        this.importJobs = progress.data.jobs;
      }
    },

    async retryImport(jobId: string): Promise<boolean> {
      if (this.workspaceId === null || this.importBatchId === null) return false;
      const sourceFile = this.importSourceFiles[jobId];
      if (sourceFile === undefined) {
        this.error = {
          code: "IMPORT_SOURCE_UNAVAILABLE",
          message: "原始文件已不可用，请重新选择并导入。",
          details: {},
          requestId: "",
        };
        return false;
      }
      const retried = await retryImportJob({
        client: apiClient,
        path: { workspaceId: this.workspaceId, batchId: this.importBatchId, jobId },
      });
      if (retried.data === undefined) {
        this.error = toApiFailure(retried.error);
        return false;
      }
      const upload = await uploadImportJob({
        client: apiClient,
        path: { workspaceId: this.workspaceId, batchId: this.importBatchId, jobId },
        body: { file: sourceFile },
      });
      if (upload.data === undefined) {
        this.error = toApiFailure(upload.error);
        return false;
      }
      this.importJobs = this.importJobs.map((job) => (job.id === jobId ? upload.data : job));
      this.importing = true;
      try {
        const rounds = importPollRounds(this.importProgress?.totalJobs ?? 0);
        for (let attempt = 0; attempt < rounds; attempt += 1) {
          if (isImportTerminal(this.importProgress?.status)) break;
          const progress = await getImportBatch({
            client: apiClient,
            path: { workspaceId: this.workspaceId, batchId: this.importBatchId },
          });
          if (progress.data !== undefined) {
            this.importProgress = progress.data;
            this.importJobs = progress.data.jobs;
            if (isImportTerminal(progress.data.status)) break;
          }
          await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_INTERVAL_MS));
        }
        await this.loadWorkspace(this.workspaceId);
        this.closeImportRealtime();
        return this.importProgress?.status === "succeeded";
      } catch {
        this.error = {
          code: "NETWORK_ERROR",
          message: "网络连接失败。",
          details: {},
          requestId: "",
        };
        return false;
      } finally {
        this.importing = false;
      }
    },

    async exportDocument(documentId: string): Promise<boolean> {
      if (this.workspaceId === null) return false;
      try {
        const response = await fetch(
          `${apiClient.config.baseUrl}/api/v1/workspaces/${this.workspaceId}/documents/${documentId}/export`,
          {
            credentials: "include",
            headers: { "X-Request-ID": randomUuid() },
          },
        );
        if (!response.ok) {
          const failure = (await response.json().catch(() => undefined)) as
            | {
                error?: {
                  code: string;
                  message: string;
                  details?: Record<string, unknown>;
                  requestId?: string;
                };
              }
            | undefined;
          this.error =
            failure?.error === undefined
              ? { code: "EXPORT_FAILED", message: "导出失败。", details: {}, requestId: "" }
              : {
                  code: failure.error.code,
                  message: failure.error.message,
                  details: failure.error.details ?? {},
                  requestId: failure.error.requestId ?? "",
                };
          return false;
        }
        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition") ?? "";
        const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
        const name = encodedName === undefined ? "mind-map.xmind" : decodeURIComponent(encodedName);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        URL.revokeObjectURL(link.href);
        return true;
      } catch {
        this.error = {
          code: "NETWORK_ERROR",
          message: "网络连接失败。",
          details: {},
          requestId: "",
        };
        return false;
      }
    },

    async requestEditPermission(): Promise<boolean> {
      if (this.workspaceId === null) return false;
      this.mutating = true;
      this.error = null;
      try {
        const result = await createEditPermissionRequest({
          client: apiClient,
          path: { workspaceId: this.workspaceId },
        });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        return true;
      } finally {
        this.mutating = false;
      }
    },

    async loadNotifications(): Promise<void> {
      const result = await listNotifications({ client: apiClient, query: { limit: 50 } });
      if (result.data === undefined) {
        this.error = toApiFailure(result.error);
        return;
      }
      this.notifications = result.data.notifications;
      this.unreadCount = result.data.unreadCount;
    },

    async markNotificationRead(notificationId: string): Promise<void> {
      const result = await readNotification({ client: apiClient, path: { notificationId } });
      if (result.error !== undefined) {
        this.error = toApiFailure(result.error);
        return;
      }
      const notification = this.notifications.find((item) => item.id === notificationId);
      if (notification !== undefined && notification.readAt === null) {
        notification.readAt = new Date().toISOString();
        this.unreadCount = Math.max(0, this.unreadCount - 1);
      }
    },

    async markAllNotificationsRead(): Promise<void> {
      const result = await readAllNotifications({ client: apiClient });
      if (result.error !== undefined) {
        this.error = toApiFailure(result.error);
        return;
      }
      for (const notification of this.notifications)
        notification.readAt ??= new Date().toISOString();
      this.unreadCount = 0;
    },

    async loadAdminData(): Promise<void> {
      const [requests, logs, storage, failures] = await Promise.all([
        adminListEditPermissionRequests({ client: apiClient, query: { status: "pending" } }),
        adminListAuditLogs({ client: apiClient, query: { limit: 50 } }),
        adminReadStorageUsage({ client: apiClient }),
        adminListImportFailures({ client: apiClient }),
      ]);
      if (requests.data !== undefined) this.permissionRequests = requests.data.requests;
      if (logs.data !== undefined) this.auditLogs = logs.data.logs;
      if (storage.data !== undefined) this.storage = storage.data;
      if (failures.data !== undefined) this.importFailures = failures.data.failures;
      if (
        requests.error !== undefined ||
        logs.error !== undefined ||
        storage.error !== undefined ||
        failures.error !== undefined
      ) {
        this.error = toApiFailure(requests.error ?? logs.error ?? storage.error ?? failures.error);
      }
    },

    async decideEditRequest(
      requestId: string,
      decision: "approved" | "rejected",
    ): Promise<boolean> {
      const result =
        decision === "approved"
          ? await approveEditPermissionRequest({ client: apiClient, path: { requestId } })
          : await rejectEditPermissionRequest({ client: apiClient, path: { requestId } });
      if (result.data === undefined) {
        this.error = toApiFailure(result.error);
        return false;
      }
      this.permissionRequests = this.permissionRequests.filter(
        (request) => request.id !== requestId,
      );
      return true;
    },

    async revokeEditing(membershipId: string): Promise<boolean> {
      const result = await revokeMemberEditing({ client: apiClient, path: { membershipId } });
      if (result.data === undefined) {
        this.error = toApiFailure(result.error);
        return false;
      }
      return true;
    },
  },
});

export function useWorkspaceStore(pinia?: Pinia): ReturnType<typeof useWorkspaceStoreDefinition> {
  return useWorkspaceStoreDefinition(pinia);
}
