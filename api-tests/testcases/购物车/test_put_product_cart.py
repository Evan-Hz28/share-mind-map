"""[PUT] /api/v2/product/cart/{id} - 更新购物车"""
import pytest
from common.assertions import assert_status, assert_code

class TestPutProductCart:
    @pytest.mark.parametrize("cart_id, body, expected_status, expected_code", [
        ("999", {"quantity": 1}, 500, 9000),
    ])
    def test_put_product_cart(self, user_client, cart_id, body, expected_status, expected_code):
        resp = user_client.put(f"/api/v2/product/cart/{cart_id}", json=body)
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
