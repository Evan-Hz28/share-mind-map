"""商品库存辅助工具

提供动态获取可用商品的功能：
- 获取当前可用商品列表
- 智能重试机制
- 缓存可用商品
"""
import time
from typing import Optional, List, Dict

# 全局缓存：可用商品列表
_available_products: List[Dict] = []
_last_fetch_time: float = 0
CACHE_TTL = 300  # 缓存 5 分钟


def fetch_available_products(client, limit: int = 50) -> List[Dict]:
    """获取当前可用的商品列表
    
    Args:
        client: 已登录的用户客户端
        limit: 获取数量
    
    Returns:
        商品列表，每个商品包含 id, title, price 等
    """
    global _available_products, _last_fetch_time
    
    # 检查缓存
    if _available_products and (time.time() - _last_fetch_time) < CACHE_TTL:
        return _available_products
    
    # 从首页推荐接口获取商品
    resp = client.get("/api/v3/shop/product/recommend", params={"limit": limit})
    
    if resp.status_code != 200:
        return _available_products
    
    data = resp.json().get("data", {})
    products = data.get("products", [])
    
    if products:
        _available_products = products
        _last_fetch_time = time.time()
    
    return _available_products


def get_available_product(client, index: int = 0) -> Optional[Dict]:
    """获取一个可用商品
    
    Args:
        client: 已登录的用户客户端
        index: 商品索引（用于获取不同商品）
    
    Returns:
        商品信息，包含 id, title, price
    """
    products = fetch_available_products(client)
    
    if not products:
        return None
    
    # 使用取模确保索引有效
    return products[index % len(products)]


def check_product_available(client, inventory_id: str) -> bool:
    """检查商品是否可用
    
    Args:
        client: 已登录的用户客户端
        inventory_id: 商品 ID
    
    Returns:
        True 如果商品可购买
    """
    resp = client.get("/api/v3/checkout/precheck", params={"inventoryId": inventory_id})
    
    if resp.status_code != 200:
        return False
    
    data = resp.json().get("data", {})
    return data.get("canCheckout", False) and data.get("productStatus") == "available"


def get_available_product_with_retry(client, max_retries: int = 3, min_price: int = 0) -> Optional[Dict]:
    """获取一个可用商品（带重试）
    
    会尝试多个商品，直到找到可用的为止。
    
    Args:
        client: 已登录的用户客户端
        max_retries: 最大重试次数
        min_price: 最低价格要求（用于拆单测试，默认 0 不限制）
    
    Returns:
        商品信息
    """
    products = fetch_available_products(client)
    
    # 过滤价格并按价格降序排序
    if min_price > 0:
        filtered_products = [p for p in products if p.get("price", 0) >= min_price]
        filtered_products.sort(key=lambda p: p.get("price", 0), reverse=True)
    else:
        filtered_products = products
    
    for i in range(min(max_retries, len(filtered_products))):
        product = filtered_products[i]
        inventory_id = product.get("id")
        
        if inventory_id and check_product_available(client, inventory_id):
            return product
    
    # 如果缓存的商品都不可用，重新获取
    global _available_products, _last_fetch_time
    _available_products = []
    _last_fetch_time = 0
    
    products = fetch_available_products(client)
    
    if min_price > 0:
        filtered_products = [p for p in products if p.get("price", 0) >= min_price]
        filtered_products.sort(key=lambda p: p.get("price", 0), reverse=True)
    else:
        filtered_products = products
    
    for product in filtered_products[:max_retries]:
        inventory_id = product.get("id")
        
        if inventory_id and check_product_available(client, inventory_id):
            return product
    
    return None


def get_multiple_available_products(client, count: int = 3) -> List[Dict]:
    """获取多个可用商品
    
    Args:
        client: 已登录的用户客户端
        count: 需要的商品数量
    
    Returns:
        可用商品列表
    """
    products = fetch_available_products(client)
    available = []
    
    for product in products:
        if len(available) >= count:
            break
        
        inventory_id = product.get("id")
        
        if inventory_id and check_product_available(client, inventory_id):
            available.append(product)
    
    return available


def check_product_supports_in_store_pickup(client, inventory_id: str) -> Dict:
    """检查商品是否支持 In-Store Pickup
    
    Args:
        client: 已登录的用户客户端
        inventory_id: 商品 ID
    
    Returns:
        {
            "supports": True/False,
            "slots": [...],  # 可用的 pickup slots
            "payment_methods": [...]  # 支持的支付方式
        }
    """
    result = {
        "supports": False,
        "slots": [],
        "payment_methods": []
    }
    
    # 调用 in-store-pickup 接口
    resp = client.get("/api/v3/checkout/in-store-pickup", params={
        "inventoryId": inventory_id
    })
    
    if resp.status_code != 200:
        return result
    
    data = resp.json().get("data", {})
    
    # 检查是否有可用的 pickup slots
    pickup_dates = data.get("pickupDates", [])
    
    tomorrow_slots = []
    for date_info in pickup_dates:
        slots = date_info.get("slots", [])
        if slots:
            tomorrow_slots.extend(slots)
    
    if not tomorrow_slots:
        return result
    
    # 检查支付方式
    payment_methods = data.get("paymentMethods", {}).get("allMethods", [])
    
    result["supports"] = True
    result["slots"] = tomorrow_slots
    result["payment_methods"] = payment_methods
    
    return result


def get_available_product_for_in_store_pickup(client, max_retries: int = 5) -> Optional[Dict]:
    """获取一个支持 In-Store Pickup 的可用商品
    
    Args:
        client: 已登录的用户客户端
        max_retries: 最大重试次数
    
    Returns:
        商品信息和 pickup 信息：
        {
            "product": {...},  # 商品信息
            "slot": {...},  # 推荐的 pickup slot
            "payment_methods": [...]  # 支持的支付方式
        }
    """
    products = fetch_available_products(client)
    
    for i in range(min(max_retries, len(products))):
        product = products[i]
        inventory_id = product.get("id")
        
        if not inventory_id:
            continue
        
        # 检查商品是否可购买
        if not check_product_available(client, inventory_id):
            continue
        
        # 检查是否支持 In-Store Pickup
        pickup_info = check_product_supports_in_store_pickup(client, inventory_id)
        
        if not pickup_info["supports"]:
            continue
        
        # 找到第一个可用的 slot
        slots = pickup_info["slots"]
        if not slots:
            continue
        
        return {
            "product": product,
            "slot": slots[0],  # 返回第一个可用 slot
            "payment_methods": pickup_info["payment_methods"]
        }
    
    return None
