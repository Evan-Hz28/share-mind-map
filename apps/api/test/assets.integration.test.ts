import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import {
  type AuthenticatedSession,
  type AuthTestRuntime,
  authenticatedAdmin,
  resetAuthTestRuntime,
  startAuthTestRuntime,
  stopAuthTestRuntime,
} from "./helpers/auth-fixtures.js";

const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082",
  "hex",
);

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

async function createDocument(name: string): Promise<{ workspaceId: string; documentId: string }> {
  const currentWorkspaceId = workspaceId(admin);
  const response = await request(runtime.server)
    .post(`/api/v1/workspaces/${currentWorkspaceId}/documents`)
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ name });
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
    .send({ browserEditSessionId: "phase4-asset-browser" });
  expect(response.status).toBe(201);
  return (response.body as { lock: { token: string; generation: number } }).lock;
}

async function upload(
  currentWorkspaceId: string,
  documentId: string,
  lock: { token: string; generation: number },
  bytes = png1x1,
  path = "images/root.png",
): Promise<{ id: string; sha256: string }> {
  const response = await request(runtime.server)
    .post(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/assets`)
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrfToken)
    .set("X-Browser-Edit-Session", "phase4-asset-browser")
    .set("X-Lock-Token", lock.token)
    .set("X-Lock-Generation", String(lock.generation))
    .set("X-Asset-Path", path)
    .attach("file", bytes, { filename: "renamed.bin", contentType: "image/svg+xml" });
  expect(response.status).toBe(201);
  return (response.body as { asset: { id: string; sha256: string } }).asset;
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

describe("document image assets", () => {
  it("validates bytes instead of the client MIME, reuses SHA bytes, and hides pending assets", async () => {
    const { workspaceId: currentWorkspaceId, documentId } = await createDocument("Asset document");
    const lock = await lockDocument(currentWorkspaceId, documentId);
    const first = await upload(currentWorkspaceId, documentId, lock);
    const duplicate = await upload(currentWorkspaceId, documentId, lock, png1x1, "images/copy.png");
    expect(duplicate.id).not.toBe(first.id);
    expect(duplicate.sha256).toBe(first.sha256);
    const objectKeys = await runtime.database.$client.query<{ object_key: string }>(
      `SELECT object_key FROM document_assets WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[first.id, duplicate.id]],
    );
    expect(objectKeys.rows[0]?.object_key).toBe(objectKeys.rows[1]?.object_key);

    const pendingRead = await request(runtime.server)
      .get(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/assets/${first.id}`)
      .set("Cookie", admin.cookie);
    expect(pendingRead.status).toBe(404);
    expect(pendingRead.body).toMatchObject({ error: { code: "ASSET_NOT_REFERENCED" } });
  });

  it("serves only a current-snapshot reference and rejects a foreign document", async () => {
    const firstDocument = await createDocument("Referenced asset document");
    const secondDocument = await createDocument("Foreign asset document");
    const lock = await lockDocument(firstDocument.workspaceId, firstDocument.documentId);
    const asset = await upload(firstDocument.workspaceId, firstDocument.documentId, lock);
    const snapshotResponse = await request(runtime.server)
      .get(`/api/v1/workspaces/${firstDocument.workspaceId}/documents/${firstDocument.documentId}`)
      .set("Cookie", admin.cookie);
    const snapshot = structuredClone(
      (snapshotResponse.body as { document: { snapshot: Record<string, unknown> } }).document
        .snapshot,
    );
    const sheet = (snapshot.sheets as Array<Record<string, unknown>>)[0];
    const nodes = sheet?.nodes as Record<string, Record<string, unknown>>;
    const rootNodeId = sheet?.rootNodeId as string;
    const rootNode = nodes[rootNodeId];
    if (rootNode === undefined) throw new Error("Root node is missing");
    rootNode.imageAssetId = asset.id;
    const saved = await request(runtime.server)
      .post(
        `/api/v1/workspaces/${firstDocument.workspaceId}/documents/${firstDocument.documentId}/snapshots`,
      )
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", "phase4-asset-reference-1")
      .send({
        baseVersion: 1,
        saveKind: "manual",
        snapshot,
        imageBytes: png1x1.byteLength,
        assetIds: [asset.id],
        browserEditSessionId: "phase4-asset-browser",
        token: lock.token,
        generation: lock.generation,
      });
    expect(saved.status).toBe(201);

    const read = await request(runtime.server)
      .get(
        `/api/v1/workspaces/${firstDocument.workspaceId}/documents/${firstDocument.documentId}/assets/${asset.id}`,
      )
      .set("Cookie", admin.cookie)
      .buffer(true);
    expect(read.status).toBe(200);
    expect(read.headers["content-type"]).toContain("image/png");

    const foreignRead = await request(runtime.server)
      .get(
        `/api/v1/workspaces/${secondDocument.workspaceId}/documents/${secondDocument.documentId}/assets/${asset.id}`,
      )
      .set("Cookie", admin.cookie);
    expect(foreignRead.status).toBe(404);
    expect(foreignRead.body).toMatchObject({ error: { code: "ASSET_NOT_FOUND" } });
  });

  it("enforces the exact five MiB byte boundary", async () => {
    const { workspaceId: currentWorkspaceId, documentId } =
      await createDocument("Size asset document");
    const lock = await lockDocument(currentWorkspaceId, documentId);
    const exact = Buffer.concat([png1x1, Buffer.alloc(5 * 1024 * 1024 - png1x1.length)]);
    const accepted = await upload(currentWorkspaceId, documentId, lock, exact, "images/exact.png");
    expect(accepted.sha256).toHaveLength(64);
    const tooLarge = await request(runtime.server)
      .post(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/assets`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("X-Browser-Edit-Session", "phase4-asset-browser")
      .set("X-Lock-Token", lock.token)
      .set("X-Lock-Generation", String(lock.generation))
      .set("X-Asset-Path", "images/too-large.png")
      .attach("file", Buffer.concat([exact, Buffer.from([0])]), { filename: "x.png" });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toMatchObject({ error: { code: "ASSET_TOO_LARGE" } });
  });

  it("rejects a current snapshot whose referenced images exceed 50 MiB", async () => {
    const { workspaceId: currentWorkspaceId, documentId } =
      await createDocument("Quota asset document");
    const lock = await lockDocument(currentWorkspaceId, documentId);
    const assets = Array.from({ length: 11 }, () => uuidv7());
    for (const [index, assetId] of assets.entries()) {
      await runtime.database.$client.query(
        `INSERT INTO document_assets
           (id, workspace_id, document_id, asset_kind, source_path, object_key, media_type, byte_size, sha256)
         VALUES ($1, $2, $3, 'image', $4, $5, 'image/png', $6, $7)`,
        [
          assetId,
          currentWorkspaceId,
          documentId,
          `images/quota-${String(index)}.png`,
          `assets/quota/${assetId}`,
          5 * 1024 * 1024,
          String(index).padStart(64, "0"),
        ],
      );
    }
    const detail = await request(runtime.server)
      .get(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}`)
      .set("Cookie", admin.cookie);
    const snapshot = structuredClone(
      (detail.body as { document: { snapshot: Record<string, unknown> } }).document.snapshot,
    );
    const sheet = (snapshot.sheets as Array<Record<string, unknown>>)[0];
    const nodes = sheet?.nodes as Record<string, Record<string, unknown>>;
    const rootNodeId = sheet?.rootNodeId as string;
    const rootNode = nodes[rootNodeId];
    if (rootNode === undefined || !Array.isArray(rootNode.childIds))
      throw new Error("Root node is missing");
    for (const assetId of assets) {
      const nodeId = uuidv7();
      rootNode.childIds.push(nodeId);
      nodes[nodeId] = {
        id: nodeId,
        parentId: rootNodeId,
        childIds: [],
        title: `Quota ${nodeId}`,
        priority: null,
        notes: { format: "plain", text: "" },
        labels: [],
        icons: [],
        style: {},
        imageAssetId: assetId,
        extensions: {},
      };
    }
    const response = await request(runtime.server)
      .post(`/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/snapshots`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", "phase4-image-quota-1")
      .send({
        baseVersion: 1,
        saveKind: "manual",
        snapshot,
        imageBytes: 0,
        assetIds: assets,
        browserEditSessionId: "phase4-asset-browser",
        token: lock.token,
        generation: lock.generation,
      });
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ error: { code: "DOCUMENT_IMAGE_QUOTA_EXCEEDED" } });
  });
});
