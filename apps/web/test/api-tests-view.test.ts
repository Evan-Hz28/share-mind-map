import { render, screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApiTestsView from "../src/api-tests/ApiTestsView.vue";
import { jsonResponse } from "./helpers.js";

const suites = [
  {
    id: "suite-auth",
    key: "auth",
    name: "v3 基础",
    path: "testcases/auth",
    caseCount: 120,
    fileCount: 8,
  },
  {
    id: "suite-cart",
    key: "cart",
    name: "购物车",
    path: "testcases/cart",
    caseCount: 68,
    fileCount: 5,
  },
];

const suiteCases = [
  {
    id: "case-auth-file",
    suiteId: "suite-auth",
    nodeId: "testcases/auth/test_login.py",
    filePath: "testcases/auth/test_login.py",
    name: "test_login.py",
    kind: "file",
    ordinal: 0,
  },
  {
    id: "case-auth-login",
    suiteId: "suite-auth",
    nodeId: "testcases/auth/test_login.py::test_login",
    filePath: "testcases/auth/test_login.py",
    name: "test_login",
    kind: "case",
    ordinal: 1,
  },
];

const collectionId = "01900000-0000-7000-8000-00000000c011";
const batchId = "01900000-0000-7000-8000-00000000ba70";

function run(
  id: string,
  suiteId: string,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    suiteId,
    batchId: null,
    suiteKey: "auth",
    suiteName: "v3 基础",
    environmentId: "environment-api",
    environmentKey: "api",
    environmentName: "API (api.kitarx.com)",
    repoCommit: null,
    status: "succeeded",
    cancelRequested: false,
    totalCount: 128,
    passedCount: 126,
    failedCount: 2,
    skippedCount: 0,
    errorMessage: null,
    createdAt: "2026-10-29T11:14:43Z",
    startedAt: "2026-10-29T11:14:43Z",
    finishedAt: "2026-10-29T11:14:45Z",
    ...overrides,
  };
}

const runsBySuite: Record<string, Record<string, unknown>[]> = {
  "suite-auth": [run("run-auth-0001", "suite-auth")],
  "suite-cart": [
    run("run-cart-0001", "suite-cart", {
      status: "failed",
      totalCount: 72,
      passedCount: 70,
      failedCount: 2,
      skippedCount: 0,
    }),
  ],
};

const collection = {
  id: collectionId,
  name: "核心回归",
  description: "核心接口回归集合",
  suiteCount: 2,
  caseCount: 200,
  lastRunStatus: "failed",
  lastRunAt: "2026-10-29T11:14:45Z",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-29T11:14:45Z",
};

function suiteMember(
  id: string,
  suiteId: string,
  suiteName: string,
  path: string,
  position: number,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    position,
    type: "suite",
    suiteId,
    suiteKey: suiteId.replace("suite-", ""),
    suiteName,
    suitePath: path,
    suiteEnabled: true,
    caseId: null,
    caseNodeId: null,
    caseName: null,
    caseKind: null,
    caseEnabled: null,
    lastRunId: null,
    lastRunStatus: null,
    totalCount: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    lastRunAt: null,
    ...overrides,
  };
}

const collectionDetail = {
  ...collection,
  items: [
    suiteMember("member-auth", "suite-auth", "v3 基础", "testcases/auth", 0, {
      lastRunId: "run-auth-0001",
      lastRunStatus: "succeeded",
      totalCount: 128,
      passedCount: 126,
      failedCount: 2,
      lastRunAt: "2026-10-29T11:14:45Z",
    }),
    suiteMember("member-cart", "suite-cart", "购物车", "testcases/cart", 1, {
      lastRunId: "run-cart-0001",
      lastRunStatus: "failed",
      totalCount: 72,
      passedCount: 70,
      failedCount: 2,
      lastRunAt: "2026-10-29T11:14:45Z",
    }),
  ],
};

const executions = [
  {
    batchId,
    status: "failed",
    suiteCount: 2,
    totalCount: 200,
    passedCount: 196,
    failedCount: 4,
    skippedCount: 0,
    startedAt: "2026-10-29T11:14:43Z",
    finishedAt: "2026-10-29T11:14:45Z",
    createdAt: "2026-10-29T11:14:43Z",
  },
];

const scheduleId = "01900000-0000-7000-8000-0000000005c1";

const schedule = {
  id: scheduleId,
  name: "核心回归每日巡检",
  targetType: "collection",
  targetId: collectionId,
  targetName: "核心回归",
  targetPath: null,
  environmentId: "environment-api",
  environmentKey: "api",
  environmentName: "API (api.kitarx.com)",
  cron: "0 2 * * *",
  timezone: "Asia/Shanghai",
  syncBeforeRun: false,
  enabled: true,
  nextRunAt: "2026-11-05T18:00:00Z",
  lastBatchId: batchId,
  lastRunAt: "2026-11-04T18:00:00Z",
  lastRunStatus: "failed",
  lastTotalCount: 2,
  lastPassedCount: 1,
  lastFailedCount: 1,
  lastSkippedCount: 0,
  lastError: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-04T18:00:00Z",
};

const createdBodies: { path: string; body: unknown }[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  if (typeof input === "string") return input;
  return input.href;
}

async function requestBody(
  request: Request | null,
  init: RequestInit | undefined,
): Promise<unknown> {
  const raw = init?.body ?? (request === null ? "{}" : await request.clone().text());
  return JSON.parse(typeof raw === "string" ? raw : "{}");
}

function stubApi(syncs: unknown[] = [], collections: unknown[] = [collection]): void {
  // api-client 的请求拦截器返回 Request 对象，fetch 收到的是 Request 而不是 (url, init)，
  // 所以 method 和 body 都要从 Request 上取。
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(requestUrl(input));
    const path = url.pathname;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();

    if (path.includes("/api-tests/schedules")) {
      if (path.endsWith("/preview") && method === "POST") {
        return jsonResponse(
          {
            nextRuns: [
              "2026-11-05T18:00:00Z",
              "2026-11-06T18:00:00Z",
              "2026-11-07T18:00:00Z",
            ],
          },
          201,
        );
      }
      if (path.endsWith("/enabled") && method === "PATCH") {
        const body = await requestBody(request, init);
        createdBodies.push({ path, body });
        return jsonResponse({ ...schedule, enabled: (body as { enabled: boolean }).enabled });
      }
      if (path.endsWith("/run") && method === "POST") {
        createdBodies.push({ path, body: {} });
        return jsonResponse({ batchId, runs: [] }, 201);
      }
      if (method === "POST") {
        const body = await requestBody(request, init);
        createdBodies.push({ path, body });
        return jsonResponse({ ...schedule, ...(body as object) }, 201);
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return jsonResponse({ schedules: [schedule] });
    }

    if (path.includes("/api-tests/collections")) {
      const isCollectionRoot = path.endsWith("/api-tests/collections");
      if (isCollectionRoot && method === "GET") {
        return jsonResponse({ collections });
      }
      if (isCollectionRoot && method === "POST") {
        const body = await requestBody(request, init);
        createdBodies.push({ path, body });
        return jsonResponse(collection, 201);
      }
      if (path.endsWith("/executions")) {
        return jsonResponse({ executions });
      }
      if (path.endsWith("/runs") && method === "POST") {
        const body = await requestBody(request, init);
        createdBodies.push({ path, body });
        return jsonResponse(
          {
            batchId,
            runs: [
              run("run-auth-0002", "suite-auth", { batchId }),
              run("run-cart-0002", "suite-cart", { batchId }),
            ],
          },
          201,
        );
      }
      if (path.endsWith("/items") && method === "PUT") {
        const body = await requestBody(request, init);
        createdBodies.push({ path, body });
        return jsonResponse(collectionDetail);
      }
      if (method === "GET") return jsonResponse(collectionDetail);
      return jsonResponse(collection);
    }

    if (path.endsWith("/api-tests/runs") && method === "POST") {
      const body = await requestBody(request, init);
      createdBodies.push({ path, body });
      return jsonResponse(
        {
          batchId,
          runs: [
            run("run-auth-0002", "suite-auth", { batchId }),
            run("run-cart-0002", "suite-cart", { batchId }),
          ],
        },
        201,
      );
    }
    if (path.includes("/api-tests/cases")) return jsonResponse({ cases: suiteCases });
    if (path.includes("/api-tests/suites")) return jsonResponse({ suites });
    if (path.includes("/api-tests/environments")) {
      return jsonResponse({
        environments: [
          {
            id: "environment-api",
            key: "api",
            name: "API (api.kitarx.com)",
            baseUrl: "https://api.kitarx.com",
          },
        ],
      });
    }
    if (path.includes("/api-tests/syncs")) return jsonResponse({ syncs });
    if (path.includes("/api-tests/runs")) {
      const suiteId = url.searchParams.get("suiteId") ?? "";
      return jsonResponse({ runs: runsBySuite[suiteId] ?? [] });
    }
    return jsonResponse({});
  });
}

async function renderView(): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const Stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/api-tests", name: "api-tests", component: ApiTestsView },
      { path: "/api-tests/runs/:runId", name: "api-test-run", component: Stub },
      { path: "/api-tests/batches/:batchId", name: "api-test-batch", component: Stub },
    ],
  });
  await router.push("/api-tests");
  render(ApiTestsView, { global: { plugins: [pinia, router] } });
  return router;
}

/** 默认落在测试集 tab，集合相关断言先切过去。 */
async function openCollectionsTab(): Promise<void> {
  await screen.findByText("测试套件（2）");
  await userEvent.click(screen.getByRole("button", { name: "测试集合" }));
  await screen.findByText("测试集合（1）");
  // 详情是第二个请求，等它落地再断言。
  await screen.findByText("testcases/auth");
}

async function openSchedulesTab(): Promise<void> {
  await screen.findByText("测试套件（2）");
  await userEvent.click(screen.getByRole("button", { name: "定时任务" }));
  await screen.findByText("核心回归每日巡检");
}

beforeEach(() => {
  document.body.replaceChildren();
  createdBodies.length = 0;
  stubApi();
});

function sync(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "sync-0001",
    status: "succeeded",
    commitSha: "c261cf0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    suitesAdded: 2,
    suitesRemoved: 0,
    casesAdded: 0,
    casesRemoved: 0,
    message: null,
    createdAt: "2026-11-05T13:13:17Z",
    finishedAt: "2026-11-05T13:13:17Z",
    ...overrides,
  };
}

describe("api tests suites view", () => {
  it("shows the latest sync as a compact chip in the header", async () => {
    stubApi([sync()]);
    await renderView();

    expect(await screen.findByText(/已同步 · /)).toBeInTheDocument();
    // 明细只在 tooltip 里，正文不再平铺 sha 和时间。
    expect(screen.queryByText(/仓库 已同步/)).not.toBeInTheDocument();
  });

  it("opens the failure detail from the sync chip", async () => {
    stubApi([sync({ status: "failed", message: "git clone 失败：远端不可达" })]);
    await renderView();

    await userEvent.click(await screen.findByRole("button", { name: /同步失败/ }));

    expect(await screen.findByText("git clone 失败：远端不可达")).toBeInTheDocument();
  });

  it("shows the latest run of the selected suite on the overview tab", async () => {
    await renderView();

    expect(await screen.findByText(/run-aut/)).toBeInTheDocument();
    expect(screen.getByText("126")).toBeInTheDocument();
  });

  it("reloads runs when another suite is selected", async () => {
    await renderView();
    await screen.findByText(/run-aut/);

    await userEvent.click(screen.getByRole("button", { name: "购物车" }));

    expect(await screen.findByText(/run-car/)).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
  });

  it("lists the run history of the selected suite", async () => {
    await renderView();
    await screen.findByText(/run-aut/);

    await userEvent.click(screen.getByRole("button", { name: "执行记录" }));

    await waitFor(() => {
      expect(screen.getByText("api")).toBeInTheDocument();
    });
    expect(screen.getByText(/126 通过 \/ 2 失败/)).toBeInTheDocument();
  });

  it("runs the checked suites as one batch", async () => {
    const router = await renderView();
    await screen.findByText(/run-aut/);

    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0] as HTMLElement);
    await userEvent.click(checkboxes[1] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: /执行所选/ }));

    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe("api-test-batch");
    });
    expect(createdBodies[0]?.body).toEqual({
      suiteIds: ["suite-auth", "suite-cart"],
      environmentId: "environment-api",
    });
  });

  it("runs the checked cases from the case tree", async () => {
    const router = await renderView();
    await screen.findByText(/run-aut/);

    await userEvent.click(screen.getByRole("button", { name: /^用例（/ }));
    // 文件默认收起，先展开才能勾选里面的函数。
    expect(screen.queryByRole("checkbox", { name: "test_login" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "展开 test_login.py" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "test_login" }));
    await userEvent.click(screen.getByRole("button", { name: "执行所选用例" }));

    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe("api-test-batch");
    });
    expect(createdBodies[0]?.body).toEqual({
      caseIds: ["case-auth-login"],
      environmentId: "environment-api",
    });
  });

  it("filters the suite list by the search box", async () => {
    await renderView();
    await screen.findByText(/run-aut/);

    await userEvent.type(screen.getByPlaceholderText("搜索测试套件"), "购物");

    expect(screen.queryByRole("button", { name: "v3 基础" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "购物车" })).toBeInTheDocument();
  });
});

describe("api tests collections view", () => {
  it("lists collections and shows the selected collection detail", async () => {
    await renderView();
    await openCollectionsTab();

    expect(screen.getByText(/包含测试集 2/)).toBeInTheDocument();
    expect(screen.getByText(/总用例数 200/)).toBeInTheDocument();
    expect(screen.getByText("testcases/auth")).toBeInTheDocument();
  });

  it("leaves the collection list free of placeholder text and counts", async () => {
    stubApi([], [{ ...collection, description: "", suiteCount: 321 }]);
    await renderView();
    await openCollectionsTab();

    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("321")).not.toBeInTheDocument();
  });

  it("creates a collection from the header dialog", async () => {
    await renderView();
    await openCollectionsTab();

    await userEvent.click(screen.getByRole("button", { name: "新建测试集合" }));
    await userEvent.type(
      await screen.findByPlaceholderText("例如：核心接口回归"),
      "回归集合",
    );
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(createdBodies).toHaveLength(1);
    });
    expect(createdBodies[0]?.body).toMatchObject({ name: "回归集合", items: [] });
  });

  it("executes the selected collection as one batch", async () => {
    const router = await renderView();
    await openCollectionsTab();

    await userEvent.click(screen.getByRole("button", { name: "执行集合" }));

    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe("api-test-batch");
    });
    expect(createdBodies[0]?.body).toEqual({ environmentId: "environment-api" });
  });

  it("shows the executions of the selected collection", async () => {
    await renderView();
    await openCollectionsTab();

    await userEvent.click(screen.getByRole("button", { name: "执行记录" }));

    expect(await screen.findByText(batchId.slice(0, 8))).toBeInTheDocument();
    expect(screen.getByText(/196 通过 \/ 4 失败/)).toBeInTheDocument();
  });
});

describe("api tests schedules view", () => {
  it("lists schedules with their last result", async () => {
    await renderView();
    await openSchedulesTab();

    expect(screen.getByText("集合")).toBeInTheDocument();
    expect(screen.getByText("核心回归")).toBeInTheDocument();
    expect(screen.getByText(/1 通过 \/ 1 失败/)).toBeInTheDocument();
  });

  it("toggles a schedule off", async () => {
    await renderView();
    await openSchedulesTab();

    await userEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(createdBodies).toHaveLength(1);
    });
    expect(createdBodies[0]?.body).toEqual({ enabled: false });
  });

  it("runs a schedule immediately and opens the batch report", async () => {
    const router = await renderView();
    await openSchedulesTab();

    await userEvent.click(screen.getByRole("button", { name: "立即执行" }));

    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe("api-test-batch");
    });
  });

  it("creates a schedule from the header dialog", async () => {
    await renderView();
    await openSchedulesTab();

    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    await userEvent.type(
      await screen.findByPlaceholderText("例如：核心回归每日巡检"),
      "夜间回归",
    );
    const [targetSelect] = screen.getAllByRole("combobox");
    await userEvent.selectOptions(targetSelect as HTMLElement, collectionId);

    // cron 预览有 400ms 防抖，等它返回后保存按钮才会可用。
    await screen.findByText("接下来三次：");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(createdBodies).toHaveLength(1);
    });
    expect(createdBodies[0]?.body).toEqual({
      name: "夜间回归",
      targetType: "collection",
      targetId: collectionId,
      environmentId: "environment-api",
      cron: "0 2 * * *",
      timezone: "Asia/Shanghai",
      syncBeforeRun: false,
      enabled: true,
    });
  });
});
