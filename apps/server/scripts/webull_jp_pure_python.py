"""recipes_jp の Python サンプルコードを原文ママで JP 本番に投げる切り分け用。
TS 移植が間違っていないか最終チェック。

期待:
  - Python で 200 OK が返れば TS 側に未検出のバグがある
  - Python でも 401 が返れば Webull JP 側の問題で完全確定
"""

import hmac
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from urllib.parse import quote
import base64
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 環境変数から credentials を取得
app_key = os.environ.get("WEBULL_APP_KEY", "").strip('"')
app_secret = os.environ.get("WEBULL_APP_SECRET", "").strip('"')
if not app_key or not app_secret:
    print("WEBULL_APP_KEY / WEBULL_APP_SECRET を環境変数で設定してください")
    sys.exit(1)

api_endpoint = "api.webull.co.jp"
uri = '/openapi/account/list'

headers = {
    'x-app-key': app_key,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-version': '1.0',
    'x-signature-nonce': uuid.uuid4().hex,
    'x-timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'host': api_endpoint,
    'Content-Type': 'application/json'
}
query_params = {}
body_params = {}


def generate_signature(uri, query_params, body_params, headers, app_secret):
    params_dict = query_params.copy() if query_params else {}
    params_dict.update({
        'x-app-key': headers['x-app-key'],
        'x-signature-algorithm': headers['x-signature-algorithm'],
        'x-signature-version': headers['x-signature-version'],
        'x-signature-nonce': headers['x-signature-nonce'],
        'x-timestamp': headers['x-timestamp'],
        'host': headers['host']
    })
    sorted_params = sorted(params_dict.items())
    param_string = '&'.join([f"{k}={v}" for k, v in sorted_params])

    body_md5 = ""
    if body_params:
        body_json = json.dumps(body_params, ensure_ascii=False, separators=(',', ':'))
        body_md5 = hashlib.md5(body_json.encode()).hexdigest().upper()

    sign_string = f"{uri}&{param_string}{'&' + body_md5 if body_md5 else ''}"
    encoded_sign_string = quote(sign_string, safe='')

    secret = f"{app_secret}&"
    signature = hmac.new(
        secret.encode(),
        encoded_sign_string.encode(),
        hashlib.sha1
    ).digest()
    return base64.b64encode(signature).decode('utf-8')


sig = generate_signature(uri, query_params, body_params, headers, app_secret)
headers['x-signature'] = sig

url = f"https://{api_endpoint}{uri}"
req = urllib.request.Request(url, headers={k: v for k, v in headers.items() if k.lower() != 'host'})
try:
    with urllib.request.urlopen(req, timeout=10) as res:
        body = res.read().decode('utf-8', errors='replace')
        print(f"status: {res.status}")
        print(f"body: {body[:500]}")
except urllib.error.HTTPError as e:
    body = e.read().decode('utf-8', errors='replace')
    print(f"status: {e.code}")
    print(f"body: {body[:500]}")
    print(f"x-request-id: {e.headers.get('x-request-id', '(なし)')}")
