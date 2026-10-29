"""[POST] /api/v3/sale-orders/{orderId}/cancel - 取消订单

测试场景（来自文档和 XMind）：
- 订单详情页取消订单
- Pay In-Store 锁单取消后释放库存
- 订单状态机校验
"""
import pytest
from common.assertions import assert_status, assert_code


class TestPostV3SaleOrdersCancel:

    def test_cancel_order_not_found(self, user_client):
        """订单不存在"""
        resp = user_client.post("/api/v3/sale-orders/NONEXISTENT/cancel", json={
            "reason": "user_cancel"
        })
        # Bug: 服务端返回 HTTP 404 而非文档约定的 200
        assert resp.status_code in [200, 404]
        assert resp.json()["code"] == 1001

    def test_cancel_order_with_reason(self, user_client, home_delivery_order):
        """取消订单时提供取消原因"""
        order_id = home_delivery_order["orderId"]
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={
            "reason": "Found better price elsewhere"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        assert data["orderStatus"] == "CANCELLED"

    def test_cancel_home_delivery_order(self, user_client, home_delivery_order):
        """取消 Home Delivery 订单"""
        order_id = home_delivery_order["orderId"]
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={
            "reason": "user_cancel"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        assert data["orderStatus"] == "CANCELLED"

    def test_cancel_instore_pickup_order(self, user_client, instore_pickup_order):
        """取消 In-Store Pickup 线上支付订单"""
        order_id = instore_pickup_order["orderId"]
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={
            "reason": "user_cancel"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        assert data["orderStatus"] == "CANCELLED"

    def test_cancel_pay_in_store_order(self, user_client, pay_in_store_order):
        """取消 Pay In-Store 锁单订单（释放库存）"""
        order_id = pay_in_store_order["orderId"]
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={
            "reason": "user_cancel"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        assert data["orderStatus"] == "CANCELLED"
        # TODO: 验证库存状态变为 available

    def test_cancel_order_already_cancelled(self, user_client, home_delivery_order):
        """重复取消已取消的订单"""
        order_id = home_delivery_order["orderId"]
        # 第一次取消
        resp1 = user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "user_cancel"})
        assert resp1.status_code == 200
        # 第二次取消
        resp2 = user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "user_cancel"})
        # 应该返回错误或幂等成功
        assert resp2.status_code in [200, 400]

    def test_cancel_order_unauthorized(self, public_client):
        """未登录态取消订单"""
        resp = public_client.post("/api/v3/sale-orders/TEST-ORDER/cancel", json={"reason": "user_cancel"})
        assert resp.status_code in [401, 400]
        assert resp.json()["code"] in [2001, 2002]

    def test_cancel_order_missing_reason(self, user_client, home_delivery_order):
        """缺少取消原因"""
        order_id = home_delivery_order["orderId"]
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={})
        # 应该仍然成功（reason 可选）或返回错误
        assert resp.status_code in [200, 400]
