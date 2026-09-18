"""Official Taiwan institutional flows; US CMF is explicitly a price/volume proxy."""
import json
import math
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCES = {
    "TWSE": "https://www.twse.com.tw/zh/trading/foreign/t86.html",
    "TPEX": "https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/detail/day.html",
}
CMF_SOURCE = "https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/cmf"


def integer(value):
    # A missing observation must never become a zero flow.
    return int(str(value).strip().replace(",", ""))


def parse_report(payload, exchange, day, symbols):
    expected = day.replace("-", "")
    if str(payload.get("date")) != expected or str(payload.get("stat", "")).lower() != "ok":
        raise ValueError("法人報表日期不符或尚未公布")
    if exchange == "TWSE":
        fields = payload.get("fields", [])
        required = ["證券代號", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"]
        indices = [fields.index(name) for name in required]
        data = payload.get("data", [])
    else:
        # Current official TPEx table has grouped headings; repeated subheadings
        # are deliberately validated before the documented positions are used.
        expected_fields = ["代號", "名稱"] + ["買進股數", "賣出股數", "買賣超股數"] * 7 + ["三大法人買賣超股數合計"]
        table = next((t for t in payload.get("tables", []) if t.get("fields") == expected_fields), None)
        if table is None:
            raise ValueError("櫃買法人報表欄位已變更")
        indices, data = [0, 4, 13, 22, 23], table.get("data", [])
    result = {}
    for row in data:
        try:
            code = str(row[indices[0]]).strip()
            if code not in symbols:
                continue
            foreign, trust, dealer, total = [integer(row[i]) for i in indices[1:]]
            if foreign + trust + dealer != total:
                continue
            result[symbols[code]] = {"foreign": foreign, "trust": trust, "dealer": dealer, "total": total}
        except (ValueError, TypeError, IndexError):
            continue
    return result


def refresh_flows(config, days, previous=None):
    """Fetch at most five dates per exchange; preserve dated history on failure."""
    archive = json.loads(json.dumps(previous or {"schema_version": 1, "days": {}}))
    archive.setdefault("days", {})
    errors = []
    for exchange, suffix in [("TWSE", ".TW"), ("TPEX", ".TWO")]:
        symbols = {s[0].split(".")[0]: s[0] for g in config["groups"] for s in g["stocks"] if s[0].endswith(suffix)}
        for day in days:
            existing = archive["days"].get(day, {}).get(exchange, {})
            if day != days[-1] and set(symbols.values()).issubset(existing):
                continue
            if exchange == "TWSE":
                url = "https://www.twse.com.tw/rwd/zh/fund/T86?" + urlencode({"response": "json", "date": day.replace("-", ""), "selectType": "ALLBUT0999"})
            else:
                url = "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?" + urlencode({"type": "Daily", "sect": "EW", "date": day.replace("-", "/"), "response": "json"})
            try:
                request = Request(url, headers={"User-Agent": "TimeBoxing-RotationRadar/1.0", "Accept": "application/json"})
                with urlopen(request, timeout=20) as response:
                    payload = json.loads(response.read().decode("utf-8-sig"))
                parsed = parse_report(payload, exchange, day, symbols)
                if not parsed:
                    raise ValueError("法人報表無可用觀察股")
                archive["days"].setdefault(day, {})[exchange] = parsed
            except Exception:
                errors.append(f"{exchange} {day} 法人資料未更新")
            time.sleep(.35)
    keep = sorted(archive["days"])[-30:]
    archive["days"] = {day: archive["days"][day] for day in keep}
    return archive, errors


def institutional(row, prices, archive):
    exchange = "TPEX" if row["symbol"].endswith(".TWO") else "TWSE"
    out = {"method": "institutional", "status": "unavailable", "bias": "unknown", "as_of": None,
           "source": SOURCES[exchange], "source_name": "櫃買中心" if exchange == "TPEX" else "臺灣證券交易所",
           "note": "偏向依外資（不含外資自營商）＋投信判斷；自營商含避險，另列參考。", "history": []}
    if row.get("status") != "ok" or prices is None or len(prices) < 5:
        return out
    dates = [d.date().isoformat() for d in prices.index[-5:]]
    for day in dates:
        flow = archive.get("days", {}).get(day, {}).get(exchange, {}).get(row["symbol"])
        if flow is not None:
            out["history"].append({"date": day, **flow})
    out["coverage"] = len(out["history"])
    if not out["history"]:
        return out
    out["as_of"] = out["history"][-1]["date"]
    if out["as_of"] != row["as_of"] or len(out["history"]) != 5:
        out["status"] = "partial"
        return out
    sums = {key: sum(h[key] for h in out["history"]) for key in ("foreign", "trust", "dealer", "total")}
    combined = [h["foreign"] + h["trust"] for h in out["history"]]
    buy_days, sell_days = sum(v > 0 for v in combined), sum(v < 0 for v in combined)
    streak = 0
    for value in reversed(combined):
        if value <= 0:
            break
        streak += 1
    net = sums["foreign"] + sums["trust"]
    bias = "buying" if net > 0 and buy_days >= 3 else "selling" if net < 0 and sell_days >= 3 else "mixed"
    out.update(status="ok", bias=bias, net_5d=sums, core_net_5d=net, buy_days=buy_days, sell_days=sell_days,
               buy_streak=streak, joint_buying=sums["foreign"] > 0 and sums["trust"] > 0)
    return out


def cmf(row, prices):
    out = {"method": "cmf_proxy", "status": "unavailable", "bias": "unknown", "as_of": row.get("as_of"),
           "source": CMF_SOURCE, "source_name": "CMF 指標說明", "note": "CMF20 是量價推估，不能辨識交易者身分，不是已確認的機構資金流。"}
    if row.get("status") != "ok" or prices is None or len(prices) < 20 or "Low" not in prices:
        return out
    bars = prices.iloc[-20:]
    if not all(math.isfinite(float(v)) for col in ["High", "Low", "Close", "Volume"] for v in bars[col]):
        return out
    if ((bars.High < bars.Low) | (bars.Close < bars.Low) | (bars.Close > bars.High) | (bars.Volume < 0)).any() or float(bars.Volume.sum()) <= 0:
        return out
    span = bars.High - bars.Low
    multiplier = ((2 * bars.Close - bars.High - bars.Low) / span.where(span != 0)).fillna(0)
    value = float((multiplier * bars.Volume).sum() / bars.Volume.sum())
    out.update(status="ok", cmf_20d=round(value, 4), bias="buying" if value >= .05 else "selling" if value <= -.05 else "mixed")
    return out


def assess_money(row, prices, archive=None):
    out = institutional(row, prices, archive or {}) if row["market"] == "TW" else cmf(row, prices)
    # Keep the price test independent so a price/flow disagreement stays visible.
    out["price_confirmed"] = bool(row.get("above_ma20") and row.get("rs_5d", 0) > 0) if row.get("status") == "ok" else None
    return out


def save_archive(path, archive):
    path = Path(path)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(archive, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    tmp.replace(path)
