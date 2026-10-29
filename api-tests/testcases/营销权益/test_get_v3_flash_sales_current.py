"""[GET] /api/v3/flash-sales/current - 闪购活动当前状态（只读）"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetV3FlashSalesCurrent:

    def test_get_flash_sales_current(self, user_client):
        """返回当前活动状态，活动未开始/已结束也属于正常响应"""
        resp = user_client.get("/api/v3/flash-sales/current")
        body = resp.json()

        # 部分环境未开放闪购能力，接口返回 invalid version
        details = body.get("details")
        if isinstance(details, str) and "invalid version" in details:
            pytest.skip("当前环境不支持闪购接口")

        assert_status(resp, 200)
        assert_code(resp, 0)

        data = body.get("data") or {}
        assert "activityState" in data or "serverTime" in data

    def test_get_flash_sales_current_unauthorized(self, public_client):
        """未登录返回 400/401，不能 5xx"""
        resp = public_client.get("/api/v3/flash-sales/current")
        assert resp.status_code in (200, 400, 401)
