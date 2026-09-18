"""Download completed daily bars and publish an honest, atomic observation snapshot."""
import argparse
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import sys

from rotation_signals import active_events, aggregate, analyze, completed_bars

ROOT = Path(__file__).resolve().parents[1]


def build_snapshot(config, downloads, previous=None, now=None, events=None):
    now = now or datetime.now(timezone.utc)
    previous = previous or {}
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
            market_info[market] = {"symbol": symbol, "as_of": frame.index[-1].date().isoformat(), "status": "ok"}
        except Exception:
            market_info[market] = {"symbol": symbol, "as_of": None, "status": "unavailable"}
    rows = []
    for group in config["groups"]:
        for symbol, name, market in group["stocks"]:
            base = {"symbol": symbol, "name": name, "market": market, "group": group["id"],
                    "group_name": group["name"], "currency": "TWD" if market == "TW" else "USD", "laggard": False}
            try:
                if market not in benchmarks:
                    raise ValueError("市場基準資料暫時無法取得")
                bars = completed_bars(downloads[symbol], market, now)
                data = analyze(bars, benchmarks[market])
                history = list(old.get(symbol, {}).get("history", []))
                history = [h for h in history if h["date"] < data["as_of"]]
                history.append({"date": data["as_of"], "score": data["score"], "stage": data["stage"]})
                row = {**base, **data, "status": "ok", "history": history[-30:]}
            except Exception as error:
                # Retain last known figures but exclude them from scoring, groups and signals.
                row = {**old.get(symbol, {}), **base, "status": "stale" if symbol in old else "unavailable",
                       "error": str(error) if isinstance(error, ValueError) else "行情來源暫時無法取得",
                       "history": old.get(symbol, {}).get("history", [])}
            rows.append(row)
    sectors = aggregate(rows, config["groups"])
    count = sum(r["status"] == "ok" for r in rows)
    return {"schema_version": 1, "generated_at": now.isoformat(),
            "last_success_at": now.isoformat() if count else previous.get("last_success_at"),
            "status": "ok" if count == len(rows) else "partial" if count else "failed",
            "source": "Yahoo Finance / yfinance；還原日線，僅完整交易日",
            "methodology_version": "price-volume-v1", "markets": market_info,
            "coverage": {"available": count, "total": len(rows)},
            "stocks": rows, "groups": sectors,
            "events": active_events(events or [], benchmarks, rows)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "rotation" / "data.json")
    args = parser.parse_args()
    import yfinance as yf
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    config = json.loads((ROOT / "rotation" / "universe.json").read_text(encoding="utf-8"))
    events = json.loads((ROOT / "rotation" / "catalysts.json").read_text(encoding="utf-8"))["events"]
    symbols = sorted(set(config["benchmarks"].values()) | {s[0] for g in config["groups"] for s in g["stocks"]})
    yf.set_tz_cache_location(str(ROOT / ".rotation-cache"))
    downloads = {}
    # Small concurrent batches avoid hammering the upstream provider.
    for start in range(0, len(symbols), 8):
        batch = symbols[start:start + 8]
        try:
            frame = yf.download(batch, period="9mo", interval="1d", auto_adjust=True,
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
    snapshot = build_snapshot(config, downloads, previous, events=events)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix(".tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(args.output)
    print(f"Rotation: {snapshot['status']} {snapshot['coverage']}")
    return 1 if snapshot["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
