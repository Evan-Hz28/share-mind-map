"""[GET] /api/v3/checkout/payment-methods - 单独刷新支付方式

根据结算金额、取货模式、黑名单等判断可支持支付方式。
"""
import pytest
from common.assertions import assert_status, assert_code, assert_json_key


class TestGetV3CheckoutPaymentMethods:


    def test_refresh_payment_methods_home_delivery(self, user_client, available_inventory_id):
        """Home Delivery 支付方式"""
        resp = user_client.get("/api/v3/checkout/payment-methods", params={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert resp.status_code in [200, 400]
        assert_code(resp, 0)
        data = resp.json()["data"]

        assert "defaultMethodCode" in data
        assert "allMethods" in data

        # Home Delivery 不应展示 PAY_IN_STORE
        all_methods = data.get("allMethods", [])
        pay_in_store = next((m for m in all_methods if m["methodCode"] == "PAY_IN_STORE"), None)
        assert pay_in_store is None or pay_in_store.get("visible") is False

    def test_refresh_payment_methods_in_store_pickup(self, user_client, available_inventory_id):
        """In-Store Pickup 支付方式"""
        resp = user_client.get("/api/v3/checkout/payment-methods", params={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "IN_STORE_PICKUP"
        })
        assert resp.status_code in [200, 400]
        assert_code(resp, 0)
        data = resp.json()["data"]

        all_methods = data.get("allMethods", [])
        # In-Store Pickup 应该展示 PAY_IN_STORE（如果可用）
        assert len(all_methods) > 0

    def test_payment_methods_structure(self, user_client, available_inventory_id):
        """验证支付方式结构"""
        resp = user_client.get("/api/v3/checkout/payment-methods", params={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert resp.status_code in [200, 400]
        assert_code(resp, 0)
        data = resp.json()["data"]

        all_methods = data.get("allMethods", [])
        assert len(all_methods) > 0, "应该返回支付方式"

        method = all_methods[0]
        assert "methodCode" in method
        assert "displayName" in method
        assert "visible" in method
        assert "enabled" in method
        assert "displayOrder" in method

    def test_payment_methods_with_shipping_method(self, user_client, available_inventory_id):
        """携带运输方式刷新支付方式"""
        resp = user_client.get("/api/v3/checkout/payment-methods", params={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "shippingMethodCode": "INSTANT"
        })
        assert resp.status_code in [200, 400]
        assert_code(resp, 0)
        data = resp.json()["data"]

        assert "defaultMethodCode" in data

    def test_payment_methods_with_current_selection(self, user_client, available_inventory_id):
        """携带当前支付方式刷新"""
        resp = user_client.get("/api/v3/checkout/payment-methods", params={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "paymentMethodCode": "QRIS"
        })
        assert resp.status_code in [200, 400]
        assert_code(resp, 0)
        data = resp.json()["data"]

        # 验证返回的支付方式列表
        all_methods = data.get("allMethods", [])
        qris = next((m for m in all_methods if m["methodCode"] == "QRIS"), None)
        if qris:
            assert qris.get("selected") is True

    def test_payment_methods_display_order(self, user_client, available_inventory_id):
        """验证支付方式排序"""
        resp = user_client.get("/api/v3/checkout/payment-methods", params={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert resp.status_code in [200, 400]
        assert_code(resp, 0)
        data = resp.json()["data"]

        all_methods = data.get("allMethods", [])
        if len(all_methods) > 1:
            # 按 displayOrder 排序
            orders = [m.get("displayOrder", 0) for m in all_methods]
            assert orders == sorted(orders)

    def test_payment_methods_missing_inventory(self, user_client, available_inventory_id):
        """异常场景：缺少 inventoryId"""
        resp = user_client.get("/api/v3/checkout/payment-methods", params={
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    def test_payment_methods_missing_fulfillment(self, user_client, available_inventory_id):
        """异常场景：缺少 fulfillmentMethod"""
        resp = user_client.get("/api/v3/checkout/payment-methods", params={
            "inventoryId": available_inventory_id
        })
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)
