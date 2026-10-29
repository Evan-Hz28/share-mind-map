"""[GET] /api/v2/product/cart - 购物车列表"""
import pytest
from common.assertions import assert_status, assert_code

class TestGetProductCart:
    @pytest.mark.parametrize("expected_status, expected_code", [(200, 0)])
    def test_get_product_cart(self, user_client, expected_status, expected_code):
        resp = user_client.get("/api/v2/product/cart")
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
        assert resp.json().get("data") is not None, "data 不应为 None"
