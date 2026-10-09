"""Generates the three Stage 2 diagrams (SVG + PNG) with Graphviz. Run: python make_diagrams.py"""
import subprocess
INK, GREY, LINE, FILL = "#1C2430", "#5B6573", "#C9CED6", "#F4F5F7"
A, H, E, PAIN = "#2F6F4E", "#A8660F", "#9B2335", "#9B2335"
FONT = "Helvetica"
BASE = f'''fontname="{FONT}"; fontsize=11; color="{LINE}"; bgcolor="white"; pad=0.3; nodesep=0.35; ranksep=0.45;
node [fontname="{FONT}", fontsize=10, shape=box, style="rounded,filled", fillcolor="white", color="{INK}", fontcolor="{INK}", penwidth=1.1, margin="0.14,0.06"];
edge [fontname="{FONT}", fontsize=9, color="{GREY}", fontcolor="{GREY}", arrowsize=0.7];'''

def tag(kind, text):
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    col = {"A": A, "H": H, "E": E}[kind]
    return f'<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="1"><TR><TD BGCOLOR="{col}"><FONT COLOR="white" POINT-SIZE="9"><B> {kind} </B></FONT></TD><TD> {text}</TD></TR></TABLE>>'

def lane(name, label, body, color=INK):
    return f'subgraph cluster_{name} {{ label=<<B>{label}</B>>; labeljust="l"; fontcolor="{color}"; style="rounded"; color="{LINE}"; bgcolor="{FILL}";\n{body}\n}}'

def render(name, dot):
    open(f"{name}.dot", "w").write(dot)
    subprocess.run(["dot", "-Tsvg", f"{name}.dot", "-o", f"{name}.svg"], check=True)
    subprocess.run(["dot", "-Tpng", "-Gdpi=170", f"{name}.dot", "-o", f"{name}.png"], check=True)

# ---------------- AS-IS ----------------
pain = f'shape=note, style="filled", fillcolor="#FBEFF1", color="{PAIN}", fontcolor="{PAIN}", fontsize=9'
dec = f'shape=diamond, style="filled", fillcolor="white", fontsize=9, margin="0.02,0.02"'
asis = f'''digraph ASIS {{ {BASE} rankdir=LR; compound=true;
label=<<B>Figure 1. AS-IS: manual / semi-manual SOC alert triage</B>>; labelloc=t; fontsize=14; fontcolor="{INK}";
{lane("tools", "Security tools", 'siem [label="SIEM / EDR / IDS\\nraise alert"]; queue [label="Alert queue\\n(SIEM console)"];')}
{lane("l1", "Tier 1 analyst", f'''pick [label="Pick next alert\\n(by severity / age)"];
pivot [label="Pivot across consoles\\nSIEM search, EDR, firewall, email"];
ti [label="Manual TI lookup\\n(VirusTotal, TI portal)"];
asset [label="Find asset owner and\\ncriticality (CMDB sheet, email IT)"];
d1 [label="Benign /\\nfalse positive?", {dec}];
close1 [label="Close alert\\n(free-text note)"];
tkt [label="Write escalation ticket"];''')}
{lane("l2", "Tier 2 / IR analyst", f'''re [label="Re-investigate\\n(context lost in handoff)"]; d2 [label="Confirmed\\nincident?", {dec}]; ret [label="Return / close"];''')}
{lane("lead", "SOC Lead / IR Manager", f'''appr [label="Approve containment\\n(call / chat)"];''')}
{lane("it", "IT / asset owners", '''act [label="Isolate host, reset\\ncredentials, block IOC"]; doc [label="Update ticket,\\nmanual report"];''')}
p1 [label="~960 alerts/day (median);\\n~40% never investigated", {pain}];
p2 [label="Swivel-chair: 5+ consoles,\\nno single case record", {pain}];
p3 [label="CMDB gaps, conflicting TI,\\nincomplete logs", {pain}];
p4 [label="Handoff delay, duplicate\\nwork, shift-change loss", {pain}];
p5 [label="Approval by phone/chat,\\nweak audit trail", {pain}];
siem -> queue -> pick [label="wait"]; pick -> pivot -> ti -> asset -> d1;
d1 -> close1 [label="yes"]; d1 -> tkt [label="no / unsure"]; tkt -> re [label="handoff"]; re -> d2;
d2 -> ret [label="no"]; d2 -> appr [label="yes"]; appr -> act [label="handoff"]; act -> doc;
p1 -> queue [style=dashed, color="{PAIN}", arrowhead=none]; p2 -> pivot [style=dashed, color="{PAIN}", arrowhead=none];
p3 -> asset [style=dashed, color="{PAIN}", arrowhead=none]; p4 -> re [style=dashed, color="{PAIN}", arrowhead=none];
p5 -> appr [style=dashed, color="{PAIN}", arrowhead=none];
}}'''
render("fig1_as_is", asis)

# ---------------- TO-BE ----------------
tobe = f'''digraph TOBE {{ {BASE} rankdir=TB; compound=true; ranksep=0.35;
label=<<B>Figure 2. TO-BE: governed agentic triage</B>   <FONT COLOR="{A}"><B>A</B></FONT> autonomous · <FONT COLOR="{H}"><B>H</B></FONT> human-in-the-loop · <FONT COLOR="{E}"><B>E</B></FONT> escalation>; labelloc=t; fontsize=14; fontcolor="{INK}";
in [label={tag("A","Security alert submitted (console / SIEM webhook)")}];
{lane("orch", "SOC Orchestrator (n8n WF-1, deterministic)", f'''
val [label={tag("A","Validate input schema and sizes")}];
scr [label={tag("A","Injection screen + PII masking")}];
tools [label={tag("A","Tool lookups: TI, CMDB, identity, alert history")}];''')}
{lane("agents", "Specialised LLM agents (SW-1: strict JSON schema, 1 retry)", f'''
corr [label={tag("A","Alert Correlation Agent")}];
tia [label={tag("A","Threat Intelligence Agent")}]; asa [label={tag("A","Asset Context Agent")}];
risk [label={tag("A","Risk / Prioritisation Agent")}];
{{rank=same; tia; asa;}}''')}
{lane("ctrl", "Deterministic controls", f'''
score [label={tag("A","Scoring F1-F7 + overrides R1-R4 → LOW / MED / HIGH / CRIT")}];
grd [label={tag("A","Guardrails: evidence IDs, policy rules")}];
summ [label={tag("A","Incident Summary Agent + summary guardrail")}];
route [label="Route\\n(code, not model)", shape=diamond, style="filled", fillcolor="white", fontsize=9];''')}
exc [label={tag("E","Exception queue (manual triage) — invalid input, injection, agent failure, guardrail breach")}, color="{E}"];
{lane("hitl", "Human SOC analysts (WF-2, role matrix enforced server-side)", f'''
t1c [label={tag("H","Tier 1 confirms closure (LOW, benign, conf ≥ 0.80)")}];
t1r [label={tag("H","Analyst review (MEDIUM or low confidence)")}];
appr [label={tag("H","Tier 2 / Lead approve, modify or reject (HIGH / CRIT)")}];''')}
notify [label={tag("E","Notify Tier 2 / IR Lead (simulated)")}, color="{E}"];
sla [label={tag("E","SLA watcher: unapproved > 10 min → SOC Lead")}, color="{E}"];
act [label={tag("A","Execute allow-listed action (simulated) after approval")}];
audit [label={tag("A","Audit trail: every step, model, prompt version, decision")}];
in -> val -> scr -> tools -> corr; corr -> tia; corr -> asa; tia -> risk; asa -> risk; risk -> score -> grd -> summ -> route;
val -> exc [style=dashed, color="{E}", label="fail"]; scr -> exc [style=dashed, color="{E}", label="injection"];
grd -> exc [style=dashed, color="{E}", label="breach"];
route -> t1c [label="CONFIRM_CLOSURE"]; route -> t1r [label="REVIEW"]; route -> notify [label="ESCALATE"]; notify -> appr; appr -> sla [style=dashed, color="{E}"];
exc -> t1r [style=dashed, label="human handles"];
t1c -> act; t1r -> act; appr -> act; act -> audit;
}}'''
render("fig2_to_be", tobe)

# ---------------- ARCHITECTURE ----------------
def box(n, t, extra=""): return f'{n} [label="{t}" {extra}];'
def layer(name, title, items, color=INK):
    nodes = " ".join(box(n, t) for n, t in items)
    same = "{rank=same; " + "; ".join(n for n, _ in items) + ";}"
    return lane(name, title, nodes + " " + same, color)
L = [
 ("ui", "1  UI / UX: Streamlit console (localhost only)", [("q","Alert queue"),("sub","Submit alert"),("cd","Case detail:\\nscore, flags, evidence"),("dec","Approve / Modify /\\nReject"),("aud","Audit log\\n+ CSV export"),("mc","Model\\ncomparison")], INK),
 ("wf", "2  Workflow / orchestration: n8n 2.41.3 (webhooks on 127.0.0.1)", [("w1","WF-1 Triage\\nPOST /soc-triage"),("sw","SW-1 LLM Agent\\ncall · validate · retry"),("w2","WF-2 Decision\\nPOST /soc-decision"),("w3","WF-3 Read API\\nGET /soc-read"),("w4","WF-4 Error\\nhandler"),("w5","WF-5 SLA\\nwatcher")], INK),
 ("gr", "3  Guardrails (code, outside the model)", [("g1","Input validation\\nschema & size"),("g2","Injection screen\\nPII masking"),("g3","Strict JSON schema\\n+ one retry"),("g4","Evidence-ID check,\\npolicy & summary rules"),("g5","Action allow-list\\n(simulated)"),("g6","Role matrix\\nanti-downgrade")], E),
 ("ag", "4  Agents / LLMs (open-weight)", [("a1","Alert\\nCorrelation"),("a2","Threat\\nIntelligence"),("a3","Asset\\nContext"),("a4","Risk /\\nPrioritisation"),("a5","Incident\\nSummary"),("m","Groq: GPT-OSS 20B / 120B,\\nQwen 3.8 27B · or Ollama")], INK),
 ("td", "5  Tools / data", [("ti","Threat intel\\n(TI-001..006)"),("cm","CMDB\\n(assets)"),("id","Identity\\ndirectory"),("hi","Alert\\nhistory"),("dt","Data Tables:\\nsoc_cases"),("da","Data Tables:\\nsoc_audit")], INK),
 ("ho", "6  Human oversight and governance", [("h1","Tier 1 · Tier 2 · Lead\\napprovals by class"),("h2","SLA\\nre-escalation"),("h3","Audit: actor, model,\\nprompt & config version"),("h4","NIST AI RMF · ISO/IEC 42001\\n· ISO/IEC 27001"),("h5","Benchmark vs ground truth\\nbefore model changes"),("h6","Expert validation\\nof thresholds")], H),
]
body = "\n".join(layer(n, t.replace("&","&amp;"), items, c) for n, t, items, c in L)
# invisible spine keeps the layers stacked top to bottom
spine = " -> ".join(items[2][0] for _, _, items, _ in L) + " [style=invis];"
arch = f'''digraph ARCH {{ {BASE} rankdir=TB; newrank=true; ranksep=0.55; nodesep=0.25;
label=<<B>Figure 3. Technical and governance architecture</B>>; labelloc=t; fontsize=14; fontcolor="{INK}";
{body}
{spine}
sub -> w1 [label="trigger", constraint=false]; dec -> w2 [constraint=false];
'''+"}"
render("fig3_architecture", arch)
print("ok")

# ---------------- SYSTEMS THINKING: causal loop diagram (Stage 1) ----------------
def cl(a, b, sign, extra=""):
    col = E if sign == "+" else A
    return f'{a} -> {b} [label="{sign}", fontcolor="{col}", color="{col}" {extra}];'
cld = f'''digraph CLD {{ {BASE} layout=circo; mindist=1.1;
label=<<B>Figure 0. Causal loop view of SOC triage (Stage 1 systems thinking)</B>>; labelloc=t; fontsize=14; fontcolor="{INK}";
node [shape=ellipse, style="filled", fillcolor="white"];
vol [label="Alert volume\\n& false positives"]; load [label="Analyst workload"]; fat [label="Alert fatigue"];
depth [label="Investigation depth\\n& consistency"]; tune [label="Quality of feedback\\nto detection tuning"]; att [label="Analyst attrition"];
exp [label="Team experience"]; miss [label="Missed / late\\ndetections"]; agent [label="Governed agentic\\ntriage", color="{A}", fontcolor="{A}", penwidth=1.6];
bias [label="Automation bias\\n(over-trust)", color="{H}", fontcolor="{H}"]; hitl [label="HITL controls,\\nevidence display", color="{H}", fontcolor="{H}"];
{cl("vol","load","+")} {cl("load","fat","+")} {cl("fat","depth","-")} {cl("depth","tune","+")} {cl("tune","vol","-")}
{cl("fat","att","+")} {cl("att","exp","-")} {cl("exp","depth","+")} {cl("depth","miss","-")}
{cl("agent","load","-")} {cl("agent","depth","+")} {cl("agent","bias","+")} {cl("bias","miss","+")} {cl("hitl","bias","-")}
}}'''
render("fig0_causal_loop", cld)
print("cld ok")
