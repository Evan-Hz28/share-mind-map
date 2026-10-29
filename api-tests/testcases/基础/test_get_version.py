"""获取App版本信息"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetVersion:

    @pytest.mark.parametrize("expected_status, expected_code", [
        # 正常场景
        (200, 0),
    ])
    def test_get_version(self, public_client, expected_status, expected_code):
        """[GET] /v2/version - 获取App版本信息"""
        resp = public_client.get("/api/v2/version")
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
