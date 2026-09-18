import copy
from pathlib import Path
import sys
import unittest

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from rotation_money import assess_money, parse_report


class MoneyTests(unittest.TestCase):
    def setUp(self):
        self.prices = pd.DataFrame({"High": [110.] * 20, "Low": [90.] * 20,
                                    "Close": [105.] * 20, "Volume": [1000.] * 20},
                                   index=pd.bdate_range(end="2026-09-17", periods=20))
        self.row = {"symbol": "2330.TW", "market": "TW", "status": "ok", "as_of": "2026-09-17",
                    "above_ma20": False, "rs_5d": -1}
        self.days = [d.date().isoformat() for d in self.prices.index[-5:]]
        self.archive = {"days": {day: {"TWSE": {"2330.TW": {"foreign": 100, "trust": 50, "dealer": -1000, "total": -850}}} for day in self.days}}

    def test_core_flow_excludes_dealer_hedging_and_does_not_assert_price_recovery(self):
        result = assess_money(self.row, self.prices, self.archive)
        self.assertEqual(result["bias"], "buying")
        self.assertEqual(result["core_net_5d"], 750)
        self.assertEqual(result["net_5d"]["total"], -4250)
        self.assertEqual(result["buy_streak"], 5)
        self.assertFalse(result["price_confirmed"])

    def test_missing_session_is_unknown_not_zero_flow(self):
        del self.archive["days"][self.days[2]]
        result = assess_money(self.row, self.prices, self.archive)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["bias"], "unknown")
        self.assertNotIn("net_5d", result)

    def test_future_flow_is_ignored_and_stale_price_cannot_confirm(self):
        future = copy.deepcopy(self.archive["days"][self.days[-1]])
        self.archive["days"]["2026-09-18"] = future
        self.assertEqual(assess_money(self.row, self.prices, self.archive)["as_of"], "2026-09-17")
        self.row["status"] = "stale"
        self.assertEqual(assess_money(self.row, self.prices, self.archive)["status"], "unavailable")

    def test_three_buy_days_with_negative_total_is_not_accumulation(self):
        for day in self.days[-2:]:
            self.archive["days"][day]["TWSE"]["2330.TW"].update(foreign=-1000, trust=0, dealer=0, total=-1000)
        result = assess_money(self.row, self.prices, self.archive)
        self.assertEqual(result["bias"], "mixed")
        self.assertEqual(result["buy_streak"], 0)

    def test_cmf_known_value_is_a_proxy(self):
        self.row.update(market="US", symbol="NVDA")
        result = assess_money(self.row, self.prices)
        self.assertEqual(result["method"], "cmf_proxy")
        self.assertEqual(result["cmf_20d"], .5)
        self.assertEqual(result["bias"], "buying")

    def test_flat_range_has_zero_contribution_and_zero_volume_is_unavailable(self):
        self.row.update(market="US", symbol="NVDA")
        self.prices["High"] = self.prices["Low"] = self.prices["Close"] = 100.
        self.assertEqual(assess_money(self.row, self.prices)["cmf_20d"], 0)
        self.prices["Volume"] = 0
        self.assertEqual(assess_money(self.row, self.prices)["status"], "unavailable")

    def test_missing_or_invalid_low_does_not_manufacture_cmf(self):
        self.row.update(market="US", symbol="NVDA")
        self.assertEqual(assess_money(self.row, self.prices.drop(columns="Low"))["status"], "unavailable")
        self.prices.loc[self.prices.index[-1], "Low"] = 120
        self.assertEqual(assess_money(self.row, self.prices)["status"], "unavailable")

    def test_twse_named_columns_and_integer_share_units(self):
        payload = {"date": "20260917", "stat": "OK", "fields": ["證券代號", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"],
                   "data": [["2330", "4,794,190", "-59,590", "509,161", "5,243,761"]]}
        result = parse_report(payload, "TWSE", "2026-09-17", {"2330": "2330.TW"})
        self.assertEqual(result["2330.TW"]["foreign"], 4794190)
        payload["data"][0][-1] = "0"
        self.assertEqual(parse_report(payload, "TWSE", "2026-09-17", {"2330": "2330.TW"}), {})

    def test_report_date_and_tpex_grouped_layout_fail_closed(self):
        fields = ["代號", "名稱"] + ["買進股數", "賣出股數", "買賣超股數"] * 7 + ["三大法人買賣超股數合計"]
        row = ["3264", "欣銓"] + ["0"] * 22
        row[4], row[13], row[22], row[23] = "100", "20", "30", "150"
        payload = {"date": "20260917", "stat": "ok", "tables": [{"fields": fields, "data": [row]}]}
        result = parse_report(payload, "TPEX", "2026-09-17", {"3264": "3264.TWO"})
        self.assertEqual(result["3264.TWO"]["trust"], 20)
        with self.assertRaises(ValueError):
            parse_report(payload, "TPEX", "2026-09-18", {})
        payload["tables"][0]["fields"][4] = "changed"
        with self.assertRaises(ValueError):
            parse_report(payload, "TPEX", "2026-09-17", {})


if __name__ == "__main__":
    unittest.main()
