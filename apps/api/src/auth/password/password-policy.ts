import { ApiError } from "../../platform/errors/api-error.js";

const loginNamePattern = /^[A-Za-z0-9._-]{3,64}$/;
const minimumPasswordLength = 12;
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
