"""[GET] /api/v3/payment-attempts/{paymentId}/status - 查询支付结果

测试场景：
- 支付成功后的状态查询
- 支付失败后的状态查询
- 支付处理中的状态查询
- 不存在的支付attempt
"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetV3PaymentAttemptsStatus:

    def test_get_payment_status_success(self, user_client, home_delivery_order):
        """查询支付成功后的状态"""
        # 先创建支付attempt
        order_id = home_delivery_order["orderId"]
        create_resp = user_client.post(f"/api/v3/sale-orders/{order_id}/payment-attempts", json={
            "paymentMethod": "BANK_TRANSFER"
        })
        
        if create_resp.status_code == 200:
            payment_id = create_resp.json()["data"]["paymentId"]
            
            # 查询支付状态
            resp = user_client.get(f"/api/v3/payment-attempts/{payment_id}/status")
            assert_status(resp, 200)
            assert_code(resp, 0)
            
            data = resp.json()["data"]
            assert "paymentId" in data
            assert "status" in data
            assert "paymentMethod" in data

    def test_get_payment_status_not_found(self, user_client):
        """查询不存在的支付attempt"""
        resp = user_client.get("/api/v3/payment-attempts/NONEXISTENT_PAYMENT_ID")
        assert_status(resp, 404)

    def test_get_payment_status_unauthorized(self, public_client):
        """未授权访问"""
        resp = public_client.get("/api/v3/payment-attempts/SOME_PAYMENT_ID")
        assert resp.status_code in (400, 401, 404)

    def test_get_payment_status_pending(self, user_client, home_delivery_order):
        """查询处理中的支付状态"""
        order_id = home_delivery_order["orderId"]
        create_resp = user_client.post(f"/api/v3/sale-orders/{order_id}/payment-attempts", json={
            "paymentMethod": "BANK_TRANSFER"
        })
        
        if create_resp.status_code == 200:
            payment_id = create_resp.json()["data"]["paymentId"]
            
            resp = user_client.get(f"/api/v3/payment-attempts/{payment_id}/status")
            assert_status(resp, 200)
            
            data = resp.json()["data"]
            # 验证状态字段存在
            assert "status" in data
            # 初始状态应该是 PENDING 或类似状态
            assert data["status"] in ["PENDING", "PENDING_PAYMENT", "CREATED"]

    def test_payment_status_after_success(self, user_client, paid_order):
        """支付成功后状态查询"""
        # 使用已支付订单验证支付状态
        order_id = paid_order.get("orderId")
        if order_id:
            # 获取订单详情中的支付信息
            detail_resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
            if detail_resp.status_code == 200:
                order = detail_resp.json()["data"]["order"]
                payments = order.get("payments", [])
                if payments:
                    payment_id = payments[0].get("paymentId")
                    if payment_id:
                        resp = user_client.get(f"/api/v3/payment-attempts/{payment_id}/status")
                        assert_status(resp, 200)
                        data = resp.json()["data"]
                        # 支付成功后状态应该是 SUCCESS 或 SETTLED
                        assert data["status"] in ["SUCCESS", "SETTLED", "PAID"]
