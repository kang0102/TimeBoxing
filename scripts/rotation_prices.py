"""Repair a missing latest Taiwan close only after official, dated validation."""
from datetime import datetime, timedelta
import json
import math
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

TWSE_SOURCE = "https://www.twse.com.tw/zh/trading/exchange/MI_INDEX.html"
TPEX_SOURCE = "https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pricing.html"
INDEX_SOURCE = "https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=html"


def number(value):
    value = float(str(value).replace(",", ""))
    if not math.isfinite(value):
        raise ValueError("報價不是有效數字")
    return value


def roc_date(value):
    text = str(value).replace("/", "").replace("-", "")
    return f"{int(text[:-4])+1911:04d}-{text[-4:-2]}-{text[-2:]}"


def read_json(url):
    request = Request(url, headers={"User-Agent": "TimeBoxing-RotationRadar/1.0", "Accept": "application/json"})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8-sig"))


def official_index(payload, cutoff):
    if payload.get("stat") != "OK":
        raise ValueError("官方指數尚未公布")
    fields = payload["fields"]
    indices = [fields.index(v) for v in ["日期", "最高指數", "最低指數", "收盤指數"]]
    rows = sorted([(roc_date(r[indices[0]]), *[number(r[i]) for i in indices[1:]]) for r in payload["data"] if roc_date(r[indices[0]]) <= cutoff])
    if not rows:
        raise ValueError("尚無完整交易日")
    day, high, low, close = rows[-1]
    return {"date": day, "High": high, "Low": low, "Close": close, "source": INDEX_SOURCE,
            "reference_close": rows[-2][3] if len(rows) > 1 else None,
            "previous_date": rows[-2][0] if len(rows) > 1 else None}


def official_twse(payload, day):
    if payload.get("date") != day.replace("-", "") or payload.get("stat") != "OK":
        raise ValueError("上市官方行情日期不符")
    table = next(t for t in payload.get("tables", []) if "證券代號" in t.get("fields", []))
    fields = table["fields"]
    cols = [fields.index(v) for v in ["證券代號", "最高價", "最低價", "收盤價", "漲跌(+/-)", "漲跌價差"]]
    quotes = {}
    for row in table["data"]:
        try:
            code, high, low, close, sign, change = [row[i] for i in cols]
            high, low, close, change = map(number, [high, low, close, change])
            # Ex-right/dividend markers are not an ordinary price difference.
            if ">+<" in sign:
                reference = close - change
            elif ">-<" in sign:
                reference = close + change
            elif change == 0 and (not sign.strip() or "> <" in sign):
                reference = close
            else:
                reference = None
            quotes[str(code).strip()+".TW"] = {"date": day, "High": high, "Low": low, "Close": close, "reference_close": reference, "source": TWSE_SOURCE}
        except (ValueError, TypeError):
            continue
    return quotes


def official_tpex(payload, day):
    quotes = {}
    for row in payload:
        try:
            if roc_date(row["Date"]) != day:
                continue
            close = number(row["Close"])
            try:
                reference = close - number(row["Change"])
            except ValueError:
                reference = None
            quotes[row["SecuritiesCompanyCode"]+".TWO"] = {"date": day, "High": number(row["High"]), "Low": number(row["Low"]), "Close": close, "reference_close": reference, "source": TPEX_SOURCE}
        except (KeyError, ValueError, TypeError):
            continue
    if not quotes:
        raise ValueError("上櫃官方行情日期不符")
    return quotes


def fetch_official_closes(now):
    local = now.astimezone(ZoneInfo("Asia/Taipei"))
    cutoff = local.date() if local.hour >= 14 else local.date() - timedelta(days=1)
    diagnostics = {"checked_at": now.isoformat(), "expected_tw_date": None, "errors": []}
    quotes = {}
    try:
        index = official_index(read_json(f"https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?date={cutoff:%Y%m%d}&response=json"), cutoff.isoformat())
        if (cutoff - datetime.fromisoformat(index["date"]).date()).days > 5:
            raise ValueError("官方日期過舊")
        diagnostics["expected_tw_date"] = index["date"]
        quotes["^TWII"] = index
    except Exception:
        diagnostics["errors"].append("官方交易日期核對暫時無法完成")
        return quotes, diagnostics
    day = index["date"]
    for exchange, url, parser in [
        ("TWSE", f"https://www.twse.com.tw/exchangeReport/MI_INDEX?date={day.replace('-', '')}&type=ALLBUT0999&response=json", official_twse),
        ("TPEX", "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes", official_tpex),
    ]:
        try:
            quotes.update(parser(read_json(url), day))
        except Exception:
            diagnostics["errors"].append(f"{exchange} 官方收盤價核對失敗")
    for quote in quotes.values():
        quote["previous_date"] = index["previous_date"]
    return quotes, diagnostics


def adjust_with_verified_close(raw, quote=None):
    """Never forward-fill a close or infer a corporate-action adjustment factor."""
    frame = raw.copy()
    repaired = False
    if quote and len(frame) > 1 and "Adj Close" in frame:
        last, previous = frame.iloc[-1], frame.iloc[-2]
        previous_date = frame.index[-2].date().isoformat()
        current_date = frame.index[-1].date().isoformat()
        missing = not math.isfinite(float(last["Close"])) or not math.isfinite(float(last["Adj Close"]))
        def near(a, b):
            return a is not None and b is not None and math.isfinite(float(a)) and math.isfinite(float(b)) and abs(float(a)-float(b)) <= max(.02, abs(float(b))*1e-6)
        # This requires an actual latest-day Yahoo OHLC/volume row, an official
        # same-day close, matching high/low and a compatible previous price basis.
        compatible = (current_date == quote["date"] and previous_date == quote.get("previous_date")
                      and near(last["High"], quote["High"]) and near(last["Low"], quote["Low"])
                      and near(previous["Adj Close"], quote.get("reference_close"))
                      and near(previous["Adj Close"], previous["Close"])
                      and float(last.get("Dividends", float("nan"))) == 0
                      and float(last.get("Stock Splits", float("nan"))) == 0
                      and quote["Low"] <= quote["Close"] <= quote["High"]
                      and (not math.isfinite(float(last["Close"])) or near(last["Close"], quote["Close"])))
        if missing and compatible:
            frame.loc[frame.index[-1], ["Close", "Adj Close"]] = quote["Close"]
            repaired = True
    # Same ratio used by yfinance auto_adjust; retain missing values if unverified.
    ratio = frame["Adj Close"] / frame["Close"]
    for column in ["Open", "High", "Low", "Close"]:
        if column in frame:
            frame[column] = frame[column] * ratio
    return frame, repaired
