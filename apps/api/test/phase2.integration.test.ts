import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NotificationRepository } from "@share-mind-map/database";
import {
  type AuthenticatedSession,
  type AuthTestRuntime,
  authenticatedAdmin,
  changePassword,
  login,
  resetAuthTestRuntime,
  responseBody,
  startAuthTestRuntime,
  stopAuthTestRuntime,
} from "./helpers/auth-fixtures.js";

let runtime: AuthTestRuntime;
let admin: AuthenticatedSession;

interface CreatedMemberBody {
  member: { id: string };
  temporaryPassword: string;
}

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

async function createReader(loginName: string): Promise<{
  membershipId: string;
  session: AuthenticatedSession;
}> {
  const response = await request(runtime.server)
    .post("/api/v1/admin/members")
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ loginName, displayName: "Phase 2 Reader" });
  const body = responseBody(response) as CreatedMemberBody;
  const temporaryLogin = await login(runtime, loginName, body.temporaryPassword);
  if (temporaryLogin.session === undefined) throw new Error("Reader temporary login failed");
  expect(
    (
      await changePassword(
        runtime,
        temporaryLogin.session,
        body.temporaryPassword,
        "Phase2-Reader-Permanent-Password-1",
      )
    ).status,
  ).toBe(204);
  const permanentLogin = await login(runtime, loginName, "Phase2-Reader-Permanent-Password-1");
  if (permanentLogin.session === undefined) throw new Error("Reader permanent login failed");
  return { membershipId: body.member.id, session: permanentLogin.session };
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

describe("Phase 2 workspace and permission APIs", () => {
  it("runs Reader request, Admin approval, Editor creation and immediate revocation", async () => {
    const reader = await createReader("phase2.reader");
    const workspace = workspaceId(reader.session);

    expect(
      (
        await request(runtime.server)
          .get(`/api/v1/workspaces/${workspace}/folders`)
          .set("Cookie", reader.session.cookie)
      ).status,
    ).toBe(200);
    const deniedFolder = await request(runtime.server)
      .post(`/api/v1/workspaces/${workspace}/folders`)
      .set("Cookie", reader.session.cookie)
      .set("X-CSRF-Token", reader.session.csrfToken)
      .send({ name: "Reader folder" });
    expect(deniedFolder.status).toBe(403);

    const submitted = await request(runtime.server)
      .post(`/api/v1/workspaces/${workspace}/edit-requests`)
      .set("Cookie", reader.session.cookie)
      .set("X-CSRF-Token", reader.session.csrfToken);
    expect(submitted.status).toBe(201);
    const requestId = (submitted.body as { request: { id: string } }).request.id;
    const duplicate = await request(runtime.server)
      .post(`/api/v1/workspaces/${workspace}/edit-requests`)
      .set("Cookie", reader.session.cookie)
      .set("X-CSRF-Token", reader.session.csrfToken);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body).toMatchObject({ changed: false, request: { id: requestId } });
    const requestNotifications = await runtime.database.$client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notification_outbox
       WHERE workspace_id = $1 AND event_type = 'edit_permission.requested'`,
      [workspace],
    );
    expect(requestNotifications.rows[0]?.count).toBe("1");

    const pending = await request(runtime.server)
      .get("/api/v1/admin/edit-requests?status=pending&limit=1")
      .set("Cookie", admin.cookie);
    expect(pending.status).toBe(200);
    expect((responseBody(pending) as { requests: unknown[] }).requests).toHaveLength(1);
    const approved = await request(runtime.server)
      .post(`/api/v1/admin/edit-requests/${requestId}/approve`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken);
    expect(approved.status).toBe(201);
    const repeatedApproval = await request(runtime.server)
      .post(`/api/v1/admin/edit-requests/${requestId}/approve`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken);
    expect(repeatedApproval.status).toBe(201);
    expect((responseBody(repeatedApproval) as { changed: boolean }).changed).toBe(false);

    const refreshed = await request(runtime.server)
      .get("/api/v1/me")
      .set("Cookie", reader.session.cookie);
    expect((responseBody(refreshed) as { role: string }).role).toBe("editor");
    const folder = await request(runtime.server)
      .post(`/api/v1/workspaces/${workspace}/folders`)
      .set("Cookie", reader.session.cookie)
      .set("X-CSRF-Token", reader.session.csrfToken)
      .send({ name: "Phase 2 Folder" });
    expect(folder.status).toBe(201);
    const folderId = (folder.body as { folder: { id: string } }).folder.id;
    const folderConflict = await request(runtime.server)
      .post(`/api/v1/workspaces/${workspace}/folders`)
      .set("Cookie", reader.session.cookie)
      .set("X-CSRF-Token", reader.session.csrfToken)
      .send({ name: "  phase 2 folder  " });
    expect(folderConflict.status).toBe(409);
    expect(responseBody(folderConflict)).toMatchObject({
      error: { code: "FOLDER_NAME_CONFLICT" },
    });
    const document = await request(runtime.server)
      .post(`/api/v1/workspaces/${workspace}/documents`)
      .set("Cookie", reader.session.cookie)
      .set("X-CSRF-Token", reader.session.csrfToken)
      .send({ name: "Phase 2 Document", folderId });
    expect(document.status).toBe(201);
    const documentId = (document.body as { document: { id: string } }).document.id;
    const documentConflict = await request(runtime.server)
      .post(`/api/v1/workspaces/${workspace}/documents`)
      .set("Cookie", reader.session.cookie)
      .set("X-CSRF-Token", reader.session.csrfToken)
      .send({ name: " phase 2 document ", folderId });
    expect(documentConflict.status).toBe(409);
    expect(responseBody(documentConflict)).toMatchObject({
      error: { code: "DOCUMENT_NAME_CONFLICT" },
    });
    const detail = await request(runtime.server)
      .get(`/api/v1/workspaces/${workspace}/documents/${documentId}`)
      .set("Cookie", reader.session.cookie);
    expect(detail.status).toBe(200);
    expect(
      (responseBody(detail) as { document: { snapshot: unknown } }).document.snapshot,
    ).toMatchObject({ version: 1, documentId });

    const deleteCheck = await request(runtime.server)
      .post(`/api/v1/workspaces/${workspace}/folders/${folderId}/delete-check`)
      .set("Cookie", reader.session.cookie)
      .set("X-CSRF-Token", reader.session.csrfToken);
    expect(deleteCheck.body).toMatchObject({ canDelete: false, documentCount: 1 });

    const outboxBeforeRevoke = await runtime.database.$client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notification_outbox
       WHERE workspace_id = $1 AND event_type IN ('edit_permission.approved')`,
      [workspace],
    );
    expect(outboxBeforeRevoke.rows[0]?.count).toBe("1");
    const notificationRepository = new NotificationRepository();
    for (const outboxId of await notificationRepository.readyBatch(runtime.database, 10)) {
      await notificationRepository.materializeOutboxEvent(runtime.database, outboxId);
    }
    const notifications = await request(runtime.server)
      .get("/api/v1/notifications?limit=1")
      .set("Cookie", reader.session.cookie);
    expect(notifications.status).toBe(200);
    expect((responseBody(notifications) as { unreadCount: number }).unreadCount).toBe(1);
    const notificationId = (
      responseBody(notifications) as {
        notifications: Array<{ id: string }>;
      }
    ).notifications[0]?.id;
    if (notificationId === undefined) throw new Error("Approval notification was not materialized");
    expect(
      (
        await request(runtime.server)
          .post(`/api/v1/notifications/${notificationId}/read`)
          .set("Cookie", reader.session.cookie)
          .set("X-CSRF-Token", reader.session.csrfToken)
      ).status,
    ).toBe(201);
    expect(
      (
        responseBody(
          await request(runtime.server).get("/api/v1/admin/storage").set("Cookie", admin.cookie),
        ) as {
          threshold: string;
        }
      ).threshold,
    ).toBe("normal");
    expect(
      (
        await request(runtime.server)
          .get("/api/v1/admin/storage")
          .set("Cookie", reader.session.cookie)
      ).status,
    ).toBe(403);

    const revoked = await request(runtime.server)
      .post(`/api/v1/admin/members/${reader.membershipId}/revoke-editing`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken);
    expect(revoked.status).toBe(201);
    const repeatedRevoke = await request(runtime.server)
      .post(`/api/v1/admin/members/${reader.membershipId}/revoke-editing`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken);
    expect(repeatedRevoke.status).toBe(201);
    expect((responseBody(repeatedRevoke) as { changed: boolean }).changed).toBe(false);
    const refreshedAfterRevoke = responseBody(
      await request(runtime.server).get("/api/v1/me").set("Cookie", reader.session.cookie),
    ) as { role: string };
    expect(refreshedAfterRevoke.role).toBe("reader");

    const audit = await runtime.database.$client.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE workspace_id = $1
       AND action IN ('edit_request.created', 'edit_request.approved', 'edit_permission.revoked')
       ORDER BY created_at, id`,
      [workspace],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "edit_request.created",
        "edit_request.approved",
        "edit_permission.revoked",
      ]),
    );
    expect(audit.rows).toHaveLength(3);
    const auditQuery = await request(runtime.server)
      .get("/api/v1/admin/audit-logs?action=document.created&limit=1")
      .set("Cookie", admin.cookie);
    expect(auditQuery.status).toBe(200);
    expect(JSON.stringify(responseBody(auditQuery))).not.toContain("actorSessionId");
  });
});
