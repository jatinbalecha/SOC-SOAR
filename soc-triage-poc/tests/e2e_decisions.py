#!/usr/bin/env python3
"""End-to-end HITL tests against a running n8n: needs fresh cases from tests/e2e_n8n.py (mock model)."""
import os, sys, requests
B = os.environ.get("N8N_BASE_URL", "http://localhost:5678").rstrip("/") + "/webhook"
def latest(alert_id, status):
    cs = requests.get(f"{B}/soc-read", params={"resource": "cases"}, timeout=20).json()["cases"]
    cs = [c for c in cs if c["alert_id"] == alert_id and c["status"] == status]
    return sorted(cs, key=lambda c: c["created_at"])[-1]["case_id"] if cs else None
def post(body):
    r = requests.post(f"{B}/soc-decision", json=body, timeout=30)
    return r.status_code, r.json()
T = []
def check(name, cond, info):
    T.append(cond); print(("PASS " if cond else "FAIL ") + name, "|", str(info)[:160])

crit = latest("ALRT-3001", "ESCALATED_PENDING_APPROVAL")
med = latest("ALRT-2001", "PENDING_ANALYST_REVIEW")
low = latest("ALRT-1001", "PENDING_CLOSURE_CONFIRMATION")
exc = latest("ALRT-4001", "EXCEPTION_MANUAL_QUEUE")
print("cases:", crit, med, low, exc)

c, r = post({"case_id": crit, "decision": "APPROVE", "analyst_id": "t1.analyst01"})
check("Tier1 cannot approve CRITICAL", c >= 400 and not r.get("ok"), (c, r))
c, r = post({"case_id": crit, "decision": "APPROVE", "analyst_id": "t2.analyst02"})
check("Tier2 cannot isolate CRITICAL asset", c >= 400 and not r.get("ok"), (c, r))
c, r = post({"case_id": crit, "decision": "MODIFY", "analyst_id": "t1.analyst01", "modified_class": "LOW", "modified_action": "CLOSE_AS_BENIGN", "note": "downgrade attempt"})
check("Tier1 cannot downgrade CRITICAL to LOW to gain authority", c >= 400 and not r.get("ok"), (c, r))
c, r = post({"case_id": med, "decision": "MODIFY", "analyst_id": "t1.analyst01", "modified_action": "MONITOR", "note": "watch for 24h"})
check("Tier1 modifies MEDIUM case within authority", c < 400 and r.get("ok"), (c, r))
c, r = post({"case_id": exc, "decision": "APPROVE", "analyst_id": "lead.soc"})
check("APPROVE refused on exception case", c >= 400 and not r.get("ok"), (c, r))
c, r = post({"case_id": exc, "decision": "REJECT", "analyst_id": "t2.analyst02"})
check("REJECT without reason code refused", c >= 400 and not r.get("ok"), (c, r))
c, r = post({"case_id": crit, "decision": "APPROVE", "analyst_id": "fake.admin"})
check("Unknown analyst refused", c >= 400 and not r.get("ok"), (c, r))
c, r = post({"case_id": crit, "decision": "MODIFY", "analyst_id": "lead.soc", "modified_action": "RM_RF_SERVER", "note": "bad action test"})
check("Off-allow-list action refused", c >= 400 and not r.get("ok"), (c, r))
c, r = post({"case_id": crit, "decision": "APPROVE", "analyst_id": "lead.soc", "note": "confirmed"})
check("Lead approves CRITICAL (simulated action)", c < 400 and r.get("ok"), (c, r))
c, r = post({"case_id": crit, "decision": "APPROVE", "analyst_id": "lead.soc"})
check("Second decision on decided case refused", c >= 400 and not r.get("ok"), (c, r))
c, r = post({"case_id": exc, "decision": "REJECT", "analyst_id": "t2.analyst02", "reason_code": "AI_ERROR_OR_HALLUCINATION", "note": "injection"})
check("Tier2 rejects exception case -> manual", c < 400 and r.get("ok"), (c, r))
c, r = post({"case_id": low, "decision": "APPROVE", "analyst_id": "t1.analyst01"})
check("Tier1 confirms LOW closure", c < 400 and r.get("ok"), (c, r))
print(f"\n{sum(T)}/{len(T)} passed")
sys.exit(0 if all(T) else 1)
