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

    await userEvent.click(
      screen.getByRole("button", { name: "已折叠 2 条通过用例，点击展开" }),
    );

    expect(screen.getByText("test_passed_one")).toBeInTheDocument();
    expect(screen.getByText("test_passed_two")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只看失败用例" })).toBeInTheDocument();
  });
});
