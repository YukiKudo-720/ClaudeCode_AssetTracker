"""公式 webull-python-sdk-trade を使った正規ルート呼び出し試験.
我々の自作署名と同じ 401 が返るか、それとも別の経路で動くかを確認。"""
import os, sys, types
from pathlib import Path

# .env 読み込み
for line in Path('.env').read_text(encoding='utf-8').splitlines():
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# cgi shim (Python 3.13+ で cgi module 削除のため legacy_cgi を alias)
try:
    import cgi  # noqa: F401
except ModuleNotFoundError:
    import legacy_cgi as _cgi  # type: ignore[import-not-found]
    sys.modules['cgi'] = _cgi

# six.moves shim (Python 3 で削除された旧 paths を補完)
import six.moves  # real six
import six.moves.urllib
import six.moves.urllib.parse
import six.moves.urllib.error
import six.moves.urllib.request
import six.moves.http_client
import six.moves.queue
import six.moves.collections_abc

# webullsdkcore.vendored.six.moves に bind
prefixes = [
    'webullsdkcore.vendored.six',
    'webullsdkcore.vendored.requests.packages.urllib3.packages.six',
]
for p in prefixes:
    sys.modules[f'{p}.moves'] = six.moves
    sys.modules[f'{p}.moves.urllib'] = six.moves.urllib
    sys.modules[f'{p}.moves.urllib.parse'] = six.moves.urllib.parse
    sys.modules[f'{p}.moves.urllib.error'] = six.moves.urllib.error
    sys.modules[f'{p}.moves.urllib.request'] = six.moves.urllib.request
    sys.modules[f'{p}.moves.http_client'] = six.moves.http_client
    sys.modules[f'{p}.moves.queue'] = six.moves.queue
    sys.modules[f'{p}.moves.collections_abc'] = six.moves.collections_abc

# Region と API を import (もし grpc 関係で fail したら subscribe 系は使えないが、
# trade.account_info の HTTP 呼び出しは生きてるはず)
try:
    from webullsdkcore.client import ApiClient
    from webullsdktrade.api import API
    from webullsdkcore.common.region import Region
    print('imports OK')
except Exception as e:
    print(f'import failed: {e!r}')
    sys.exit(1)

# JP region で client 生成
client = ApiClient(
    app_key=os.environ['WEBULL_APP_KEY'],
    app_secret=os.environ['WEBULL_APP_SECRET'],
    region_id=Region.JP.value,
)
api = API(client)

# 1. app subscriptions
print('\n--- get_app_subscriptions() ---')
try:
    res = api.account.get_app_subscriptions()
    print(f'status: {res.status_code}')
    print(f'body  : {res.text[:1000]}')
except Exception as e:
    print(f'exception: {e!r}')
