"""moomoo 口座の cash (accinfo_query) を currency 切替で調査."""
import json
import sys

from futu import (  # type: ignore[import-untyped]
    OpenSecTradeContext, TrdMarket, TrdEnv, SecurityFirm, Currency, RET_OK,
)

ACC_ID = 284852704550146840  # メイン口座 (probe で確認した)

# 利用可能な Currency を列挙
currencies = []
for name in dir(Currency):
    if name.startswith('_'):
        continue
    v = getattr(Currency, name)
    if isinstance(v, (str, int)):
        currencies.append((name, v))

print(json.dumps({'available_currencies': [n for n, _ in currencies]}, indent=2))

ctx = OpenSecTradeContext(
    filter_trdmarket=TrdMarket.JP,
    host='127.0.0.1', port=11111,
    security_firm=SecurityFirm.FUTUJP,
)

result = []
for name, val in currencies:
    try:
        ret, data = ctx.accinfo_query(acc_id=ACC_ID, trd_env=TrdEnv.REAL, currency=val)
        if ret == RET_OK:
            result.append({
                'currency': name,
                'ok': True,
                'rows': data.to_dict(orient='records'),
            })
        else:
            result.append({'currency': name, 'ok': False, 'error': str(data)[:200]})
    except Exception as e:
        result.append({'currency': name, 'ok': False, 'error': f'exception: {e!r}'})

ctx.close()
print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
