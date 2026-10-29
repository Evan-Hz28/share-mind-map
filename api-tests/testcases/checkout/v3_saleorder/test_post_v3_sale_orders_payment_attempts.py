"""[POST] /api/v3/sale-orders/{orderId}/payment-attempts - 继续支付/切换支付方式

测试场景（来自文档和 XMind）：
- 订单详情页 Pay Now
- Change Payment
- Pay In-Store 订单切换为线上支付
- 未支付线上订单切换支付方式
"""
import pytest
from common.assertions import assert_status, assert_code, skip_if_rate_limited


class TestPostV3SaleOrdersPaymentAttempts:

    def get_pending_order_id(self, user_client):
        """获取一个 pending 状态的订单 ID"""
        resp = user_client.get("/api/v3/sale-orders", params={
            "page": 1, 
            "pageSize": 1,
            "status": "PENDING_PAYMENT"
        })
        data = resp.json().get("data", {})
        orders = data.get("list", [])
        return orders[0].get("orderId") if orders else None

    def test_create_payment_attempt_success(self, user_client):
        """正常场景：创建支付尝试"""
        order_id = self.get_pending_order_id(user_client)
        if not order_id:
            pytest.skip("没有可用的 pending 订单")
        
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/payment-attempts", json={
            "paymentMethodCode": "QRIS"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        
        assert "action" in data
        assert data["action"] == "OPEN_PAYMENT"
        assert "paymentId" in data
        assert "payment" in data
        
        payment = data["payment"]
        assert payment.get("methodCode") == "QRIS"
        assert "redirectUrl" in payment or "snapToken" in payment

    def test_switch_payment_method(self, user_client):
        """切换支付方式"""
        order_id = self.get_pending_order_id(user_client)
        if not order_id:
            pytest.skip("没有可用的 pending 订单")
        
        # 切换到 GOPAY
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/payment-attempts", json={
            "paymentMethodCode": "GOPAY"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

    def test_reuse_existing_payment_link(self, user_client):
        """复用已存在的有效支付链接"""
        order_id = self.get_pending_order_id(user_client)
        if not order_id:
            pytest.skip("没有可用的 pending 订单")
        
        # 第一次创建
        resp1 = user_client.post(f"/api/v3/sale-orders/{order_id}/payment-attempts", json={
            "paymentMethodCode": "QRIS"
        })
        
        # 第二次相同支付方式，应该复用
        resp2 = user_client.post(f"/api/v3/sale-orders/{order_id}/payment-attempts", json={
            "paymentMethodCode": "QRIS"
        })
        
        if resp1.json().get("code") == 0 and resp2.json().get("code") == 0:
            # 如果都成功，检查是否复用了同一个 paymentId
            data1 = resp1.json()["data"]
            data2 = resp2.json()["data"]
            # reused=true 表示复用
            assert data2.get("reused") is True or data1["paymentId"] == data2["paymentId"]

    def test_payment_method_not_supported(self, user_client):
        """支付方式不可用"""
        order_id = self.get_pending_order_id(user_client)
        if not order_id:
            pytest.skip("没有可用的 pending 订单")
        
        # 尝试使用 PAY_IN_STORE（Home Delivery 不支持）
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/payment-attempts", json={
            "paymentMethodCode": "PAY_IN_STORE"
        })
        # 返回 400 表示支付方式不支持
        assert resp.status_code in [200, 400]
        if resp.status_code == 200:
            assert resp.json()["code"] == 1001
            details = resp.json().get("details", {})
            assert details.get("businessCode") == "PAYMENT_METHOD_NOT_SUPPORTED"

    def test_order_not_payable(self, user_client):
        """当前订单状态不能支付"""
        # 尝试用已支付的订单
        resp = user_client.get("/api/v3/sale-orders", params={
            "page": 1, 
            "pageSize": 1,
            "status": "PAID"
        })
        data = resp.json().get("data", {})
        orders = data.get("list", [])
        
        if not orders:
            pytest.skip("没有已支付的订单")
        
        order_id = orders[0].get("orderId")
        resp = user_client.post(f"/api/v3/sale-orders/{order_id}/payment-attempts", json={
            "paymentMethodCode": "QRIS"
        })
        skip_if_rate_limited(resp)
        assert resp.status_code in (200, 400)
        assert resp.json()["code"] == 1001

    def test_order_not_found(self, user_client):
        """订单不存在"""
        resp = user_client.post("/api/v3/sale-orders/NONEXISTENT/payment-attempts", json={
            "paymentMethodCode": "QRIS"
        })
        skip_if_rate_limited(resp)
        assert resp.status_code in (200, 400)
        assert resp.json()["code"] == 1001
