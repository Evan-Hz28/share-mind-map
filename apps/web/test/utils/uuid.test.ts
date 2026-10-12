import { describe, expect, it } from "vitest";

import { randomUuid } from "../../src/utils/uuid.js";

const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 模拟非安全上下文:浏览器在那里不会暴露 crypto.randomUUID。 */
function withoutNativeRandomUuid(run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
  Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    run();
  } finally {
    if (original === undefined) {
      delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    } else {
      Object.defineProperty(globalThis.crypto, "randomUUID", original);
    }
  }
}

describe("randomUuid", () => {
  it("returns an RFC 4122 version 4 UUID", () => {
    expect(randomUuid()).toMatch(v4);
  });

  it("still returns v4 UUIDs when crypto.randomUUID is unavailable", () => {
    withoutNativeRandomUuid(() => {
      const values = Array.from({ length: 256 }, () => randomUuid());

      expect(values.every((value) => v4.test(value))).toBe(true);
      expect(new Set(values).size).toBe(values.length);
    });
  });
});
