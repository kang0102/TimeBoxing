from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from rotation_briefing import build_briefings


class BriefingTests(unittest.TestCase):
    def setUp(self):
        self.case = {"id":"case","market":"TW","as_of":"2026-09-18","status":"diffusing",
                     "leaders":["L"],"followers":["H","W"],"rules":{"volume_ratio_min":1.5},
                     "positions":[{"symbol":s,"wave":3,"role":"接棒候選"} for s in ["H","W","D"]]}
        base={"market":"TW","status":"ok","as_of":"2026-09-18","close":100,"ma20":90,"previous_high20":105,
              "change_1d":2,"return_20d":10,"volume_ratio":1.7,"rs_5d":2,"above_ma20":True,"breakout_20d":False,
              "stage":"watch","smart_money":{"bias":"buying"}}
        self.rows=[{**base,"symbol":s,"name":s} for s in ["H","W","D"]]
        self.rows[0].update(stage="extended",breakout_20d=True,return_20d=30,close=110)
        self.rows[2].update(close=80,above_ma20=False,rs_5d=-1)

    def test_next_wave_excludes_hot_and_still_falling_stocks(self):
        result=build_briefings(self.rows,[self.case])[0]
        self.assertEqual(result["focus_symbols"],["W"])
        self.assertEqual([item["category"] for item in result["items"]],["hot","watch","wait"])
        self.assertEqual(result["items"][1]["checks"][0]["target"],105)

    def test_weakening_expired_or_stale_never_produce_priority_candidates(self):
        for state in ["weakening","expired","pending","unavailable"]:
            self.case["status"]=state
            self.assertEqual(build_briefings(self.rows,[self.case])[0]["focus_symbols"],[])
        self.case["status"]="diffusing"
        self.rows[1]["status"]="stale"
        self.assertEqual(build_briefings(self.rows,[self.case])[0]["focus_symbols"],[])


if __name__ == "__main__":
    unittest.main()
