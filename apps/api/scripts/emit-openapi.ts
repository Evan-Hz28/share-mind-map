import "reflect-metadata";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { INestApplication } from "@nestjs/common";
import type { OpenAPIObject, OperationObject } from "@nestjs/swagger";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
export const defaultOpenApiPath = fileURLToPath(
  new URL("../../../packages/api-client/openapi.json", import.meta.url),
);

const requiredOperationIds = [
  "adminChangeAccountStatus",
  "adminCreateMember",
  "adminListMembers",
  "adminResetMemberPassword",
  "adminRevokeMemberSessions",
  "adminListEditPermissionRequests",
  "adminListAuditLogs",
  "adminReadStorageUsage",
  "approveEditPermissionRequest",
  "authChangePassword",
  "authCsrf",
  "authLogin",
  "authLogout",
  "getMe",
  "createEditPermissionRequest",
  "createFolder",
  "createBlankDocument",
  "listFolders",
  "renameFolder",
  "deleteFolder",
  "checkFolderDelete",
  "listDocuments",
  "getDocumentMetadata",
  "updateDocumentMetadata",
  "rejectEditPermissionRequest",
  "revokeMemberEditing",
  "listNotifications",
  "readNotification",
  "readAllNotifications",
] as const;

const authenticatedMutations = [
  ["/api/v1/auth/password", "put"],
  ["/api/v1/auth/logout", "post"],
  ["/api/v1/admin/members", "post"],
  ["/api/v1/admin/members/{id}/password/reset", "post"],
  ["/api/v1/admin/members/{id}/account-status", "patch"],
  ["/api/v1/admin/members/{id}/sessions/revoke", "post"],
  ["/api/v1/workspaces/{workspaceId}/folders", "post"],
  ["/api/v1/workspaces/{workspaceId}/folders/{folderId}", "patch"],
  ["/api/v1/workspaces/{workspaceId}/folders/{folderId}", "delete"],
  ["/api/v1/workspaces/{workspaceId}/folders/{folderId}/delete-check", "post"],
  ["/api/v1/workspaces/{workspaceId}/documents", "post"],
  ["/api/v1/workspaces/{workspaceId}/documents/{documentId}", "patch"],
  ["/api/v1/workspaces/{workspaceId}/edit-requests", "post"],
  ["/api/v1/admin/edit-requests/{requestId}/approve", "post"],
  ["/api/v1/admin/edit-requests/{requestId}/reject", "post"],
  ["/api/v1/admin/members/{membershipId}/revoke-editing", "post"],
  ["/api/v1/notifications/{notificationId}/read", "post"],
  ["/api/v1/notifications/read-all", "post"],
] as const;

const operationMethods = ["delete", "get", "head", "options", "patch", "post", "put", "trace"];
const sortedArrayKeys = new Set(["enum", "required", "tags"]);

const artifactConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 3000,
  apiPublicUrl: new URL("http://localhost:3000"),
  webOrigin: new URL("http://localhost:5173"),
  databaseUrl: "postgresql://openapi:openapi@localhost:5432/openapi",
  redisUrl: "redis://localhost:6379",
  minio: {
    endpoint: new URL("http://localhost:9000"),
    accessKey: "openapi",
    secretKey: "openapi-only-placeholder",
    bucket: "share-mind-map",
    useSsl: false,
  },
  smtp: {
    host: "localhost",
    port: 1025,
    secure: false,
    from: "share-mind-map@localhost",
  },
  sessionSecret: "openapi-only-placeholder",
  sessionTtlSeconds: 86_400,
  documentLockTtlSeconds: 900,
  cookie: { secure: false, sameSite: "lax" },
  argon2: { memoryKiB: 8_192, iterations: 1, parallelism: 1 },
  queuePrefix: "smm",
  logLevel: "silent",
};

const healthChecks = {
  postgres: () => Promise.resolve(),
  redis: () => Promise.resolve(),
  minio: () => Promise.resolve(),
  smtp: () => Promise.resolve(),
};

interface BuiltMainModule {
  createApp(options: {
    config: typeof artifactConfig;
    healthChecks: typeof healthChecks;
  }): Promise<INestApplication>;
}

interface BuiltOpenApiModule {
  buildOpenApiDocument(app: INestApplication): OpenAPIObject;
}

function sortValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => sortValue(entry));
    if (key === "tags" && entries.every((entry) => typeof entry === "object" && entry !== null)) {
      return entries.sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
    }
    if (key !== undefined && sortedArrayKeys.has(key)) {
      return entries.sort((left, right) => String(left).localeCompare(String(right)));
    }
    return entries;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entryKey, entry]) => [entryKey, sortValue(entry, entryKey)]),
  );
}

function operations(document: OpenAPIObject): OperationObject[] {
  const result: OperationObject[] = [];
  for (const path of Object.values(document.paths)) {
    for (const method of operationMethods) {
      const operation = path[method as keyof typeof path];
      if (operation !== undefined && typeof operation === "object" && "responses" in operation) {
        result.push(operation);
      }
    }
  }
  return result;
}

function addRequestIdHeader(document: OpenAPIObject): void {
  document.components ??= {};
  document.components.parameters ??= {};
  document.components.parameters.RequestIdHeader = {
    name: "X-Request-ID",
    in: "header",
    required: false,
    description: "Optional caller-provided request correlation identifier.",
    schema: { type: "string", minLength: 16, maxLength: 64 },
  };
  for (const operation of operations(document)) {
    const parameters = operation.parameters ?? [];
    const hasRequestId = parameters.some(
      (parameter) =>
        "$ref" in parameter && parameter.$ref === "#/components/parameters/RequestIdHeader",
    );
    if (!hasRequestId) {
      operation.parameters = [...parameters, { $ref: "#/components/parameters/RequestIdHeader" }];
    }
  }
}

function operationAt(
  document: OpenAPIObject,
  path: string,
  method: string,
): OperationObject | undefined {
  const pathItem = document.paths[path];
  if (pathItem === undefined) return undefined;
  const operation = pathItem[method as keyof typeof pathItem];
  return operation !== undefined && typeof operation === "object" && "responses" in operation
    ? operation
    : undefined;
}

function assertOpenApi(document: OpenAPIObject): void {
  const ids = operations(document).flatMap((operation) => operation.operationId ?? []);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0)
    throw new Error(`Duplicate OpenAPI operation IDs: ${duplicates.join(", ")}`);
  const missing = requiredOperationIds.filter((id) => !ids.includes(id));
  if (missing.length > 0) throw new Error(`Missing phase 1 operation IDs: ${missing.join(", ")}`);

  for (const path of Object.keys(document.paths)) {
    if (path.startsWith("/api/v1/") || path === "/health/live" || path === "/health/ready")
      continue;
    throw new Error(`OpenAPI path is outside the approved phase 1 prefixes: ${path}`);
  }

  const schemes = document.components?.securitySchemes;
  for (const name of ["sessionCookie", "csrfToken", "requestId"]) {
    if (schemes?.[name] === undefined) throw new Error(`Missing OpenAPI security scheme: ${name}`);
  }
  if (document.components?.schemas?.ApiErrorEnvelope === undefined) {
    throw new Error("Missing canonical ApiErrorEnvelope schema.");
  }

  for (const [path, method] of authenticatedMutations) {
    const security = operationAt(document, path, method)?.security;
    const requirement = security?.[0];
    if (
      security?.length !== 1 ||
      requirement?.sessionCookie === undefined ||
      requirement.csrfToken === undefined
    ) {
      throw new Error(
        `${method.toUpperCase()} ${path} must require session cookie and CSRF together.`,
      );
    }
  }

  for (const operation of operations(document)) {
    const parameters = operation.parameters ?? [];
    if (
      !parameters.some(
        (parameter) =>
          "$ref" in parameter && parameter.$ref === "#/components/parameters/RequestIdHeader",
      )
    ) {
      throw new Error(
        `Operation ${operation.operationId ?? "<missing>"} lacks X-Request-ID metadata.`,
      );
    }
  }

  const serialized = JSON.stringify(document);
  if (/register|sign.?up/i.test(serialized))
    throw new Error("Registration is outside phase 1 scope.");
  if (/passwordHash|providerSubject|sessionToken|csrfDigest/i.test(serialized)) {
    throw new Error("OpenAPI exposes an internal authentication field.");
  }
}

export async function renderOpenApi(): Promise<string> {
  const mainUrl = pathToFileURL(resolve(apiDirectory, "dist/main.js")).href;
  const openApiUrl = pathToFileURL(resolve(apiDirectory, "dist/openapi.js")).href;
  const mainModule = (await import(mainUrl)) as BuiltMainModule;
  const openApiModule = (await import(openApiUrl)) as BuiltOpenApiModule;
  const app = await mainModule.createApp({ config: artifactConfig, healthChecks });
  try {
    const document = openApiModule.buildOpenApiDocument(app);
    addRequestIdHeader(document);
    assertOpenApi(document);
    return `${JSON.stringify(sortValue(document), null, 2)}\n`;
  } finally {
    await app.close();
  }
}

export async function emitOpenApi(outputPath = defaultOpenApiPath): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await renderOpenApi(), "utf8");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await emitOpenApi();
  process.stdout.write(`Generated ${defaultOpenApiPath}\n`);
}
