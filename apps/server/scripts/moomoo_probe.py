"""moomoo (Futu) OpenAPI 接続探査スクリプト.

OpenD (127.0.0.1:11111) に接続して、SecurityFirm × TrdMarket の各組み合わせで
get_acc_list を試し、ヒットした組み合わせの口座情報を JSON で出力。

使い方:
    .venv/Scripts/python apps/server/scripts/moomoo_probe.py
"""
import json
import sys
import traceback

try:
    from futu import (  # type: ignore[import-untyped]
        OpenSecTradeContext,
        TrdMarket,
        TrdEnv,
        SecurityFirm,
        RET_OK,
    )
except ImportError as e:
    print(f"futu-api import failed: {e}", file=sys.stderr)
    sys.exit(1)


def list_enum_values(enum_cls):
    """enum クラスから定数値の一覧を取得"""
    out = []
    for name in dir(enum_cls):
        if name.startswith("_"):
            continue
        v = getattr(enum_cls, name)
        # メソッド等は除外、文字列定数だけ
        if isinstance(v, (str, int)):
            out.append((name, v))
    return out


def jsonify_df(df):
    if df is None or len(df) == 0:
        return []
    return df.to_dict(orient="records")


def try_combo(market_name, market_value, firm_name, firm_value):
    """1 つの組み合わせで get_acc_list して結果を返す"""
    entry = {
        "trdmarket": market_name,
        "security_firm": firm_name,
        "accounts": [],
        "error": None,
    }
    try:
        ctx = OpenSecTradeContext(
            filter_trdmarket=market_value,
            host="127.0.0.1",
            port=11111,
            security_firm=firm_value,
        )
    except Exception as e:
        entry["error"] = f"init: {e!r}"
        return entry

    try:
        ret, data = ctx.get_acc_list()
        if ret != RET_OK:
            entry["error"] = f"get_acc_list: {data}"
            return entry

        for _, row in data.iterrows():
            acc_id = int(row["acc_id"])
            account_entry = {
                "acc_id": acc_id,
                "trd_env": str(row.get("trd_env", "")),
                "acc_type": str(row.get("acc_type", "")),
                "uni_card_num": str(row.get("uni_card_num", "")),
                "card_num": str(row.get("card_num", "")),
                "security_firm": str(row.get("security_firm", "")),
                "sim_acc_type": str(row.get("sim_acc_type", "")),
            }

            # 資金 (現金等)
            ret2, funds = ctx.accinfo_query(acc_id=acc_id, trd_env=TrdEnv.REAL)
            account_entry["funds"] = jsonify_df(funds) if ret2 == RET_OK else None
            if ret2 != RET_OK:
                account_entry["funds_error"] = str(funds)

            # 保有銘柄
            ret3, positions = ctx.position_list_query(
                acc_id=acc_id, trd_env=TrdEnv.REAL
            )
            account_entry["positions"] = (
                jsonify_df(positions) if ret3 == RET_OK else None
            )
            if ret3 != RET_OK:
                account_entry["positions_error"] = str(positions)

            entry["accounts"].append(account_entry)
    except Exception as e:
        entry["error"] = f"query: {e!r}\n{traceback.format_exc()}"
    finally:
        try:
            ctx.close()
        except Exception:
            pass
    return entry


def main():
    markets = list_enum_values(TrdMarket)
    firms = list_enum_values(SecurityFirm)

    out = {
        "available_markets": [n for n, _ in markets],
        "available_firms": [n for n, _ in firms],
        "hits": [],
        "misses": [],
    }

    for m_name, m_val in markets:
        for f_name, f_val in firms:
            entry = try_combo(m_name, m_val, f_name, f_val)
            if entry["accounts"]:
                out["hits"].append(entry)
            elif entry["error"]:
                out["misses"].append({
                    "trdmarket": m_name,
                    "security_firm": f_name,
                    "error_short": str(entry["error"])[:120],
                })

    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
