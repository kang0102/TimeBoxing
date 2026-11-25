from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from run_rotation_update import STAGES, run_stage


class BoundedUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = {}
        for _, _, outputs, _ in STAGES.values():
            for name in outputs:
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                content = json.dumps({"as_of": "2026-11-24", "generated_at": "old",
                                      "status": "ok", "records": [1]}).encode()
                path.write_bytes(content)
                self.original[name] = content

    def command(self, stage, tail):
        names = list(STAGES[stage][2])
        source = ("from pathlib import Path; import time; "
                  + "; ".join(f"Path({name!r}).write_text('{{\"partial\":true}}')"
                              for name in names)
                  + "; " + tail)
        return [sys.executable, "-c", source]

    def assert_restored(self, stage):
        report = STAGES[stage][3]
        for name in STAGES[stage][2]:
            if name != report:
                self.assertEqual((self.root / name).read_bytes(), self.original[name])
        data = json.loads((self.root / report).read_text(encoding="utf-8"))
        self.assertEqual(data["as_of"], "2026-11-24")
        self.assertEqual(data["generated_at"], "old")
        self.assertEqual(data["records"], [1])
        self.assertEqual(data["status"], "stale")
        self.assertIn("last_attempt_at", data)

    def test_success_retains_new_outputs(self):
        self.assertEqual(run_stage("daily", self.root,
                         command=self.command("daily", "raise SystemExit(0)")), 0)
        for name in STAGES["daily"][2]:
            self.assertEqual(json.loads((self.root / name).read_text()), {"partial": True})
        for name in STAGES["etf"][2]:
            self.assertEqual((self.root / name).read_bytes(), self.original[name])

    def test_failed_daily_restores_all_outputs_and_reports_failure(self):
        self.assertEqual(run_stage("daily", self.root,
                         command=self.command("daily", "raise SystemExit(7)")), 7)
        self.assert_restored("daily")

    def test_timeout_restores_outputs_and_stops_child_before_late_write(self):
        marker = self.root / "late-write"
        self.assertEqual(run_stage("daily", self.root,
                         command=self.command("daily", "time.sleep(30); Path('late-write').touch()"),
                         timeout=1), 124)
        self.assert_restored("daily")
        self.assertFalse(marker.exists())

    def test_failed_etf_keeps_successful_daily_and_removes_new_partial_file(self):
        self.assertEqual(run_stage("daily", self.root,
                         command=self.command("daily", "raise SystemExit(0)")), 0)
        saved = {n: (self.root / n).read_bytes() for n in STAGES["daily"][2]}
        (self.root / "rotation/etf_history.json").unlink()
        self.assertEqual(run_stage("etf", self.root,
                         command=self.command("etf", "raise SystemExit(1)")), 1)
        self.assertFalse((self.root / "rotation/etf_history.json").exists())
        for name, content in saved.items():
            self.assertEqual((self.root / name).read_bytes(), content)
        report = json.loads((self.root / "rotation/active_etf.json").read_text(encoding="utf-8"))
        self.assertEqual(report["generated_at"], "old")
        self.assertEqual(report["status"], "stale")


if __name__ == "__main__":
    unittest.main()
