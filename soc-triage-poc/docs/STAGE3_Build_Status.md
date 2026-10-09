# Stage 3: Build and Test Status

This note records what was run and how. Anything not listed as tested has not been tested.

**Test environment:** n8n 2.41.3 (npm install, Node 24.21, Linux, SQLite), Streamlit 1.64 (driven with `streamlit.testing.AppTest`), Python 3.12. Agents answered through `mock/mock_llm_server.py`, a fake Ollama server returning hand-written outputs.

**Windows scripts** (`1_SETUP.bat`, `2_START.bat`, `SELF_TEST.bat`, `RUN_BENCHMARK.bat`, `CHECK_MODELS.bat`): all parse without errors. `setup.ps1`, `self_test.ps1` and `benchmark.ps1` were run end to end under PowerShell 7.5 on Linux; `start.ps1` was tested except its window-opening steps, which only exist on Windows. **Not yet run on Windows PowerShell 5.1.**

`share.ps1` (online sharing) was tested up to the tunnel: the password-protected console starts and the password gate works (wrong password refused, correct one admitted). The Cloudflare tunnel itself was refused by the sandbox network (403) and failed safely with a clear message, so the public link is untested.

**n8n Cloud build** (`n8n/workflows_cloud/`, from `config/soc_config.cloud.json`): tested end to end on a local n8n 2.41.3 with environment-variable access blocked, as on n8n Cloud. The API key came from an n8n Header Auth credential. ALRT-1001/2001/3001 reached their expected routes in about 18 s each; a provider returning HTTP 429 on every first call recovered in 94 s (inside n8n Cloud's 180 s execution limit); ALRT-4001/5001 went to the exception queue; decision rules 12/12. The console was tested reading its settings from Streamlit-style secrets. Not yet run on n8n Cloud or Streamlit Community Cloud themselves.

**No open-weight model has been run yet.** Every result below shows that the *pipeline and controls* work. None of it measures *model quality*.

## 1. Brief requirements → where they are met

| Stage 3 requirement | Implementation | Status |
|---|---|---|
| Orchestration platform | n8n: 7 workflows (WF-0…WF-5 + SW-1) | Tested end to end |
| UI that triggers the workflow | Streamlit → `POST /soc-triage` | Tested end to end |
| Multiple agents | Correlation, TI, Asset Context, Risk, Summary (each an SW-1 call with its own prompt and schema) | Tested (mock answers) |
| Conditional routing | Switch on code-computed route: CONFIRM_CLOSURE / REVIEW / ESCALATE / EXCEPTION | Tested: all four routes reached |
| Tool/data integration | TI, CMDB, identity and alert-history lookups; n8n Data Tables | Tested |
| Human-in-the-loop | WF-2 Approve / Modify / Reject with a role matrix enforced on the server | Tested: 12 API cases + UI flow |
| Escalation | ESCALATED_PENDING_APPROVAL, IR Lead notification (simulated), SLA watcher | Routing tested; SLA watcher **not tested** |
| Exception handling | Validation, injection screen, schema retry, guardrails, model outage, error workflow | Tested except the WF-4 crash path |
| ≥ 3 test cases (normal / ambiguous / high-risk) | ALRT-1001 / 2001 / 3001, plus 4001 (injection) and 5001 (malformed) | Tested (mock answers) |
| ≥ 3 open-weight models compared | `RUN_BENCHMARK.bat` / `benchmark/run_benchmark.py` with GPT-OSS 20B, GPT-OSS 120B and Qwen 3.8 27B on Groq (Llama 3.3 70B via OpenRouter optional); Ollama variant in `config/soc_config.ollama.json` | **Script tested; real models not yet run** |
| Numbered screenshots | Plan in README (Fig 1–15) | **Team to capture** |

## 2. Test results

### 2.1 Unit tests: `node tests/test_core.js`

46 passed, 0 failed. These cover scoring, overrides, flags, guardrail negatives, the role matrix and masking.

### 2.2 End to end through n8n: `python tests/e2e_n8n.py`

| Alert | Model | Result | Score / class | Notes |
|---|---|---|---|---|
| ALRT-1001 | mock-model | PENDING_CLOSURE_CONFIRMATION | 12 / LOW | no flags |
| ALRT-2001 | mock-model | PENDING_ANALYST_REVIEW | 49 / MEDIUM | flags UNKNOWN_ASSET, TI_CONFLICT |
| ALRT-3001 | mock-model | ESCALATED_PENDING_APPROVAL | 97 / CRITICAL | IR notification (simulated) logged |
| ALRT-4001 | mock-model | EXCEPTION_MANUAL_QUEUE | n/a | stage `injection_screen`; no model call made |
| ALRT-5001 | mock-model | EXCEPTION_MANUAL_QUEUE | n/a | stage `input_validation` |
| ALRT-3001 | mock-flaky | ESCALATED_PENDING_APPROVAL | 97 / CRITICAL | 5 retries (one per agent), all recovered; `attempts=2` in audit |
| ALRT-3001 | mock-halluc | EXCEPTION_MANUAL_QUEUE | n/a | stage `output_guardrail`: "risk agent cites unknown evidence LOG-9999-99"; `hallucinated_ids=1` |
| ALRT-1001 | Ollama model with Ollama unreachable | EXCEPTION_MANUAL_QUEUE | n/a | stage `agent_corr`; the outage is handled and the case is not lost |
| ALRT-1001 | openai/gpt-oss-20b (default build) with Groq blocked by the sandbox network | EXCEPTION_MANUAL_QUEUE | n/a | request correctly addressed to api.groq.com with the key header; blocked by sandbox egress; failed safe |
| ALRT-3001 | hosted-API path (OpenAI-style mock endpoint, Bearer key) | ESCALATED_PENDING_APPROVAL | 97 / CRITICAL | API key read from environment variable, sent as header |
| ALRT-3001 | hosted path, endpoint returns 429 on every first call | ESCALATED_PENDING_APPROVAL | 97 / CRITICAL | 5 waits + resends, `rate_limited=true` per agent; excluded from JSON-compliance metric |
| ALRT-3001 | hosted path, API key missing | EXCEPTION_MANUAL_QUEUE | n/a | 401 recorded in the exception reason |

### 2.3 Human decisions through n8n: `python tests/e2e_decisions.py`

12 of 12 passed:

- Tier 1 approving a CRITICAL case is refused (403).
- Tier 2 approving isolation of a CRITICAL asset is refused.
- Tier 1 cannot downgrade a CRITICAL case to LOW to gain authority.
- Tier 1 can modify a MEDIUM case.
- Approve is refused on an exception case.
- Reject without a reason code is refused.
- An unknown analyst is refused.
- An action not on the allow-list is refused.
- The Lead can approve a CRITICAL case; the action is simulated and labelled.
- A second decision on an already decided case is refused.
- Tier 2 rejecting an exception case sends it to RETURNED_TO_MANUAL.
- Tier 1 can confirm a LOW closure.

### 2.4 Streamlit UI against live n8n

All six pages render with no exceptions: Alert queue, Submit, Case detail, Audit log, Model comparison, Guardrails.

The interactive flow was tested: submit ALRT-1001 from the UI, the progress box reaches "Awaiting closure confirmation", Tier 1 approval of a CRITICAL case shows n8n's refusal, and Tier 1 confirming the LOW closure shows the simulated-action message and ticket ID.

### 2.5 Benchmark script (mock self-test with `--allow-mock`)

The script produces `runs.csv`, `summary_by_model.csv` and the blind rubric sheet. It refuses mock models unless explicitly allowed, and the UI shows a red warning if mock results are loaded.

The self-test found and fixed one metric bug: "within one level" was reported as 0 when the class was exact.

## 3. Fixes made during integration

- **n8n 2.41.3 requires Node ≥ 24.** It refuses to start on Node 22, so the README recommends Docker.
- **n8n's command-line `execute` cannot use Data Tables** ("module is disabled"). WF-0 therefore also has a `POST /soc-setup` webhook for scripted setup.
- **Streamlit:** the UI case ID now has a random suffix, so two submissions in the same second no longer collide. Deprecated `use_container_width` was replaced.

## 4. Not yet tested (team to do before submission)

1. **Real open-weight models.** Run the benchmark with at least three models and three repeats. Expect lower first-attempt JSON compliance and some guardrail exceptions from 7–8B models; that is a finding to report, not a failure.
2. **Docker setup path** (README steps 2–4) and the editor-UI import path. All testing here used an npm install.
3. **WF-4 Error Handler.** It is wired as the error workflow for WF-1/2/3, but no test produced an unhandled crash.
4. **WF-5 SLA Watcher** was not published during testing.
5. **Model-detected injection.** A model that reports injection in `escalation_reason` should be routed to an exception. This is covered by unit tests only, because the regex screen stops ALRT-4001 first.
6. The hosted path against a **real provider** (Groq/OpenRouter): tested only against the mock's OpenAI-style endpoint. Model IDs and free-tier limits change often.
7. **Screenshots** (README Fig 1–15).
8. **Expert validation** of thresholds, weights and ground truth [E].
