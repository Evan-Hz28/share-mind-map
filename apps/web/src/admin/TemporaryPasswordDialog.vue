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

// `navigator.clipboard` 是 secure context 专属 API,明文 HTTP + 公网 IP 下它是 undefined,
// 调用即抛 TypeError;这时退回到临时的 textarea + execCommand。
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文里没有 clipboard API(也可能只是权限被拒),继续走下面的兜底。
  }

  const host = document.createElement("textarea");
  host.value = text;
  host.setAttribute("readonly", "");
  host.style.position = "fixed";
  host.style.top = "-1000px";
  document.body.append(host);
  host.select();
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- 非安全上下文没有替代方案。
    return document.execCommand("copy");
  } catch {
    // 个别环境(如 jsdom)没有实现 execCommand,复制失败即可,别让异常冒到调用方。
    return false;
  } finally {
    host.remove();
  }
}

async function copyPassword(): Promise<void> {
  if (props.password === null) return;
  copied.value = await writeClipboard(props.password);
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
