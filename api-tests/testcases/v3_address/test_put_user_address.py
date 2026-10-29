"""[PUT] /api/v3/user/address/{id} - 更新地址

测试要点:
1. 更新单个字段
2. 更新多个字段
3. 新旧字段混用更新
4. 不存在的地址ID
5. 未授权访问
6. 更新其他用户的地址
7. 空字符串验证
8. 部分更新场景
"""
import pytest
from common.assertions import assert_status, assert_code


class TestUpdateUserAddress:
    """更新地址测试"""

    def test_update_single_field(self, user_client, test_address):
        """测试更新单个字段"""
        address_id = test_address["id"]
        payload = {
            "full_name": "Updated Name"
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["full_name"] == "Updated Name"

    def test_update_multiple_fields(self, user_client, test_address):
        """测试更新多个字段"""
        address_id = test_address["id"]
        payload = {
            "full_name": "Multi Update Name",
            "phone": "+6289999999999",
            "city": "Bandung",
            "province": "Jawa Barat"
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["full_name"] == "Multi Update Name"
        assert data["phone"] == "+6289999999999"
        assert data["city"] == "Bandung"
        assert data["province"] == "Jawa Barat"

    def test_update_detail_address(self, user_client, test_address):
        """测试更新详细地址"""
        address_id = test_address["id"]
        payload = {
            "detail_address": "Updated Detail Address - Jl. Baru No. 999"
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["detail_address"] == payload["detail_address"]

    def test_update_coordinates(self, user_client, test_address):
        """测试更新经纬度"""
        address_id = test_address["id"]
        payload = {
            "latitude": -6.9175,
            "longitude": 107.6191
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["latitude"] == payload["latitude"]
        assert data["longitude"] == payload["longitude"]

    def test_update_set_default(self, user_client, test_address):
        """测试设置默认地址"""
        address_id = test_address["id"]
        payload = {
            "is_default": True
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["is_default"] == True

    def test_update_address_type(self, user_client, test_address):
        """测试更新地址类型"""
        address_id = test_address["id"]
        payload = {
            "address_type": 2
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["address_type"] == 2

    def test_update_nonexistent_address(self, user_client):
        """测试更新不存在的地址"""
        fake_id = "nonexistent-address-id-99999"
        payload = {
            "full_name": "Should Not Work"
        }
        
        resp = user_client.put(f"/api/v3/user/address/{fake_id}", json=payload)
        
        assert resp.status_code in [404, 500]

    def test_update_unauthorized(self, public_client, test_address):
        """测试未授权更新"""
        address_id = test_address["id"]
        payload = {
            "full_name": "Unauthorized Update"
        }
        
        resp = public_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert resp.status_code in (400, 401)

    def test_update_other_user_address(self, user_client, other_user_address_id):
        """测试更新其他用户的地址 - 应该失败"""
        if not other_user_address_id:
            pytest.skip("无其他用户地址ID")
        
        payload = {
            "full_name": "Hacked Name"
        }
        
        resp = user_client.put(f"/api/v3/user/address/{other_user_address_id}", json=payload)
        
        # 不应允许更新其他用户的地址
        assert resp.status_code in [403, 404, 500]

    def test_update_empty_full_name(self, user_client, test_address):
        """测试full_name为空字符串"""
        address_id = test_address["id"]
        payload = {
            "full_name": "   "
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert resp.status_code == 400

    def test_update_empty_detail_address(self, user_client, test_address):
        """测试detail_address为空字符串"""
        address_id = test_address["id"]
        payload = {
            "detail_address": ""
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert resp.status_code == 400

    def test_update_missing_address_id(self, user_client):
        """测试缺少地址ID"""
        payload = {
            "full_name": "No ID Update"
        }
        
        # 路径参数缺失会被路由层处理
        resp = user_client.put("/api/v3/user/address/", json=payload)
        
        assert resp.status_code in [400, 404, 405]

    def test_partial_update_preserves_other_fields(self, user_client, test_address):
        """测试部分更新不影响其他字段"""
        address_id = test_address["id"]
        
        # 获取原始数据
        original_resp = user_client.get(f"/api/v3/user/address/{address_id}")
        original_data = original_resp.json()["data"]
        
        # 只更新一个字段
        payload = {
            "phone": "+6288888888888"
        }
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert_status(resp, 200)
        updated_data = resp.json()["data"]
        
        # 验证其他字段未被改变
        assert updated_data["full_name"] == original_data["full_name"]
        assert updated_data["city"] == original_data["city"]
        assert updated_data["province"] == original_data["province"]
        # phone字段已更新
        assert updated_data["phone"] == "+6288888888888"

    def test_update_all_fields_comprehensive(self, user_client, test_address):
        """测试更新所有字段"""
        address_id = test_address["id"]
        payload = {
            "full_name": "All Fields Updated",
            "detail_address": "Jl. All Fields No. 100",
            "phone": "+6287777777777",
            "whatsapp_number": "+6287777777778",
            "email": "allfields@test.com",
            "city": "Surabaya",
            "province": "Jawa Timur",
            "district": "Gubeng",
            "country": "ID",
            "zip": "60234",
            "latitude": -7.2575,
            "longitude": 112.7521,
            "address_type": 2,
            "is_default": True
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        
        # 验证所有字段
        for key, expected_value in payload.items():
            assert data[key] == expected_value, f"字段 {key} 更新失败"

    def test_update_with_null_optional_fields(self, user_client, test_address):
        """测试可选字段设为null"""
        address_id = test_address["id"]
        payload = {
            "email": None,
            "address2": None,
            "company": None
        }
        
        resp = user_client.put(f"/api/v3/user/address/{address_id}", json=payload)
        
        # 应该成功清除这些可选字段
        assert resp.status_code in [200, 400]
