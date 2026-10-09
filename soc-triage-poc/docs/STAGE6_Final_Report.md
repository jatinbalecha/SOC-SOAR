# Governed Agentic AI for SOC Alert Triage and Incident Investigation

**Final Report: Agentic AI Digital Transformation Hackathon (Cybersecurity Challenge)**

**Submitted to:** Dr. Anshul Saxena
**Institution:** Symbiosis Centre for Information Technology (SCIT), Pune
**Date:** `<date>`

| PRN | Name | Role in project |
|---|---|---|
| 25030241061 | Arijit Paul | `[role]` |
| 25030241063 | Aviral Bajpei | `[role]` |
| 25030241070 | Garvit Saraswat | `[role]` |
| 25030241073 | Jatin Balecha | `[role]` |
| 25030241085 | Prakhar Aryan | `[role]` |

**Videos and supporting documents** (demonstration video, expert interview recording): https://drive.google.com/drive/folders/1RpVaA3kFUzE1MyHtbhU2kA-EvTd-V9jx?usp=sharing

> **How to finish this report:** replace every `[TO FILL]` marker.
> - Screenshots: follow the README's Fig 1–15 plan and add them where marked.
> - Benchmark numbers: paste from `benchmark/results/summary_by_model.csv`.
> - Expert findings: take them from the Stage 5 findings table.
>
> Do not report mock-model output as results.

## 1. Executive summary

SOC analysts face more alerts than they can investigate, and much of each investigation is spent gathering context from separate tools. We redesigned first-line alert triage as a governed, multi-agent workflow:

- **Agents:** five open-weight LLM agents assemble and assess the evidence.
- **Deterministic code:** scores, routes and enforces guardrails.
- **Humans:** an analyst approves every consequential action, under a role matrix enforced on the server.

The working proof of concept connects a Streamlit console to n8n workflows. It handles normal, ambiguous, high-risk, prompt-injection and malformed alerts, and logs every step for audit.

We compared `[TO FILL: number]` open-weight models on identical cases. `[TO FILL: one-sentence headline result]`. An industry expert, `[TO FILL: designation]`, validated the design and `[TO FILL: one-sentence verdict]`.

## 2. Problem

- **Scale:** the median SOC handles about 960 alerts a day, and roughly 40% are never investigated.
- **Time:** fully investigating one alert takes about 70 minutes.
- **Missed alerts:** 61% of teams admit ignoring alerts that later proved critical [R1].
- **False positives:** 73% of teams name them as their biggest detection challenge [R2].

The AS-IS process (Figure 1) has the same weaknesses:

- Analysts pivot across five or more consoles.
- Asset and threat context is looked up by hand.
- L1 to L2 handoffs lose context.
- Containment is approved by phone or chat with a weak audit trail.

## 3. Structured thinking and research (Stage 1)

**Critical thinking.** A Five Whys analysis traced missed alerts to one root cause: evidence assembly is manual and fragmented. We listed our assumptions and how we would test each one. In particular we did *not* assume model output can be trusted; routing and scoring therefore sit in code.

**Systems thinking** (Figure 0). Two reinforcing loops drive the problem:

- a fatigue spiral: volume → workload → fatigue → attrition → shallower investigation;
- a noise spiral: shallow investigation → poor tuning feedback → more false positives.

Agentic triage is a balancing loop. It also creates a new risk, automation bias, which is countered by HITL controls.

**STOIC prompt engineering.** We refined our brainstorming prompt in three versions:

1. A one-line request, which gave generic ideas.
2. A full STOIC prompt (situation, task, objective, inputs, constraints), which gave eight concrete ideas.
3. STOIC with scoring criteria and an output format, which gave a comparable screening table.

The agent prompts follow the same structure.

**Idea screening.** Multi-agent triage with HITL scored 4.4 out of 5, the highest of eight ideas. An auto-containment bot scored 3.1 and was rejected for safety reasons.

**Market and technology review.** We looked at four groups of existing solutions:

- AI assistants in security platforms (e.g. Microsoft Security Copilot, Google Security Operations, CrowdStrike Charlotte AI);
- SOAR and automation tools (Splunk SOAR, Cortex XSOAR, Tines, Torq);
- autonomous AI SOC analysts (e.g. Dropzone AI, Prophet Security);
- open-source building blocks (Wazuh, TheHive, Shuffle, MISP).

The gap for mid-size Indian SOCs and MSSPs is an open, auditable design built from open-weight models, with explicit human approval tiers. We chose n8n, Streamlit, open-weight models and deterministic guardrails (details in Stage 1, section 7).

## 4. Process redesign and architecture (Stage 2)

- **Figure 1: AS-IS process.** Actors, systems, decisions, handoffs and the pain points that cause delay.
- **Figure 2: TO-BE governed agentic process.** Every activity is marked A (autonomous), H (human-in-the-loop) or E (escalation). Routing is done by code:
  - LOW and benign with confidence ≥ 0.80 → Tier 1 confirms closure.
  - MEDIUM or low confidence → analyst review.
  - HIGH or CRITICAL → escalation, with the IR lead notified and approval by Tier 2 or the SOC Lead.
  - Any validation, injection, agent or guardrail failure → manual exception queue.
- **Figure 3: Technical and governance architecture.** Six layers: UI, orchestration, guardrails, agents/LLMs, tools/data, and human oversight and governance.

![Figure 1](diagrams/fig1_as_is.png)
![Figure 2](diagrams/fig2_to_be.png)
![Figure 3](diagrams/fig3_architecture.png)

## 5. Working solution (Stage 3)

**Build.**

- **Workflows:** n8n 2.41.3 runs seven workflows:
  - WF-1 triage;
  - SW-1 LLM agent caller, which enforces a strict JSON schema with one corrective retry and waits and resends if the provider rate-limits;
  - WF-2 analyst decision, with the role matrix;
  - WF-3 read API;
  - WF-4 error handler;
  - WF-5 SLA watcher;
  - WF-0 setup.
- **Console:** the Streamlit console starts triage, follows progress, shows the evidence, score breakdown and agent findings, and takes approve, modify or reject decisions with reason codes.
- **Data:** synthetic threat intel, CMDB, identity and alert-history data, with `soc_cases` and `soc_audit` tables.
- **Start-up:** a Windows one-click setup runs the system locally, with no Docker or local GPU needed.

**Brief requirements → evidence:**

| Requirement | Where shown |
|---|---|
| UI triggers the workflow | Fig `[n]`: Submit page → n8n execution |
| Multiple agents and orchestration | Fig `[n]`: WF-1 canvas; five SW-1 calls |
| Conditional routing | Fig `[n]`: route switch; cases 1–3 reach three different routes |
| Tool/data integration | Fig `[n]`: tool lookup nodes; evidence IDs in agent output |
| HITL approval | Fig `[n]`: Tier 1 refused on a CRITICAL case; Lead approves |
| Escalation | Fig `[n]`: IR notification; SLA watcher |
| Exception handling | Fig `[n]`: injection, malformed input, invented evidence ID, model outage |

**Test results** (pipeline verified end to end with a known-answer test model; real-model results in section 6):

| Alert | Type | Expected | Result |
|---|---|---|---|
| ALRT-1001 | Normal | LOW → closure confirmation | Score 12, LOW, PENDING_CLOSURE_CONFIRMATION ✔ |
| ALRT-2001 | Ambiguous | MEDIUM → review | Score 49, MEDIUM, flags UNKNOWN_ASSET + TI_CONFLICT ✔ |
| ALRT-3001 | High risk | CRITICAL → escalate | Score 97, CRITICAL, ESCALATED_PENDING_APPROVAL ✔ |
| ALRT-4001 | Prompt injection | Exception before any model call | EXCEPTION at injection_screen ✔ |
| ALRT-5001 | Malformed | Exception | EXCEPTION at input_validation ✔ |

Decision-rule tests passed 12 of 12. The guardrail tests behaved as designed:

- An invented evidence ID was caught.
- Broken JSON was recovered on retry.
- Rate-limit throttling was recovered.
- A missing API key or unreachable model sent the case safely to the manual queue.

`[TO FILL: Fig n–n screenshots of the console for each case]`

## 6. Model comparison (Stage 3)

**Method.** Each model received the same alerts, prompts, evidence and schema: 5 alerts × 3 repeats, at temperature 0 with a fixed seed. Every run was scored against `data/ground_truth.json`.

The models were `openai/gpt-oss-20b`, `openai/gpt-oss-120b` and `qwen/qwen3.8-27b` (all open-weight, served by Groq) `[and Llama 3.3 70B via OpenRouter, if run]`.

| Metric | GPT-OSS 20B | GPT-OSS 120B | Qwen 3.8 27B |
|---|---|---|---|
| Classification exact / within one | `[ ]` | `[ ]` | `[ ]` |
| Escalation accuracy | `[ ]` | `[ ]` | `[ ]` |
| False positives / false negatives | `[ ]` | `[ ]` | `[ ]` |
| Hallucinated evidence IDs | `[ ]` | `[ ]` | `[ ]` |
| JSON valid on first attempt | `[ ]` | `[ ]` | `[ ]` |
| Median model latency per case | `[ ]` | `[ ]` | `[ ]` |
| Task completion | `[ ]` | `[ ]` | `[ ]` |
| Explanation quality (blind, 1–5) | `[ ]` | `[ ]` | `[ ]` |

**Analysis** `[TO FILL]`:

- Which model was most accurate, and which was most reliable at producing structured output?
- Did any model trigger guardrail exceptions, and why?
- How did the speed/quality trade-off look?
- Which model would you recommend for a pilot, and why?

Note that the routing is code-driven, so a weaker model mostly shows up as lower confidence, more reviews or more exceptions, not as wrong closures. That is the intended safety property.

## 7. Guardrails and governance (Stage 4)

Sixteen risks are mapped in the form Risk → Guardrail → Governance requirement → Implementation, against NIST AI RMF 1.0, ISO/IEC 42001 Annex A and ISO/IEC 27001:2022 Annex A, with India's DPDP Act 2023 for personal data. The full register is in `docs/STAGE4_Guardrails_and_Governance.md`. The key controls are:

- **Data controls:** input validation, prompt-injection screening, PII masking, synthetic data only, and API keys kept in memory only.
- **Model controls:** strict schemas with one retry, an evidence-ID check against hallucination, policy rules linking actions to evidence, and a summary check that blocks claims of completed actions.
- **Action controls:** an allow-list of actions, all simulated, and no execution without approval.
- **Human oversight:** a role matrix (Tier 1 up to MEDIUM, Tier 2 up to HIGH, Lead for CRITICAL), an anti-downgrade rule, Approve disabled on exception cases, and SLA re-escalation.
- **Auditability:** every step is logged with actor, model, prompt and config version, and latency; export to CSV.
- **Network:** services bound to localhost only.

## 8. Expert validation (Stage 5)

The expert was `[TO FILL: name, designation, organisation]`; the profile was approved by faculty on `[date]`. The interview covered the five mandatory questions and a walkthrough of the AS-IS and TO-BE processes, the architecture, the live prototype, the HITL controls and the guardrails. The video and transcript are in Annexes A and B.

| Theme | Expert view | Our response |
|---|---|---|
| Feasibility | `[ ]` | `[ ]` |
| Risks | `[ ]` | `[ ]` |
| Usefulness | `[ ]` | `[ ]` |
| Improvements | `[ ]` | `[ ]` |
| Thresholds and ground truth | `[ ]` | `[ ]` |

## 9. Limitations

- **Small test set:** five synthetic alerts demonstrate the controls, not accuracy at scale.
- **Injection screening:** it is pattern-based and could be paraphrased around.
- **Usernames and hostnames:** these are not masked.
- **Analyst identity:** it is selected in the console, not authenticated.
- **Audit table:** it is append-only by convention, not tamper-proof.
- **Thresholds:** they reflect the team's design judgement until expert sign-off.
- **Hosted inference:** this sends masked, synthetic data to a third party.
- **Actions:** all response actions are simulated.

## 10. Recommendations

1. Run a shadow-mode pilot on real alerts, with expert-set thresholds and local or contracted inference.
2. Integrate with a live SIEM (e.g. Wazuh) and with SSO and MFA for analyst identity.
3. Forward audit events to the SIEM or WORM storage.
4. Add a classifier-based injection screen and pseudonymise usernames and hostnames.
5. Feed analyst decisions back into detection tuning, and re-run the benchmark before every model or prompt change.

## References

- [R1] The Hacker News, "The State of AI in the SOC 2025: Insights from Recent Study", Sep 2025.
- [R2] SANS 2025 Detection and Response Survey (as reported by LMNTRIX, 2026).
- NIST AI 100-1, AI Risk Management Framework 1.0; ISO/IEC 42001:2023; ISO/IEC 27001:2022; Digital Personal Data Protection Act, 2023.

## Annexes

- A. Expert interview video (in the shared Drive folder above)
- B. Full interview transcript
- C. Expert profile, designation evidence and faculty approval
- D. Stage 1 to 4 working documents (`docs/`)
- E. Benchmark raw data (`benchmark/results/runs.csv`)
- F. Project website link (`https://<username>.github.io/soc-triage-website/`) and demonstration video (Drive folder above)
