"""V3地址模块测试配置和fixtures

提供测试所需的公共fixtures:
- test_address: 测试用地址
- clean_user_client: 清空地址的用户客户端
- test_place_id: 测试用Google Place ID
- other_user_address_id: 其他用户的地址ID
"""
import pytest
from common.http_client import HttpClient
from config.settings import get_config


@pytest.fixture(scope="module")
def test_address(user_client):
    """创建测试地址,测试结束后自动清理"""
    payload = {
        "full_name": "Test User Address",
        "detail_address": "Jl. Test Address No. 123, RT 01/RW 02",
        "phone": "+6281234567899",
        "whatsapp_number": "+6281234567800",
        "email": "test@example.com",
        "city": "Jakarta Selatan",
        "province": "DKI Jakarta",
        "country": "ID",
        "district": "Menteng",
        "zip": "12345",
        "latitude": -6.2088,
        "longitude": 106.8456,
        "address_type": 1,
        "is_default": False
    }
    
    resp = user_client.post("/api/v3/user/address", json=payload)
    
    if resp.status_code != 200:
        pytest.skip("无法创建测试地址")
    
    address = resp.json()["data"]
    address_id = address["id"]
    
    yield address
    
    # 清理
    user_client.delete(f"/api/v3/user/address/{address_id}")


@pytest.fixture(scope="module")
def clean_user_client(user_client):
    """清空用户所有地址,用于测试空列表场景"""
    # 获取所有地址
    resp = user_client.get("/api/v3/user/address")
    
    if resp.status_code == 200:
        addresses = resp.json()["data"]["addresses"]
        
        # 删除所有地址
        for addr in addresses:
            user_client.delete(f"/api/v3/user/address/{addr['id']}")
    
    return user_client


@pytest.fixture(scope="module")
def test_place_id(user_client):
    """获取测试用Place ID - 通过搜索印尼地标"""
    # 搜索雅加达地标
    payload = {
        "query": "Grand Indonesia Mall Jakarta"
    }
    
    resp = user_client.post("/api/v3/user/address/location/search", json=payload)
    
    if resp.status_code != 200:
        return None
    
    places = resp.json()["data"]["places"]
    
    if places:
        return places[0].get("placeId")
    
    return None


@pytest.fixture(scope="module")
def other_user_address_id():
    """其他用户的地址ID - 用于测试权限控制
    
    注意: 需要在环境变量或配置中设置
    如果未设置,相关测试会被skip
    """
    import os
    return os.getenv("OTHER_USER_ADDRESS_ID", None)


@pytest.fixture(scope="module")
def nearby_place_with_location(user_client):
    """获取带坐标的附近POI"""
    payload = {
        "latitude": -6.2088,
        "longitude": 106.8456
    }
    
    resp = user_client.post("/api/v3/user/address/location/nearby-places", json=payload)
    
    if resp.status_code != 200:
        return None
    
    places = resp.json()["data"]["places"]
    
    if places:
        return places[0]
    
    return None


@pytest.fixture(scope="function")
def temp_address(user_client):
    """创建临时地址,每个测试函数结束后立即清理"""
    import uuid
    unique_id = str(uuid.uuid4())[:8]
    
    payload = {
        "full_name": f"Temp User {unique_id}",
        "detail_address": f"Jl. Temp {unique_id} No. 999",
        "phone": f"+628123456{unique_id[:4]}",
        "city": "Jakarta",
        "province": "DKI Jakarta",
        "country": "ID",
        "zip": "99999"
    }
    
    resp = user_client.post("/api/v3/user/address", json=payload)
    
    if resp.status_code != 200:
        pytest.skip("无法创建临时地址")
    
    address = resp.json()["data"]
    address_id = address["id"]
    
    yield address
    
    # 清理
    user_client.delete(f"/api/v3/user/address/{address_id}")


@pytest.fixture(scope="module")
def default_address(user_client):
    """创建默认地址"""
    payload = {
        "full_name": "Default Test User",
        "detail_address": "Jl. Default Address No. 1",
        "phone": "+6281234567000",
        "city": "Jakarta",
        "province": "DKI Jakarta",
        "country": "ID",
        "zip": "00001",
        "is_default": True
    }
    
    resp = user_client.post("/api/v3/user/address", json=payload)
    
    if resp.status_code != 200:
        pytest.skip("无法创建默认地址")
    
    address = resp.json()["data"]
    address_id = address["id"]
    
    yield address
    
    # 清理
    user_client.delete(f"/api/v3/user/address/{address_id}")
