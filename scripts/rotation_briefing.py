"""Turn a dated research path into explicit observation conditions, not forecasts."""


def build_briefings(rows, cases):
    by_symbol = {r["symbol"]: r for r in rows}
    result = []
    for case in cases:
        active = case["status"] in ("waiting", "diffusing", "weakening")
        items = []
        for position in case["positions"]:
            row = by_symbol.get(position["symbol"], {})
            valid = active and row.get("status") == "ok" and row.get("as_of") == case["as_of"]
            item = {"symbol": position["symbol"], "name": row.get("name", position["symbol"]),
                    "wave": position["wave"], "role": position["role"], "category": "unavailable", "checks": []}
            if valid:
                item.update(close=row["close"], change_1d=row["change_1d"], return_20d=row["return_20d"],
                            ma20=row["ma20"], high20=row["previous_high20"], volume_ratio=row["volume_ratio"],
                            rs_5d=row["rs_5d"], money_bias=row.get("smart_money", {}).get("bias", "unknown"),
                            gap_to_high=max(0, (row["previous_high20"] / row["close"] - 1) * 100))
                follower = position["wave"] in (0, 3)
                if follower:
                    item["checks"] = [
                        {"kind": "breakout", "passed": row["breakout_20d"], "target": row["previous_high20"], "actual": row["close"]},
                        {"kind": "volume", "passed": row["volume_ratio"] >= case["rules"]["volume_ratio_min"], "target": case["rules"]["volume_ratio_min"], "actual": row["volume_ratio"]},
                        {"kind": "relative", "passed": row["rs_5d"] > 0, "target": 0, "actual": row["rs_5d"]},
                    ]
                else:
                    item["checks"] = [
                        {"kind": "ma20", "passed": row["above_ma20"], "target": row["ma20"], "actual": row["close"]},
                        {"kind": "relative", "passed": row["rs_5d"] > 0, "target": 0, "actual": row["rs_5d"]},
                    ]
                if position["symbol"] in case["leaders"]:
                    item["category"] = "leader_hot" if row["stage"] == "extended" else "leader"
                elif position["wave"] == 1:
                    item["category"] = "anchor"
                elif case["status"] == "weakening":
                    item["category"] = "wait"
                elif row["stage"] == "extended":
                    item["category"] = "hot"
                elif all(check["passed"] for check in item["checks"]):
                    item["category"] = "ready"
                elif row["above_ma20"] and row["rs_5d"] > 0:
                    item["category"] = "watch"
                else:
                    item["category"] = "wait"
            items.append(item)
        focus = [item for item in items if item["category"] in ("ready", "watch")]
        focus.sort(key=lambda item: (item["category"] != "ready", item.get("money_bias") != "buying", item.get("gap_to_high", 999)))
        result.append({"id": case["id"], "market": case["market"], "as_of": case["as_of"], "status": case["status"],
                       "focus_symbols": [item["symbol"] for item in focus[:3]], "items": items})
    return result
