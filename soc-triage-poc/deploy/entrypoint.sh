#!/usr/bin/env bash
# Container start-up for hosting (Hugging Face Spaces or any Docker host).
# n8n runs privately on 127.0.0.1; only the Streamlit console is exposed on $PORT.
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
export N8N_USER_FOLDER="${N8N_USER_FOLDER:-$HOME/n8ndata}"
export N8N_LISTEN_ADDRESS=127.0.0.1 N8N_PORT=5678 N8N_DIAGNOSTICS_ENABLED=false N8N_PERSONALIZATION_ENABLED=false
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false          # workflow reads the API key from the environment
export N8N_BASE_URL="http://127.0.0.1:5678"        # used by the console, not by n8n
export MOCK_HOST=127.0.0.1
PORT="${PORT:-7860}"
IDS="socWf0Setup00001 socWf1Triage0001 socSw1LlmAgent01 socWf2Decision01 socWf3ReadApi001 socWf4ErrorHdl01"
mkdir -p "$N8N_USER_FOLDER"

[ -n "${SOC_LLM_API_KEY:-}" ] && echo "== Groq key found in secrets" || echo "== WARNING: secret SOC_LLM_API_KEY not set: only the mock models will work"
[ -n "${APP_PASSWORD:-}" ] && echo "== console password enabled" || echo "== WARNING: APP_PASSWORD not set: anyone with the link can use the console and your API quota"

echo "== importing and publishing workflows"
n8n import:workflow --separate --input="$ROOT/n8n/workflows" || { echo "import failed"; exit 1; }
for id in $IDS; do n8n publish:workflow --id="$id" >/dev/null || { echo "publish $id failed"; exit 1; }; done

echo "== starting mock model server and n8n"
python3 "$ROOT/mock/mock_llm_server.py" > /tmp/mock.log 2>&1 &
n8n start &

echo "== waiting for the workflows to come online (up to 4 minutes)"
ready=0
for i in $(seq 1 80); do
  if curl -sf -X POST "$N8N_BASE_URL/webhook/soc-setup" >/dev/null 2>&1 \
     && curl -sf "$N8N_BASE_URL/webhook/soc-read?resource=ping" 2>/dev/null | grep -q '"ok": *true'; then ready=1; break; fi
  sleep 3
done
[ "$ready" = 1 ] && echo "== workflows online, data tables ready" || echo "== WARNING: workflows not answering yet; the console will show n8n as offline"

echo "== starting console on port $PORT"
cd "$ROOT/ui"
exec python3 -m streamlit run app.py --server.port "$PORT" --server.address 0.0.0.0 --server.headless true --browser.gatherUsageStats false
