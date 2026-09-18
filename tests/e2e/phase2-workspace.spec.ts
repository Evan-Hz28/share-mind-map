import { expect, request as playwrightRequest, test } from "@playwright/test";

import {
  apiChangePassword,
  apiCreateMember,
  apiLogin,
  apiMembers,
  jsonBody,
} from "./helpers/api.js";
import { prepareAdministrator } from "./helpers/admin-cli.js";
import { monitorPage } from "./helpers/console.js";

test("completes the Phase 2 permission and workspace flow", async ({ browser }) => {
  const setup = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  const suffix = Date.now().toString(36);
  const loginName = `phase2.${suffix}`;
  const password = "Phase2-Reader-Permanent-Password-1";
  let setupData!: {
    administratorLogin: string;
    administratorPassword: string;
    workspaceId: string;
    membershipId: string;
  };
  try {
    const prepared = await prepareAdministrator(setup);
    const administratorLogin = prepared.loginName;
    const administratorPassword = prepared.password;
    const adminLogin = await apiLogin(setup, administratorLogin, administratorPassword);
    if (adminLogin.session === undefined) throw new Error("Phase 2 admin login failed");
    const workspaceId = adminLogin.session.workspaceId;
    const created = await apiCreateMember(setup, adminLogin.session.csrfToken, {
      loginName,
      displayName: `Phase 2 ${suffix}`,
    });
    const membershipId = created.member.id;
    const temporaryLogin = await apiLogin(setup, loginName, created.temporaryPassword);
    if (temporaryLogin.session === undefined) throw new Error("Phase 2 member login failed");
    expect(
      (
        await apiChangePassword(
          setup,
          temporaryLogin.session.csrfToken,
          created.temporaryPassword,
          password,
        )
      ).status(),
    ).toBe(204);
    setupData = { administratorLogin, administratorPassword, workspaceId, membershipId };
  } finally {
    await setup.dispose();
  }
  const { administratorLogin, administratorPassword, workspaceId, membershipId } = setupData;

  const reader = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
  const admin = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
  try {
    const readerLogin = await apiLogin(reader.request, loginName, password);
    if (readerLogin.session === undefined) throw new Error("Reader login failed");
    const readerSession = readerLogin.session;
    expect((await reader.request.get(`/api/v1/workspaces/${workspaceId}/folders`)).status()).toBe(
      200,
    );
    expect(
      (
        await reader.request.post(`/api/v1/workspaces/${workspaceId}/folders`, {
          headers: { "X-CSRF-Token": readerSession.csrfToken },
          data: { name: "Reader must not write" },
        })
      ).status(),
    ).toBe(403);

    const requestResponse = await reader.request.post(
      `/api/v1/workspaces/${workspaceId}/edit-requests`,
      { headers: { "X-CSRF-Token": readerSession.csrfToken } },
    );
    expect(requestResponse.status()).toBe(201);
    const requestBody = await jsonBody<{ request: { id: string } }>(requestResponse);
    const requestId = requestBody.request.id;

    const adminLogin = await apiLogin(admin.request, administratorLogin, administratorPassword);
    if (adminLogin.session === undefined) throw new Error("Admin flow login failed");
    const adminSession = adminLogin.session;
    const pending = await admin.request.get("/api/v1/admin/edit-requests?status=pending");
    expect(pending.status()).toBe(200);
    const pendingBody = await jsonBody<{ requests: Array<{ id: string }> }>(pending);
    expect(pendingBody.requests.some((item) => item.id === requestId)).toBe(true);
    expect(
      (
        await admin.request.post(`/api/v1/admin/edit-requests/${requestId}/approve`, {
          headers: { "X-CSRF-Token": adminSession.csrfToken },
        })
      ).status(),
    ).toBe(201);

    const refreshed = await reader.request.get("/api/v1/me");
    expect((await jsonBody<{ role: string }>(refreshed)).role).toBe("editor");
    const folderResponse = await reader.request.post(`/api/v1/workspaces/${workspaceId}/folders`, {
      headers: { "X-CSRF-Token": readerSession.csrfToken },
      data: { name: `Phase 2 Folder ${suffix}` },
    });
    expect(folderResponse.status()).toBe(201);
    const folderBody = await jsonBody<{ folder: { id: string } }>(folderResponse);
    const folderId = folderBody.folder.id;
    const documentResponse = await reader.request.post(
      `/api/v1/workspaces/${workspaceId}/documents`,
      {
        headers: { "X-CSRF-Token": readerSession.csrfToken },
        data: { name: `Phase 2 Document ${suffix}`, folderId },
      },
    );
    expect(documentResponse.status()).toBe(201);
    const documentBody = await jsonBody<{ document: { id: string } }>(documentResponse);
    const documentId = documentBody.document.id;
    const detail = await reader.request.get(
      `/api/v1/workspaces/${workspaceId}/documents/${documentId}`,
    );
    expect(detail.status()).toBe(200);
    expect(
      (await jsonBody<{ document: { snapshot: { version: number } } }>(detail)).document.snapshot
        .version,
    ).toBe(1);

    await expect
      .poll(async () => {
        const notifications = await reader.request.get("/api/v1/notifications");
        return (await jsonBody<{ unreadCount: number }>(notifications)).unreadCount > 0;
      })
      .toBe(true);

    const members = await apiMembers(admin.request);
    expect(members.some((member) => member.id === membershipId && member.role === "editor")).toBe(
      true,
    );
    expect(
      (
        await admin.request.post(`/api/v1/admin/members/${membershipId}/revoke-editing`, {
          headers: { "X-CSRF-Token": adminSession.csrfToken },
        })
      ).status(),
    ).toBe(201);
    const revokedSession = await reader.request.get("/api/v1/me");
    await expect(jsonBody<{ role: string }>(revokedSession)).resolves.toMatchObject({
      role: "reader",
    });
    expect(
      (
        await reader.request.post(`/api/v1/workspaces/${workspaceId}/folders`, {
          headers: { "X-CSRF-Token": readerSession.csrfToken },
          data: { name: "Denied after revoke" },
        })
      ).status(),
    ).toBe(403);

    const page = await reader.newPage();
    const diagnostics = monitorPage(page);
    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "全部文档" })).toBeVisible();
    await expect(page.getByText(`Phase 2 Document ${suffix}`)).toBeVisible();
    diagnostics.assertClean();
  } finally {
    await reader.close();
    await admin.close();
  }
});
