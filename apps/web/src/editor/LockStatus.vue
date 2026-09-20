<script setup lang="ts">
import type { LockDto } from "@share-mind-map/api-client";

type LockState = "idle" | "acquiring" | "held" | "lost" | "error";

defineProps<{
  state: LockState;
  lock: LockDto | null;
  canEdit: boolean;
  mobile: boolean;
}>();

const emit = defineEmits<{
  begin: [];
  end: [];
}>();
</script>

<template>
  <div class="lock-status" aria-live="polite">
    <template v-if="state === 'held' && !mobile">
      <span>
        编辑锁：{{ lock?.editorDisplayName ?? "当前用户" }} · 到期于
        {{ lock?.expiresAt ?? "未知" }}
      </span>
      <button type="button" @click="emit('end')">结束编辑</button>
    </template>
    <template v-else-if="state === 'acquiring'">
      <span>正在获取编辑锁…</span>
    </template>
    <template v-else-if="lock?.occupied">
      <span>编辑锁：{{ lock.editorDisplayName ?? "其他成员" }} 编辑中</span>
    </template>
    <template v-else-if="state === 'lost'">
      <span>编辑锁已失效，当前修改已转为只读草稿。</span>
      <button v-if="canEdit && !mobile" type="button" @click="emit('begin')">重新获取编辑锁</button>
    </template>
    <template v-else-if="state === 'error'">
      <span>暂时无法获取编辑锁，当前为只读模式。</span>
      <button v-if="canEdit" type="button" @click="emit('begin')">重新获取编辑锁</button>
    </template>
    <template v-else-if="mobile">
      <span>移动端只读</span>
    </template>
    <template v-else-if="canEdit">
      <button type="button" @click="emit('begin')">开始编辑</button>
    </template>
    <span v-else>只读模式</span>
  </div>
</template>
