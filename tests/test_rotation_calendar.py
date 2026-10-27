from datetime import datetime
from pathlib import Path
import sys
import unittest

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from rotation_signals import completed_bars, analyze
from rotation_money import institutional


class ClosureBarsTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.fromisoformat('2026-10-27T22:00:00+08:00')
        self.dates = pd.bdate_range(end='2026-10-27', periods=90)
        self.frame = pd.DataFrame({'Close': 100., 'High': 101., 'Volume': 1000.}, index=self.dates)

    def test_verified_closure_rows_removed_only_for_taiwan(self):
        tw = completed_bars(self.frame, 'TW', self.now)
        # Use a later time so the US 10/27 bar is also completed.
        us = completed_bars(self.frame, 'US', datetime.fromisoformat('2026-10-28T10:00:00+08:00'))
        for day in ['2026-10-23', '2026-10-26']:
            self.assertNotIn(pd.Timestamp(day), tw.index)
            self.assertIn(pd.Timestamp(day), us.index)
        for day in ['2026-10-22', '2026-10-27']:
            self.assertIn(pd.Timestamp(day), tw.index)
        pd.testing.assert_frame_equal(us, self.frame)

    def test_benchmark_phantom_bar_no_longer_blocks_real_stock_history(self):
        now = datetime.fromisoformat('2026-10-24T14:00:00+08:00')
        stock = completed_bars(self.frame.loc[:'2026-10-22'], 'TW', now)
        benchmark = completed_bars(self.frame, 'TW', now)
        self.assertEqual(analyze(stock, benchmark)['as_of'], '2026-10-22')
        with self.assertRaises(ValueError):
            analyze(stock.iloc[:-1], benchmark)
        with self.assertRaises(ValueError):
            analyze(stock.drop(pd.Timestamp('2026-10-21')), benchmark)

    def test_institutional_window_uses_five_real_sessions_not_phantom_row(self):
        prices = completed_bars(self.frame, 'TW', self.now)
        days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-27']
        archive = {'days': {day: {'TWSE': {'2330.TW': {'foreign': 10, 'trust': 5, 'dealer': 0, 'total': 15}}} for day in days}}
        row = {'symbol': '2330.TW', 'status': 'ok', 'as_of': '2026-10-27'}
        result = institutional(row, prices, archive)
        self.assertEqual([x['date'] for x in result['history']], days)
        self.assertEqual((result['status'], result['coverage'], result['core_net_5d']), ('ok', 5, 75))
        del archive['days']['2026-10-21']
        self.assertEqual(institutional(row, prices, archive)['status'], 'partial')


if __name__ == '__main__':
    unittest.main()
