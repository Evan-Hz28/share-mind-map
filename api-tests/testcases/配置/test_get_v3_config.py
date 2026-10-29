"""获取应用配置"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetV3Config:

    @pytest.mark.parametrize("expected_status, expected_code", [
        # 正常场景
        (200, 0),
    ])
    def test_get_v3_config(self, user_client, expected_status, expected_code):
        """[GET] /v3/config - 获取应用配置"""
        resp = user_client.get("/api/v3/config")
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
