<script setup lang="ts">
import {
  ArrowRight,
  Bell,
  Calendar,
  Checked,
  Document,
  FolderOpened,
  Lock,
  Plus,
  TrendCharts,
  Upload,
  UserFilled,
} from "@element-plus/icons-vue";
import { getWorkspaceOverview, type WorkspaceOverviewDto } from "@share-mind-map/api-client";
import { ElButton, ElIcon } from "element-plus";
import { computed, onMounted, ref, type Component } from "vue";
import { RouterLink, useRouter } from "vue-router";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import { useAuthStore } from "../auth/auth.store.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useWorkspaceStore } from "../workspace/workspace.store.js";
import { announcements } from "./announcements.js";

interface StatCard {
  label: string;
  value: string;
  hint: string;
  icon: Component;
}

interface QuickEntry {
  title: string;
  description: string;
  icon: Component;
  to: { name: string; query?: Record<string, string> };
}

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const router = useRouter();
const overview = ref<WorkspaceOverviewDto | null>(null);
const overviewError = ref<RequestFailure | null>(null);
const loading = ref(true);
const requestedEditAccess = ref(false);

const workspaceId = computed(() => auth.session?.defaultWorkspace.id ?? "");
const canEdit = computed(() => auth.role === "editor" || auth.role === "admin");
const isAdmin = computed(() => auth.role === "admin");
const error = computed(() => overviewError.value ?? workspace.error);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return "凌晨好";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
});
const todayLabel = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());

const statCards = computed<StatCard[]>(() => {
  const value = (read: (data: WorkspaceOverviewDto) => number): string =>
    overview.value === null ? "—" : String(read(overview.value));
  const cards: StatCard[] = [
    {
      label: "文档总数",
      value: value((data) => data.documentCount),
      hint: "当前工作区的有效文档",
      icon: Document,
    },
    {
      label: "节点总数",
      value: value((data) => data.nodeCount),
      hint: "全部文档的节点合计",
      icon: TrendCharts,
    },
    {
      label: "文件夹",
      value: value((data) => data.folderCount),
      hint: "一级文件夹数量",
      icon: FolderOpened,
    },
    {
      label: "执行中导入",
      value: value((data) => data.activeImportJobs),
      hint: "等待与处理中的任务",
      icon: Upload,
    },
  ];
  if (isAdmin.value) {
    cards.push({
      label: "待审批申请",
      value: value((data) => data.pendingEditRequests),
      hint: "编辑权限申请",
      icon: Checked,
    });
  }
  return cards;
});

const quickEntries = computed<QuickEntry[]>(() => {
  const entries: QuickEntry[] = [
    { title: "用例库", description: "浏览文件夹和文档", icon: FolderOpened, to: { name: "workspace" } },
  ];
  if (canEdit.value) {
    entries.push(
      {
        title: "新建文档",
        description: "创建空白文档",
        icon: Plus,
        to: { name: "workspace", query: { action: "create-document" } },
      },
      {
        title: "导入 XMind",
        description: "拖入文件或文件夹",
        icon: Upload,
        to: { name: "workspace", query: { action: "import" } },
      },
    );
  }
  if (isAdmin.value) {
    entries.push(
      { title: "成员管理", description: "账号与角色", icon: UserFilled, to: { name: "members" } },
      {
        title: "权限与审计",
        description: "审批与系统状态",
        icon: Lock,
        to: { name: "phase2-admin" },
      },
    );
  }
  return entries;
});

const recentDocuments = computed(() => workspace.documents.slice(0, 6));
const folderNames = computed(
  () => new Map(workspace.folders.map((folder) => [folder.id, folder.name])),
);
const unreadNotifications = computed(() =>
  workspace.notifications.filter((notification) => notification.readAt === null).slice(0, 3),
);
const hasTodos = computed(
  () =>
    (isAdmin.value && (overview.value?.pendingEditRequests ?? 0) > 0) ||
    workspace.unreadCount > 0 ||
    auth.role === "reader",
);

function folderLabel(folderId: string | null | undefined): string {
  if (folderId === null || folderId === undefined) return "未归档";
  return folderNames.value.get(folderId) ?? "未归档";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function load(): Promise<void> {
  if (workspaceId.value === "") return;
  loading.value = true;
  overviewError.value = null;
  try {
    const [result] = await Promise.all([
      getWorkspaceOverview({ client: apiClient, path: { workspaceId: workspaceId.value } }),
      workspace.loadWorkspace(workspaceId.value, "updatedAt"),
      workspace.loadNotifications(),
    ]);
    if (result.data === undefined) overviewError.value = toApiFailure(result.error);
    else overview.value = result.data;
  } catch {
    overviewError.value = toApiFailure(undefined);
  } finally {
    loading.value = false;
  }
}

async function requestEditAccess(): Promise<void> {
  if (await workspace.requestEditPermission()) requestedEditAccess.value = true;
}

function openWorkspace(): void {
  void router.push({ name: "workspace" });
}

onMounted(() => void load());
</script>

<template>
  <section class="home-view" aria-labelledby="home-title">
    <RequestErrorAlert :error="error" />

    <header class="home-hero">
      <div>
        <p class="eyebrow"><Calendar aria-hidden="true" />{{ todayLabel }}</p>
        <h1 id="home-title">
          {{ greeting }}，{{ auth.session?.user.displayName ?? "同事" }}
        </h1>
        <p>这是 {{ auth.session?.defaultWorkspace.name ?? "当前工作区" }} 的概览。</p>
      </div>
      <ElButton type="primary" @click="openWorkspace">
        <ElIcon><FolderOpened /></ElIcon>进入用例库
      </ElButton>
    </header>

    <div v-if="loading" class="content-state" role="status">
      <span class="loading-indicator" aria-hidden="true" />正在加载工作台
    </div>
    <template v-else>
      <section class="home-stats" aria-label="工作区统计">
        <article v-for="card in statCards" :key="card.label" class="home-stat">
          <div class="home-stat__icon" aria-hidden="true"><component :is="card.icon" /></div>
          <div>
            <p class="home-stat__label">{{ card.label }}</p>
            <strong class="home-stat__value">{{ card.value }}</strong>
            <small>{{ card.hint }}</small>
          </div>
        </article>
      </section>

      <section class="home-panel home-quick" aria-labelledby="quick-heading">
        <header class="home-panel__header">
          <h2 id="quick-heading">快速入口</h2>
        </header>
        <div class="home-quick__grid">
          <RouterLink
            v-for="entry in quickEntries"
            :key="entry.title"
            class="home-quick__item"
            :to="entry.to"
          >
            <span class="home-quick__icon" aria-hidden="true"><component :is="entry.icon" /></span>
            <span>
              <strong>{{ entry.title }}</strong>
              <small>{{ entry.description }}</small>
            </span>
            <ArrowRight class="home-quick__arrow" aria-hidden="true" />
          </RouterLink>
        </div>
      </section>

      <div class="home-columns">
        <section class="home-panel home-recent" aria-labelledby="recent-heading">
          <header class="home-panel__header">
            <h2 id="recent-heading"><Document aria-hidden="true" />最近文档</h2>
            <button class="home-panel__link" type="button" @click="openWorkspace">
              查看全部<ArrowRight aria-hidden="true" />
            </button>
          </header>
          <p v-if="recentDocuments.length === 0" class="panel-empty">还没有文档</p>
          <div v-else class="home-table-wrap">
            <table class="home-table">
              <thead>
                <tr>
                  <th scope="col">文档</th>
                  <th scope="col">文件夹</th>
                  <th scope="col">节点</th>
                  <th scope="col">更新时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="document in recentDocuments" :key="document.id">
                  <td>
                    <RouterLink
                      class="home-table__document"
                      :to="{ name: 'document', params: { documentId: document.id } }"
                    >
                      {{ document.name }}
                    </RouterLink>
                  </td>
                  <td>{{ folderLabel(document.folderId) }}</td>
                  <td>{{ document.nodeCount }}</td>
                  <td>{{ formatDateTime(document.updatedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <aside class="home-side">
          <section class="home-panel home-todos" aria-labelledby="todos-heading">
            <header class="home-panel__header">
              <h2 id="todos-heading"><Bell aria-hidden="true" />我的待办</h2>
            </header>
            <div v-if="!hasTodos" class="panel-empty">暂无待处理事项</div>
            <ul v-else class="home-todo-list">
              <li v-if="isAdmin && (overview?.pendingEditRequests ?? 0) > 0">
                <Checked aria-hidden="true" />
                <span>
                  <strong>{{ overview?.pendingEditRequests }} 条编辑权限申请待审批</strong>
                  <small>只读成员申请编辑权限后需要管理员处理。</small>
                </span>
                <RouterLink :to="{ name: 'phase2-admin' }">去审批</RouterLink>
              </li>
              <li v-if="auth.role === 'reader' && !requestedEditAccess">
                <Lock aria-hidden="true" />
                <span>
                  <strong>需要编辑文档？</strong>
                  <small>当前是只读成员，提交申请后由管理员审批。</small>
                </span>
                <ElButton size="small" :loading="workspace.mutating" @click="requestEditAccess">
                  申请编辑权限
                </ElButton>
              </li>
              <li v-if="requestedEditAccess">
                <Lock aria-hidden="true" />
                <span>
                  <strong>编辑权限申请已提交</strong>
                  <small>等待管理员审批，结果会出现在通知里。</small>
                </span>
              </li>
              <li
                v-for="notification in unreadNotifications"
                :key="notification.id"
                class="home-todo-list__notification"
              >
                <Bell aria-hidden="true" />
                <span>
                  <strong>{{ notification.title }}</strong>
                  <small>{{ notification.body }}</small>
                </span>
                <ElButton
                  text
                  size="small"
                  @click="workspace.markNotificationRead(notification.id)"
                >
                  标为已读
                </ElButton>
              </li>
            </ul>
            <footer v-if="workspace.unreadCount > 0" class="home-todos__footer">
              <span>{{ workspace.unreadCount }} 条未读通知</span>
              <ElButton text size="small" @click="workspace.markAllNotificationsRead">
                全部标为已读
              </ElButton>
            </footer>
          </section>

          <section class="home-panel home-announcements" aria-labelledby="announcements-heading">
            <header class="home-panel__header">
              <h2 id="announcements-heading"><Calendar aria-hidden="true" />系统公告</h2>
            </header>
            <ul class="home-announcement-list">
              <li v-for="announcement in announcements" :key="announcement.title">
                <time :datetime="announcement.date">{{ announcement.date }}</time>
                <strong>{{ announcement.title }}</strong>
                <p>{{ announcement.body }}</p>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </template>
  </section>
</template>
