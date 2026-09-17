import { expect, request as playwrightRequest, test } from "@playwright/test";

import { prepareAdministrator, setMemberRole } from "./helpers/admin-cli.js";
import { apiChangePassword, apiCreateMember, apiLogin } from "./helpers/api.js";
import { monitorPage } from "./helpers/console.js";

test("enforces anonymous, Reader, Editor, and Admin route/API boundaries", async ({ browser }) => {
  const setup = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  const suffix = Date.now().toString(36);
  const memberLogin = `matrix.${suffix}`;
  const memberPassword = "Phase1-Matrix-Permanent-Password-1";
  let administratorLogin: string;
  let administratorPassword: string;
  try {
    const prepared = await prepareAdministrator(setup);
    administratorLogin = prepared.loginName;
    administratorPassword = prepared.password;
    const adminLogin = await apiLogin(setup, administratorLogin, administratorPassword);
    if (adminLogin.session === undefined) throw new Error("Admin matrix login failed");
    const created = await apiCreateMember(setup, adminLogin.session.csrfToken, {
      loginName: memberLogin,
      displayName: `Matrix ${suffix}`,
    });
    const temporaryLogin = await apiLogin(setup, memberLogin, created.temporaryPassword);
    if (temporaryLogin.session === undefined) throw new Error("Matrix member login failed");
    expect(
      (
        await apiChangePassword(
          setup,
          temporaryLogin.session.csrfToken,
          created.temporaryPassword,
          memberPassword,
        )
      ).status(),
    ).toBe(204);
  } finally {
    await setup.dispose();
  }

  const anonymous = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
  try {
    expect((await anonymous.request.get("/api/v1/admin/members")).status()).toBe(401);
    const page = await anonymous.newPage();
    await page.goto("/admin/members");
    await expect(page).toHaveURL(/\/login$/u);
  } finally {
    await anonymous.close();
  }

  const reader = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
  try {
    const login = await apiLogin(reader.request, memberLogin, memberPassword);
    expect(login.response.status()).toBe(201);
    expect((await reader.request.get("/api/v1/admin/members")).status()).toBe(403);
    const page = await reader.newPage();
    const diagnostics = monitorPage(page);
    await page.goto("/admin/members");
    await expect(page).toHaveURL(/\/workspace$/u);
    await expect(page.getByRole("link", { name: "成员管理" })).toHaveCount(0);
    diagnostics.assertClean();
  } finally {
    await reader.close();
  }

  await setMemberRole(memberLogin, "editor");
  const editor = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
  try {
    const login = await apiLogin(editor.request, memberLogin, memberPassword);
    expect(login.response.status()).toBe(201);
    expect((await editor.request.get("/api/v1/admin/members")).status()).toBe(403);
    const page = await editor.newPage();
    const diagnostics = monitorPage(page);
    await page.goto("/admin/members");
    await expect(page).toHaveURL(/\/workspace$/u);
    await expect(page.getByRole("link", { name: "成员管理" })).toHaveCount(0);
    diagnostics.assertClean();
  } finally {
    await editor.close();
  }

  const admin = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
  try {
    const login = await apiLogin(admin.request, administratorLogin, administratorPassword);
    expect(login.response.status()).toBe(201);
    expect((await admin.request.get("/api/v1/admin/members")).status()).toBe(200);
    const page = await admin.newPage();
    const diagnostics = monitorPage(page);
    await page.goto("/admin/members");
    await expect(page).toHaveURL(/\/admin\/members$/u);
    await expect(page.getByRole("heading", { name: "成员管理" })).toBeVisible();
    diagnostics.assertClean();
  } finally {
    await admin.close();
  }
});
