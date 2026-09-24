<script setup lang="ts">
import {
  Aim,
  Brush,
  EditPen,
  FullScreen,
  List,
  Share,
  ZoomIn,
  ZoomOut,
} from "@element-plus/icons-vue";

const emit = defineEmits<{
  fitToView: [];
  zoomIn: [];
  zoomOut: [];
  fullscreen: [];
  selectPanel: [panel: "mind-map" | "outline" | "style" | "theme"];
}>();
</script>

<template>
  <aside class="editor-side-rail" aria-label="画布工具栏">
    <button type="button" aria-label="思维导图" title="思维导图" @click="emit('selectPanel', 'mind-map')">
      <Share aria-hidden="true" />
      <span>思维导图</span>
    </button>
    <button type="button" aria-label="大纲" title="大纲" disabled>
      <List aria-hidden="true" />
      <span>大纲</span>
    </button>
    <button type="button" aria-label="样式" title="样式" disabled>
      <EditPen aria-hidden="true" />
      <span>样式</span>
    </button>
    <button type="button" aria-label="主题" title="主题" disabled>
      <Brush aria-hidden="true" />
      <span>主题</span>
    </button>
    <span class="editor-side-rail__divider" aria-hidden="true" />
    <button type="button" aria-label="全屏" title="全屏" @click="emit('fullscreen')">
      <FullScreen aria-hidden="true" />
      <span>全屏</span>
    </button>
    <button type="button" aria-label="适应画布" title="适应画布" @click="emit('fitToView')">
      <Aim aria-hidden="true" />
      <span>适应画布</span>
    </button>
    <button type="button" aria-label="放大" title="放大" @click="emit('zoomIn')">
      <ZoomIn aria-hidden="true" />
      <span>放大</span>
    </button>
    <button type="button" aria-label="缩小" title="缩小" @click="emit('zoomOut')">
      <ZoomOut aria-hidden="true" />
      <span>缩小</span>
    </button>
  </aside>
</template>
