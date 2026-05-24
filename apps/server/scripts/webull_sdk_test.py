"""Python SDK で /app/subscriptions/list を直接呼んで Node と比較.
.env を読み込み、app_key + secret で署名 → 同じ 401 か成功か確認。"""
import os
import sys
import types
from pathlib import Path

# .env 読み込み (project root)
env_path = Path(__file__).resolve().parents[3] / ".env"
for line in env_path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    if "=" not in line:
        continue
    k, v = line.split("=", 1)
    v = v.strip().strip('"').strip("'")
    os.environ.setdefault(k.strip(), v)

APP_KEY = os.environ.get("WEBULL_APP_KEY", "")
APP_SECRET = os.environ.get("WEBULL_APP_SECRET", "")
print(f"APP_KEY: {APP_KEY[:8]}...{APP_KEY[-4:]} (len={len(APP_KEY)})")
print(f"APP_SECRET: {APP_SECRET[:4]}...{APP_SECRET[-4:]} (len={len(APP_SECRET)})")

# six.moves shim
from urllib.parse import quote
moves = types.ModuleType("six.moves")
moves.urllib = types.ModuleType("six.moves.urllib")
moves.urllib.parse = types.ModuleType("six.moves.urllib.parse")
moves.urllib.parse.quote = quote
sys.modules["webullsdkcore.vendored.six.moves"] = moves
sys.modules["webullsdkcore.vendored.six.moves.urllib"] = moves.urllib
sys.modules["webullsdkcore.vendored.six.moves.urllib.parse"] = moves.urllib.parse

from webullsdkcore.auth.composer import default_signature_composer as sc
import urllib.request

# 署名生成
headers = {}
sig = sc.calc_signature(
    headers,
    "api.webull.co.jp",
    "/app/subscriptions/list",
    {},   # queries
    None, # body
    APP_KEY,
    APP_SECRET,
)
headers["x-version"] = "v1"
print(f"\nGenerated signature: {sig}")
print(f"Headers: {headers}")

# 実 HTTP 呼び出し (Python urllib)
req = urllib.request.Request(
    "https://api.webull.co.jp/app/subscriptions/list",
    headers=headers,
    method="GET",
)
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        print(f"\nStatus: {resp.status}")
        print(f"Body: {body[:1000]}")
except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8", errors="replace")
    print(f"\nHTTPError: {e.code} {e.reason}")
    print(f"Body: {body}")
    print(f"Response headers: {dict(e.headers)}")
except Exception as e:
    print(f"\nException: {e!r}")
