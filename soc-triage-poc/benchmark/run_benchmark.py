#!/usr/bin/env python3
"""
Model-comparison benchmark for the SOC triage PoC.

Runs every alert x every model x N repeats through the SAME n8n webhook
(/soc-triage), so every model gets identical prompts, evidence, schemas and
code-side scoring. Polls /soc-read until the case leaves PROCESSING, then scores
the stored case against data/ground_truth.json.

Outputs (benchmark/results/):
  runs.csv                one row per run (raw evidence for the report)
  summary_by_model.csv    one row per model (what the Streamlit page reads)
  explanation_rubric.csv  blank sheet for blind human scoring of summaries (1-5)

Usage:
  python benchmark/run_benchmark.py --repeats 3          (default: every non-optional model in the config)
  python benchmark/run_benchmark.py --dry-run          # print the plan only

Mock models are refused unless --allow-mock is passed; mock output must never be
reported as a model result.
"""
import argparse
import csv
import json
import os
import random
import statistics
import string
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "benchmark" / "results"
LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
ESCALATING_ROUTES = {"ESCALATE", "EXCEPTION"}


def load_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def jparse(s, default=None):
    if isinstance(s, (dict, list)):
        return s
    try:
        return json.loads(s) if s else default
    except (TypeError, ValueError):
        return default


def level_diff(a, b):
    if a in LEVELS and b in LEVELS:
        return abs(LEVELS.index(a) - LEVELS.index(b))
    return None


def new_case_id(alert_id):
    tag = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"CASE-{alert_id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{tag}"


def run_one(base, hook, alert, model, timeout_s, poll_s):
    case_id = new_case_id(alert.get("alert_id", "UNK"))
    t0 = time.time()
    r = requests.post(f"{base}/{hook}/soc-triage",
                      json={"case_id": case_id, "alert": alert, "model": model}, timeout=30)
    r.raise_for_status()
    case = None
    while time.time() - t0 < timeout_s:
        time.sleep(poll_s)
        try:
            data = requests.get(f"{base}/{hook}/soc-read",
                                params={"resource": "case", "id": case_id}, timeout=20).json()
        except (requests.RequestException, ValueError):
            continue
        case = data.get("case")
        if case and case.get("status") and case["status"] != "PROCESSING":
            break
    wall = round(time.time() - t0, 1)
    return case_id, case, wall


def score_run(alert_id, model, rep, case_id, case, wall, gt):
    exp = gt[alert_id]
    row = {"alert_id": alert_id, "model": model, "repeat": rep, "case_id": case_id, "wall_s": wall}
    if not case or case.get("status") in (None, "PROCESSING"):
        row.update(status="TIMEOUT", task_completed=0, route="", classification="", model_class="")
        return row
    risk = jparse(case.get("risk_json"), {}) or {}
    stats = jparse(case.get("agent_stats_json"), []) or []
    route = case.get("route") or ""
    status = case.get("status")
    comp_class = case.get("classification") or ""
    model_class = risk.get("proposed_classification", "")
    esc_actual = route in ESCALATING_ROUTES
    exception_expected = exp["expected_route"] == "EXCEPTION"
    # calls whose first attempt was throttled by the provider (HTTP 429) say nothing about the model's JSON ability
    judged = [s for s in stats if s.get("first_attempt_valid") is not None and not s.get("rate_limited")]

    row.update(
        status=status,
        route=route,
        expected_route=exp["expected_route"],
        route_match=int(route == exp["expected_route"]),
        classification=comp_class,
        model_class=model_class,
        expected_class=exp["expected_class"] or "",
        class_exact=(int(comp_class == exp["expected_class"]) if exp["expected_class"] else ""),
        class_within_one=(int((lambda d: d is not None and d <= 1)(level_diff(comp_class, exp["expected_class"]))) if exp["expected_class"] else ""),
        model_class_exact=(int(model_class == exp["expected_class"]) if exp["expected_class"] else ""),
        category_match=(int(risk.get("incident_category") == exp["expected_category"]) if exp["expected_category"] else ""),
        action=risk.get("recommended_action", ""),
        action_match=(int(risk.get("recommended_action") in exp["expected_actions"]) if exp["expected_actions"] else ""),
        escalation_correct=int(esc_actual == exp["expected_escalate"]),
        false_positive=int(esc_actual and not exp["expected_escalate"]),
        false_negative=int((not esc_actual) and exp["expected_escalate"]),
        risk_score=case.get("risk_score"),
        confidence=case.get("confidence"),
        flags=case.get("flags") or "",
        hallucinated_ids=int(case.get("hallucinated_ids") or 0),
        llm_calls=len(stats),
        judged_calls=len(judged),
        first_attempt_valid=sum(1 for s in judged if s.get("first_attempt_valid")),
        rate_limited_calls=sum(1 for s in stats if s.get("rate_limited")),
        retries=int(case.get("retries") or 0),
        llm_latency_ms=int(case.get("total_latency_ms") or 0),
        exception_stage=case.get("exception_stage") or "",
        # completed = reached the state the design expects (routed for 1-3, controlled exception for 4-5)
        task_completed=int(route == "EXCEPTION" if exception_expected else route in ("ESCALATE", "REVIEW", "CONFIRM_CLOSURE")),
        unexpected_exception=int(route == "EXCEPTION" and not exception_expected),
    )
    return row


def mean(xs):
    xs = [x for x in xs if x != "" and x is not None]
    return round(sum(xs) / len(xs), 3) if xs else ""


def summarise(rows):
    out = []
    for model in sorted({r["model"] for r in rows}):
        rs = [r for r in rows if r["model"] == model]
        llm_rs = [r for r in rs if r.get("expected_route") != "EXCEPTION"]  # cases 4-5 never reach a model
        calls = sum(r.get("judged_calls", 0) or 0 for r in llm_rs)
        lat = [r["llm_latency_ms"] / 1000 for r in llm_rs if r.get("llm_latency_ms")]
        out.append({
            "model": model,
            "runs": len(rs),
            "classification_exact": mean([r.get("class_exact") for r in llm_rs]),
            "classification_within_one": mean([r.get("class_within_one") for r in llm_rs]),
            "model_proposal_exact": mean([r.get("model_class_exact") for r in llm_rs]),
            "category_match": mean([r.get("category_match") for r in llm_rs]),
            "action_match": mean([r.get("action_match") for r in llm_rs]),
            "route_match": mean([r.get("route_match") for r in rs]),
            "escalation_accuracy": mean([r.get("escalation_correct") for r in rs]),
            "false_positives": sum(r.get("false_positive", 0) or 0 for r in rs),
            "false_negatives": sum(r.get("false_negative", 0) or 0 for r in rs),
            "hallucinated_ids": sum(r.get("hallucinated_ids", 0) or 0 for r in llm_rs),
            "json_first_attempt_rate": round(sum(r.get("first_attempt_valid", 0) or 0 for r in llm_rs) / calls, 3) if calls else "",
            "retries": sum(r.get("retries", 0) or 0 for r in llm_rs),
            "rate_limited_calls": sum(r.get("rate_limited_calls", 0) or 0 for r in llm_rs),
            "median_case_llm_latency_s": round(statistics.median(lat), 1) if lat else "",
            "task_completion": mean([r.get("task_completed") for r in rs]),
            "unexpected_exceptions": sum(r.get("unexpected_exception", 0) or 0 for r in rs),
            "explanation_quality_1to5": "",  # fill from explanation_rubric.csv after blind scoring
        })
    return out


def write_csv(path, rows):
    if not rows:
        return
    keys = []
    for r in rows:
        keys += [k for k in r if k not in keys]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def main():
    cfg = load_json(ROOT / "config" / "soc_config.json")
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("N8N_BASE_URL", "http://localhost:5678"))
    ap.add_argument("--hook", default=os.environ.get("N8N_WEBHOOK_PREFIX", "webhook"))
    default_models = [m["id"] for m in cfg["models"] if not m["id"].startswith("mock") and not m.get("optional")]
    ap.add_argument("--models", nargs="+", default=default_models, help="default: every non-optional, non-mock model in the config")
    ap.add_argument("--alerts", nargs="+", default=["ALRT-1001", "ALRT-2001", "ALRT-3001", "ALRT-4001", "ALRT-5001"])
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=900, help="seconds per case")
    ap.add_argument("--poll", type=float, default=3.0)
    ap.add_argument("--allow-mock", action="store_true", help="pipeline self-test only; never report as results")
    ap.add_argument("--out", default=str(RESULTS))
    ap.add_argument("--append", action="store_true", help="add to existing runs.csv (e.g. one model per day under free-tier daily limits)")
    ap.add_argument("--pause", type=float, default=0, help="seconds to wait between runs (use with free hosted APIs)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    known = {m["id"] for m in cfg["models"]}
    for m in a.models:
        if m not in known:
            sys.exit(f"Model '{m}' is not in config/soc_config.json (the workflow would reject it).")
        if m.startswith("mock") and not a.allow_mock:
            sys.exit(f"'{m}' is a mock model. Mock output is not a benchmark result. Use --allow-mock only for a pipeline self-test.")

    gt = load_json(ROOT / "data" / "ground_truth.json")
    alerts = {aid: load_json(ROOT / "data" / "alerts" / f"{aid}.json") for aid in a.alerts}
    plan = [(aid, m, rep) for rep in range(1, a.repeats + 1) for m in a.models for aid in a.alerts]
    print(f"{len(plan)} runs: {len(a.alerts)} alerts x {len(a.models)} models x {a.repeats} repeats -> {a.base}/{a.hook}")
    if a.dry_run:
        for p in plan:
            print("  ", *p)
        return

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    if a.append and (out / "runs.csv").exists():
        with open(out / "runs.csv", newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                for k, v in r.items():  # restore numbers
                    try:
                        r[k] = int(v)
                    except (TypeError, ValueError):
                        try:
                            r[k] = float(v)
                        except (TypeError, ValueError):
                            pass
                rows.append(r)
        print(f"appending to {len(rows)} existing runs")
    for i, (aid, m, rep) in enumerate(plan, 1):
        print(f"[{i}/{len(plan)}] {aid}  {m}  rep {rep} ...", end=" ", flush=True)
        try:
            cid, case, wall = run_one(a.base, a.hook, alerts[aid], m, a.timeout, a.poll)
            row = score_run(aid, m, rep, cid, case, wall, gt)
        except requests.RequestException as e:
            row = {"alert_id": aid, "model": m, "repeat": rep, "status": "HTTP_ERROR", "task_completed": 0, "error": str(e)[:200]}
        rows.append(row)
        print(row.get("status"), row.get("route", ""), row.get("classification", ""), f"{row.get('wall_s', '')}s")
        write_csv(out / "runs.csv", rows)  # write as we go, so a crash keeps evidence
        if a.pause and i < len(plan):
            time.sleep(a.pause)

    write_csv(out / "summary_by_model.csv", summarise(rows))
    # blind rubric sheet: shuffled, model hidden behind a code
    all_models = sorted({r["model"] for r in rows})
    codes = {m: f"M{j + 1}" for j, m in enumerate(random.sample(all_models, len(all_models)))}
    rub = [{"blind_code": codes[r["model"]], "case_id": r.get("case_id", ""), "alert_id": r["alert_id"],
            "scorer_1": "", "scorer_2": "", "notes": ""} for r in rows if r.get("route") not in ("", "EXCEPTION", None)]
    random.shuffle(rub)
    write_csv(out / "explanation_rubric.csv", rub)
    with open(out / "blind_key.json", "w") as f:
        json.dump({v: k for k, v in codes.items()}, f, indent=2)
    print(f"\nWrote {out/'runs.csv'}, {out/'summary_by_model.csv'}, {out/'explanation_rubric.csv'} (keep blind_key.json away from scorers)")


if __name__ == "__main__":
    main()
