"""Deterministic, end-of-day price/volume observations; never order instructions."""
from datetime import datetime, time, timedelta, timezone
from statistics import mean
from zoneinfo import ZoneInfo

MARKETS = {"TW": ("Asia/Taipei", time(14, 0)), "US": ("America/New_York", time(16, 30))}


def completed_bars(frame, market, now=None):
    """Exclude today's unfinished daily candle and all future rows."""
    import pandas as pd
    now = now or datetime.now(timezone.utc)
    zone, cutoff = MARKETS[market]
    local = now.astimezone(ZoneInfo(zone))
    end = local.date() if local.time() >= cutoff else local.date() - timedelta(days=1)
    data = frame.copy()
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)
    if data.index.tz is not None:
        data.index = data.index.tz_convert(zone).tz_localize(None)
    data.index = data.index.normalize()
    data = data.loc[~data.index.duplicated(keep="last")].sort_index()
    data = data.loc[data.index.date <= end, ["Close", "High", "Volume"]]
    data = data.replace([float("inf"), -float("inf")], float("nan")).dropna()
    return data.loc[(data.Close > 0) & (data.High > 0) & (data.Volume >= 0)]


def clamp(value, low=0, high=1):
    return max(low, min(high, value))


def analyze(stock, benchmark):
    """Both frames must contain completed adjusted daily OHLCV bars."""
    if len(stock) < 65 or len(benchmark) < 65:
        raise ValueError("至少需要 65 個完整交易日")
    # Do not silently align an old stock quote to a newer market observation.
    if stock.index[-1] != benchmark.index[-1]:
        raise ValueError("個股與指數資料日期不一致")
    common = stock.index.intersection(benchmark.index)
    if len(common) < 65:
        raise ValueError("指數與個股共同交易日不足")
    if not benchmark.index[-65:].isin(stock.index).all():
        raise ValueError("最近 65 個市場交易日有缺漏")
    s, b = stock.loc[common], benchmark.loc[common]
    close = float(s.Close.iloc[-1])
    ret = lambda days: (close / float(s.Close.iloc[-days-1]) - 1) * 100
    relative = s.Close / b.Close
    rs = lambda days: (float(relative.iloc[-1] / relative.iloc[-days-1]) - 1) * 100
    rs5, rs20 = rs(5), rs(20)
    previous_rs5 = (float(relative.iloc[-6] / relative.iloc[-11]) - 1) * 100
    acceleration = rs5 - previous_rs5
    avg_volume = float(s.Volume.iloc[-21:-1].mean())
    if avg_volume <= 0:
        raise ValueError("前 20 日成交量不足")
    volume_ratio = float(s.Volume.iloc[-1]) / avg_volume
    ma20, ma60 = float(s.Close.iloc[-20:].mean()), float(s.Close.iloc[-60:].mean())
    high20 = float(s.High.iloc[-21:-1].max())
    distance = (close / ma20 - 1) * 100
    breakout = close > high20
    parts = {
        "relative_strength": 35 * clamp((rs20 + 10) / 20),
        "acceleration": 20 * clamp((acceleration + 5) / 10),
        "trend": 10 * int(close > ma20) + 10 * int(ma20 > ma60),
        "volume": 15 * clamp((volume_ratio - .5) / 1.5),
        "breakout": 10 * clamp((close / high20 - .9) / .1),
    }
    score = round(sum(parts.values()), 1)
    if close < ma20 and rs5 <= 0:
        stage = "weakening"
    elif ret(20) > 25 or distance > 15:
        stage = "extended"
    elif breakout and rs5 > 0 and volume_ratio >= 1.5:
        stage = "breakout"
    elif close > ma20 and rs5 > 0 and acceleration > 0:
        stage = "improving"
    else:
        stage = "watch"
    reasons = []
    if breakout:
        reasons.append("收盤突破前 20 日最高價")
    reasons.append(f"5 日相對大盤 {rs5:+.2f}%")
    reasons.append(f"成交量為前 20 日均量 {volume_ratio:.2f} 倍")
    if close < ma20:
        reasons.append("收盤低於 20 日均線")
    result = {
        "as_of": s.index[-1].date().isoformat(), "close": close,
        "change_1d": ret(1), "return_5d": ret(5), "return_20d": ret(20),
        "rs_5d": rs5, "rs_20d": rs20, "rs_acceleration": acceleration,
        "volume_ratio": volume_ratio, "ma20_distance": distance, "ma20": ma20,
        "above_ma20": close > ma20, "breakout_20d": breakout,
        "score": score, "stage": stage, "reasons": reasons,
        "components": {k: round(v, 2) for k, v in parts.items()},
        "series": [{"date": dt.date().isoformat(), "value": round(float(v / relative.iloc[-21] - 1) * 100, 3)}
                   for dt, v in relative.iloc[-21:].items()],
    }
    return {k: round(v, 4) if isinstance(v, float) else v for k, v in result.items()}


def aggregate(rows, groups):
    results = []
    for group in groups:
        for market in ("TW", "US"):
            members = [r for r in rows if r["group"] == group["id"] and r["market"] == market]
            if not members:
                continue
            usable = [r for r in members if r["status"] == "ok"]
            coverage = len(usable) / len(members)
            out = {"id": group["id"], "name": group["name"], "market": market,
                   "count": len(members), "usable": len(usable), "coverage": round(coverage * 100)}
            if coverage < .6:
                out.update(status="insufficient", score=None, breadth=None, rs_5d=None, return_20d=None)
            else:
                out.update(status="ok", score=round(mean(r["score"] for r in usable), 1),
                           breadth=round(mean(r["above_ma20"] for r in usable) * 100),
                           rs_5d=round(mean(r["rs_5d"] for r in usable), 2),
                           return_20d=round(mean(r["return_20d"] for r in usable), 2))
                # A laggard candidate requires improving price action and group breadth.
                for row in usable:
                    row["laggard_watch"] = bool(len(usable) >= 2
                                                and out["return_20d"] - row["return_20d"] >= 5)
                    row["laggard"] = bool(len(usable) >= 2 and out["breadth"] >= 50
                                          and out["rs_5d"] > 0
                                          and out["return_20d"] - row["return_20d"] >= 5
                                          and row["rs_5d"] > 0 and row["above_ma20"]
                                          and row["stage"] != "extended")
            results.append(out)
    return results


def active_events(events, benchmarks, rows, now=None):
    """Only sourced events, within ten observed market sessions, enter the radar."""
    result = []
    today = (now or datetime.now(timezone.utc)).date()
    by_symbol = {r["symbol"]: r for r in rows}
    for event in events:
        if event.get("verification") != "verified" or not event.get("sources"):
            continue
        if not all(str(s.get("url", "")).startswith("https://") for s in event["sources"]):
            continue
        market = event.get("market")
        bars = benchmarks.get(market)
        if bars is None or bars.empty:
            continue
        try:
            date = datetime.strptime(event["date"], "%Y-%m-%d").date()
        except (ValueError, KeyError, TypeError):
            continue
        try:
            published = datetime.strptime(event.get("published_date", event["date"]), "%Y-%m-%d").date()
        except (ValueError, KeyError, TypeError):
            continue
        if published > today:
            continue
        days = sum(d >= date for d in bars.index.date)
        if not 0 <= days <= 10:
            continue
        waves = []
        for relation in event.get("relationships", []):
            if relation.get("wave") not in (1, 2, 3) or relation.get("symbol") not in by_symbol:
                continue
            if relation.get("kind") not in ("confirmed", "hypothesis"):
                continue
            if relation["kind"] == "confirmed" and not str(relation.get("source", "")).startswith("https://"):
                continue
            waves.append(relation)
        result.append({**event, "trading_days": days, "tracking_status": "pending" if days == 0 else "active", "relationships": waves})
    return result
