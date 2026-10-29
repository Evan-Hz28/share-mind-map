"""pytest 公共 fixtures（MVP 只保留平台用例需要的部分）"""

import pytest

from common.http_client import HttpClient
from config.settings import AUTH_CREDENTIALS, AUTH_METHOD, get_config


def _login_user(client):
    """根据 AUTH_METHOD 登录获取用户 token"""
    creds = AUTH_CREDENTIALS[AUTH_METHOD]

    if AUTH_METHOD == "sms":
        resp = client.post(
            "/api/v3/auth/verify-sms-code",
            json={"code": creds["code"], "phone": creds["phone"]},
        )
    elif AUTH_METHOD == "apple":
        resp = client.post("/api/v3/auth/apple", json={"id_token": creds["id_token"]})
    elif AUTH_METHOD == "facebook":
        resp = client.post("/api/v3/auth/facebook", json={"access_token": creds["access_token"]})
    elif AUTH_METHOD == "google":
        resp = client.post("/api/v3/auth/google", json={"id_token": creds["id_token"]})
    else:
        raise ValueError(f"不支持的登录方式: {AUTH_METHOD}")

    data = resp.json().get("data", {})
    return data.get("accessToken", "")


@pytest.fixture(scope="session")
def _user_token():
    """内部 fixture：获取用户 token，供其他 fixture 复用"""
    cfg = get_config()
    client = HttpClient(base_url=cfg.get("api_base_url", "https://api.kitarx.com"))
    return _login_user(client)


@pytest.fixture(scope="session")
def user_client(_user_token):
    """需要用户登录的接口（非 IM），base_url 为当前环境的 api 域名"""
    cfg = get_config()
    client = HttpClient(base_url=cfg.get("api_base_url", "https://api.kitarx.com"))
    if _user_token:
        client.session.headers["Authorization"] = f"Bearer {_user_token}"
    client.session.headers["X-App-Version"] = "1.18.1"
    return client


@pytest.fixture(scope="session")
def public_client():
    """不需要 Authorization 的公开接口"""
    cfg = get_config()
    client = HttpClient(base_url=cfg.get("api_base_url", "https://api.kitarx.com"))
    client.session.headers["X-App-Version"] = "1.18.1"
    return client


@pytest.fixture(scope="session")
def voucher_client(_user_token):
    """Voucher 服务客户端（kado），使用用户 token"""
    cfg = get_config()
    client = HttpClient(base_url=cfg.get("voucher_base_url", "https://kado-dev.kitarx.com"))
    if _user_token:
        client.session.headers["Authorization"] = f"Bearer {_user_token}"
    client.session.headers["X-Device-Id"] = "voucher_test_device_001"
    return client


# ============ 订单与库存 fixtures ============

STORE_ID = "1"
PICKUP_PHONE = "+6281111111117"

_cached_address_id = None


def _get_user_address_id(user_client):
    """获取用户默认地址 ID，失败时回退到预设地址"""
    global _cached_address_id
    if _cached_address_id:
        return _cached_address_id

    resp = user_client.get("/api/v2/user/address")
    if resp.status_code == 200:
        addresses = resp.json().get("data", {}).get("addresses", [])
        for address in addresses:
            if address.get("is_default"):
                _cached_address_id = address.get("id")
                return _cached_address_id
        if addresses:
            _cached_address_id = addresses[0].get("id")
            return _cached_address_id

    return "1fb4bf37-60a7-4f1b-a78e-a58e71dc623d"


def _cancel_order(user_client, order_id):
    """取消订单，释放库存"""
    if not order_id:
        return
    try:
        user_client.post(f"/api/v3/sale-orders/{order_id}/cancel", json={"reason": "test_cleanup"})
    except Exception:  # noqa: BLE001 - 清理失败不影响用例结论
        pass


def _get_available_inventory(user_client):
    """获取一个可 checkout 的可用商品 ID"""
    from common.inventory_helper import get_available_product_with_retry

    product = get_available_product_with_retry(user_client, max_retries=5)
    if product and product.get("id"):
        inventory_id = product["id"]
        precheck = user_client.get(
            "/api/v3/checkout/precheck", params={"inventoryId": inventory_id}
        )
        if precheck.status_code == 200:
            data = precheck.json().get("data", {})
            if data.get("hasPendingOrder") and data.get("pendingOrderId"):
                _cancel_order(user_client, data["pendingOrderId"])
        return inventory_id

    for inventory_id in ("TEST-0397", "TEST-0275", "KRIDP00015686", "TEST-0490"):
        precheck = user_client.get(
            "/api/v3/checkout/precheck", params={"inventoryId": inventory_id}
        )
        if precheck.status_code != 200:
            continue
        data = precheck.json().get("data", {})
        if data.get("hasPendingOrder") and data.get("pendingOrderId"):
            _cancel_order(user_client, data["pendingOrderId"])
            precheck = user_client.get(
                "/api/v3/checkout/precheck", params={"inventoryId": inventory_id}
            )
            data = precheck.json().get("data", {}) if precheck.status_code == 200 else {}
        if data.get("canCheckout") and data.get("action") == "OPEN_CHECKOUT":
            return inventory_id

    return None


def _create_home_delivery_order(user_client, payment_method="BANK_TRANSFER"):
    """创建 Home Delivery 订单"""
    inventory_id = _get_available_inventory(user_client)
    if not inventory_id:
        return None

    resp = user_client.post(
        "/api/v3/checkout/place-order",
        json={
            "inventoryId": inventory_id,
            "fulfillmentMethod": "HOME_DELIVERY",
            "addressId": _get_user_address_id(user_client),
            "shippingMethodCode": "REGULAR",
            "paymentMethodCode": payment_method,
        },
    )
    if resp.status_code != 200:
        return None

    data = resp.json().get("data", {})
    if not data.get("orderId"):
        return None
    return {
        "orderId": data.get("orderId"),
        "paymentId": data.get("paymentId"),
        "orderStatus": data.get("orderStatus"),
        "action": data.get("action"),
        "inventoryId": inventory_id,
        "grossAmount": data.get("payment", {}).get("amount", 5000000),
    }


def _cancel_pay_in_store_orders(user_client):
    """取消用户已有的 Pay In-Store 锁单（用户上限 1 单）"""
    resp = user_client.get("/api/v3/sale-orders", params={"page": 1, "pageSize": 50})
    if resp.status_code != 200:
        return
    for order in resp.json().get("data", {}).get("list", []):
        order_id = order.get("orderId")
        if order.get("orderStatus") not in ("CREATED", "LOCKED", "PENDING_PAYMENT"):
            continue
        if not order_id:
            continue
        detail = user_client.get(f"/api/v3/sale-orders/{order_id}")
        if detail.status_code != 200:
            continue
        payment = detail.json().get("data", {}).get("order", {}).get("payment", {})
        method_code = payment.get("methodCode", "") if isinstance(payment, dict) else ""
        if method_code == "PAY_IN_STORE":
            _cancel_order(user_client, order_id)


def _get_tomorrow_pickup_slot(user_client, inventory_id):
    """获取一个可用的 pickup slot（优先明天 13:00-15:00）"""
    from datetime import datetime, timedelta

    resp = user_client.get(
        "/api/v3/checkout/in-store-pickup", params={"inventoryId": inventory_id}
    )
    if resp.status_code != 200:
        return None

    data = resp.json().get("data", {})
    default_store = data.get("defaultStoreId", STORE_ID)
    pickup_dates = data.get("pickupDates", [])

    for offset in (1, 2):
        day = (datetime.now() + timedelta(days=offset)).strftime("%Y-%m-%d")
        for date_info in pickup_dates:
            if date_info.get("date") != day:
                continue
            slots = date_info.get("slots", [])
            for preferred in (True, False):
                for slot in slots:
                    if not slot.get("available"):
                        continue
                    if preferred and not (
                        slot.get("slotStart") == "13:00" and slot.get("slotEnd") == "15:00"
                    ):
                        continue
                    return {
                        "storeId": default_store,
                        "pickupDate": day,
                        "slotStart": slot.get("slotStart"),
                        "slotEnd": slot.get("slotEnd"),
                    }
            break

    default_slot = data.get("defaultPickupSlot", {})
    if default_slot.get("storeId"):
        return {
            "storeId": default_slot.get("storeId"),
            "pickupDate": default_slot.get("pickupDate"),
            "slotStart": default_slot.get("slotStart"),
            "slotEnd": default_slot.get("slotEnd"),
        }
    return None


def _create_instore_pickup_order(user_client, payment_method="BANK_TRANSFER"):
    """创建 In-Store Pickup 订单"""
    if payment_method == "PAY_IN_STORE":
        _cancel_pay_in_store_orders(user_client)

    inventory_id = _get_available_inventory(user_client)
    if not inventory_id:
        return None

    slot = _get_tomorrow_pickup_slot(user_client, inventory_id)
    if not slot:
        return None

    resp = user_client.post(
        "/api/v3/checkout/place-order",
        json={
            "inventoryId": inventory_id,
            "fulfillmentMethod": "IN_STORE_PICKUP",
            "storeId": slot["storeId"],
            "pickupDate": slot["pickupDate"],
            "slotStart": slot["slotStart"],
            "slotEnd": slot["slotEnd"],
            "pickupPhone": PICKUP_PHONE,
            "paymentMethodCode": payment_method,
        },
    )
    data = resp.json().get("data", {})
    if resp.status_code == 200 and data.get("orderId"):
        return {
            "orderId": data.get("orderId"),
            "paymentId": data.get("paymentId"),
            "orderStatus": data.get("orderStatus"),
            "action": data.get("action"),
            "inventoryId": inventory_id,
        }
    return None


@pytest.fixture(scope="session")
def user_address_id(user_client):
    """用户默认收货地址 ID"""
    return _get_user_address_id(user_client)


@pytest.fixture(scope="module")
def available_inventory_id(user_client):
    """可用的商品 ID"""
    inventory_id = _get_available_inventory(user_client)
    if not inventory_id:
        pytest.skip("没有可用的测试商品")
    return inventory_id


@pytest.fixture(scope="module")
def pickup_slot(user_client, available_inventory_id):
    """可用的门店自提时段"""
    slot = _get_tomorrow_pickup_slot(user_client, available_inventory_id)
    if not slot:
        pytest.skip("没有可用的 pickup slot")
    return slot


@pytest.fixture(scope="module")
def home_delivery_order(user_client):
    """Home Delivery 待支付订单，结束后取消"""
    order = _create_home_delivery_order(user_client)
    if not order:
        pytest.skip("无法创建 Home Delivery 订单")
    yield order
    _cancel_order(user_client, order.get("orderId"))


@pytest.fixture(scope="module")
def instore_pickup_order(user_client):
    """In-Store Pickup + 线上支付订单，结束后取消"""
    order = _create_instore_pickup_order(user_client, "BANK_TRANSFER")
    if not order:
        pytest.skip("无法创建 In-Store Pickup 订单")
    yield order
    _cancel_order(user_client, order.get("orderId"))


@pytest.fixture(scope="module")
def pay_in_store_order(user_client):
    """In-Store Pickup + Pay In-Store 锁单，结束后取消"""
    order = _create_instore_pickup_order(user_client, "PAY_IN_STORE")
    if not order:
        pytest.skip("无法创建 Pay In-Store 订单")
    yield order
    _cancel_order(user_client, order.get("orderId"))


@pytest.fixture(scope="module")
def pending_order(user_client):
    """待支付订单（不支付），结束后取消"""
    order = _create_home_delivery_order(user_client)
    if not order:
        pytest.skip("无法创建订单")
    order["orderStatus"] = "PENDING_PAYMENT"
    yield order
    _cancel_order(user_client, order.get("orderId"))


@pytest.fixture(scope="module")
def paid_order(user_client):
    """已支付订单（模拟 Midtrans webhook），结束后尝试取消"""
    from common.payment_helper import simulate_payment_success

    order = _create_home_delivery_order(user_client)
    if not order:
        pytest.skip("无法创建订单")

    order_id = order.get("orderId")
    resp = simulate_payment_success(user_client, order_id, order.get("grossAmount", 5000000))
    if resp.status_code != 200:
        _cancel_order(user_client, order_id)
        pytest.skip("模拟支付成功失败")

    order["orderStatus"] = "PAID"
    yield order
    _cancel_order(user_client, order_id)
