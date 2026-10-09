# Stage 5: Industry Expert Interview and Final Validation Kit

Stage 5 carries 10 marks:

- **5 marks for completion:** the expert is approved and interviewed; the full video and full transcript are submitted; the mandatory questions are covered; feedback is documented.
- **5 marks for the expert's level:** Director-level 5, Manager-level 3, Analyst/Specialist-level 2.

**Faculty approval is required before the interview.** If the expert changes, a fresh approval is needed.

## 1. Choosing the expert

| Aim for | Examples of fitting roles | Level and marks |
|---|---|---|
| Best | Head of SOC, Director of Security Operations, CISO, VP or AVP Cyber Defence, Practice Head at an MSSP | Director: 5 |
| Good | SOC Manager, Incident Response Manager, Cyber Defence Manager, Security Operations Program Manager | Manager: 3 |
| Acceptable | Senior SOC Analyst, Senior Security Consultant, Detection Engineer | Analyst / Specialist: 2 |

**Domain relevance matters:** the expert should run or work in alert triage, SOC or incident response, not an unrelated IT role. Good places to look are your internship and alumni network, MSSPs, bank and fintech SOCs, and faculty contacts.

## 2. Approval request (send to faculty before scheduling)

```
Subject: Expert approval request – Agentic AI Hackathon (SOC Alert Triage) – Team <name>

Expert name:
Current designation:
Organisation:
Function / domain (e.g. Security Operations, Incident Response):
Relevant experience (years, SOC / IR scope, team size managed if any):
Professional profile / LinkedIn:
Proposed designation level (Director / Manager / Analyst):
Justification (2–3 lines on why this person can validate SOC triage and our PoC):
Proposed interview date and mode (in person / video call, recorded):
```

Keep the faculty's approval email. It is part of the evidence.

## 3. Before the interview

- **Consent:** record the expert's consent to video recording and to their name and designation appearing in the report and website. Offer to anonymise the organisation. Do not ask for, and do not record, confidential client or employer data.
- **Evidence of designation:** ask for a business card, a company profile page, or a LinkedIn screenshot. Store it with the submission.
- **Setup:** use a video call with recording turned on, or a camera in the room. Run a test recording. One team member asks questions, one runs the demo, and one takes notes.
- **Demo ready:** run `2_START.bat`, and the evening before run the three demo cases and `SELF_TEST.bat`. Have the diagrams (Figures 1–3) and the Stage 4 table open.
- **Time:** about 45 minutes. Agree the time with the expert in advance.

## 4. Interview run sheet (about 45 minutes)

| Time | Segment | Who |
|---|---|---|
| 0–3 | Introductions; purpose; confirm consent to record (on camera) | Lead interviewer |
| 3–20 | **Five mandatory questions** (section 5), with follow-ups | Lead interviewer |
| 20–35 | **Walkthrough:** AS-IS → TO-BE → architecture → live PoC → HITL → guardrails (section 6) | Demo owner |
| 35–43 | **Validation questions** (section 7) | Lead interviewer |
| 43–45 | Thanks; ask permission to quote; next steps | Lead interviewer |

## 5. The five mandatory questions (ask word for word), with follow-ups

**Q1.** What makes SOC alert triage and incident investigation a complex task in your organisation? What evidence, tools, rules and judgement must an analyst normally consider?
- *Follow-up:* What does a "good" triage decision look like, and how do you check that it was good?
- *Follow-up:* Which part of triage is most dependent on experience?

**Q2.** Which people, systems, security tools, data sources or teams does a SOC analyst depend on, and where do these dependencies create difficulties or delays?
- *Follow-up:* How reliable is your CMDB / asset inventory for triage?
- *Follow-up:* Where do handoffs between L1, L2 and IR lose context?

**Q3.** How important is speed in SOC alert triage and incident response, and which stages are most time-sensitive?
- *Follow-up:* Which SLAs or regulatory timelines do you work to? (For example, CERT-In incident reporting.)
- *Follow-up:* Where would saving 10 minutes per alert matter most?

**Q4.** What types and volume of security information must analysts examine, and what problems arise when alerts, logs or context are incomplete or fragmented across systems?
- *Follow-up:* Roughly how many alerts per analyst per shift, and what share are false positives?
- *Follow-up:* What do analysts do when the evidence is incomplete: close, wait, or escalate?

**Q5.** What kinds of unusual, ambiguous or high-risk alerts are difficult to handle using standard rules, and how are such cases currently managed or escalated?
- *Follow-up:* Have you seen attackers try to manipulate tooling or logs, in a way similar to our prompt-injection case?
- *Follow-up:* Who is allowed to approve host isolation or account disablement in your SOC?

## 6. Walkthrough script (what to show the expert)

1. **AS-IS (Figure 1):** "This is how we understand the current process. Is anything missing or wrong?"
2. **TO-BE (Figure 2):** explain the A / H / E marking. "Are the human decision points in the right places?"
3. **Architecture (Figure 3):** emphasise that guardrails sit in code outside the model and that routing is deterministic.
4. **Live PoC:**
   - ALRT-1001, a normal case: LOW, closure confirmation.
   - ALRT-2001, ambiguous: MEDIUM, flags UNKNOWN_ASSET and TI_CONFLICT, review.
   - ALRT-3001, high risk: CRITICAL, escalation. Show the Tier 1 approval being refused, then the SOC Lead approving.
5. **Guardrails:**
   - ALRT-4001: the prompt injection is stopped before any model call.
   - The mock model's invented evidence ID is caught.
   - Show the audit log.
6. **Model comparison:** show the benchmark page and explain the metrics.
7. **Stage 4 table:** go through Risk → Guardrail → Requirement → Implementation.

## 7. Validation questions (feasibility, risks, usefulness, improvements)

1. **Feasibility:** Could this design work in a SOC like yours? What would block it: data access, integration, cost or skills?
2. **Usefulness:** Which agent's output would help your analysts most? Which would they ignore?
3. **Risk:** What worries you most about using LLMs in triage? Do our guardrails address it?
4. **HITL:** Are the approval tiers (Tier 1 up to MEDIUM, Tier 2 up to HIGH, Lead for CRITICAL) realistic? Would you change them?
5. **Thresholds [E]:** Do the score bands (LOW 0–29, MEDIUM 30–59, HIGH 60–79, CRITICAL 80–100), the closure confidence of 0.80 and the 10-minute SLA make sense? What would you change?
6. **Ground truth [E]:** Do you agree with the expected outcomes for our five test alerts?
7. **Data:** Is sending masked, synthetic alerts to a hosted model acceptable for a pilot? What would you require for real data?
8. **Improvements:** What one feature would you add before a pilot?
9. **Adoption:** How would you measure success after three months?

## 8. Transcript template

The brief asks for the *complete* transcript, not a summary. Use the recording tool's auto-transcript, then correct it by hand.

```
Interview transcript – Agentic AI Hackathon, SOC Alert Triage
Expert: <name>, <designation>, <organisation>        Date: <dd-mm-yyyy>   Mode: <video call / in person>
Interviewers: <names>                                  Recording file: <file name>   Duration: <mm:ss>
Consent to record and to be named: <yes / organisation anonymised>

[00:00] <Interviewer>: ...
[00:15] <Expert>: ...
...
```

## 9. Findings capture (goes into the report and website)

| # | Topic | Expert's comment (paraphrase; quote only short phrases with permission) | Type | Our response / change made | Status |
|---|---|---|---|---|---|
| 1 | | | Feasibility / Risk / Usefulness / Improvement | | Done / Planned / Not adopted (why) |
| 2 | | | | | |

Record any thresholds or ground-truth items the expert confirmed or changed. These close the **[E]** items in Stage 4, section 6, and in the Stage 3 build-status note.

## 10. Submission checklist

- [ ] Faculty approval email for the expert profile
- [ ] Evidence of the expert's designation
- [ ] Signed or recorded consent
- [ ] Full interview video
- [ ] Full transcript
- [ ] Findings table with feasibility, risks, usefulness and improvements
- [ ] Changes made to the PoC or design because of the feedback (before/after)
