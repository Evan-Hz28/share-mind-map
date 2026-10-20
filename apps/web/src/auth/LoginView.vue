<script setup lang="ts">
import { Lock, User } from "@element-plus/icons-vue";
import { ElButton, ElForm, ElInput } from "element-plus";
import { reactive } from "vue";
import { useRouter } from "vue-router";

import AppLogo from "../components/AppLogo.vue";
import RequestErrorAlert from "../components/RequestErrorAlert.vue";
import { useAuthStore } from "./auth.store.js";

const auth = useAuthStore();
const router = useRouter();
const form = reactive({ loginName: "", password: "" });

async function submit(): Promise<void> {
  if (!(await auth.login({ loginName: form.loginName.trim(), password: form.password }))) return;
  await router.replace({ name: auth.mustChangePassword ? "change-password" : "home" });
}
</script>

<template>
  <main class="auth-layout">
    <section class="auth-panel" aria-labelledby="login-title">
      <AppLogo />
      <div class="auth-heading">
        <h1 id="login-title">登录</h1>
        <p>使用组织账号进入工作区</p>
      </div>
      <RequestErrorAlert :error="auth.error" />
      <ElForm class="form-stack" @submit.prevent="submit">
        <div class="field-group">
          <label for="login-name">登录名</label>
          <ElInput
            id="login-name"
            v-model="form.loginName"
            aria-label="登录名"
            autocomplete="username"
            :prefix-icon="User"
          />
        </div>
        <div class="field-group">
          <label for="login-password">密码</label>
          <ElInput
            id="login-password"
            v-model="form.password"
            aria-label="密码"
            type="password"
            autocomplete="current-password"
            show-password
            :prefix-icon="Lock"
          />
        </div>
        <ElButton
          class="submit-button"
          native-type="submit"
          type="primary"
          :loading="auth.loading"
          :disabled="auth.loading"
        >
          {{ auth.loading ? "正在登录" : "登录" }}
        </ElButton>
      </ElForm>
    </section>
  </main>
</template>
