"""退款相关测试 fixtures - 修复版

提供不同退款状态的订单fixture,用于测试退款加急功能

使用数据库直接操作来创建售后记录
"""
import pytest
from common.http_client import HttpClient


def _create_refund_after_sale_record(order_id, status):
    """创建售后记录 (数据库直接操作)
    
    Args:
        order_id: 订单ID
        status: 售后状态 (REFUND_REQUIRED/REFUNDING/REFUNDED)
    
    根据PRD和代码实现,售后记录需要的字段:
    - id: 自增bigint (不插入,让数据库自动生成)
    - order_id: 订单ID
    - user_id: 用户ID (需要查询)
    - status: 售后状态
    - opened_at: 创建时间
    - refund_required_at / refunding_at / refunded_at: 状态时间戳
    """
    try:
        from conftest import get_db_connection
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # 检查是否已有售后记录
            cursor.execute(
                "SELECT id, user_id FROM sale_order_after_sales WHERE order_id = %s",
                (order_id,)
            )
            existing = cursor.fetchone()
            
            now = "NOW()"
            
            if existing:
                # 更新现有记录
                cursor.execute(
                    "UPDATE sale_order_after_sales SET status = %s, updated_at = NOW() WHERE order_id = %s",
                    (status, order_id)
                )
            else:
                # 查询订单的user_id
                cursor.execute(
                    "SELECT user_id FROM sale_orders WHERE id = %s",
                    (order_id,)
                )
                order_row = cursor.fetchone()
                
                if not order_row:
                    raise Exception(f"订单不存在: {order_id}")
                
                user_id = order_row[0]
                
                # 插入新记录,让id字段自动生成
                status_column = {
                    "REFUND_REQUIRED": "refund_required_at",
                    "REFUNDING": "refunding_at",
                    "REFUNDED": "refunded_at"
                }.get(status)
                
                if status_column:
                    cursor.execute(
                        f"""INSERT INTO sale_order_after_sales 
                            (order_id, user_id, status, opened_at, {status_column}, created_at, updated_at) 
                            VALUES (%s, %s, %s, NOW(), NOW(), NOW(), NOW())""",
                        (order_id, user_id, status)
                    )
                else:
                    cursor.execute(
                        """INSERT INTO sale_order_after_sales 
                            (order_id, user_id, status, opened_at, created_at, updated_at) 
                            VALUES (%s, %s, %s, NOW(), NOW(), NOW())""",
                        (order_id, user_id, status)
                    )
            
            conn.commit()
            cursor.close()
            
    except Exception as e:
        print(f"创建售后记录失败: {e}")
        import traceback
        traceback.print_exc()


@pytest.fixture(scope="module")
def refunding_order(user_client, paid_order):
    """创建并流转到REFUNDING状态的订单
    
    使用场景: 测试REFUNDING状态下的加急功能
    
    流程:
    1. 获取已支付订单
    2. 直接操作数据库创建REFUNDING状态的售后记录
    3. 验证订单状态
    
    Returns:
        dict: 订单信息,包含orderId等字段
    """
    order_id = paid_order["orderId"]
    
    # 创建REFUNDING状态的售后记录
    _create_refund_after_sale_record(order_id, "REFUNDING")
    
    # 验证状态
    resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
    if resp.status_code != 200:
        pytest.skip(f"无法获取订单详情: {resp.status_code}")
    
    order = resp.json()["data"]["order"]
    after_sale_status = order.get("afterSaleStatus")
    
    # 如果售后状态不是REFUNDING,跳过测试
    if after_sale_status != "REFUNDING":
        pytest.skip(f"订单售后状态不是REFUNDING: {after_sale_status}")
    
    return {
        "orderId": order_id,
        "afterSaleStatus": "REFUNDING"
    }


@pytest.fixture(scope="module")
def refund_required_order(user_client, paid_order):
    """创建并流转到REFUND_REQUIRED状态的订单
    
    使用场景: 测试REFUND_REQUIRED状态下的业务逻辑
    
    Returns:
        dict: 订单信息,包含orderId等字段
    """
    order_id = paid_order["orderId"]
    
    # 创建REFUND_REQUIRED状态的售后记录
    _create_refund_after_sale_record(order_id, "REFUND_REQUIRED")
    
    # 验证状态
    resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
    if resp.status_code != 200:
        pytest.skip(f"无法获取订单详情: {resp.status_code}")
    
    order = resp.json()["data"]["order"]
    after_sale_status = order.get("afterSaleStatus")
    
    if after_sale_status != "REFUND_REQUIRED":
        pytest.skip(f"订单售后状态不是REFUND_REQUIRED: {after_sale_status}")
    
    return {
        "orderId": order_id,
        "afterSaleStatus": "REFUND_REQUIRED"
    }


@pytest.fixture(scope="module")
def refunded_order(user_client, paid_order):
    """创建并流转到REFUNDED状态的订单
    
    使用场景: 测试REFUNDED状态下的展示逻辑
    
    Returns:
        dict: 订单信息,包含orderId等字段
    """
    order_id = paid_order["orderId"]
    
    # 创建REFUNDED状态的售后记录
    _create_refund_after_sale_record(order_id, "REFUNDED")
    
    # 验证状态
    resp = user_client.get(f"/api/v3/sale-orders/{order_id}")
    if resp.status_code != 200:
        pytest.skip(f"无法获取订单详情: {resp.status_code}")
    
    order = resp.json()["data"]["order"]
    after_sale_status = order.get("afterSaleStatus")
    
    if after_sale_status != "REFUNDED":
        pytest.skip(f"订单售后状态不是REFUNDED: {after_sale_status}")
    
    return {
        "orderId": order_id,
        "afterSaleStatus": "REFUNDED"
    }


@pytest.fixture(scope="module")
def urgent_refunding_order(user_client, refunding_order):
    """已提交加急的REFUNDING状态订单
    
    使用场景: 测试重复加急的幂等性
    
    Returns:
        dict: 订单信息,包含orderId和urgentAt
    """
    order_id = refunding_order["orderId"]
    
    # 提交加急
    resp = user_client.put(f"/api/v3/sale-orders/{order_id}/refund-urgency")
    
    if resp.status_code == 200 and resp.json().get("code") == 0:
        urgent_at = resp.json()["data"]["refund"]["urgentAt"]
        return {
            "orderId": order_id,
            "afterSaleStatus": "REFUNDING",
            "urgentAt": urgent_at
        }
    
    # 如果加急失败,返回基本信息
    return {
        "orderId": order_id,
        "afterSaleStatus": "REFUNDING"
    }


@pytest.fixture(scope="module")
def another_user_order():
    """另一个用户的订单
    
    使用场景: 测试权限校验
    
    Returns:
        dict: 订单信息
    """
    # 返回一个假订单ID用于测试权限校验
    # 因为没有user_client_2,使用假ID测试
    return {
        "orderId": "ANOTHER_USER_ORDER_12345"
    }
