"""moomoo (Futu) OpenAPI から口座 + 保有銘柄を取得し、JSON で stdout 出力.

Node adapter 側からサブプロセスとして呼ばれる。
stderr には futu ライブラリのログ等が出る (Node 側は無視 or debug 用に保存)。

JSON schema:
{
  "accounts": [
    {
      "accId": <int>, "label": <str>, "baseCurrency": "USD",
      "cashNative": <num>, "positions": [
        {"symbol": "SNDK", "exchange": null, "name": "SanDisk",
         "currency": "USD", "assetClass": "stock"|"etf",
         "region": "us"|"hk"|"jp", "quantity": <num>,
         "marketPriceNative": <num>, "avgCostNative": <num>}
      ]
    }
  ],
  "errors": [...]
}

エラー時も errors リストに詰めて exit 0 で返す (Node 側で判断)。
"""
import json
import sys
import traceback

# Windows のデフォルト stdout エンコーディングは cp932 で日本語が文字化けするため UTF-8 を強制
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

try:
    from futu import (  # type: ignore[import-untyped]
        OpenSecTradeContext, TrdMarket, TrdEnv, SecurityFirm, Currency, RET_OK,
    )
except ImportError as e:
    print(json.dumps({"accounts": [], "errors": [f"futu-api import failed: {e}"]}))
    sys.exit(0)


# ETF らしい銘柄名のキーワード (簡易判定、ユーザーが後で Category で補正可)
ETF_MARKERS = [
    'etf', 'trust', 'fund', ' ishares', ' vanguard', ' spdr', ' invesco',
    ' proshares', ' ark ', ' direxion', ' wisdomtree', ' schwab',
]


def detect_asset_class(stock_name: str) -> str:
    if not stock_name:
        return 'stock'
    lower = f' {stock_name.lower()} '
    if any(m in lower for m in ETF_MARKERS):
        return 'etf'
    return 'stock'


def region_from_market(market: str) -> str:
    m = (market or '').upper()
    if m == 'US': return 'us'
    if m == 'HK': return 'hk'
    if m in ('JP', 'JPFUND'): return 'jp'
    if m == 'CN': return 'cn'
    return 'other'


def normalize_position(pos: dict) -> dict:
    code = pos.get('code', '') or ''
    # "US.SNDK" → symbol="SNDK", exchange None (US の細分化は不明)
    if '.' in code:
        _market_prefix, symbol = code.split('.', 1)
    else:
        symbol = code

    market = pos.get('position_market', '')
    currency = pos.get('currency', 'USD') or 'USD'
    qty = float(pos.get('qty') or 0)
    price = float(pos.get('nominal_price') or 0)
    cost = pos.get('average_cost') or pos.get('cost_price')
    avg_cost = float(cost) if cost is not None else None

    return {
        'symbol': symbol,
        'exchange': None,  # OpenD は具体取引所まで返さない (NYSE/NASDAQ 判別不可)
        'name': pos.get('stock_name', symbol),
        'currency': currency,
        'assetClass': detect_asset_class(pos.get('stock_name', '')),
        'region': region_from_market(market),
        'quantity': qty,
        'marketPriceNative': price,
        'avgCostNative': avg_cost,
    }


# 通貨コード → accinfo_query 内のフィールド名。
# net_cash_power = マージン負債を差し引いた純現金 (実際に取引/出金可能な額)。
# 旧: *_cash は預入額そのもの (担保ロック分含む) で、USD マージン残債を
# 別途差し引かないと総資産が過大計上になる。
CASH_FIELD_BY_CURRENCY = {
    'USD': 'usd_net_cash_power',
    'JPY': 'jpy_net_cash_power',
    'HKD': 'hkd_net_cash_power',
    'CNY': 'cnh_net_cash_power',
    'SGD': 'sgd_net_cash_power',
    'AUD': 'aud_net_cash_power',
    'CAD': 'cad_net_cash_power',
    'MYR': 'myr_net_cash_power',
}


def fetch_account(ctx, acc_row) -> dict:
    acc_id = int(acc_row['acc_id'])
    card_num = str(acc_row.get('card_num', '')) or str(acc_id)

    # accinfo_query は currency=USD で 1 回呼ぶだけで全通貨の us_cash/jp_cash 等が返る
    cash_by_currency: dict[str, float] = {}
    base_currency = 'USD'
    funds_error = None
    try:
        ret, funds = ctx.accinfo_query(
            acc_id=acc_id, trd_env=TrdEnv.REAL, currency=Currency.USD
        )
        if ret == RET_OK and len(funds) > 0:
            row = funds.iloc[0]
            for cur, field in CASH_FIELD_BY_CURRENCY.items():
                val = row.get(field)
                if val is None:
                    continue
                # N/A は str で来るので除外
                try:
                    amount = float(val)
                except (TypeError, ValueError):
                    continue
                if amount > 0:
                    cash_by_currency[cur] = amount
        else:
            funds_error = str(funds)
    except Exception as e:
        funds_error = f'funds exception: {e!r}'

    # positions
    positions = []
    pos_error = None
    try:
        ret, pos_df = ctx.position_list_query(acc_id=acc_id, trd_env=TrdEnv.REAL)
        if ret == RET_OK:
            for _, row in pos_df.iterrows():
                positions.append(normalize_position(row.to_dict()))
        else:
            pos_error = str(pos_df)
    except Exception as e:
        pos_error = f'positions exception: {e!r}'

    return {
        'accId': acc_id,
        'label': 'moomoo証券',  # 機関名と統一 (複数口座あれば将来 disambig)
        'accType': str(acc_row.get('acc_type', '')),
        'baseCurrency': base_currency,
        'cashByCurrency': cash_by_currency,  # {'USD': 1232.18, 'JPY': 50023.0, ...}
        'positions': positions,
        '_diagnostics': {
            'funds_error': funds_error,
            'pos_error': pos_error,
        },
    }


def main():
    out = {'accounts': [], 'errors': []}

    try:
        ctx = OpenSecTradeContext(
            filter_trdmarket=TrdMarket.JP,
            host='127.0.0.1', port=11111,
            security_firm=SecurityFirm.FUTUJP,
        )
    except Exception as e:
        out['errors'].append(f'OpenD connect failed: {e!r}')
        print(json.dumps(out))
        return

    try:
        ret, acc_list = ctx.get_acc_list()
        if ret != RET_OK:
            out['errors'].append(f'get_acc_list: {acc_list}')
            return

        seen_ids = set()
        for _, row in acc_list.iterrows():
            aid = int(row['acc_id'])
            if aid in seen_ids:
                continue
            seen_ids.add(aid)

            entry = fetch_account(ctx, row)
            # positions が無い & cash が全通貨 0 の口座は除外 (demo/sim)
            if not entry['positions'] and not entry['cashByCurrency']:
                continue
            out['accounts'].append(entry)
    except Exception as e:
        out['errors'].append(f'fetch error: {e!r}\n{traceback.format_exc()}')
    finally:
        try:
            ctx.close()
        except Exception:
            pass

    print(json.dumps(out, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()
