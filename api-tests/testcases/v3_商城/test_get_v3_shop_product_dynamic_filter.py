"""[GET] /api/v3/shop/product/dynamic_filter - 动态筛选项"""
import pytest
from common.assertions import assert_status, assert_code

class TestGetV3ShopProductDynamicFilter:
    @pytest.mark.parametrize("params, expected_status, expected_code", [
        ({}, 200, 0),
        ({"model": "iPhone 11"}, 200, 0),
        ({"condition": "Good"}, 200, 0),
        ({"price_min": "1000000", "price_max": "5000000"}, 200, 0),
        ({"model": "iPhone 11", "storage": "128GB", "condition": "Good"}, 200, 0),
    ])
    def test_get_v3_shop_product_dynamic_filter(self, public_client, params, expected_status, expected_code):
        resp = public_client.get("/api/v3/shop/product/dynamic_filter", params=params)
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
