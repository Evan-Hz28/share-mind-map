<script setup lang="ts">
import { Document, Edit, MoreFilled, Plus, Upload } from "@element-plus/icons-vue";
import type { FolderDto } from "@share-mind-map/api-client";
import { ElButton, ElIcon } from "element-plus";
import { ref } from "vue";

defineProps<{
  folderChain: readonly FolderDto[];
  label: string;
  description: string;
  canEdit: boolean;
  isReader: boolean;
  unreadCount: number;
}>();

const emit = defineEmits<{
  selectAll: [];
  selectFolder: [folderId: string];
  createFolder: [];
  createDocument: [];
  importXmind: [];
  requestEdit: [];
  openNotifications: [];
  refresh: [];
}>();

const menuOpen = ref(false);

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
}

function run(action: () => void): void {
  menuOpen.value = false;
  action();
}
</script>

<template>
  <header class="library-header page-heading page-heading--with-action">
    <div class="library-header__intro">
      <nav class="library-breadcrumb" aria-label="面包屑">
        <button type="button" @click="emit('selectAll')">用例库</button>
        <template v-if="folderChain.length > 0">
          <template v-for="(node, index) in folderChain" :key="node.id">
            <span aria-hidden="true">/</span>
            <button
              v-if="index < folderChain.length - 1"
              type="button"
              @click="emit('selectFolder', node.id)"
            >
              {{ node.name }}
            </button>
            <span v-else aria-current="page">{{ node.name }}</span>
          </template>
        </template>
        <template v-else>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{{ label }}</span>
        </template>
      </nav>
      <h1 id="workspace-title">{{ label }}</h1>
      <p>{{ description }}</p>
    </div>
    <div class="workspace-actions">
      <ElButton v-if="isReader" @click="emit('requestEdit')">
        <ElIcon><Edit /></ElIcon>申请编辑权限
      </ElButton>
      <ElButton v-if="canEdit" class="workspace-action--secondary" @click="emit('createFolder')">
        <ElIcon><Plus /></ElIcon>新建文件夹
      </ElButton>
      <ElButton v-if="canEdit" type="primary" @click="emit('createDocument')">
        <ElIcon><Document /></ElIcon>新建文档
      </ElButton>
      <ElButton v-if="canEdit" class="workspace-action--secondary" @click="emit('importXmind')">
        <ElIcon><Upload /></ElIcon>导入 XMind
      </ElButton>
      <div class="library-header__menu-wrap">
        <button
          class="library-header__more"
          type="button"
          aria-label="更多操作"
          :aria-expanded="menuOpen"
          @click="toggleMenu"
        >
          <MoreFilled aria-hidden="true" />
        </button>
        <div v-if="menuOpen" class="popover-menu popover-menu--right library-header__menu">
          <button type="button" @click="run(() => emit('openNotifications'))">
            通知
            <span v-if="unreadCount > 0" class="library-header__badge">{{ unreadCount }}</span>
          </button>
          <button type="button" @click="run(() => emit('refresh'))">刷新列表</button>
        </div>
      </div>
    </div>
  </header>
</template>
