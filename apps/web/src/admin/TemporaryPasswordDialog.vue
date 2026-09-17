<script setup lang="ts">
import { CopyDocument, WarningFilled } from "@element-plus/icons-vue";
import { ElButton, ElDialog, ElIcon } from "element-plus";
import { ref, watch } from "vue";

const props = defineProps<{ password: string | null; subject: string }>();
const emit = defineEmits<{ close: [] }>();
const copied = ref(false);

watch(
  () => props.password,
  () => {
    copied.value = false;
  },
);

async function copyPassword(): Promise<void> {
  if (props.password === null) return;
  await navigator.clipboard.writeText(props.password);
  copied.value = true;
}
</script>

<template>
  <ElDialog
    :model-value="props.password !== null"
    title="一次性临时密码"
    width="min(92vw, 480px)"
    :close-on-click-modal="false"
    destroy-on-close
    @close="emit('close')"
  >
    <div class="secret-warning">
      <WarningFilled aria-hidden="true" />
      <p>这是 {{ props.subject }} 的一次性密码。关闭后将无法再次查看。</p>
    </div>
    <div class="secret-value" aria-live="polite">
      {{ props.password }}
    </div>
    <template #footer>
      <span v-if="copied" class="copy-feedback" role="status">已复制</span>
      <ElButton aria-label="复制临时密码" @click="copyPassword">
        <ElIcon><CopyDocument /></ElIcon>
        复制
      </ElButton>
      <ElButton type="primary" @click="emit('close')"> 关闭 </ElButton>
    </template>
  </ElDialog>
</template>
