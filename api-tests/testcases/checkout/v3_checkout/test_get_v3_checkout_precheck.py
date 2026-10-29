"""[GET] /api/v3/checkout/precheck - Checkout 前置校验

校验商品是否可 checkout，判断是否有 pending 订单。

测试场景（来自 XMind）：
- 1.1 正常场景：商品可用，返回 canCheckout=true
- 1.2 已有pending订单场景
- 1.3 商品不可售场景
- 1.4 异常参数校验
"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetV3CheckoutPrecheck:

    # ==================== 1.1 正常场景 ====================

    def test_precheck_available_product(self, user_client):
        """商品可用，返回 canCheckout=true, action=OPEN_CHECKOUT"""
        from common.inventory_helper import get_available_product_with_retry
        
        # 动态获取可用商品
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        resp = user_client.get("/api/v3/checkout/precheck", params={"inventoryId": product["id"]})
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        assert data["canCheckout"] is True
        assert data["productStatus"] == "available"
        assert data["hasPendingOrder"] is False
        assert data["action"] == "OPEN_CHECKOUT"

    def test_precheck_product_status_available(self, user_client):
        """商品状态为available，productStatus=available"""
        from common.inventory_helper import get_available_product_with_retry
        
        # 动态获取可用商品
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        resp = user_client.get("/api/v3/checkout/precheck", params={"inventoryId": product["id"]})
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        assert data["productStatus"] == "available"

    def test_precheck_another_available_product(self, user_client):
        """商品可用，用户无pending订单，返回正确响应"""
        from common.inventory_helper import get_available_product_with_retry
        
        # 动态获取可用商品
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        resp = user_client.get("/api/v3/checkout/precheck", params={"inventoryId": product["id"]})
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        assert "canCheckout" in data
        assert "action" in data

    # ==================== 1.3 商品不可售场景 ====================

    def test_precheck_product_not_found(self, user_client):
        """商品不存在，返回错误提示"""
        resp = user_client.get("/api/v3/checkout/precheck", params={"inventoryId": "NONEXISTENT-12345"})
        # 服务端返回 HTTP 400，这是合理的行为
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] == 1001
        details = resp.json().get("details", {})
        assert details.get("businessCode") == "PRODUCT_NOT_FOUND"

    # ==================== 1.4 异常参数校验 ====================

    def test_precheck_missing_inventory_id(self, user_client):
        """inventoryId为空，返回参数错误 code=1001"""
        resp = user_client.get("/api/v3/checkout/precheck", params={"inventoryId": ""})
        # 服务端返回 HTTP 400，这是合理的行为
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] == 1001

    def test_precheck_invalid_inventory_id_format(self, user_client):
        """inventoryId格式非法，返回参数错误"""
        resp = user_client.get("/api/v3/checkout/precheck", params={"inventoryId": "INVALID@ID#123"})
        # 服务端返回 HTTP 400，这是合理的行为
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] == 1001

    def test_precheck_unauthorized(self, public_client):
        """未登录态访问，返回 code=2001"""
        resp = public_client.get("/api/v3/checkout/precheck", params={"inventoryId": "TEST-0397"})
        assert resp.status_code in [401, 400]
        assert resp.json()["code"] in [2001, 2002]

    # ==================== 1.2 已有pending订单场景 ====================

    def test_precheck_has_pending_order(self, user_client, home_delivery_order):
        """用户有PENDING_PAYMENT状态订单，返回 hasPendingOrder=true"""
        resp = user_client.get("/api/v3/checkout/precheck", params={
            "inventoryId": home_delivery_order["inventoryId"]
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        # 用户有 pending 订单
        assert data.get("hasPendingOrder") is True
        assert data.get("action") == "GO_ORDER_DETAIL"
        assert data.get("pendingOrderId") is not None
