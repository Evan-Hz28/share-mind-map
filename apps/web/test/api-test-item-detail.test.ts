import type { ApiTestRunItemResponseDto } from "@share-mind-map/api-client";
import { render, screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApiTestItemDetail from "../src/api-tests/ApiTestItemDetail.vue";
import { jsonResponse } from "./helpers.js";

const ITEM: ApiTestRunItemResponseDto = {
  id: "item-1",
  nodeId:
    "testcases/cart/test_post_product_cart.py::TestPostProductCart::test_post_product_cart[body2-400-1001]",
  caseName: "test_post_product_cart",
  ordinal: 0,
  status: "failed",
  durationMs: 70,
  failure: [
    'E       AssertionError: 期望状态码 400，实际 200，响应: {"code":1001}',
    "E       ",
    "E       CURL:",
    "E       curl -X POST \\",
    "E         -H 'Content-Type: application/json' \\",
    "E         'https://api.example.com/api/v2/product/cart'",
  ].join("\n"),
  request: null,
  response: null,
};

const CURL = [
  "curl -X POST \\",
  "  -H 'Content-Type: application/json' \\",
  "  'https://api.example.com/api/v2/product/cart'",
].join("\n");

// exactOptionalPropertyTypes 下展开 DTO 会把可选字段变成 `T | undefined`，这里统一收口。
function item(overrides: Partial<ApiTestRunItemResponseDto> = {}): ApiTestRunItemResponseDto {
  return { ...ITEM, ...overrides };
}

function renderDetail(data: ApiTestRunItemResponseDto = ITEM) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      {
        path: "/api-tests/runs/:runId",
        name: "api-test-run",
        component: { template: "<div />" },
      },
    ],
  });
  void router.push("/");
  render(ApiTestItemDetail, { props: { item: data }, global: { plugins: [router] } });
  return router;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("api test item detail", () => {
  it("copies the failing curl command", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDetail();

    await userEvent.click(screen.getByRole("button", { name: "复制 curl" }));

    expect(writeText).toHaveBeenCalledWith(CURL);
    expect(screen.getByText("已复制 curl")).toBeInTheDocument();
  });

  it("reruns the exact case and opens the new report", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : (init?.method ?? "GET");
      requests.push({ url, method });
      return Promise.resolve(
        jsonResponse({ batchId: "batch-1", runs: [{ id: "run-new" }] }, 201),
      );
    });
    const router = renderDetail();

    await userEvent.click(screen.getByRole("button", { name: "重跑此用例" }));

    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("api-test-run");
    });
    expect(router.currentRoute.value.params.runId).toBe("run-new");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url.endsWith("/api/v1/api-tests/run-items/item-1/rerun")).toBe(true);
  });

  it("hides the rerun entry for passed cases", () => {
    renderDetail(item({ status: "passed", failure: null, request: null, response: null }));

    expect(screen.queryByRole("button", { name: "重跑此用例" })).not.toBeInTheDocument();
  });

  it("falls back to the captured request when the traceback has no CURL block", () => {
    // harness 存的是 exchange 数组，生成的 DTO 类型只声明了对象，这里按真实数据强转。
    const request = [
      {
        method: "GET",
        url: "https://api.example.com/api/v3/order",
        requestHeaders: { Authorization: "<redacted>" },
      },
    ] as unknown as NonNullable<ApiTestRunItemResponseDto["request"]>;
    renderDetail(item({ failure: "E       AssertionError: 期望 200，实际 500", request }));

    expect(screen.getByRole("button", { name: "复制 curl" })).toHaveAttribute(
      "title",
      "鉴权头已脱敏，复制后需要手动补 token",
    );
  });
});
