from datetime import datetime
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from rotation_intraday import parse_quote, assess, baseline, session

class IntradayTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime.fromisoformat('2026-09-21T10:00:00+08:00')
        self.raw={'c':'2330','ex':'tse','d':'20260921','t':'09:59:00','z':'105','y':'100','h':'106','l':'99','v':'1000'}
        self.row={'symbol':'2330.TW','name':'Example','group':'chips','group_name':'Chips','status':'ok','as_of':'2026-09-18','close':100,'ma20':98,'next_session_high20':104,'next_session_volume_mean20':2000000}
        self.quote=parse_quote(self.raw,'tse_2330.tw',self.now)
        self.index={**self.quote,'change_pct':1}
    def test_identity_missing_price_future_and_invalid_range(self):
        for change in [{'c':'2454'},{'z':'-'},{'z':'NaN'},{'d':'20260922'},{'h':'104'},{'t':'08:59:00'}]:
            with self.assertRaises((ValueError,KeyError)):parse_quote({**self.raw,**change},'tse_2330.tw',self.now)
    def test_partial_volume_does_not_confirm_a_buy(self):
        result=assess(self.row,self.quote,self.index,self.now)
        self.assertEqual(result['signal'],'breakout')
        self.assertEqual(result['volume_progress_ratio'],.5)
        self.assertNotIn('buy',result)
    def test_fade_and_defense_override_temporary_strength(self):
        self.assertEqual(assess(self.row,{**self.quote,'price':103},self.index,self.now)['signal'],'fade')
        self.assertEqual(assess(self.row,{**self.quote,'price':97},self.index,self.now)['signal'],'defend')
    def test_old_quote_and_missing_market_never_trigger(self):
        for q in [{**self.quote,'quote_date':'2026-09-18'},{**self.quote,'quote_at':'2026-09-21T09:20:00+08:00'}]:
            self.assertEqual(assess(self.row,q,self.index,self.now)['status'],'unavailable')
        self.assertEqual(assess(self.row,self.quote,{**self.index,'quote_date':'2026-09-18'},self.now)['status'],'unavailable')
    def test_corporate_actions_missing_levels_and_old_baselines_block(self):
        for change in [{'close':110},{'next_session_high20':None},{'as_of':'2026-09-14'}]:
            self.assertEqual(assess({**self.row,**change},self.quote,self.index,self.now)['status'],'unavailable')
    def test_same_day_daily_data_uses_prior_session_not_lookahead(self):
        row={**self.row,'as_of':'2026-09-21','close':105,'ma20':105,'next_session_high20':120,
             'prior_session':{'as_of':'2026-09-18','close':100,'ma20':98,'high20':104,'volume_mean20':2000000}}
        self.assertEqual(baseline(row,self.quote)['high20'],104)
        self.assertEqual(assess(row,self.quote,self.index,self.now)['signal'],'breakout')
    def test_after_close_is_labelled_separately_and_weekend_is_not_live(self):
        now=datetime.fromisoformat('2026-09-21T14:10:00+08:00')
        quote={**self.quote,'quote_at':'2026-09-21T13:30:00+08:00'}
        self.assertEqual(session(now),'after_close')
        self.assertEqual(assess(self.row,quote,quote,now)['status'],'ok')
        self.assertEqual(session(datetime.fromisoformat('2026-09-20T10:00:00+08:00')),'weekend')

if __name__=='__main__':unittest.main()
