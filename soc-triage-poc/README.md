# Governed Agentic AI for SOC Alert Triage (PoC)

n8n orchestrates five AI agents (Alert Correlation, Threat Intelligence, Asset Context, Risk/Prioritisation, Incident Summary). Deterministic code scores and routes each case, and a human approves every action through a Streamlit console. All data is synthetic, and every containment action is simulated.

```
Streamlit UI ──POST /soc-triage──▶ WF-1 Triage ──▶ SW-1 LLM Agent (×5, retry once) ──▶ open-weight models (Groq API, or Ollama)
      │                              │ validate · injection & PII screen · lookups · scoring · guardrails · routing
      │◀──GET /soc-read── WF-3 Read API ◀── n8n Data Tables: soc_cases, soc_audit
      └──POST /soc-decision──▶ WF-2 Analyst Decision (role matrix · allow-list · simulated action · audit)
                               WF-4 Error Handler (any crash → manual queue)   WF-5 SLA Watcher (optional)
```

## Deliverables by stage

| Stage | Marks | Deliverable in this package | Team still has to |
|---|---|---|---|
| 1 Structured thinking, STOIC, research | 5 | `docs/STAGE1_Structured_Thinking_and_Research.md` + Figure 0 | Match STOIC wording to the class definition; check vendor facts |
| 2 Process mapping and architecture | 5 | `docs/STAGE2_Process_Mapping_and_Architecture.md` + Figures 1–3 (`docs/diagrams/`) | Review against your understanding |
| 3 Integrated working solution | 20 | Whole repository; `docs/STAGE3_Build_Status.md` | Run the benchmark with real models; take screenshots (plan below) |
| 4 Guardrails and governance | 5 | `docs/STAGE4_Guardrails_and_Governance.md` | Verify clause numbers against the standards |
| 5 Expert interview and validation | 10 | `docs/STAGE5_Expert_Interview_Kit.md` | Get faculty approval; interview; video; transcript; findings |
| 6 Report, website, video | 5 | `docs/STAGE6_Final_Report.md`, `website/index.html`, `docs/STAGE6_Demo_Video_Script.md` | Fill the `[TO FILL]` markers; record the video; publish the website |

**Hosting (free):** the website on GitHub Pages; the live console shared from the laptop with `3_SHARE_ONLINE.bat` (password-protected public link). See `docs/HOSTING.md`.

To update the website after the benchmark or interview, edit `website/content.json` (team, expert, video link), then run `python tools/build_website.py`. Results are read from `benchmark/results/summary_by_model.csv`; mock-model rows are never published.

## Repository map

| Path | What it is |
|---|---|
| `1_SETUP.bat`, `2_START.bat`, `CHECK_MODELS.bat`, `SELF_TEST.bat`, `RUN_BENCHMARK.bat` | Windows launchers (scripts in `scripts/win/`) |
| `n8n/workflows/*.json` | The seven importable workflows (00 setup … 06 SLA watcher) |
| `n8n/code/soc_core.js` | All deterministic logic: validation, screening, lookups, scoring, guardrails, role matrix |
| `tools/build_workflows.js` | Regenerates the workflow JSON from `soc_core.js`, `config/` and `prompts/`. Re-run it after any change to those. |
| `config/soc_config.json` | Active config: thresholds, weights, allow-list, roles, demo users, models, endpoints. Same as `soc_config.hosted.json` (Groq); `soc_config.ollama.json` is the local-model variant |
| `prompts/*_v1.0.txt` | Versioned agent prompts |
| `data/alerts/` | The five test alerts; `data/lookups/` TI, CMDB, identity, alert history; `data/ground_truth.json` expected outcomes |
| `ui/app.py` | Streamlit console |
| `benchmark/run_benchmark.py` | Model comparison: same alerts × models × repeats, scored against ground truth |
| `mock/mock_llm_server.py` | Fake Ollama for **pipeline tests only** (never a model result) |
| `tests/` | `test_core.js` (unit), `e2e_n8n.py` and `e2e_decisions.py` (end to end against a running n8n) |
| `docs/STAGE3_Build_Status.md` | What was tested, how, and what is still open |
| `docs/STAGE4_Guardrails_and_Governance.md` | Stage 4 deliverable |
| `docs/HOSTING_N8N_CLOUD.md` | Putting n8n and the console online without the laptop (n8n Cloud trial + Streamlit Community Cloud); uses `config/soc_config.cloud.json` and `n8n/workflows_cloud/` |
| `docs/RUN_WITH_DOCKER_OLLAMA.md` | Alternative setup with local models |
| `deploy/` | Optional Dockerfile for a paid or college Docker host (untested); see `docs/HOSTING.md` |
| `website/` | Publishable project website (`index.html`, built by `tools/build_website.py` from `content.json`) |

## Quick start (Windows, no Docker, no Ollama)

You install two programs; the scripts do the rest. The models run on Groq's free hosted API.

**Install once:**

1. **Node.js 24 LTS** from https://nodejs.org (Windows Installer .msi, default options; leave "Tools for Native Modules" unticked).
2. **Python 3.10 or newer** from https://python.org (tick **"Add python.exe to PATH"**). Python 3.13 is fine.
3. A free **Groq API key**: sign up at https://console.groq.com (no card needed), go to **API Keys → Create API Key**, and copy the key (it starts with `gsk_`). Keep it private.

Then close all PowerShell windows. Unzip this folder somewhere simple, such as `C:\soc-triage-poc` (not inside OneDrive).

**Run (double-click in the project folder):**

| Step | File | What it does | When |
|---|---|---|---|
| 1 | `1_SETUP.bat` | Checks Node and Python, installs the Python libraries and n8n 2.41.3, builds, imports and publishes the workflows | Once. Takes 5–15 min the first time. Re-run after editing the config, with n8n closed |
| 2 | `CHECK_MODELS.bat` | Asks for your Groq key and checks every model in the config is still offered | Once, before the first real run |
| 3 | `2_START.bat` | Asks for the key (hidden, not saved), then starts the mock server, n8n and the console, creates the data tables, and opens http://localhost:8501 | Every session. Keep the "SOC n8n server" and "SOC Streamlit UI" windows open |
| 4 | `SELF_TEST.bat` | Runs the pipeline with mock models: 5 alerts, 12 decision rules and the guardrail demo. No key needed | Optional check that everything works |
| 5 | `RUN_BENCHMARK.bat` | Runs the 3 Groq models × 5 alerts × 3 repeats (1–3 hours on the free tier) | Once, for the Stage 3 model comparison |
| 6 | `3_SHARE_ONLINE.bat` | Shares a password-protected copy of the console as a free public link (Cloudflare tunnel) while the laptop runs; n8n stays private | Only when evaluators need live access; press Enter to stop |

To stop everything, close the n8n and Streamlit windows.

**n8n editor** (for workflow screenshots): http://localhost:5678. Create the owner account on your first visit; it stays local.

**Models (checked against Groq's model page, Sept 2026):** `openai/gpt-oss-20b`, `openai/gpt-oss-120b` and `qwen/qwen3.8-27b` (a preview model).

- Optional fourth: `meta-llama/llama-3.3-70b-instruct:free` via OpenRouter, which needs a second free key from openrouter.ai. `2_START.bat` asks for it.
- Groq retires models often. If `CHECK_MODELS.bat` shows **NOT AVAILABLE**, replace that `"id"` in `config\soc_config.json` with one from the list it prints, then close n8n and run `1_SETUP.bat` again.

**Good to know:**

- **Speed.** The workflow waits 20 seconds before each agent call to stay inside the free tier, so a case takes about 2 minutes. If Groq still answers "too many requests", the workflow waits 60 seconds and resends. These waits are logged as `rate_limited` and do not count against the model's score.
- **Daily limits.** If you hit Groq's daily limit, run one model per day and merge the results with `RUN_BENCHMARK.bat --models openai/gpt-oss-120b --append`.
- **Data leaves your laptop.** Masked, synthetic alerts are sent to Groq. Stage 4 records this as a deliberate deviation (AIR-02). For fully local models, see `docs/RUN_WITH_DOCKER_OLLAMA.md`.
- **Network exposure.** n8n and the console listen on `127.0.0.1` only, so other machines on the network can't reach them.

**If something fails:**

| Message | Fix |
|---|---|
| "Node.js not found" / "needs 24" | Install Node.js 24 LTS, close and reopen windows, run `1_SETUP.bat` again |
| "Python 3.10+ not found" | Reinstall Python with "Add python.exe to PATH" ticked |
| Case goes to the exception queue with `401` or `MISSING_API_KEY` | Wrong or missing key. Close n8n, run `2_START.bat` and paste the key again |
| Exception with `404`, `model_not_found` or `decommissioned` | Run `CHECK_MODELS.bat`, replace the model id, close n8n, run `1_SETUP.bat` |
| Exception with `400 ... response_format` or `reasoning_effort` | That model doesn't accept JSON mode or the setting. Remove its `extra_body` line or choose another model, then re-run `1_SETUP.bat` |
| Many `rate_limited` calls or 429 exceptions | In `config\soc_config.json` raise `llm.min_delay_ms` to 30000 and `llm.rate_limit_wait_ms` to 90000, then re-run `1_SETUP.bat` |
| "n8n is already running" | Close the "SOC n8n server" window, or restart the laptop |
| `npm install` errors (ERR!) | Send the ERR! lines for help |
| Windows says "Windows protected your PC" when opening a `.bat` | Click **More info → Run anyway**. Or, before unzipping, right-click the zip → Properties → tick **Unblock** → OK, then unzip again |

## Demo script (about 8 minutes)

| # | Sign in as | Action | What to show |
|---|---|---|---|
| 1 | t1.analyst01 | Submit **ALRT-1001** (normal) | LOW, score 12 → awaiting closure confirmation; Tier 1 confirms; case closed (simulated) |
| 2 | t1.analyst01 | Submit **ALRT-2001** (ambiguous) | MEDIUM, 49; flags UNKNOWN_ASSET and TI_CONFLICT; override R3; low confidence → review, not closure |
| 3 | t1.analyst01 → lead.soc | Submit **ALRT-3001** (high risk) | CRITICAL, 97; R1 + R2; Tier 1 approve is **refused by n8n**; Lead approves; "SIMULATED, no real system changed" |
| 4 | any | Submit **ALRT-4001** (prompt injection) | Stopped before any model call; exception queue; Approve refused; Tier 2 rejects with reason code |
| 5 | any | Submit **ALRT-5001** (malformed) | Input validation exception |
| 6 | any | Model = *Mock: invented evidence ID* on ALRT-3001 | Output guardrail catches `LOG-9999-99` → exception |
| 7 | any | Audit log page | Every step with model, prompt version, latency; CSV export |
| 8 | any | Model comparison page | Measured results from `RUN_BENCHMARK.bat` |

The actual model used is picked in the sidebar. Use the mock models only for steps 6 and for rehearsal, and say so on screen.

## Screenshot plan (number them in the report)

| Fig | Screen |
|---|---|
| 1 | n8n workflow list showing all seven workflows published |
| 2 | WF-1 Triage canvas (full) |
| 3 | WF-1 close-up: Validate Input → Injection & PII Screen → exception branch |
| 4 | SW-1 LLM Agent canvas (retry path) |
| 5 | WF-1 execution view of ALRT-3001 with the routing branch highlighted |
| 6 | WF-2 Analyst Decision canvas (role matrix) |
| 7 | Streamlit: Submit alert with the progress box |
| 8 | Streamlit: Case detail, ALRT-1001 (LOW) |
| 9 | Case detail, ALRT-2001 (flags and review) |
| 10 | Case detail, ALRT-3001 (score breakdown, R1/R2) |
| 11 | Tier 1 approval refused on ALRT-3001 |
| 12 | ALRT-4001 injection exception |
| 13 | Audit log page |
| 14 | Model comparison page with measured results |
| 15 | n8n Data Tables view of `soc_cases` |

## Known limitations

These are summarised here; details are in `docs/STAGE4_…` section 9.

- Demo role selector, not real authentication.
- Regex-only injection screen.
- Usernames and hostnames are not masked.
- The audit table is append-only by convention, not tamper-proof.
- Five synthetic alerts only.
- Thresholds are the team's judgement and need expert validation.
- All actions are simulated.
