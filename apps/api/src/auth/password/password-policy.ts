import { ApiError } from "../../platform/errors/api-error.js";

const loginNamePattern = /^[A-Za-z0-9._-]{3,64}$/;
/**
 * 下限只用于**设置**密码(见 validatePassword 的调用点):登录时只跑 verify,
 * 所以调低它不会让任何已有账号登不进来,老密码也不会被要求改。
 */
const minimumPasswordLength = 6;
const maximumPasswordLength = 128;

export function validateLoginName(loginName: string): void {
  if (!loginNamePattern.test(loginName)) {
    throw new ApiError("INVALID_INPUT", { field: "loginName" });
  }
}

export function normalizeLoginName(loginName: string): string {
  validateLoginName(loginName);
  return loginName.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function validatePassword(password: string): void {
  const length = Array.from(password).length;
  if (length < minimumPasswordLength || length > maximumPasswordLength) {
    throw new ApiError("INVALID_INPUT", { field: "password" });
  }
}
