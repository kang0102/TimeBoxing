from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from rotation_universe import expand_universe, LEGACY_IDENTITY_NOTE


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.base = json.loads((ROOT / 'rotation/universe.json').read_text(encoding='utf-8'))

    def test_live_correction_preserves_original_symbols_and_does_not_mutate_baseline(self):
        original = deepcopy(self.base)
        live = expand_universe(self.base, {'stocks': [], 'as_of': '2026-10-30'})
        rows = [s for g in live['groups'] for s in g['stocks']]
        expected = [s for g in original['groups'] for s in g['stocks']]
        self.assertEqual(self.base, original)
        self.assertEqual(sorted(s[0] for s in rows), sorted(s[0] for s in expected))
        self.assertEqual(sum(s[2] == 'TW' for s in rows), 39)
        optical = next(g for g in live['groups'] if g['id'] == 'optical')
        self.assertEqual([s[0] for s in optical['stocks'] if s[2] == 'TW'], ['3081.TWO', '3363.TWO'])
        corrected = next(g for g in live['groups'] if g['id'] == 'industry-半導體業')
        self.assertEqual(corrected['stocks'], [['6531.TW', '愛普*', 'TW']])
        self.assertIn('暫不據此判斷', live['identity_corrections'][0]['note'])

    def test_top100_merge_is_unique_and_does_not_substitute_a_different_stock(self):
        top = {'as_of': '2026-10-30', 'stocks': [
            {'symbol': '6531.TW', 'name': '愛普*', 'industry': '半導體業'},
            {'symbol': '9999.TW', 'name': 'Example', 'industry': '半導體業'}]}
        live = expand_universe(self.base, top)
        again = expand_universe(live, top)
        self.assertEqual(live, again)
        groups = [g for g in live['groups'] if g['id'] == 'industry-半導體業']
        self.assertEqual(len(groups), 1)
        self.assertEqual({s[0] for s in groups[0]['stocks']}, {'9999.TW', '6531.TW'})
        self.assertNotIn('6442.TW', [s[0] for g in live['groups'] for s in g['stocks']])

    def test_no_optical_catalyst_is_attached_to_ap_memory(self):
        events = json.loads((ROOT / 'rotation/catalysts.json').read_text(encoding='utf-8'))['events']
        self.assertFalse(any(r['symbol'] == '6531.TW' for e in events for r in e['relationships']))
        legacy = next(g for g in self.base['groups'] if g['id'] == 'optical')
        self.assertIn(['6531.TW', '愛普*', 'TW'], legacy['stocks'])
        self.assertIn('原39檔', LEGACY_IDENTITY_NOTE)


if __name__ == '__main__':
    unittest.main()
