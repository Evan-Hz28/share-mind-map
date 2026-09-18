<script setup lang="ts">
import { ElButton, ElTag } from "element-plus";
import { onMounted } from "vue";

import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useWorkspaceStore } from "../workspace/workspace.store.js";

const workspace = useWorkspaceStore();

async function decide(requestId: string, decision: "approved" | "rejected"): Promise<void> {
  if (await workspace.decideEditRequest(requestId, decision)) await workspace.loadAdminData();
}

onMounted(() => void workspace.loadAdminData());
</script>

<template>
  <section class="members-view" aria-labelledby="phase2-admin-title">
    <header class="page-heading">
      <div>
        <p class="eyebrow">工作区管理</p>
        <h1 id="phase2-admin-title">权限与审计</h1>
        <p>处理编辑权限申请并查看安全审计与用量。</p>
      </div>
    </header>
    <RequestErrorAlert :error="workspace.error" />
    <div class="admin-dashboard-grid">
      <section class="workspace-panel" aria-labelledby="requests-title">
        <header class="workspace-panel__header">
          <h2 id="requests-title">待审批申请</h2>
          <span>{{ workspace.permissionRequests.length }}</span>
        </header>
        <div v-if="workspace.permissionRequests.length === 0" class="panel-empty">
          暂无待审批申请
        </div>
        <ul v-else class="workspace-list">
          <li
            v-for="request in workspace.permissionRequests"
            :key="request.id"
            class="workspace-list__item"
          >
            <span class="workspace-list__name"
              ><strong>{{ request.requesterDisplayName }}</strong
              ><small>{{ new Date(request.requestedAt).toLocaleString("zh-CN") }}</small></span
            ><ElButton size="small" type="primary" @click="decide(request.id, 'approved')"
              >通过</ElButton
            ><ElButton size="small" @click="decide(request.id, 'rejected')">拒绝</ElButton>
          </li>
        </ul>
      </section>
      <section class="workspace-panel" aria-labelledby="storage-title">
        <header class="workspace-panel__header">
          <h2 id="storage-title">用量</h2>
          <ElTag v-if="workspace.storage" size="small">{{ workspace.storage.threshold }}</ElTag>
        </header>
        <div v-if="workspace.storage" class="admin-stat-list">
          <div>
            <span>文件夹</span><strong>{{ workspace.storage.folderCount }}</strong>
          </div>
          <div>
            <span>文档</span><strong>{{ workspace.storage.documentCount }}</strong>
          </div>
          <div>
            <span>已知字节</span><strong>{{ workspace.storage.knownObjectBytes }}</strong>
          </div>
          <div>
            <span>配置配额</span><strong>{{ workspace.storage.quotaBytes }}</strong>
          </div>
        </div>
        <div v-else class="panel-empty">暂无用量数据</div>
      </section>
    </div>
    <section class="workspace-panel audit-panel" aria-labelledby="audit-title">
      <header class="workspace-panel__header">
        <h2 id="audit-title">最近审计记录</h2>
        <span>{{ workspace.auditLogs.length }}</span>
      </header>
      <div v-if="workspace.auditLogs.length === 0" class="panel-empty">暂无审计记录</div>
      <ul v-else class="workspace-list">
        <li v-for="log in workspace.auditLogs" :key="log.id" class="workspace-list__item">
          <span class="workspace-list__name"
            ><strong>{{ log.action }}</strong
            ><small>{{ new Date(log.createdAt).toLocaleString("zh-CN") }}</small></span
          ><ElTag size="small" :type="log.result === 'success' ? 'success' : 'danger'">{{
            log.result
          }}</ElTag>
        </li>
      </ul>
    </section>
  </section>
</template>
