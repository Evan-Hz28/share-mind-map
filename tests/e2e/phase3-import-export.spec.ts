import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, request as playwrightRequest, test } from "@playwright/test";

import { apiLogin, jsonBody } from "./helpers/api.js";
import { prepareAdministrator } from "./helpers/admin-cli.js";
import { monitorPage } from "./helpers/console.js";

test("completes the Phase 3 mixed import and export flow", async ({ browser }) => {
  const setup = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8080" });
  let batchId = "";
  let workspaceId = "";
  let importedDocumentId: string;
  const suffix = Date.now().toString(36);
  try {
    const administrator = await prepareAdministrator(setup);
    const login = await apiLogin(setup, administrator.loginName, administrator.password);
    if (login.session === undefined) throw new Error("Phase 3 administrator login failed");
    workspaceId = login.session.workspaceId;
    const createBatch = await setup.post(`/api/v1/workspaces/${workspaceId}/import-batches`, {
      headers: { "X-CSRF-Token": login.session.csrfToken },
      data: {
        files: [
          {
            clientFileName: "current-json.xmind",
            targetName: `Phase 3 Good ${suffix}`,
            targetFolderId: null,
            expectedBytes: 461,
          },
          {
            clientFileName: "corrupt.xmind",
            targetName: `Phase 3 Bad ${suffix}`,
            targetFolderId: null,
            expectedBytes: 18,
          },
        ],
      },
    });
    expect(createBatch.status()).toBe(201);
    const created = await jsonBody<{
      id: string;
      jobs: Array<{ id: string }>;
    }>(createBatch);
    batchId = created.id;
    const goodFile = await readFile(resolve("tests/fixtures/xmind/current-json.xmind"));
    const badFile = await readFile(resolve("tests/fixtures/xmind/corrupt.xmind"));
    for (const [index, file] of [goodFile, badFile].entries()) {
      const upload = await setup.post(
        `/api/v1/workspaces/${workspaceId}/import-batches/${batchId}/jobs/${created.jobs[index]?.id ?? ""}/upload`,
        {
          headers: { "X-CSRF-Token": login.session.csrfToken },
          multipart: {
            file: {
              name: index === 0 ? "current-json.xmind" : "corrupt.xmind",
              mimeType: "application/xmind",
              buffer: file,
            },
          },
        },
      );
      expect([200, 201]).toContain(upload.status());
    }

    let terminal!: {
      status: string;
      succeededJobs: number;
      failedJobs: number;
      jobs: Array<{ documentId?: string | null; targetName: string }>;
    };
    await expect
      .poll(async () => {
        const response = await setup.get(
          `/api/v1/workspaces/${workspaceId}/import-batches/${batchId}`,
        );
        terminal = await jsonBody<typeof terminal>(response);
        return terminal.status;
      })
      .toMatch(/^(partial|failed)$/u);
    expect(terminal.succeededJobs).toBe(1);
    expect(terminal.failedJobs).toBe(1);
    importedDocumentId =
      terminal.jobs.find((job) => job.documentId !== null && job.documentId !== undefined)
        ?.documentId ?? "";
    expect(importedDocumentId).not.toBe("");

    const exported = await setup.get(
      `/api/v1/workspaces/${workspaceId}/documents/${importedDocumentId}/export`,
    );
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-type"]).toContain("application/xmind");
    expect(exported.headers()["x-xmind-compatibility"]).toBe("full");
    expect((await exported.body()).subarray(0, 2).toString()).toBe("PK");

    const failures = await setup.get("/api/v1/admin/import-failures");
    expect(failures.status()).toBe(200);
    expect(
      (await jsonBody<{ failures: Array<{ batchId: string }> }>(failures)).failures.some(
        (failure) => failure.batchId === batchId,
      ),
    ).toBe(true);

    const pageContext = await browser.newContext({ baseURL: "http://127.0.0.1:8080" });
    try {
      const adminLogin = await apiLogin(
        pageContext.request,
        administrator.loginName,
        administrator.password,
      );
      expect(adminLogin.session).toBeDefined();
      const page = await pageContext.newPage();
      const diagnostics = monitorPage(page);
      await page.goto("/workspace");
      await expect(page.getByRole("heading", { name: "用例库" })).toBeVisible();
      await expect(page.getByRole("button", { name: "导入 XMind" })).toBeVisible();
      await page.getByRole("button", { name: "导入 XMind" }).click();
      await expect(page.getByRole("dialog", { name: "导入 XMind 文件" })).toBeVisible();
      diagnostics.assertClean();
    } finally {
      await pageContext.close();
    }
  } finally {
    await setup.dispose();
  }
});
