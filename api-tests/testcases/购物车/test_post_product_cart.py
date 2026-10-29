"""[POST] /api/v2/product/cart - 添加购物车"""
import pytest
from common.assertions import assert_status, assert_code

class TestPostProductCart:
    @pytest.mark.parametrize("body, expected_statuses, expected_code", [
        # 异常：缺少 inventory_id
        ({"product_id": "TEST-0397", "quantity": 1}, (400, 200), 1001),
        # 异常：空 body
        ({}, (400, 200), 1001),
        # 异常：quantity 为 0（服务端先校验商品，可能返回 200 + 业务错误码）
        ({"product_id": "TEST-0397", "inventory_id": "1", "quantity": 0}, (400, 200), 1001),
    ])
    def test_post_product_cart(self, user_client, body, expected_statuses, expected_code):
        resp = user_client.post("/api/v2/product/cart", json=body)
        assert resp.status_code in expected_statuses, resp.text
        assert_code(resp, expected_code)
