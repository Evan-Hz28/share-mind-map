import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, request as playwrightRequest, test } from "@playwright/test";

import {
  apiAcquireDocumentLock,
  apiChangePassword,
  apiCreateMember,
  apiCreateDocument,
  apiDocumentDetail,
  apiForceReleaseDocumentLock,
  apiLogin,
  apiRevokeMemberEditing,
  apiSaveDocumentSnapshot,
  apiErrorCode,
} from "./helpers/api.js";
import { prepareAdministrator, setMemberRole } from "./helpers/admin-cli.js";

const execFileAsync = promisify(execFile);

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function restartApiService(): Promise<void> {
  await execFileAsync("docker", ["compose", "--env-file", ".env", "restart", "api"], {
    cwd: process.cwd(),
  });
}

test("reloads a document through REST after a browser reconnect", async ({ browser }) => {
  const setup = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  const suffix = Date.now().toString(36);
  try {
    const administrator = await prepareAdministrator(setup);
    const login = await apiLogin(setup, administrator.loginName, administrator.password);
    if (login.session === undefined) throw new Error("Phase 4 recovery login failed");
    const documentId = await apiCreateDocument(
      setup,
      login.session.workspaceId,
      login.session.csrfToken,
      `Phase 4 Recovery ${suffix}`,
    );
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:4173" });
    try {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      let expectedAnonymousBootstrap401 = 0;
      page.on("response", (response) => {
        const responseUrl = new URL(response.url());
        if (response.status() === 401 && responseUrl.pathname === "/api/v1/me") {
          expectedAnonymousBootstrap401 += 1;
        }
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (
          message.text() ===
            "Failed to load resource: the server responded with a status of 401 (Unauthorized)" &&
          expectedAnonymousBootstrap401 > 0
        ) {
          expectedAnonymousBootstrap401 -= 1;
          return;
        }
        consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));
      await page.goto(`/login`);
      await page.getByLabel("登录名").fill(administrator.loginName);
      await page.getByLabel("密码").fill(administrator.password);
      await page.getByRole("button", { name: "登录" }).click();
      await expect(page.getByRole("heading", { name: "全部文档" })).toBeVisible();
      await page.goto(`/workspace/documents/${documentId}`);
      await expect(page.getByRole("heading", { name: `Phase 4 Recovery ${suffix}` })).toBeVisible();
      await expect(page.getByRole("toolbar", { name: "编辑工具栏" })).toBeVisible();
      await expect(page.getByRole("region", { name: "思维导图画布" })).toBeVisible();
      await restartApiService();
      await expect
        .poll(
          async () =>
            (await fetch("http://127.0.0.1:3000/health/ready").catch(() => null))?.status ?? 0,
          { timeout: 30_000 },
        )
        .toBe(200);
      consoleErrors.length = 0;
      expectedAnonymousBootstrap401 = 0;
      await page.reload();
      if (await page.getByRole("heading", { name: "登录" }).isVisible()) {
        await page.getByLabel("登录名").fill(administrator.loginName);
        await page.getByLabel("密码").fill(administrator.password);
        await page.getByRole("button", { name: "登录" }).click();
        await expect(page.getByRole("heading", { name: "全部文档" })).toBeVisible();
        await page.goto(`/workspace/documents/${documentId}`);
      }
      await expect(page.getByRole("heading", { name: `Phase 4 Recovery ${suffix}` })).toBeVisible();
      await expect(page.getByRole("toolbar", { name: "编辑工具栏" })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("v-html");
      expect(consoleErrors).toEqual([]);
    } finally {
      await context.close();
    }
  } finally {
    await setup.dispose();
  }
});

test("preserves the recovery boundary after an administrator force release", async ({
  request,
}) => {
  const administrator = await prepareAdministrator(request);
  const login = await apiLogin(request, administrator.loginName, administrator.password);
  if (login.session === undefined) throw new Error("Force-release recovery login failed");
  const documentId = await apiCreateDocument(
    request,
    login.session.workspaceId,
    login.session.csrfToken,
    `Phase 4 Force Release ${Date.now().toString(36)}`,
  );
  const lease = await apiAcquireDocumentLock(
    request,
    login.session.workspaceId,
    documentId,
    login.session.csrfToken,
    "phase4-recovery-browser",
  );
  const detail = await apiDocumentDetail(request, login.session.workspaceId, documentId);
  const released = await apiForceReleaseDocumentLock(
    request,
    login.session.workspaceId,
    documentId,
    login.session.csrfToken,
  );
  expect(released.status()).toBe(201);

  const staleSave = await apiSaveDocumentSnapshot(
    request,
    login.session.workspaceId,
    documentId,
    login.session.csrfToken,
    lease,
    detail.document.snapshot,
    `phase4-force-release-${Date.now().toString(36)}`,
  );
  expect(staleSave.status()).toBe(423);
  await expect(apiErrorCode(staleSave)).resolves.toBe("LOCK_LOST");
});

test("keeps a dirty browser draft after an administrator force release", async ({ browser }) => {
  const setup = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  const suffix = Date.now().toString(36);
  try {
    const administrator = await prepareAdministrator(setup);
    const login = await apiLogin(setup, administrator.loginName, administrator.password);
    if (login.session === undefined) throw new Error("Dirty draft recovery login failed");
    const documentId = await apiCreateDocument(
      setup,
      login.session.workspaceId,
      login.session.csrfToken,
      `Phase 4 Dirty Force Release ${suffix}`,
    );
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:4173" });
    try {
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("登录名").fill(administrator.loginName);
      await page.getByLabel("密码").fill(administrator.password);
      await page.getByRole("button", { name: "登录" }).click();
      await expect(page.getByRole("heading", { name: "全部文档" })).toBeVisible();
      await page.goto(`/workspace/documents/${documentId}`);
      await expect(
        page.getByRole("heading", { name: `Phase 4 Dirty Force Release ${suffix}` }),
      ).toBeVisible();
      await page.getByRole("button", { name: "开始编辑" }).click();
      await expect(page.getByRole("button", { name: "结束编辑" })).toBeVisible();
      await page.getByLabel("选择图片").setInputFiles({
        name: "dirty-draft.png",
        mimeType: "image/png",
        buffer: onePixelPng,
      });
      await expect(page.getByRole("button", { name: "保存" })).toBeVisible();

      const released = await apiForceReleaseDocumentLock(
        setup,
        login.session.workspaceId,
        documentId,
        login.session.csrfToken,
      );
      expect(released.status()).toBe(201);
      await expect(page.getByText("编辑锁已失效，当前修改已转为只读草稿。")).toBeVisible();
      await expect(page.getByRole("button", { name: "复制草稿 JSON" })).toBeVisible();
    } finally {
      await context.close();
    }
  } finally {
    await setup.dispose();
  }
});

test("keeps a dirty browser draft when editing permission is revoked", async ({ browser }) => {
  const setup = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  const memberRequest = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  const suffix = Date.now().toString(36);
  const memberLogin = `phase4.editor.${suffix}`;
  const memberPassword = "Phase4-Editor-Permanent-Password-1";
  try {
    const administrator = await prepareAdministrator(setup);
    const adminLogin = await apiLogin(setup, administrator.loginName, administrator.password);
    if (adminLogin.session === undefined) throw new Error("Permission recovery login failed");
    const created = await apiCreateMember(setup, adminLogin.session.csrfToken, {
      loginName: memberLogin,
      displayName: `Phase 4 Editor ${suffix}`,
    });
    await setMemberRole(memberLogin, "editor");
    const temporaryLogin = await apiLogin(memberRequest, memberLogin, created.temporaryPassword);
    if (temporaryLogin.session === undefined) throw new Error("Phase 4 editor login failed");
    expect(
      (
        await apiChangePassword(
          memberRequest,
          temporaryLogin.session.csrfToken,
          created.temporaryPassword,
          memberPassword,
        )
      ).status(),
    ).toBe(204);
    const documentId = await apiCreateDocument(
      setup,
      adminLogin.session.workspaceId,
      adminLogin.session.csrfToken,
      `Phase 4 Permission Revoke ${suffix}`,
    );
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:4173" });
    try {
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("登录名").fill(memberLogin);
      await page.getByLabel("密码").fill(memberPassword);
      await page.getByRole("button", { name: "登录" }).click();
      await expect(page.getByRole("heading", { name: "全部文档" })).toBeVisible();
      await page.goto(`/workspace/documents/${documentId}`);
      await expect(
        page.getByRole("heading", { name: `Phase 4 Permission Revoke ${suffix}` }),
      ).toBeVisible();
      await page.getByRole("button", { name: "开始编辑" }).click();
      await expect(page.getByRole("button", { name: "结束编辑" })).toBeVisible();
      await page.getByLabel("选择图片").setInputFiles({
        name: "permission-draft.png",
        mimeType: "image/png",
        buffer: onePixelPng,
      });
      await expect(page.getByRole("button", { name: "保存" })).toBeVisible();

      const revoked = await apiRevokeMemberEditing(
        setup,
        adminLogin.session.csrfToken,
        created.member.id,
      );
      expect(revoked.status()).toBe(201);
      await page.getByRole("button", { name: "保存" }).click();
      await expect(page.getByText("编辑锁已失效，当前修改已转为只读草稿。")).toBeVisible();
      await expect(page.getByRole("button", { name: "复制草稿 JSON" })).toBeVisible();
    } finally {
      await context.close();
    }
  } finally {
    await memberRequest.dispose();
    await setup.dispose();
  }
});

test("rejects a stale base version after a newer committed snapshot", async ({ request }) => {
  const administrator = await prepareAdministrator(request);
  const login = await apiLogin(request, administrator.loginName, administrator.password);
  if (login.session === undefined) throw new Error("Conflict recovery login failed");
  const documentId = await apiCreateDocument(
    request,
    login.session.workspaceId,
    login.session.csrfToken,
    `Phase 4 Conflict ${Date.now().toString(36)}`,
  );
  const lease = await apiAcquireDocumentLock(
    request,
    login.session.workspaceId,
    documentId,
    login.session.csrfToken,
    "phase4-conflict-browser",
  );
  const detail = await apiDocumentDetail(request, login.session.workspaceId, documentId);
  const first = await apiSaveDocumentSnapshot(
    request,
    login.session.workspaceId,
    documentId,
    login.session.csrfToken,
    lease,
    detail.document.snapshot,
    `phase4-conflict-first-${Date.now().toString(36)}`,
  );
  expect(first.status()).toBe(201);

  const stale = await apiSaveDocumentSnapshot(
    request,
    login.session.workspaceId,
    documentId,
    login.session.csrfToken,
    lease,
    detail.document.snapshot,
    `phase4-conflict-stale-${Date.now().toString(36)}`,
  );
  expect(stale.status()).toBe(409);
  await expect(apiErrorCode(stale)).resolves.toBe("DOCUMENT_VERSION_CONFLICT");
});
