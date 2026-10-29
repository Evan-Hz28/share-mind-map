"""通用断言工具"""


def skip_if_rate_limited(resp):
    """下单风控命中时跳过用例，避免共享测试账号把回归跑成红灯"""
    if resp.status_code == 429:
        import pytest

        details = {}
        try:
            details = resp.json().get("details") or {}
        except ValueError:
            pass
        if isinstance(details, dict) and details.get("businessCode") == "ORDER_RISK_RATE_LIMITED":
            pytest.skip("命中下单风控 ORDER_RISK_RATE_LIMITED，稍后重试")


def _get_curl(resp):
    """获取请求的 curl 命令"""
    curl = getattr(resp, "_curl", None)
    if curl:
        return f"\n\nCURL:\n{curl}"
    return ""


def assert_status(resp, expected=200):
    """校验状态码"""
    assert resp.status_code == expected, (
        f"期望状态码 {expected}，实际 {resp.status_code}，响应: {resp.text[:500]}"
        f"{_get_curl(resp)}"
    )


def assert_json_key(resp, key):
    """校验响应 JSON 中包含指定字段"""
    data = resp.json()
    assert key in data, f"响应 JSON 中缺少字段: {key}，实际: {list(data.keys())}{_get_curl(resp)}"


def assert_json_value(resp, key, expected):
    """校验响应 JSON 中指定字段的值"""
    data = resp.json()
    assert key in data, f"响应 JSON 中缺少字段: {key}{_get_curl(resp)}"
    assert data[key] == expected, (
        f"字段 {key} 期望值 {expected!r}，实际 {data[key]!r}{_get_curl(resp)}"
    )


def assert_code(resp, expected_code=0):
    """校验业务 code 字段（大部分接口返回 {"code": 0, ...} 表示成功）"""
    try:
        data = resp.json()
    except Exception:
        assert False, (
            f"响应不是有效 JSON，状态码 {resp.status_code}，响应: {resp.text[:300]}{_get_curl(resp)}"
        )
    assert "code" in data, f"响应缺少 code 字段，实际: {resp.text[:300]}{_get_curl(resp)}"
    assert data["code"] == expected_code, (
        f"期望业务码 {expected_code}，实际 {data['code']}，message: {data.get('message', '')}"
        f"{_get_curl(resp)}"
    )


def assert_list_not_empty(resp, data_key="data"):
    """校验返回的列表不为空"""
    data = resp.json()
    assert data_key in data, f"响应缺少 {data_key} 字段{_get_curl(resp)}"
    assert isinstance(data[data_key], list), f"{data_key} 不是列表类型{_get_curl(resp)}"
    assert len(data[data_key]) > 0, f"{data_key} 列表为空{_get_curl(resp)}"


def assert_data_fields(resp, fields, data_key="data"):
    """校验返回 data 中包含指定字段"""
    data = resp.json()
    obj = data.get(data_key, data)
    if isinstance(obj, list):
        obj = obj[0] if obj else {}
    for f in fields:
        assert f in obj, f"data 中缺少字段: {f}，实际字段: {list(obj.keys())}{_get_curl(resp)}"


def assert_business_error(resp, expected_code):
    """校验业务错误码"""
    try:
        data = resp.json()
    except Exception:
        assert False, (
            f"响应不是有效 JSON，状态码 {resp.status_code}，响应: {resp.text[:300]}{_get_curl(resp)}"
        )

    business_code = data.get("businessCode")
    if not business_code:
        business_code = data.get("data", {}).get("businessCode")
    if not business_code:
        business_code = data.get("details", {}).get("businessCode")

    assert business_code is not None, (
        f"响应缺少 businessCode 字段，实际: {resp.text[:300]}{_get_curl(resp)}"
    )
    assert business_code == expected_code, (
        f"期望业务错误码 {expected_code}，实际 {business_code}{_get_curl(resp)}"
    )


def assert_business_code(resp, expected_code):
    """校验响应中的业务码（支持多种格式）"""
    try:
        data = resp.json()
    except Exception:
        assert False, (
            f"响应不是有效 JSON，状态码 {resp.status_code}，响应: {resp.text[:300]}{_get_curl(resp)}"
        )

    if isinstance(expected_code, str) and not expected_code.isdigit():
        business_code = data.get("details", {}).get("businessCode")
        if business_code is None:
            business_code = data.get("businessCode")

        assert business_code is not None, (
            f"响应缺少 businessCode 字段，实际: {resp.text[:300]}{_get_curl(resp)}"
        )
        assert business_code == expected_code, (
            f"期望业务码 {expected_code}，实际 {business_code}{_get_curl(resp)}"
        )
    else:
        code = data.get("code")
        if code is None:
            code = data.get("data", {}).get("code")

        assert code is not None, f"响应缺少 code 字段，实际: {resp.text[:300]}{_get_curl(resp)}"

        if isinstance(expected_code, int):
            assert code == expected_code, (
                f"期望业务码 {expected_code}，实际 {code}{_get_curl(resp)}"
            )
        else:
            assert str(code) == str(expected_code), (
                f"期望业务码 {expected_code}，实际 {code}{_get_curl(resp)}"
            )
