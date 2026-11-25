"""Bound independent data producers and preserve their last complete snapshot."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
STAGES = {
    "daily": ("scripts/update_rotation_data.py", 900, (
        "rotation/forward_prices.json", "rotation/data.json",
        "rotation/institutional.json", "rotation/observations.json",
        "rotation/official_closes.json", "rotation/top100.json",
        "rotation/universe_current.json"), "rotation/data.json"),
    "etf": ("scripts/rotation_etf.py", 300, (
        "rotation/active_etf.json", "rotation/etf_history.json"),
        "rotation/active_etf.json"),
}


def run_stage(stage, root=ROOT, *, command=None, timeout=None):
    script, budget, outputs, report = STAGES[stage]
    root = Path(root)
    # Producers can write supporting files before their final report. Retain
    # the complete group so interruption cannot publish a mixed snapshot.
    before = {name: (root / name).read_bytes() if (root / name).exists()
              else None for name in outputs}
    try:
        result = subprocess.run(command or [sys.executable, "-u", script],
                                cwd=root, timeout=budget if timeout is None else timeout)
        code = result.returncode
        error = f"{stage} producer exited with code {code}"
    except subprocess.TimeoutExpired:
        code, error = 124, f"{stage} producer exceeded its time limit"
    except OSError as exc:
        code, error = 1, f"{stage} producer could not start: {exc}"
    if code == 0:
        return 0
    for name, content in before.items():
        path = root / name
        if content is None:
            path.unlink(missing_ok=True)
        else:
            temp = path.with_suffix(".restore.tmp")
            temp.write_bytes(content)
            temp.replace(path)
    # Preserve generated_at/as_of: a failed attempt is not a new observation.
    if before[report] is not None:
        old = json.loads(before[report])
        old.update(status="stale", last_attempt_at=datetime.now(timezone.utc).isoformat(),
                   error=error)
        path = root / report
        temp = path.with_suffix(".restore.tmp")
        temp.write_text(json.dumps(old, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                        encoding="utf-8")
        temp.replace(path)
    print(f"::error::{error}; retained the previous dated {stage} snapshot", flush=True)
    return code if code > 0 else 1


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in STAGES:
        raise SystemExit("Usage: run_rotation_update.py daily|etf")
    raise SystemExit(run_stage(sys.argv[1]))
