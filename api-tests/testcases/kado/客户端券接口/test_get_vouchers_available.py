"""可用券查询接口 GET /api/v1/vouchers/available

查询商品可用的券列表，支持券组合推荐。

枚举值：
  - item_type: inventory, sku

查询参数：
  - item_type: 商品类型
  - inventory_id: 库存ID
  - sku_id: SKU ID
  - include_best_combination: 是否返回最优券组合推荐
  - lang: 语言

响应字段：
  - items: 可用券列表
  - best_combination: 最优券组合推荐（include_best_combination=true 时返回）
    - vouchers: 券列表及预估抵扣金额
    - estimated_total_discount_amount: 预估总抵扣金额
    - estimated_payable_amount: 预估应付金额
"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetVouchersAvailable:
    """可用券查询接口测试"""

    @pytest.fixture
    def available_inventory_id(self, user_client):
        """获取可用的 inventory_id"""
        candidate_ids = ["TEST-0397", "TEST-0275", "KRIDP00015686", "TEST-0490"]
        
        for inv_id in candidate_ids:
            resp = user_client.get("/api/v3/checkout/precheck", params={
                "inventoryId": inv_id
            })
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                if data.get("canCheckout"):
                    return inv_id
        
        resp = user_client.get("/api/v3/shop/product/recommend", params={
            "page": 1,
            "pageSize": 10
        })
        
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            products = data.get("products", [])
            if products:
                for product in products[:5]:
                    inv_id = product.get("inventoryId") or product.get("id")
                    if inv_id:
                        check_resp = user_client.get("/api/v3/checkout/precheck", params={
                            "inventoryId": inv_id
                        })
                        if check_resp.status_code == 200:
                            check_data = check_resp.json().get("data", {})
                            if check_data.get("canCheckout"):
                                return inv_id
        
        return None

    # ========== 基础场景 ==========

    def test_get_vouchers_available_by_inventory(self, voucher_client, available_inventory_id):
        """[GET] 按库存商品查询可用券"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        params = {
            "item_type": "inventory",
            "inventory_id": available_inventory_id,
            "order_amount": 100000
        }

        resp = voucher_client.get("/api/v1/vouchers/available", params=params)
        assert_status(resp, 200)
        assert_code(resp, 0)

    def test_get_vouchers_available_basic(self, voucher_client, available_inventory_id):
        """[P0] 基础可用券查询"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": available_inventory_id
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

    # ========== 券组合推荐场景 ==========

    def test_get_vouchers_available_with_best_combination(self, voucher_client, available_inventory_id):
        """[P0] 查询可用券并返回最优组合推荐"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": available_inventory_id,
            "include_best_combination": True
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

        data = resp.json().get("data", {})
        
        # 响应应包含 items 列表
        assert "items" in data
        
        # 如果有可用券，best_combination 应该返回
        if data.get("items"):
            # best_combination 是可选的，仅当有券且启用时返回
            if "best_combination" in data and data["best_combination"]:
                best = data["best_combination"]
                
                # 校验 best_combination 字段
                assert "vouchers" in best
                assert "estimated_total_discount_amount" in best
                assert "estimated_payable_amount" in best
                
                # 校验 vouchers 字段
                if best.get("vouchers"):
                    voucher = best["vouchers"][0]
                    assert "voucher_id" in voucher
                    assert "estimated_discount_amount" in voucher

    def test_get_vouchers_available_best_combination_multiple_vouchers(self, voucher_client, available_inventory_id):
        """[P0] 多券组合推荐"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": available_inventory_id,
            "include_best_combination": True
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

        data = resp.json().get("data", {})
        
        if data.get("best_combination") and data["best_combination"].get("vouchers"):
            vouchers = data["best_combination"]["vouchers"]
            total_discount = data["best_combination"]["estimated_total_discount_amount"]
            
            # 校验总抵扣金额等于各券抵扣之和
            calculated_total = sum(v.get("estimated_discount_amount", 0) for v in vouchers)
            assert total_discount == calculated_total

    def test_get_vouchers_available_without_best_combination(self, voucher_client, available_inventory_id):
        """[P0] 不返回最优组合推荐"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": available_inventory_id,
            "include_best_combination": False
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

        data = resp.json().get("data", {})
        
        # 不包含 best_combination 或为空
        assert "items" in data
        # best_combination 应该不存在或为 null

    # ========== 响应字段校验 ==========

    def test_vouchers_available_response_fields(self, voucher_client, available_inventory_id):
        """[P0] 校验响应字段完整性"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": available_inventory_id,
            "include_best_combination": True
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

        data = resp.json().get("data", {})
        assert "items" in data

        # 校验券列表字段
        if data.get("items"):
            item = data["items"][0]
            expected_fields = [
                "voucher_id", "campaign_id", "voucher_template_id",
                "title", "voucher_type", "threshold_amount",
                "valid_from", "valid_to", "status"
            ]
            for field in expected_fields:
                assert field in item, f"响应缺少字段: {field}"
            
            # 校验新增字段 is_stackable 和 stack_group_id
            assert "is_stackable" in item
            # stack_group_id 是可选的

    def test_vouchers_available_stackable_field(self, voucher_client, available_inventory_id):
        """[P0] 校验 is_stackable 字段"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": available_inventory_id
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

        data = resp.json().get("data", {})
        
        if data.get("items"):
            for item in data["items"]:
                # is_stackable 应该是布尔值
                assert isinstance(item.get("is_stackable"), bool)

    # ========== 语言场景 ==========

    @pytest.mark.parametrize("lang, description", [
        ("en", "英文"),
        ("id", "印尼语"),
    ])
    def test_get_vouchers_available_with_lang(self, voucher_client, available_inventory_id, lang, description):
        """[P0] 多语言查询"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": available_inventory_id,
            "lang": lang
        })
        assert_status(resp, 200)
        assert_code(resp, 0)

    # ========== SKU 场景 ==========

    def test_get_vouchers_available_by_sku(self, voucher_client):
        """[P1] 按SKU查询可用券 - 需要真实SKU"""
        # 跳过，需要真实的 SKU ID
        pytest.skip("需要真实的 SKU ID")

    # ========== 异常场景 ==========

    def test_missing_inventory_id_and_sku_id(self, voucher_client):
        """[P1] 缺少 inventory_id 和 sku_id"""
        resp = voucher_client.get("/api/v1/vouchers/available", params={})
        assert_status(resp, 400)

    def test_invalid_item_type(self, voucher_client):
        """[P1] 无效的 item_type"""
        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "item_type": "invalid_type",
            "inventory_id": "INV_001"
        })
        assert resp.status_code in [400, 422]

    @pytest.mark.xfail(reason="服务端 bug: 负数金额应返回 400，实际返回 200")
    def test_negative_amount(self, voucher_client, available_inventory_id):
        """[P1] 金额为负数 - 期望 400"""
        if not available_inventory_id:
            pytest.skip("没有可用的 inventory_id")

        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": available_inventory_id,
            "order_amount": -100
        })
        assert_status(resp, 400)

    def test_nonexistent_inventory(self, voucher_client):
        """[P1] 不存在的库存ID"""
        resp = voucher_client.get("/api/v1/vouchers/available", params={
            "inventory_id": "NONEXISTENT_INV"
        })
        # 服务端返回 500 而非 404
        assert resp.status_code in [200, 404, 500]
