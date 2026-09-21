import unittest
import sys
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from train_rotation_weights import components,choose
from rotation_signals import analyze

class WeightTests(unittest.TestCase):
    def test_components_do_not_see_future(self):
        dates=pd.bdate_range('2024-01-01',periods=100)
        f=pd.DataFrame({'Open':100.,'Close':np.arange(100)+100.,'High':np.arange(100)+101.,'Volume':1000.},index=dates)
        b=f.copy();b['Close']=100.
        _,before=components(f,b)
        f.loc[dates[80]:,['Close','High','Volume']]=[999,1000,99999]
        _,after=components(f,b)
        pd.testing.assert_frame_equal(before.iloc[:80],after.iloc[:80])
        self.assertTrue(((before.dropna()>=0)&(before.dropna()<=1)).all().all())

    def test_baseline_components_reproduce_published_score(self):
        dates=pd.bdate_range('2024-01-01',periods=100)
        f=pd.DataFrame({'Open':100.,'Close':np.arange(100)*.2+100.,'High':np.arange(100)*.2+101.,'Volume':np.arange(100)+1000.},index=dates)
        b=f.copy();b['Close']=100.
        _,c=components(f,b)
        self.assertEqual(round(float(c.iloc[-1].to_numpy().dot([35,20,20,15,10])),1),analyze(f,b)['score'])

    def test_training_only_selection_sample_gate_and_tie(self):
        config={'drawdown_penalty':{'balanced':.75},'minimum_training_trades':30,'minimum_fold_trades':5}
        fold={'trades':12,'forced_exits':1,'annualized_pct':20,'max_drawdown_pct':-10}
        baseline=[fold]*3
        too_small=[{**fold,'trades':3,'annualized_pct':999}]*3
        self.assertEqual(choose([baseline,too_small,baseline],config,'balanced')[0],0)
        better=[{**fold,'annualized_pct':21}]*3
        self.assertEqual(choose([baseline,better],config,'balanced')[0],1)

    def test_insufficient_all_candidates_keeps_baseline(self):
        config={'drawdown_penalty':{'balanced':.75},'minimum_training_trades':30,'minimum_fold_trades':5}
        low=[{'trades':1,'forced_exits':1,'annualized_pct':999,'max_drawdown_pct':0}]*3
        self.assertEqual(choose([low,low],config,'balanced')[0],0)

if __name__=='__main__': unittest.main()
