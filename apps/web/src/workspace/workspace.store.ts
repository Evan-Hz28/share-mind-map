import {
  adminListAuditLogs,
  adminListEditPermissionRequests,
  adminReadStorageUsage,
  approveEditPermissionRequest,
  createBlankDocument,
  createEditPermissionRequest,
  createFolder,
  listDocuments,
  listFolders,
  listNotifications,
  readAllNotifications,
  readNotification,
  renameFolder,
  rejectEditPermissionRequest,
  revokeMemberEditing,
  updateDocumentMetadata,
  type AuditLogDto,
  type DocumentDto,
  type FolderDto,
  type NotificationDto,
  type PermissionRequestDto,
  type StorageUsageDto,
} from "@share-mind-map/api-client";
import { defineStore, type Pinia } from "pinia";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";

interface WorkspaceState {
  workspaceId: string | null;
  folders: FolderDto[];
  documents: DocumentDto[];
  documentCursor: string | null;
  sort: "updatedAt" | "name";
  loading: boolean;
  loadingMore: boolean;
  mutating: boolean;
  error: RequestFailure | null;
  notifications: NotificationDto[];
  unreadCount: number;
  permissionRequests: PermissionRequestDto[];
  auditLogs: AuditLogDto[];
  storage: StorageUsageDto | null;
}

const useWorkspaceStoreDefinition = defineStore("workspace", {
  state: (): WorkspaceState => ({
    workspaceId: null,
    folders: [],
    documents: [],
    documentCursor: null,
    sort: "updatedAt",
    loading: false,
    loadingMore: false,
    mutating: false,
    error: null,
    notifications: [],
    unreadCount: 0,
    permissionRequests: [],
    auditLogs: [],
    storage: null,
  }),
  getters: {
    hasData: (state): boolean => state.folders.length > 0 || state.documents.length > 0,
  },
  actions: {
    async loadWorkspace(workspaceId: string, sort?: "updatedAt" | "name"): Promise<void> {
      const requestedSort = sort ?? this.sort;
      this.workspaceId = workspaceId;
      this.sort = requestedSort;
      this.loading = true;
      this.error = null;
      this.documentCursor = null;
      try {
        const [folders, documents] = await Promise.all([
          listFolders({ client: apiClient, path: { workspaceId } }),
          listDocuments({
            client: apiClient,
            path: { workspaceId },
            query: { sort: requestedSort, limit: 50 },
          }),
        ]);
        if (folders.data === undefined || documents.data === undefined) {
          this.error = toApiFailure(folders.error ?? documents.error);
          return;
        }
        this.folders = folders.data.folders;
        this.documents = documents.data.documents;
        this.documentCursor = documents.data.nextCursor ?? null;
      } catch {
        this.error = toApiFailure(undefined);
      } finally {
        this.loading = false;
      }
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

    async createFolder(name: string): Promise<boolean> {
      if (this.workspaceId === null) return false;
      this.mutating = true;
      this.error = null;
      try {
        const result = await createFolder({
          client: apiClient,
          path: { workspaceId: this.workspaceId },
          body: { name },
        });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        this.folders.push(result.data.folder);
        return true;
      } finally {
        this.mutating = false;
      }
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
        return true;
      } finally {
        this.mutating = false;
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
      const [requests, logs, storage] = await Promise.all([
        adminListEditPermissionRequests({ client: apiClient, query: { status: "pending" } }),
        adminListAuditLogs({ client: apiClient, query: { limit: 50 } }),
        adminReadStorageUsage({ client: apiClient }),
      ]);
      if (requests.data !== undefined) this.permissionRequests = requests.data.requests;
      if (logs.data !== undefined) this.auditLogs = logs.data.logs;
      if (storage.data !== undefined) this.storage = storage.data;
      if (requests.error !== undefined || logs.error !== undefined || storage.error !== undefined) {
        this.error = toApiFailure(requests.error ?? logs.error ?? storage.error);
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
