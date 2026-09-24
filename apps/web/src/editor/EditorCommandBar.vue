<script setup lang="ts">
import {
  Delete,
  Download,
  Expand,
  Plus,
  RefreshLeft,
  RefreshRight,
  ScaleToOriginal,
  ZoomIn,
  ZoomOut,
} from "@element-plus/icons-vue";

defineProps<{
  canWrite: boolean;
  dirty: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  undo: [];
  redo: [];
  addChild: [];
  addSibling: [];
  removeSelected: [];
  save: [];
  exportXMind: [];
  allExpanded: [expanded: boolean];
  fitToView: [];
}>();

function expandAll(): void {
  emit("allExpanded", true);
}

function collapseAll(): void {
  emit("allExpanded", false);
}
</script>

<template>
  <div class="editor-command-bar" role="toolbar" aria-label="编辑工具栏">
    <div class="editor-command-bar__group" role="group" aria-label="历史操作">
      <button type="button" aria-label="撤销" title="撤销" :disabled="!canWrite" @click="emit('undo')">
        <RefreshLeft aria-hidden="true" />
        <span>撤销</span>
      </button>
      <button type="button" aria-label="重做" title="重做" :disabled="!canWrite" @click="emit('redo')">
        <RefreshRight aria-hidden="true" />
        <span>重做</span>
      </button>
    </div>

    <div class="editor-command-bar__group" role="group" aria-label="节点操作">
      <button
        type="button"
        aria-label="添加子节点"
        title="添加子节点"
        :disabled="!canWrite"
        @click="emit('addChild')"
      >
        <Plus aria-hidden="true" />
        <span>添加子节点</span>
      </button>
      <button
        type="button"
        aria-label="添加同级节点"
        title="添加同级节点"
        :disabled="!canWrite"
        @click="emit('addSibling')"
      >
        <Plus aria-hidden="true" />
        <span>添加同级节点</span>
      </button>
      <button
        type="button"
        aria-label="删除"
        title="删除节点"
        :disabled="!canWrite"
        @click="emit('removeSelected')"
      >
        <Delete aria-hidden="true" />
        <span>删除</span>
      </button>
    </div>

    <div class="editor-command-bar__group" role="group" aria-label="文件和视图">
      <button
        type="button"
        aria-label="保存"
        title="保存"
        :disabled="!canWrite || !dirty || saving"
        @click="emit('save')"
      >
        <ScaleToOriginal aria-hidden="true" />
        <span>{{ saving ? "保存中" : "保存" }}</span>
      </button>
      <button type="button" aria-label="导出 XMind" title="导出 XMind" @click="emit('exportXMind')">
        <Download aria-hidden="true" />
        <span>导出 XMind</span>
      </button>
      <button type="button" aria-label="全部展开" title="全部展开" @click="expandAll">
        <Expand aria-hidden="true" />
        <span>全部展开</span>
      </button>
      <button type="button" aria-label="全部收起" title="全部收起" @click="collapseAll">
        <ZoomOut aria-hidden="true" />
        <span>全部收起</span>
      </button>
      <button type="button" aria-label="适应画布" title="适应画布" @click="emit('fitToView')">
        <ZoomIn aria-hidden="true" />
        <span>适应画布</span>
      </button>
    </div>
  </div>
</template>
