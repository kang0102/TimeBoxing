import sys
import unittest
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from backtest_rotation import features, simulate, training_choice, mark_refresh_failure
from rotation_sync import synchrony_series
from rotation_prices import merge_verified_cache, TPEX_SOURCE


class BacktestTests(unittest.TestCase):
    def frame(self):
        dates = pd.bdate_range('2024-01-01', periods=4)
        return pd.DataFrame({'Open':[10,20,22,24], 'Close':[12,21,23,24],
                             'ma20':[9,19,20,21], 'signal':[True,False,False,False], 'rank':1.},index=dates)

    def test_signal_fills_next_open_with_both_costs(self):
        f=self.frame();r=simulate({'A':f},f.index,1,.01,1)
        t=r['recent_trades'][0]
        self.assertEqual((t['entry'],t['exit']),('2024-01-02','2024-01-03'))
        self.assertAlmostEqual(t['return_pct'],(22*.99/(20*1.01)-1)*100)
        self.assertEqual(r['forced_exits'],0)

    def test_stop_uses_next_open_not_prior_close(self):
        f=self.frame();f.loc[f.index[1],'Close']=15
        r=simulate({'A':f},f.index,60,0,1)
        self.assertEqual(r['recent_trades'][0]['reason'],'ma20')
        self.assertAlmostEqual(r['return_pct'],10)

    def test_position_cap_cash_and_period_end_are_explicit(self):
        f=self.frame();r=simulate({str(i):f for i in range(8)},f.index,60,.01,5)
        self.assertEqual(r['trades'],5)
        self.assertEqual(r['forced_exits'],5)
        self.assertAlmostEqual(r['return_pct'],round((24*.99/(20*1.01)-1)*100,2))

    def test_historical_signal_unchanged_by_future_data(self):
        dates=pd.bdate_range('2024-01-01',periods=90)
        f=pd.DataFrame({'Open':100.,'Close':100.,'High':101.,'Volume':100.},index=dates)
        b=f.copy();f.loc[dates[70],['Close','High','Volume']]=[103,104,200]
        original=features(f,b,1.5)
        self.assertTrue(original.loc[dates[70],'signal'])
        f.loc[dates[71]:,['Close','High','Volume']]=[999,1000,10000]
        pd.testing.assert_series_equal(original.signal.iloc[:71],features(f,b,1.5).signal.iloc[:71])
        self.assertEqual(original.loc[dates[70],'volume_ratio'],2)

    def test_training_candidate_needs_sample_and_tie_keeps_baseline(self):
        self.assertEqual(training_choice({1.2:{'trades':2,'sharpe':99},1.5:{'trades':20,'sharpe':1},2:{'trades':20,'sharpe':1}},1.5),1.5)

    def test_refresh_failure_retains_actual_results_and_date(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'backtest.json'
            original={'generated_at':'2026-09-17','markets':[{'return_pct':10}]}
            p.write_text(json.dumps(original),encoding='utf-8')
            mark_refresh_failure(p,datetime(2026,9,19,tzinfo=timezone.utc))
            result=json.loads(p.read_text(encoding='utf-8'))
            self.assertEqual(result['markets'],original['markets'])
            self.assertEqual(result['generated_at'],'2026-09-17')
            self.assertEqual(result['refresh_status'],'failed')

    def test_official_cache_is_same_session_only(self):
        quotes={};diagnostics={'expected_tw_date':'2026-09-18'}
        cache={'quotes':{'A':{'date':'2026-09-18','source':TPEX_SOURCE},'B':{'date':'2026-09-17','source':TPEX_SOURCE},'C':{'date':'2026-09-19','source':TPEX_SOURCE}}}
        self.assertEqual(list(merge_verified_cache(quotes,diagnostics,cache)),['A'])
        self.assertEqual(diagnostics['cached_symbols'],['A'])


class SynchronyTests(unittest.TestCase):
    def setup_data(self):
        dates=pd.bdate_range('2024-01-01',periods=100)
        b=pd.DataFrame({'Close':100.,'High':101.,'Volume':100.},index=dates)
        f=b.copy();f['Close']=np.linspace(100,105,100);f['High']=f.Close+1
        f.loc[dates[-1],['Close','High','Volume']]=[112,113,200]
        return {s:f.copy() for s in ['A','B','C']},b

    def test_sector_jump_and_benchmark_adjustment(self):
        p,b=self.setup_data();r,_,_=synchrony_series(p,b,list(p))
        self.assertTrue(r.iloc[-1].up_anomaly)
        self.assertEqual(r.iloc[-1].up_baseline,0)
        b.loc[b.index[-1],'Close']=120
        r,_,_=synchrony_series(p,b,list(p))
        self.assertFalse(r.iloc[-1].up_sync)

    def test_missing_or_small_group_does_not_confirm(self):
        p,b=self.setup_data();p['C']=p['C'].iloc[:-1]
        r,_,_=synchrony_series(p,b,list(p))
        self.assertFalse(r.iloc[-1].eligible)
        r,_,_=synchrony_series(p,b,['A','B'])
        self.assertFalse(r.iloc[-1].up_sync)


if __name__=='__main__':unittest.main()
