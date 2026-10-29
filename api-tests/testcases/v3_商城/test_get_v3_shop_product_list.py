"""[GET] /api/v3/shop/product/list - 商品列表"""
import pytest
from common.assertions import assert_status, assert_code

LIST_ITEM_FIELDS = ["id", "title", "price", "originalPrice", "imageUrl", "condition",
                    "rating", "salesCount", "tags", "color", "purchaseChannel", "clickUrl"]

class TestGetV3ShopProductList:
    @pytest.mark.parametrize("params, expected_status, expected_code", [
        ({"page": "1", "pageSize": "10"}, 200, 0),
        ({"page": "1", "pageSize": "2"}, 200, 0),
        ({"page": "1", "pageSize": "10", "model": "iPhone 11"}, 200, 0),
        ({"page": "1", "pageSize": "10", "condition": "Good"}, 200, 0),
        ({"page": "1", "pageSize": "10", "storage": "128GB"}, 200, 0),
        ({"page": "1", "pageSize": "10", "model": "iPhone 11", "condition": "Good", "storage": "128GB"}, 200, 0),
        ({"page": "9999", "pageSize": "10"}, 200, 0),
    ])
    def test_get_v3_shop_product_list(self, public_client, params, expected_status, expected_code):
        resp = public_client.get("/api/v3/shop/product/list", params=params)
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)

    def test_list_structure(self, public_client):
        resp = public_client.get("/api/v3/shop/product/list", params={"page": "1", "pageSize": "2"})
        data = resp.json()["data"]
        assert "products" in data, "缺少 products"
        assert "hasMore" in data, "缺少 hasMore"
        assert "source" in data, "缺少 source"
        if data["products"]:
            item = data["products"][0]
            for f in LIST_ITEM_FIELDS:
                assert f in item, f"商品列表项缺少字段: {f}"
