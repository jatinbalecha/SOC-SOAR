"""
SOC Triage Console — Streamlit UI for the governed agentic SOC triage PoC.
Talks ONLY to three n8n webhooks:
  POST {N8N}/webhook/soc-triage     start triage (returns immediately)
  GET  {N8N}/webhook/soc-read       cases / case / audit
  POST {N8N}/webhook/soc-decision   analyst decision (HITL)
Run:  N8N_BASE_URL=http://localhost:5678 streamlit run app.py
"""
import json
import os
import uuid
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
ALERT_DIR = ROOT / "data" / "alerts"
BENCH_CSV = ROOT / "benchmark" / "results" / "summary_by_model.csv"
BENCH_RUNS = ROOT / "benchmark" / "results" / "runs.csv"
def setting(name, default=""):
    """Environment variable first, then Streamlit Cloud's Secrets box, then the default."""
    v = os.environ.get(name)
    if v:
        return v
    try:
        return str(st.secrets.get(name, default))
    except Exception:  # no secrets file locally
        return default


N8N = setting("N8N_BASE_URL", "http://localhost:5678").rstrip("/")
CFG = json.loads((ROOT / setting("SOC_CONFIG", "config/soc_config.json")).read_text())
POLL_SECONDS = float(setting("POLL_SECONDS", "3"))  # raise on n8n Cloud: every poll is a billed execution
HOOK = setting("N8N_WEBHOOK_PREFIX", "webhook")  # use "webhook-test" while testing in the editor

st.set_page_config(page_title="SOC Triage Console", page_icon="🛡️", layout="wide")

# Optional access gate for hosted demos (set APP_PASSWORD as a secret on the host).
# Protects the API quota and the demo data; it is NOT analyst authentication (roles stay a demo selector).
_APP_PW = setting("APP_PASSWORD", "")
if _APP_PW and not st.session_state.get("_authed"):
    import hmac
    st.title("SOC Triage Console")
    st.caption("Hosted demo of a governed agentic AI proof of concept. All alerts are synthetic; all actions are simulated.")
    _entered = st.text_input("Access password", type="password")
    if _entered:
        if hmac.compare_digest(_entered.encode(), _APP_PW.encode()):
            st.session_state["_authed"] = True
            st.rerun()
        st.error("Incorrect password.")
    st.stop()

# ---------------------------------------------------------------- styling
st.markdown(
    """
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root { --ink:#1C2430; --graphite:#5B6573; --rule:#E3E6EA; --escalate:#9B2335; --review:#A8660F; --close:#2F6F4E; --wash:#F6F7F8; }
html, body, [class*="css"], .stMarkdown, .stText, p, li, label, input, textarea, select, button { font-family: 'IBM Plex Sans', system-ui, sans-serif !important; }
code, .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace !important; font-size: .86em; }
h1, h2, h3 { color: var(--ink); letter-spacing: -0.01em; }
h1 { font-weight: 700; font-size: 1.7rem !important; }
.banner { border-left: 6px solid var(--escalate); background: #FBF2F3; padding: .8rem 1rem; margin: .4rem 0 1rem; color: var(--ink); }
.banner.h { border-color: var(--review); background: #FDF6EC; }
.banner.ok { border-color: var(--close); background: #F0F6F2; }
.banner b { font-weight: 600; }
.score { font-size: 4.2rem; line-height: 1; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.score small { font-size: 1.2rem; color: var(--graphite); font-weight: 500; }
.meta { color: var(--graphite); font-size: .92rem; }
.pill { display:inline-block; padding: .08rem .55rem; border:1px solid var(--rule); border-radius: 3px; font-size:.82rem; margin: 0 .3rem .3rem 0; }
.pill.e { border-color: var(--escalate); color: var(--escalate); }
.pill.h { border-color: var(--review); color: var(--review); }
.pill.a { border-color: var(--close); color: var(--close); }
.bar { height: 8px; background: var(--wash); border: 1px solid var(--rule); }
.bar > div { height: 100%; background: var(--ink); }
.sim { font-weight:600; color: var(--escalate); }
</style>
""",
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------- API helpers
def api_get(resource, case_id=None):
    params = {"resource": resource}
    if case_id:
        params["id"] = case_id
    r = requests.get(f"{N8N}/{HOOK}/soc-read", params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def api_post(path, body, timeout=20):
    r = requests.post(f"{N8N}/{HOOK}/{path}", json=body, timeout=timeout)
    try:
        data = r.json()
    except ValueError:
        data = {"ok": False, "error": r.text[:300]}
    return r.status_code, data


def parse_json(v):
    if isinstance(v, (dict, list)) or v is None:
        return v
    try:
        return json.loads(v) if v else None
    except (TypeError, ValueError):
        return None


ROUTE_MARK = {"ESCALATE": ("E", "e"), "EXCEPTION": ("E", "e"), "REVIEW": ("H", "h"), "CONFIRM_CLOSURE": ("H", "h")}
STATUS_LABEL = {
    "PROCESSING": "Processing",
    "PENDING_CLOSURE_CONFIRMATION": "Awaiting closure confirmation",
    "PENDING_ANALYST_REVIEW": "Awaiting analyst review",
    "ESCALATED_PENDING_APPROVAL": "Escalated, awaiting approval",
    "EXCEPTION_MANUAL_QUEUE": "Exception, manual queue",
    "CLOSED": "Closed",
    "APPROVED_ACTION_SIMULATED": "Approved (simulated action)",
    "MODIFIED_ACTION_SIMULATED": "Modified (simulated action)",
    "RETURNED_TO_MANUAL": "Returned to manual queue",
    "ESCALATED_TO_LEAD": "Escalated to SOC Lead (SLA)",
}


# ---------------------------------------------------------------- sidebar
def sidebar():
    with st.sidebar:
        st.markdown("### SOC Triage Console")
        st.caption("Governed agentic AI prototype. Synthetic data only; every containment action is simulated.")
        users = CFG["demo_users"]
        analyst = st.selectbox("Signed in as (demo role selector, not real authentication)", list(users.keys()),
                               format_func=lambda u: f"{u} · {users[u]}", key="analyst")
        models = [m for m in CFG["models"]]
        st.selectbox("Model for new triage runs", [m["id"] for m in models],
                     format_func=lambda i: next(m["label"] for m in models if m["id"] == i), key="model")
        try:
            requests.get(f"{N8N}/{HOOK}/soc-read", params={"resource": "ping"}, timeout=4)
            st.caption(f"n8n reachable at {N8N}")
        except requests.RequestException:
            st.error(f"n8n not reachable at {N8N}. Start n8n and activate the SOC workflows.")
        return analyst, users[analyst]


# ---------------------------------------------------------------- page: queue
def page_queue():
    st.title("Alert queue")
    try:
        cases = api_get("cases").get("cases", [])
    except Exception as e:  # noqa: BLE001
        st.error(f"Could not load cases from n8n: {e}")
        return
    if not cases:
        st.info("No cases yet. Submit an alert to start a triage run.")
        return
    df = pd.DataFrame(cases)
    open_states = {"PENDING_CLOSURE_CONFIRMATION", "PENDING_ANALYST_REVIEW", "ESCALATED_PENDING_APPROVAL", "EXCEPTION_MANUAL_QUEUE", "PROCESSING", "ESCALATED_TO_LEAD"}
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Open", int(df["status"].isin(open_states).sum()))
    c2.metric("Escalated", int(df["status"].isin(["ESCALATED_PENDING_APPROVAL", "ESCALATED_TO_LEAD"]).sum()))
    c3.metric("Awaiting review", int((df["status"] == "PENDING_ANALYST_REVIEW").sum()))
    c4.metric("Exceptions", int((df["status"] == "EXCEPTION_MANUAL_QUEUE").sum()))
    c5.metric("Decided", int((~df["status"].isin(open_states)).sum()))

    f1, f2, f3 = st.columns(3)
    status_f = f1.multiselect("Status", sorted(df["status"].unique()), format_func=lambda s: STATUS_LABEL.get(s, s))
    prio_f = f2.multiselect("Priority", sorted(df["priority"].dropna().unique()))
    model_f = f3.multiselect("Model", sorted(df["model"].dropna().unique()))
    view = df
    if status_f:
        view = view[view["status"].isin(status_f)]
    if prio_f:
        view = view[view["priority"].isin(prio_f)]
    if model_f:
        view = view[view["model"].isin(model_f)]
    view = view.sort_values("created_at", ascending=False)
    view = view.assign(mark=view["route"].map(lambda r: ROUTE_MARK.get(r, ("", ""))[0]),
                       status_label=view["status"].map(lambda s: STATUS_LABEL.get(s, s)))
    st.dataframe(
        view[["case_id", "alert_id", "priority", "classification", "risk_score", "status_label", "mark", "model", "created_at"]],
        hide_index=True, width="stretch",
        column_config={"risk_score": st.column_config.NumberColumn("Score", format="%d"),
                       "status_label": "Status", "mark": "A/H/E", "case_id": "Case", "alert_id": "Alert",
                       "classification": "Class", "priority": "Priority", "created_at": "Created (UTC)"},
    )
    pick = st.selectbox("Open a case", view["case_id"].tolist())
    if st.button("Open case", type="primary"):
        st.session_state["open_case"] = pick
        st.switch_page(PAGES["detail"])


# ---------------------------------------------------------------- page: submit
def page_submit():
    st.title("Submit a security alert")
    samples = {p.stem: json.loads(p.read_text()) for p in sorted(ALERT_DIR.glob("*.json"))}
    names = {"ALRT-1001": "normal, low risk", "ALRT-2001": "ambiguous", "ALRT-3001": "high risk",
             "ALRT-4001": "prompt-injection test", "ALRT-5001": "malformed input test"}
    choice = st.selectbox("Sample alert", list(samples.keys()), format_func=lambda k: f"{k} ({names.get(k, 'custom')})")
    text = st.text_area("Alert JSON (edit freely; validation runs in n8n)", json.dumps(samples[choice], indent=2), height=360, key=f"alert_{choice}")
    st.caption(f"Model: **{st.session_state.get('model')}** (change in the sidebar)")
    if st.button("Run triage workflow", type="primary"):
        try:
            alert = json.loads(text)
        except json.JSONDecodeError as e:
            st.error(f"Alert is not valid JSON: {e}")
            return
        aid = str(alert.get("alert_id", "CUSTOM"))[:30].replace(" ", "-")
        case_id = f"CASE-{aid}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"
        body = {"case_id": case_id, "alert": alert, "model": st.session_state.get("model")}
        try:
            code, resp = api_post("soc-triage", body)
        except requests.RequestException as e:
            st.error(f"Could not reach n8n: {e}")
            return
        if code >= 400:
            st.error(f"n8n rejected the request ({code}): {resp}")
            return
        started = time.time()
        with st.status(f"Triage running for {case_id}", expanded=True) as box:
            last = None
            while time.time() - started < 900:
                time.sleep(POLL_SECONDS)
                try:
                    case = api_get("case", case_id).get("case")
                except Exception:  # noqa: BLE001
                    case = None
                status = case.get("status") if case else "QUEUED"
                if status != last:
                    box.write(f"{int(time.time() - started)} s · {STATUS_LABEL.get(status, status)}")
                    last = status
                if case and status != "PROCESSING":
                    box.update(label=f"{case_id}: {STATUS_LABEL.get(status, status)}", state="complete")
                    st.session_state["open_case"] = case_id
                    break
            else:
                box.update(label="Still processing after 15 minutes. Check the n8n execution log.", state="error")
        if st.session_state.get("open_case") == case_id:
            st.page_link(PAGES["detail"], label="Open case detail")


# ---------------------------------------------------------------- page: case detail
def render_breakdown(scoring):
    rows = scoring.get("breakdown", [])
    for b in rows:
        c1, c2, c3 = st.columns([3, 2, 2])
        c1.markdown(f"**{b['factor']}** {b['name']}<br><span class='meta'>{b['source']}</span>", unsafe_allow_html=True)
        c2.markdown(f"`{b['level']}`")
        pct = int(100 * b["points"] / b["max"]) if b["max"] else 0
        c3.markdown(f"{b['points']} / {b['max']}<div class='bar'><div style='width:{pct}%'></div></div>", unsafe_allow_html=True)
    if scoring.get("overrides"):
        st.caption(f"Override rules applied: {', '.join(scoring['overrides'])} (base class {scoring.get('base_class')} raised to {scoring.get('class')}). Overrides only raise, never lower.")


def page_detail(analyst, role):
    st.title("Case detail")
    try:
        cases = api_get("cases").get("cases", [])
    except Exception as e:  # noqa: BLE001
        st.error(f"Could not load cases: {e}")
        return
    ids = [c["case_id"] for c in sorted(cases, key=lambda c: c.get("created_at", ""), reverse=True)]
    if not ids:
        st.info("No cases yet.")
        return
    default = ids.index(st.session_state["open_case"]) if st.session_state.get("open_case") in ids else 0
    case_id = st.selectbox("Case", ids, index=default)
    st.session_state["open_case"] = case_id
    case = api_get("case", case_id).get("case") or {}
    scoring = parse_json(case.get("scoring_json")) or {}
    summary = parse_json(case.get("summary_json")) or {}
    decision = parse_json(case.get("decision_json"))
    route, status = case.get("route"), case.get("status")

    st.markdown(f"<span class='meta'>Alert {case.get('alert_id')} · model {case.get('model')} · prompts {case.get('prompt_versions','')}</span>", unsafe_allow_html=True)
    if status == "EXCEPTION_MANUAL_QUEUE":
        st.markdown(f"<div class='banner'><b>Exception (E):</b> {case.get('exception_stage','')}: {case.get('exception_reason','')}. No agent recommendation is trusted; a human must handle this case.</div>", unsafe_allow_html=True)
    elif route == "ESCALATE" and status in ("ESCALATED_PENDING_APPROVAL", "ESCALATED_TO_LEAD"):
        st.markdown(f"<div class='banner'><b>Escalated (E): {case.get('priority')} {case.get('classification')}.</b> Tier 2 or SOC Lead approval required. Notification to IR Lead recorded (simulated).</div>", unsafe_allow_html=True)
    elif status in ("PENDING_ANALYST_REVIEW", "PENDING_CLOSURE_CONFIRMATION"):
        st.markdown(f"<div class='banner h'><b>Human review (H):</b> {STATUS_LABEL[status]}.</div>", unsafe_allow_html=True)
    elif status:
        st.markdown(f"<div class='banner ok'><b>{STATUS_LABEL.get(status, status)}.</b></div>", unsafe_allow_html=True)

    if scoring:
        left, right = st.columns([1, 2])
        with left:
            st.markdown(f"<div class='score'>{scoring.get('score')}<small> / 100</small></div>", unsafe_allow_html=True)
            st.markdown(f"Class **{scoring.get('class')}** · priority **{scoring.get('priority')}** · confidence **{scoring.get('overall_confidence')}**")
            flags = scoring.get("flags", [])
            st.markdown("".join(f"<span class='pill h'>{f}</span>" for f in flags) or "<span class='meta'>No flags</span>", unsafe_allow_html=True)
            for d in scoring.get("disagreements", []):
                st.caption(f"Model vs rules: {d}")
            st.caption("Confidence = lowest agent self-report minus 0.10 per flag. Self-reported, not calibrated.")
        with right:
            render_breakdown(scoring)

    if summary:
        st.subheader(summary.get("headline", "Summary"))
        st.write(summary.get("what_happened", ""))
        st.markdown(f"**Decision needed:** {summary.get('decision_needed_from_analyst','')}")
        for k in summary.get("key_evidence", []):
            st.markdown(f"- {k['text']} " + " ".join(f"`{e}`" for e in k["evidence_ids"]))
        if summary.get("uncertainties"):
            st.markdown("**Uncertainties**")
            for u in summary["uncertainties"]:
                st.markdown(f"- {u}")

    tabs = st.tabs(["Correlation", "Threat intel", "Asset context", "Risk proposal", "Raw evidence", "Lookups (code)"])
    for tab, col in zip(tabs, ["correlation_json", "ti_json", "asset_json", "risk_json", "alert_json", "lookups_json"]):
        with tab:
            data = parse_json(case.get(col))
            st.json(data if data is not None else {"note": "not produced (case stopped earlier)"}, expanded=col in ("risk_json", "alert_json"))

    risk = parse_json(case.get("risk_json")) or {}
    if risk:
        st.markdown(f"**AI recommendation:** `{risk.get('recommended_action')}` · category `{risk.get('incident_category')}` · behaviour `{risk.get('behaviour_level')}`")
        if risk.get("recommended_action", "").endswith("_SIMULATED"):
            st.markdown("<span class='sim'>Containment is simulated in this prototype. No real system is changed.</span>", unsafe_allow_html=True)

    st.subheader("Analyst decision")
    if decision:
        st.success(f"Decided by {decision.get('analyst_id')} ({decision.get('role')}): {decision.get('decision')} → {STATUS_LABEL.get(status, status)}. {decision.get('message','')}")
    elif status in ("PENDING_CLOSURE_CONFIRMATION", "PENDING_ANALYST_REVIEW", "ESCALATED_PENDING_APPROVAL", "EXCEPTION_MANUAL_QUEUE", "ESCALATED_TO_LEAD"):
        st.caption(f"You are {analyst} ({role}). Permission is checked by n8n, not by this page.")
        with st.form("decision"):
            choice = st.radio("Decision", ["APPROVE", "MODIFY", "REJECT"], horizontal=True,
                              captions=["Accept the AI recommendation", "Change class or action (reason required)", "Nothing runs; case returns to manual queue"])
            c1, c2 = st.columns(2)
            m_class = c1.selectbox("Modified class", ["(unchanged)", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
            m_action = c2.selectbox("Modified action", ["(unchanged)"] + CFG["allowed_actions"])
            reason = st.selectbox("Reject reason code", ["", "WRONG_CLASSIFICATION", "WRONG_ACTION", "INSUFFICIENT_EVIDENCE", "AI_ERROR_OR_HALLUCINATION", "OTHER"])
            note = st.text_input("Note (required for Modify)")
            if st.form_submit_button("Submit decision", type="primary"):
                body = {"case_id": case_id, "analyst_id": analyst, "decision": choice, "note": note,
                        "modified_class": None if m_class == "(unchanged)" else m_class,
                        "modified_action": None if m_action == "(unchanged)" else m_action,
                        "reason_code": reason or None}
                code, resp = api_post("soc-decision", body)
                if resp.get("ok"):
                    st.success(resp.get("message", "Decision recorded."))
                    st.rerun()
                else:
                    st.error(f"Decision refused: {resp.get('error') or resp}")
    else:
        st.caption("This case is not awaiting a decision.")

    st.subheader("Audit trail")
    try:
        rows = api_get("audit", case_id).get("audit", [])
        if rows:
            st.dataframe(pd.DataFrame(rows)[["ts", "step", "actor", "model", "prompt_version", "event", "status", "latency_ms", "detail"]], hide_index=True, width="stretch")
    except Exception as e:  # noqa: BLE001
        st.warning(f"Audit trail unavailable: {e}")


# ---------------------------------------------------------------- page: audit
def page_audit():
    st.title("Audit log")
    try:
        rows = api_get("audit").get("audit", [])
    except Exception as e:  # noqa: BLE001
        st.error(f"Could not load audit log: {e}")
        return
    if not rows:
        st.info("The audit log is empty.")
        return
    df = pd.DataFrame(rows).sort_values("ts", ascending=False)
    c1, c2 = st.columns(2)
    cf = c1.multiselect("Case", sorted(df["case_id"].dropna().unique()))
    ef = c2.multiselect("Event", sorted(df["event"].dropna().unique()))
    if cf:
        df = df[df["case_id"].isin(cf)]
    if ef:
        df = df[df["event"].isin(ef)]
    st.dataframe(df, hide_index=True, width="stretch")
    st.download_button("Download CSV", df.to_csv(index=False), "soc_audit_log.csv", "text/csv")


# ---------------------------------------------------------------- page: model comparison
def page_models():
    st.title("Model comparison")
    st.caption("Same five alerts, prompts, evidence and output schema for every model. Values come only from benchmark/results produced by benchmark/run_benchmark.py.")
    if not BENCH_CSV.exists():
        st.warning("No measured results yet. Run `python benchmark/run_benchmark.py` against the live n8n workflow, then reload. Nothing is shown until real runs exist.")
        return
    df = pd.read_csv(BENCH_CSV)
    if df["model"].astype(str).str.startswith("mock").any():
        st.error("These results include mock models. Mock output is a pipeline self-test, not a model result. Do not report it.")
    st.dataframe(df, hide_index=True, width="stretch")
    metric_cols = [c for c in df.columns if c not in ("model", "runs")]
    metric = st.selectbox("Chart metric", metric_cols, index=0)
    st.bar_chart(df.set_index("model")[metric])
    if BENCH_RUNS.exists():
        with st.expander("Per-run results"):
            st.dataframe(pd.read_csv(BENCH_RUNS), hide_index=True, width="stretch")


# ---------------------------------------------------------------- page: guardrails
def page_guardrails():
    st.title("Guardrails and scope")
    st.markdown(
        """
**Operating principle.** Agents advise; code routes; humans approve.

**Data.** All alerts, threat-intel, CMDB and identity records are synthetic. Emails and phone numbers are masked before any model sees the alert.

**Model inputs.** Alert text is screened for instructions aimed at the AI before any agent runs. Evidence is wrapped as data, and each agent is told to flag embedded instructions.

**Model outputs.** Every agent output must match its JSON schema (one retry, then exception). Every cited evidence or record ID must exist. Recommended actions must be on the allow-list. Containment needs malicious intel or a multi-stage chain; closure needs a cited benign explanation.

**Scoring and routing.** The risk score and route are computed in code from lookup records. Missing data raises risk. The model's behaviour rating is one factor out of seven.

**Human control.** Every closure and every simulated containment needs an analyst decision. Role limits: Tier 1 up to MEDIUM with no containment; Tier 2 up to HIGH; SOC Lead for CRITICAL and for isolating a critical asset. Modify cannot be used to downgrade a case into your own authority.

**Actions.** Only allow-listed actions exist, and every containment action is simulated. No real system is changed.

**Audit.** Every agent call, route, exception and human decision is logged with model, prompt version and latency.

**Limitations.** Synthetic data and five test cases; pattern-based injection screening is a first layer only; confidence is self-reported; the role selector is not real authentication; thresholds and weights await expert validation.
"""
    )
    st.subheader("Action allow-list")
    st.write(", ".join(f"`{a}`" for a in CFG["allowed_actions"]))


# ---------------------------------------------------------------- navigation
analyst, role = sidebar()
PAGES = {
    "queue": st.Page(page_queue, title="Alert queue", default=True),
    "submit": st.Page(page_submit, title="Submit alert"),
    "detail": st.Page(lambda: page_detail(analyst, role), title="Case detail", url_path="case"),
    "audit": st.Page(page_audit, title="Audit log"),
    "models": st.Page(page_models, title="Model comparison"),
    "guardrails": st.Page(page_guardrails, title="Guardrails and scope"),
}
st.navigation(list(PAGES.values())).run()
