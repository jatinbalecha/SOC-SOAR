// soc_core.js — deterministic control logic for the governed SOC triage PoC.
// This file is embedded verbatim into every n8n Code node that needs it
// (see tools/build_workflows.js) and is unit-tested with Node in /tests.
// Pure JavaScript only: no require(), no network, no filesystem.

const SOC = (() => {
  // ---------- small helpers ----------
  const uniq = (a) => [...new Set(a.filter((x) => x !== null && x !== undefined && x !== ''))];
  const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  const isIPv4 = (s) => typeof s === 'string' && IPV4.test(s);
  const isCIDR = (s) => {
    if (typeof s !== 'string' || !s.includes('/')) return false;
    const [ip, bits] = s.split('/');
    return isIPv4(ip) && /^\d{1,2}$/.test(bits) && Number(bits) <= 32;
  };
  const isPrivate = (ip) => {
    if (!isIPv4(ip)) return false;
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  };
  const rankOf = (order, v) => { const i = order.indexOf(v); return i < 0 ? -1 : i; };
  const CLASS_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const maxClass = (a, b) => (rankOf(CLASS_ORDER, a) >= rankOf(CLASS_ORDER, b) ? a : b);

  // ---------- 1. input validation (N02) ----------
  function validateInput(payload, cfg) {
    const errors = [];
    const p = payload || {};
    const a = p.alert;
    if (typeof p.case_id !== 'string' || !/^CASE-[A-Za-z0-9-]{3,80}$/.test(p.case_id)) errors.push('case_id missing or malformed');
    const modelIds = cfg.models.map((m) => m.id);
    if (!modelIds.includes(p.model)) errors.push(`model not in approved list: ${p.model}`);
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      errors.push('alert must be a JSON object');
      return { valid: false, errors };
    }
    const V = cfg.validation;
    for (const f of V.required_fields) {
      if (a[f] === undefined || a[f] === null || a[f] === '') errors.push(`missing required field: ${f}`);
    }
    if (a.severity !== undefined && !V.severities.includes(a.severity)) errors.push(`invalid severity: ${a.severity} (allowed: ${V.severities.join(', ')})`);
    if (a.source_ip !== undefined && !isIPv4(a.source_ip)) errors.push(`invalid source_ip: ${a.source_ip}`);
    if (a.destination_ip !== undefined && !(isIPv4(a.destination_ip) || isCIDR(a.destination_ip))) errors.push(`invalid destination_ip: ${a.destination_ip}`);
    if (a.timestamp !== undefined && (typeof a.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(a.timestamp) || isNaN(Date.parse(a.timestamp)))) errors.push(`timestamp is not ISO-8601: ${a.timestamp}`);
    if (typeof a.event_description === 'string' && a.event_description.length > V.max_description_chars) errors.push(`event_description longer than ${V.max_description_chars} chars`);
    if (a.log_evidence !== undefined) {
      if (!Array.isArray(a.log_evidence)) errors.push('log_evidence must be an array');
      else {
        if (a.log_evidence.length === 0) errors.push('log_evidence is empty: no evidence to triage');
        if (a.log_evidence.length > V.max_log_lines) errors.push(`more than ${V.max_log_lines} log lines`);
        const ids = [];
        a.log_evidence.forEach((l, i) => {
          if (!l || typeof l !== 'object') { errors.push(`log_evidence[${i}] is not an object`); return; }
          if (typeof l.evidence_id !== 'string' || !/^[A-Z0-9-]{3,40}$/.test(l.evidence_id)) errors.push(`log_evidence[${i}].evidence_id malformed`);
          if (typeof l.text !== 'string' || l.text.length > V.max_log_text_chars) errors.push(`log_evidence[${i}].text missing or too long`);
          if (typeof l.time !== 'string' || isNaN(Date.parse(l.time))) errors.push(`log_evidence[${i}].time invalid`);
          ids.push(l.evidence_id);
        });
        if (uniq(ids).length !== ids.length) errors.push('duplicate evidence_id in log_evidence');
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // ---------- 2. injection + sensitive-data screen (N04) ----------
  function collectStrings(obj, path = '', out = []) {
    if (typeof obj === 'string') out.push({ path, value: obj });
    else if (Array.isArray(obj)) obj.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
    else if (obj && typeof obj === 'object') Object.keys(obj).forEach((k) => collectStrings(obj[k], path ? `${path}.${k}` : k, out));
    return out;
  }
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const PHONE = /(?<![\w-])(\+\d{1,3}[\s-]?)?\d{10}(?![\w-])/g;
  function maskValue(v) {
    if (typeof v === 'string') return v.replace(EMAIL, '[EMAIL_MASKED]').replace(PHONE, '[PHONE_MASKED]');
    if (Array.isArray(v)) return v.map(maskValue);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = maskValue(v[k]); return o; }
    return v;
  }
  function screenInput(alert, cfg) {
    const matches = [];
    const pats = cfg.injection_patterns.map((p) => new RegExp(p, 'i'));
    for (const { path, value } of collectStrings(alert)) {
      pats.forEach((re, i) => {
        const m = value.match(re);
        if (m) matches.push({ field: path, pattern_index: i, excerpt: value.substr(Math.max(0, m.index - 20), 80) });
      });
    }
    const masked = maskValue(alert);
    const maskedCount = JSON.stringify(masked).split('_MASKED]').length - 1;
    return { clean: matches.length === 0, matches, masked_alert: masked, masked_count: maskedCount };
  }

  // ---------- 3. deterministic entity extraction + related events (N09) ----------
  function extractEntities(alert, cmdb, identity) {
    const texts = [alert.event_description || '', ...(alert.log_evidence || []).map((l) => l.text || '')].join(' \n ');
    const ips = [], ranges = [];
    const pushAddr = (s) => { if (isCIDR(s)) ranges.push(s); else if (isIPv4(s)) ips.push(s); };
    pushAddr(alert.source_ip); pushAddr(alert.destination_ip);
    for (const m of texts.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})(\/\d{1,2})?\b/g)) pushAddr(m[2] ? m[1] + m[2] : m[1]);
    const hashes = [...texts.matchAll(/\b([a-fA-F0-9]{64}|[a-fA-F0-9]{40}|[a-fA-F0-9]{32})\b/g)].map((m) => m[1].toLowerCase());
    const lower = texts.toLowerCase();
    const hosts = [alert.asset, ...cmdb.filter((r) => lower.includes(r.asset.toLowerCase())).map((r) => r.asset)];
    const users = [alert.user && alert.user.toLowerCase() !== 'unknown' ? alert.user : null,
      ...identity.filter((r) => lower.includes(r.user.toLowerCase())).map((r) => r.user)];
    return { ips: uniq(ips), ranges: uniq(ranges), hosts: uniq(hosts), users: uniq(users), hashes: uniq(hashes), domains: [] };
  }
  function fetchRelated(alert, entities, history, windowHours) {
    const t = Date.parse(alert.timestamp);
    const lo = t - windowHours * 3600 * 1000;
    return history.filter((h) => {
      const ht = Date.parse(h.time);
      if (!(ht >= lo && ht <= t)) return false;
      const shares = (h.users || []).some((u) => entities.users.includes(u))
        || (h.hosts || []).some((x) => entities.hosts.includes(x))
        || (h.ips || []).some((x) => entities.ips.includes(x));
      return shares;
    }).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  }

  // ---------- 4. deterministic lookups + reference levels (N11) ----------
  const TI_ORDER = ['CLEAN', 'UNKNOWN', 'SUSPICIOUS_OR_CONFLICTING', 'MALICIOUS_MEDIUM', 'MALICIOUS_HIGH'];
  function lookupTI(entities, ti) {
    const inTable = new Set(ti.map((r) => r.indicator));
    const indicators = [
      ...entities.ips.filter((ip) => !isPrivate(ip) || inTable.has(ip)).map((v) => ({ indicator: v, type: 'ip' })),
      ...entities.hashes.map((v) => ({ indicator: v, type: 'hash' })),
      ...entities.domains.map((v) => ({ indicator: v, type: 'domain' })),
    ];
    const records = [], notFound = [], perIndicator = [];
    let level = indicators.length ? 'CLEAN' : 'UNKNOWN';
    const bump = (l) => { if (rankOf(TI_ORDER, l) > rankOf(TI_ORDER, level)) level = l; };
    for (const ind of indicators) {
      const recs = ti.filter((r) => r.indicator.toLowerCase() === ind.indicator.toLowerCase());
      records.push(...recs);
      let verdict;
      if (!recs.length) { verdict = 'UNKNOWN'; notFound.push(ind.indicator); bump('UNKNOWN'); }
      else {
        const reps = uniq(recs.map((r) => r.reputation));
        const bad = reps.some((r) => r === 'MALICIOUS' || r === 'SUSPICIOUS');
        verdict = reps.length === 1 ? reps[0] : (bad && reps.includes('CLEAN') ? 'CONFLICTING' : (reps.includes('MALICIOUS') ? 'MALICIOUS' : 'SUSPICIOUS'));
        const mal = recs.filter((r) => r.reputation === 'MALICIOUS');
        if (mal.some((r) => r.confidence >= 0.8)) bump('MALICIOUS_HIGH');
        else if (mal.length) bump('MALICIOUS_MEDIUM');
        else if (verdict === 'SUSPICIOUS' || verdict === 'CONFLICTING') bump('SUSPICIOUS_OR_CONFLICTING');
      }
      perIndicator.push({ ...ind, verdict, record_ids: recs.map((r) => r.record_id) });
    }
    const maxMalConf = Math.max(0, ...records.filter((r) => r.reputation === 'MALICIOUS').map((r) => r.confidence));
    return { indicators, records, not_found: notFound, per_indicator: perIndicator, reference_level: level, max_malicious_confidence: maxMalConf,
      has_conflict: perIndicator.some((p) => p.verdict === 'CONFLICTING') };
  }
  const ASSET_POINTS_ORDER = ['LOW', 'MEDIUM', 'UNKNOWN', 'HIGH', 'CRITICAL'];
  const SENS_ORDER = ['LOW', 'MEDIUM', 'UNKNOWN', 'HIGH'];
  const PRIV_ORDER = ['STANDARD', 'SERVICE_ACCOUNT', 'UNKNOWN', 'PRIVILEGED'];
  function lookupAssets(entities, cmdb, identity) {
    const assetNames = uniq([...entities.hosts, ...cmdb.filter((r) => entities.ips.includes(r.ip)).map((r) => r.asset)]);
    const assets = assetNames.map((a) => ({ asset: a, record: cmdb.find((r) => r.asset.toLowerCase() === a.toLowerCase()) || null }));
    const users = entities.users.map((u) => ({ user: u, record: identity.find((r) => r.user.toLowerCase() === u.toLowerCase()) || null }));
    const pick = (order, vals) => vals.reduce((best, v) => (rankOf(order, v) > rankOf(order, best) ? v : best), order[0]);
    const crit = assets.length ? pick(ASSET_POINTS_ORDER, assets.map((a) => (a.record ? a.record.criticality : 'UNKNOWN'))) : 'UNKNOWN';
    const sens = assets.length ? pick(SENS_ORDER, assets.map((a) => (a.record ? a.record.data_sensitivity : 'UNKNOWN'))) : 'UNKNOWN';
    const priv = users.length ? pick(PRIV_ORDER, users.map((u) => (u.record ? u.record.privilege : 'UNKNOWN'))) : 'UNKNOWN';
    return {
      assets: assetNames, users: entities.users,
      cmdb_records: assets.filter((a) => a.record).map((a) => a.record),
      identity_records: users.filter((u) => u.record).map((u) => u.record),
      unknown_assets: assets.filter((a) => !a.record).map((a) => a.asset).concat(assets.length ? [] : ['(no asset identified)']),
      unknown_users: users.filter((u) => !u.record).map((u) => u.user),
      reference: { criticality: crit, data_sensitivity: sens, privilege: priv },
    };
  }

  // ---------- 5. output schemas (used by SW-1 Parse & Validate) ----------
  const S = {
    str: (max, nullable = false) => ({ t: 'string', max, nullable }),
    num: (min, max) => ({ t: 'number', min, max }),
    bool: () => ({ t: 'boolean' }),
    en: (values, nullable = false) => ({ t: 'enum', values, nullable }),
    arr: (items, min = 0, max = 50) => ({ t: 'array', items, min, max }),
    obj: (props) => ({ t: 'object', props }),
  };
  const COMMON = (agent) => ({ agent: S.en([agent]), case_id: S.str(100), confidence: S.num(0, 1), escalation_condition_met: S.bool(), escalation_reason: S.str(200, true) });
  const STAGES = ['NONE', 'RECONNAISSANCE', 'INITIAL_ACCESS', 'EXECUTION', 'CREDENTIAL_ACCESS', 'LATERAL_MOVEMENT', 'COMMAND_AND_CONTROL', 'EXFILTRATION', 'IMPACT', 'UNCLEAR'];
  function schemas(cfg) {
    const A = cfg.allowed_actions;
    return {
      corr: S.obj({ ...COMMON('alert_correlation'),
        entities: S.obj({ ips: S.arr(S.str(64)), hosts: S.arr(S.str(100)), users: S.arr(S.str(100)), hashes: S.arr(S.str(128)), domains: S.arr(S.str(253)) }),
        related_alert_ids: S.arr(S.str(40)),
        timeline: S.arr(S.obj({ time: S.str(40), event: S.str(300), evidence_id: S.str(40) }), 0, 30),
        attack_stage_hypothesis: S.en(STAGES), correlation_summary: S.str(400), evidence_gaps: S.arr(S.str(300), 0, 15) }),
      ti: S.obj({ ...COMMON('threat_intel'),
        indicator_assessments: S.arr(S.obj({ indicator: S.str(128), type: S.en(['ip', 'domain', 'hash']), verdict: S.en(['MALICIOUS', 'SUSPICIOUS', 'CLEAN', 'UNKNOWN', 'CONFLICTING']), record_ids: S.arr(S.str(40)), rationale: S.str(250) }), 0, 30),
        overall_ti_level: S.en(TI_ORDER.slice().reverse()), conflicts: S.arr(S.str(300)), not_found: S.arr(S.str(128)) }),
      asset: S.obj({ ...COMMON('asset_context'),
        asset_assessments: S.arr(S.obj({ asset: S.str(100), record_id: S.str(40, true), criticality: S.en(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']), data_sensitivity: S.en(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']), owner: S.str(100, true), business_impact_note: S.str(200) })),
        user_assessments: S.arr(S.obj({ user: S.str(100), record_id: S.str(40, true), privilege: S.en(['PRIVILEGED', 'SERVICE_ACCOUNT', 'STANDARD', 'UNKNOWN']), note: S.str(300) })),
        unknown_entities: S.arr(S.str(100)), overall_asset_criticality: S.en(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']) }),
      risk: S.obj({ ...COMMON('risk_prioritisation'),
        behaviour_level: S.en(['MULTI_STAGE', 'SUSPICIOUS_SINGLE', 'WEAK_ANOMALY', 'BENIGN_EXPLAINED']),
        proposed_classification: S.en(CLASS_ORDER),
        incident_category: S.en(['FALSE_POSITIVE', 'BENIGN_TRUE_POSITIVE', 'SUSPICIOUS_NEEDS_REVIEW', 'CONFIRMED_INCIDENT_LIKELY']),
        recommended_action: S.en(A), escalate_recommended: S.bool(),
        reasons: S.arr(S.obj({ statement: S.str(400), evidence_ids: S.arr(S.str(40), 1, 10) }), 2, 5),
        missing_evidence: S.arr(S.str(300), 0, 15) }),
      sum: S.obj({ ...COMMON('incident_summary'),
        headline: S.str(120), what_happened: S.str(500),
        key_evidence: S.arr(S.obj({ text: S.str(300), evidence_ids: S.arr(S.str(40), 1, 10) }), 1, 8),
        risk_rationale: S.str(400), uncertainties: S.arr(S.str(300), 0, 15),
        recommended_options: S.arr(S.obj({ action: S.en(A), why: S.str(300), requires_approval: S.bool() }), 1, 3),
        decision_needed_from_analyst: S.str(300) }),
    };
  }
  function checkSchema(v, spec, path, errs) {
    const at = path || '$';
    if (spec.nullable && v === null) return;
    switch (spec.t) {
      case 'string': if (typeof v !== 'string') errs.push(`${at}: expected string`); else if (v.length > spec.max) errs.push(`${at}: longer than ${spec.max} chars`); break;
      case 'number': if (typeof v !== 'number' || isNaN(v)) errs.push(`${at}: expected number`); else if (v < spec.min || v > spec.max) errs.push(`${at}: out of range ${spec.min}-${spec.max}`); break;
      case 'boolean': if (typeof v !== 'boolean') errs.push(`${at}: expected boolean`); break;
      case 'enum': if (!spec.values.includes(v)) errs.push(`${at}: '${v}' not in [${spec.values.join(', ')}]`); break;
      case 'array':
        if (!Array.isArray(v)) { errs.push(`${at}: expected array`); break; }
        if (v.length < spec.min || v.length > spec.max) errs.push(`${at}: expected ${spec.min}-${spec.max} items, got ${v.length}`);
        v.forEach((x, i) => checkSchema(x, spec.items, `${at}[${i}]`, errs)); break;
      case 'object':
        if (!v || typeof v !== 'object' || Array.isArray(v)) { errs.push(`${at}: expected object`); break; }
        for (const k of Object.keys(spec.props)) { if (!(k in v)) errs.push(`${at}.${k}: missing`); else checkSchema(v[k], spec.props[k], `${at}.${k}`, errs); }
        for (const k of Object.keys(v)) if (!(k in spec.props)) errs.push(`${at}.${k}: unexpected key`);
        break;
      default: errs.push(`${at}: unknown spec`);
    }
  }
  function extractJson(text) {
    if (typeof text !== 'string') return { ok: false, error: 'model returned no text' };
    let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return { ok: false, error: 'no JSON object found in model output' };
    try { return { ok: true, value: JSON.parse(t.slice(s, e + 1)), stripped: s > 0 || e < t.length - 1 || t !== text.trim() }; }
    catch (err) { return { ok: false, error: `JSON parse error: ${err.message}` }; }
  }
  function validateAgentOutput(agentKey, rawText, caseId, cfg) {
    const parsed = extractJson(rawText);
    if (!parsed.ok) return { valid: false, errors: [parsed.error], output: null };
    const errs = [];
    checkSchema(parsed.value, schemas(cfg)[agentKey], '$', errs);
    if (parsed.value && parsed.value.case_id !== undefined && parsed.value.case_id !== caseId) errs.push(`$.case_id: expected ${caseId}`);
    return { valid: errs.length === 0, errors: errs.slice(0, 12), output: parsed.value };
  }

  // ---------- 6. prompt building (SW-1 L02 input) ----------
  function fill(tpl, vars) {
    return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => {
      if (!(k in vars)) return m;
      const v = vars[k];
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
  }
  function buildMessages(agentKey, vars, prompts, cfg) {
    const names = { corr: 'alert_correlation', ti: 'threat_intel', asset: 'asset_context', risk: 'risk_prioritisation', sum: 'incident_summary' };
    const common = { ...vars, agent_name: names[agentKey], allowed_actions: cfg.allowed_actions.join(', ') };
    const pv = cfg.prompt_versions;
    return {
      system: fill(prompts[pv.shared], common),
      user: fill(prompts[pv[agentKey]], common),
      prompt_version: `${pv.shared}+${pv[agentKey]}`,
    };
  }

  // ---------- 7. completeness flags (N15) ----------
  function completenessFlags(tiLookup, assetLookup) {
    const flags = [];
    if (assetLookup.unknown_assets.length) flags.push('UNKNOWN_ASSET');
    if (tiLookup.has_conflict) flags.push('TI_CONFLICT');
    if (tiLookup.not_found.length || tiLookup.indicators.length === 0) flags.push('TI_NOT_FOUND');
    return flags;
  }

  // ---------- 8. scoring engine (N17) ----------
  const agentIndicatesInjection = (o) => !!(o && typeof o.escalation_reason === 'string' && /injection/i.test(o.escalation_reason));
  function score(ctx, cfg) {
    const W = cfg.weights;
    const { alert, tiLookup, assetLookup, relatedCount, outputs } = ctx;
    const ref = assetLookup.reference;
    const behaviour = outputs.risk.behaviour_level;
    const relKey = relatedCount >= 3 ? '3+' : relatedCount >= 1 ? '1-2' : '0';
    const breakdown = [
      { factor: 'F1', name: 'Threat-intel reputation', level: tiLookup.reference_level, points: W.F1_ti.levels[tiLookup.reference_level], max: W.F1_ti.max, source: 'code (TI lookup)' },
      { factor: 'F2', name: 'Asset criticality', level: ref.criticality, points: W.F2_asset.levels[ref.criticality], max: W.F2_asset.max, source: 'code (CMDB)' },
      { factor: 'F3', name: 'Source-tool severity', level: alert.severity, points: W.F3_severity.levels[alert.severity], max: W.F3_severity.max, source: 'alert field' },
      { factor: 'F4', name: 'Behaviour / attack stage', level: behaviour, points: W.F4_behaviour.levels[behaviour], max: W.F4_behaviour.max, source: 'Risk agent (LLM)' },
      { factor: 'F5', name: 'User / account privilege', level: ref.privilege, points: W.F5_privilege.levels[ref.privilege], max: W.F5_privilege.max, source: 'code (identity)' },
      { factor: 'F6', name: 'Related alerts (24 h)', level: String(relatedCount), points: W.F6_related.levels[relKey], max: W.F6_related.max, source: 'code (history)' },
      { factor: 'F7', name: 'Data sensitivity', level: ref.data_sensitivity, points: W.F7_sensitivity.levels[ref.data_sensitivity], max: W.F7_sensitivity.max, source: 'code (CMDB)' },
    ];
    const missing = breakdown.filter((b) => typeof b.points !== 'number').map((b) => b.factor);
    if (missing.length) return { ok: false, error: `missing scoring factor(s): ${missing.join(', ')}` };
    const total = breakdown.reduce((s, b) => s + b.points, 0);
    const T = cfg.thresholds;
    let cls = total >= T.CRITICAL ? 'CRITICAL' : total >= T.HIGH ? 'HIGH' : total >= T.MEDIUM ? 'MEDIUM' : 'LOW';
    const baseClass = cls;
    const overrides = [];
    const tiMal = tiLookup.max_malicious_confidence >= cfg.ti_malicious_override_confidence;
    if (ref.criticality === 'CRITICAL' && tiMal) { overrides.push('R1'); cls = maxClass(cls, 'HIGH'); }
    if (ref.privilege === 'PRIVILEGED' && ['MULTI_STAGE', 'SUSPICIOUS_SINGLE'].includes(behaviour) && ['HIGH', 'CRITICAL'].includes(ref.criticality)) { overrides.push('R2'); cls = maxClass(cls, 'HIGH'); }
    if (assetLookup.unknown_assets.length) { overrides.push('R3'); cls = maxClass(cls, 'MEDIUM'); }
    if ((tiLookup.reference_level === 'UNKNOWN' || tiLookup.has_conflict) && ['High', 'Critical'].includes(alert.severity)) { overrides.push('R4'); cls = maxClass(cls, 'MEDIUM'); }

    const flags = [...ctx.flags];
    const proposed = outputs.risk.proposed_classification;
    const disagreements = [];
    if (Math.abs(rankOf(CLASS_ORDER, proposed) - rankOf(CLASS_ORDER, cls)) >= 2) disagreements.push(`risk agent proposed ${proposed}, rules computed ${cls}`);
    if (outputs.ti.overall_ti_level !== tiLookup.reference_level) disagreements.push(`TI agent level ${outputs.ti.overall_ti_level} vs lookup ${tiLookup.reference_level}`);
    if (outputs.asset.overall_asset_criticality !== ref.criticality) disagreements.push(`asset agent ${outputs.asset.overall_asset_criticality} vs CMDB ${ref.criticality}`);
    if (outputs.risk.escalate_recommended !== ['HIGH', 'CRITICAL'].includes(cls)) disagreements.push(`risk agent escalate_recommended=${outputs.risk.escalate_recommended} vs class ${cls}`);
    if (disagreements.length) flags.push('MODEL_RULE_DISAGREEMENT');
    const confs = ['corr', 'ti', 'asset', 'risk'].map((k) => outputs[k].confidence);
    if (confs.some((c) => c < cfg.low_agent_confidence)) flags.push('LOW_AGENT_CONFIDENCE');
    const overallConfidence = Math.max(0, Math.round((Math.min(...confs) - cfg.confidence_penalty_per_flag * flags.length) * 100) / 100);

    const injection = ['corr', 'ti', 'asset', 'risk'].some((k) => agentIndicatesInjection(outputs[k]));
    let route, priority, status, mark;
    if (injection) { route = 'EXCEPTION'; priority = 'P1'; status = 'EXCEPTION_MANUAL_QUEUE'; mark = 'E'; }
    else if (cls === 'CRITICAL' || cls === 'HIGH') { route = 'ESCALATE'; priority = 'P1'; status = 'ESCALATED_PENDING_APPROVAL'; mark = 'E'; }
    else if (cls === 'MEDIUM' || flags.length || overallConfidence < cfg.closure_min_confidence) { route = 'REVIEW'; priority = 'P2'; status = 'PENDING_ANALYST_REVIEW'; mark = 'H'; }
    else { route = 'CONFIRM_CLOSURE'; priority = 'P3'; status = 'PENDING_CLOSURE_CONFIRMATION'; mark = 'H'; }
    return { ok: true, score: total, base_class: baseClass, class: cls, overrides, breakdown, flags, disagreements,
      overall_confidence: overallConfidence, route, priority, status, mark, model_detected_injection: injection };
  }

  // ---------- 9. output guardrails (N18 + summary check) ----------
  const ACTION_CLAIM = /\b(has|have|was|were)\s+(been\s+)?(isolated|blocked|reset|quarantined|contained|disabled|closed|remediated)\b|\bwe\s+(isolated|blocked|reset|quarantined|contained|disabled)\b/i;
  function allowedIds(ctx) {
    return {
      logs: new Set((ctx.alert.log_evidence || []).map((l) => l.evidence_id)),
      hist: new Set(ctx.related.map((h) => h.evidence_id)),
      ti: new Set(ctx.tiLookup.records.map((r) => r.record_id)),
      assets: new Set([...ctx.assetLookup.cmdb_records, ...ctx.assetLookup.identity_records].map((r) => r.record_id)),
    };
  }
  function guardrailCheck(ctx, scoring, cfg) {
    const f = [];
    const ids = allowedIds(ctx);
    const all = new Set([...ids.logs, ...ids.hist, ...ids.ti, ...ids.assets]);
    const { corr, ti, asset, risk } = ctx.outputs;
    corr.related_alert_ids.forEach((x) => { if (!ids.hist.has(x)) f.push(`correlation cites unknown related alert ${x}`); });
    corr.timeline.forEach((e) => { if (!ids.logs.has(e.evidence_id) && !ids.hist.has(e.evidence_id)) f.push(`correlation timeline cites unknown evidence ${e.evidence_id}`); });
    ti.indicator_assessments.forEach((a) => a.record_ids.forEach((r) => { if (!ids.ti.has(r)) f.push(`TI agent cites unknown record ${r}`); }));
    ti.indicator_assessments.forEach((a) => { if (a.verdict === 'CLEAN' && a.record_ids.length === 0) f.push(`TI agent marked ${a.indicator} CLEAN with no record`); });
    asset.asset_assessments.forEach((a) => { if (a.record_id && !ids.assets.has(a.record_id)) f.push(`asset agent cites unknown record ${a.record_id}`); });
    asset.user_assessments.forEach((u) => { if (u.record_id && !ids.assets.has(u.record_id)) f.push(`asset agent cites unknown record ${u.record_id}`); });
    risk.reasons.forEach((r) => r.evidence_ids.forEach((x) => { if (!all.has(x)) f.push(`risk agent cites unknown evidence ${x}`); }));
    if (!cfg.allowed_actions.includes(risk.recommended_action)) f.push(`action not on allow-list: ${risk.recommended_action}`);
    if (cfg.containment_actions.includes(risk.recommended_action)
      && !(ctx.tiLookup.reference_level.startsWith('MALICIOUS') || risk.behaviour_level === 'MULTI_STAGE')) f.push(`containment ${risk.recommended_action} proposed without malicious TI or multi-stage behaviour`);
    if (cfg.closure_actions.includes(risk.recommended_action) && risk.behaviour_level !== 'BENIGN_EXPLAINED') f.push(`closure ${risk.recommended_action} proposed without a cited benign explanation`);
    if (!scoring.ok) f.push(scoring.error);
    return { pass: f.length === 0, failures: f, hallucinated_ids: f.filter((x) => /unknown (evidence|record|related)/.test(x)).length };
  }
  function summaryCheck(ctx, summary, cfg) {
    const f = [];
    const ids = allowedIds(ctx);
    const all = new Set([...ids.logs, ...ids.hist, ...ids.ti, ...ids.assets]);
    summary.key_evidence.forEach((k) => k.evidence_ids.forEach((x) => { if (!all.has(x)) f.push(`summary cites unknown evidence ${x}`); }));
    const text = [summary.headline, summary.what_happened, summary.risk_rationale].join(' ');
    if (ACTION_CLAIM.test(text)) f.push('summary claims an action was already taken');
    summary.recommended_options.forEach((o) => {
      if ((cfg.containment_actions.includes(o.action) || cfg.closure_actions.includes(o.action)) && o.requires_approval !== true) f.push(`summary option ${o.action} not marked requires_approval`);
    });
    return { pass: f.length === 0, failures: f, hallucinated_ids: f.filter((x) => /unknown evidence/.test(x)).length };
  }

  // ---------- 10. HITL decision authorisation (WF-2) ----------
  const DECIDABLE = ['PENDING_CLOSURE_CONFIRMATION', 'PENDING_ANALYST_REVIEW', 'ESCALATED_PENDING_APPROVAL', 'EXCEPTION_MANUAL_QUEUE', 'ESCALATED_TO_LEAD'];
  const REASON_CODES = ['WRONG_CLASSIFICATION', 'WRONG_ACTION', 'INSUFFICIENT_EVIDENCE', 'AI_ERROR_OR_HALLUCINATION', 'OTHER'];
  function validateDecision(d, cfg) {
    const e = [];
    if (!d || typeof d !== 'object') return { valid: false, errors: ['decision body must be an object'] };
    if (typeof d.case_id !== 'string') e.push('case_id required');
    if (!['APPROVE', 'MODIFY', 'REJECT'].includes(d.decision)) e.push('decision must be APPROVE, MODIFY or REJECT');
    if (!(d.analyst_id in cfg.demo_users)) e.push(`unknown analyst_id: ${d.analyst_id}`);
    if (d.decision === 'MODIFY') {
      if (!d.note || String(d.note).trim().length < 5) e.push('MODIFY requires a reason (note, 5+ chars)');
      if (!d.modified_action && !d.modified_class) e.push('MODIFY requires modified_action and/or modified_class');
      if (d.modified_action && !cfg.allowed_actions.includes(d.modified_action)) e.push(`modified_action not on allow-list: ${d.modified_action}`);
      if (d.modified_class && !CLASS_ORDER.includes(d.modified_class)) e.push(`invalid modified_class: ${d.modified_class}`);
    }
    if (d.decision === 'REJECT' && !REASON_CODES.includes(d.reason_code)) e.push(`REJECT requires reason_code in ${REASON_CODES.join(', ')}`);
    return { valid: e.length === 0, errors: e };
  }
  function authoriseDecision(d, caseRow, cfg) {
    const role = cfg.demo_users[d.analyst_id];
    const R = cfg.roles[role];
    if (!DECIDABLE.includes(caseRow.status)) return { permitted: false, role, reason: `case status ${caseRow.status} is not awaiting a decision` };
    const aiAction = caseRow.recommended_action || null;
    const origClass = caseRow.classification || 'HIGH'; // exceptions have no class: treat as HIGH (Tier 2+)
    if (d.decision === 'APPROVE' && !aiAction) return { permitted: false, role, reason: 'no AI recommendation to approve (exception case): use Modify with an explicit action, or Reject' };
    const finalAction = d.decision === 'MODIFY' ? (d.modified_action || aiAction) : d.decision === 'APPROVE' ? aiAction : null;
    const finalClass = d.decision === 'MODIFY' && d.modified_class ? d.modified_class : origClass;
    const governingClass = maxClass(origClass, finalClass); // cannot downgrade your way into authority
    if (rankOf(CLASS_ORDER, governingClass) > rankOf(CLASS_ORDER, R.max_class)) return { permitted: false, role, reason: `${role} may decide up to ${R.max_class}; case is ${governingClass}` };
    if (finalAction && cfg.containment_actions.includes(finalAction) && !R.may_approve_containment) return { permitted: false, role, reason: `${role} may not approve simulated containment (${finalAction})` };
    if (finalAction === 'ISOLATE_HOST_SIMULATED' && caseRow.asset_criticality === 'CRITICAL' && !R.may_isolate_critical) return { permitted: false, role, reason: `${role} may not isolate a CRITICAL asset; SOC Lead approval required` };
    if (d.decision !== 'REJECT' && !finalAction) return { permitted: false, role, reason: 'no action specified' };
    return { permitted: true, role, final_action: finalAction, final_class: finalClass, original_action: aiAction, original_class: caseRow.classification || null };
  }
  function executeDecision(d, caseRow, auth, cfg, nowIso) {
    const ticket = `TKT-${Date.parse(nowIso).toString(36).toUpperCase()}`;
    if (d.decision === 'REJECT') {
      const queue = ['HIGH', 'CRITICAL'].includes(caseRow.classification) || !caseRow.classification ? 'Tier2' : 'Tier1';
      return { status: 'RETURNED_TO_MANUAL', ticket_id: null, simulated_action: null, queue, ai_recommendation_status: 'REJECTED',
        message: `AI recommendation rejected (${d.reason_code}); returned to ${queue} manual queue. No action executed.` };
    }
    const act = auth.final_action;
    const closure = cfg.closure_actions.includes(act);
    const containment = cfg.containment_actions.includes(act);
    const status = closure ? 'CLOSED' : d.decision === 'MODIFY' ? 'MODIFIED_ACTION_SIMULATED' : 'APPROVED_ACTION_SIMULATED';
    return { status, ticket_id: ticket, simulated_action: act, queue: null,
      ai_recommendation_status: d.decision === 'MODIFY' ? 'MODIFIED' : 'APPROVED',
      message: containment ? `SIMULATED, no real system changed: ${act} recorded under ${ticket}.` : `${act} recorded under ${ticket}. SIMULATED, no real system changed.` };
  }

  return { isIPv4, isCIDR, isPrivate, validateInput, screenInput, extractEntities, fetchRelated, lookupTI, lookupAssets,
    schemas, checkSchema, extractJson, validateAgentOutput, buildMessages, completenessFlags, score, guardrailCheck, summaryCheck,
    validateDecision, authoriseDecision, executeDecision, DECIDABLE, REASON_CODES, CLASS_ORDER };
})();

if (typeof module !== 'undefined') module.exports = SOC;
