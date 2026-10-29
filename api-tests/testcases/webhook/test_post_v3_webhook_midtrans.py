"""Midtrans v3 支付通知回调"""
"""
支付成功流程测试

测试场景（来自 XMind）：
- 8.1 支付成功 settlement/capture
- 8.2 支付失败 deny/cancel
- 8.3 支付过期 expire
- 8.4 幂等处理

流程：
1. 调用 place-order 创建订单
2. 获取订单信息和金额
3. 模拟 Midtrans webhook 回调
4. 验证订单状态变为 PAID
"""
import pytest
import hashlib
from common.assertions import assert_status, assert_code

# Midtrans Sandbox Server Key
MIDTRANS_SERVER_KEY = "SB-Mid-server-K0_S9rGhklk386xnLv7kAn8n"

# 测试数据
ADDRESS_ID = "1fb4bf37-60a7-4f1b-a78e-a58e71dc623d"
CANDIDATE_INVENTORY_IDS = ["TEST-0397", "TEST-0275", "KRIDP00015686", "TEST-0490"]


class TestPaymentSuccess:
    """支付成功流程测试"""

    def get_available_inventory(self, user_client):
        """获取可用的商品 ID"""
        for inv_id in CANDIDATE_INVENTORY_IDS:
            resp = user_client.get("/api/v3/checkout/precheck", params={"inventoryId": inv_id})
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                if data.get("canCheckout") and data.get("action") == "OPEN_CHECKOUT":
                    return inv_id
        return None

    def calculate_signature(self, order_id, status_code, gross_amount):
        """计算 Midtrans webhook 签名
        
        signature = SHA512(order_id + status_code + gross_amount + server_key)
        """
        data = f"{order_id}{status_code}{int(gross_amount)}{MIDTRANS_SERVER_KEY}"
        return hashlib.sha512(data.encode()).hexdigest()

    def get_midtrans_notification(self, order_id, gross_amount, transaction_status, fraud_status="accept"):
        """构造 Midtrans webhook 通知数据（带正确签名）"""
        status_code = "200" if transaction_status in ["capture", "settlement"] else "202"
        signature_key = self.calculate_signature(order_id, status_code, gross_amount)
        
        return {
            "transaction_time": "2026-05-19 17:00:00",
            "transaction_status": transaction_status,
            "transaction_id": f"tx-{order_id}",
            "status_message": f"transaction {transaction_status}",
            "status_code": status_code,
            "signature_key": signature_key,
            "payment_type": "qris",
            "order_id": order_id,
            "merchant_id": "M001",
            "gross_amount": str(int(gross_amount)),
            "fraud_status": fraud_status,
            "currency": "IDR"
        }

    def create_order(self, user_client):
        """创建订单并返回订单信息"""
        inventory_id = self.get_available_inventory(user_client)
        if not inventory_id:
            pytest.skip("没有可用的商品")
        
        resp = user_client.post('/api/v3/checkout/place-order', json={
            'inventoryId': inventory_id,
            'fulfillmentMethod': 'HOME_DELIVERY',
            'addressId': ADDRESS_ID,
            'shippingMethodCode': 'REGULAR',
            'paymentMethodCode': 'QRIS'
        })
        
        if resp.status_code != 200:
            pytest.skip(f"创建订单失败: {resp.status_code}")
        
        data = resp.json().get('data', {})
        return {
            'order_id': data.get('orderId'),
            'gross_amount': data.get('payment', {}).get('amount'),
            'inventory_id': inventory_id
        }

    def test_payment_success_capture(self, user_client):
        """支付成功 - capture
        
        验证：
        - 订单状态变为 PAID
        - 支付状态变为 PAID
        - 数据落库正确
        """
        order = self.create_order(user_client)
        order_id = order['order_id']
        gross_amount = order['gross_amount']
        
        # 发送 capture 通知
        notification = self.get_midtrans_notification(order_id, gross_amount, "capture", "accept")
        resp = user_client.post("/api/v3/webhook/midtrans", json=notification)
        assert resp.status_code == 200
        
        # 验证订单状态变为 PAID
        order_resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        assert order_resp.status_code == 200
        assert order_resp.json()["code"] == 0
        
        order_data = order_resp.json()["data"]["order"]
        assert order_data["orderStatus"] == "PAID", f"订单状态应为 PAID，实际为 {order_data['orderStatus']}"
        assert order_data["payment"]["status"] == "PAID", f"支付状态应为 PAID，实际为 {order_data['payment']['status']}"
        
        # 验证有 paidAt 时间戳（在 payment 对象中）
        assert order_data["payment"].get("paidAt") is not None, "paidAt 应有值"
        
        # 清理
        user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "cleanup"})

    def test_payment_success_settlement(self, user_client):
        """支付成功 - settlement"""
        order = self.create_order(user_client)
        order_id = order['order_id']
        gross_amount = order['gross_amount']
        
        notification = self.get_midtrans_notification(order_id, gross_amount, "settlement")
        resp = user_client.post("/api/v3/webhook/midtrans", json=notification)
        assert resp.status_code == 200
        
        # 验证订单状态
        order_resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        order_data = order_resp.json()["data"]["order"]
        assert order_data["orderStatus"] == "PAID"
        
        # 清理
        user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "cleanup"})

    def test_payment_failed_deny(self, user_client):
        """支付失败 - deny
        
        验证：
        - 支付状态变为 FAILED
        - 订单状态回退
        """
        order = self.create_order(user_client)
        order_id = order['order_id']
        gross_amount = order['gross_amount']
        
        notification = self.get_midtrans_notification(order_id, gross_amount, "deny")
        resp = user_client.post("/api/v3/webhook/midtrans", json=notification)
        assert resp.status_code == 200
        
        # 验证支付状态
        order_resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        order_data = order_resp.json()["data"]["order"]
        assert order_data["payment"]["status"] == "FAILED"
        
        # 清理
        user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "cleanup"})

    def test_payment_cancel(self, user_client):
        """支付取消 - cancel"""
        order = self.create_order(user_client)
        order_id = order['order_id']
        gross_amount = order['gross_amount']
        
        notification = self.get_midtrans_notification(order_id, gross_amount, "cancel")
        resp = user_client.post("/api/v3/webhook/midtrans", json=notification)
        assert resp.status_code == 200
        
        # 清理
        user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "cleanup"})

    def test_payment_expire(self, user_client):
        """支付过期 - expire"""
        order = self.create_order(user_client)
        order_id = order['order_id']
        gross_amount = order['gross_amount']
        
        notification = self.get_midtrans_notification(order_id, gross_amount, "expire")
        resp = user_client.post("/api/v3/webhook/midtrans", json=notification)
        assert resp.status_code == 200
        
        # 清理
        user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "cleanup"})

    def test_payment_idempotent(self, user_client):
        """幂等处理：重复通知应该幂等"""
        order = self.create_order(user_client)
        order_id = order['order_id']
        gross_amount = order['gross_amount']
        
        notification = self.get_midtrans_notification(order_id, gross_amount, "capture", "accept")
        
        # 第一次通知
        resp1 = user_client.post("/api/v3/webhook/midtrans", json=notification)
        assert resp1.status_code == 200
        
        # 第二次重复通知 - 应该幂等处理
        resp2 = user_client.post("/api/v3/webhook/midtrans", json=notification)
        assert resp2.status_code == 200
        
        # 清理
        user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "cleanup"})

    def test_payment_invalid_signature(self, user_client):
        """签名无效 - 返回 401"""
        order = self.create_order(user_client)
        order_id = order['order_id']
        
        # 使用错误的签名
        notification = {
            "transaction_status": "capture",
            "order_id": order_id,
            "signature_key": "invalid-signature",
            "gross_amount": "5000000"
        }
        
        resp = user_client.post("/api/v3/webhook/midtrans", json=notification)
        assert resp.status_code == 401
        
        # 清理
        user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "cleanup"})
