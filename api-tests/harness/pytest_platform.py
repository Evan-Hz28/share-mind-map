"""把 pytest 执行过程写成 NDJSON，供平台 Worker 读取。

事件写到文件描述符 3；本地直接跑 pytest 时没有 fd 3，插件静默降级。
"""

import json
import os

import pytest

REQUEST_BODY_LIMIT = 8 * 1024
RESPONSE_BODY_LIMIT = 256 * 1024
FAILURE_LIMIT = 16 * 1024
CAPTURE_MODE = os.getenv("API_TEST_CAPTURE", "failures").strip().lower()

_stream = None
_current_node_id = None
_ordinals = {}
_exchanges = {}
_emitted = set()
_counts = {"passed": 0, "failed": 0, "skipped": 0, "error": 0}


def _open_stream():
    global _stream
    try:
        _stream = os.fdopen(os.dup(3), "w", encoding="utf-8", buffering=1)
    except OSError:
        _stream = None


def _emit(payload):
    if _stream is None:
        return
    try:
        _stream.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
        _stream.flush()
    except (OSError, ValueError):
        pass


def _truncate(value, limit):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    if len(text) <= limit:
        return value
    return {"truncated": True, "text": text[:limit]}


SENSITIVE_KEYS = {
    "accesstoken",
    "refreshtoken",
    "token",
    "password",
    "id_token",
    "access_token",
    "authorization",
}


def _redact(value):
    if isinstance(value, dict):
        return {
            key: ("<redacted>" if str(key).lower() in SENSITIVE_KEYS else _redact(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _mask_headers(headers):
    masked = {}
    for key, value in headers.items():
        if key.lower() in ("authorization", "cookie", "set-cookie"):
            masked[key] = "<redacted>"
        else:
            masked[key] = value
    return masked


def _record(exchange):
    if _current_node_id is None:
        return
    _exchanges.setdefault(_current_node_id, []).append(exchange)


def pytest_configure(config):
    _open_stream()

    from common.http_client import HttpClient

    original_request = HttpClient.request

    def request(self, method, path, **kwargs):
        base = kwargs.get("base_url") or self.base_url
        exchange = {
            "method": method.upper(),
            "url": f"{base}{path}",
            "requestHeaders": _mask_headers(dict(self.session.headers)),
        }
        if "params" in kwargs:
            exchange["requestQuery"] = kwargs["params"]
        if "json" in kwargs:
            exchange["requestBody"] = _truncate(_redact(kwargs["json"]), REQUEST_BODY_LIMIT)
        elif "data" in kwargs:
            exchange["requestBody"] = _truncate(str(kwargs["data"]), REQUEST_BODY_LIMIT)

        try:
            response = original_request(self, method, path, **kwargs)
        except Exception as error:  # noqa: BLE001 - 网络异常也要进报告
            exchange["error"] = f"{type(error).__name__}: {error}"
            _record(exchange)
            raise

        exchange["status"] = response.status_code
        exchange["durationMs"] = int(response.elapsed.total_seconds() * 1000)
        content_type = response.headers.get("content-type", "")
        if "json" in content_type:
            try:
                exchange["responseBody"] = _truncate(_redact(response.json()), RESPONSE_BODY_LIMIT)
            except ValueError:
                exchange["responseBody"] = _truncate(response.text, RESPONSE_BODY_LIMIT)
        else:
            exchange["responseBody"] = _truncate(response.text, RESPONSE_BODY_LIMIT)
        _record(exchange)
        return response

    HttpClient.request = request  # type: ignore[method-assign]


def pytest_collection_modifyitems(config, items):
    for index, item in enumerate(items):
        _ordinals[item.nodeid] = index
    _emit({"event": "collection", "count": len(items)})


def pytest_runtest_setup(item):
    global _current_node_id
    _current_node_id = item.nodeid
    _exchanges.pop(item.nodeid, None)
    _emit(
        {
            "event": "start",
            "node_id": item.nodeid,
            "case_name": item.nodeid,
            "ordinal": _ordinals.get(item.nodeid, 0),
        }
    )


def _status_for(report):
    if report.skipped:
        return "skipped"
    if report.failed:
        return "error" if report.when != "call" else "failed"
    return "passed"


def pytest_runtest_logreport(report):
    if report.nodeid in _emitted:
        return
    if (
        report.when == "call"
        or (report.failed and report.when in ("setup", "teardown"))
        or (report.skipped and report.when == "setup")
    ):
        status = _status_for(report)
        _emitted.add(report.nodeid)
        _counts[status] = _counts.get(status, 0) + 1
        payload = {
            "event": "result",
            "node_id": report.nodeid,
            "case_name": report.nodeid,
            "ordinal": _ordinals.get(report.nodeid, 0),
            "status": status,
            "duration_ms": int(report.duration * 1000),
        }
        if report.failed:
            payload["failure"] = (report.longreprtext or "测试失败")[:FAILURE_LIMIT]
        exchanges = _exchanges.get(report.nodeid, [])
        if CAPTURE_MODE == "all" or (CAPTURE_MODE == "failures" and report.failed):
            payload["exchanges"] = exchanges
        _emit(payload)


def pytest_sessionfinish(session, exitstatus):
    _emit({"event": "finish", "exit_status": int(exitstatus), **_counts})
    if _stream is not None:
        try:
            _stream.close()
        except OSError:
            pass

