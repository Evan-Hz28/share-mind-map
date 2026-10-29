"""[GET] /api/v3/user/address/{id} - 获取地址详情

测试要点:
1. 成功获取地址详情
2. 地址ID不存在
3. 未授权访问
4. 访问其他用户的地址
5. 地址ID格式错误
"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetUserAddressDetail:
    """获取地址详情测试"""

    def test_get_address_detail_success(self, user_client, test_address):
        """测试成功获取地址详情"""
        address_id = test_address["id"]
        resp = user_client.get(f"/api/v3/user/address/{address_id}")
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        
        # 验证返回的地址数据
        assert data["id"] == address_id
        assert "full_name" in data or "first_name" in data
        assert "phone" in data
        assert "city" in data
        assert "province" in data

    def test_get_address_detail_not_found(self, user_client):
        """测试地址ID不存在"""
        fake_id = "non-existent-address-id-12345"
        resp = user_client.get(f"/api/v3/user/address/{fake_id}")
        
        # 应该返回404或500
        assert resp.status_code in [404, 500]

    def test_get_address_detail_unauthorized(self, public_client, test_address):
        """测试未授权访问"""
        address_id = test_address["id"]
        resp = public_client.get(f"/api/v3/user/address/{address_id}")
        
        assert resp.status_code in (400, 401)

    def test_get_address_detail_other_user(self, user_client, other_user_address_id):
        """测试访问其他用户的地址 - 应该失败"""
        if not other_user_address_id:
            pytest.skip("无其他用户地址ID")
        
        resp = user_client.get(f"/api/v3/user/address/{other_user_address_id}")
        
        # 不应返回其他用户的地址
        assert resp.status_code in [404, 403, 500]

    def test_get_address_detail_invalid_id_format(self, user_client):
        """测试地址ID格式错误"""
        invalid_ids = ["", "   ", "null", "undefined"]
        
        for invalid_id in invalid_ids:
            resp = user_client.get(f"/api/v3/user/address/{invalid_id}")
            if invalid_id == "":
                # 完全空路径命中地址列表接口
                assert resp.status_code == 200
            else:
                assert resp.status_code in [400, 404, 500]

    def test_address_detail_contains_all_fields(self, user_client, test_address):
        """测试地址详情包含所有必要字段"""
        address_id = test_address["id"]
        resp = user_client.get(f"/api/v3/user/address/{address_id}")
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        
        # 必填字段
        required_fields = [
            "id", "user_id", "phone", "city",
            "province", "country", "zip"
        ]
        for field in required_fields:
            assert field in data, f"缺少必填字段: {field}"
        
        # 新版字段和旧版字段应至少存在一组
        has_new_fields = "full_name" in data and "detail_address" in data
        has_old_fields = "first_name" in data and "last_name" in data and "address1" in data
        assert has_new_fields or has_old_fields, "缺少地址详细字段"
