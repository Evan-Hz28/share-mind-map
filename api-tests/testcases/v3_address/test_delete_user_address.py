"""[DELETE] /api/v3/user/address/{id} - 删除地址

测试要点:
1. 成功删除地址
2. 删除不存在的地址
3. 删除其他用户的地址
4. 未授权访问
5. 删除默认地址
6. 地址ID缺失
"""
import pytest
from common.assertions import assert_status, assert_code


class TestDeleteUserAddress:
    """删除地址测试"""

    def test_delete_address_success(self, user_client):
        """测试成功删除地址"""
        # 先创建一个测试地址
        create_payload = {
            "full_name": "To Be Deleted",
            "detail_address": "Jl. Delete Test No. 1",
            "phone": "+6281234567901",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "99999"
        }
        create_resp = user_client.post("/api/v3/user/address", json=create_payload)
        address_id = create_resp.json()["data"]["id"]
        
        # 删除地址
        resp = user_client.delete(f"/api/v3/user/address/{address_id}")
        
        assert_status(resp, 200)
        
        # 验证已删除
        get_resp = user_client.get(f"/api/v3/user/address/{address_id}")
        assert get_resp.status_code in [404, 500]

    def test_delete_nonexistent_address(self, user_client):
        """测试删除不存在的地址"""
        fake_id = "nonexistent-delete-id-99999"
        resp = user_client.delete(f"/api/v3/user/address/{fake_id}")
        
        # 应该返回错误
        assert resp.status_code in [404, 500]

    def test_delete_address_unauthorized(self, public_client, test_address):
        """测试未授权删除"""
        address_id = test_address["id"]
        resp = public_client.delete(f"/api/v3/user/address/{address_id}")
        
        assert resp.status_code in (400, 401)

    def test_delete_other_user_address(self, user_client, other_user_address_id):
        """测试删除其他用户的地址 - 应该失败"""
        if not other_user_address_id:
            pytest.skip("无其他用户地址ID")
        
        resp = user_client.delete(f"/api/v3/user/address/{other_user_address_id}")
        
        # 不应允许删除其他用户的地址
        assert resp.status_code in [403, 404, 500]

    def test_delete_default_address(self, user_client):
        """测试删除默认地址"""
        # 创建一个默认地址
        create_payload = {
            "full_name": "Default To Delete",
            "detail_address": "Jl. Default Delete",
            "phone": "+6281234567902",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "10101",
            "is_default": True
        }
        create_resp = user_client.post("/api/v3/user/address", json=create_payload)
        address_id = create_resp.json()["data"]["id"]
        
        # 删除默认地址
        resp = user_client.delete(f"/api/v3/user/address/{address_id}")
        
        # 应该成功删除
        assert_status(resp, 200)

    def test_delete_address_twice(self, user_client):
        """测试重复删除同一地址"""
        # 先创建地址
        create_payload = {
            "full_name": "Double Delete",
            "detail_address": "Jl. Double Delete",
            "phone": "+6281234567903",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "20202"
        }
        create_resp = user_client.post("/api/v3/user/address", json=create_payload)
        address_id = create_resp.json()["data"]["id"]
        
        # 第一次删除
        resp1 = user_client.delete(f"/api/v3/user/address/{address_id}")
        assert_status(resp1, 200)
        
        # 第二次删除应该失败
        resp2 = user_client.delete(f"/api/v3/user/address/{address_id}")
        assert resp2.status_code in [404, 500]

    def test_delete_address_missing_id(self, user_client):
        """测试删除时缺少地址ID"""
        resp = user_client.delete("/api/v3/user/address/")
        
        assert resp.status_code in [400, 404, 405]
