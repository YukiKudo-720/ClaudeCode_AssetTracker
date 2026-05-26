"""Moomoo accinfo_query を多角的にプローブして per-currency cash 取得方法を探す."""
import os
import sys
import types
import json

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from futu import (  # type: ignore[import-untyped]
    OpenSecTradeContext, TrdMarket, TrdEnv, SecurityFirm, Currency, RET_OK,
)

ctx = OpenSecTradeContext(
    filter_trdmarket=TrdMarket.JP,
    host='127.0.0.1', port=11111,
    security_firm=SecurityFirm.FUTUJP,
)

ret, acc_list = ctx.get_acc_list()
if ret != RET_OK:
    print(f'get_acc_list failed: {acc_list}')
    sys.exit(1)

# 利用可能口座のうち、positions を持っているものを取得
target_acc_id = None
for _, row in acc_list.iterrows():
    aid = int(row['acc_id'])
    ret_p, pos = ctx.position_list_query(acc_id=aid, trd_env=TrdEnv.REAL)
    if ret_p == RET_OK and len(pos) > 0:
        target_acc_id = aid
        break

if target_acc_id is None:
    print('no account with positions found')
    sys.exit(1)

print(f'Using acc_id={target_acc_id}\n')

# 各通貨で accinfo_query を呼び、全カラムをダンプ
for cur_name, cur_val in [('USD', Currency.USD), ('JPY', Currency.JPY), ('HKD', Currency.HKD)]:
    ret, data = ctx.accinfo_query(acc_id=target_acc_id, trd_env=TrdEnv.REAL, currency=cur_val)
    print(f'=== accinfo_query currency={cur_name} ===')
    if ret == RET_OK and len(data) > 0:
        row = data.iloc[0].to_dict()
        for k, v in row.items():
            print(f'  {k}: {v}')
    else:
        print(f'  ERROR: {data}')
    print()

# get_max_trd_qtys 等他のメソッドも試す
print('=== その他メソッド ===')
for method_name in ['accinfo_query', 'get_acc_list']:
    if hasattr(ctx, method_name):
        print(f'  {method_name}: available')

# context のメソッド一覧
print('\n=== ctx のメソッド (cash/balance/currency 系) ===')
for m in dir(ctx):
    if m.startswith('_'): continue
    if any(k in m.lower() for k in ['cash', 'balance', 'currency', 'fund', 'wallet']):
        print(f'  {m}')

ctx.close()
