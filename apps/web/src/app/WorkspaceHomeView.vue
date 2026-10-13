<script setup lang="ts">
import {
  Bell,
  Document,
  Edit,
  Folder,
  MoreFilled,
  Plus,
  Sort,
  Upload,
} from "@element-plus/icons-vue";
import { ElButton, ElDialog, ElIcon, ElInput, ElTag } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";

import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useAuthStore } from "../auth/auth.store.js";
import { getCompatibilityMeta } from "../documents/compatibility.js";
import { useWorkspaceStore } from "../workspace/workspace.store.js";

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const dialogOpen = ref(false);
const dialogKind = ref<"folder" | "document">("folder");
const editingFolderId = ref<string | null>(null);
const editingDocumentId = ref<string | null>(null);
const form = reactive({ name: "", folderId: "" });
const notificationOpen = ref(false);
const importDialogOpen = ref(false);
const importRows = ref<Array<{ file: File; name: string; folderId: string }>>([]);
const moreMenuDocumentId = ref<string | null>(null);

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

function openImport(): void {
  importRows.value = [];
  workspace.importProgress = null;
  workspace.importBatchId = null;
  workspace.importJobs = [];
  workspace.importSourceFiles = {};
  workspace.closeImportRealtime();
  importDialogOpen.value = true;
}

function selectImportFiles(event: Event): void {
  const input = event.target as HTMLInputElement;
  importRows.value = [...(input.files ?? [])].map((file) => ({
    file,
    name: file.name.replace(/\.xmind$/iu, ""),
    folderId: "",
  }));
}

async function submitImport(): Promise<void> {
  const ok = await workspace.importFiles(
    importRows.value.map((row) => ({
      file: row.file,
      targetName: row.name,
      targetFolderId: row.folderId || null,
    })),
  );
  if (ok) importDialogOpen.value = false;
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
    <header class="workspace-hero page-heading page-heading--with-action">
      <div class="workspace-hero__intro">
        <div class="workspace-hero__icon" aria-hidden="true"><Folder /></div>
        <div>
          <p class="eyebrow">工作区</p>
          <h1 id="workspace-title">用例库</h1>
          <p>浏览一级文件夹和未归档文档。</p>
        </div>
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

    <div class="workspace-toolbar workspace-toolbar--summary" role="region" aria-label="工作区统计">
      <div class="workspace-toolbar__summary">
        <Document aria-hidden="true" />
        <span class="workspace-count"
          >{{ workspace.folders.length }} 个文件夹 · {{ workspace.documents.length }} 个文档</span
        >
      </div>
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
      <section
        class="workspace-panel workspace-panel--folders"
        aria-labelledby="folders-heading"
      >
        <header class="workspace-panel__header">
          <h2 id="folders-heading"><Folder aria-hidden="true" />一级文件夹</h2>
          <div class="workspace-panel__header-actions">
            <span class="workspace-count-pill">{{ workspace.folders.length }}</span>
            <button
              v-if="canEdit"
              class="workspace-panel__add"
              type="button"
              aria-label="在一级文件夹中新建"
              @click="openCreateFolder"
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
        </header>
        <div v-if="workspace.folders.length === 0" class="panel-empty panel-empty--illustrated">
          <Folder aria-hidden="true" />
          <strong>暂无文件夹</strong>
          <span>创建文件夹来整理你的思维导图文档。</span>
          <ElButton v-if="canEdit" class="panel-empty__action" @click="openCreateFolder">
            <Plus aria-hidden="true" />新建文件夹
          </ElButton>
        </div>
        <ul v-else class="workspace-list workspace-folder-list">
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
          <span class="workspace-count-pill">{{ workspace.documents.length }}</span>
        </header>
        <div v-if="workspace.documents.length === 0" class="panel-empty">暂无未归档文档</div>
        <ul v-else class="workspace-list">
          <li
            v-for="document in workspace.documents"
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
              <small>版本 {{ document.currentVersion }} · {{ document.nodeCount }} 个节点</small>
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
                  >兼容性：{{ getCompatibilityMeta(document.compatibilityStatus).label }}</ElTag
                >
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
                class="workspace-document-card__action workspace-document-card__action--primary"
                v-if="canEdit"
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
      v-model="importDialogOpen"
      title="导入 XMind 文件"
      width="min(92vw, 760px)"
      :close-on-click-modal="false"
    >
      <div class="form-stack" data-testid="xmind-import-dialog">
        <div class="field-group">
          <label for="xmind-files">选择文件（可多选，单个不超过 20 MB）</label>
          <input
            id="xmind-files"
            type="file"
            accept=".xmind"
            multiple
            @change="selectImportFiles"
          />
        </div>
        <div v-if="importRows.length > 0" class="import-list">
          <div
            v-for="(row, index) in importRows"
            :key="row.file.name + row.file.size + index"
            class="import-list__row"
          >
            <span>{{ row.file.name }}</span>
            <ElInput v-model="row.name" maxlength="100" aria-label="目标文档名" />
            <select v-model="row.folderId" aria-label="目标文件夹">
              <option value="">未归档</option>
              <option v-for="folder in workspace.folders" :key="folder.id" :value="folder.id">
                {{ folder.name }}
              </option>
            </select>
          </div>
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
        <ElButton @click="importDialogOpen = false">取消</ElButton>
        <ElButton
          type="primary"
          :loading="workspace.importing"
          :disabled="importRows.length === 0 || workspace.importing"
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
