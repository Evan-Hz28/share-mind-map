import { describe, expect, it } from "vitest";

import { CsrfService } from "../src/auth/csrf/csrf.service.js";

describe("CsrfService", () => {
  it("issues a random 32-byte value and stores a one-way digest", () => {
    const csrf = new CsrfService();
    const first = csrf.issue();
    const second = csrf.issue();

    expect(Buffer.from(first.value, "base64url")).toHaveLength(32);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.digest).not.toContain(first.value);
    expect(second.value).not.toBe(first.value);
    expect(second.digest).not.toBe(first.digest);
  });

  it("accepts only the exact value bound to the session digest", () => {
    const csrf = new CsrfService();
    const issued = csrf.issue();

    expect(csrf.verify(issued.value, issued.digest)).toBe(true);
    expect(csrf.verify(`${issued.value}x`, issued.digest)).toBe(false);
    expect(csrf.verify("%%%", issued.digest)).toBe(false);
    expect(csrf.verify(issued.value, "not-a-digest")).toBe(false);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("does not require a token for safe %s", (method) => {
    const csrf = new CsrfService();

    expect(() => {
      csrf.assertRequest(method, undefined, "unused");
    }).not.toThrow();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects missing or mismatched tokens for unsafe %s",
    (method) => {
      const csrf = new CsrfService();
      const issued = csrf.issue();

      expect(() => {
        csrf.assertRequest(method, undefined, issued.digest);
      }).toThrow(expect.objectContaining({ code: "CSRF_INVALID" }));
      expect(() => {
        csrf.assertRequest(method, "wrong", issued.digest);
      }).toThrow(expect.objectContaining({ code: "CSRF_INVALID" }));
      expect(() => {
        csrf.assertRequest(method, issued.value, issued.digest);
      }).not.toThrow();
    },
  );
});
