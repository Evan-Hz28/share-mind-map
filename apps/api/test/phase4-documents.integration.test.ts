import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type AuthenticatedSession,
  type AuthTestRuntime,
  authenticatedAdmin,
  resetAuthTestRuntime,
  startAuthTestRuntime,
  stopAuthTestRuntime,
} from "./helpers/auth-fixtures.js";

let runtime: AuthTestRuntime;
let admin: AuthenticatedSession;

function workspaceId(session: AuthenticatedSession): string {
  const workspace = session.body.defaultWorkspace;
  if (
    typeof workspace !== "object" ||
    workspace === null ||
    !("id" in workspace) ||
    typeof workspace.id !== "string"
  ) {
    throw new Error("Default workspace is missing from the session response");
  }
  return workspace.id;
}

async function createDocument(): Promise<{ workspaceId: string; documentId: string }> {
  const currentWorkspaceId = workspaceId(admin);
  const response = await request(runtime.server)
    .post(`/api/v1/workspaces/${currentWorkspaceId}/documents`)
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ name: "Phase 4 save document" });
  expect(response.status).toBe(201);
  return {
    workspaceId: currentWorkspaceId,
    documentId: (response.body as { document: { id: string } }).document.id,
  };
}

async function lockDocument(
  currentWorkspaceId: string,
  documentId: string,
): Promise<{
  token: string;
  generation: number;
}> {
  const response = await request(runtime.server)
    .post(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/lock`)
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ browserEditSessionId: "phase4-save-browser" });
  expect(response.status).toBe(201);
  return (response.body as { lock: { token: string; generation: number } }).lock;
}

async function currentSnapshot(
  currentWorkspaceId: string,
  documentId: string,
): Promise<Record<string, unknown>> {
  const response = await request(runtime.server)
    .get(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}`)
    .set("Cookie", admin.cookie);
  expect(response.status).toBe(200);
  const snapshot = (response.body as { document: { snapshot: unknown } }).document.snapshot;
  if (typeof snapshot !== "object" || snapshot === null) throw new Error("Snapshot is missing");
  return structuredClone(snapshot) as Record<string, unknown>;
}

beforeAll(async () => {
  runtime = await startAuthTestRuntime();
}, 120_000);

beforeEach(async () => {
  await resetAuthTestRuntime(runtime);
  admin = await authenticatedAdmin(runtime);
});

afterAll(async () => {
  await stopAuthTestRuntime(runtime);
});

describe("Phase 4 version-safe document snapshots", () => {
  it("saves an immutable next version and updates the current snapshot", async () => {
    const { workspaceId: currentWorkspaceId, documentId } = await createDocument();
    const lock = await lockDocument(currentWorkspaceId, documentId);
    const snapshot = await currentSnapshot(currentWorkspaceId, documentId);
    const sheet = (snapshot.sheets as Array<Record<string, unknown>>)[0];
    const nodes = sheet?.nodes as Record<string, Record<string, unknown>>;
    const rootNodeId = sheet?.rootNodeId as string;
    const rootNode = nodes[rootNodeId];
    if (rootNode === undefined) throw new Error("Root node is missing");
    rootNode.title = "Saved Phase 4 title";

    const saved = await request(runtime.server)
      .post(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/snapshots`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", "phase4-save-1")
      .send({
        baseVersion: 1,
        saveKind: "manual",
        snapshot,
        imageBytes: 0,
        assetIds: [],
        browserEditSessionId: "phase4-save-browser",
        token: lock.token,
        generation: lock.generation,
      });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ snapshot: { version: 2 }, document: { currentVersion: 2 } });

    const rows = await runtime.database.$client.query<{
      current_version: number;
      snapshot_count: string;
      current_snapshot_title: string;
      old_snapshot_title: string;
    }>(
      `SELECT d.current_version,
              (SELECT count(*)::text FROM document_snapshots WHERE document_id = d.id) AS snapshot_count,
              current_snapshot.snapshot_json #>> '{sheets,0,nodes}' AS current_snapshot_title,
              old_snapshot.snapshot_json #>> '{sheets,0,nodes}' AS old_snapshot_title
       FROM documents d
       JOIN document_snapshots current_snapshot ON current_snapshot.id = d.current_snapshot_id
       JOIN document_snapshots old_snapshot ON old_snapshot.document_id = d.id AND old_snapshot.version = 1
       WHERE d.id = $1`,
      [documentId],
    );
    expect(Number(rows.rows[0]?.current_version)).toBe(2);
    expect(rows.rows[0]?.snapshot_count).toBe("2");
    expect(rows.rows[0]?.current_snapshot_title).toContain("Saved Phase 4 title");
    expect(rows.rows[0]?.old_snapshot_title).not.toContain("Saved Phase 4 title");

    const audit = await runtime.database.$client.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM audit_logs WHERE target_id = $1 AND action = 'document.snapshot.saved'`,
      [documentId],
    );
    expect(audit.rows[0]?.action).toBe("document.snapshot.saved");
    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain(lock.token);
  });

  it("returns the original result for an idempotent retry and rejects stale versions", async () => {
    const { workspaceId: currentWorkspaceId, documentId } = await createDocument();
    const lock = await lockDocument(currentWorkspaceId, documentId);
    const snapshot = await currentSnapshot(currentWorkspaceId, documentId);
    const saveUrl = `/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/snapshots`;
    const body = {
      baseVersion: 1,
      saveKind: "auto",
      snapshot,
      imageBytes: 0,
      assetIds: [],
      browserEditSessionId: "phase4-save-browser",
      token: lock.token,
      generation: lock.generation,
    };

    const first = await request(runtime.server)
      .post(saveUrl)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", "phase4-retry-1")
      .send(body);
    expect(first.status).toBe(201);
    const retry = await request(runtime.server)
      .post(saveUrl)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", "phase4-retry-1")
      .send(body);
    expect(retry.status).toBe(200);
    expect({ ...retry.body, idempotent: false }).toEqual({ ...first.body, idempotent: false });

    const stale = await request(runtime.server)
      .post(saveUrl)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", "phase4-retry-2")
      .send(body);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: "DOCUMENT_VERSION_CONFLICT" } });
  });

  it("rejects invalid snapshots and missing asset references", async () => {
    const { workspaceId: currentWorkspaceId, documentId } = await createDocument();
    const lock = await lockDocument(currentWorkspaceId, documentId);
    const saveUrl = `/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/snapshots`;
    const common = {
      baseVersion: 1,
      saveKind: "manual",
      imageBytes: 0,
      browserEditSessionId: "phase4-save-browser",
      token: lock.token,
      generation: lock.generation,
    };
    const invalid = await request(runtime.server)
      .post(saveUrl)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", "phase4-invalid-1")
      .send({ ...common, snapshot: { schemaVersion: 1 } });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: { code: "DOCUMENT_SCHEMA_INVALID" } });

    const snapshot = await currentSnapshot(currentWorkspaceId, documentId);
    const sheet = (snapshot.sheets as Array<Record<string, unknown>>)[0];
    const nodes = sheet?.nodes as Record<string, Record<string, unknown>>;
    const rootNodeId = sheet?.rootNodeId as string;
    const rootNode = nodes[rootNodeId];
    if (rootNode === undefined) throw new Error("Root node is missing");
    rootNode.imageAssetId = "01994d29-f264-73f0-a4bd-f89da18b8a99";
    const missingAsset = await request(runtime.server)
      .post(saveUrl)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", "phase4-asset-1")
      .send({ ...common, snapshot, assetIds: [] });
    expect(missingAsset.status).toBe(400);
    expect(missingAsset.body).toMatchObject({ error: { code: "DOCUMENT_ASSET_INVALID" } });
  });

  it("exports a valid client draft without creating a snapshot or export job", async () => {
    const { workspaceId: currentWorkspaceId, documentId } = await createDocument();
    const snapshot = await currentSnapshot(currentWorkspaceId, documentId);
    const before = await runtime.database.$client.query<{ snapshots: string; jobs: string }>(
      `SELECT
         (SELECT count(*)::text FROM document_snapshots WHERE document_id = $1) AS snapshots,
         (SELECT count(*)::text FROM export_jobs WHERE document_id = $1) AS jobs`,
      [documentId],
    );
    const response = await request(runtime.server)
      .post(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/draft-export`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .buffer(true)
      .parse((stream, callback) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        stream.on("end", () => {
          callback(null, Buffer.concat(chunks));
        });
      })
      .send({ snapshot });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/xmind");
    expect(Buffer.isBuffer(response.body)).toBe(true);

    const after = await runtime.database.$client.query<{ snapshots: string; jobs: string }>(
      `SELECT
         (SELECT count(*)::text FROM document_snapshots WHERE document_id = $1) AS snapshots,
         (SELECT count(*)::text FROM export_jobs WHERE document_id = $1) AS jobs`,
      [documentId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
