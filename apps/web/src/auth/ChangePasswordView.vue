<script setup lang="ts">
import { ElButton, ElForm, ElInput } from "element-plus";
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";

import type { RequestFailure } from "../api.js";
import AppLogo from "../components/AppLogo.vue";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useAuthStore } from "./auth.store.js";

const auth = useAuthStore();
const router = useRouter();
const form = reactive({ currentPassword: "", newPassword: "", confirmation: "" });
const validationError = ref<RequestFailure | null>(null);

async function submit(): Promise<void> {
  validationError.value = null;
  if (form.newPassword !== form.confirmation) {
    validationError.value = {
      code: "PASSWORD_CONFIRMATION_MISMATCH",
      details: {},
      message: "",
      requestId: "",
    };
    return;
  }
  if (
    !(await auth.changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    }))
  )
    return;
  await router.replace({ name: "login" });
}
</script>

<template>
  <main class="auth-layout">
    <section class="auth-panel" aria-labelledby="change-password-title">
      <AppLogo />
      <div class="auth-heading">
        <h1 id="change-password-title">设置新密码</h1>
        <p>临时密码只能使用一次，完成修改后请重新登录。</p>
      </div>
      <div v-if="validationError" class="request-error" role="alert">两次输入的新密码不一致。</div>
      <RequestErrorAlert v-else :error="auth.error" />
      <ElForm class="form-stack" @submit.prevent="submit">
        <div class="field-group">
          <label for="current-password">当前密码</label>
          <ElInput
            id="current-password"
            v-model="form.currentPassword"
            aria-label="当前密码"
            type="password"
            autocomplete="current-password"
            show-password
          />
        </div>
        <div class="field-group">
          <label for="new-password">新密码</label>
          <ElInput
            id="new-password"
            v-model="form.newPassword"
            aria-label="新密码"
            type="password"
            autocomplete="new-password"
            show-password
          />
        </div>
        <div class="field-group">
          <label for="confirm-password">确认新密码</label>
          <ElInput
            id="confirm-password"
            v-model="form.confirmation"
            aria-label="确认新密码"
            type="password"
            autocomplete="new-password"
            show-password
          />
        </div>
        <ElButton
          class="submit-button"
          native-type="submit"
          type="primary"
          :loading="auth.loading"
          :disabled="auth.loading"
        >
          {{ auth.loading ? "正在修改" : "修改密码" }}
        </ElButton>
      </ElForm>
    </section>
  </main>
</template>
