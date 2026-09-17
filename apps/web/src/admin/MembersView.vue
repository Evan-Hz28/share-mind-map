<script setup lang="ts">
import {
  adminChangeAccountStatus,
  adminCreateMember,
  adminListMembers,
  adminResetMemberPassword,
  adminRevokeMemberSessions,
  type MemberResponseDto,
} from "@share-mind-map/api-client";
import { MoreFilled, Plus } from "@element-plus/icons-vue";
import { ElButton, ElDialog, ElIcon, ElInput } from "element-plus";
import { onMounted, reactive, ref } from "vue";

import { apiClient, toApiFailure, type RequestFailure } from "../api.js";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import TemporaryPasswordDialog from "./TemporaryPasswordDialog.vue";

type Confirmation = { action: "status" | "revoke"; member: MemberResponseDto };

const members = ref<MemberResponseDto[]>([]);
const loading = ref(true);
const mutating = ref(false);
const error = ref<RequestFailure | null>(null);
const createOpen = ref(false);
const createForm = reactive({ loginName: "", displayName: "" });
const temporaryPassword = ref<string | null>(null);
const temporaryPasswordSubject = ref("");
const openActionMemberId = ref<string | null>(null);
const confirmation = ref<Confirmation | null>(null);

const roleLabels: Record<MemberResponseDto["role"], string> = {
  admin: "管理员",
  editor: "编辑者",
  reader: "只读成员",
};

async function loadMembers(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const result = await adminListMembers({ client: apiClient });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    members.value = result.data.members;
  } finally {
    loading.value = false;
  }
}

function toggleActionMenu(id: string): void {
  openActionMemberId.value = openActionMemberId.value === id ? null : id;
}

function requestConfirmation(action: Confirmation["action"], member: MemberResponseDto): void {
  openActionMemberId.value = null;
  confirmation.value = { action, member };
}

async function createMember(): Promise<void> {
  mutating.value = true;
  error.value = null;
  try {
    const result = await adminCreateMember({
      client: apiClient,
      body: { loginName: createForm.loginName.trim(), displayName: createForm.displayName.trim() },
    });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    temporaryPassword.value = result.data.temporaryPassword;
    temporaryPasswordSubject.value = result.data.member.displayName;
    createOpen.value = false;
    createForm.loginName = "";
    createForm.displayName = "";
    await loadMembers();
  } finally {
    mutating.value = false;
  }
}

async function resetPassword(member: MemberResponseDto): Promise<void> {
  openActionMemberId.value = null;
  mutating.value = true;
  error.value = null;
  try {
    const result = await adminResetMemberPassword({ client: apiClient, path: { id: member.id } });
    if (result.data === undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    temporaryPassword.value = result.data.temporaryPassword;
    temporaryPasswordSubject.value = member.displayName;
    await loadMembers();
  } finally {
    mutating.value = false;
  }
}

async function confirmAction(): Promise<void> {
  const requested = confirmation.value;
  if (requested === null) return;
  mutating.value = true;
  error.value = null;
  try {
    const result =
      requested.action === "status"
        ? await adminChangeAccountStatus({
            client: apiClient,
            path: { id: requested.member.id },
            body: { status: requested.member.accountStatus === "active" ? "disabled" : "active" },
          })
        : await adminRevokeMemberSessions({ client: apiClient, path: { id: requested.member.id } });
    if (result.error !== undefined) {
      error.value = toApiFailure(result.error);
      return;
    }
    confirmation.value = null;
    await loadMembers();
  } finally {
    mutating.value = false;
  }
}

function closeTemporaryPassword(): void {
  temporaryPassword.value = null;
  temporaryPasswordSubject.value = "";
}

function formatLastLogin(value: string | null): string {
  return value === null
    ? "从未登录"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      );
}

onMounted(loadMembers);
</script>

<template>
  <section class="members-view" aria-labelledby="members-title">
    <header class="page-heading page-heading--with-action">
      <div>
        <p class="eyebrow">组织管理</p>
        <h1 id="members-title">成员管理</h1>
        <p>管理成员访问状态与登录凭据。</p>
      </div>
      <ElButton type="primary" @click="createOpen = true">
        <ElIcon><Plus /></ElIcon>
        创建成员
      </ElButton>
    </header>

    <RequestErrorAlert :error="error" />

    <div v-if="loading" class="content-state" role="status">
      <span class="loading-indicator" aria-hidden="true" />
      正在加载成员
    </div>
    <div v-else-if="members.length === 0" class="content-state">
      <h2>暂无成员</h2>
      <p>创建首位只读成员后，成员会显示在这里。</p>
    </div>
    <div v-else class="member-table" role="table" aria-label="成员列表">
      <div class="member-row member-row--header" role="row">
        <span role="columnheader">成员</span>
        <span role="columnheader">角色</span>
        <span role="columnheader">状态</span>
        <span role="columnheader">最近登录</span>
        <span role="columnheader" class="visually-hidden">操作</span>
      </div>
      <div v-for="member in members" :key="member.id" class="member-row" role="row">
        <div class="member-identity" role="cell">
          <strong>{{ member.displayName }}</strong>
          <span>{{ member.loginName }}</span>
        </div>
        <div class="mobile-field-label">角色</div>
        <span role="cell">{{ roleLabels[member.role] }}</span>
        <div class="mobile-field-label">状态</div>
        <span role="cell" class="status-label" :class="`status-label--${member.accountStatus}`">
          {{ member.accountStatus === "active" ? "有效" : "已禁用" }}
        </span>
        <div class="mobile-field-label">最近登录</div>
        <span role="cell" class="last-login">{{ formatLastLogin(member.lastLoginAt) }}</span>
        <div class="member-actions" role="cell">
          <button
            class="icon-button"
            type="button"
            :aria-label="`打开 ${member.displayName} 的操作菜单`"
            title="成员操作"
            @click="toggleActionMenu(member.id)"
          >
            <MoreFilled aria-hidden="true" />
          </button>
          <div
            v-if="openActionMemberId === member.id"
            class="popover-menu popover-menu--right action-menu"
          >
            <button type="button" @click="resetPassword(member)">
              重置 {{ member.displayName }} 的密码
            </button>
            <button type="button" @click="requestConfirmation('status', member)">
              {{
                member.accountStatus === "active"
                  ? `禁用 ${member.displayName}`
                  : `恢复 ${member.displayName}`
              }}
            </button>
            <button type="button" @click="requestConfirmation('revoke', member)">
              撤销 {{ member.displayName }} 的全部会话
            </button>
          </div>
        </div>
      </div>
    </div>

    <ElDialog
      v-model="createOpen"
      title="创建成员"
      width="min(92vw, 480px)"
      :close-on-click-modal="false"
    >
      <p class="dialog-intro">新成员将以只读成员身份加入。</p>
      <form id="create-member-form" class="form-stack" @submit.prevent="createMember">
        <div class="field-group">
          <label for="member-login-name">登录名</label>
          <ElInput id="member-login-name" v-model="createForm.loginName" autocomplete="off" />
        </div>
        <div class="field-group">
          <label for="member-display-name">显示名称</label>
          <ElInput id="member-display-name" v-model="createForm.displayName" autocomplete="off" />
        </div>
      </form>
      <template #footer>
        <ElButton @click="createOpen = false"> 取消 </ElButton>
        <ElButton type="primary" native-type="submit" form="create-member-form" :loading="mutating">
          创建 Reader
        </ElButton>
      </template>
    </ElDialog>

    <ElDialog
      :model-value="confirmation !== null"
      :title="
        confirmation?.action === 'revoke'
          ? '撤销全部会话'
          : confirmation?.member.accountStatus === 'active'
            ? '禁用成员'
            : '恢复成员'
      "
      width="min(92vw, 480px)"
      :close-on-click-modal="false"
      @close="confirmation = null"
    >
      <p v-if="confirmation?.action === 'revoke'">该成员需要在所有设备上重新登录。</p>
      <p v-else-if="confirmation?.member.accountStatus === 'active'">
        禁用后，该成员的全部会话将立即失效。
      </p>
      <p v-else>恢复后，该成员可再次登录。</p>
      <template #footer>
        <ElButton @click="confirmation = null"> 取消 </ElButton>
        <ElButton type="primary" :loading="mutating" @click="confirmAction">
          {{
            confirmation?.action === "revoke"
              ? "确认撤销"
              : confirmation?.member.accountStatus === "active"
                ? "确认禁用"
                : "确认恢复"
          }}
        </ElButton>
      </template>
    </ElDialog>

    <TemporaryPasswordDialog
      :password="temporaryPassword"
      :subject="temporaryPasswordSubject"
      @close="closeTemporaryPassword"
    />
  </section>
</template>
