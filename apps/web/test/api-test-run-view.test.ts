import { render, screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApiTestRunView from "../src/api-tests/ApiTestRunView.vue";
import { jsonResponse } from "./helpers.js";

function runDetail(runId: string, suiteName: string) {
  return {
    id: runId,
    suiteId: "suite-id",
    suiteKey: "v3-auth",
    suiteName,
    environmentId: "environment-id",
    environmentKey: "api",
    environmentName: "API (api.kitarx.com)",
    status: "succeeded",
    totalCount: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    cancelRequested: false,
    createdAt: "2026-10-29T11:14:43Z",
    startedAt: "2026-10-29T11:14:43Z",
    finishedAt: "2026-10-29T11:14:45Z",
    items: [],
  };
}

function runItem(caseName: string, status: string) {
  return {
    id: `item-${caseName}`,
    nodeId: `testcases/auth/test_login.py::test_${caseName}`,
    caseName: `test_${caseName}`,
    ordinal: 0,
    status,
    durationMs: 66,
    failure: status === "passed" ? null : "AssertionError: 期望 200，实际 500",
    request: null,
    response: null,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("api test run view", () => {
  it("loads the new report when only the run id changes", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const runId = /\/runs\/([^/?]+)/.exec(url)?.[1] ?? "unknown";
      const suiteName = runId === "run-a" ? "认证" : "首页推荐";
      return Promise.resolve(jsonResponse(runDetail(runId, suiteName)));
    });

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/api-tests/runs/:runId",
          name: "api-test-run",
          component: ApiTestRunView,
          props: (route) => ({ runId: String(route.params.runId) }),
        },
      ],
    });
    const Wrapper = { template: "<RouterView />" };

    await router.push("/api-tests/runs/run-a");
    render(Wrapper, { global: { plugins: [pinia, router] } });

    expect(await screen.findByText(/认证 · API/)).toBeInTheDocument();

    await router.push("/api-tests/runs/run-b");

    expect(await screen.findByText(/首页推荐 · API/)).toBeInTheDocument();
  });

  it("collapses passed cases until the toggle is clicked", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        jsonResponse({
          ...runDetail("run-a", "认证"),
          items: [
            runItem("passed_one", "passed"),
            runItem("failed_one", "failed"),
            runItem("passed_two", "passed"),
          ],
        }),
      ),
    );

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/api-tests/runs/:runId",
          name: "api-test-run",
          component: ApiTestRunView,
          props: (route) => ({ runId: String(route.params.runId) }),
        },
      ],
    });
    const Wrapper = { template: "<RouterView />" };

    await router.push("/api-tests/runs/run-a");
    render(Wrapper, { global: { plugins: [pinia, router] } });

    expect(await screen.findByText("test_failed_one")).toBeInTheDocument();
    expect(screen.queryByText("test_passed_one")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /通过用例/ }));

    expect(screen.getByText("test_passed_one")).toBeInTheDocument();
    expect(screen.getByText("test_passed_two")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /通过用例/ })).toHaveTextContent("收起");

    // 失败组默认展开，点一下收起。
    await userEvent.click(screen.getByRole("button", { name: /失败用例/ }));

    expect(screen.queryByText("test_failed_one")).not.toBeInTheDocument();
  });

  it("collapses skipped cases separately from passed cases", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        jsonResponse({
          ...runDetail("run-a", "认证"),
          items: [
            runItem("passed_one", "passed"),
            runItem("forced_skip", "skipped"),
            runItem("failed_one", "failed"),
          ],
        }),
      ),
    );

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/api-tests/runs/:runId",
          name: "api-test-run",
          component: ApiTestRunView,
          props: (route) => ({ runId: String(route.params.runId) }),
        },
      ],
    });
    const Wrapper = { template: "<RouterView />" };

    await router.push("/api-tests/runs/run-a");
    render(Wrapper, { global: { plugins: [pinia, router] } });

    expect(await screen.findByText("test_failed_one")).toBeInTheDocument();
    expect(screen.queryByText("test_passed_one")).not.toBeInTheDocument();
    expect(screen.queryByText("test_forced_skip")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /跳过用例/ }));

    // 展开跳过用例不会连带展开通过用例。
    expect(screen.getByText("test_forced_skip")).toBeInTheDocument();
    expect(screen.queryByText("test_passed_one")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /跳过用例/ })).toHaveTextContent("收起");

    await userEvent.click(screen.getByRole("button", { name: /通过用例/ }));

    expect(screen.getByText("test_passed_one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /通过用例/ })).toHaveTextContent("收起");
  });

  it("keeps the run error collapsed until it is expanded", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        jsonResponse({
          ...runDetail("run-a", "认证"),
          status: "failed",
          errorMessage: "collected 12 items\n\nFAILED testcases/auth/test_login.py::test_login",
        }),
      ),
    );

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/api-tests/runs/:runId",
          name: "api-test-run",
          component: ApiTestRunView,
          props: (route) => ({ runId: String(route.params.runId) }),
        },
      ],
    });
    const Wrapper = { template: "<RouterView />" };

    await router.push("/api-tests/runs/run-a");
    render(Wrapper, { global: { plugins: [pinia, router] } });

    // 折叠状态只留标题，日志内容一律不展示。
    expect(await screen.findByRole("button", { name: "展开完整输出" })).toBeInTheDocument();
    expect(screen.queryByText("collected 12 items")).not.toBeInTheDocument();
    expect(screen.queryByText(/FAILED testcases/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开完整输出" }));

    expect(screen.getByText(/FAILED testcases/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "收起" }));

    expect(screen.queryByText(/FAILED testcases/)).not.toBeInTheDocument();
  });
});

describe("api test run items table", () => {
  async function renderItems(items: unknown[]): Promise<void> {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(jsonResponse({ ...runDetail("run-a", "认证"), items })),
    );

    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/api-tests/runs/:runId",
          name: "api-test-run",
          component: ApiTestRunView,
          props: (route) => ({ runId: String(route.params.runId) }),
        },
      ],
    });
    const Wrapper = { template: "<RouterView />" };

    await router.push("/api-tests/runs/run-a");
    render(Wrapper, { global: { plugins: [pinia, router] } });
    await screen.findByText("test_failed_one");
  }

  async function expandRow(index: number): Promise<void> {
    const icons = document.querySelectorAll(".el-table__expand-icon");
    expect(icons.length).toBeGreaterThan(index);
    await userEvent.click(icons[index] as Element);
  }

  it("skips the request/response block when nothing was captured", async () => {
    await renderItems([{ ...runItem("failed_one", "failed"), failure: null }]);

    await expandRow(0);

    expect(screen.queryByRole("button", { name: "请求 / 响应" })).not.toBeInTheDocument();
  });

  it("shows the failure category instead of the raw traceback", async () => {
    await renderItems([runItem("failed_one", "failed")]);

    await expandRow(0);

    expect(screen.getAllByText("Assertion failed")).not.toHaveLength(0);
    expect(screen.getByText("Expected 200, got 500")).toBeInTheDocument();
    expect(screen.queryByText(/AssertionError: 期望 200，实际 500/)).not.toBeInTheDocument();
  });

  it("shows the captured request/response for a failed case", async () => {
    await renderItems([
      {
        ...runItem("failed_one", "failed"),
        request: [{ method: "GET", url: "https://api.kitarx.com/api/v1/admin/users" }],
        response: [{ status: 405, body: null }],
      },
    ]);

    await expandRow(0);
    await userEvent.click(screen.getByRole("button", { name: "请求 / 响应" }));

    expect(screen.getByText(/"status": 405/)).toBeInTheDocument();
  });
});
