"""Download completed daily bars and publish an honest, atomic observation snapshot."""
import argparse
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import sys

from rotation_signals import active_events, aggregate, analyze, completed_bars
from rotation_research import evaluate_cases
from rotation_money import assess_money, refresh_flows, save_archive
from rotation_prices import adjust_with_verified_close, fetch_official_closes
from rotation_briefing import build_briefings
from rotation_sync import build_synchrony
from rotation_universe import refresh_top100, expand_universe

ROOT = Path(__file__).resolve().parents[1]


def build_snapshot(config, downloads, previous=None, now=None, events=None, research_cases=None, institutional=None, price_check=None):
    now = now or datetime.now(timezone.utc)
    previous = previous or {}
    price_check = price_check or {}
    old = {r["symbol"]: r for r in previous.get("stocks", [])}
    benchmarks, market_info = {}, {}
    for market, symbol in config["benchmarks"].items():
        try:
            frame = completed_bars(downloads[symbol], market, now)
            if len(frame) < 65:
                raise ValueError("指數資料不足")
            age = (now.date() - frame.index[-1].date()).days
            if age > 5:
                raise ValueError("指數資料超過 5 個日曆日未更新")
            benchmarks[market] = frame
            as_of = frame.index[-1].date().isoformat()
            expected = price_check.get("expected_tw_date") if market == "TW" else None
            market_info[market] = {"symbol": symbol, "as_of": as_of,
                                   "status": "delayed" if expected and as_of < expected else "ok", "expected_as_of": expected}
        except Exception:
            market_info[market] = {"symbol": symbol, "as_of": None, "status": "unavailable"}
    rows, completed_prices = [], {}
    for group in config["groups"]:
        for symbol, name, market in group["stocks"]:
            base = {"symbol": symbol, "name": name, "market": market, "group": group["id"],
                    "group_name": group["name"], "currency": "TWD" if market == "TW" else "USD", "laggard": False, "laggard_watch": False}
            try:
                if market not in benchmarks:
                    raise ValueError("市場基準資料暫時無法取得")
                if market_info[market]["status"] == "delayed":
                    raise ValueError(f"官方已公布 {market_info[market]['expected_as_of']}，行情來源尚未補齊")
                bars = completed_bars(downloads[symbol], market, now)
                data = analyze(bars, benchmarks[market])
                completed_prices[symbol] = bars
                history = list(old.get(symbol, {}).get("history", []))
                history = [h for h in history if h["date"] < data["as_of"]]
                history.append({"date": data["as_of"], "score": data["score"], "stage": data["stage"]})
                row = {**base, **data, "status": "ok", "history": history[-30:]}
                repair = price_check.get("repairs", {}).get(symbol)
                if repair and repair["date"] == row["as_of"]:
                    row["price_repair"] = repair
            except Exception as error:
                # Retain last known figures but exclude them from scoring, groups and signals.
                row = {**old.get(symbol, {}), **base, "status": "stale" if symbol in old else "unavailable",
                       "error": str(error) if isinstance(error, ValueError) else "行情來源暫時無法取得",
                       "history": old.get(symbol, {}).get("history", [])}
            row["smart_money"] = assess_money(row, completed_prices.get(symbol), institutional)
            rows.append(row)
    sectors = aggregate(rows, config["groups"])
    count = sum(r["status"] == "ok" for r in rows)
    evaluated_cases = evaluate_cases(research_cases or [], rows, completed_prices, benchmarks)
    return {"schema_version": 1, "generated_at": now.isoformat(),
            "last_success_at": now.isoformat() if count else previous.get("last_success_at"),
            "status": "ok" if count == len(rows) else "partial" if count else "failed",
            "source": "Yahoo Finance 還原日線；台股最新缺失收盤價以官方同日資料核對補齊，成交量沿用 Yahoo",
            "methodology_version": "event-rotation-v5-synchrony", "markets": market_info, "price_check": price_check,
            "coverage": {"available": count, "total": len(rows)},
            "stocks": rows, "groups": sectors,
            "events": active_events(events or [], benchmarks, rows, now=now),
            "research_cases": evaluated_cases, "briefings": build_briefings(rows, evaluated_cases),
            "synchrony": build_synchrony(config, completed_prices, benchmarks, rows)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "rotation" / "data.json")
    args = parser.parse_args()
    import yfinance as yf
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    config = json.loads((ROOT / "rotation" / "universe.json").read_text(encoding="utf-8"))
    top100 = refresh_top100()
    config = expand_universe(config, top100)
    save_archive(ROOT / 'rotation/universe_current.json', config)
    events = json.loads((ROOT / "rotation" / "catalysts.json").read_text(encoding="utf-8"))["events"]
    cases = json.loads((ROOT / "rotation" / "research_cases.json").read_text(encoding="utf-8"))["cases"]
    symbols = sorted(set(config["benchmarks"].values()) | {s[0] for g in config["groups"] for s in g["stocks"]})
    yf.set_tz_cache_location(str(ROOT / ".rotation-cache"))
    downloads = {}
    # Small concurrent batches avoid hammering the upstream provider.
    for start in range(0, len(symbols), 8):
        batch = symbols[start:start + 8]
        try:
            frame = yf.download(batch, period="1y", interval="1d", auto_adjust=False, actions=True, keepna=True,
                                group_by="ticker", threads=4, progress=False, timeout=20)
            for symbol in batch:
                try:
                    downloads[symbol] = frame[symbol].dropna(how="all")
                except (KeyError, TypeError):
                    pass
        except Exception as error:
            print(f"Batch unavailable: {type(error).__name__}")
    previous = {}
    if args.output.exists():
        previous = json.loads(args.output.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    official, price_check = fetch_official_closes(now, ROOT/'rotation/official_closes.json', symbols)
    price_check["repairs"] = {}
    for symbol in list(downloads):
        try:
            downloads[symbol], repaired = adjust_with_verified_close(downloads[symbol], official.get(symbol))
            if repaired:
                price_check["repairs"][symbol] = {"date": official[symbol]["date"], "source": official[symbol]["source"],
                                                  "note": "Yahoo 收盤欄位缺值；以官方同日收盤補齊，歷史還原及成交量沿用 Yahoo。"}
        except (ValueError, KeyError, TypeError):
            del downloads[symbol]
            price_check["errors"].append(f"{symbol} 還原價格無法核對")
    archive_path = ROOT / "rotation" / "institutional.json"
    archive = json.loads(archive_path.read_text(encoding="utf-8")) if archive_path.exists() else {"schema_version": 1, "days": {}}
    try:
        tw_bars = completed_bars(downloads[config["benchmarks"]["TW"]], "TW", now)
        days = [d.date().isoformat() for d in tw_bars.index[-5:]]
    except (KeyError, ValueError):
        days = []
    if days:
        archive, flow_errors = refresh_flows(config, days, archive)
    else:
        flow_errors = ["缺少台股交易日期，法人更新暫停"]
    save_archive(archive_path, archive)
    snapshot = build_snapshot(config, downloads, previous, now=now, events=events, research_cases=cases, institutional=archive, price_check=price_check)
    snapshot["institutional_refresh_errors"] = flow_errors
    ranking = {r['symbol']: r for r in top100.get('stocks', [])}
    snapshot['top100'] = {k: v for k, v in top100.items() if k != 'stocks'}
    for row in snapshot['stocks']:
        rank = ranking.get(row['symbol'], {})
        row.update(market_cap_rank=rank.get('rank'), market_cap=rank.get('market_cap'),
                   market_cap_as_of=top100.get('as_of') if rank else None,
                   shares_as_of=rank.get('shares_as_of'))
    snapshot['methodology_version'] = 'event-rotation-v6-top100'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix(".tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(args.output)
    # Preserve what was actually visible then, for later forward evaluation.
    # Never rewrite an older session with today's adjusted history.
    log_path = args.output.parent / 'observations.json'
    observations = json.loads(log_path.read_text(encoding='utf-8')) if log_path.exists() else []
    keys = {(r['market'],r['as_of']) for r in observations}
    for market, info in snapshot['markets'].items():
        if info['status'] != 'ok' or (market,info['as_of']) in keys:
            continue
        observations.append({'market':market,'as_of':info['as_of'],'recorded_at':now.isoformat(),
                             'methodology_version':snapshot['methodology_version'],
                             'stocks':[{k:r.get(k) for k in ['symbol','close','stage','status','previous_high20','ma20','volume_ratio','rs_5d','smart_money']} for r in snapshot['stocks'] if r['market']==market],
                             'briefings':[b for b in snapshot['briefings'] if b['market']==market],
                             'synchrony':[s for s in snapshot['synchrony'] if s['market']==market]})
    log_path.write_text(json.dumps(observations[-504:],ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(f"Rotation: {snapshot['status']} {snapshot['coverage']}")
    print(f"Official closes: expected TW {price_check.get('expected_tw_date')}; repaired {len(price_check['repairs'])}; errors {price_check['errors']}")
    print(f"Smart Money: {sum(r['smart_money']['status'] == 'ok' for r in snapshot['stocks'])}/{len(snapshot['stocks'])}; source errors: {len(flow_errors)}")
    return 1 if snapshot["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
