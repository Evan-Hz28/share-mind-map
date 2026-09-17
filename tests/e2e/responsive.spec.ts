import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

import { prepareAdministrator } from "./helpers/admin-cli.js";
import { monitorPage } from "./helpers/console.js";

async function expectStableLayout(page: Page, mobile: boolean): Promise<void> {
  const layout = await page.evaluate((checkMobile) => {
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      topBarHeight: document.querySelector(".top-bar")?.getBoundingClientRect().height,
      roleVisible: [...document.querySelectorAll(".role-status")].some(visible),
      shortButtons: checkMobile
        ? [...document.querySelectorAll("button")]
            .filter(visible)
            .map((button) => button.getBoundingClientRect())
            .filter((rect) => rect.width < 40 || rect.height < 40).length
        : 0,
    };
  }, mobile);
  expect(layout.overflow).toBe(false);
  if (layout.topBarHeight !== undefined) expect(Math.round(layout.topBarHeight)).toBe(56);
  if (mobile && layout.topBarHeight !== undefined) expect(layout.roleVisible).toBe(true);
  expect(layout.shortButtons).toBe(0);
}

test("renders login, workspace, and administration at the supported viewport", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chrome";
  const api = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  let loginName: string;
  let password: string;
  try {
    const prepared = await prepareAdministrator(api);
    loginName = prepared.loginName;
    password = prepared.password;
  } finally {
    await api.dispose();
  }

  const diagnostics = monitorPage(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录" })).toBeVisible();
  await expectStableLayout(page, mobile);
  await page.screenshot({
    path: `docs/verification/screenshots/login-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/workspace$/u);
  await expectStableLayout(page, mobile);
  await page.screenshot({
    path: `docs/verification/screenshots/workspace-${testInfo.project.name}.png`,
    fullPage: true,
  });

  if (mobile) {
    await page.getByRole("button", { name: "打开导航菜单" }).click();
    await page.getByRole("link", { name: "成员管理" }).click();
  } else {
    await page.getByRole("link", { name: "成员管理" }).click();
  }
  await expect(page.getByRole("heading", { name: "成员管理" })).toBeVisible();
  await expectStableLayout(page, mobile);
  await page.screenshot({
    path: `docs/verification/screenshots/members-${testInfo.project.name}.png`,
    fullPage: true,
  });
  diagnostics.assertClean();
});
