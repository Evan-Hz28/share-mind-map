"""[POST] /api/v3/checkout/quote - Checkout 价格试算

统一返回账单、优惠券抵扣和当前金额下的支付方式。
未选择地址/门店时返回预估结果；试算不创建订单、不锁券，最终以下单接口校验为准。

测试场景：
- 1.1 正常场景：HOME_DELIVERY 配送方式试算
- 1.2 正常场景：IN_STORE_PICKUP 自提方式试算
- 1.3 正常场景：使用优惠券试算
- 1.4 异常场景：商品不存在
- 1.5 异常场景：地址不存在
- 1.6 异常场景：缺少必填参数
"""
import pytest
from common.assertions import assert_status, assert_code


class TestPostV3CheckoutQuote:

    # ==================== 1.1 正常场景：HOME_DELIVERY ====================

    def test_quote_home_delivery_basic(self, user_client):
        """HOME_DELIVERY 配送方式基础试算"""
        from common.inventory_helper import get_available_product_with_retry
        
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": product["id"],
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        
        # 校验返回结构
        assert "paymentDetail" in data
        assert "paymentMethods" in data
        
        # 校验 paymentDetail 字段
        payment_detail = data["paymentDetail"]
        assert "productAmount" in payment_detail
        assert "totalAmount" in payment_detail
        assert "shippingFee" in payment_detail

    def test_quote_home_delivery_with_address(self, user_client):
        """HOME_DELIVERY 指定地址试算"""
        from common.inventory_helper import get_available_product_with_retry
        
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        # 先获取用户地址
        addr_resp = user_client.get("/api/v3/user/addresses")
        if addr_resp.status_code != 200 or not addr_resp.json().get("data", {}).get("addresses"):
            pytest.skip("用户没有地址")
        
        addresses = addr_resp.json()["data"]["addresses"]
        address_id = addresses[0]["id"]
        
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": product["id"],
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": address_id
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        
        # 校验返回结构
        assert "paymentDetail" in data
        assert "paymentMethods" in data

    # ==================== 1.2 正常场景：IN_STORE_PICKUP ====================

    def test_quote_in_store_pickup_basic(self, user_client):
        """IN_STORE_PICKUP 自提方式试算"""
        from common.inventory_helper import get_available_product_with_retry
        
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": product["id"],
            "fulfillmentMethod": "IN_STORE_PICKUP"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        
        assert "paymentDetail" in data
        assert "paymentMethods" in data

    # ==================== 1.3 正常场景：使用优惠券 ====================

    def test_quote_with_voucher(self, user_client):
        """使用优惠券试算"""
        from common.inventory_helper import get_available_product_with_retry
        
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": product["id"],
            "fulfillmentMethod": "HOME_DELIVERY",
            "voucherIds": ["VCHR_001"]
        })
        # 优惠券可能无效，只校验接口能正常响应
        assert resp.status_code in [200, 400]
        if resp.status_code == 200:
            assert resp.json()["code"] == 0

    def test_quote_with_payment_method(self, user_client):
        """指定支付方式试算"""
        from common.inventory_helper import get_available_product_with_retry
        
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": product["id"],
            "fulfillmentMethod": "HOME_DELIVERY",
            "paymentMethodCode": "GOPAY"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        
        # 校验 paymentMethods 结构
        payment_methods = data.get("paymentMethods", {})
        assert "allMethods" in payment_methods or "recommendedMethods" in payment_methods

    # ==================== 1.4 异常场景：商品不存在 ====================

    def test_quote_product_not_found(self, user_client):
        """商品不存在返回错误"""
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": "NONEXISTENT-PRODUCT-12345",
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] != 0

    # ==================== 1.5 异常场景：地址不存在 ====================

    def test_quote_address_not_found(self, user_client):
        """地址不存在返回错误"""
        from common.inventory_helper import get_available_product_with_retry
        
        product = get_available_product_with_retry(user_client, max_retries=5)
        if not product:
            pytest.skip("没有可用的测试商品")
        
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": product["id"],
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": "NONEXISTENT-ADDRESS-12345"
        })
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] != 0

    # ==================== 1.6 异常场景：缺少必填参数 ====================

    def test_quote_missing_inventory_id(self, user_client):
        """缺少 inventoryId 返回错误"""
        resp = user_client.post("/api/v3/checkout/quote", json={
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] != 0

    def test_quote_missing_fulfillment_method(self, user_client):
        """缺少 fulfillmentMethod 返回错误"""
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": "inv_123"
        })
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] != 0

    def test_quote_invalid_fulfillment_method(self, user_client):
        """无效的 fulfillmentMethod 返回错误"""
        resp = user_client.post("/api/v3/checkout/quote", json={
            "inventoryId": "inv_123",
            "fulfillmentMethod": "INVALID_METHOD"
        })
        assert resp.status_code in [200, 400]
        assert resp.json()["code"] != 0

    # ==================== 未登录场景 ====================

    def test_quote_unauthorized(self, public_client):
        """未登录访问返回 401"""
        resp = public_client.post("/api/v3/checkout/quote", json={
            "inventoryId": "inv_123",
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert resp.status_code in [401, 400]
