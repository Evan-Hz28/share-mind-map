<script setup lang="ts">
import { WarningFilled } from "@element-plus/icons-vue";

import type { RequestFailure } from "../api.js";

const props = defineProps<{ error: RequestFailure | null }>();

const safeMessages: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: "账号或密码错误。",
  AUTH_CURRENT_PASSWORD_INVALID: "当前密码错误。",
  AUTH_PASSWORD_CHANGE_REQUIRED: "请先修改临时密码。",
  AUTH_REQUIRED: "请先登录。",
  AUTH_SESSION_EXPIRED: "登录已过期，请重新登录。",
  CSRF_INVALID: "请求已失效，请刷新后重试。",
  DEPENDENCY_UNAVAILABLE: "服务暂时不可用，请稍后再试。",
  INVALID_INPUT: "提交的信息无效，请检查后重试。",
  LAST_ACTIVE_ADMIN: "必须保留至少一个有效管理员。",
  LOGIN_NAME_CONFLICT: "登录名已存在。",
  NETWORK_ERROR: "无法连接服务，请检查网络后重试。",
  PERMISSION_DENIED: "没有执行此操作的权限。",
  RATE_LIMITED: "登录尝试过于频繁，请稍后再试。",
};
</script>

<template>
  <div v-if="props.error" class="request-error" role="alert">
    <WarningFilled aria-hidden="true" />
    <div>
      <strong>{{ safeMessages[props.error.code] ?? "操作未完成，请稍后重试。" }}</strong>
      <small v-if="props.error.requestId">请求编号：{{ props.error.requestId }}</small>
    </div>
  </div>
</template>
