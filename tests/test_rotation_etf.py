from copy import deepcopy
from pathlib import Path
import sys
import unittest
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from rotation_etf import nav_rows, risks, parse_holdings, parse_daily, official_trend, overlap, latest_holdings
from rotation_universe import rank_top100, expand_universe


class ETFTests(unittest.TestCase):
    def test_pending_holdings_retain_real_dates_without_future_or_duplicate_baseline(self):
        fund = {'code':'00980A','status':'ok','units':1000,'holdings':[{'code':'2330','shares':100,'weight_pct':50}]}
        days = {d:{'holdings':{'00980A':{**fund,'as_of':d}}} for d in ['2026-09-17','2026-09-18','2026-09-22']}
        days['2026-09-21'] = {'holdings':{'00985A':{**fund,'as_of':'2026-09-18'}}}
        current, previous = latest_holdings(days,'2026-09-21')
        self.assertEqual(list(current), ['00980A'])
        self.assertEqual(current['00980A']['as_of'], '2026-09-18')
        self.assertEqual(previous['00980A']['as_of'], '2026-09-17')
        self.assertNotIn('00980A', days['2026-09-21']['holdings'])
        self.assertEqual(latest_holdings(days,'2026-09-16'), ({},{}))

    def setUp(self):
        self.basic = [{'基金代號':'00980A','基金簡稱':'測試基金','基金類型':'國內成分證券主動式交易所交易基金(股票)','出表日期':'1150918'}]
        self.raw = {'a':'00980A','c':'900','d':'-100','e':'10.2','f':'10','g':'2','i':'20260918','j':'15:00:00','k':1}

    def parse(self, **changes):
        return nav_rows({'a1':[{'rtCode':'0000','msgArray':[{**self.raw, **changes}]}]}, self.basic, '2026-09-18')[0]

    def test_redemptions_use_previous_units_not_current_units(self):
        row = self.parse()
        self.assertEqual(row['status'], 'ok')
        self.assertEqual(row['units_change_pct'], -10)
        self.assertEqual(len(risks(row)), 2)

    def test_stale_future_unfinished_invalid_data_never_become_zero_risk(self):
        for changes in [{'i':'20260917'},{'i':'20260919'},{'j':'10:00:00'},{'f':'0'},{'d':'900'},{'g':'nan'},{'g':'20'}]:
            self.assertEqual(self.parse(**changes)['status'], 'unavailable')

    def test_foreign_fund_excluded_and_string_market_supported(self):
        self.assertEqual(self.parse(k='1')['status'], 'ok')
        self.basic[0]['基金類型'] = '國外成分證券主動式交易所交易基金(股票)'
        self.assertEqual(nav_rows({'a1':[]}, self.basic, '2026-09-18'), [])

    def test_official_history_requires_every_session_and_blocks_ex_distribution(self):
        dates = pd.bdate_range('2026-08-21', periods=21)
        prices = {d.date().isoformat():{'close':10+i/10,'corporate_action':False} for i,d in enumerate(dates)}
        result = official_trend(prices, dates)
        self.assertEqual(result['return_20d'], 20)
        self.assertAlmostEqual(result['ma20'], 11.05)
        missing = deepcopy(prices); missing.pop(dates[-2].date().isoformat())
        with self.assertRaises(ValueError): official_trend(missing, dates)
        prices[dates[-2].date().isoformat()]['corporate_action'] = True
        with self.assertRaises(ValueError): official_trend(prices, dates)

    def test_month_report_rejects_wrong_symbol_and_detects_corporate_action(self):
        p = {'stat':'OK','date':'20260901','title':'115年09月 00980A 基金 各日成交資訊',
             'fields':['日期','收盤價','漲跌價差','註記'],'data':[['115/09/18','12.3','X0.00','']]}
        self.assertTrue(parse_daily(p,'00980A','202609','2026-09-18')['2026-09-18']['corporate_action'])
        with self.assertRaises(ValueError): parse_daily(p,'00981A','202609','2026-09-18')

    def test_holdings_checks_date_columns_duplicates_and_weight(self):
        p = {'StatusCode':0,'Entries':{'FundID':'00980A','Data':{'FundAsset':{'Aum':'10000','Units':'1000','NavDate':'2026/09/18'},
             'Table':[{'TableTitle':'股票','NavDate':'2026/09/18','Columns':[{'Name':s} for s in ['股票代號','股票名稱','股數','權重(%)']],
                       'Rows':[['2330','台積電','100','70']]}]}}}
        self.assertEqual(parse_holdings(p,'00980A','2026-09-18')['top10_weight_pct'],70)
        with self.assertRaises(ValueError): parse_holdings(p,'00980A','2026-09-17')
        p['Entries']['Data']['Table'][0]['Rows'] *= 2
        with self.assertRaises(ValueError): parse_holdings(p,'00980A','2026-09-18')

    def test_unit_normalization_avoids_false_sell_and_catches_full_exit(self):
        old = {'code':'00980A','as_of':'2026-09-17','units':1000,'holdings':[{'code':'2330','name':'台積電','shares':100,'weight_pct':50},{'code':'2454','name':'聯發科','shares':100,'weight_pct':20}]}
        new = {'code':'00980A','as_of':'2026-09-18','units':500,'holdings':[{'code':'2330','name':'台積電','shares':50,'weight_pct':50}]}
        result = {r['code']:r for r in overlap([new],{'00980A':old},[],{})}
        self.assertEqual(result['2330']['reduced_funds'], [])
        self.assertEqual(result['2454']['reduced_funds'][0]['per_unit_change_pct'], -100)
        self.assertIsNone(result['2330']['ordinary_shares_pct'])

    def test_subscription_growth_is_not_accumulation_and_new_needs_baseline(self):
        old = {'code':'00980A','as_of':'2026-09-17','units':1000,'holdings':[{'code':'2330','name':'台積電','shares':100,'weight_pct':50}]}
        new = {'code':'00980A','as_of':'2026-09-18','units':2000,'holdings':[{'code':'2330','name':'台積電','shares':200,'weight_pct':50},{'code':'2454','name':'聯發科','shares':20,'weight_pct':5}]}
        result = {r['code']:r for r in overlap([new],{'00980A':old},[],{})}
        self.assertEqual(result['2330']['increased_funds'], [])
        self.assertEqual(result['2454']['new_funds'][0]['previous_date'], '2026-09-17')
        for baseline in [{}, {'00980A':{**old,'as_of':'2026-09-18'}}, {'00980A':{**old,'as_of':'2026-09-19'}}]:
            self.assertTrue(all(not r['new_funds'] and not r['increased_funds'] and not r['reduced_funds'] for r in overlap([new],baseline,[],{})))

    def test_per_unit_increase_retains_weights_and_mixed_fund_directions(self):
        old = {'code':'00980A','as_of':'2026-09-17','units':1000,'holdings':[{'code':'2330','name':'台積電','shares':100,'weight_pct':10}]}
        new = {'code':'00980A','as_of':'2026-09-18','units':2000,'holdings':[{'code':'2330','name':'台積電','shares':240,'weight_pct':12}]}
        seller = {**new,'code':'00985A','holdings':[{**new['holdings'][0],'shares':100}]}
        r = overlap([new,seller],{'00980A':old,'00985A':{**old,'code':'00985A'}},[],{})[0]
        self.assertEqual(r['increased_funds'][0]['per_unit_change_pct'],20)
        self.assertEqual(r['increased_funds'][0]['previous_weight_pct'],10)
        self.assertEqual(r['increased_funds'][0]['weight_pct'],12)
        self.assertEqual(r['reduced_funds'][0]['per_unit_change_pct'],-50)


class UniverseTests(unittest.TestCase):
    def test_all_market_ranking_and_supplement_preservation(self):
        companies = [{'公司代號':str(code),'公司簡稱':str(code),'已發行普通股數或TDR原股發行股數':'1000','出表日期':'1150917'} for code in range(1000,2501)]
        quotes = {str(code)+'.TW':{'date':'2026-09-18','Close':code-999} for code in range(1000,2501)}
        companies += [{'公司代號':'00981A'},{'公司代號':'9105'}]
        rows, count = rank_top100(companies, quotes, [], {}, '2026-09-18')
        self.assertEqual(count,1501); self.assertEqual(len(rows),100);self.assertEqual(rows[0]['symbol'],'2500.TW')
        base = {'groups':[{'id':'research','stocks':[['1000.TW','補充','TW'],['2500.TW','百大','TW']]}]}
        for r in rows:r['industry']='產業'
        config = expand_universe(base, {'stocks':rows,'as_of':'2026-09-18'})
        symbols = [s[0] for g in config['groups'] for s in g['stocks']]
        self.assertEqual(len(symbols),101);self.assertEqual(len(set(symbols)),101)
        self.assertEqual(len(base['groups']),1)
        with self.assertRaises(ValueError): rank_top100(companies,{},[],{},'2026-09-18')


if __name__ == '__main__': unittest.main()
