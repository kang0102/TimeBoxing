import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import unittest
from datetime import datetime, timezone
import pandas as pd
from rotation_forward import build_forward_prices

class ForwardPricesTest(unittest.TestCase):
    def test_completed_bars_only_and_missing_open_not_fabricated(self):
        frame=pd.DataFrame({'Open':[10,float('nan'),13],'Close':[11,12,14],'High':[12,13,15],'Volume':[100,100,100]},index=pd.to_datetime(['2026-09-21','2026-09-22','2026-09-23']))
        config={'benchmarks':{'TW':'index'},'groups':[{'stocks':[['stock','name','TW']]}]}
        report=build_forward_prices(config,{'index':frame,'stock':frame},datetime(2026,9,23,2,tzinfo=timezone.utc))
        self.assertEqual(report['markets']['TW']['dates'],['2026-09-21','2026-09-22'])
        self.assertEqual(report['stocks']['stock']['bars'],[['2026-09-21',10,11]])
        self.assertNotIn('positions',report)
