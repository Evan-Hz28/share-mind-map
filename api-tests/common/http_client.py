"""封装 HTTP 请求客户端"""

import logging

import requests
import urllib3

from config.settings import HEADERS, get_config

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger("api")


class HttpClient:
    def __init__(self, base_url=None):
        cfg = get_config()
        self.base_url = base_url or cfg["base_url"]
        self.verify = cfg.get("verify_ssl", True)
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def request(self, method, path, **kwargs):
        base = kwargs.pop("base_url", None) or self.base_url
        url = f"{base}{path}"
        kwargs.setdefault("verify", self.verify)
        kwargs.setdefault("timeout", 10)
        resp = self.session.request(method, url, **kwargs)

        # 记录请求和响应
        logger.info(f">>> {method} {url}")
        if "json" in kwargs:
            logger.info(f"    Body: {kwargs['json']}")
        logger.info(f"<<< {resp.status_code} {resp.text[:500]}")

        # 保存 curl 命令供失败时输出
        resp._curl = self._build_curl(method, url, kwargs)

        return resp

    def _build_curl(self, method, url, kwargs):
        parts = [f"curl -X {method}"]
        for key, value in self.session.headers.items():
            if value:
                parts.append(f"-H '{key}: {value}'")
        if "json" in kwargs:
            import json

            body = json.dumps(kwargs["json"], ensure_ascii=False)
            parts.append("-H 'Content-Type: application/json'")
            parts.append(f"-d '{body}'")
        elif "data" in kwargs:
            parts.append(f"-d '{kwargs['data']}'")
        if not self.verify:
            parts.append("-k")
        parts.append(f"'{url}'")
        return " \\\n  ".join(parts)

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)

    def put(self, path, **kwargs):
        return self.request("PUT", path, **kwargs)

    def delete(self, path, **kwargs):
        return self.request("DELETE", path, **kwargs)

    def patch(self, path, **kwargs):
        return self.request("PATCH", path, **kwargs)

    def options(self, path, **kwargs):
        return self.request("OPTIONS", path, **kwargs)
