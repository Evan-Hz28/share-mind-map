"""[GET] /api/v2/product/cart/validate - 购物车校验"""
import pytest
from common.assertions import assert_status, assert_code

class TestGetProductCartValidate:
    @pytest.mark.parametrize("expected_status, expected_code", [(200, 0)])
    def test_get_product_cart_validate(self, user_client, expected_status, expected_code):
        resp = user_client.get("/api/v2/product/cart/validate")
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
