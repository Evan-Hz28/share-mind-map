import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

import { prepareAdministrator } from "./helpers/admin-cli.js";
import { apiLogin, apiMembers } from "./helpers/api.js";
import { monitorPage } from "./helpers/console.js";

const readerPassword = "Phase1-Reader-Permanent-Password-1";
const readerPasswordAfterReset = "Phase1-Reader-After-Reset-Password-1";

async function loginUi(page: Page, loginName: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/workspace$/u);
}

test.describe.serial("member administration", () => {
  let administratorLogin = "";
  let administratorPassword = "";
  let readerLogin = "";
  let readerDisplayName = "";

  test.beforeAll(async () => {
    const api = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
    try {
      const prepared = await prepareAdministrator(api);
      administratorLogin = prepared.loginName;
      administratorPassword = prepared.password;
    } finally {
      await api.dispose();
    }
  });

  test("creates a Reader and completes temporary-login, change, relogin, and logout", async ({
    browser,
    page,
  }) => {
    const diagnostics = monitorPage(page);
    const suffix = Date.now().toString(36);
    readerLogin = `reader.${suffix}`;
    readerDisplayName = `Reader ${suffix}`;
    await loginUi(page, administratorLogin, administratorPassword);
    await page.getByRole("link", { name: "成员管理" }).click();
    await page.getByRole("button", { name: "创建成员" }).click();
    await page.getByLabel("登录名").fill(readerLogin);
    await page.getByLabel("显示名称").fill(readerDisplayName);
    await page.getByRole("button", { name: "创建 Reader" }).click();

    const temporaryPassword = await page.locator(".secret-value").textContent();
    if (temporaryPassword === null || temporaryPassword.length === 0) {
      throw new Error("Create member did not reveal a temporary password");
    }
    await page.getByRole("button", { name: "复制临时密码" }).click();
    await expect(page.getByRole("status", { name: "" })).toContainText("已复制");
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.locator(".secret-value")).toHaveCount(0);

    const readerContext = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
    try {
      const readerPage = await readerContext.newPage();
      await readerPage.goto("/login");
      await readerPage.getByLabel("登录名").fill(readerLogin);
      await readerPage.getByLabel("密码").fill(temporaryPassword);
      await readerPage.getByRole("button", { name: "登录" }).click();
      await expect(readerPage).toHaveURL(/\/change-password$/u);
      await readerPage.getByLabel("当前密码").fill(temporaryPassword);
      await readerPage.getByLabel("新密码", { exact: true }).fill(readerPassword);
      await readerPage.getByLabel("确认新密码").fill(readerPassword);
      await readerPage.getByRole("button", { name: "修改密码" }).click();
      await expect(readerPage).toHaveURL(/\/login$/u);

      await readerPage.getByLabel("登录名").fill(readerLogin);
      await readerPage.getByLabel("密码").fill(readerPassword);
      await readerPage.getByRole("button", { name: "登录" }).click();
      await expect(readerPage).toHaveURL(/\/workspace$/u);
      await expect(readerPage.getByRole("link", { name: "成员管理" })).toHaveCount(0);
      await readerPage.getByRole("button", { name: "账户菜单" }).click();
      await readerPage.getByRole("button", { name: "退出登录" }).click();
      await expect(readerPage).toHaveURL(/\/login$/u);
    } finally {
      await readerContext.close();
    }
    diagnostics.assertClean();
  });

  test("revokes sessions, resets password, disables/restores, and protects the final Admin", async ({
    browser,
    page,
  }) => {
    const diagnostics = monitorPage(page, {
      expectedHttpErrors: [
        {
          method: "PATCH",
          path: /^\/api\/v1\/admin\/members\/[^/]+\/account-status$/u,
          status: 409,
        },
      ],
    });
    await loginUi(page, administratorLogin, administratorPassword);
    await page.getByRole("link", { name: "成员管理" }).click();

    const readerContext = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
    try {
      const activeReader = await apiLogin(readerContext.request, readerLogin, readerPassword);
      expect(activeReader.response.status()).toBe(201);
      await page.getByRole("button", { name: `打开 ${readerDisplayName} 的操作菜单` }).click();
      await page.getByRole("button", { name: `撤销 ${readerDisplayName} 的全部会话` }).click();
      await page.getByRole("button", { name: "确认撤销" }).click();
      await expect
        .poll(async () => (await readerContext.request.get("/api/v1/me")).status())
        .toBe(401);
    } finally {
      await readerContext.close();
    }

    await page.getByRole("button", { name: `打开 ${readerDisplayName} 的操作菜单` }).click();
    await page.getByRole("button", { name: `重置 ${readerDisplayName} 的密码` }).click();
    const resetPassword = await page.locator(".secret-value").textContent();
    if (resetPassword === null || resetPassword.length === 0) {
      throw new Error("Password reset did not reveal a temporary password");
    }
    await page.getByRole("button", { name: "关闭" }).click();

    const resetContext = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
    try {
      const resetPage = await resetContext.newPage();
      await resetPage.goto("/login");
      await resetPage.getByLabel("登录名").fill(readerLogin);
      await resetPage.getByLabel("密码").fill(resetPassword);
      await resetPage.getByRole("button", { name: "登录" }).click();
      await resetPage.getByLabel("当前密码").fill(resetPassword);
      await resetPage.getByLabel("新密码", { exact: true }).fill(readerPasswordAfterReset);
      await resetPage.getByLabel("确认新密码").fill(readerPasswordAfterReset);
      await resetPage.getByRole("button", { name: "修改密码" }).click();
      await expect(resetPage).toHaveURL(/\/login$/u);
    } finally {
      await resetContext.close();
    }

    await page.getByRole("button", { name: `打开 ${readerDisplayName} 的操作菜单` }).click();
    await page.getByRole("button", { name: `禁用 ${readerDisplayName}` }).click();
    await expect(page.getByText("禁用后，该成员的全部会话将立即失效。")).toBeVisible();
    await page.getByRole("button", { name: "确认禁用" }).click();
    await expect(page.getByText("已禁用")).toBeVisible();
    const credentialContext = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
    try {
      const disabled = await apiLogin(
        credentialContext.request,
        readerLogin,
        readerPasswordAfterReset,
      );
      expect(disabled.response.status()).toBe(401);

      await page.getByRole("button", { name: `打开 ${readerDisplayName} 的操作菜单` }).click();
      await page.getByRole("button", { name: `恢复 ${readerDisplayName}` }).click();
      await page.getByRole("button", { name: "确认恢复" }).click();
      await expect(page.getByText("已禁用")).toHaveCount(0);
      const restored = await apiLogin(
        credentialContext.request,
        readerLogin,
        readerPasswordAfterReset,
      );
      expect(restored.response.status()).toBe(201);
    } finally {
      await credentialContext.close();
    }

    const adminMember = (await apiMembers(page.request)).find((member) => member.role === "admin");
    if (adminMember === undefined) throw new Error("Admin member missing from member list");
    await page.getByRole("button", { name: `打开 ${adminMember.displayName} 的操作菜单` }).click();
    await page.getByRole("button", { name: `禁用 ${adminMember.displayName}` }).click();
    await page.getByRole("button", { name: "确认禁用" }).click();
    await expect(page.getByRole("alert")).toContainText("必须保留至少一个有效管理员。");
    diagnostics.assertClean();
  });
});
