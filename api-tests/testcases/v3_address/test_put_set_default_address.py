"""[PUT] /api/v3/user/address/{id}/default - 设置默认地址

测试要点:
1. 成功设置默认地址
2. 设置不存在的地址为默认
3. 未授权访问
4. 设置其他用户的地址为默认
5. 验证只有一个默认地址
"""
import pytest
from common.assertions import assert_status, assert_code


class TestSetDefaultAddress:
    """设置默认地址测试"""

    def test_set_default_success(self, user_client, test_address):
        """测试成功设置默认地址"""
        address_id = test_address["id"]
        resp = user_client.put(f"/api/v3/user/address/{address_id}/default")
        
        assert_status(resp, 200)
        
        # 验证已设为默认
        get_resp = user_client.get(f"/api/v3/user/address/{address_id}")
        assert get_resp.json()["data"]["is_default"] == True

    def test_set_default_nonexistent_address(self, user_client):
        """测试设置不存在的地址为默认"""
        fake_id = "nonexistent-default-id-99999"
        resp = user_client.put(f"/api/v3/user/address/{fake_id}/default")
        
        assert resp.status_code in [404, 500]

    def test_set_default_unauthorized(self, public_client, test_address):
        """测试未授权设置默认地址"""
        address_id = test_address["id"]
        resp = public_client.put(f"/api/v3/user/address/{address_id}/default")
        
        assert resp.status_code in (400, 401)

    def test_set_default_other_user_address(self, user_client, other_user_address_id):
        """测试设置其他用户的地址为默认 - 应该失败"""
        if not other_user_address_id:
            pytest.skip("无其他用户地址ID")
        
        resp = user_client.put(f"/api/v3/user/address/{other_user_address_id}/default")
        
        # 不应允许操作其他用户的地址
        assert resp.status_code in [403, 404, 500]

    def test_only_one_default_address(self, user_client):
        """测试只有一个默认地址"""
        # 创建第一个地址并设为默认
        create_payload1 = {
            "full_name": "First Default",
            "detail_address": "Jl. First Default",
            "phone": "+6281234567904",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "30303",
            "is_default": True
        }
        resp1 = user_client.post("/api/v3/user/address", json=create_payload1)
        address_id1 = resp1.json()["data"]["id"]
        
        # 创建第二个地址
        create_payload2 = {
            "full_name": "Second Default",
            "detail_address": "Jl. Second Default",
            "phone": "+6281234567905",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "40404"
        }
        resp2 = user_client.post("/api/v3/user/address", json=create_payload2)
        address_id2 = resp2.json()["data"]["id"]
        
        # 设置第二个地址为默认
        set_default_resp = user_client.put(f"/api/v3/user/address/{address_id2}/default")
        assert_status(set_default_resp, 200)
        
        # 验证第一个地址不再是默认
        get_resp1 = user_client.get(f"/api/v3/user/address/{address_id1}")
        assert get_resp1.json()["data"]["is_default"] == False
        
        # 验证第二个地址是默认
        get_resp2 = user_client.get(f"/api/v3/user/address/{address_id2}")
        assert get_resp2.json()["data"]["is_default"] == True
        
        # 清理测试数据
        user_client.delete(f"/api/v3/user/address/{address_id1}")
        user_client.delete(f"/api/v3/user/address/{address_id2}")

    def test_set_default_preserves_other_fields(self, user_client, test_address):
        """测试设置默认地址不影响其他字段"""
        address_id = test_address["id"]
        
        # 获取原始数据
        get_resp = user_client.get(f"/api/v3/user/address/{address_id}")
        original_data = get_resp.json()["data"]
        
        # 设置为默认
        resp = user_client.put(f"/api/v3/user/address/{address_id}/default")
        assert_status(resp, 200)
        
        # 再次获取验证其他字段未变
        updated_resp = user_client.get(f"/api/v3/user/address/{address_id}")
        updated_data = updated_resp.json()["data"]
        
        assert updated_data["full_name"] == original_data["full_name"]
        assert updated_data["phone"] == original_data["phone"]
        assert updated_data["city"] == original_data["city"]
        assert updated_data["is_default"] == True
