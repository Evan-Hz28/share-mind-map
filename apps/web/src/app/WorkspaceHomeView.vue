<script setup lang="ts">
import { Bell, Document, Edit, Folder, Plus, Sort } from "@element-plus/icons-vue";
import { ElButton, ElDialog, ElIcon, ElInput, ElTag } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";

import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useAuthStore } from "../auth/auth.store.js";
import { useWorkspaceStore } from "../workspace/workspace.store.js";

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const dialogOpen = ref(false);
const dialogKind = ref<"folder" | "document">("folder");
const editingFolderId = ref<string | null>(null);
const editingDocumentId = ref<string | null>(null);
const form = reactive({ name: "", folderId: "" });
const notificationOpen = ref(false);

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

function openCreateFolder(): void {
  dialogKind.value = "folder";
  editingFolderId.value = null;
  editingDocumentId.value = null;
  form.name = "";
  form.folderId = "";
  dialogOpen.value = true;
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

onMounted(() => void load());
</script>

<template>
  <section class="workspace-home" aria-labelledby="workspace-title">
    <header class="page-heading page-heading--with-action">
      <div>
        <p class="eyebrow">工作区</p>
        <h1 id="workspace-title">全部文档</h1>
        <p>浏览一级文件夹和未归档文档。</p>
      </div>
      <div class="workspace-actions">
        <ElButton v-if="auth.role === 'reader'" @click="workspace.requestEditPermission()">
          <ElIcon><Edit /></ElIcon>申请编辑权限
        </ElButton>
        <ElButton v-if="canEdit" type="primary" @click="openCreateFolder">
          <ElIcon><Plus /></ElIcon>新建文件夹
        </ElButton>
        <ElButton v-if="canEdit" type="primary" @click="openDocument(null)">
          <ElIcon><Document /></ElIcon>新建文档
        </ElButton>
      </div>
    </header>

    <RequestErrorAlert :error="workspace.error" />
    <div v-if="quotaMessage !== ''" class="quota-banner" role="status">
      <strong>配额提醒</strong><span>{{ quotaMessage }}</span>
    </div>

    <div class="workspace-toolbar" aria-label="工作台工具栏">
      <span class="workspace-count"
        >{{ workspace.folders.length }} 个文件夹 · {{ workspace.documents.length }} 个文档</span
      >
      <div class="workspace-toolbar__actions">
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
        <button
          class="notification-button"
          type="button"
          aria-label="通知"
          @click="openNotifications"
        >
          <Bell aria-hidden="true" /><span
            v-if="workspace.unreadCount > 0"
            class="notification-count"
            >{{ workspace.unreadCount }}</span
          >
        </button>
      </div>
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
    <div v-else class="workspace-board">
      <section class="workspace-panel" aria-labelledby="folders-heading">
        <header class="workspace-panel__header">
          <h2 id="folders-heading"><Folder aria-hidden="true" />一级文件夹</h2>
          <span>{{ workspace.folders.length }}</span>
        </header>
        <div v-if="workspace.folders.length === 0" class="panel-empty">暂无文件夹</div>
        <ul v-else class="workspace-list">
          <li v-for="folder in workspace.folders" :key="folder.id" class="workspace-list__item">
            <Folder aria-hidden="true" /><span class="workspace-list__name">{{ folder.name }}</span
            ><button
              v-if="canEdit"
              type="button"
              :aria-label="`重命名 ${folder.name}`"
              @click="openRenameFolder(folder.id, folder.name)"
            >
              重命名
            </button>
          </li>
        </ul>
      </section>
      <section
        class="workspace-panel workspace-panel--documents"
        aria-labelledby="documents-heading"
      >
        <header class="workspace-panel__header">
          <h2 id="documents-heading"><Document aria-hidden="true" />文档</h2>
          <span>{{ workspace.documents.length }}</span>
        </header>
        <div v-if="workspace.documents.length === 0" class="panel-empty">暂无未归档文档</div>
        <ul v-else class="workspace-list">
          <li
            v-for="document in workspace.documents"
            :key="document.id"
            class="workspace-list__item"
          >
            <Document aria-hidden="true" /><span class="workspace-list__name"
              ><strong>{{ document.name }}</strong
              ><small
                >版本 {{ document.currentVersion }} · {{ document.nodeCount }} 个节点</small
              ></span
            ><ElTag size="small" type="info">只读快照</ElTag
            ><button
              v-if="canEdit"
              type="button"
              :aria-label="`编辑 ${document.name}`"
              @click="openDocument(document.id, document.name, document.folderId)"
            >
              编辑元数据
            </button>
          </li>
        </ul>
        <ElButton v-if="workspace.documentCursor" text @click="workspace.loadMoreDocuments"
          >加载更多</ElButton
        >
        <p v-if="isAdmin && workspace.permissionRequests.length > 0" class="admin-hint">
          有 {{ workspace.permissionRequests.length }} 条待审批申请，请前往管理面板处理。
        </p>
      </section>
    </div>

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
      <div class="notification-list">
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
