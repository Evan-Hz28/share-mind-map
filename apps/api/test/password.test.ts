import { describe, expect, it } from "vitest";

import { normalizeLoginName, validateLoginName } from "../src/auth/password/password-policy.js";
import { PasswordService } from "../src/auth/password/password.service.js";

const testPasswordConfig = {
  environment: "test" as const,
  argon2: { memoryKiB: 8_192, iterations: 1, parallelism: 1 },
};

describe("login-name and password policy", () => {
  it("normalizes valid login names with ASCII lowercase only", () => {
    expect(normalizeLoginName("Reader.ONE-_2")).toBe("reader.one-_2");
  });

  it.each(["ab", "a".repeat(65), "user name", "usér", "reader@example.com"])(
    "rejects invalid login name %j",
    (loginName) => {
      expect(() => {
        validateLoginName(loginName);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    },
  );

  it.each([11, 129])("rejects password length %s", async (length) => {
    const passwords = new PasswordService(testPasswordConfig);

    await expect(passwords.hash("x".repeat(length))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("counts Unicode code points rather than UTF-16 code units", async () => {
    const passwords = new PasswordService(testPasswordConfig);
    const twelveCodePoints = "𝓼".repeat(12);

    expect(twelveCodePoints.length).toBe(24);
    await expect(passwords.hash(twelveCodePoints)).resolves.toMatch(/^\$argon2id\$/);
  });

  it("does not trim or normalize passwords", async () => {
    const passwords = new PasswordService(testPasswordConfig);
    const original = "  Pa𝓼𝓼word-123  ";
    const hash = await passwords.hash(original);

    await expect(passwords.verify(hash, original)).resolves.toBe(true);
    await expect(passwords.verify(hash, original.trim())).resolves.toBe(false);
    await expect(passwords.verify(hash, original.normalize("NFKC"))).resolves.toBe(false);
  });

  it("uses explicit reduced Argon2id cost only in the test environment", async () => {
    const passwords = new PasswordService(testPasswordConfig);

    const encoded = await passwords.hash("Valid-Test-Password1");
    const parameters = (encoded.split("$")[3] ?? "").split(",").sort();

    expect(encoded).toMatch(/^\$argon2id\$v=19\$/);
    expect(parameters).toEqual(["m=8192", "p=1", "t=1"]);
    expect(
      () =>
        new PasswordService({
          environment: "development",
          argon2: { memoryKiB: 8_192, iterations: 1, parallelism: 1 },
        }),
    ).toThrow(/Argon2/);
  });

  it("returns false for a malformed hash without leaking an Argon2 error", async () => {
    const passwords = new PasswordService(testPasswordConfig);

    await expect(passwords.verify("not-an-argon2-hash", "Valid-Test-Password1")).resolves.toBe(
      false,
    );
  });

  it("generates a 24-character temporary password with every required class", () => {
    const passwords = new PasswordService(testPasswordConfig);
    const temporary = passwords.generateTemporary();

    expect(Array.from(temporary)).toHaveLength(24);
    expect(temporary).toMatch(/[A-Z]/);
    expect(temporary).toMatch(/[a-z]/);
    expect(temporary).toMatch(/[0-9]/);
    expect(temporary).toMatch(/[!#$%&*+\-=?@^_]/);
    expect(temporary).toMatch(/^[A-Za-z0-9!#$%&*+\-=?@^_]+$/);
  });
});
