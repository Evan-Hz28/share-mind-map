"""[POST] /api/v3/auth/refresh-token - 刷新 token(v3)"""
import pytest
from common.assertions import assert_status, assert_code

class TestPostV3AuthRefreshToken:
    @pytest.mark.parametrize("body, expected_status, expected_code", [
        ({}, 400, 1001),
        ({"refresh_token": "invalid"}, 400, 1001),
    ])
    def test_post_v3_auth_refresh_token(self, public_client, body, expected_status, expected_code):
        resp = public_client.post("/api/v3/auth/refresh-token", json=body)
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
