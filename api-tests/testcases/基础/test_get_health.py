"""[GET] /health - 健康检查"""
import pytest
from common.assertions import assert_status

class TestGetHealth:
    def test_get_health(self, public_client):
        resp = public_client.get("/health")
        assert resp.status_code in (200, 204), f"健康检查失败: {resp.status_code}"
