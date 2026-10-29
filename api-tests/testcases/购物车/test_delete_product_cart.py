"""[DELETE] /api/v2/product/cart - 删除购物车商品"""
import pytest
from common.assertions import assert_status, assert_code

class TestDeleteProductCart:
    @pytest.mark.parametrize("expected_status, expected_code", [(400, 1001)])
    def test_delete_product_cart(self, user_client, expected_status, expected_code):
        resp = user_client.delete("/api/v2/product/cart")
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
