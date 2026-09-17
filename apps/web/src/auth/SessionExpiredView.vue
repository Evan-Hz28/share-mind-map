<script setup lang="ts">
import { Timer } from "@element-plus/icons-vue";
import { ElButton } from "element-plus";
import { useRouter } from "vue-router";

import AppLogo from "../components/AppLogo.vue";
import { useAuthStore } from "./auth.store.js";

const auth = useAuthStore();
const router = useRouter();

async function returnToLogin(): Promise<void> {
  auth.acknowledgeExpiration();
  await router.replace({ name: "login" });
}
</script>

<template>
  <main class="auth-layout">
    <section class="auth-panel auth-panel--centered" aria-labelledby="expired-title">
      <AppLogo />
      <Timer class="state-icon" aria-hidden="true" />
      <div class="auth-heading">
        <h1 id="expired-title">登录已过期</h1>
        <p>为保护账号安全，请重新登录后继续。</p>
      </div>
      <ElButton type="primary" @click="returnToLogin"> 返回登录 </ElButton>
    </section>
  </main>
</template>
