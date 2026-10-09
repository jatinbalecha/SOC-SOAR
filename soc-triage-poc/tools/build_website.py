#!/usr/bin/env python3
"""Builds website/index.html (self-contained, publishable) from the diagrams,
website/content.json and benchmark/results/summary_by_model.csv.
Run after the benchmark, after the expert interview, or after editing content.json."""
import base64
import csv
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "website" / "index.html"


def svg_uri(name):
    data = (ROOT / "docs" / "diagrams" / name).read_bytes()
    return "data:image/svg+xml;base64," + base64.b64encode(data).decode()


def load_results():
    p = ROOT / "benchmark" / "results" / "summary_by_model.csv"
    if not p.exists():
        return None
    with open(p, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    rows = [r for r in rows if not r["model"].startswith("mock")]  # never publish mock output
    return rows or None


def main():
    content = json.loads((ROOT / "website" / "content.json").read_text(encoding="utf-8"))
    content.pop("_help", None)
    data = {"content": content, "results": load_results()}
    page = TEMPLATE
    for key, fig in (("FIG1", "fig1_as_is.svg"), ("FIG2", "fig2_to_be.svg"), ("FIG3", "fig3_architecture.svg")):
        page = page.replace("{{" + key + "}}", svg_uri(fig))
    page = page.replace("{{DATA}}", json.dumps(data).replace("</", "<\\/"))
    page = page.replace("{{TEAM}}", html.escape(content.get("team_name") or "Team"))
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB); results: {'yes' if data['results'] else 'pending'}")


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Governed Agentic AI for SOC Alert Triage</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--paper:#ffffff;--ink:#1C2430;--slate:#5B6573;--rule:#D9DDE3;--wash:#F4F5F7;
--auto:#2F6F4E;--human:#A8660F;--esc:#9B2335;--panel:#ffffff;
box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#12161C;--ink:#E7EAEE;--slate:#A4ACB8;--rule:#2C333D;--wash:#1A2029;--auto:#5FB08A;--human:#D69A45;--esc:#E0707F;--panel:#F7F8FA}}
:root[data-theme="dark"]{--paper:#12161C;--ink:#E7EAEE;--slate:#A4ACB8;--rule:#2C333D;--wash:#1A2029;--auto:#5FB08A;--human:#D69A45;--esc:#E0707F;--panel:#F7F8FA}
html{scroll-padding-top:calc(env(safe-area-inset-top,0px) + 64px)}
*,*::before,*::after{box-sizing:inherit}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 "IBM Plex Sans",Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-underline-offset:3px}
a:focus-visible,button:focus-visible{outline:2px solid var(--human);outline-offset:3px;border-radius:2px}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.prose{max-width:68ch}
nav{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--paper);border-bottom:1px solid var(--rule)}
nav .wrap{display:flex;gap:22px;align-items:center;height:56px;overflow-x:auto;white-space:nowrap}
nav strong{font-weight:600;margin-right:auto}
nav a{text-decoration:none;color:var(--slate);font-size:14px}
nav a:hover{color:var(--ink)}
header{padding:72px 0 56px;border-bottom:1px solid var(--rule)}
h1{font-size:clamp(34px,5vw,54px);line-height:1.08;letter-spacing:-0.02em;font-weight:600;margin:0 0 20px;max-width:18ch}
.lede{font-size:19px;color:var(--slate);max-width:56ch;margin:0}
.hero{display:grid;grid-template-columns:1.05fr 1fr;gap:56px;align-items:start}
@media (max-width:860px){.hero{grid-template-columns:1fr;gap:36px}}
.trace{border-left:2px solid var(--rule);margin:6px 0 0;padding:0;list-style:none}
.trace li{position:relative;padding:0 0 16px 22px;opacity:1}
.trace li::before{content:"";position:absolute;left:-7px;top:6px;width:12px;height:12px;border-radius:50%;background:var(--paper);border:2px solid var(--c,var(--slate))}
.trace .t{font-weight:600}
.trace .d{color:var(--slate);font-size:14px}
.tag{display:inline-block;min-width:22px;text-align:center;font-weight:700;font-size:12px;line-height:20px;border-radius:3px;color:#fff;margin-right:8px;vertical-align:1px}
.A{--c:var(--auto)}.H{--c:var(--human)}.E{--c:var(--esc)}
.tag.A{background:var(--auto)}.tag.H{background:var(--human)}.tag.E{background:var(--esc)}
.trace .case{font-size:14px;color:var(--slate);margin:0 0 14px}
@media (prefers-reduced-motion:no-preference){.js .trace li{opacity:0;transform:translateY(4px);transition:opacity .35s ease,transform .35s ease}.js .trace li.on{opacity:1;transform:none}}
section{padding:64px 0;border-bottom:1px solid var(--rule)}
h2{font-size:30px;line-height:1.2;letter-spacing:-0.01em;font-weight:600;margin:0 0 18px}
h3{font-size:19px;font-weight:600;margin:28px 0 8px}
p{margin:0 0 14px}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin:28px 0 8px;max-width:820px}
@media (max-width:640px){.stats{grid-template-columns:1fr}}
.stats div{border-top:2px solid var(--ink);padding-top:10px}
.stats b{display:block;font-size:30px;font-weight:600;line-height:1.1}
.stats span{color:var(--slate);font-size:14px}
.src{font-size:13px;color:var(--slate)}
.switch{display:flex;gap:4px;border-bottom:1px solid var(--rule);margin:22px 0 0;flex-wrap:wrap}
.switch button{font:inherit;font-size:15px;background:none;border:0;border-bottom:2px solid transparent;padding:10px 14px;color:var(--slate);cursor:pointer;margin-bottom:-1px}
.switch button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--ink);font-weight:600}
.fig{background:var(--panel);border:1px solid var(--rule);padding:16px;overflow-x:auto;margin:0}
.fig img{display:block;max-width:100%;height:auto;margin:0 auto}
.fig.wide img{min-width:860px;max-width:none;width:100%}
figcaption{font-size:14px;color:var(--slate);margin-top:10px}
.scroll{overflow-x:auto;margin:18px 0}
table{border-collapse:collapse;width:100%;font-size:14px;min-width:640px}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--rule)}
th{font-weight:600;border-bottom:2px solid var(--ink)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.pending{border-left:3px solid var(--human);background:var(--wash);padding:14px 18px;max-width:68ch}
.two{display:grid;grid-template-columns:1fr 1fr;gap:40px}
@media (max-width:760px){.two{grid-template-columns:1fr}}
ul.plain{padding-left:18px;margin:0 0 14px}
ul.plain li{margin-bottom:6px}
.btn{display:inline-block;background:var(--ink);color:var(--paper);text-decoration:none;padding:12px 18px;border-radius:3px;font-weight:600}
footer{padding:40px 0 56px;color:var(--slate);font-size:14px}
</style>
</head>
<body>
<nav aria-label="Sections"><div class="wrap"><strong>SOC triage, governed</strong>
<a href="#problem">Problem</a><a href="#process">Process</a><a href="#architecture">Architecture</a><a href="#poc">Proof of concept</a><a href="#models">Model comparison</a><a href="#guardrails">Guardrails</a><a href="#expert">Expert validation</a><a href="#video">Video</a></div></nav>

<header><div class="wrap hero">
<div>
<h1>Governed agentic AI for SOC alert triage</h1>
<p class="lede">Five AI agents assemble the evidence behind every security alert. Code scores and routes it, and a human analyst approves anything with real impact. Every step is recorded.</p>
</div>
<div>
<p class="case">One case through the pipeline: ALRT-3001, suspicious login by a privileged user on a critical server</p>
<ol class="trace" id="trace">
<li class="A"><span class="tag A">A</span><span class="t">Alert validated and screened</span><div class="d">No injection found; personal data masked</div></li>
<li class="A"><span class="tag A">A</span><span class="t">Evidence assembled</span><div class="d">Threat intel, asset register, identity and history lookups</div></li>
<li class="A"><span class="tag A">A</span><span class="t">Four agents assess the case</span><div class="d">Correlation, threat intel, asset context, risk; every claim cites an evidence ID</div></li>
<li class="A"><span class="tag A">A</span><span class="t">Scored 97, critical</span><div class="d">Critical asset with malicious intel, and privileged multi-stage activity, set the floor</div></li>
<li class="E"><span class="tag E">E</span><span class="t">Escalated to the incident response lead</span><div class="d">SLA watcher re-escalates if it waits more than 10 minutes</div></li>
<li class="H"><span class="tag H">H</span><span class="t">Tier 1 approval refused; SOC Lead approves</span><div class="d">Authority is checked on the server, not in the browser</div></li>
<li class="A"><span class="tag A">A</span><span class="t">Allow-listed action recorded</span><div class="d">Simulated in the prototype; full audit trail kept</div></li>
</ol>
</div>
</div></header>

<main>
<section id="problem"><div class="wrap">
<h2>The problem</h2>
<div class="prose">
<p>A security operations centre receives more alerts than its analysts can investigate. Each alert needs related events, threat intelligence and asset context gathered from separate tools before anyone can judge it. The judgement itself varies between analysts and shifts, and approvals often happen by phone or chat with little record.</p>
</div>
<div class="stats">
<div><b>~960</b><span>alerts a day in the median SOC</span></div>
<div><b>~40%</b><span>of alerts never investigated</span></div>
<div><b>~70 min</b><span>to fully investigate one alert</span></div>
</div>
<p class="src">Survey of 282 security leaders, reported by The Hacker News, September 2025.</p>
<div class="prose">
<h3>How we chose the opportunity</h3>
<p>We used critical and systems thinking to find the root cause: evidence assembly is manual and fragmented. We then used STOIC prompts (situation, task, objective, inputs, constraints) to generate eight ideas and scored each for usefulness, realism and feasibility. Multi-agent triage with human approval scored highest. A fully autonomous containment bot was rejected as unsafe.</p>
</div>
</div></section>

<section id="process"><div class="wrap">
<h2>From manual triage to governed agents</h2>
<div class="prose"><p>In the redesigned process every activity is marked <span class="tag A">A</span>autonomous, <span class="tag H">H</span>human-in-the-loop or <span class="tag E">E</span>escalation. Routing is decided by code, never by a model.</p></div>
<div class="switch" role="tablist" aria-label="Process diagrams">
<button role="tab" aria-selected="true" aria-controls="p-asis" id="t-asis">Current process</button>
<button role="tab" aria-selected="false" aria-controls="p-tobe" id="t-tobe">Redesigned process</button>
</div>
<figure class="fig wide" id="p-asis" role="tabpanel" aria-labelledby="t-asis"><img src="{{FIG1}}" alt="Current process: alerts queue up, a Tier 1 analyst pivots across consoles, looks up threat intel and asset owners by hand, then closes or escalates by ticket; Tier 2 re-investigates; containment is approved by phone and carried out by IT."></figure>
<figure class="fig" id="p-tobe" role="tabpanel" aria-labelledby="t-tobe" hidden><img src="{{FIG2}}" alt="Redesigned process: validation and screening, tool lookups, four agents, deterministic scoring and guardrails, a summary agent, then routing to closure confirmation, analyst review or escalation, each with a human decision; exceptions go to a manual queue."></figure>
</div></section>

<section id="architecture"><div class="wrap">
<h2>Architecture</h2>
<div class="prose"><p>Six layers. The guardrails sit in code between the workflow and the models, so a model cannot talk its way past them.</p></div>
<figure class="fig"><img src="{{FIG3}}" alt="Six layers: Streamlit console; n8n workflows; guardrails in code; five agents on open-weight models; tools and data; human oversight and governance."><figcaption>Streamlit console, n8n 2.41.3 workflows, open-weight models (GPT-OSS 20B and 120B, Qwen 3.8 27B on Groq, or local models through Ollama).</figcaption></figure>
</div></section>

<section id="poc"><div class="wrap">
<h2>Proof of concept</h2>
<div class="prose"><p>The analyst submits an alert in the console, which starts the n8n workflow. The console then shows the score breakdown, flags, each agent's findings and the recommendation, with approve, modify and reject controls. Five synthetic alerts cover normal, ambiguous, high-risk and attack cases.</p></div>
<div class="scroll"><table>
<thead><tr><th>Alert</th><th>Case type</th><th>Outcome</th><th>What it shows</th></tr></thead>
<tbody>
<tr><td>ALRT-1001</td><td>Normal</td><td>Score 12, low; closure confirmed by Tier 1</td><td>Benign activity closes safely, with a human confirming</td></tr>
<tr><td>ALRT-2001</td><td>Ambiguous</td><td>Score 49, medium; analyst review</td><td>Asset missing from the register and conflicting threat intel lower confidence, so no auto-closure</td></tr>
<tr><td>ALRT-3001</td><td>High risk</td><td>Score 97, critical; escalated</td><td>Tier 1 approval refused; SOC Lead approves a simulated action</td></tr>
<tr><td>ALRT-4001</td><td>Prompt injection</td><td>Exception queue</td><td>Attack text in the log is stopped before any model sees it</td></tr>
<tr><td>ALRT-5001</td><td>Malformed alert</td><td>Exception queue</td><td>Invalid input never reaches the agents</td></tr>
</tbody></table></div>
<p class="src">Outcomes verified end to end through n8n with a test model that returns known answers. Real-model results are in the next section.</p>
<div id="app-link"></div>
</div></section>

<section id="models"><div class="wrap">
<h2>Model comparison</h2>
<div class="prose"><p>Each model receives the same five alerts, prompts, evidence and output schema, three times each. Results are scored against an expected outcome for every alert.</p></div>
<div id="results"></div>
<h3>What we measure</h3>
<div class="two"><ul class="plain">
<li><b>Classification:</b> exact match, and within one level, of the final class</li>
<li><b>Escalation accuracy:</b> high-risk cases escalated, benign ones not</li>
<li><b>False positives and negatives:</b> unnecessary escalations, and missed ones</li>
<li><b>Hallucination:</b> evidence IDs cited that do not exist</li>
</ul><ul class="plain">
<li><b>Structured output:</b> valid JSON on the first attempt (provider throttling excluded)</li>
<li><b>Latency:</b> median model time per case</li>
<li><b>Task completion:</b> case reached the designed end state</li>
<li><b>Explanation quality:</b> blind 1–5 scoring by two team members</li>
</ul></div>
</div></section>

<section id="guardrails"><div class="wrap">
<h2>Guardrails and governance</h2>
<div class="prose"><p>Each risk maps to a guardrail, a governance requirement and the exact place it is enforced in the prototype. Frameworks used: NIST AI RMF 1.0, ISO/IEC 42001 and ISO/IEC 27001:2022.</p></div>
<div class="scroll"><table>
<thead><tr><th>Risk</th><th>Guardrail</th><th>Governance requirement</th><th>Where it is enforced</th></tr></thead>
<tbody>
<tr><td>Personal data exposed to a model</td><td>Mask emails and phone numbers before any model call</td><td>NIST MEASURE 2.10; ISO 27001 A.8.11, A.5.34; DPDP Act 2023</td><td>Injection and PII screen</td></tr>
<tr><td>Confidential data leaves the organisation</td><td>Synthetic data only; explicit endpoints; keys held in memory, never in files</td><td>NIST GOVERN 6.1; ISO 42001 A.10; ISO 27001 A.5.19–A.5.23</td><td>Model config; start script</td></tr>
<tr><td>Hallucinated evidence</td><td>Every cited ID must exist in the case evidence</td><td>NIST MEASURE 2.5; ISO 42001 A.6.2.4</td><td>Output and summary guardrails</td></tr>
<tr><td>Prompt injection</td><td>Screen before any model call; alert text treated as data</td><td>NIST MEASURE 2.7; ISO 27001 A.8.28</td><td>Injection screen; shared prompt rules</td></tr>
<tr><td>Bias in prioritisation</td><td>Unknown asset or user scored above medium, not as safe</td><td>NIST MEASURE 2.11; ISO 42001 A.5.2</td><td>Asset lookup ordering; completeness flags</td></tr>
<tr><td>Unsafe autonomous action</td><td>No action without approval; allow-list only; simulated</td><td>NIST GOVERN 3.2, MANAGE 2.4; ISO 42001 A.9.2</td><td>Decision workflow</td></tr>
<tr><td>Unauthorised approval</td><td>Role decided on the server; class caps authority; no downgrading to self-approve</td><td>NIST GOVERN 2.1; ISO 27001 A.5.15, A.8.2</td><td>Role-matrix check</td></tr>
<tr><td>Miscalibrated thresholds</td><td>Versioned thresholds and hard overrides outside the model</td><td>NIST MEASURE 1.1; ISO 42001 A.5.2</td><td>Scoring engine; expert sign-off</td></tr>
<tr><td>Over-trust in AI advice</td><td>Evidence shown before the recommendation; reason code on reject</td><td>NIST MAP 3.5; ISO 42001 A.8.2</td><td>Case detail page</td></tr>
<tr><td>Missing audit trail</td><td>Every step logged with actor, model, prompt version and latency</td><td>NIST MANAGE 4.1; ISO 42001 A.6.2.8; ISO 27001 A.8.15</td><td>Audit table and export</td></tr>
</tbody></table></div>
</div></section>

<section id="expert"><div class="wrap">
<h2>Expert validation</h2>
<div id="expert-body"></div>
</div></section>

<section id="limits"><div class="wrap">
<h2>Limitations and next steps</h2>
<div class="two"><div><h3>Limitations</h3><ul class="plain">
<li>Five synthetic alerts show the controls work, not accuracy at scale.</li>
<li>Injection screening uses known patterns and can be paraphrased around.</li>
<li>Analyst identity comes from a selector, not real sign-in.</li>
<li>The audit table is append-only by design, not tamper-proof.</li>
<li>Hosted models receive masked, synthetic alerts; real data would need local models or a data-processing agreement.</li>
</ul></div><div><h3>Recommended next steps</h3><ul class="plain">
<li>Pilot in shadow mode on real alerts, with expert-set thresholds.</li>
<li>Connect to a live SIEM (for example Wazuh) and single sign-on.</li>
<li>Forward audit events to the SIEM or write-once storage.</li>
<li>Add a classifier-based injection screen.</li>
<li>Feed analyst decisions back into detection tuning.</li>
</ul></div></div>
</div></section>

<section id="video"><div class="wrap">
<h2>Demonstration video</h2>
<div id="video-body"></div>
</div></section>
</main>

<footer><div class="wrap" id="team"></div></footer>

<script type="application/json" id="site-data">{{DATA}}</script>
<script>
(function(){
  document.documentElement.classList.add('js');
  var data = {}; try { data = JSON.parse(document.getElementById('site-data').textContent) || {}; } catch (e) {}
  var c = data.content || {};
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]; }); }

  // hero trace: one orchestrated reveal
  var items = document.querySelectorAll('#trace li'), i = 0;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  (function next(){ if (i < items.length) { items[i++].classList.add('on'); if (!reduce) setTimeout(next, 260); else next(); } })();

  // diagram switcher
  var tabs = document.querySelectorAll('.switch [role=tab]');
  tabs.forEach(function(t){ t.addEventListener('click', function(){
    tabs.forEach(function(o){ o.setAttribute('aria-selected', o === t ? 'true' : 'false'); document.getElementById(o.getAttribute('aria-controls')).hidden = (o !== t); });
  }); });

  // benchmark results
  var r = data.results, box = document.getElementById('results');
  if (r && r.length) {
    var cols = [['model','Model',0],['classification_exact','Class exact',1],['escalation_accuracy','Escalation accuracy',1],['false_positives','False pos.',0],['false_negatives','False neg.',0],['hallucinated_ids','Invented IDs',0],['json_first_attempt_rate','JSON first try',1],['median_case_llm_latency_s','Median latency (s)',0],['task_completion','Task completion',1],['explanation_quality_1to5','Explanation (1–5)',0]];
    var h = '<div class="scroll"><table><thead><tr>' + cols.map(function(x){ return '<th' + (x[0]==='model'?'':' class="num"') + '>' + x[1] + '</th>'; }).join('') + '</tr></thead><tbody>';
    r.forEach(function(row){ h += '<tr>' + cols.map(function(x){ var v = row[x[0]]; if (x[2] && v !== '' && v != null && !isNaN(v)) v = Math.round(parseFloat(v)*100) + '%'; return '<td' + (x[0]==='model'?'':' class="num"') + '>' + esc(v === '' || v == null ? '–' : v) + '</td>'; }).join('') + '</tr>'; });
    box.innerHTML = h + '</tbody></table></div><p class="src">' + esc(r[0].runs) + ' runs per model. Full per-run data is in the project repository.</p>';
  } else {
    box.innerHTML = '<div class="pending"><b>Results to be published after the benchmark run.</b> The benchmark script is ready and verified on the pipeline; open-weight model results will appear here once measured.</div>';
  }

  // expert validation
  var ex = c.expert || {}, eb = document.getElementById('expert-body');
  if (ex.name && ex.summary && ex.summary.length) {
    var s = '<div class="prose"><p>Reviewed by <b>' + esc(ex.name) + '</b>, ' + esc(ex.designation) + (ex.organisation ? ', ' + esc(ex.organisation) : '') + '. The expert saw the current and redesigned processes, the architecture, the working prototype, the human approval controls and the guardrails.</p></div>';
    s += '<div class="two"><div><h3>What the expert said</h3><ul class="plain">' + ex.summary.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    s += '<div><h3>What we changed</h3><ul class="plain">' + (ex.changes_made || []).map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>';
    eb.innerHTML = s;
  } else {
    eb.innerHTML = c.evidence_url
      ? '<div class="prose"><p>A faculty-approved industry expert reviewed the current and redesigned processes, the architecture, the working prototype, the human approval controls and the guardrails, and commented on feasibility, risks, usefulness and improvements.</p><p><a href="' + esc(c.evidence_url) + '" target="_blank" rel="noopener">The full interview recording is in the project folder.</a></p></div>'
      : '<div class="pending"><b>Expert interview scheduled.</b> A faculty-approved SOC practitioner will review the process, the prototype, the approval controls and the guardrails. Their comments on feasibility, risks, usefulness and improvements will be summarised here.</div>';
  }

  // live demo link
  if (c.app_url) document.getElementById('app-link').innerHTML = '<p style="margin-top:18px"><a class="btn" href="' + esc(c.app_url) + '" target="_blank" rel="noopener">Open the live demo</a></p><p class="src">Password-protected; access is shared with evaluators.</p>';

  // video
  var vb = document.getElementById('video-body');
  vb.innerHTML = c.video_url ? '<p class="prose">A 10–15 minute walkthrough of the problem, the live prototype, the model comparison, the guardrails and the expert findings. The project folder also holds the full expert interview recording and supporting documents.</p><a class="btn" href="' + esc(c.video_url) + '" target="_blank" rel="noopener">Open the videos and documents</a>'
                              : '<div class="pending"><b>Video coming soon.</b> The final demonstration will be linked here.</div>';

  // team
  var team = (c.team_members || []).filter(Boolean), prn = c.team_prns || {};
  var names = team.map(function(n){ return esc(n) + (c.show_prns_on_website && prn[n] ? ' (' + esc(prn[n]) + ')' : ''); });
  var head = [c.team_name, c.institution].filter(Boolean).map(esc).join(', ');
  document.getElementById('team').innerHTML = (names.length ? '<p><b>Team:</b> ' + names.join(', ') + '</p>' : '') + (head ? '<p>' + head + '</p>' : '') + (c.submitted_to ? '<p>Submitted to ' + esc(c.submitted_to) + '</p>' : '') + '<p>Agentic AI Digital Transformation Hackathon, cybersecurity challenge. All data shown is synthetic; all response actions are simulated.</p>';
})();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
