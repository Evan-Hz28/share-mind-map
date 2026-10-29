"""清空购物车"""
import pytest
from common.assertions import assert_status, assert_code


class TestDeleteProductCartClear:

    @pytest.mark.parametrize("expected_status, expected_code", [
        # 正常场景
        (200, 0),
    ])
    def test_delete_product_cart_clear(self, user_client, expected_status, expected_code):
        """[DELETE] /v2/product/cart/clear - 清空购物车"""
        resp = user_client.delete("/api/v2/product/cart/clear")
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
