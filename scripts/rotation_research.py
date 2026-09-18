"""Keep dated research hypotheses separate from current market confirmation."""
from datetime import date


def evaluate_cases(cases, rows, prices, benchmarks):
    by_symbol = {r["symbol"]: r for r in rows}
    output = []
    for case in cases:
        market = case["market"]
        benchmark = benchmarks.get(market)
        sessions = 0
        as_of = None
        if benchmark is not None and not benchmark.empty:
            as_of = benchmark.index[-1].date().isoformat()
            sessions = sum(day >= date.fromisoformat(case["start_date"]) for day in benchmark.index.date)
        tracking = "unavailable" if as_of is None else "pending" if not sessions else "expired" if sessions > case["max_sessions"] else "active"
        positions, checks = [], []
        floor = case["rules"]["leader_floor_pct"]
        min_volume = case["rules"]["volume_ratio_min"]
        for position in case["positions"]:
            symbol = position["symbol"]
            row = by_symbol.get(symbol, {})
            valid = (tracking == "active" and row.get("status") == "ok"
                     and row.get("as_of") == as_of)
            observation = "資料不足" if tracking in ("active", "unavailable") else "追蹤期已結束" if tracking == "expired" else "等待首個完整交易日"
            since_report = None
            frame = prices.get(symbol)
            if valid and frame is not None:
                baseline = frame.loc[frame.index.date == date.fromisoformat(case["baseline_date"])]
                if not baseline.empty:
                    since_report = (row["close"] / float(baseline.Close.iloc[-1]) - 1) * 100
            if valid:
                if row["breakout_20d"] and row["volume_ratio"] >= min_volume and row["rs_5d"] > 0:
                    observation = "放量突破條件成立"
                elif row["above_ma20"] and row["rs_5d"] > 0:
                    observation = "已轉強，待放量突破"
                elif not row["above_ma20"]:
                    observation = "仍低於月線，待止跌"
                else:
                    observation = "站上月線，相對強弱待確認"
            positions.append({**position, "name": row.get("name", symbol),
                              "observation": observation, "since_report": round(since_report, 2) if since_report is not None else None,
                              "as_of": row.get("as_of"), "data_status": row.get("status", "unavailable")})
            if symbol in case["leaders"]:
                passed = since_report >= floor if valid and since_report is not None else None
                checks.append({"symbol": symbol, "name": row.get("name", symbol), "kind": "leader_hold",
                               "label": f"相對 {case['baseline_date']} 收盤回吐不超過 {abs(floor):g}%",
                               "passed": passed, "observed": round(since_report, 2) if since_report is not None else None,
                               "unit": "%", "threshold": floor})
            if symbol in case["followers"]:
                passed = bool(row["breakout_20d"] and row["volume_ratio"] >= min_volume and row["rs_5d"] > 0) if valid else None
                checks.append({"symbol": symbol, "name": row.get("name", symbol), "kind": "follower_breakout",
                               "label": f"突破前 20 日高點、量比 ≥ {min_volume:g}、5 日相對大盤 > 0",
                               "passed": passed, "observed": row.get("volume_ratio") if valid else None, "unit": "×"})
            if position["role"] == "落後觀察":
                checks.append({"symbol": symbol, "name": row.get("name", symbol), "kind": "laggard_recovery",
                               "label": "收盤站上動態 MA20 且 5 日相對大盤 > 0",
                               "passed": bool(row["above_ma20"] and row["rs_5d"] > 0) if valid else None,
                               "observed": row.get("ma20") if valid else None, "unit": " MA20"})
            if position["wave"] == 0:
                checks.append({"symbol": symbol, "name": row.get("name", symbol), "kind": "power_recovery",
                               "label": "收盤站上動態 MA20（不是固定價格）",
                               "passed": bool(row["above_ma20"]) if valid else None,
                               "observed": row.get("ma20") if valid else None, "unit": " MA20"})
        leaders = [c["passed"] for c in checks if c["kind"] == "leader_hold"]
        followers = [c["passed"] for c in checks if c["kind"] == "follower_breakout"]
        if tracking != "active":
            status = tracking
        elif not leaders or None in leaders:
            status = "unavailable"
        elif not all(leaders):
            status = "weakening"
        elif any(followers):
            status = "diffusing"
        elif not followers or None in followers:
            status = "unavailable"
        else:
            status = "waiting"
        output.append({**case, "positions": positions, "checks": checks, "status": status,
                       "trading_days": sessions, "as_of": as_of})
    return output
