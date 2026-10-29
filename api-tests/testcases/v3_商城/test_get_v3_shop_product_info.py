"""[GET] /api/v3/shop/product/info - 商品详情（不含推荐）"""
import pytest
from common.assertions import assert_status, assert_code

PRODUCT_FIELDS = ["id", "title", "subtitle", "price", "original_price", "thumbnail_url",
                  "sales_count", "rating", "is_available", "is_favorite", "medias",
                  "inspection_report", "freebies", "shipping_channels"]


@pytest.fixture(scope="module")
def product_id(public_client):
    """动态取一个在售商品，避免硬编码库存 ID 失效"""
    resp = public_client.get("/api/v3/shop/product/list", params={"page": "1", "pageSize": "1"})
    products = resp.json().get("data", {}).get("products", [])
    if not products:
        pytest.skip("商品列表为空")
    return products[0]["id"]


class TestGetV3ShopProductInfo:
    @pytest.mark.parametrize("params, expected_status, expected_code", [
        ({}, 400, 1001),
        ({"id": "NONEXISTENT"}, 200, 1001),
    ])
    def test_get_v3_shop_product_info(self, public_client, params, expected_status, expected_code):
        resp = public_client.get("/api/v3/shop/product/info", params=params)
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)

    def test_get_v3_shop_product_info_success(self, public_client, product_id):
        resp = public_client.get("/api/v3/shop/product/info", params={"id": product_id})
        assert_status(resp, 200)
        assert_code(resp, 0)

    def test_info_fields_complete(self, public_client, product_id):
        resp = public_client.get("/api/v3/shop/product/info", params={"id": product_id})
        data = resp.json()["data"]
        for f in PRODUCT_FIELDS:
            assert f in data, f"缺少字段: {f}"

    def test_info_not_contain_recommended(self, public_client, product_id):
        resp = public_client.get("/api/v3/shop/product/info", params={"id": product_id})
        data = resp.json()["data"]
        assert "recommended_products" not in data
