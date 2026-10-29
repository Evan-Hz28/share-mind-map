"""[GET] /api/v3/search/product/list - 搜索商品"""
import pytest
from common.assertions import assert_status, assert_code

class TestGetV3SearchProductList:
    @pytest.mark.parametrize("params, expected_status, expected_code", [
        ({"keyword": "iphone", "page": "1", "size": "5"}, 200, 0),
        ({"keyword": "samsung", "page": "1", "size": "5"}, 200, 0),
        # 空关键词返回推荐
        ({"keyword": "", "page": "1", "size": "5"}, 200, 0),
        # 无结果的关键词
        ({"keyword": "zzzznonexistent", "page": "1", "size": "5"}, 200, 0),
    ])
    def test_get_v3_search_product_list(self, public_client, params, expected_status, expected_code):
        resp = public_client.get("/api/v3/search/product/list", params=params)
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)


class TestGetV3SearchProductListByInventoryId:
    """通过 inventory_id 搜索商品（服务端新功能）"""

    @pytest.mark.parametrize("params, expected_status, expected_code", [
        # 通过 inventory_id 搜索（格式：TEST-XXXX 或 KRIDPXXXXXX）
        ({"keyword": "TEST-0227", "page": "1", "size": "5"}, 200, 0),
        ({"keyword": "TEST-0433", "page": "1", "size": "5"}, 200, 0),
        # KRIDP 格式的 inventory_id
        ({"keyword": "KRIDP00007847", "page": "1", "size": "5"}, 200, 0),
        # 不存在的 inventory_id（返回空结果，HTTP 200）
        ({"keyword": "TEST-999999", "page": "1", "size": "5"}, 200, 0),
        # 格式错误的 inventory_id
        ({"keyword": "INVALID-ID", "page": "1", "size": "5"}, 200, 0),
    ])
    def test_search_by_inventory_id(self, public_client, params, expected_status, expected_code):
        resp = public_client.get("/api/v3/search/product/list", params=params)
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
