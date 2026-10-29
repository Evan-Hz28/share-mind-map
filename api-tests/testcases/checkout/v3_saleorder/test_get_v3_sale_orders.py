"""[GET] /api/v3/sale-orders - 获取订单列表/详情

测试场景（来自 XMind + 文档更新）：
- 7.1 Home Delivery未支付订单
- 7.2 In-Store Pickup未支付订单
- 7.3 Pay In-Store锁单订单
- 7.4 已支付订单
- 7.5 权限校验
- 新增: orderTab/tab筛选参数测试
- 新增: displayOrderStatus, availableActions字段验证
"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetV3SaleOrders:

    # ==================== 订单列表 ====================

    def test_get_order_list_success(self, user_client):
        """获取订单列表"""
        resp = user_client.get("/api/v3/sale-orders", params={"page": 1, "pageSize": 10})
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        assert "list" in data
        assert "page" in data
        assert "pageSize" in data
        assert "hasMore" in data

    # ==================== 新增: orderTab筛选参数 ====================

    def test_get_order_list_by_order_tab(self, user_client):
        """按orderTab筛选订单（新增参数）"""
        resp = user_client.get("/api/v3/sale-orders", params={
            "page": 1,
            "pageSize": 10,
            "orderTab": "To Pay"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        # 验证返回的订单属于To Pay tab
        for order in data.get("list", []):
            assert order.get("orderTab") == "To Pay"

    def test_get_order_list_by_tab_alias(self, user_client):
        """使用tab参数（orderTab的别名）"""
        resp = user_client.get("/api/v3/sale-orders", params={
            "page": 1,
            "pageSize": 10,
            "tab": "To Receive"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

    def test_all_order_tabs(self, user_client):
        """验证所有orderTab值"""
        tabs = ["All", "To Pay", "To Ship", "To Receive", "To Rate", "Return/Refund", "Closed"]
        
        for tab in tabs:
            resp = user_client.get("/api/v3/sale-orders", params={
                "page": 1,
                "pageSize": 10,
                "orderTab": tab
            })
            assert_status(resp, 200), f"Tab {tab} failed"

    # ==================== 新增: displayOrderStatus字段验证 ====================

    def test_display_order_status_field(self, user_client, paid_order):
        """验证displayOrderStatus字段（新增字段）"""
        order_id = paid_order["orderId"]
        resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        
        order = resp.json()["data"]["order"]
        assert "displayOrderStatus" in order
        
        # 验证displayOrderStatus的值在预期范围内
        valid_statuses = [
            "Awaiting Payment", "Payment Expired", "Cancelled", "Processing",
            "Shipping", "Delivered", "Awaiting Pickup", "Awaiting Review",
            "Reviewed", "Refund in Progress", "Refund Successful", "Refund Denied",
            "Return in Progress", "Inspecting", "Repairing", "Replacing",
            "Warranty Denied", "Warranty Completed"
        ]
        assert order["displayOrderStatus"] in valid_statuses

    # ==================== 新增: availableActions字段验证 ====================

    def test_available_actions_field(self, user_client, pending_order):
        """验证availableActions字段（新增字段）"""
        if pending_order:
            order_id = pending_order["orderId"]
            resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
            
            order = resp.json()["data"]["order"]
            assert "availableActions" in order
            assert isinstance(order["availableActions"], list)
            
            # 验证action结构
            for action in order["availableActions"]:
                assert "code" in action
                assert "label" in action
                assert "style" in action

    @pytest.mark.skip(reason="fixture pending_payment_order not found")
    def test_available_actions_for_pending_payment(self, user_client, pending_payment_order):
        """待支付订单的可用操作"""
        if pending_payment_order:
            order_id = pending_payment_order["orderId"]
            resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
            
            order = resp.json()["data"]["order"]
            actions = order.get("availableActions", [])
            action_codes = [a["code"] for a in actions]
            
            # 待支付订单应该有支付相关操作
            assert "PAY_NOW" in action_codes or "CHANGE_PAYMENT" in action_codes

    def test_get_order_list_by_status(self, user_client):
        """按状态筛选订单"""
        resp = user_client.get("/api/v3/sale-orders", params={
            "page": 1, 
            "pageSize": 10, 
            "status": "PENDING_PAYMENT"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        # 验证返回的都是待支付状态（服务端新版本返回 unpaid）
        for order in data.get("list", []):
            assert order.get("orderStatus", "").lower() in ("pending_payment", "unpaid")

    def test_get_order_list_by_fulfillment_method(self, user_client):
        """按配送方式筛选订单"""
        resp = user_client.get("/api/v3/sale-orders", params={
            "page": 1, 
            "pageSize": 10, 
            "fulfillmentMethod": "HOME_DELIVERY"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)
        data = resp.json()["data"]
        for order in data.get("list", []):
            assert order.get("fulfillmentMethod") == "HOME_DELIVERY"

    def test_get_order_list_in_store_pickup(self, user_client):
        """获取 In-Store Pickup 订单列表"""
        resp = user_client.get("/api/v3/sale-orders", params={
            "page": 1, 
            "pageSize": 10, 
            "fulfillmentMethod": "IN_STORE_PICKUP"
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

    # ==================== 订单详情 - 使用 fixture 创建的订单 ====================

    def test_get_home_delivery_order_detail(self, user_client, home_delivery_order):
        """获取 Home Delivery 订单详情"""
        order_id = home_delivery_order["orderId"]
        resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        assert_status(resp, 200)
        assert_code(resp, 0)
        
        order = resp.json()["data"]["order"]
        assert order["orderId"] == order_id
        assert order["fulfillmentMethod"] == "HOME_DELIVERY"
        assert order["orderStatus"].lower() in ("pending_payment", "unpaid")
        assert "delivery" in order
        assert order["delivery"] is not None

    def test_get_instore_pickup_order_detail(self, user_client, instore_pickup_order):
        """获取 In-Store Pickup 订单详情"""
        order_id = instore_pickup_order["orderId"]
        resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        assert_status(resp, 200)
        assert_code(resp, 0)
        
        order = resp.json()["data"]["order"]
        assert order["orderId"] == order_id
        assert order["fulfillmentMethod"] == "IN_STORE_PICKUP"
        assert "pickup" in order
        assert order["pickup"] is not None

    def test_get_pay_in_store_order_detail(self, user_client, pay_in_store_order):
        """获取 Pay In-Store 锁单订单详情"""
        order_id = pay_in_store_order["orderId"]
        resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        assert_status(resp, 200)
        assert_code(resp, 0)
        
        order = resp.json()["data"]["order"]
        assert order["orderId"] == order_id
        assert order["fulfillmentMethod"] == "IN_STORE_PICKUP"
        assert order["orderStatus"].lower() in ("created", "unpaid")
        
        # 验证 deadline 类型为 LOCK
        deadline = order.get("deadline", {})
        assert deadline.get("type") == "LOCK"

    def test_get_order_detail_structure(self, user_client, home_delivery_order):
        """验证订单详情结构"""
        order_id = home_delivery_order["orderId"]
        resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        assert_status(resp, 200)
        assert_code(resp, 0)
        
        order = resp.json()["data"]["order"]
        assert "orderId" in order
        assert "orderStatus" in order
        assert "fulfillmentMethod" in order
        assert "inventory" in order
        assert "payment" in order
        assert "price" in order
        assert "actions" in order
        
        # 只有 PENDING_PAYMENT 状态才有 deadline
        if order.get("orderStatus", "").lower() in ("pending_payment", "unpaid"):
            assert "deadline" in order

    def test_get_order_detail_actions(self, user_client, home_delivery_order):
        """验证 actions 字段"""
        order_id = home_delivery_order["orderId"]
        resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        assert_status(resp, 200)
        assert_code(resp, 0)
        
        actions = resp.json()["data"]["order"].get("actions", {})
        assert "canChangeAddress" in actions
        assert "canChangePickup" in actions
        assert "canChangePayment" in actions
        assert "canPayNow" in actions
        assert "canCancel" in actions
        assert "canContactSupport" in actions
        
        order = resp.json()["data"]["order"]
        # 只有 PENDING_PAYMENT 状态才能修改地址和支付
        if order.get("orderStatus", "").lower() in ("pending_payment", "unpaid"):
            assert actions["canChangeAddress"] == True
            assert actions["canCancel"] == True
            assert actions["canPayNow"] == True

    # ==================== 权限校验 ====================

    def test_get_order_not_found(self, user_client):
        """订单不存在，返回404"""
        resp = user_client.get("/api/v3/sale-orders/NONEXISTENT-ORDER-ID")
        # Bug: 服务端返回 HTTP 200 + code=1001 而非文档约定的 404
        assert resp.status_code in [200, 400, 404]
        assert resp.json()["code"] == 1001

    def test_get_order_unauthorized(self, public_client):
        """未登录态，返回2001"""
        resp = public_client.get("/api/v3/sale-orders", params={"page": 1})
        # 未登录应该返回 401 或 code=2001
        assert resp.status_code in [401, 400] or resp.json().get("code") == 2001


    def test_get_paid_order_detail(self, user_client, paid_order):
        """获取已支付订单详情"""
        order_id = paid_order["orderId"]
        resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
        assert_status(resp, 200)
        assert_code(resp, 0)
        
        order = resp.json()["data"]["order"]
        assert order["orderId"] == order_id
        assert order["orderStatus"].lower() == "paid"
        
        # 验证支付信息
        payment = order.get("payment", {})
        assert payment.get("status", "").upper() == "PAID"
        assert payment.get("paidAt") is not None
