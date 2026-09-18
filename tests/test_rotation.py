import copy
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from rotation_signals import active_events, aggregate, analyze, completed_bars
from rotation_research import evaluate_cases
from update_rotation_data import build_snapshot


def bars(end="2026-09-18", n=85):
    index = pd.bdate_range(end=end, periods=n)
    values = [100 + i * .2 for i in range(n)]
    return pd.DataFrame({"Close": values, "High": [v + .1 for v in values], "Volume": [1000.] * n}, index=index)


class RotationTests(unittest.TestCase):
    def test_relative_strength_is_zero_when_stock_matches_market(self):
        data = bars()
        result = analyze(data, data)
        self.assertAlmostEqual(result["rs_5d"], 0)
        self.assertAlmostEqual(result["rs_20d"], 0)
        self.assertAlmostEqual(result["rs_acceleration"], 0)
        self.assertTrue(0 <= result["score"] <= 100)

    def test_volume_baseline_excludes_current_spike(self):
        stock, benchmark = bars(), bars()
        stock.iloc[-1, stock.columns.get_loc("Volume")] = 3000
        stock.iloc[-1, stock.columns.get_loc("Close")] *= 1.05
        stock.iloc[-1, stock.columns.get_loc("High")] = stock.Close.iloc[-1]
        result = analyze(stock, benchmark)
        self.assertEqual(result["volume_ratio"], 3)
        self.assertEqual(result["stage"], "breakout")

    def test_unfinished_candle_excluded_in_both_markets(self):
        now = datetime(2026, 9, 18, 4, tzinfo=timezone.utc)
        self.assertEqual(str(completed_bars(bars(), "TW", now).index[-1].date()), "2026-09-17")
        now = datetime(2026, 9, 18, 18, tzinfo=timezone.utc)
        self.assertEqual(str(completed_bars(bars(), "US", now).index[-1].date()), "2026-09-17")

    def test_completed_candle_included_after_buffer(self):
        now = datetime(2026, 9, 18, 7, tzinfo=timezone.utc)
        self.assertEqual(str(completed_bars(bars(), "TW", now).index[-1].date()), "2026-09-18")

    def test_stale_stock_does_not_align_silently(self):
        with self.assertRaisesRegex(ValueError, "日期不一致"):
            analyze(bars().iloc[:-1], bars())

    def test_insufficient_history_does_not_score(self):
        with self.assertRaises(ValueError):
            analyze(bars(n=10), bars())

    def test_missing_recent_sessions_do_not_change_lookback_silently(self):
        stock = bars().drop(bars().index[-5])
        with self.assertRaisesRegex(ValueError, "缺漏"):
            analyze(stock, bars())

    def test_failed_refresh_preserves_old_values_without_signals(self):
        config = {"benchmarks": {"TW": "INDEX"}, "groups": [{"id":"g", "name":"G", "stocks":[["A","Name","TW"]]}]}
        now = datetime(2026,9,18,8,tzinfo=timezone.utc)
        first = build_snapshot(config, {"INDEX":bars(), "A":bars()}, now=now)
        failed = build_snapshot(config, {}, first, now=now)
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["stocks"][0]["status"], "stale")
        self.assertEqual(failed["stocks"][0]["close"], first["stocks"][0]["close"])
        self.assertEqual(failed["groups"][0]["status"], "insufficient")
        self.assertIsNone(failed["groups"][0]["score"])
        again = build_snapshot(config, {"INDEX":bars(), "A":bars()}, first, now=now)
        self.assertEqual(len(again["stocks"][0]["history"]), 1)

    def test_laggard_requires_group_breadth_and_improving_stock(self):
        rows = [{"symbol":"A", "group":"g", "market":"TW", "status":"ok", "score":60,
                 "above_ma20":True,"rs_5d":2,"return_20d":ret,"stage":"improving"} for ret in (5,25)]
        aggregate(rows, [{"id":"g","name":"G"}])
        self.assertTrue(rows[0]["laggard"])
        self.assertFalse(rows[1]["laggard"])
        rows[0]["above_ma20"] = False
        aggregate(rows, [{"id":"g","name":"G"}])
        self.assertFalse(rows[0]["laggard"])
        self.assertTrue(rows[0]["laggard_watch"])

    def test_events_require_verified_source_and_ten_day_window(self):
        b = bars()
        event={"date":"2026-09-15", "market":"TW", "title":"test", "verification":"verified",
               "sources":[{"url":"https://example.com/press"}], "relationships":[]}
        self.assertEqual(len(active_events([event], {"TW":b}, [])), 1)
        bad=copy.deepcopy(event);bad["verification"]="rumor"
        self.assertEqual(active_events([bad], {"TW":b}, []), [])
        bad=copy.deepcopy(event);bad["date"]="2026-08-01"
        self.assertEqual(active_events([bad], {"TW":b}, []), [])
        bad=copy.deepcopy(event);bad["sources"][0]["url"]="javascript:alert(1)"
        self.assertEqual(active_events([bad], {"TW":b}, []), [])

    def test_published_news_can_wait_for_first_post_event_candle(self):
        now = datetime(2026, 9, 18, 8, tzinfo=timezone.utc)
        event = {"date": "2026-09-18", "published_date": "2026-09-17", "market": "TW",
                 "verification": "verified", "sources": [{"url": "https://example.com/press"}]}
        result = active_events([event], {"TW": bars(end="2026-09-17")}, [], now=now)
        self.assertEqual(result[0]["trading_days"], 0)
        self.assertEqual(result[0]["tracking_status"], "pending")
        event["published_date"] = "2026-09-19"
        self.assertEqual(active_events([event], {"TW": bars()}, [], now=now), [])


class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.case = {"market": "TW", "baseline_date": "2026-09-17", "start_date": "2026-09-18",
                     "max_sessions": 10, "rules": {"leader_floor_pct": -3, "volume_ratio_min": 1.5},
                     "leaders": ["A", "B"], "followers": ["C", "D"],
                     "positions": [{"symbol": s, "role": "接棒候選", "wave": 2} for s in "ABCD"]}
        self.rows = [{"symbol": s, "name": s, "status": "ok", "as_of": "2026-09-18", "close": 100,
                      "breakout_20d": s == "C", "volume_ratio": 2, "rs_5d": 1, "above_ma20": True,
                      "ma20": 95} for s in "ABCD"]
        self.prices = {s: pd.DataFrame({"Close": [100, 100]}, index=pd.to_datetime(["2026-09-17", "2026-09-18"])) for s in "ABCD"}
        self.benchmarks = {"TW": bars()}

    def result(self):
        return evaluate_cases([self.case], self.rows, self.prices, self.benchmarks)[0]

    def test_diffusion_requires_both_leaders_and_one_follower(self):
        self.assertEqual(self.result()["status"], "diffusing")
        self.rows[2]["volume_ratio"] = 1.4
        self.assertEqual(self.result()["status"], "waiting")
        self.rows[3]["breakout_20d"] = True
        self.assertEqual(self.result()["status"], "diffusing")

    def test_leader_loss_overrides_follower_breakout(self):
        self.rows[0]["close"] = 96
        result = self.result()
        self.assertEqual(result["status"], "weakening")
        self.assertEqual(result["positions"][0]["since_report"], -4)

    def test_stale_leader_never_confirms_diffusion(self):
        self.rows[1]["status"] = "stale"
        result = self.result()
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["checks"][1]["passed"])

    def test_missing_baseline_cannot_confirm_leader_hold(self):
        self.prices["A"] = self.prices["A"].iloc[1:]
        self.assertEqual(self.result()["status"], "unavailable")

    def test_pending_and_expired_cases_do_not_emit_confirmation(self):
        for end, expected in [("2026-09-17", "pending"), ("2026-10-05", "expired")]:
            self.benchmarks["TW"] = bars(end=end)
            result = self.result()
            self.assertEqual(result["status"], expected)
            self.assertTrue(all(check["passed"] is None for check in result["checks"]))

    def test_stock_date_must_match_market_date(self):
        self.rows[0]["as_of"] = "2026-09-17"
        self.assertEqual(self.result()["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
