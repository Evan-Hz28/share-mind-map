<script setup lang="ts">
import { Document } from "@element-plus/icons-vue";
</script>

<template>
  <section class="workspace-home" aria-labelledby="workspace-title">
    <header class="page-heading">
      <div>
        <p class="eyebrow">工作区</p>
        <h1 id="workspace-title">思维图</h1>
      </div>
    </header>
    <div class="workspace-empty">
      <Document aria-hidden="true" />
      <h2>当前没有可显示的思维图</h2>
      <p>此工作区尚未建立文档。</p>
    </div>
  </section>
</template>
