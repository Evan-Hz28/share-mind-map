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
  DOCUMENT_NAME_CONFLICT: "已存在同名文档，请换一个名字。",
  IMPORT_BATCH_NOT_FOUND: "导入任务已不存在，请刷新页面后重试。",
  IMPORT_CONTENT_CONFLICT: "工作区里已有内容相同的文档，请不要重复导入。",
  IMPORT_FAILED: "导入失败，请重试。",
  IMPORT_FILE_INVALID: "文件无效或不是 .xmind 文件。",
  IMPORT_FILE_TOO_LARGE: "单个 .xmind 文件不能超过 20 MB。",
  IMPORT_JOB_NOT_FOUND: "导入任务已不存在，请刷新页面后重试。",
  IMPORT_NOT_FOUND: "导入任务已不存在，请刷新页面后重试。",
  IMPORT_QUEUE_LIMIT_REACHED: "导入队列已满：请等当前导入任务跑完再提交，或减少一次提交的文件数。",
  IMPORT_RETRY_NOT_ALLOWED: "这个任务当前不能重试。",
  IMPORT_SOURCE_UNAVAILABLE: "本地原文件已不可用，请点「替换文件」重新选择。",
  IMPORT_STATE_CONFLICT: "任务状态已变化，请刷新后重试。",
  IMPORT_STORAGE_QUOTA_EXCEEDED: "存储配额不足，无法导入。",
  IMPORT_TARGET_CONFLICT: "目标文件夹的文档数量已达上限。",
  IMPORT_TIMEOUT: "导入超时，请重试。",
  INVALID_INPUT: "提交的信息无效，请检查后重试。",
  LAST_ACTIVE_ADMIN: "必须保留至少一个有效管理员。",
  LOGIN_NAME_CONFLICT: "登录名已存在。",
  NETWORK_ERROR: "无法连接服务，请检查网络后重试。",
  PERMISSION_DENIED: "没有执行此操作的权限。",
  QUOTA_EXCEEDED: "存储配额不足。",
  RATE_LIMITED: "登录尝试过于频繁，请稍后再试。",
  WORKSPACE_DOCUMENT_LIMIT_REACHED: "工作区文档数量已达上限。",
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
