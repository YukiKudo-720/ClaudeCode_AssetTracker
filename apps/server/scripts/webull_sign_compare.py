"""Webull SDK と Node 実装の署名を同一入力で生成・比較するための reference 出力."""
import json
import sys
from unittest.mock import patch
from webullsdkcore.auth.composer import default_signature_composer as sc

# 固定入力 (timestamp/nonce 固定で deterministic に)
FIXED_TS = "2026-05-24T12:34:56Z"
FIXED_NONCE = "12345678-1234-5678-1234-567812345678"
APP_KEY = "test_app_key"
APP_SECRET = "test_app_secret"
HOST = "api.webull.co.jp"

scenarios = [
    {
        "name": "GET /openapi/account/list (no params, no body)",
        "uri": "/openapi/account/list",
        "queries": {},
        "body": None,
    },
    {
        "name": "GET /openapi/account/positions?account_id=ABC",
        "uri": "/openapi/account/positions",
        "queries": {"account_id": "ABC123"},
        "body": None,
    },
    {
        "name": "POST with body",
        "uri": "/openapi/foo/bar",
        "queries": {"x": "1"},
        "body": {"a": 1, "b": "test"},
    },
]

# patch get_iso_8601_date + get_uuid で deterministic
with patch("webullsdkcore.utils.common.get_iso_8601_date", return_value=FIXED_TS), \
     patch("webullsdkcore.utils.common.get_uuid", return_value=FIXED_NONCE):
    for s in scenarios:
        headers = {}
        sc.calc_signature(headers, HOST, s["uri"], s["queries"], s["body"], APP_KEY, APP_SECRET)
        print(json.dumps({
            "scenario": s["name"],
            "input": {
                "uri": s["uri"], "queries": s["queries"], "body": s["body"],
                "host": HOST, "appKey": APP_KEY, "appSecret": APP_SECRET,
                "timestamp": FIXED_TS, "nonce": FIXED_NONCE,
            },
            "expected_headers": headers,
        }, ensure_ascii=False, indent=2))
        print()
