# Stage 6: Demonstration Video Script (target 13 minutes; allowed 10–15)

**Every team member must take part meaningfully.** The parts below are for four members, M1–M4. With three members, merge M4's parts into M1's and M3's. With five, give the guardrail segment to M5.

**Before recording:**

- Run `2_START.bat` and `SELF_TEST.bat`, then submit ALRT-1001, 2001 and 3001 with a **real model**, so that real cases are ready on screen.
- Have the website, the diagrams and the benchmark page open in separate tabs.
- Record at 1080p with a clear microphone, and show each speaker's face in a small corner window when they speak.

| # | Time | Speaker | On screen | What to say (key points, in your own words) |
|---|---|---|---|---|
| 1 | 0:00–1:00 | M1 | Website opening section | Team and challenge. "SOCs receive about 960 alerts a day and about 40% are never investigated." Our aim: every alert triaged consistently, with humans keeping control. |
| 2 | 1:00–2:30 | M1 | Stage 1 causal loop; idea screening table | Root cause from the Five Whys. The fatigue and noise loops. STOIC prompts v1 → v3. Why multi-agent triage with HITL won (4.4 out of 5) and why auto-containment was rejected. |
| 3 | 2:30–4:00 | M2 | Figure 1, then Figure 2 | AS-IS pain points: swivel-chair work, handoffs, approvals by phone. TO-BE: walk the A, H and E tags. Routing is done by code, never by a model. |
| 4 | 4:00–5:00 | M2 | Figure 3 | The six layers. Guardrails sit in code outside the model. Open-weight models are swappable. |
| 5 | 5:00–6:30 | M3 | Console: submit ALRT-1001, then the n8n execution view | The UI triggers the workflow. Show the n8n execution running. Result: LOW, score 12, Tier 1 confirms closure, audit rows appear. |
| 6 | 6:30–7:45 | M3 | ALRT-2001 case detail | Ambiguous case: asset missing from the register, conflicting threat intel, flags, lower confidence, so it goes to review, not closure. Show the score breakdown and each agent's evidence. |
| 7 | 7:45–9:15 | M4 | ALRT-3001: Tier 1 tries to approve, then the SOC Lead approves | Score 97, CRITICAL. The IR lead is notified. Tier 1 approval is refused **by the server**. The Lead approves; "SIMULATED, no real system changed". The audit trail shows who did what. |
| 8 | 9:15–10:15 | M4 | ALRT-4001; mock-halluc run; exception queue | Prompt injection stopped before any model call. An invented evidence ID is caught. Approve is disabled on exception cases. |
| 9 | 10:15–11:30 | M1 | Model comparison page and table | Method: the same cases, prompts and schema. Two or three headline results. Recommended model and why. |
| 10 | 11:30–12:30 | M2 | Stage 4 table (website guardrails section) | Three example rows: injection, unauthorised approval, audit trail. Frameworks: NIST AI RMF, ISO/IEC 42001, ISO/IEC 27001. |
| 11 | 12:30–13:30 | M3 | Website expert section; 10–15 s clip from the interview (with permission) | Expert's designation; the main feedback; what we changed as a result. |
| 12 | 13:30–14:15 | M4, then all | Website limitations section | Honest limitations and next steps: shadow pilot, SIEM integration, SSO. All members say one closing line each. |

**After recording:**

- Upload the video (YouTube unlisted or Google Drive with link sharing).
- Put the link in `website/content.json` as `video_url`.
- Run `python tools/build_website.py` and re-publish the website.
- Check the total length is between 10 and 15 minutes.
