"""[POST] /api/v3/auth/verify-sms-code"""
import pytest
from common.assertions import assert_status, assert_code

class TestPostV3AuthVerifySmsCode:
    @pytest.mark.parametrize("body, expected_status, expected_codes", [
        ({"phone": "+6281111111117", "code": "666666"}, 200, (0,)),
        # 验证码错误/过期在不同环境可能返回 2005 或 2006
        ({"phone": "+6281111111117", "code": "000000"}, 200, (2005, 2006)),
        ({}, 400, (1001,)),
    ])
    def test_post_v3_auth_verify_sms_code(self, public_client, body, expected_status, expected_codes):
        resp = public_client.post("/api/v3/auth/verify-sms-code", json=body)
        assert_status(resp, expected_status)
        assert resp.json().get("code") in expected_codes
