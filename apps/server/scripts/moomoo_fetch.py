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


def fetch_account(ctx, acc_row) -> dict:
    acc_id = int(acc_row['acc_id'])
    card_num = str(acc_row.get('card_num', '')) or str(acc_id)

    # cash: USD 口座と仮定して USD 通貨でクエリ
    cash_native = 0.0
    base_currency = 'USD'
    funds_error = None
    try:
        ret, funds = ctx.accinfo_query(
            acc_id=acc_id, trd_env=TrdEnv.REAL, currency=Currency.USD
        )
        if ret == RET_OK and len(funds) > 0:
            row = funds.iloc[0]
            cash_native = float(row.get('cash') or 0)
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
        'label': f'Moomoo {card_num[-4:]}',  # 末尾 4 桁で識別
        'accType': str(acc_row.get('acc_type', '')),
        'baseCurrency': base_currency,
        'cashNative': cash_native,
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
            # positions が無い & cash が 0 の口座は除外 (demo/sim)
            if not entry['positions'] and entry['cashNative'] == 0:
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
