"""[POST] /api/v3/user/address - 创建地址

测试要点:
1. 新版格式创建成功 (full_name + detail_address)
2. 旧版格式创建成功 (first_name + last_name + address1)
3. 必填字段缺失
4. 无效参数验证
5. 设置默认地址
6. 地址类型设置
7. 经纬度保存
8. 新旧字段混用场景
"""
import pytest
from common.assertions import assert_status, assert_code


class TestCreateUserAddress:
    """创建地址测试"""

    def test_create_address_new_format_success(self, user_client):
        """测试新版格式创建地址 - full_name + detail_address"""
        payload = {
            "full_name": "Test User",
            "detail_address": "Jl. Test No. 123, RT 01/RW 02",
            "phone": "+6281234567890",
            "city": "Jakarta Selatan",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "12345",
            "is_default": False
        }
        
        resp = user_client.post("/api/v3/user/address", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["full_name"] == payload["full_name"]
        assert data["detail_address"] == payload["detail_address"]
        assert data["phone"] == payload["phone"]
        
        # 清理测试数据
        if "id" in data:
            user_client.delete(f"/api/v3/user/address/{data['id']}")

    def test_create_address_old_format_success(self, user_client):
        """测试旧版格式创建地址 - 兼容性测试"""
        payload = {
            "first_name": "Test",
            "last_name": "User",
            "address1": "Jl. Test Lama No. 456",
            "address2": "Lt. 2",
            "phone": "+6281234567891",
            "city": "Jakarta Pusat",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "54321"
        }
        
        # 1.18.1 起强制新格式，旧格式只在低版本 App 生效，这里显式模拟旧版本
        resp = user_client.post(
            "/api/v3/user/address",
            json=payload,
            headers={"X-App-Version": "1.0.43"},
        )

        assert_status(resp, 200)
        data = resp.json()["data"]
        # 旧版字段应该被正确保存
        assert data["first_name"] == payload["first_name"]
        assert data["last_name"] == payload["last_name"]
        
        # 清理测试数据
        if "id" in data:
            user_client.delete(f"/api/v3/user/address/{data['id']}")

    def test_create_address_missing_required_fields(self, user_client):
        """测试必填字段缺失"""
        test_cases = [
            {
                "name": "缺少phone",
                "payload": {
                    "full_name": "Test",
                    "detail_address": "Test Address",
                    "city": "Jakarta",
                    "province": "DKI Jakarta",
                    "zip": "12345"
                }
            },
            {
                "name": "缺少city",
                "payload": {
                    "full_name": "Test",
                    "detail_address": "Test Address",
                    "phone": "+6281234567890",
                    "province": "DKI Jakarta",
                    "zip": "12345"
                }
            },
            {
                "name": "缺少province",
                "payload": {
                    "full_name": "Test",
                    "detail_address": "Test Address",
                    "phone": "+6281234567890",
                    "city": "Jakarta",
                    "zip": "12345"
                }
            },
            {
                "name": "缺少zip",
                "payload": {
                    "full_name": "Test",
                    "detail_address": "Test Address",
                    "phone": "+6281234567890",
                    "city": "Jakarta",
                    "province": "DKI Jakarta"
                }
            }
        ]
        
        for case in test_cases:
            resp = user_client.post("/api/v3/user/address", json=case["payload"])
            assert resp.status_code == 400, f"{case['name']} 应该返回400"

    def test_create_address_missing_name_fields(self, user_client):
        """测试姓名字段缺失"""
        # 新版格式缺少full_name
        payload = {
            "detail_address": "Test Address",
            "phone": "+6281234567890",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "12345"
        }
        resp = user_client.post("/api/v3/user/address", json=payload)
        assert resp.status_code == 400

    def test_create_address_missing_address_fields(self, user_client):
        """测试地址详情字段缺失"""
        # 新版格式缺少detail_address
        payload = {
            "full_name": "Test User",
            "phone": "+6281234567890",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "12345"
        }
        resp = user_client.post("/api/v3/user/address", json=payload)
        assert resp.status_code == 400

    def test_create_address_set_default(self, user_client):
        """测试设置默认地址"""
        payload = {
            "full_name": "Default Address User",
            "detail_address": "Jl. Default No. 1",
            "phone": "+6281234567892",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "11111",
            "is_default": True
        }
        
        resp = user_client.post("/api/v3/user/address", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["is_default"] == True
        
        # 清理测试数据
        if "id" in data:
            user_client.delete(f"/api/v3/user/address/{data['id']}")

    def test_create_address_with_coordinates(self, user_client):
        """测试带经纬度的地址创建"""
        payload = {
            "full_name": "User With Location",
            "detail_address": "Jl. Location Test No. 1",
            "phone": "+6281234567893",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "22222",
            "latitude": -6.2088,
            "longitude": 106.8456
        }
        
        resp = user_client.post("/api/v3/user/address", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert "latitude" in data
        assert "longitude" in data
        
        # 清理测试数据
        if "id" in data:
            user_client.delete(f"/api/v3/user/address/{data['id']}")

    def test_create_address_with_type(self, user_client):
        """测试设置地址类型"""
        payload = {
            "full_name": "Recycle Address User",
            "detail_address": "Jl. Recycle No. 2",
            "phone": "+6281234567894",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "33333",
            "address_type": 2  # 回收地址
        }
        
        resp = user_client.post("/api/v3/user/address", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["address_type"] == 2
        
        # 清理测试数据
        if "id" in data:
            user_client.delete(f"/api/v3/user/address/{data['id']}")

    def test_create_address_default_country(self, user_client):
        """测试默认国家设置 - 新版格式不传country时默认为ID"""
        payload = {
            "full_name": "No Country User",
            "detail_address": "Jl. No Country No. 3",
            "phone": "+6281234567895",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "zip": "44444"
        }
        
        resp = user_client.post("/api/v3/user/address", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        # 应该自动设置为ID
        assert data["country"] == "ID"
        
        # 清理测试数据
        if "id" in data:
            user_client.delete(f"/api/v3/user/address/{data['id']}")

    def test_create_address_unauthorized(self, public_client):
        """测试未授权创建地址"""
        payload = {
            "full_name": "Unauthorized User",
            "detail_address": "Jl. Unauthorized",
            "phone": "+6281234567896",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "55555"
        }
        
        resp = public_client.post("/api/v3/user/address", json=payload)
        assert resp.status_code in (400, 401)

    def test_create_address_empty_string_validation(self, user_client):
        """测试空字符串验证"""
        payload = {
            "full_name": "   ",  # 只有空格
            "detail_address": "Test Address",
            "phone": "+6281234567897",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "66666"
        }
        
        resp = user_client.post("/api/v3/user/address", json=payload)
        assert resp.status_code == 400

    def test_create_address_with_optional_fields(self, user_client):
        """测试包含可选字段的地址创建"""
        payload = {
            "full_name": "Complete User",
            "detail_address": "Jl. Complete No. 10, RT 05/RW 03",
            "phone": "+6281234567898",
            "whatsapp_number": "+6281234567899",
            "email": "test@example.com",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "77777",
            "district": "Menteng",
            "company": "Test Company"
        }
        
        resp = user_client.post("/api/v3/user/address", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["whatsapp_number"] == payload["whatsapp_number"]
        assert data["email"] == payload["email"]
        assert data["district"] == payload["district"]
        
        # 清理测试数据
        if "id" in data:
            user_client.delete(f"/api/v3/user/address/{data['id']}")

    def test_create_address_default_type(self, user_client):
        """测试默认地址类型 - 不传address_type时默认为1(销售地址)"""
        payload = {
            "full_name": "Default Type User",
            "detail_address": "Jl. Default Type",
            "phone": "+6281234567900",
            "city": "Jakarta",
            "province": "DKI Jakarta",
            "country": "ID",
            "zip": "88888"
        }
        
        resp = user_client.post("/api/v3/user/address", json=payload)
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert data["address_type"] == 1
        
        # 清理测试数据
        if "id" in data:
            user_client.delete(f"/api/v3/user/address/{data['id']}")
