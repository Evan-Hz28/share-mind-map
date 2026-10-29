"""[POST] /api/v3/auth/check-access-token - 检查 token(v3)"""
import pytest
from common.assertions import assert_status, assert_code

class TestPostV3AuthCheckAccessToken:
    @pytest.mark.parametrize("expected_status, expected_code", [(400, 2002)])
    def test_post_v3_auth_check_access_token(self, public_client, expected_status, expected_code):
        resp = public_client.post("/api/v3/auth/check-access-token")
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
