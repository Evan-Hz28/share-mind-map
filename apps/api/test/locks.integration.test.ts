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
    .send({ name: "Lock test document" });
  expect(response.status).toBe(201);
  return {
    workspaceId: currentWorkspaceId,
    documentId: (response.body as { document: { id: string } }).document.id,
  };
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

describe("document editing locks", () => {
  it("enforces one browser owner, renews heartbeats, and hides token material", async () => {
    const { workspaceId: currentWorkspaceId, documentId } = await createDocument();
    const lockUrl = `/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/lock`;

    const acquired = await request(runtime.server)
      .post(lockUrl)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ browserEditSessionId: "browser-one" });
    expect(acquired.status).toBe(201);
    expect(acquired.body).toMatchObject({ lock: { generation: 1 } });
    const acquiredBody = acquired.body as { lock: { token: string; generation: number } };
    const lock = acquiredBody.lock;

    const occupied = await request(runtime.server)
      .post(lockUrl)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ browserEditSessionId: "browser-two" });
    expect(occupied.status).toBe(409);
    expect(occupied.body).toMatchObject({ error: { code: "DOCUMENT_LOCKED" } });

    const inspected = await request(runtime.server).get(lockUrl).set("Cookie", admin.cookie);
    expect(inspected.status).toBe(200);
    expect(inspected.body).toMatchObject({ lock: { occupied: true, generation: 1 } });
    expect(JSON.stringify(inspected.body)).not.toContain("tokenDigest");
    expect(JSON.stringify(inspected.body)).not.toContain(lock.token);

    const lost = await request(runtime.server)
      .post(`${lockUrl}/heartbeat`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({
        browserEditSessionId: "browser-one",
        token: lock.token,
        generation: lock.generation + 1,
      });
    expect(lost.status).toBe(423);
    expect(lost.body).toMatchObject({ error: { code: "LOCK_LOST" } });

    const renewed = await request(runtime.server)
      .post(`${lockUrl}/heartbeat`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({
        browserEditSessionId: "browser-one",
        token: lock.token,
        generation: lock.generation,
      });
    expect(renewed.status).toBe(200);
  });

  it("allows an administrator to force release and records an audit event", async () => {
    const { workspaceId: currentWorkspaceId, documentId } = await createDocument();
    const lockUrl = `/api/v1/workspaces/${currentWorkspaceId}/documents/${documentId}/lock`;
    const acquired = await request(runtime.server)
      .post(lockUrl)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ browserEditSessionId: "browser-one" });
    const acquiredBody = acquired.body as { lock: { token: string; generation: number } };
    const lock = acquiredBody.lock;

    const released = await request(runtime.server)
      .post(`${lockUrl}/force-release`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ confirm: true });
    expect(released.status).toBe(201);
    expect(released.body).toMatchObject({ lock: { generation: 2, occupied: false } });

    const staleHeartbeat = await request(runtime.server)
      .post(`${lockUrl}/heartbeat`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ browserEditSessionId: "browser-one", token: lock.token, generation: 1 });
    expect(staleHeartbeat.status).toBe(423);

    const audit = await runtime.database.$client.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM audit_logs
       WHERE workspace_id = $1 AND target_id = $2 AND action = 'document.lock.force_released'
       ORDER BY created_at DESC LIMIT 1`,
      [currentWorkspaceId, documentId],
    );
    expect(audit.rows[0]?.action).toBe("document.lock.force_released");
    expect(audit.rows[0]?.metadata).toMatchObject({ generation: 2 });
  });
});
