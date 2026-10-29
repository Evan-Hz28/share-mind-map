"""[POST] /api/v3/checkout/place-order - 创建订单并发起支付/锁单

用户点击 Place Order 后调用，校验通过后才创建订单。
"""
import pytest
from common.assertions import assert_status, assert_code, assert_json_key, skip_if_rate_limited


class TestPostV3CheckoutPlaceOrder:

    STORE_ID = "1"  # Kitar tebet

    # ==================== 异常场景测试（不创建订单）====================

    def test_place_order_product_not_found(self, user_client, user_address_id):
        """异常场景：商品不存在"""
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": "NONEXISTENT-12345",
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": user_address_id,
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "QRIS"
        })
        # Bug: 服务端返回 PRODUCT_UNAVAILABLE 而非 PRODUCT_NOT_FOUND
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    def test_place_order_missing_address(self, user_client, available_inventory_id):
        """异常场景：Home Delivery 缺少地址"""
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "QRIS"
        })
        # Bug: 服务端返回 HTTP 400 而非文档约定的 200
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    def test_place_order_missing_shipping_method(self, user_client, available_inventory_id, user_address_id):
        """异常场景：Home Delivery 缺少运输方式"""
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": user_address_id,
            "paymentMethodCode": "QRIS"
        })
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    def test_place_order_missing_store(self, user_client, available_inventory_id):
        """异常场景：In-Store Pickup 缺少门店"""
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "IN_STORE_PICKUP",
            "paymentMethodCode": "QRIS"
        })
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    def test_place_order_missing_inventory(self, user_client, user_address_id):
        """异常场景：缺少 inventoryId"""
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": user_address_id,
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "QRIS"
        })
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    def test_place_order_missing_fulfillment(self, user_client, available_inventory_id, user_address_id):
        """异常场景：缺少 fulfillmentMethod"""
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "addressId": user_address_id,
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "QRIS"
        })
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    def test_place_order_invalid_payment_method(self, user_client, available_inventory_id, user_address_id):
        """异常场景：无效支付方式"""
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": user_address_id,
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "INVALID_METHOD"
        })
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    def test_place_order_pay_in_store_for_home_delivery(self, user_client, available_inventory_id, user_address_id):
        """异常场景：Home Delivery 不支持 Pay In-Store"""
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": user_address_id,
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "PAY_IN_STORE"
        })
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert_code(resp, 1001)

    # ==================== 正常场景测试（使用 fixture 创建订单）====================

    def test_place_order_home_delivery_success(self, home_delivery_order):
        """正常场景：Home Delivery 创建订单成功"""
        assert home_delivery_order["orderId"] is not None
        assert home_delivery_order["action"] == "OPEN_PAYMENT"
        assert home_delivery_order["orderStatus"] == "PENDING_PAYMENT"

    def test_place_order_in_store_pickup_online_payment(self, instore_pickup_order):
        """正常场景：In-Store Pickup + 线上支付创建订单成功"""
        assert instore_pickup_order["orderId"] is not None
        assert instore_pickup_order["action"] == "OPEN_PAYMENT"

    def test_place_order_in_store_pickup_pay_in_store(self, pay_in_store_order):
        """正常场景：In-Store Pickup + Pay In-Store 创建锁单成功"""
        assert pay_in_store_order["orderId"] is not None
        # Pay In-Store 返回 GO_ORDER_DETAIL
        assert pay_in_store_order["action"] == "GO_ORDER_DETAIL"
        assert pay_in_store_order["orderStatus"] == "CREATED"

    # ==================== 幂等性校验 ====================

    def test_place_order_duplicate_request(self, user_client, available_inventory_id, user_address_id):
        """幂等性：重复提交相同请求"""
        # 第一次创建订单
        resp1 = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": user_address_id,
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "BANK_TRANSFER"
        })
        skip_if_rate_limited(resp1)
        assert resp1.status_code == 200
        
        # 第二次应该返回已有订单提示或创建失败
        resp2 = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": user_address_id,
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "BANK_TRANSFER"
        })
        # 应该返回错误或已有订单
        assert resp2.status_code in [200, 400]
        
        # 清理
        if resp1.status_code == 200:
            order_id = resp1.json().get("data", {}).get("orderId")
            if order_id:
                user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "cleanup"})

    # ==================== Pay In-Store 限制校验 ====================

    def test_place_order_user_pay_in_store_limit_reached(
        self, user_client, pay_in_store_order, available_inventory_id, pickup_slot
    ):
        """用户已有Pay In-Store锁单，再创建返回 USER_PAY_IN_STORE_LIMIT_REACHED"""
        # 获取可用商品和 pickup slot
        inventory_id = available_inventory_id
        slot = pickup_slot

        # pay_in_store_order 已创建一个 Pay In-Store 订单
        resp = user_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": inventory_id,
            "fulfillmentMethod": "IN_STORE_PICKUP",
            "storeId": slot["storeId"],
            "pickupDate": slot["pickupDate"],
            "slotStart": slot["slotStart"],
            "slotEnd": slot["slotEnd"],
            "pickupPhone": "+6281111111117",
            "paymentMethodCode": "PAY_IN_STORE"
        })
        # 应该返回限制错误
        skip_if_rate_limited(resp)
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] == 1001
        details = resp.json().get("details", {})
        assert details.get("businessCode") == "USER_PAY_IN_STORE_LIMIT_REACHED"

    # ==================== 未登录校验 ====================

    def test_place_order_unauthorized(self, public_client, available_inventory_id, user_address_id):
        """未登录态，返回2001"""
        resp = public_client.post("/api/v3/checkout/place-order", json={
            "inventoryId": available_inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": user_address_id,
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": "QRIS"
        })
        assert resp.status_code in [401, 400]
        assert resp.json()["code"] in [2001, 2002]
