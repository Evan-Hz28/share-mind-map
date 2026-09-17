export const errorCatalog = {
  INVALID_INPUT: { status: 400, message: "请求参数无效。" },
  AUTH_REQUIRED: { status: 401, message: "请先登录。" },
  AUTH_SESSION_EXPIRED: { status: 401, message: "登录已过期，请重新登录。" },
  AUTH_INVALID_CREDENTIALS: { status: 401, message: "账号或密码错误。" },
  AUTH_PASSWORD_CHANGE_REQUIRED: { status: 403, message: "请先修改临时密码。" },
  AUTH_CURRENT_PASSWORD_INVALID: { status: 400, message: "当前密码错误。" },
  CSRF_INVALID: { status: 403, message: "请求验证失败，请刷新后重试。" },
  PERMISSION_DENIED: { status: 403, message: "没有执行此操作的权限。" },
  LOGIN_NAME_CONFLICT: { status: 409, message: "登录名已存在。" },
  LAST_ACTIVE_ADMIN: { status: 409, message: "必须保留至少一个有效管理员。" },
  NOT_FOUND: { status: 404, message: "请求的资源不存在。" },
  RATE_LIMITED: { status: 429, message: "请求过于频繁，请稍后重试。" },
  DEPENDENCY_UNAVAILABLE: { status: 503, message: "依赖服务暂时不可用。" },
  INTERNAL_ERROR: { status: 500, message: "服务暂时不可用，请稍后重试。" },
} as const;

export type ApiErrorCode = keyof typeof errorCatalog;
