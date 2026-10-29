"""环境配置"""

import os

ENV = os.getenv("ENV", "test")

# 平台执行时按运行选中的测试环境注入，优先级高于 ENV 里的地址。
API_BASE_URL_OVERRIDE = os.getenv("API_BASE_URL", "").strip() or None

# 用户登录方式: sms / apple / facebook / google
AUTH_METHOD = os.getenv("AUTH_METHOD", "sms")

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": os.getenv("API_TOKEN", ""),
    "X-App-Version": "1.18.1",
    "X-Platform": "ios",
    "X-Device-Id": "sureprice_test_device_001",  # SurePrice 需要设备 ID
}

ENV_CONFIG = {
    "test": {
        "base_url": "https://kaka-dev.kitarx.com",
        "api_base_url": "https://api.kitarx.com",
        "penyu_base_url": "https://penyu-dev.kitarx.com",
        "voucher_base_url": "https://kado-dev.kitarx.com",
        "verify_ssl": False,
    },
    "api": {
        "base_url": "https://api.kitarx.com",
        "api_base_url": "https://api.kitarx.com",
        "verify_ssl": False,
    },
    "ydq": {
        "base_url": "https://ydqapi.kitarx.com",
        "api_base_url": "https://ydqapi.kitarx.com",
        "verify_ssl": False,
    },
    "cjy": {
        "base_url": "https://cjyapi.kitarx.com",
        "api_base_url": "https://cjyapi.kitarx.com",
        "verify_ssl": False,
    },
    "prod": {
        "base_url": "https://gapi.kitarx.com",
        "api_base_url": "https://gapi.kitarx.com",
        "verify_ssl": True,
    },
}

# 用户登录凭证
AUTH_CREDENTIALS = {
    "sms": {
        "phone": os.getenv("AUTH_PHONE", "+6281111111111"),
        "code": os.getenv("AUTH_SMS_CODE", "666666"),
    },
    "apple": {
        "id_token": os.getenv("AUTH_APPLE_TOKEN", ""),
    },
    "facebook": {
        "access_token": os.getenv("AUTH_FACEBOOK_TOKEN", ""),
    },
    "google": {
        "id_token": os.getenv("AUTH_GOOGLE_TOKEN", ""),
    },
}


def get_config():
    config = dict(ENV_CONFIG[ENV])
    if API_BASE_URL_OVERRIDE is not None:
        config["base_url"] = API_BASE_URL_OVERRIDE
        config["api_base_url"] = API_BASE_URL_OVERRIDE
    return config
