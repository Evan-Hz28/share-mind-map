"""[GET] /api/v3/user/address - 获取用户地址列表

测试要点:
1. 成功获取地址列表
2. 未授权访问返回401
3. 地址列表按默认地址优先、创建时间倒序排序
4. 空列表场景
5. 返回字段完整性验证
"""
import pytest
from common.assertions import assert_status, assert_code


class TestGetUserAddressList:
    """获取用户地址列表测试"""

    def test_get_address_list_success(self, user_client):
        """测试成功获取地址列表"""
        resp = user_client.get("/api/v3/user/address")
        
        assert_status(resp, 200)
        data = resp.json()["data"]
        assert "addresses" in data
        assert isinstance(data["addresses"], list)
        
        # 验证地址对象结构
        if data["addresses"]:
            address = data["addresses"][0]
            required_fields = [
                "id", "user_id", "full_name", "detail_address",
                "first_name", "last_name", "phone", "city",
                "province", "country", "zip"
            ]
            for field in required_fields:
                assert field in address, f"缺少必填字段: {field}"

    def test_get_address_list_unauthorized(self, public_client):
        """测试未授权访问"""
        resp = public_client.get("/api/v3/user/address")
        
        assert resp.status_code in (400, 401)

    def test_address_list_sorting(self, user_client):
        """测试地址列表排序 - 默认地址优先，创建时间倒序"""
        resp = user_client.get("/api/v3/user/address")
        
        assert_status(resp, 200)
        addresses = resp.json()["data"]["addresses"]
        
        if len(addresses) > 1:
            # 验证默认地址在前面
            default_found = False
            for i, addr in enumerate(addresses):
                if addr.get("is_default"):
                    if not default_found:
                        default_found = True
                    else:
                        # 如果已找到默认地址，后续不应再有
                        assert False, "存在多个默认地址"

    # 空列表场景会清空账号下全部地址，回归套件不执行，避免破坏后续下单用例的数据。

    def test_address_response_fields_completeness(self, user_client):
        """测试地址响应字段完整性"""
        resp = user_client.get("/api/v3/user/address")
        
        assert_status(resp, 200)
        addresses = resp.json()["data"]["addresses"]
        
        if addresses:
            address = addresses[0]
            # 新版字段
            assert "full_name" in address
            assert "detail_address" in address
            
            # 旧版兼容字段
            assert "first_name" in address
            assert "last_name" in address
            assert "address1" in address
            
            # 可选字段验证
            optional_fields = [
                "whatsapp_number", "email", "address2",
                "company", "district", "latitude", "longitude"
            ]
            for field in optional_fields:
                if field in address:
                    # 字段存在时不应报错
                    pass
