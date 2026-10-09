// Builds importable n8n workflow JSON (n8n 2.x) from config/, data/, prompts/ and n8n/code/soc_core.js.
// Run: node tools/build_workflows.js   -> writes n8n/workflows/*.json
// Re-run after editing config, prompts or data so the embedded copies stay in sync.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// SOC_CONFIG picks another config (e.g. config/soc_config.cloud.json); SOC_OUT another output folder
const CFG = JSON.parse(rd(process.env.SOC_CONFIG || 'config/soc_config.json'));
const CORE = rd('n8n/code/soc_core.js');
const TI = rd('data/lookups/threat_intel.json');
const CMDB = rd('data/lookups/cmdb.json');
const IDENTITY = rd('data/lookups/identity.json');
const HISTORY = rd('data/lookups/alert_history.json');
const PROMPT = (v) => rd(`prompts/${v}.txt`);
const PV = CFG.prompt_versions;

const IDS = {
  setup: 'socWf0Setup00001', triage: 'socWf1Triage0001', llm: 'socSw1LlmAgent01', decision: 'socWf2Decision01',
  read: 'socWf3ReadApi001', error: 'socWf4ErrorHdl01', sla: 'socWf5SlaWatch01',
};
const T_CASES = 'soc_cases';
const T_AUDIT = 'soc_audit';

const uid = () => crypto.randomUUID();
const PRE = `// ---- generated: config ${CFG.config_version}, do not edit here; edit repo files and rebuild ----\nconst CFG = ${JSON.stringify(CFG)};\n${CORE}\n// ---- node logic ----\n`;

// ---------------------------------------------------------------- node factories
function code(name, js, pos, { core = true, extra = '' } = {}) {
  return { parameters: { jsCode: (core ? PRE : '') + extra + js }, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, id: uid() };
}
function ifNode(name, expr, pos) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: uid(), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos, id: uid(),
  };
}
function switchExpr(name, expr, n, pos) {
  return { parameters: { mode: 'expression', numberOutputs: n, output: expr }, name, type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: pos, id: uid() };
}
function webhook(name, method, p, responseMode, pos) {
  return { parameters: { httpMethod: method, path: p, responseMode, options: {} }, name, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos, id: uid(), webhookId: uid() };
}
function respond(name, bodyExpr, pos, codeExpr) {
  const options = codeExpr ? { responseCode: codeExpr } : {};
  return { parameters: { respondWith: 'json', responseBody: bodyExpr, options }, name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: pos, id: uid() };
}
const tableRef = (t) => ({ __rl: true, mode: 'name', value: t });
function dtUpsert(name, table, keyExpr, pos) {
  return {
    parameters: {
      resource: 'row', operation: 'upsert', dataTableId: tableRef(table),
      filters: { conditions: [{ keyName: 'case_id', condition: 'eq', keyValue: keyExpr }] },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: false },
      options: {},
    },
    name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos, id: uid(),
  };
}
const AUDIT_COLS = ['ts', 'case_id', 'step', 'actor', 'model', 'prompt_version', 'event', 'detail', 'latency_ms', 'status', 'execution_id'];
function dtAudit(name, f, pos) {
  const value = {
    ts: '={{ $now.toUTC().toISO() }}', execution_id: '={{ $execution.id }}', latency_ms: '={{ 0 }}', model: '', prompt_version: '', status: 'OK', ...f,
  };
  return {
    parameters: {
      resource: 'row', operation: 'insert', dataTableId: tableRef(T_AUDIT),
      columns: {
        mappingMode: 'defineBelow', value, matchingColumns: [],
        schema: AUDIT_COLS.map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: c === 'latency_ms' ? 'number' : 'string', readOnly: false, removed: false })),
        attemptToConvertTypes: false, convertFieldsToString: false,
      },
      options: {},
    },
    name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos, id: uid(),
  };
}
function dtGet(name, table, conditions, pos, returnAll = true) {
  const p = { resource: 'row', operation: 'get', dataTableId: tableRef(table), returnAll };
  if (conditions) p.filters = { conditions };
  if (!returnAll) p.limit = 1;
  return { parameters: p, name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos, id: uid(), alwaysOutputData: true };
}
function execAgent(name, pos) {
  return {
    parameters: {
      workflowId: { __rl: true, mode: 'list', value: IDS.llm, cachedResultName: 'SOC SW-1 LLM Agent' },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      options: { waitForSubWorkflow: true },
    },
    name, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: pos, id: uid(),
  };
}
function http(name, pos) {
  return {
    parameters: {
      method: 'POST', url: '={{ $json.url }}', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}',
      ...(CFG.llm.auth_mode === 'credential'
        // n8n Cloud blocks $env in expressions: the key lives in an n8n "Header Auth" credential instead
        ? { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' }
        : { sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: "={{ $json.key_env ? 'Bearer ' + ($env[$json.key_env] || 'MISSING_API_KEY') : 'none' }}" }] } }),
      options: { timeout: CFG.llm.timeout_ms },
    },
    ...(CFG.llm.auth_mode === 'credential' ? { credentials: { httpHeaderAuth: { id: CFG.llm.credential_id || '', name: CFG.llm.credential_name || 'Groq API key' } } } : {}),
    name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, id: uid(), onError: 'continueRegularOutput',
  };
}
function sticky(content, pos, w = 420, h = 180, color = 7) {
  return { parameters: { content, height: h, width: w, color }, name: `Note ${uid().slice(0, 6)}`, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: pos, id: uid() };
}
function wf(id, name, nodes, links, settings = {}) {
  const connections = {};
  for (const [from, out, to, input = 0] of links) {
    connections[from] = connections[from] || { main: [] };
    while (connections[from].main.length <= out) connections[from].main.push([]);
    connections[from].main[out].push({ node: to, type: 'main', index: input });
  }
  const names = new Set(nodes.map((n) => n.name));
  for (const [from, , to] of links) if (!names.has(from) || !names.has(to)) throw new Error(`${name}: bad link ${from} -> ${to}`);
  return { id, name, nodes, connections, active: false, settings: { executionOrder: 'v1', ...settings }, pinData: {}, meta: { templateCredsSetupCompleted: true }, tags: [] };
}

// ---------------------------------------------------------------- shared JS snippets
const J = {
  init: `const init = $('Orchestrator: Init Case').first().json; const alert = JSON.parse(init.alert_json);\n`,
  rel: `const rel = $('Tool: Related Events').first().json;\n`,
  lk: `const L = $('Tool: TI, CMDB & Identity Lookups').first().json;\n`,
  outs: `const outputs = { corr: $('Agent: Alert Correlation').first().json.output, ti: $('Agent: Threat Intelligence').first().json.output, asset: $('Agent: Asset Context').first().json.output, risk: $('Agent: Risk/Prioritisation').first().json.output };\n`,
  ctx: `const ctx = { alert, tiLookup: L.ti, assetLookup: L.assets, related: rel.related, relatedCount: rel.related_count, outputs, flags: $('Evidence Completeness & Flags').first().json.flags };\n`,
  prompts: (k) => `const PROMPTS = ${JSON.stringify({ [PV.shared]: PROMPT(PV.shared), [PV[k]]: PROMPT(PV[k]) })};\n`,
  req: (k) => `const m = SOC.buildMessages('${k}', vars, PROMPTS, CFG);\nreturn [{ json: { agent: '${k}', case_id: init.case_id, model: init.model, system: m.system, user: m.user, prompt_version: m.prompt_version, llm: CFG.llm, model_cfg: CFG.models.find((x) => x.id === init.model) || {} } }];`,
};

// ================================================================ WF-0 Setup
function buildSetup() {
  const caseCols = [
    ['case_id', 'string'], ['created_at', 'string'], ['updated_at', 'string'], ['alert_id', 'string'], ['status', 'string'], ['route', 'string'],
    ['priority', 'string'], ['risk_score', 'number'], ['classification', 'string'], ['confidence', 'number'], ['flags', 'string'], ['model', 'string'],
    ['asset_criticality', 'string'], ['recommended_action', 'string'], ['execution_id', 'string'], ['exception_stage', 'string'], ['exception_reason', 'string'],
    ['prompt_versions', 'string'], ['total_latency_ms', 'number'], ['retries', 'number'], ['hallucinated_ids', 'number'],
    ['alert_json', 'string'], ['lookups_json', 'string'], ['correlation_json', 'string'], ['ti_json', 'string'], ['asset_json', 'string'],
    ['risk_json', 'string'], ['scoring_json', 'string'], ['summary_json', 'string'], ['decision_json', 'string'], ['agent_stats_json', 'string'],
  ];
  const auditCols = AUDIT_COLS.map((c) => [c, c === 'latency_ms' ? 'number' : 'string']);
  const mk = (name, table, cols, pos) => ({
    parameters: { resource: 'table', operation: 'create', tableName: table, columns: { column: cols.map(([n, t]) => ({ name: n, type: t })) }, options: { createIfNotExists: true } },
    name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos, id: uid(),
  });
  const nodes = [
    { parameters: {}, name: 'Run once: create tables', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], id: uid() },
    webhook('Or: POST /soc-setup (publish only while setting up)', 'POST', 'soc-setup', 'lastNode', [0, 180]),
    mk('Create soc_cases', T_CASES, caseCols, [240, 0]),
    mk('Create soc_audit', T_AUDIT, auditCols, [480, 0]),
    sticky('## WF-0 Setup\nRun once after import. Creates the two n8n Data Tables used as the case store and the append-only audit log. Safe to re-run (reuses existing tables). Alternative for scripted setup: publish this workflow, POST /webhook/soc-setup once, then unpublish it.', [-40, -220]),
  ];
  return wf(IDS.setup, 'SOC WF-0 Setup (run once)', nodes, [['Run once: create tables', 0, 'Create soc_cases'], ['Or: POST /soc-setup (publish only while setting up)', 0, 'Create soc_cases'], ['Create soc_cases', 0, 'Create soc_audit']]);
}

// ================================================================ SW-1 LLM agent
function buildLlm() {
  const Y = 0;
  const nodes = [
    { parameters: { inputSource: 'passthrough' }, name: 'Start (called by triage)', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, Y], id: uid() },
    code('Prepare Call', `const i = $input.first().json;
const mc = i.model_cfg || {};
const mock = String(i.model).startsWith('mock-');
const provider = mock ? 'ollama' : (mc.provider || i.llm.provider);
const ollama = provider === 'ollama';
const base = mock ? i.llm.mock_base_url : (mc.base_url || (ollama ? i.llm.ollama_base_url : i.llm.openai_compat_base_url));
// API key is read by the HTTP node from an n8n environment variable; it is never stored in the workflow
const key_env = ollama ? '' : (mc.api_key_env || i.llm.api_key_env || 'SOC_LLM_API_KEY');
const delay = mock ? 0 : Number(mc.min_delay_ms ?? i.llm.min_delay_ms ?? 0);
if (delay > 0) await new Promise((r) => setTimeout(r, delay));
const messages = [{ role: 'system', content: i.system }, { role: 'user', content: i.user }];
const body = ollama
  ? { model: i.model, messages, stream: false, format: 'json', options: { temperature: i.llm.temperature, seed: i.llm.seed, num_ctx: i.llm.num_ctx } }
  : { model: i.model, messages, temperature: i.llm.temperature, seed: i.llm.seed, response_format: { type: 'json_object' },
      ...(i.llm.max_output_tokens ? { max_tokens: i.llm.max_output_tokens } : {}), ...(mc.extra_body || {}) };
return [{ json: { agent: i.agent, case_id: i.case_id, model: i.model, prompt_version: i.prompt_version, url: base + (ollama ? '/api/chat' : '/chat/completions'), key_env, rate_limit_wait_ms: Number(i.llm.rate_limit_wait_ms || 30000), body, t0: Date.now() } }];`, [240, Y], { core: false }),
    http('Call Model', [480, Y]),
    code('Parse & Validate', `const req = $('Prepare Call').first().json; const res = $input.first().json || {};
const text = (res.message && res.message.content) || (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || null;
const v = SOC.validateAgentOutput(req.agent, text, req.case_id, CFG);
const errors = text === null ? ['no model response: ' + JSON.stringify(res.error || res).slice(0, 200)] : v.errors;
return [{ json: { valid: v.valid, errors, output: v.output, raw_excerpt: String(text || '').slice(0, 400), latency_ms: Date.now() - req.t0, attempt: 1 } }];`, [720, Y]),
    ifNode('Valid?', '={{ $json.valid }}', [960, Y]),
    code('Add Correction & Retry', `const req = $('Prepare Call').first().json; const v1 = $input.first().json;
const body = JSON.parse(JSON.stringify(req.body));
const rate_limited = /429|rate.?limit|too many requests/i.test(v1.errors.join(' '));
if (rate_limited) {
  // provider throttling, not a model error: wait and resend the same request unchanged
  await new Promise((r) => setTimeout(r, req.rate_limit_wait_ms));
} else {
  body.messages[1].content += '\\n\\nYour previous output was invalid because: ' + v1.errors.join('; ') + '. Return only one valid JSON object matching the REQUIRED JSON OUTPUT, with every key, and nothing else.';
}
return [{ json: { ...req, body, t0: Date.now(), first_latency_ms: v1.latency_ms, first_errors: v1.errors, rate_limited } }];`, [1200, Y + 200], { core: false }),
    http('Call Model (retry)', [1440, Y + 200]),
    code('Parse & Validate (retry)', `const req = $('Add Correction & Retry').first().json; const res = $input.first().json || {};
const text = (res.message && res.message.content) || (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || null;
const v = SOC.validateAgentOutput(req.agent, text, req.case_id, CFG);
const errors = text === null ? ['no model response: ' + JSON.stringify(res.error || res).slice(0, 200)] : v.errors;
return [{ json: { valid: v.valid, errors, first_errors: req.first_errors, output: v.valid ? v.output : null, raw_excerpt: String(text || '').slice(0, 400), latency_ms: req.first_latency_ms + (Date.now() - req.t0), attempt: 2, rate_limited: req.rate_limited } }];`, [1680, Y + 200]),
    code('Package Result', `const r = $input.first().json; const req = $('Prepare Call').first().json;
return [{ json: { ok: r.valid, agent: req.agent, case_id: req.case_id, model: req.model, prompt_version: req.prompt_version, output: r.valid ? r.output : null,
  errors: r.errors, first_errors: r.first_errors || (r.attempt === 1 ? [] : null), attempts: r.attempt, latency_ms: r.latency_ms, first_attempt_valid: r.attempt === 1 && r.valid, rate_limited: !!r.rate_limited,
  raw_excerpt: r.raw_excerpt, _stage: 'agent_' + req.agent, _reason: r.valid ? '' : 'Agent ' + req.agent + ' produced invalid output after one retry: ' + (r.errors || []).slice(0, 3).join('; ') } }];`, [1920, Y], { core: false }),
    dtAudit('Audit: Agent Call', {
      case_id: '={{ $json.case_id }}', step: '={{ $json.agent }}', actor: 'agent (LLM)', model: '={{ $json.model }}', prompt_version: '={{ $json.prompt_version }}',
      event: "={{ $json.ok ? 'AGENT_OK' : 'AGENT_FAILED' }}", detail: "={{ 'attempts=' + $json.attempts + ($json.ok ? '' : ' | ' + ($json.errors || []).join('; ').slice(0, 400)) }}",
      latency_ms: '={{ $json.latency_ms }}', status: "={{ $json.ok ? 'OK' : 'FAIL' }}",
    }, [2160, Y]),
    code('Return Result', `return [{ json: $('Package Result').first().json }];`, [2400, Y], { core: false }),
    sticky('## SW-1 LLM Agent (reusable)\nOne call → schema check → one corrective retry → result. Never throws: a failed agent returns ok=false and the triage workflow routes the case to the exception queue (E). Every call is written to the audit log with model, prompt version, attempts and latency.', [0, -260], 520, 200),
  ];
  const links = [
    ['Start (called by triage)', 0, 'Prepare Call'], ['Prepare Call', 0, 'Call Model'], ['Call Model', 0, 'Parse & Validate'], ['Parse & Validate', 0, 'Valid?'],
    ['Valid?', 0, 'Package Result'], ['Valid?', 1, 'Add Correction & Retry'], ['Add Correction & Retry', 0, 'Call Model (retry)'],
    ['Call Model (retry)', 0, 'Parse & Validate (retry)'], ['Parse & Validate (retry)', 0, 'Package Result'],
    ['Package Result', 0, 'Audit: Agent Call'], ['Audit: Agent Call', 0, 'Return Result'],
  ];
  return wf(IDS.llm, 'SOC SW-1 LLM Agent', nodes, links, { callerPolicy: 'workflowsFromSameOwner' });
}

// ================================================================ WF-1 Triage
function buildTriage() {
  const X = (i) => i * 240;
  const nodes = [
    webhook('Triage Intake', 'POST', 'soc-triage', 'onReceived', [X(0), 0]),
    code('Validate Input', `const body = $input.first().json.body || {};
const v = SOC.validateInput(body, CFG);
const cid = (typeof body.case_id === 'string' && /^CASE-[A-Za-z0-9-]{3,80}$/.test(body.case_id)) ? body.case_id : 'CASE-INVALID-' + Date.now();
return [{ json: { valid: v.valid, errors: v.errors, case_id: cid, model: body.model || null, payload: body, received_at: new Date().toISOString(), execution_id: $execution.id, _stage: 'input_validation', _reason: v.errors.join('; ') } }];`, [X(1), 0]),
    ifNode('Input Valid?', '={{ $json.valid }}', [X(2), 0]),
    code('Injection & PII Screen', `const v = $('Validate Input').first().json;
const s = SOC.screenInput(v.payload.alert, CFG);
return [{ json: { clean: s.clean, matches: s.matches, masked_alert: s.masked_alert, masked_count: s.masked_count, _stage: 'injection_screen', _reason: s.matches.map((m) => m.field + ': "' + m.excerpt + '"').join(' | ') } }];`, [X(3), 0]),
    ifNode('Screen Clean?', '={{ $json.clean }}', [X(4), 0]),
    code('Orchestrator: Init Case', `const v = $('Validate Input').first().json; const s = $('Injection & PII Screen').first().json;
const now = new Date().toISOString();
return [{ json: { case_id: v.case_id, created_at: now, updated_at: now, alert_id: String(s.masked_alert.alert_id), status: 'PROCESSING', route: '', priority: '', model: v.model,
  execution_id: String(v.execution_id), prompt_versions: Object.values(CFG.prompt_versions).join(','), alert_json: JSON.stringify(s.masked_alert) } }];`, [X(5), 0]),
    dtUpsert('Save Case: PROCESSING', T_CASES, '={{ $json.case_id }}', [X(6), 0]),
    dtAudit('Audit: CASE_CREATED', {
      case_id: "={{ $('Orchestrator: Init Case').first().json.case_id }}", step: 'orchestrator', actor: 'orchestrator (code)', model: "={{ $('Orchestrator: Init Case').first().json.model }}",
      prompt_version: CFG.config_version, event: 'CASE_CREATED', detail: "={{ 'validated; injection screen clean; masked values: ' + $('Injection & PII Screen').first().json.masked_count }}",
    }, [X(7), 0]),
    code('Tool: Related Events', `${J.init}const HISTORY = ${HISTORY};
const CMDB = ${CMDB};
const IDENTITY = ${IDENTITY};
const entities = SOC.extractEntities(alert, CMDB, IDENTITY);
const related = SOC.fetchRelated(alert, entities, HISTORY, CFG.related_window_hours);
return [{ json: { entities, related, related_count: related.length } }];`, [X(8), 0]),
    code('Build Correlation Request', `${J.init}${J.rel}const vars = { case_id: init.case_id, alert_json: alert, related_events_json: rel.related };\n${J.req('corr')}`, [X(9), 0], { extra: J.prompts('corr') }),
    execAgent('Agent: Alert Correlation', [X(10), 0]),
    ifNode('Correlation OK?', '={{ $json.ok }}', [X(11), 0]),
    code('Tool: TI, CMDB & Identity Lookups', `${J.rel}const TI = ${TI};
const CMDB = ${CMDB};
const IDENTITY = ${IDENTITY};
return [{ json: { ti: SOC.lookupTI(rel.entities, TI), assets: SOC.lookupAssets(rel.entities, CMDB, IDENTITY) } }];`, [X(12), 0]),
    code('Build TI Request', `${J.init}${J.lk}const vars = { case_id: init.case_id, indicators_json: L.ti.indicators, ti_records_json: L.ti.records, ti_not_found_json: L.ti.not_found };\n${J.req('ti')}`, [X(13), -160], { extra: J.prompts('ti') }),
    execAgent('Agent: Threat Intelligence', [X(14), -160]),
    code('Build Asset Request', `${J.init}${J.lk}const vars = { case_id: init.case_id, assets_json: L.assets.assets, users_json: L.assets.users, cmdb_records_json: L.assets.cmdb_records, identity_records_json: L.assets.identity_records, alert_asset_criticality: alert.asset_criticality == null ? 'not provided' : String(alert.asset_criticality) };\n${J.req('asset')}`, [X(13), 160], { extra: J.prompts('asset') }),
    execAgent('Agent: Asset Context', [X(14), 160]),
    { parameters: {}, name: 'Join TI & Asset', type: 'n8n-nodes-base.merge', typeVersion: 3, position: [X(15), 0], id: uid() },
    code('Evidence Completeness & Flags', `const ti = $('Agent: Threat Intelligence').first().json; const as = $('Agent: Asset Context').first().json;
const bad = [ti, as].find((x) => !x.ok);
if (bad) return [{ json: { ok: false, _stage: bad._stage, _reason: bad._reason } }];
${J.lk}const flags = SOC.completenessFlags(L.ti, L.assets);
return [{ json: { ok: true, flags, missing: [...L.assets.unknown_assets, ...L.ti.not_found] } }];`, [X(16), 0]),
    ifNode('Agents OK?', '={{ $json.ok }}', [X(17), 0]),
    code('Build Risk Request', `${J.init}const vars = { case_id: init.case_id, alert_json: alert, correlation_output: $('Agent: Alert Correlation').first().json.output, ti_output: $('Agent: Threat Intelligence').first().json.output, asset_output: $('Agent: Asset Context').first().json.output, flags_json: $('Evidence Completeness & Flags').first().json.flags };\n${J.req('risk')}`, [X(18), 0], { extra: J.prompts('risk') }),
    execAgent('Agent: Risk/Prioritisation', [X(19), 0]),
    ifNode('Risk OK?', '={{ $json.ok }}', [X(20), 0]),
    code('Scoring Engine', `${J.init}${J.rel}${J.lk}${J.outs}${J.ctx}return [{ json: SOC.score(ctx, CFG) }];`, [X(21), 0]),
    code('Policy & Output Guardrails', `${J.init}${J.rel}${J.lk}${J.outs}${J.ctx}const sc = $('Scoring Engine').first().json;
const g = SOC.guardrailCheck(ctx, sc, CFG);
return [{ json: { pass: g.pass, failures: g.failures, hallucinated_ids: g.hallucinated_ids, _stage: 'output_guardrail', _reason: g.failures.join('; ') } }];`, [X(22), 0]),
    ifNode('Guardrails Passed?', '={{ $json.pass }}', [X(23), 0]),
    code('Build Summary Request', `${J.init}const sc = $('Scoring Engine').first().json;
const vars = { case_id: init.case_id, alert_json: alert, correlation_output: $('Agent: Alert Correlation').first().json.output, ti_output: $('Agent: Threat Intelligence').first().json.output, asset_output: $('Agent: Asset Context').first().json.output, risk_output: $('Agent: Risk/Prioritisation').first().json.output, score: String(sc.score), class: sc.class, route: sc.route, flags_json: sc.flags, overall_confidence: String(sc.overall_confidence) };\n${J.req('sum')}`, [X(24), 0], { extra: J.prompts('sum') }),
    execAgent('Agent: Incident Summary', [X(25), 0]),
    code('Summary Guardrail', `const r = $input.first().json; const route = $('Scoring Engine').first().json.route;
if (!r.ok) return [{ json: { pass: false, route, _stage: r._stage, _reason: r._reason } }];
${J.init}${J.rel}${J.lk}${J.outs}${J.ctx}const s = SOC.summaryCheck(ctx, r.output, CFG);
return [{ json: { pass: s.pass, failures: s.failures, hallucinated_ids: s.hallucinated_ids, route, _stage: 'summary_guardrail', _reason: s.failures.join('; ') } }];`, [X(26), 0]),
    ifNode('Summary OK?', '={{ $json.pass }}', [X(27), 0]),
    switchExpr('Conditional Routing', "={{ ({ ESCALATE: 0, REVIEW: 1, CONFIRM_CLOSURE: 2, EXCEPTION: 3 })[$('Scoring Engine').first().json.route] }}", 4, [X(28), 0]),
    code('Build Escalation Package', `const sc = $('Scoring Engine').first().json; ${J.outs}
const reasons = ['class ' + sc.class + ' (score ' + sc.score + ')', ...sc.overrides.map((o) => 'override ' + o), ...Object.entries(outputs).filter(([k, o]) => o.escalation_condition_met).map(([k, o]) => k + ': ' + o.escalation_reason)];
return [{ json: { route: 'ESCALATE', status: 'ESCALATED_PENDING_APPROVAL', priority: 'P1', min_role: 'Tier2', notify: 'Tier 2 / IR Lead (simulated)', escalation_reasons: reasons } }];`, [X(29), -240], { core: false }),
    dtAudit('Notify IR Lead (simulated)', {
      case_id: "={{ $('Orchestrator: Init Case').first().json.case_id }}", step: 'escalation', actor: 'orchestrator (code)', event: 'ESCALATION_NOTIFICATION_SIMULATED',
      detail: "={{ 'SIMULATED notification to ' + $json.notify + ': ' + $json.escalation_reasons.join('; ') }}",
    }, [X(30), -240]),
    code('Set Review State', `const sc = $('Scoring Engine').first().json; const risk = $('Agent: Risk/Prioritisation').first().json.output;
return [{ json: { route: 'REVIEW', status: 'PENDING_ANALYST_REVIEW', priority: 'P2', evidence_gaps: risk.missing_evidence, flags: sc.flags } }];`, [X(29), 0], { core: false }),
    code('Set Closure-Confirmation State', `const risk = $('Agent: Risk/Prioritisation').first().json.output;
return [{ json: { route: 'CONFIRM_CLOSURE', status: 'PENDING_CLOSURE_CONFIRMATION', priority: 'P3', proposed_closure: risk.recommended_action } }];`, [X(29), 240], { core: false }),
    code('Finalise Case Record', `${J.init}${J.rel}${J.lk}const sc = $('Scoring Engine').first().json; const g = $('Policy & Output Guardrails').first().json; const sg = $('Summary Guardrail').first().json;
let pkg = {};
for (const n of ['Build Escalation Package', 'Set Review State', 'Set Closure-Confirmation State']) { try { pkg = { ...pkg, ...$(n).first().json }; } catch (e) { /* branch not taken */ } }
const agents = { corr: 'Agent: Alert Correlation', ti: 'Agent: Threat Intelligence', asset: 'Agent: Asset Context', risk: 'Agent: Risk/Prioritisation', sum: 'Agent: Incident Summary' };
const res = Object.fromEntries(Object.entries(agents).map(([k, n]) => [k, $(n).first().json]));
const stats = Object.values(res).map((r) => ({ agent: r.agent, attempts: r.attempts, latency_ms: r.latency_ms, first_attempt_valid: r.first_attempt_valid, rate_limited: r.rate_limited, first_errors: r.first_errors }));
return [{ json: { case_id: init.case_id, updated_at: new Date().toISOString(), status: sc.status, route: sc.route, priority: sc.priority, risk_score: sc.score, classification: sc.class,
  confidence: sc.overall_confidence, flags: sc.flags.join(','), asset_criticality: L.assets.reference.criticality, recommended_action: res.risk.output.recommended_action,
  exception_stage: '', exception_reason: '', lookups_json: JSON.stringify({ entities: rel.entities, related: rel.related, ti: L.ti, assets: L.assets }),
  correlation_json: JSON.stringify(res.corr.output), ti_json: JSON.stringify(res.ti.output), asset_json: JSON.stringify(res.asset.output), risk_json: JSON.stringify(res.risk.output),
  scoring_json: JSON.stringify({ ...sc, route_package: pkg }), summary_json: JSON.stringify(res.sum.output),
  total_latency_ms: stats.reduce((s, x) => s + (x.latency_ms || 0), 0), retries: stats.reduce((s, x) => s + ((x.attempts || 1) - 1), 0),
  hallucinated_ids: (g.hallucinated_ids || 0) + (sg.hallucinated_ids || 0), agent_stats_json: JSON.stringify(stats) } }];`, [X(31), 0], { core: false }),
    dtUpsert('Save Case: ROUTED', T_CASES, '={{ $json.case_id }}', [X(32), 0]),
    dtAudit('Audit: ROUTED', {
      case_id: "={{ $('Finalise Case Record').first().json.case_id }}", step: 'routing', actor: 'orchestrator (code)', model: "={{ $('Orchestrator: Init Case').first().json.model }}",
      prompt_version: CFG.config_version, event: "={{ 'ROUTED_' + $('Finalise Case Record').first().json.route }}",
      detail: "={{ 'score=' + $('Finalise Case Record').first().json.risk_score + ' class=' + $('Finalise Case Record').first().json.classification + ' status=' + $('Finalise Case Record').first().json.status + ' flags=' + ($('Finalise Case Record').first().json.flags || 'none') + ' confidence=' + $('Finalise Case Record').first().json.confidence }}",
      latency_ms: "={{ $('Finalise Case Record').first().json.total_latency_ms }}",
    }, [X(33), 0]),
    // ---- exception path (E)
    code('Exception Handler', `const j = $input.first().json; const v = $('Validate Input').first().json;
const safe = (n) => { try { return $(n).first().json; } catch (e) { return null; } };
let stage = j._stage || 'unknown', reason = j._reason || '';
if (j.route === 'EXCEPTION' && j.pass === true) { stage = 'model_detected_injection'; reason = 'An agent flagged possible prompt injection in the evidence'; }
const init = safe('Orchestrator: Init Case');
let alertMasked; try { alertMasked = SOC.screenInput(v.payload.alert || {}, CFG).masked_alert; } catch (e) { alertMasked = { note: 'alert unreadable' }; }
const out = (n) => { const r = safe(n); return r && r.output ? JSON.stringify(r.output) : ''; };
const agentNodes = ['Agent: Alert Correlation', 'Agent: Threat Intelligence', 'Agent: Asset Context', 'Agent: Risk/Prioritisation', 'Agent: Incident Summary'];
const stats = agentNodes.map(safe).filter(Boolean).map((r) => ({ agent: r.agent, ok: r.ok, attempts: r.attempts, latency_ms: r.latency_ms, first_attempt_valid: r.first_attempt_valid, rate_limited: r.rate_limited, first_errors: r.first_errors, errors: r.ok ? [] : r.errors }));
const sc = safe('Scoring Engine'); const g = safe('Policy & Output Guardrails'); const sg = safe('Summary Guardrail');
const now = new Date().toISOString();
return [{ json: { case_id: v.case_id, created_at: init ? init.created_at : now, updated_at: now, alert_id: String((v.payload.alert && v.payload.alert.alert_id) || 'UNKNOWN'),
  status: 'EXCEPTION_MANUAL_QUEUE', route: 'EXCEPTION', priority: 'P1', model: String(v.model || ''), execution_id: String(v.execution_id),
  prompt_versions: Object.values(CFG.prompt_versions).join(','), exception_stage: stage, exception_reason: String(reason).slice(0, 1500),
  alert_json: JSON.stringify(alertMasked).slice(0, 20000), correlation_json: out('Agent: Alert Correlation'), ti_json: out('Agent: Threat Intelligence'),
  asset_json: out('Agent: Asset Context'), risk_json: out('Agent: Risk/Prioritisation'), summary_json: out('Agent: Incident Summary'),
  scoring_json: sc ? JSON.stringify(sc) : '', risk_score: sc && sc.ok ? sc.score : null, classification: sc && sc.ok ? sc.class : '',
  hallucinated_ids: ((g && g.hallucinated_ids) || 0) + ((sg && sg.hallucinated_ids) || 0), retries: stats.reduce((s, x) => s + ((x.attempts || 1) - 1), 0),
  total_latency_ms: stats.reduce((s, x) => s + (x.latency_ms || 0), 0), agent_stats_json: JSON.stringify(stats) } }];`, [X(12), 520]),
    dtUpsert('Save Exception Case', T_CASES, '={{ $json.case_id }}', [X(13), 520]),
    dtAudit('Audit: EXCEPTION', {
      case_id: "={{ $('Exception Handler').first().json.case_id }}", step: "={{ $('Exception Handler').first().json.exception_stage }}", actor: 'orchestrator (code)',
      model: "={{ $('Exception Handler').first().json.model }}", event: 'EXCEPTION_MANUAL_QUEUE', status: 'E',
      detail: "={{ $('Exception Handler').first().json.exception_reason.slice(0, 500) }}",
    }, [X(14), 520]),
    sticky('## WF-1 SOC Triage\nAgents advise, code routes, humans approve.\nOrchestrator, lookups, scoring, guardrails and routing are deterministic code. The five agents run through SW-1. Every failure path lands in the Exception Handler (E, manual queue).', [-40, -420], 560, 200, 5),
    sticky('### Routing (A/H/E)\n0 ESCALATE → E, then H approval by Tier 2 / Lead\n1 REVIEW → H analyst review\n2 CONFIRM_CLOSURE → H analyst confirms\n3 EXCEPTION (agent flagged injection) → E', [X(28) - 20, -520], 420, 200, 3),
  ];
  const links = [
    ['Triage Intake', 0, 'Validate Input'], ['Validate Input', 0, 'Input Valid?'], ['Input Valid?', 0, 'Injection & PII Screen'], ['Input Valid?', 1, 'Exception Handler'],
    ['Injection & PII Screen', 0, 'Screen Clean?'], ['Screen Clean?', 0, 'Orchestrator: Init Case'], ['Screen Clean?', 1, 'Exception Handler'],
    ['Orchestrator: Init Case', 0, 'Save Case: PROCESSING'], ['Save Case: PROCESSING', 0, 'Audit: CASE_CREATED'], ['Audit: CASE_CREATED', 0, 'Tool: Related Events'],
    ['Tool: Related Events', 0, 'Build Correlation Request'], ['Build Correlation Request', 0, 'Agent: Alert Correlation'], ['Agent: Alert Correlation', 0, 'Correlation OK?'],
    ['Correlation OK?', 0, 'Tool: TI, CMDB & Identity Lookups'], ['Correlation OK?', 1, 'Exception Handler'],
    ['Tool: TI, CMDB & Identity Lookups', 0, 'Build TI Request'], ['Tool: TI, CMDB & Identity Lookups', 0, 'Build Asset Request'],
    ['Build TI Request', 0, 'Agent: Threat Intelligence'], ['Build Asset Request', 0, 'Agent: Asset Context'],
    ['Agent: Threat Intelligence', 0, 'Join TI & Asset', 0], ['Agent: Asset Context', 0, 'Join TI & Asset', 1],
    ['Join TI & Asset', 0, 'Evidence Completeness & Flags'], ['Evidence Completeness & Flags', 0, 'Agents OK?'],
    ['Agents OK?', 0, 'Build Risk Request'], ['Agents OK?', 1, 'Exception Handler'], ['Build Risk Request', 0, 'Agent: Risk/Prioritisation'],
    ['Agent: Risk/Prioritisation', 0, 'Risk OK?'], ['Risk OK?', 0, 'Scoring Engine'], ['Risk OK?', 1, 'Exception Handler'],
    ['Scoring Engine', 0, 'Policy & Output Guardrails'], ['Policy & Output Guardrails', 0, 'Guardrails Passed?'],
    ['Guardrails Passed?', 0, 'Build Summary Request'], ['Guardrails Passed?', 1, 'Exception Handler'],
    ['Build Summary Request', 0, 'Agent: Incident Summary'], ['Agent: Incident Summary', 0, 'Summary Guardrail'], ['Summary Guardrail', 0, 'Summary OK?'],
    ['Summary OK?', 0, 'Conditional Routing'], ['Summary OK?', 1, 'Exception Handler'],
    ['Conditional Routing', 0, 'Build Escalation Package'], ['Conditional Routing', 1, 'Set Review State'], ['Conditional Routing', 2, 'Set Closure-Confirmation State'], ['Conditional Routing', 3, 'Exception Handler'],
    ['Build Escalation Package', 0, 'Notify IR Lead (simulated)'], ['Notify IR Lead (simulated)', 0, 'Finalise Case Record'],
    ['Set Review State', 0, 'Finalise Case Record'], ['Set Closure-Confirmation State', 0, 'Finalise Case Record'],
    ['Finalise Case Record', 0, 'Save Case: ROUTED'], ['Save Case: ROUTED', 0, 'Audit: ROUTED'],
    ['Exception Handler', 0, 'Save Exception Case'], ['Save Exception Case', 0, 'Audit: EXCEPTION'],
  ];
  return wf(IDS.triage, 'SOC WF-1 Triage', nodes, links, { errorWorkflow: IDS.error });
}

// ================================================================ WF-2 Decision (HITL)
function buildDecision() {
  const X = (i) => i * 240;
  const nodes = [
    webhook('Decision Intake', 'POST', 'soc-decision', 'responseNode', [X(0), 0]),
    code('Validate Decision', `const d = $input.first().json.body || {};
const v = SOC.validateDecision(d, CFG);
return [{ json: { valid: v.valid, d, _error: v.errors.join('; '), _event: 'DECISION_INVALID' } }];`, [X(1), 0]),
    ifNode('Decision Valid?', '={{ $json.valid }}', [X(2), 0]),
    dtGet('Load Case', T_CASES, [{ keyName: 'case_id', condition: 'eq', keyValue: "={{ $json.d.case_id }}" }], [X(3), 0], false),
    code('Authorisation Check (role matrix)', `const d = $('Validate Decision').first().json.d; const row = $input.first().json;
if (!row || !row.case_id) return [{ json: { permitted: false, d, _error: 'case ' + d.case_id + ' not found', _event: 'DECISION_DENIED' } }];
const a = SOC.authoriseDecision(d, row, CFG);
return [{ json: { permitted: a.permitted, d, row, auth: a, role: a.role, _error: a.permitted ? '' : a.reason, _event: 'DECISION_DENIED' } }];`, [X(4), 0]),
    ifNode('Permitted?', '={{ $json.permitted }}', [X(5), 0]),
    switchExpr('Route Decision', "={{ ({ APPROVE: 0, MODIFY: 1, REJECT: 2 })[$json.d.decision] }}", 3, [X(6), 0]),
    code('Allow-list Re-check & Simulated Action', `const x = $input.first().json; const now = new Date().toISOString();
if (!CFG.allowed_actions.includes(x.auth.final_action)) throw new Error('Final action not on allow-list: ' + x.auth.final_action);
const r = SOC.executeDecision(x.d, x.row, x.auth, CFG, now);
const decision = { analyst_id: x.d.analyst_id, role: x.role, decision: x.d.decision, note: x.d.note || '', reason_code: x.d.reason_code || null,
  original_action: x.auth.original_action, final_action: x.auth.final_action, original_class: x.auth.original_class, final_class: x.auth.final_class, decided_at: now, ...r };
return [{ json: { case_id: x.d.case_id, status: r.status, updated_at: now, decision_json: JSON.stringify(decision) } }];`, [X(7), -120]),
    code('Reject Handler', `const x = $input.first().json; const now = new Date().toISOString();
const r = SOC.executeDecision(x.d, x.row, x.auth, CFG, now);
const decision = { analyst_id: x.d.analyst_id, role: x.role, decision: 'REJECT', note: x.d.note || '', reason_code: x.d.reason_code,
  original_action: x.row.recommended_action || null, final_action: null, original_class: x.row.classification || null, final_class: null, decided_at: now, ...r };
return [{ json: { case_id: x.d.case_id, status: r.status, updated_at: now, decision_json: JSON.stringify(decision) } }];`, [X(7), 120]),
    dtUpsert('Update Case', T_CASES, '={{ $json.case_id }}', [X(8), 0]),
    dtAudit('Audit: HUMAN_DECISION', {
      case_id: "={{ $('Update Case').first().json.case_id }}", step: 'hitl', actor: "={{ JSON.parse($('Update Case').first().json.decision_json).analyst_id + ' (' + JSON.parse($('Update Case').first().json.decision_json).role + ')' }}",
      event: "={{ 'HUMAN_' + JSON.parse($('Update Case').first().json.decision_json).decision }}",
      detail: "={{ (() => { const d = JSON.parse($('Update Case').first().json.decision_json); return 'AI: ' + d.original_class + '/' + d.original_action + ' → final: ' + d.final_class + '/' + d.final_action + ' | status ' + d.status + (d.reason_code ? ' | reason ' + d.reason_code : '') + (d.note ? ' | note: ' + d.note : '') + (d.ticket_id ? ' | ' + d.ticket_id : ''); })() }}",
      status: 'H',
    }, [X(9), 0]),
    respond('Respond OK', "={{ JSON.stringify({ ok: true, case_id: $('Update Case').first().json.case_id, status: $('Update Case').first().json.status, message: JSON.parse($('Update Case').first().json.decision_json).message }) }}", [X(10), 0]),
    respond('Respond Error', "={{ JSON.stringify({ ok: false, error: $json._error }) }}", [X(6), 300], "={{ $json._event === 'DECISION_INVALID' ? 400 : 403 }}"),
    dtAudit('Audit: DECISION_DENIED', {
      case_id: "={{ ($json.d && $json.d.case_id) || '' }}", step: 'hitl', actor: "={{ (($json.d && $json.d.analyst_id) || 'unknown') + ($json.role ? ' (' + $json.role + ')' : '') }}",
      event: '={{ $json._event }}', detail: "={{ (($json.d && $json.d.decision) || '') + ': ' + $json._error }}", status: 'DENIED',
    }, [X(7), 300]),
    sticky('## WF-2 Analyst Decision (HITL)\nApprove / Modify / Reject. n8n derives the role from the analyst ID and applies the role matrix; the UI cannot grant itself authority. All actions are simulated and labelled SIMULATED. Denials are audited.', [-40, -300], 520, 180, 5),
  ];
  const links = [
    ['Decision Intake', 0, 'Validate Decision'], ['Validate Decision', 0, 'Decision Valid?'], ['Decision Valid?', 0, 'Load Case'], ['Decision Valid?', 1, 'Respond Error'],
    ['Load Case', 0, 'Authorisation Check (role matrix)'], ['Authorisation Check (role matrix)', 0, 'Permitted?'], ['Permitted?', 0, 'Route Decision'], ['Permitted?', 1, 'Respond Error'],
    ['Route Decision', 0, 'Allow-list Re-check & Simulated Action'], ['Route Decision', 1, 'Allow-list Re-check & Simulated Action'], ['Route Decision', 2, 'Reject Handler'],
    ['Allow-list Re-check & Simulated Action', 0, 'Update Case'], ['Reject Handler', 0, 'Update Case'], ['Update Case', 0, 'Audit: HUMAN_DECISION'], ['Audit: HUMAN_DECISION', 0, 'Respond OK'],
    ['Respond Error', 0, 'Audit: DECISION_DENIED'],
  ];
  return wf(IDS.decision, 'SOC WF-2 Analyst Decision', nodes, links, { errorWorkflow: IDS.error });
}

// ================================================================ WF-3 Read API
function buildRead() {
  const nodes = [
    webhook('Read Intake', 'GET', 'soc-read', 'responseNode', [0, 0]),
    switchExpr('Which Resource?', "={{ ({ cases: 0, case: 1, audit: 2 })[$json.query.resource] ?? 3 }}", 4, [240, 0]),
    dtGet('Get All Cases', T_CASES, null, [480, -240]),
    code('Shape Cases', `const keep = ['case_id', 'created_at', 'updated_at', 'alert_id', 'status', 'route', 'priority', 'risk_score', 'classification', 'confidence', 'flags', 'model', 'exception_stage', 'total_latency_ms', 'retries', 'hallucinated_ids'];
const rows = $input.all().map((i) => i.json).filter((r) => r.case_id);
return [{ json: { cases: rows.map((r) => Object.fromEntries(keep.map((k) => [k, r[k] ?? null]))) } }];`, [720, -240], { core: false }),
    dtGet('Get One Case', T_CASES, [{ keyName: 'case_id', condition: 'eq', keyValue: "={{ $json.query.id }}" }], [480, -80], false),
    code('Shape Case', `const r = $input.first().json; return [{ json: { case: r && r.case_id ? r : null } }];`, [720, -80], { core: false }),
    dtGet('Get Audit Rows', T_AUDIT, null, [480, 80]),
    code('Shape Audit', `const id = $('Read Intake').first().json.query.id;
const rows = $input.all().map((i) => i.json).filter((r) => r.ts && (!id || r.case_id === id)).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
return [{ json: { audit: rows.map(({ id, createdAt, updatedAt, ...rest }) => rest) } }];`, [720, 80], { core: false }),
    code('Ping', `return [{ json: { ok: true, service: 'soc-read', resources: ['cases', 'case', 'audit'] } }];`, [480, 240], { core: false }),
    respond('Respond', '={{ JSON.stringify($json) }}', [960, 0]),
  ];
  const links = [
    ['Read Intake', 0, 'Which Resource?'], ['Which Resource?', 0, 'Get All Cases'], ['Which Resource?', 1, 'Get One Case'], ['Which Resource?', 2, 'Get Audit Rows'], ['Which Resource?', 3, 'Ping'],
    ['Get All Cases', 0, 'Shape Cases'], ['Get One Case', 0, 'Shape Case'], ['Get Audit Rows', 0, 'Shape Audit'],
    ['Shape Cases', 0, 'Respond'], ['Shape Case', 0, 'Respond'], ['Shape Audit', 0, 'Respond'], ['Ping', 0, 'Respond'],
  ];
  return wf(IDS.read, 'SOC WF-3 Read API', nodes, links, { errorWorkflow: IDS.error });
}

// ================================================================ WF-4 Error handler
function buildError() {
  const nodes = [
    { parameters: {}, name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 0], id: uid() },
    code('Build Exception Record', `const e = $input.first().json;
return [{ json: { execution_id: String((e.execution && e.execution.id) || ''), workflow: (e.workflow && e.workflow.name) || '', node: (e.execution && e.execution.lastNodeExecuted) || '',
  message: String((e.execution && e.execution.error && e.execution.error.message) || (e.trigger && e.trigger.error && e.trigger.error.message) || 'unknown error').slice(0, 800) } }];`, [240, 0], { core: false }),
    dtGet('Find Case by Execution', T_CASES, [{ keyName: 'execution_id', condition: 'eq', keyValue: '={{ $json.execution_id }}' }], [480, 0], false),
    code('Mark Case Exception', `const err = $('Build Exception Record').first().json; const row = $input.first().json;
const now = new Date().toISOString();
if (!row || !row.case_id) return [{ json: { case_id: 'CASE-UNLINKED-' + err.execution_id, created_at: now, updated_at: now, alert_id: 'UNKNOWN', status: 'EXCEPTION_MANUAL_QUEUE', route: 'EXCEPTION', priority: 'P1', execution_id: err.execution_id, exception_stage: 'workflow_error', exception_reason: err.workflow + ' / ' + err.node + ': ' + err.message } }];
return [{ json: { case_id: row.case_id, updated_at: now, status: 'EXCEPTION_MANUAL_QUEUE', route: 'EXCEPTION', priority: 'P1', exception_stage: 'workflow_error', exception_reason: err.workflow + ' / ' + err.node + ': ' + err.message } }];`, [720, 0], { core: false }),
    dtUpsert('Update Case', T_CASES, '={{ $json.case_id }}', [960, 0]),
    dtAudit('Audit: WORKFLOW_ERROR', {
      case_id: "={{ $('Mark Case Exception').first().json.case_id }}", step: 'error_handler', actor: 'n8n error workflow', event: 'WORKFLOW_ERROR', status: 'E',
      detail: "={{ $('Mark Case Exception').first().json.exception_reason }}",
    }, [1200, 0]),
  ];
  const links = [['Error Trigger', 0, 'Build Exception Record'], ['Build Exception Record', 0, 'Find Case by Execution'], ['Find Case by Execution', 0, 'Mark Case Exception'], ['Mark Case Exception', 0, 'Update Case'], ['Update Case', 0, 'Audit: WORKFLOW_ERROR']];
  return wf(IDS.error, 'SOC WF-4 Error Handler', nodes, links);
}

// ================================================================ WF-5 SLA watcher (stretch)
function buildSla() {
  const nodes = [
    { parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } }, name: 'Every 2 minutes', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0], id: uid() },
    dtGet('Get Escalated Cases', T_CASES, [{ keyName: 'status', condition: 'eq', keyValue: 'ESCALATED_PENDING_APPROVAL' }], [240, 0]),
    code('Older Than SLA?', `const cutoff = Date.now() - CFG.sla_minutes_escalated * 60000; const now = new Date().toISOString();
return $input.all().map((i) => i.json).filter((r) => r.case_id && Date.parse(r.updated_at) < cutoff)
  .map((r) => ({ json: { case_id: r.case_id, updated_at: now, status: 'ESCALATED_TO_LEAD', priority: 'P1' } }));`, [480, 0], { core: false, extra: `const CFG = ${JSON.stringify({ sla_minutes_escalated: CFG.sla_minutes_escalated })};\n` }),
    dtUpsert('Escalate to SOC Lead', T_CASES, '={{ $json.case_id }}', [720, 0]),
    dtAudit('Audit: SLA_ESCALATION', { case_id: '={{ $json.case_id }}', step: 'sla_watcher', actor: 'scheduler (code)', event: 'SLA_BREACH_ESCALATED_TO_LEAD', detail: `no decision within ${CFG.sla_minutes_escalated} min; SIMULATED page to SOC Lead`, status: 'E' }, [960, 0]),
  ];
  return wf(IDS.sla, 'SOC WF-5 SLA Watcher (optional)', nodes, [['Every 2 minutes', 0, 'Get Escalated Cases'], ['Get Escalated Cases', 0, 'Older Than SLA?'], ['Older Than SLA?', 0, 'Escalate to SOC Lead'], ['Escalate to SOC Lead', 0, 'Audit: SLA_ESCALATION']], { errorWorkflow: IDS.error });
}

// ---------------------------------------------------------------- write
const out = path.join(ROOT, process.env.SOC_OUT || path.join('n8n', 'workflows'));
fs.mkdirSync(out, { recursive: true });
const all = [
  ['00_setup.json', buildSetup()], ['01_triage.json', buildTriage()], ['02_sw_llm_agent.json', buildLlm()], ['03_decision.json', buildDecision()],
  ['04_read_api.json', buildRead()], ['05_error_handler.json', buildError()], ['06_sla_watcher.json', buildSla()],
];
for (const [f, w] of all) {
  fs.writeFileSync(path.join(out, f), JSON.stringify(w, null, 2));
  console.log(`${f.padEnd(24)} ${String(w.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length).padStart(3)} nodes  ${w.name}`);
}
