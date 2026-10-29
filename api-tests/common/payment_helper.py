"""支付辅助工具

提供支付相关的通用功能：
- 模拟 Midtrans 支付成功/失败
- 计算签名
- 创建订单并触发支付回调
"""
import hashlib
import base64
import requests
from common.http_client import HttpClient

# Midtrans Sandbox Keys
MIDTRANS_SERVER_KEY = "SB-Mid-server-K0_S9rGhklk386xnLv7kAn8n"
MIDTRANS_CLIENT_KEY = "SB-Mid-client-3uUp1tK0sfhzdqr6"


def calculate_midtrans_signature(order_id, status_code, gross_amount):
    """计算 Midtrans webhook 签名
    
    Args:
        order_id: 订单 ID
        status_code: 状态码 ("200" for success, "202" for pending)
        gross_amount: 金额（整数）
    
    Returns:
        SHA512 签名
    """
    data = f"{order_id}{status_code}{int(gross_amount)}{MIDTRANS_SERVER_KEY}"
    return hashlib.sha512(data.encode()).hexdigest()


def real_payment_via_midtrans(order_id, gross_amount):
    """通过 Midtrans API 创建真实交易并完成支付（仅 Sandbox 环境）
    
    使用信用卡支付（frictionless 3DS 测试卡），可以直接通过 API 完成支付。
    交易会出现在 Midtrans Dashboard 且状态为 capture/settlement。
    
    Args:
        order_id: 订单 ID
        gross_amount: 支付金额
    
    Returns:
        dict: 包含 transaction_id 和 status
    """
    base_url = "https://api.sandbox.midtrans.com"
    
    # 1. 获取 Card Token（使用 frictionless 3DS 测试卡）
    # 4024 0071 8944 9340 - Visa, frictionless 3DS, Accept
    token_resp = requests.get(
        f"{base_url}/v2/token",
        params={
            "card_number": "4024007189449340",
            "card_exp_month": "01",
            "card_exp_year": "2030",
            "card_cvv": "123",
            "client_key": MIDTRANS_CLIENT_KEY
        },
        headers={"Accept": "application/json"}
    )
    
    if token_resp.status_code != 200:
        return {"success": False, "error": f"Token request failed: {token_resp.text}"}
    
    token_data = token_resp.json()
    token_id = token_data.get("token_id")
    
    if not token_id:
        return {"success": False, "error": "Failed to get token_id"}
    
    # 2. 使用 Token 进行 Charge
    auth = base64.b64encode(f"{MIDTRANS_SERVER_KEY}:".encode()).decode()
    charge_resp = requests.post(
        f"{base_url}/v2/charge",
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        json={
            "payment_type": "credit_card",
            "transaction_details": {
                "order_id": order_id,
                "gross_amount": int(gross_amount)
            },
            "credit_card": {
                "token_id": token_id
            }
        }
    )
    
    if charge_resp.status_code not in [200, 201]:
        return {"success": False, "error": f"Charge failed: {charge_resp.text}"}
    
    charge_data = charge_resp.json()
    transaction_status = charge_data.get("transaction_status")
    
    # capture 表示支付成功
    return {
        "success": transaction_status in ["capture", "settlement"],
        "transaction_id": charge_data.get("transaction_id"),
        "transaction_status": transaction_status,
        "payment_type": charge_data.get("payment_type"),
        "order_id": order_id,
        "bank": charge_data.get("bank"),
        "dashboard_url": f"https://dashboard.sandbox.midtrans.com/transactions/{charge_data.get('transaction_id')}"
    }


def simulate_payment_success(user_client, order_id, gross_amount, transaction_status="capture"):
    """模拟支付成功
    
    调用 webhook 接口模拟 Midtrans 支付成功回调。
    
    Args:
        user_client: 已登录的客户端
        order_id: 订单 ID
        gross_amount: 支付金额
        transaction_status: 交易状态 (capture/settlement)
    
    Returns:
        响应对象
    """
    status_code = "200" if transaction_status in ["capture", "settlement"] else "202"
    signature_key = calculate_midtrans_signature(order_id, status_code, gross_amount)
    
    notification = {
        "transaction_time": "2026-05-19 18:00:00",
        "transaction_status": transaction_status,
        "transaction_id": f"tx-{order_id}",
        "status_message": f"transaction {transaction_status}",
        "status_code": status_code,
        "signature_key": signature_key,
        "payment_type": "qris",
        "order_id": order_id,
        "merchant_id": "M001",
        "gross_amount": str(int(gross_amount)),
        "fraud_status": "accept",
        "currency": "IDR"
    }
    
    return user_client.post("/api/v3/webhook/midtrans", json=notification)


def simulate_payment_failure(user_client, order_id, gross_amount, transaction_status="deny"):
    """模拟支付失败
    
    Args:
        user_client: 已登录的客户端
        order_id: 订单 ID
        gross_amount: 支付金额
        transaction_status: 交易状态 (deny/cancel/expire)
    
    Returns:
        响应对象
    """
    status_code = "202"
    signature_key = calculate_midtrans_signature(order_id, status_code, gross_amount)
    
    notification = {
        "transaction_time": "2026-05-19 18:00:00",
        "transaction_status": transaction_status,
        "transaction_id": f"tx-{order_id}",
        "status_message": f"transaction {transaction_status}",
        "status_code": status_code,
        "signature_key": signature_key,
        "payment_type": "qris",
        "order_id": order_id,
        "merchant_id": "M001",
        "gross_amount": str(int(gross_amount)),
        "currency": "IDR"
    }
    
    return user_client.post("/api/v3/webhook/midtrans", json=notification)
