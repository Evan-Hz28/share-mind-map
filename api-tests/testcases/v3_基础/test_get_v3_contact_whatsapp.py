"""获取 WhatsApp 联系号码"""

import pytest

from common.assertions import assert_code, assert_status


class TestGetV3ContactWhatsapp:
    @pytest.mark.parametrize(
        "expected_status, expected_code",
        [
            # 正常场景
            (200, 0),
        ],
    )
    def test_get_v3_contact_whatsapp(self, user_client, expected_status, expected_code):
        """[GET] /v3/contact/whatsapp - 获取 WhatsApp 联系号码"""
        resp = user_client.get("/api/v3/contact/whatsapp")
        assert_status(resp, expected_status)
        assert_code(resp, expected_code)
