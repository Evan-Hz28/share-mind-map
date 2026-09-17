import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "../src/index.js";
import { authCsrf, authLogout, getMe } from "../src/generated/index.js";
import { findApiClientDrift } from "../../../scripts/check-api-client.mjs";

interface OpenApiOperation {
  operationId?: string;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const openApiPath = new URL("../openapi.json", import.meta.url);
const expectedOperationIds = [
  "adminChangeAccountStatus",
  "adminCreateMember",
  "adminListMembers",
  "adminResetMemberPassword",
  "adminRevokeMemberSessions",
  "authChangePassword",
  "authCsrf",
  "authLogin",
  "authLogout",
  "getMe",
];

async function readOpenApi(): Promise<OpenApiDocument> {
  return JSON.parse(await readFile(openApiPath, "utf8")) as OpenApiDocument;
}

function operationIds(document: OpenApiDocument): string[] {
  return Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .flatMap((operation) => operation.operationId ?? [])
    .sort();
}

describe("generated phase 1 API contract", () => {
  it("contains every phase 1 operation exactly once and no registration operation", async () => {
    const document = await readOpenApi();
    const ids = operationIds(document);

    expect(ids).toEqual(expect.arrayContaining(expectedOperationIds));
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      Object.keys(document.paths).every(
        (path) =>
          path.startsWith("/api/v1/") || path === "/health/live" || path === "/health/ready",
      ),
    ).toBe(true);
    expect(JSON.stringify(document)).not.toMatch(/register|sign.?up/i);
    expect(JSON.stringify(document)).not.toMatch(
      /passwordHash|providerSubject|sessionToken|csrfDigest/i,
    );
  });

  it("configures cookie credentials on the generated client", () => {
    const client = createApiClient({
      baseUrl: "http://api.test",
      getCsrfToken: () => "csrf",
    });

    expect(client.config.credentials).toBe("include");
    expect(client.config.baseUrl).toBe("http://api.test");
  });

  it("adds in-memory CSRF and request IDs only where appropriate", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", (request: Request) => {
      requests.push(request);
      const body = request.method === "GET" ? JSON.stringify({ csrfToken: "rotated" }) : null;
      return Promise.resolve(
        new Response(
          body,
          body === null
            ? { status: 204 }
            : { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    try {
      const client = createApiClient({
        baseUrl: "http://api.test",
        getCsrfToken: () => "csrf-value",
      });

      await authLogout({ client });
      await authCsrf({ client });

      const mutation = requests[0];
      const safeGet = requests[1];
      expect(mutation?.credentials).toBe("include");
      expect(mutation?.headers.get("X-CSRF-Token")).toBe("csrf-value");
      expect(mutation?.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
      expect(safeGet?.headers.has("X-CSRF-Token")).toBe(false);
      expect(safeGet?.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves caller request IDs and reports each unauthorized response once", async () => {
    const onUnauthorized = vi.fn();
    let captured: Request | undefined;
    vi.stubGlobal("fetch", (request: Request) => {
      captured = request;
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    try {
      const client = createApiClient({
        baseUrl: "http://api.test",
        getCsrfToken: () => undefined,
        onUnauthorized,
      });

      await getMe({ client, headers: { "X-Request-ID": "caller-request-id-0001" } });

      expect(captured?.headers.get("X-Request-ID")).toBe("caller-request-id-0001");
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports changed, missing, and extra generated artifacts by relative path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "api-client-drift-test-"));
    const expected = join(parent, "expected");
    const actual = join(parent, "actual");
    try {
      for (const root of [expected, actual]) {
        await mkdir(join(root, "src/generated"), { recursive: true });
        await writeFile(join(root, "openapi.json"), "{}\n", "utf8");
        await writeFile(join(root, "src/generated/types.gen.ts"), "export {};\n", "utf8");
        await writeFile(join(root, "src/generated/sdk.gen.ts"), "export {};\n", "utf8");
      }

      expect(await findApiClientDrift(expected, actual)).toEqual([]);

      await writeFile(join(actual, "src/generated/types.gen.ts"), "export type Drift = true;\n");
      await rm(join(actual, "src/generated/sdk.gen.ts"));
      await writeFile(join(actual, "src/generated/extra.gen.ts"), "export {};\n");

      expect(await findApiClientDrift(expected, actual)).toEqual([
        "src/generated/extra.gen.ts",
        "src/generated/sdk.gen.ts",
        "src/generated/types.gen.ts",
      ]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
