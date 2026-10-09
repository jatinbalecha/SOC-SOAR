# Hosting n8n online: n8n Cloud + Streamlit Community Cloud

This puts the whole system online with **no laptop running**:

- **n8n Cloud** hosts the workflows and agents.
- **Streamlit Community Cloud** hosts the console (`app.py`).
- **GitHub Pages** hosts the website (already done).

## Know the limits first (n8n's terms, checked October 2026)

| Limit | What it means for us |
|---|---|
| **14-day free trial**, no card needed | Start it **close to the evaluation date**. After 14 days the workspace is **deleted** unless you pay (Starter is about $20–24 a month). |
| **1,000 executions** in the trial | Each alert uses roughly 15–25 executions: the triage run, five agent calls, and the console checking for the result. That is enough for the demo and evaluation (about 40–60 alerts), **not** for the benchmark. Run `RUN_BENCHMARK.bat` on the laptop instead. |
| **180 seconds** per execution | The cloud build shortens the waits between agent calls (3 s instead of 20 s), so a case finishes in about a minute. |
| **No access to environment variables** | The cloud build keeps the Groq key in an n8n **credential** instead. |
| **Webhooks are public** | Anyone who knows your n8n address could call them. Do not publish the n8n address; give evaluators only the console link, which has a password. |

The mock models and the OpenRouter model are left out of the cloud build: n8n Cloud cannot reach a mock server on your laptop, and one credential covers one provider. Do the guardrail demo with the mock model on the laptop setup.

---

## Part 1: Build the cloud version of the workflows (on the laptop, once)

In PowerShell, inside the `soc-triage-poc` folder:

```powershell
$env:SOC_CONFIG = "config/soc_config.cloud.json"
$env:SOC_OUT = "n8n/workflows_cloud"
node tools\build_workflows.js
```

This writes seven files to `n8n\workflows_cloud\`. The zip already contains them, so you only need this step if you change `config\soc_config.cloud.json` (for example a model ID).

## Part 2: Set up n8n Cloud

**Step 1: Start the trial**

1. Go to **n8n.io** and click **Get started** (free trial).
2. Sign up with your email. Choose a workspace name, for example `soc-triage-scit`.
3. Your n8n address will be `https://soc-triage-scit.app.n8n.cloud`. **Write it down.**
4. Close the n8n Assistant pop-up if it appears (as on the laptop).

**Step 2: Add the Groq key as a credential**

1. In n8n, click **Create → Credential** (or Overview → **Credentials** tab → **Add credential**).
2. Search for **Header Auth** and select it.
3. Fill in:
   - **Name** (the field at the top of the credential): `Groq API key`
   - **Name** (header name): `Authorization`
   - **Value:** `Bearer gsk_your_key_here`, with the word **Bearer**, one space, then your key
4. Click **Save**.

**Step 3: Import the workflows, in this order**

For each file below:

1. Click **Create → Workflow**.
2. Click the **⋯** menu at the top right → **Import from File**.
3. Choose the file from `n8n\workflows_cloud\`.
4. Click **Save** (top right).

| Order | File | Workflow name |
|---|---|---|
| 1 | `02_sw_llm_agent.json` | SOC SW-1 LLM Agent |
| 2 | `05_error_handler.json` | SOC WF-4 Error Handler |
| 3 | `00_setup.json` | SOC WF-0 Setup (run once) |
| 4 | `01_triage.json` | SOC WF-1 Triage |
| 5 | `03_decision.json` | SOC WF-2 Analyst Decision |
| 6 | `04_read_api.json` | SOC WF-3 Read API |

**Do not import `06_sla_watcher.json`.** It runs every 2 minutes and would use up the 1,000 executions in under two days.

**Step 4: Reconnect the links** (importing gives each workflow a new ID, so the links between them must be set again)

1. **SW-1 LLM Agent → the key:** open **SOC SW-1 LLM Agent**.
   - Double-click **Call Model**. Under **Credential for Header Auth**, choose **Groq API key**, then close the node.
   - Do the same for **Call Model (retry)**.
   - Click **Save**.
2. **WF-1 Triage → the agent workflow:** open **SOC WF-1 Triage**. Double-click each of the five **Agent:** nodes (Correlation, Threat Intel, Asset, Risk, Summary). In **Workflow**, choose **From list → SOC SW-1 LLM Agent**. Click **Save**.
3. **Error workflow:** in **WF-1 Triage**, **WF-2 Analyst Decision** and **WF-3 Read API**, open **⋯ → Settings**, set **Error Workflow** to **SOC WF-4 Error Handler**, and click **Save**.

**Step 5: Create the data tables**

1. Open **SOC WF-0 Setup (run once)** and click **Execute workflow**.
2. Check the **Data tables** tab: **soc_cases** and **soc_audit** should appear.

**Step 6: Publish**

Publish (activate) these, using the **Publish** button at the top of each workflow:

- **SOC SW-1 LLM Agent**
- **SOC WF-4 Error Handler**
- **SOC WF-1 Triage**
- **SOC WF-2 Analyst Decision**
- **SOC WF-3 Read API**

Leave **WF-0 Setup** unpublished.

**Step 7: Check it answers**

Open this in your browser, with your own workspace name:
```
https://soc-triage-scit.app.n8n.cloud/webhook/soc-read?resource=ping
```
You should see `{"ok":true, ...}`.

## Part 3: Host the console on Streamlit Community Cloud (free)

**Step 1: Put the project on GitHub**

1. On github.com, click **+ → New repository**, name it `soc-triage-poc`, choose **Public**, and click **Create repository**.
2. Click **"uploading an existing file"**. From your `soc-triage-poc` folder, drag in these folders and files: `ui`, `config`, `data`, `n8n`, `prompts`, `docs`, `README.md`.
   - **Do not upload** `tools\bin` (the downloaded tunnel tool) or anything containing a key. The project never stores the key in a file, so the folders above are safe.
3. Click **Commit changes**.

**Step 2: Deploy the console**

1. Go to **share.streamlit.io** and sign in with your GitHub account.
2. Click **Create app → Deploy a public app from GitHub**.
3. Fill in:
   - **Repository:** `your-username/soc-triage-poc`
   - **Branch:** `main`
   - **Main file path:** `ui/app.py`
4. Click **Advanced settings**. In the **Secrets** box paste the following, with your own n8n address and a password of your choice:
   ```toml
   N8N_BASE_URL = "https://soc-triage-scit.app.n8n.cloud"
   SOC_CONFIG = "config/soc_config.cloud.json"
   POLL_SECONDS = "10"
   APP_PASSWORD = "choose-a-password"
   ```
5. Click **Deploy**. After 2–3 minutes you get a link such as `https://soc-triage-poc.streamlit.app`.

**Step 3: Test**

1. Open the link and enter the password.
2. In the sidebar, choose **GPT-OSS 20B (Groq)**.
3. Submit **ALRT-1001**. Within about a minute it should show **LOW, score 12** (or the model's own result).
4. In n8n Cloud, the **Executions** tab shows the run, which is useful for screenshots.

## Good to know

- **Sleeping:** a Streamlit app sleeps after about 12 hours with no visitors. Opening the link wakes it in about a minute. n8n Cloud does not sleep.
- **Watching the quota:** n8n shows executions used under **Settings → Usage and plan**. The console checks for results every 10 seconds (`POLL_SECONDS`) to save executions.
- **Changing a model:** edit `config\soc_config.cloud.json`, rebuild (Part 1), re-import only `01_triage.json` and `02_sw_llm_agent.json`, then redo Step 4. Also upload the changed config file to GitHub so the console's model list matches.
- **After the trial:** n8n keeps your workflows downloadable for 90 days. The laptop setup (`2_START.bat`) keeps working regardless.

## What is exposed, and what is not (cloud setup)

| Component | Reachable from the internet? | Protection |
|---|---|---|
| Console (Streamlit Cloud) | Yes | Password (`APP_PASSWORD`) |
| n8n editor | Yes | n8n account login |
| n8n webhooks (`/soc-triage`, `/soc-decision`, `/soc-read`) | Yes, by URL | Address not published; role matrix still enforced; synthetic data only |
| Groq API key | No | Stored encrypted in the n8n credential; never in GitHub or the console |

This is weaker than the laptop setup, where n8n is not reachable at all. Note it in the Stage 4 residual risks if you use this setup for the evaluation.
