import { expect, request as playwrightRequest, test } from "@playwright/test";

import {
  administratorPassword,
  provisionTemporaryAdministrator,
  recoverAdministrator,
} from "./helpers/admin-cli.js";
import { apiChangePassword, apiLogin } from "./helpers/api.js";
import { monitorPage } from "./helpers/console.js";

test.describe.serial("authentication lifecycle", () => {
  let administratorLogin = "";
  let temporaryPassword = "";
  let initializedOnThisRun = false;

  test.beforeAll(async () => {
    const provisioned = await provisionTemporaryAdministrator();
    administratorLogin = provisioned.loginName;
    temporaryPassword = provisioned.temporaryPassword;
    initializedOnThisRun = provisioned.initialized;
  });

  test("initializes or idempotently recovers the first Admin and forces password change", async ({
    page,
  }) => {
    const diagnostics = monitorPage(page);
    await page.goto("/login");
    await page.getByLabel("登录名").fill(administratorLogin);
    await page.getByLabel("密码").fill(temporaryPassword);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/change-password$/u);

    await page.getByLabel("当前密码").fill(temporaryPassword);
    await page.getByLabel("新密码", { exact: true }).fill(administratorPassword);
    await page.getByLabel("确认新密码").fill(administratorPassword);
    await page.getByRole("button", { name: "修改密码" }).click();
    await expect(page).toHaveURL(/\/login$/u);

    await page.getByLabel("登录名").fill(administratorLogin);
    await page.getByLabel("密码").fill(administratorPassword);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/workspace$/u);
    await expect(page.getByRole("link", { name: "成员管理" })).toBeVisible();

    await page.getByRole("button", { name: "账户菜单" }).click();
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login$/u);
    expect(typeof initializedOnThisRun).toBe("boolean");
    diagnostics.assertClean();
  });

  test("rate-limits an account after five failed logins with a safe UI message", async ({
    page,
  }) => {
    const diagnostics = monitorPage(page, {
      expectedHttpErrors: [{ method: "POST", path: "/api/v1/auth/login", status: 429 }],
    });
    const blockedLogin = `missing.${Date.now().toString(36)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await page.request.post("/api/v1/auth/login", {
        data: { loginName: blockedLogin, password: "Wrong-Password-1" },
      });
      expect(response.status()).toBe(401);
    }

    await page.goto("/login");
    await page.getByLabel("登录名").fill(blockedLogin);
    await page.getByLabel("密码").fill("Wrong-Password-1");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("alert")).toContainText("登录尝试过于频繁，请稍后再试。");
    diagnostics.assertClean();
  });

  test("has no registration surface or endpoint", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/注册|创建账号/u)).toHaveCount(0);
    const response = await page.request.post("/api/v1/auth/register", { data: {} });
    expect(response.status()).toBe(404);
  });

  test("maintenance recovery resets the Admin and revokes the prior session", async ({
    request,
  }) => {
    const previous = await apiLogin(request, administratorLogin, administratorPassword);
    expect(previous.response.status()).toBe(201);
    const recoveredPassword = await recoverAdministrator(administratorLogin);

    expect((await request.get("/api/v1/me")).status()).toBe(401);
    const recovered = await apiLogin(request, administratorLogin, recoveredPassword);
    expect(recovered.response.status()).toBe(201);
    if (recovered.session === undefined)
      throw new Error("Recovered Admin login did not create a session");
    expect(
      (
        await apiChangePassword(
          request,
          recovered.session.csrfToken,
          recoveredPassword,
          administratorPassword,
        )
      ).status(),
    ).toBe(204);
  });

  test.afterAll(async () => {
    const api = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
    try {
      const login = await apiLogin(api, administratorLogin, administratorPassword);
      if (login.response.status() !== 201) {
        throw new Error("Final administrator credential check failed");
      }
    } finally {
      await api.dispose();
    }
  });
});
