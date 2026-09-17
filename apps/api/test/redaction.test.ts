import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { AppLogger } from "../src/platform/logging/logger.js";
import { redact } from "../src/platform/logging/redaction.js";

describe("structured-log redaction", () => {
  it("redacts nested credentials, headers, tokens, and content bodies", () => {
    const input = {
      password: "plain-password",
      nested: {
        currentPassword: "old-password",
        newPassword: "new-password",
        temporaryPassword: "one-time-password",
        passwordHash: "argon-hash",
        sessionId: "session-reference",
        sessionToken: "raw-token",
        clientSecret: "client-secret",
        minioRootPassword: "minio-secret",
        apiToken: "api-token",
      },
      headers: {
        authorization: "Bearer secret",
        cookie: "smm_session=secret",
        "set-cookie": "smm_session=secret",
        "x-csrf-token": "csrf-secret",
      },
      payloads: [{ snapshot: { title: "private" } }, { document: "private" }, { image: "bytes" }],
      bodies: {
        snapshotBody: { title: "private" },
        documentBody: "private",
        imageBytes: "private",
      },
      safe: { requestId: "request-12345678", userId: "user-safe" },
    };

    expect(redact(input)).toEqual({
      password: "[REDACTED]",
      nested: {
        currentPassword: "[REDACTED]",
        newPassword: "[REDACTED]",
        temporaryPassword: "[REDACTED]",
        passwordHash: "[REDACTED]",
        sessionId: "[REDACTED]",
        sessionToken: "[REDACTED]",
        clientSecret: "[REDACTED]",
        minioRootPassword: "[REDACTED]",
        apiToken: "[REDACTED]",
      },
      headers: {
        authorization: "[REDACTED]",
        cookie: "[REDACTED]",
        "set-cookie": "[REDACTED]",
        "x-csrf-token": "[REDACTED]",
      },
      payloads: [{ snapshot: "[REDACTED]" }, { document: "[REDACTED]" }, { image: "[REDACTED]" }],
      bodies: {
        snapshotBody: "[REDACTED]",
        documentBody: "[REDACTED]",
        imageBytes: "[REDACTED]",
      },
      safe: { requestId: "request-12345678", userId: "user-safe" },
    });
    expect(input.password).toBe("plain-password");
  });

  it("handles recursive input without leaking the recursive object", () => {
    const input: Record<string, unknown> = { operation: "test" };
    input.self = input;

    expect(redact(input)).toEqual({ operation: "test", self: "[REDACTED]" });
  });

  it("writes structured JSON with required context and no secret values", () => {
    let output = "";
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString("utf8");
        callback();
      },
    });
    const logger = new AppLogger({ environment: "test", level: "info", destination });

    logger.event({
      requestId: "request-12345678",
      userId: "user-safe",
      targetId: "target-safe",
      operation: "member.list",
      durationMs: 12,
      result: "failure",
      errorCode: "DEPENDENCY_UNAVAILABLE",
      password: "never-log-this",
    });

    expect(output).toContain('"service":"api"');
    expect(output).toContain('"environment":"test"');
    expect(output).toContain('"requestId":"request-12345678"');
    expect(output).toContain('"operation":"member.list"');
    expect(output).toContain('"durationMs":12');
    expect(output).toContain('"result":"failure"');
    expect(output).toContain('"errorCode":"DEPENDENCY_UNAVAILABLE"');
    expect(output).toMatch(/"time":"\d{4}-\d{2}-\d{2}T/);
    expect(output).not.toContain("never-log-this");
  });
});
