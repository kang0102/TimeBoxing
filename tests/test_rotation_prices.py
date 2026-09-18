from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from rotation_prices import adjust_with_verified_close, official_index, official_twse, official_tpex, fetch_official_closes
from update_rotation_data import build_snapshot
from test_rotation import bars


class ClosingPriceTests(unittest.TestCase):
    def setUp(self):
        self.raw = pd.DataFrame({"Open": [99., 101.], "High": [101., 105.], "Low": [98., 100.],
                                 "Close": [100., float("nan")], "Adj Close": [100., float("nan")],
                                 "Volume": [1000., 2100.], "Dividends": [0., 0.], "Stock Splits": [0., 0.]},
                                index=pd.to_datetime(["2026-09-17", "2026-09-18"]))
        self.quote = {"date": "2026-09-18", "previous_date": "2026-09-17", "Close": 104.,
                      "High": 105., "Low": 100., "reference_close": 100.}

    def test_verified_latest_close_repairs_nan_without_replacing_volume(self):
        result, repaired = adjust_with_verified_close(self.raw, self.quote)
        self.assertTrue(repaired)
        self.assertEqual(result.Close.iloc[-1], 104)
        self.assertEqual(result.High.iloc[-1], 105)
        self.assertEqual(result.Volume.iloc[-1], 2100)

    def test_wrong_date_price_range_or_adjustment_basis_is_not_repaired(self):
        for key, value in [("date", "2026-09-17"), ("reference_close", 98), ("High", 110), ("previous_date", "2026-09-16")]:
            _, repaired = adjust_with_verified_close(self.raw, {**self.quote, key: value})
            self.assertFalse(repaired, key)

    def test_corporate_action_or_missing_proof_does_not_invent_factor(self):
        for column in ["Dividends", "Stock Splits"]:
            raw = self.raw.copy(); raw.loc[raw.index[-1], column] = 1
            self.assertFalse(adjust_with_verified_close(raw, self.quote)[1])
        self.assertFalse(adjust_with_verified_close(self.raw.drop(columns="Dividends"), self.quote)[1])

    def test_existing_close_not_overwritten_and_historical_adjustment_preserved(self):
        raw = self.raw.copy(); raw["Close"] = [100., 104.]; raw["Adj Close"] = [90., 104.]
        adjusted, repaired = adjust_with_verified_close(raw, self.quote)
        self.assertFalse(repaired)
        self.assertEqual(adjusted.Close.iloc[0], 90)
        self.assertAlmostEqual(adjusted.High.iloc[0], 90.9)

    def test_official_calendar_excludes_unfinished_and_future_sessions(self):
        payload = {"stat":"OK","fields":["日期","最高指數","最低指數","收盤指數"],
                   "data":[["115/09/17","101","98","100"],["115/09/18","105","100","104"]]}
        self.assertEqual(official_index(payload, "2026-09-17")["date"], "2026-09-17")
        self.assertEqual(official_index(payload, "2026-09-18")["reference_close"], 100)

    def test_official_newer_day_marks_old_market_delayed_not_success(self):
        config = {"benchmarks":{"TW":"INDEX"},"groups":[{"id":"g","name":"G","stocks":[["A","A","TW"]]}]}
        data = bars(end="2026-09-17")
        snapshot = build_snapshot(config, {"INDEX":data,"A":data}, now=datetime(2026,9,18,17,tzinfo=timezone.utc), price_check={"expected_tw_date":"2026-09-18"})
        self.assertEqual(snapshot["markets"]["TW"]["status"], "delayed")
        self.assertEqual(snapshot["coverage"]["available"], 0)

    def test_first_session_of_month_uses_previous_month_reference(self):
        def payload(url):
            if 'MI_5MINS_HIST' not in url: return {}
            row = ['115/09/30','102','99','101'] if 'date=20260930' in url else ['115/10/01','105','101','104']
            return {'stat':'OK','fields':['日期','最高指數','最低指數','收盤指數'],'data':[row]}
        with patch('rotation_prices.read_json', side_effect=payload):
            quotes, _ = fetch_official_closes(datetime(2026,10,1,10,tzinfo=timezone.utc))
        self.assertEqual(quotes['^TWII']['previous_date'], '2026-09-30')
        self.assertEqual(quotes['^TWII']['reference_close'], 101)


if __name__ == "__main__":
    unittest.main()
