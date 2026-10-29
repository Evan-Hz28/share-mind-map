"""获取商品推荐列表（V3）"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetV3HomeProductRecommend:

    @pytest.mark.parametrize("params, expected_status, expected_code", [
        # 正常场景
        ({"page": 1, "pageSize": 10, "label": ""}, 200, 0),
    ])
    def test_get_v3_home_product_recommend(self, user_client, params, expected_status, expected_code):
        """[GET] /v3/home/product/recommend - 获取商品推荐列表（V3）"""
        resp = user_client.get("/api/v3/home/product/recommend", params=params)
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
