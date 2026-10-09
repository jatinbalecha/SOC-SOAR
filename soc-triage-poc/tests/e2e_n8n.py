#!/usr/bin/env python3
"""End-to-end pipeline test through a running n8n (uses the mock LLM server, NOT a model benchmark).
Usage: python tests/e2e_n8n.py [alert_id ...] --model mock-model"""
import argparse, json, sys, time
from pathlib import Path
import requests
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "benchmark"))
from run_benchmark import run_one, score_run, load_json  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("alerts", nargs="*", default=["ALRT-1001", "ALRT-2001", "ALRT-3001", "ALRT-4001", "ALRT-5001"])
ap.add_argument("--model", default="mock-model")
ap.add_argument("--base", default="http://localhost:5678")
ap.add_argument("--timeout", type=int, default=120)
a = ap.parse_args()
gt = load_json(ROOT / "data" / "ground_truth.json")
fails = 0
for aid in a.alerts:
    alert = load_json(ROOT / "data" / "alerts" / f"{aid}.json")
    cid, case, wall = run_one(a.base, "webhook", alert, a.model, a.timeout, 1.0)
    row = score_run(aid, a.model, 1, cid, case, wall, gt)
    ok = row.get("status") == gt[aid]["expected_status"]
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'} {aid} {a.model}: status={row.get('status')} route={row.get('route')} class={row.get('classification')} "
          f"score={row.get('risk_score')} flags={row.get('flags')} retries={row.get('retries')} halluc={row.get('hallucinated_ids')} "
          f"exc={row.get('exception_stage')} case={cid} {wall}s")
sys.exit(1 if fails else 0)
