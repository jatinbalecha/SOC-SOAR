# Option A: Docker + Ollama (local models)

Use this only if you want the models to run on your own laptop. First switch the config:

```powershell
Copy-Item config\soc_config.ollama.json config\soc_config.json -Force
node tools\build_workflows.js
```


**Requirements:** Docker, Python 3.10+, Ollama, and about 16 GB RAM for 7–8B models. Node.js 20+ is only needed to run `tools/build_workflows.js` or the unit tests. n8n 2.41.3 itself needs Node 24, which is why the Docker image is recommended.

### 1. Models

```bash
ollama pull qwen2.5:7b
ollama pull llama3.1:8b
ollama pull mistral:7b
# optional 4th: ollama pull gemma3:4b
```

Check the exact tags on ollama.com before pulling. If you use different ones, edit `config/soc_config.json → models`, then run `node tools/build_workflows.js`.

### 2. n8n

```bash
docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n \
  --add-host=host.docker.internal:host-gateway docker.n8n.io/n8nio/n8n:2.41.3
```

Open http://localhost:5678 and create the owner account.

`config/soc_config.json` points n8n at Ollama on `http://host.docker.internal:11434`. If n8n and Ollama run somewhere else, change `llm.ollama_base_url` (and `llm.mock_base_url` for the mock server), then rebuild the workflows with `node tools/build_workflows.js`.

### 3. Import and publish the workflows

Command line (keeps the fixed workflow IDs, so sub-workflow and error-workflow links work without editing):

```bash
docker cp n8n/workflows n8n:/tmp/workflows
docker exec n8n n8n import:workflow --separate --input=/tmp/workflows
for id in socWf0Setup00001 socWf1Triage0001 socSw1LlmAgent01 socWf2Decision01 socWf3ReadApi001 socWf4ErrorHdl01; do
  docker exec n8n n8n publish:workflow --id=$id
done
docker restart n8n
```

Optional: also publish `socWf5SlaWatch01` for the SLA watcher.

If you import through the editor UI instead, open WF-1 and point each `Agent: …` node at "SOC SW-1 LLM Agent". Then set the error workflow of WF-1, WF-2 and WF-3 to "SOC WF-4 Error Handler" (Workflow settings).

### 4. Create the data tables (once)

Open **SOC WF-0 Setup** in the editor and click *Execute workflow*. Scripted alternative: `curl -X POST http://localhost:5678/webhook/soc-setup`, then unpublish WF-0.

Check it worked: `curl "http://localhost:5678/webhook/soc-read?resource=ping"` should return `{"ok":true,...}`.

### 5. UI

```bash
pip install -r ui/requirements.txt
cd ui && N8N_BASE_URL=http://localhost:5678 streamlit run app.py
```

### 6. Pipeline self-test (optional, no GPU needed)

```bash
pip install flask requests
python mock/mock_llm_server.py &                  # listens on :11500
python tests/e2e_n8n.py --model mock-model        # expect 5 × PASS
python tests/e2e_decisions.py                     # expect 12/12
```

If n8n runs in Docker, set `llm.mock_base_url` to `http://host.docker.internal:11500` and rebuild the workflows first.

### 7. Model comparison (Stage 3 requirement)

```bash
python benchmark/run_benchmark.py --models qwen2.5:7b llama3.1:8b mistral:7b --repeats 3
```

This writes `benchmark/results/runs.csv`, `summary_by_model.csv` and `explanation_rubric.csv`. The Streamlit *Model comparison* page reads them.

For explanation quality, two team members score the rubric sheet blind (1–5), without opening `blind_key.json`. Then copy the averages into `explanation_quality_1to5`.

