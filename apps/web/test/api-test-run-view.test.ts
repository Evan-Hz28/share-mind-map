import { render, screen } from "@testing-library/vue";
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
});
