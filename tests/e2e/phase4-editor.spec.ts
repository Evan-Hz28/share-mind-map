import { expect, request as playwrightRequest, test } from "@playwright/test";

import { apiCreateDocument, apiLogin } from "./helpers/api.js";
import { prepareAdministrator } from "./helpers/admin-cli.js";

test("keeps a second browser read-only while the first browser owns the document lock", async ({
  browser,
}) => {
  const setup = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  const suffix = Date.now().toString(36);
  try {
    const administrator = await prepareAdministrator(setup);
    const seed = await apiLogin(setup, administrator.loginName, administrator.password);
    if (seed.session === undefined) throw new Error("Phase 4 administrator login failed");
    const documentId = await apiCreateDocument(
      setup,
      seed.session.workspaceId,
      seed.session.csrfToken,
      `Phase 4 Lock ${suffix}`,
    );
    const first = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const second = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    try {
      const firstPage = await first.newPage();
      const secondPage = await second.newPage();
      for (const page of [firstPage, secondPage]) {
        await page.goto("/login");
        await page.getByLabel("登录名").fill(administrator.loginName);
        await page.getByLabel("密码").fill(administrator.password);
        await page.getByRole("button", { name: "登录" }).click();
        await expect(page.getByRole("heading", { name: "全部文档" })).toBeVisible();
      }
      await firstPage.goto(`/workspace/documents/${documentId}`);
      await expect(
        firstPage.getByRole("heading", { name: `Phase 4 Lock ${suffix}` }),
      ).toBeVisible();
      await expect(firstPage.getByRole("toolbar", { name: "编辑工具栏" })).toBeVisible();
      const canvas = firstPage.getByRole("region", { name: "思维导图画布" });
      await expect(canvas).toBeVisible();
      const canvasBox = await canvas.boundingBox();
      expect(canvasBox?.height ?? 0).toBeGreaterThan(300);
      const downloadPromise = firstPage.waitForEvent("download");
      await firstPage.getByRole("button", { name: "导出 XMind" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain("Phase 4 Lock");
      await firstPage.getByRole("button", { name: "开始编辑" }).click();
      await expect(firstPage.getByRole("button", { name: "结束编辑" })).toBeVisible();
      await expect(firstPage.getByRole("button", { name: "添加子节点" })).toBeEnabled();
      await firstPage.locator(".me-tpc").filter({ hasText: "根节点" }).click();
      await firstPage.getByRole("button", { name: "添加子节点" }).click();
      await expect(firstPage.locator("#input-box")).toBeVisible();

      await secondPage.goto(`/workspace/documents/${documentId}`);
      await expect(secondPage.getByText(/编辑锁：.*编辑中/u)).toBeVisible();
      await expect(secondPage.getByRole("button", { name: "开始编辑" })).not.toBeVisible();
    } finally {
      await first.close();
      await second.close();
    }
  } finally {
    await setup.dispose();
  }
});
