import { describe, expect, it } from "vitest";

import { failureKind, parseFailure } from "../src/api-tests/failure.js";

const ASSERTION_WITH_MESSAGE = `self = <testcases.refund.test_refund_urgency_strict.TestRefundUrgencyStrictValidation object at 0x74c16c112b90>
user_client = <common.http_client.HttpClient object at 0x74c16c122ad0>

    def test_status_validation_refunded_rejected(self, user_client, refunded_order):
        """验证REFUNDED状态拒绝加急"""
        order_id = refunded_order["orderId"]

        resp = user_client.put(f"/api/v3/sale-orders/{order_id}/refund-urgency")

>       assert resp.status_code == 400, \\
            f"REFUNDED状态应返回400, 实际返回{resp.status_code}"
E       AssertionError: REFUNDED状态应返回400, 实际返回200
E       assert 200 == 400
E        +  where 200 = <Response [200]>.status_code

testcases/refund/test_refund_urgency_strict.py:240: AssertionError`;

const ASSERTION_WITHOUT_MESSAGE = `        resp = voucher_admin_client.delete(f"/api/v1/admin/push/{existing_push_id}")
        # 可能返回 200 成功或 404 不存在
>       assert resp.status_code in [200, 404]
E       assert 400 in [200, 404]
E        +  where 400 = <Response [400]>.status_code

testcases/kado/push管理/test_delete_push.py:29: AssertionError`;

const ASSERTION_WITH_RESPONSE = `        resp = client.get("/api/v1/search/product/list")
>       assert resp.status_code == 200, f"期望状态码 200，实际 {resp.status_code}，响应: {resp.text}"
E       AssertionError: 期望状态码 200，实际 404，响应: {"code":1001,"details":"route not found","message":"error","path":"/api/v1/search/product/list"}
E       assert 404 == 200

testcases/search/test_search.py:31: AssertionError`;

const DNS_FAILURE = `testcases/tawar/auction/test_trade.py:207: in test_order_detail
    resp = client.get("/api/v3/shop/product/fomo")
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

host = 'mhjapi.kitarx.com', port = 443
method = 'GET', url = '/api/v3/shop/product/fomo?inventoryId=SOLD-OUT-001'
>       for res in _socket.getaddrinfo(host, port, family, type, proto, flags):
E       socket.gaierror: [Errno -5] No address associated with hostname

/usr/lib/python3.11/socket.py:962: gaierror`;

const MISSING_FIXTURE = `ERROR testcases/tawar/admin/test_auth.py - fixture 'admin_client' not found

E       fixture 'admin_client' not found
>       available fixtures: client, user_client, session
>       use 'pytest --fixtures [testpath]' for help on them.`;

const SCRIPT_ERROR = `    def test_detail(self, client):
        resp = client.get("/api/v3/order")
        data = resp.json()
>       return data["data"]
E       KeyError: 'data'

testcases/kado/order/test_detail.py:88: KeyError`;

describe("parseFailure", () => {
  it("reads the assertion message and keeps the failing statement", () => {
    const view = parseFailure(ASSERTION_WITH_MESSAGE);

    expect(view?.kind).toBe("assertion");
    expect(view?.label).toBe("Assertion failed");
    expect(view?.headline).toBe("REFUNDED状态应返回400, 实际返回200");
    expect(view?.location).toBe("testcases/refund/test_refund_urgency_strict.py:240");
    expect(view?.sources).toEqual([
      'assert resp.status_code == 400, f"REFUNDED状态应返回400, 实际返回{resp.status_code}"',
    ]);
  });

  it("derives expected and actual from a bare assert", () => {
    const view = parseFailure(ASSERTION_WITHOUT_MESSAGE);

    expect(view?.kind).toBe("assertion");
    expect(view?.headline).toBe("assert 400 in [200, 404]");
    expect(view?.detail).toBe("Got 400, expected one of [200, 404]");
  });

  it("keeps only the server message when the assertion embeds a JSON body", () => {
    const view = parseFailure(ASSERTION_WITH_RESPONSE);

    expect(view?.headline).toBe("Expected status 200, got 404 · route not found");
  });

  it("translates the upstream status template and keeps the business code", () => {
    const view = parseFailure(
      `E       AssertionError: 期望状态码 400，实际 200，响应: {"code":1001,"message":"error","details":{"businessCode":"PRODUCT_NOT_FOUND","message":"Product not found"},"path":"/api/v2/product/cart"}`,
    );

    expect(view?.headline).toBe(
      "Expected status 400, got 200 · PRODUCT_NOT_FOUND: Product not found",
    );
  });

  it("compacts a JSON body that follows 实际:", () => {
    const view = parseFailure(
      `E       AssertionError: 响应缺少 businessCode 字段，实际: {"code":1001,"message":"missing inventoryId","path":"/api/v3/checkout/quote"}`,
    );

    expect(view?.headline).toBe(
      "Response is missing field businessCode · missing inventoryId",
    );
  });

  it("classifies pytest.fail as an assertion failure", () => {
    const view = parseFailure(`E       Failed: BUG: 无图商品 KTEST013 没有返回兜底图`);

    expect(view?.kind).toBe("assertion");
    expect(view?.headline).toBe("Failed: BUG: 无图商品 KTEST013 没有返回兜底图");
  });

  it("falls back to the raw message when the embedded JSON was truncated", () => {
    const view = parseFailure(
      `E       AssertionError: 期望状态码 200，实际 404，响应: {"code":1001,"details":"route not found"`,
    );

    expect(view?.headline).toContain('{"code":1001');
  });

  it("recognises an unreachable target and names the host", () => {
    const view = parseFailure(DNS_FAILURE);

    expect(view?.kind).toBe("unreachable");
    expect(view?.label).toBe("Unreachable");
    expect(view?.headline).toBe("域名解析失败：mhjapi.kitarx.com");
    expect(view?.location).toBe("testcases/tawar/auction/test_trade.py:207");
    // 没有采集 exchanges 时，从 urllib3 的参数行里兜底取请求信息。
    expect(view?.method).toBe("GET");
    expect(view?.path).toBe("/api/v3/shop/product/fomo");
    // 网络错误没有值得展示的用户源码片段。
    expect(view?.sources).toEqual([]);
  });

  it("separates cases that never ran from real failures", () => {
    const view = parseFailure(MISSING_FIXTURE);

    expect(view?.kind).toBe("not-run");
    expect(view?.headline).toBe("缺少 fixture「admin_client」");
  });

  it("keeps the failing line for exceptions raised by the test script", () => {
    const view = parseFailure(SCRIPT_ERROR);

    expect(view?.kind).toBe("script-error");
    expect(view?.headline).toBe("KeyError: 'data'");
    expect(view?.sources).toEqual(['return data["data"]']);
  });

  it("reads method, path and status from the captured exchanges", () => {
    const view = parseFailure(
      ASSERTION_WITH_MESSAGE,
      [{ method: "PUT", url: "https://api.kitarx.com/api/v3/sale-orders/x/refund-urgency" }],
      [{ status: 200, durationMs: 1234 }],
    );

    expect(view?.method).toBe("PUT");
    expect(view?.path).toBe("/api/v3/sale-orders/x/refund-urgency");
    expect(view?.status).toBe(200);
    expect(view?.durationMs).toBe(1234);
  });

  it("treats empty failures as nothing to show", () => {
    expect(parseFailure(null)).toBeNull();
    expect(parseFailure("   ")).toBeNull();
  });

  it("falls back to the first line when the traceback has no E line", () => {
    const view = parseFailure("只保留头部的旧数据，没有断言行");

    expect(view?.kind).toBe("unknown");
    expect(view?.headline).toBe("只保留头部的旧数据，没有断言行");
  });
});

describe("failureKind", () => {
  it("only classifies failed and errored cases", () => {
    const base = { caseName: "x", id: "i", nodeId: "n", ordinal: 0, status: "passed" };

    expect(failureKind({ ...base, failure: "E   AssertionError: boom" })).toBeNull();
    expect(failureKind({ ...base, status: "failed", failure: "E   AssertionError: boom" })).toBe(
      "assertion",
    );
  });
});
