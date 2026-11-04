import { render, screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApiTestsView from "../src/api-tests/ApiTestsView.vue";
import { jsonResponse } from "./helpers.js";

const suites = [
  { id: "suite-auth", key: "auth", name: "v3 基础", path: "testcases/auth" },
  { id: "suite-cart", key: "cart", name: "购物车", path: "testcases/cart" },
];

function run(
  id: string,
  suiteId: string,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    suiteId,
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

function stubApi(): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/api-tests/suites")) return Promise.resolve(jsonResponse({ suites }));
    if (url.includes("/api-tests/environments")) {
      return Promise.resolve(
        jsonResponse({
          environments: [
            {
              id: "environment-api",
              key: "api",
              name: "API (api.kitarx.com)",
              baseUrl: "https://api.kitarx.com",
            },
          ],
        }),
      );
    }
    if (url.includes("/api-tests/syncs")) return Promise.resolve(jsonResponse({ syncs: [] }));
    if (url.includes("/api-tests/runs")) {
      const suiteId = /suiteId=([^&]+)/.exec(url)?.[1] ?? "";
      return Promise.resolve(jsonResponse({ runs: runsBySuite[suiteId] ?? [] }));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

async function renderView(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const Stub = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/api-tests", name: "api-tests", component: ApiTestsView },
      { path: "/api-tests/runs/:runId", name: "api-test-run", component: Stub },
    ],
  });
  await router.push("/api-tests");
  render(ApiTestsView, { global: { plugins: [pinia, router] } });
  await screen.findByText("测试套件（2）");
}

beforeEach(() => {
  document.body.replaceChildren();
  stubApi();
});

describe("api tests view", () => {
  it("shows the latest run of the selected suite on the overview tab", async () => {
    await renderView();

    expect(await screen.findByText(/run-aut/)).toBeInTheDocument();
    expect(screen.getByText("126")).toBeInTheDocument();
  });

  it("reloads runs when another suite is selected", async () => {
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: "购物车" }));

    expect(await screen.findByText(/run-car/)).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
  });

  it("lists the run history of the selected suite", async () => {
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: "执行记录" }));

    await waitFor(() => {
      expect(screen.getByText("api")).toBeInTheDocument();
    });
    expect(screen.getByText(/126 通过 \/ 2 失败/)).toBeInTheDocument();
  });

  it("filters the suite list by the search box", async () => {
    await renderView();

    await userEvent.type(screen.getByPlaceholderText("搜索测试套件"), "购物");

    expect(screen.queryByRole("button", { name: "v3 基础" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "购物车" })).toBeInTheDocument();
  });
});
