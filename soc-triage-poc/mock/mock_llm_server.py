"""
Mock Ollama-compatible server for PIPELINE TESTING ONLY.
Returns hand-written answers from canned_outputs.json so the n8n wiring,
guardrails, retry and HITL paths can be tested without a GPU.
Its outputs are NOT model results and must never appear in the model comparison.

Models it answers to:
  mock-model   correct answers
  mock-flaky   first attempt per (case, agent) is broken JSON; the retry is correct
  mock-halluc  risk agent cites a non-existent evidence ID (LOG-9999-99)

It also offers an OpenAI-style endpoint (/v1/chat/completions) that requires
"Authorization: Bearer test-key", to test the hosted-API path without a real key:
  compat-model      correct answers
  compat-ratelimit  first call per (case, agent) returns HTTP 429; the resend succeeds

Run:  python mock/mock_llm_server.py      (listens on :11500)
"""
import json
import re
import time
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)
CANNED = json.loads((Path(__file__).parent / "canned_outputs.json").read_text())
AGENTS = {"Alert Correlation": "corr", "Threat Intelligence": "ti", "Asset Context": "asset",
          "Risk/Prioritisation": "risk", "Incident Summary": "sum"}
SEEN = set()


@app.get("/api/tags")
def tags():
    return jsonify({"models": [{"name": m} for m in ("mock-model", "mock-flaky", "mock-halluc")]})


def answer(body):
    model = body.get("model", "")
    text = "\n".join(m.get("content", "") for m in body.get("messages", []))
    agent = next((k for name, k in AGENTS.items() if f"You are the {name} Agent" in text), None)
    case = re.search(r'"case_id":"(CASE-[A-Za-z0-9-]+)"', text)
    alert = re.search(r"ALRT-\d{4}", text)
    time.sleep(0.2)
    if not (agent and case and alert and alert.group(0) in CANNED):
        content = '{"error": "mock has no canned answer for this prompt"}'
    else:
        out = json.loads(json.dumps(CANNED[alert.group(0)][agent]).replace("{{case_id}}", case.group(1)))
        key = (case.group(1), agent)
        is_retry = "previous output was invalid" in text
        if model == "mock-flaky" and not is_retry and key not in SEEN:
            SEEN.add(key)
            content = "Sure! Here is the analysis: {\"agent\": " + json.dumps(out["agent"]) + ", oops"
        else:
            if model == "mock-halluc" and agent == "risk":
                out["reasons"][0]["evidence_ids"].append("LOG-9999-99")
            content = json.dumps(out)
    return content, text


@app.post("/api/chat")
def chat():
    body = request.get_json(force=True)
    model = body.get("model", "")
    content, text = answer(body)
    return jsonify({"model": model, "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "message": {"role": "assistant", "content": content}, "done": True,
                    "eval_count": len(content) // 4, "prompt_eval_count": len(text) // 4})


RL_SEEN = set()


@app.post("/v1/chat/completions")
def chat_openai():
    if request.headers.get("Authorization") != "Bearer test-key":
        return jsonify({"error": {"message": "Invalid API key", "type": "invalid_request_error"}}), 401
    body = request.get_json(force=True)
    text = "\n".join(m.get("content", "") for m in body.get("messages", []))
    if body.get("model") == "compat-ratelimit":
        key = (re.search(r'"case_id":"(CASE-[A-Za-z0-9-]+)"', text) or [None, ""])[1] + next((k for n, k in AGENTS.items() if f"You are the {n} Agent" in text), "")
        if key not in RL_SEEN:
            RL_SEEN.add(key)
            return jsonify({"error": {"message": "Rate limit reached. Please try again in 2s.", "type": "tokens", "code": "rate_limit_exceeded"}}), 429
    content, _ = answer(body)
    return jsonify({"id": "mock", "object": "chat.completion", "model": body.get("model"),
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}]})


if __name__ == "__main__":
    import os
    app.run(host=os.environ.get("MOCK_HOST", "0.0.0.0"), port=11500)
