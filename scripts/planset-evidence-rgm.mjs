// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-rgm — HIERARCHICAL RELEASE-GATE MODEL rendered-truth harness.
// THE 17 PERMANENT GATES of docs/RELEASE-GATE-MODEL-DIRECTIVE.md.
//
//   Usage: node scripts/planset-evidence-rgm.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = fixture (frozen acceptance fixture)
//                 | insufficient (the SAME design with the Q-Cable procurement
//                   deficit tripped, so the CONFIRMED-CONDITION surfaces — the
//                   cover's most-severe-conflict line and the `strong` treatment
//                   class — are exercised NON-VACUOUSLY)
//                 | identity (the SAME design with the real Braidon project
//                   IDENTITY state — non-production name, no designer of record —
//                   so the ADMINISTRATIVE_HOLD class and gate 8 are non-vacuous)
//
// It regenerates NOTHING and re-derives NOTHING. It reads:
//   • the REAL rendered package HTML,
//   • its PermitDesignSnapshot,
//   • and the CANONICAL model evidence emitted by scripts/rgm-model-evidence.ts
//     (exportReleaseGateEvidence + verifyReleaseGateModel + the §10 anti-vacuity
//     probe set), which it spawns itself.
// Every gate compares a RENDERED claim to the canonical object that produced it.
//
// FAILS CLOSED: exit 2 on any violation.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const [htmlPath, snapPath, outPath = 'braidon-rgm.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) {
  console.error('usage: planset-evidence-rgm.mjs <html> <snapshot.json> [out]');
  process.exit(1);
}
const MODE = ['insufficient', 'identity'].includes(process.env.EVIDENCE_MODE) ? process.env.EVIDENCE_MODE : 'fixture';
const repoRoot = process.cwd();

const rawHtml = fs.readFileSync(htmlPath, 'utf8');
// Value scans run on a COMMENT-STRIPPED, base64-stripped copy: a comment that
// DOCUMENTS a retired claim, and a byte inside an embedded datasheet image, must
// never be read as a live rendered claim.
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const noB64 = html.replace(/data:image[^"')]+/g, '');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const meta = snap.meta || {};
const pr = snap.permitReadiness || {};
const pa = snap.projectAuthority || null;
const registry = (pr.registry ?? []).filter(r => !r.resolved);

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&nbsp;/g, ' ')
  .replace(/&middot;/g, '·').replace(/&sect;/g, '§');
const text = (h) => decode(String(h).replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/data:image[^"')]+/g, ' ')
  .replace(/<\/(td|th|div|p|li|span|strong|em|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ');
const flat = (h) => text(h).replace(/\s+/g, ' ');

// ── sheet split (the SHEET wrapper only) ────────────────────────────────────
const pages = rawHtml.split(/<div class="page(?=[ "])/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);
const stripComments = (p) => p.replace(/<!--[\s\S]*?-->/g, '');
const rsSheetIds = sheetIds.filter(id => /^RS-1/.test(id));
const rs = pages.map(stripComments).filter((p, i) => /^RS-1/.test(sheetIds[i])).join('\n');
const rsPrimary = pages.map(stripComments).filter((p, i) => sheetIds[i] === 'RS-1').join('\n');
const cover = pages.map(stripComments).filter((p, i) => sheetIds[i] === 'PV-0').join('\n');

// ── the CANONICAL model evidence (spawned, never re-derived here) ───────────
const modelEvidencePath = path.join(os.tmpdir(), `rgm-model-evidence-${process.pid}.json`);
const spawnModel = spawnSync('npx', ['tsx', 'scripts/rgm-model-evidence.ts', snapPath, modelEvidencePath],
  { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32', timeout: 300000 });
if (spawnModel.status !== 0 || !fs.existsSync(modelEvidencePath)) {
  console.error('[rgm-evidence] rgm-model-evidence.ts FAILED — cannot evaluate the gates');
  console.error((spawnModel.stderr || spawnModel.stdout || '').split('\n').filter(l => l.includes('rgm-model-evidence')).join('\n'));
  process.exit(2);
}
const ME = JSON.parse(fs.readFileSync(modelEvidencePath, 'utf8'));
const EV = ME.releaseGateEvidence;
const GATES = EV.releaseGates;
const REQS = EV.releaseRequirements;
const SUMMARY = EV.releaseSummary;
const ROOT_GATES = GATES.filter(g => g.gateCategory !== 'UNMAPPED');
const EXPECTED_GATE_IDS = ['RG-1', 'RG-2', 'RG-3', 'RG-4', 'RG-5', 'RG-6', 'RG-7'];
const EXPECTED_GATE_CODES = [
  'PROJECT_AND_AHJ_AUTHORITY', 'EQUIPMENT_RECONCILIATION', 'ENVIRONMENTAL_LOAD_AUTHORITY',
  'STRUCTURAL_ASSEMBLY_AUTHORITY', 'ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE',
  'QCABLE_SYSTEM_CLOSURE', 'PROFESSIONAL_RELEASE',
];

const gates = [];
const gate = (num, id, ok, detail, evidence) => {
  gates.push({ gate: num, id, ok: !!ok, detail: detail ?? null, evidence: evidence ?? null });
  return !!ok;
};
const vacuous = [];

// ── rendered extraction ─────────────────────────────────────────────────────
/** rendered requirement rows: code · findingType · treatment · status · gate. */
const renderedRows = [...rs.matchAll(
  /<tr data-release-requirement="([^"]+)"\s+data-finding-type="([^"]+)"\s*\n?\s*data-finding-treatment="([^"]+)"\s+data-requirement-status="([^"]+)"\s+data-release-gate="([^"]+)"/g)]
  .map(m => ({ code: m[1], findingType: m[2], treatment: m[3], status: m[4], gateId: m[5] }));
/** rendered ROOT-GATE table rows (RS-1 only — the table leads the sheet). */
const renderedGateRows = [...rsPrimary.matchAll(
  /<tr data-release-gate="(RG-[^"]+)" data-release-gate-status="([^"]+)"[\s\S]*?data-release-gate-unresolved="(\d+)"[\s\S]*?>\s*(\d+)<span[^>]*> of (\d+)</g)]
  .map(m => ({ gateId: m[1], status: m[2], unresolvedAttr: Number(m[3]), unresolved: Number(m[4]), total: Number(m[5]) }));
/** rendered gate GROUP bands (one per gate section, may repeat on continuations). */
const renderedGroups = [...rs.matchAll(/data-release-gate-group="(RG-[^"]+)"/g)].map(m => m[1]);
const num = (src, attr) => Number((src.match(new RegExp(`${attr}="(\\d+)"`)) ?? [])[1] ?? NaN);
const rsHeadlineGates = Number((rs.match(/(\d+)\s+OPEN RELEASE GATE/) ?? [])[1] ?? NaN);
const rsHeadlineReqs = Number((rs.match(/(\d+)\s+UNRESOLVED REQUIREMENT/) ?? [])[1] ?? NaN);
const rsGateCount = num(rs, 'data-release-open-gate-count');
const rsReqCount = num(rs, 'data-release-requirement-count');
const rsAdvCount = num(rs, 'data-release-advisory-count');
const coverGateCount = num(cover, 'data-release-open-gate-count');
const coverReqCount = num(cover, 'data-release-requirement-count');
const coverListedGates = [...cover.matchAll(/data-release-open-gate="(RG-[^"]+)"/g)].map(m => m[1]);
const coverHeadlineGates = Number((cover.match(/(\d+)\s+OPEN RELEASE GATE/) ?? [])[1] ?? NaN);
const coverHeadlineReqs = Number((cover.match(/(\d+)\s+UNRESOLVED REQUIREMENT/) ?? [])[1] ?? NaN);

const ms = (xs) => [...xs].sort();
const eqMs = (a, b) => JSON.stringify(ms(a)) === JSON.stringify(ms(b));

// ═══ GATE 1 — every active blocker becomes exactly ONE requirement ══════════
{
  const registryCodes = registry.map(r => r.code);
  const renderedCodes = renderedRows.map(r => r.code);
  const modelOpen = REQS.filter(q => q.status === 'OPEN').map(q => q.requirementCode);
  const dupes = renderedCodes.filter((c, i) => renderedCodes.indexOf(c) !== i && registryCodes.filter(x => x === c).length < renderedCodes.filter(x => x === c).length);
  gate(1, 'every-active-blocker-is-exactly-one-requirement',
    eqMs(registryCodes, renderedCodes) && eqMs(registryCodes, modelOpen)
    && ME.requirementMultisetReconciliation.equal && dupes.length === 0,
    `registry=${registryCodes.length} rendered=${renderedCodes.length} model=${modelOpen.length} `
    + `multisetEqual=${ME.requirementMultisetReconciliation.equal} duplicatedRenders=${dupes.length}`,
    { missingFromRender: registryCodes.filter(c => !renderedCodes.includes(c)),
      extraOnRender: renderedCodes.filter(c => !registryCodes.includes(c)) });
}

// ═══ GATE 2 — exactly ONE primary gate per requirement ══════════════════════
{
  const bad = [];
  for (const row of renderedRows) {
    const declared = EV.requirementToGateMap[row.code];
    if (!declared) { bad.push(`${row.code}: undeclared in the canonical map`); continue; }
    if (declared.gateId !== row.gateId) bad.push(`${row.code}: rendered under ${row.gateId}, canonical ${declared.gateId}`);
    const gatesClaiming = GATES.filter(g => g.requirementCodes.includes(row.code)).map(g => g.gateId);
    if (new Set(gatesClaiming).size !== 1) bad.push(`${row.code}: claimed by ${gatesClaiming.join(',') || 'none'}`);
  }
  gate(2, 'exactly-one-primary-gate-per-requirement',
    bad.length === 0 && ME.verification.ok,
    `rows=${renderedRows.length} violations=${bad.length} modelVerification=${ME.verification.ok}`, { bad });
}

// ═══ GATE 3 — the SEVEN expected root gates render, in canonical order ══════
{
  const renderedIds = renderedGateRows.map(g => g.gateId);
  const modelCodes = ROOT_GATES.map(g => g.gateCode);
  const unmappedRendered = renderedIds.filter(id => id === 'RG-UNMAPPED');
  gate(3, 'the-seven-expected-root-gates-render',
    JSON.stringify(renderedIds) === JSON.stringify(EXPECTED_GATE_IDS)
    && JSON.stringify(modelCodes) === JSON.stringify(EXPECTED_GATE_CODES)
    && unmappedRendered.length === 0,
    `renderedGateRows=[${renderedIds.join(', ')}] modelCodes=${modelCodes.length} unmappedRendered=${unmappedRendered.length}`);
}

// ═══ GATE 4 — the fixture renders <gates>/<requirements>/<advisories> ═══════
// The frozen fixture carries 15 of the directive's 19 Braidon requirements
// (PROJECT-NAME-NONPRODUCTION, EQUIPMENT-IDENTITY-CONFLICT, DESIGNER-OF-RECORD-
// MISSING and — in fixture mode — QCABLE-PROCUREMENT-INSUFFICIENT do not fire on
// it). The gate therefore asserts (a) the RENDERED counts equal the registry and
// the model exactly, and (b) NON-VACUOUSLY that the directive's own 19-code
// Braidon condition produces 7 / 19 / 0 with the 3-2-1-6-3-2-2 distribution —
// checked by the model-evidence probe, so the expected table is never assumed.
{
  const blocking = registry.filter(r => r.severity === 'blocking').length;
  const advisory = registry.length - blocking;
  const braidonProbe = ME.antiVacuity.probes.find(p => p.id === 'all-seven-gates-open-3-2-1-6-3-2-2');
  gate(4, 'rendered-counts-equal-the-model-and-the-registry',
    rsHeadlineGates === SUMMARY.openGateCount && rsHeadlineReqs === SUMMARY.unresolvedRequirementCount
    && rsReqCount === blocking && rsAdvCount === advisory
    && SUMMARY.unresolvedRequirementCount === blocking && SUMMARY.advisoryCount === advisory
    && !!braidonProbe?.ok,
    `rendered ${rsHeadlineGates} gates / ${rsHeadlineReqs} requirements / ${rsAdvCount} advisories · `
    + `registry ${blocking} blocking / ${advisory} advisory · directive 19-code probe=${braidonProbe?.ok} (${braidonProbe?.detail})`);
  if (blocking !== 19) vacuous.push(`gate 4 (this input carries ${blocking} of the directive's 19 Braidon requirements; the 19-code condition is covered by the model probe)`);
}

// ═══ GATE 5 — gate child counts total the requirement count ════════════════
{
  const bad = [];
  let sum = 0;
  for (const gr of renderedGateRows) {
    const model = GATES.find(g => g.gateId === gr.gateId);
    if (!model) { bad.push(`${gr.gateId}: not in the model`); continue; }
    if (gr.unresolved !== model.unresolvedCount || gr.unresolvedAttr !== model.unresolvedCount) {
      bad.push(`${gr.gateId}: rendered unresolved ${gr.unresolved}/${gr.unresolvedAttr} ≠ model ${model.unresolvedCount}`);
    }
    if (gr.total !== model.totalRequirementCount) bad.push(`${gr.gateId}: rendered total ${gr.total} ≠ model ${model.totalRequirementCount}`);
    const renderedChildren = renderedRows.filter(r => r.gateId === gr.gateId).length;
    if (renderedChildren !== model.unresolvedCount) {
      bad.push(`${gr.gateId}: ${renderedChildren} child rows rendered vs ${model.unresolvedCount} unresolved`);
    }
    sum += gr.unresolved;
  }
  gate(5, 'gate-child-counts-total-the-requirement-count',
    bad.length === 0 && sum === renderedRows.length && sum === rsHeadlineReqs + SUMMARY.advisoryCount,
    `Σ rendered gate children=${sum} rows=${renderedRows.length} headline=${rsHeadlineReqs} violations=${bad.length}`, { bad });
}

// ═══ GATE 6 — no silent suppression ════════════════════════════════════════
{
  const missingCodes = registry.map(r => r.code).filter(c => !rs.includes(c));
  const missingText = registry.filter(r => !flat(rs).includes(flat(r.resolutionAction).slice(0, 60)));
  const gatesWithOpen = GATES.filter(g => g.unresolvedCount > 0).map(g => g.gateId);
  const missingGroups = gatesWithOpen.filter(id => !renderedGroups.includes(id));
  gate(6, 'no-silent-suppression-every-requirement-and-gate-renders',
    missingCodes.length === 0 && missingGroups.length === 0 && missingText.length === 0,
    `registry=${registry.length} missingCodes=${missingCodes.length} missingResolutionText=${missingText.length} `
    + `openGates=${gatesWithOpen.length} missingGroups=${missingGroups.length}`,
    { missingCodes, missingGroups, missingResolutionFor: missingText.map(r => r.code) });
}

// ═══ GATE 7 — no double count ══════════════════════════════════════════════
{
  const perCodeRendered = {};
  for (const r of renderedRows) perCodeRendered[r.code] = (perCodeRendered[r.code] ?? 0) + 1;
  const perCodeRegistry = {};
  for (const r of registry) perCodeRegistry[r.code] = (perCodeRegistry[r.code] ?? 0) + 1;
  const bad = Object.keys({ ...perCodeRendered, ...perCodeRegistry })
    .filter(c => (perCodeRendered[c] ?? 0) !== (perCodeRegistry[c] ?? 0));
  // a requirement may appear in exactly ONE gate group; a repeated group band is
  // a continuation, which must not repeat its rows.
  const groupDupes = renderedGroups.filter((g, i) => renderedGroups.indexOf(g) !== i);
  const rowsInDupedGroups = groupDupes.flatMap(g => renderedRows.filter(r => r.gateId === g).map(r => r.code));
  gate(7, 'no-requirement-is-counted-or-rendered-twice',
    bad.length === 0 && new Set(rowsInDupedGroups).size === rowsInDupedGroups.length,
    `codesWithCountMismatch=${bad.length} continuationGroups=${groupDupes.length} duplicatedRowsInContinuations=${rowsInDupedGroups.length - new Set(rowsInDupedGroups).size}`,
    { bad });
}

// ── §7 condition-semantics vocabulary (gates 8-10) ──────────────────────────
// CLASS predicates, never phrase lists: any assertion that a condition FAILED /
// was EXCEEDED / is NON-COMPLIANT inside a row whose finding type is a workflow
// or pending-authority condition is a violation.
const FAILURE_CLASS = /\b(failed|failure|fails|exceeded|exceeds|non-?compliant|does not comply|violation|rejected|unsafe|defective|inadequate)\b/i;
/** the rendered text of ONE requirement row. */
const rowText = (code) => {
  const idx = rs.indexOf(`data-release-requirement="${code}"`);
  if (idx < 0) return '';
  const end = rs.indexOf('</tr>', idx);
  return flat(rs.slice(idx, end < 0 ? idx + 4000 : end));
};
const rowsOfType = (t) => renderedRows.filter(r => r.findingType === t);
const semanticCheck = (types, expectedTreatment) => {
  const bad = [];
  for (const t of types) {
    for (const row of rowsOfType(t)) {
      if (row.treatment !== expectedTreatment) bad.push(`${row.code}: treatment ${row.treatment} ≠ ${expectedTreatment}`);
      const txt = rowText(row.code);
      const hit = txt.match(FAILURE_CLASS);
      // the registry's OWN canonical explanation is authoritative: a violation is
      // only counted when the FAILURE vocabulary is renderer-added, i.e. not
      // present in the canonical explanation / resolution text for that record.
      const canonical = registry.filter(r => r.code === row.code)
        .map(r => `${r.explanation} ${r.resolutionAction}`).join(' ');
      if (hit && !FAILURE_CLASS.test(canonical)) bad.push(`${row.code}: renderer-added failure wording "${hit[0]}"`);
    }
  }
  return bad;
};

// ═══ GATE 8 — administrative holds are not labelled engineering failures ═══
{
  const bad = semanticCheck(['ADMINISTRATIVE_HOLD'], 'administrative');
  const rows = rowsOfType('ADMINISTRATIVE_HOLD');
  for (const r of rows) {
    if (!rowText(r.code).includes('ADMINISTRATIVE HOLD')) bad.push(`${r.code}: no ADMINISTRATIVE HOLD label rendered`);
  }
  gate(8, 'administrative-holds-are-not-engineering-failures',
    bad.length === 0, `administrativeRows=${rows.length} violations=${bad.length}`, { bad });
  if (!rows.length) vacuous.push('gate 8 (no ADMINISTRATIVE_HOLD requirement active on this input)');
}

// ═══ GATE 9 — professional review is not a technical defect ════════════════
{
  const bad = semanticCheck(['PROFESSIONAL_RELEASE'], 'review-workflow');
  const rows = rowsOfType('PROFESSIONAL_RELEASE');
  for (const r of rows) {
    const txt = rowText(r.code);
    if (!txt.includes('PROFESSIONAL RELEASE')) bad.push(`${r.code}: no PROFESSIONAL RELEASE label rendered`);
  }
  // the RG-7 group must state WORKFLOW, not defect
  const rg7 = flat(rs.slice(rs.indexOf('data-release-gate-group="RG-7"')).slice(0, 1600));
  if (rows.length && !/WORKFLOW/i.test(rg7)) bad.push('RG-7 group does not state that it is a WORKFLOW gate');
  gate(9, 'professional-release-is-not-a-technical-defect',
    bad.length === 0, `professionalRows=${rows.length} violations=${bad.length}`, { bad });
  if (!rows.length) vacuous.push('gate 9 (no PROFESSIONAL_RELEASE requirement active on this input)');
}

// ═══ GATE 10 — pending authority is never a verified failure ═══════════════
{
  const bad = semanticCheck(['PENDING_AUTHORITY', 'PENDING_DOCUMENT', 'PENDING_SELECTION'], 'pending');
  const rows = ['PENDING_AUTHORITY', 'PENDING_DOCUMENT', 'PENDING_SELECTION'].flatMap(rowsOfType);
  for (const r of rows) {
    const txt = rowText(r.code);
    if (!/PENDING (AUTHORITY|DOCUMENT|SELECTION)/.test(txt)) bad.push(`${r.code}: no PENDING label rendered`);
  }
  // the §7-mandated code, when active, must never be a VERIFIED DEFICIENCY
  for (const code of ['RACKING-CAPACITY-SOURCE-NOT-ARCHIVED']) {
    const row = renderedRows.find(r => r.code === code);
    if (row && (row.findingType !== 'PENDING_DOCUMENT' || row.treatment !== 'pending')) {
      bad.push(`${code}: rendered as ${row.findingType}/${row.treatment} — capacity is NOT YET ESTABLISHED, not failed`);
    }
  }
  gate(10, 'pending-authority-is-never-a-verified-failure',
    bad.length === 0, `pendingRows=${rows.length} violations=${bad.length}`, { bad });
  if (!rows.length) vacuous.push('gate 10 (no PENDING_* requirement active on this input)');
}

// ═══ GATE 11 — RS-1 counts == COVER counts ═════════════════════════════════
{
  const ok = coverGateCount === rsGateCount && coverReqCount === rsReqCount
    && coverHeadlineGates === rsHeadlineGates && coverHeadlineReqs === rsHeadlineReqs
    && coverListedGates.length === SUMMARY.openGateCount
    && JSON.stringify(coverListedGates) === JSON.stringify(GATES.filter(g => g.status === 'OPEN').map(g => g.gateId))
    && new RegExp(`SEE RS-1 FOR ALL ${SUMMARY.unresolvedRequirementCount + SUMMARY.advisoryCount} REQUIREMENT`).test(flat(cover));
  gate(11, 'cover-and-rs1-state-the-same-gate-and-requirement-counts', ok,
    `cover ${coverGateCount} gates / ${coverReqCount} requirements (listed ${coverListedGates.length}) · `
    + `rs1 ${rsGateCount} / ${rsReqCount} · model ${SUMMARY.openGateCount} / ${SUMMARY.unresolvedRequirementCount}`,
    { coverListedGates });
}

// ═══ GATE 12 — issue-state readiness matches the gate impacts ══════════════
{
  const st = String(pa?.issueState ?? '').toUpperCase();
  const claimsRelease = st === 'PERMIT-READY' || st === 'ISSUED FOR PERMIT';
  const p = EV.issueStatePredicates;
  const renderedIssue = flat(rs).match(/Derived issue state:\s*([A-Z0-9 \-/]+)/i);
  const ok = ME.verification.ok
    && (SUMMARY.openGateCount === 0 || !claimsRelease)
    && SUMMARY.permitReady === (pr.ready === true || SUMMARY.openGateCount === 0 ? SUMMARY.permitReady : false)
    && (SUMMARY.openGateCount === 0 || (p.designReview === true && p.readyForPermitSubmission === false))
    && (SUMMARY.openGateCount === 0 || pr.ready === false)
    && !!renderedIssue
    && (SUMMARY.openGateCount === 0 || !/NOT FOR PERMIT SUBMISSION/.test(flat(noB64)) === false);
  gate(12, 'issue-state-readiness-matches-the-gate-impacts', ok,
    `issueState=${pa?.issueState ?? '—'} ready=${pr.ready} permitReady=${SUMMARY.permitReady} `
    + `predicates designReview=${p.designReview} readyForEngineeringReview=${p.readyForEngineeringReview} `
    + `readyForPermitSubmission=${p.readyForPermitSubmission} renderedIssueState="${renderedIssue?.[1]?.trim() ?? 'MISSING'}"`,
    { readinessAxes: EV.readinessAxes });
}

// ═══ GATE 13 — the EVIDENCE equals the RENDERED HTML ═══════════════════════
{
  const mismatches = [];
  const ROLE_LABEL = { operator: 'OPERATOR', designer: 'DESIGNER', 'engineer-of-record': 'ENGINEER OF RECORD', admin: 'ADMINISTRATOR' };
  // gate table: status · counts · role · primary resolution
  const gateRowText = (id) => {
    const i = rsPrimary.indexOf(`data-release-gate="${id}" data-release-gate-status=`);
    if (i < 0) return '';
    const end = rsPrimary.indexOf('</tr>', i);
    return flat(rsPrimary.slice(i, end < 0 ? i + 4000 : end));
  };
  for (const g of ROOT_GATES) {
    const t = gateRowText(g.gateId);
    if (!t) { mismatches.push({ name: `gate-row:${g.gateId}`, canonical: 'rendered row', rendered: 'MISSING' }); continue; }
    const rendered = renderedGateRows.find(r => r.gateId === g.gateId);
    if (!rendered || rendered.status !== g.status) mismatches.push({ name: `gate-status:${g.gateId}`, canonical: g.status, rendered: rendered?.status ?? null });
    if (!t.includes(ROLE_LABEL[g.responsibleRole] ?? g.responsibleRole)) mismatches.push({ name: `gate-role:${g.gateId}`, canonical: g.responsibleRole, rendered: t.slice(0, 160) });
    if (g.status === 'OPEN' && g.primaryResolutionAction) {
      const probe = flat(g.primaryResolutionAction).slice(0, 50);
      if (!t.includes(probe)) mismatches.push({ name: `gate-primary-resolution:${g.gateId}`, canonical: probe, rendered: t.slice(0, 200) });
    }
  }
  // requirement rows: finding type · status · gate · authority path · title
  for (const q of REQS.filter(x => x.status === 'OPEN')) {
    const row = renderedRows.find(r => r.code === q.requirementCode);
    if (!row) { mismatches.push({ name: `req-row:${q.requirementCode}`, canonical: 'rendered', rendered: 'MISSING' }); continue; }
    if (row.findingType !== q.findingType) mismatches.push({ name: `req-finding:${q.requirementCode}`, canonical: q.findingType, rendered: row.findingType });
    if (row.status !== q.status) mismatches.push({ name: `req-status:${q.requirementCode}`, canonical: q.status, rendered: row.status });
    if (row.gateId !== q.gateId) mismatches.push({ name: `req-gate:${q.requirementCode}`, canonical: q.gateId, rendered: row.gateId });
    const t = rowText(q.requirementCode);
    if (q.authorityPath && !t.includes(q.authorityPath)) mismatches.push({ name: `req-authority:${q.requirementCode}`, canonical: q.authorityPath, rendered: t.slice(0, 200) });
    if (q.title && !t.includes(flat(q.title).slice(0, 40))) mismatches.push({ name: `req-title:${q.requirementCode}`, canonical: q.title, rendered: t.slice(0, 200) });
    if (q.evidenceReferences.length && !t.includes(q.evidenceReferences[0])) mismatches.push({ name: `req-evidence:${q.requirementCode}`, canonical: q.evidenceReferences[0], rendered: t.slice(0, 240) });
  }
  gate(13, 'evidence-equals-rendered-zero-mismatches', mismatches.length === 0,
    `${mismatches.length} mismatch(es) across ${ROOT_GATES.length} gate rows + ${renderedRows.length} requirement rows`,
    { mismatches: mismatches.slice(0, 25) });
}

// ═══ GATE 14 — snapshot ID + digest identical on EVERY sheet ═══════════════
{
  const ids = [...rawHtml.matchAll(/data-project-field="snapshot-id">([^<]*)</g)].map(m => m[1].trim());
  const digs = [...rawHtml.matchAll(/data-project-field="digest">([^<]*)</g)].map(m => m[1].trim());
  const idBad = ids.filter(v => v !== meta.snapshotId).length;
  const digBad = digs.filter(v => !String(meta.digest || '').startsWith(v)).length;
  const manifest = (pa?.sheetIndex ?? []).map(s => s.id);
  gate(14, 'snapshot-identity-identical-across-all-sheets',
    ids.length === pages.length && digs.length === pages.length && idBad === 0 && digBad === 0
    && manifest.length === pages.length && JSON.stringify(manifest) === JSON.stringify(sheetIds),
    `sheets=${pages.length} withId=${ids.length} withDigest=${digs.length} idMismatch=${idBad} digestMismatch=${digBad} `
    + `manifest=${manifest.length} manifestEqPages=${JSON.stringify(manifest) === JSON.stringify(sheetIds)} snapshot=${meta.snapshotId}`);
}

// ═══ GATES 15 + 16 — page fit: RS sheets in bounds; H+V clipping zero ══════
const pagefit = spawnSync('node', ['scripts/planset-pagefit.mjs', htmlPath, '--json',
  path.join(os.tmpdir(), `rgm-pagefit-${process.pid}.json`)],
  { cwd: repoRoot, encoding: 'utf8', timeout: 300000 });
const pfOut = `${pagefit.stdout ?? ''}${pagefit.stderr ?? ''}`;
const pfSummary = (pfOut.match(/\[pagefit\][^\n]*sheets=[^\n]*/) ?? [''])[0].trim();
const pfNum = (k) => Number((pfSummary.match(new RegExp(`${k}=(\\d+)`)) ?? [])[1] ?? NaN);
{
  // RS-specific: no RS sheet may appear in the clip report
  const rsClipped = rsSheetIds.filter(id => new RegExp(`\\b${id.replace('.', '\\.')}\\b[^\\n]*CLIP`).test(pfOut));
  gate(15, 'rs1-and-its-continuations-fit-the-printable-page',
    pagefit.status === 0 && rsClipped.length === 0 && rsSheetIds.length >= 1,
    `rsSheets=[${rsSheetIds.join(', ')}] clipped=[${rsClipped.join(', ') || 'none'}] pagefitExit=${pagefit.status}`);
}
{
  gate(16, 'page-fit-horizontal-and-vertical-clipping-zero',
    pagefit.status === 0 && pfNum('clipped') === 0 && pfNum('internal-clipped') === 0
    && pfNum('clipped-h') === 0 && pfNum('internal-clipped-h') === 0,
    `pagefit exit=${pagefit.status} · ${pfSummary}`);
}

// ═══ GATE 17 — BLACK-AND-WHITE LEGIBILITY of the treatment classes ═════════
// A permit set is printed and photocopied in monochrome, so the finding-type
// treatments may not be carried by HUE. Each rendered class is reduced to its
// hue-free signature — border WIDTH, border STYLE, font WEIGHT, font STYLE, text
// DECORATION, letter SPACING and fill LUMINANCE — and every pair of classes must
// differ in at least TWO of those channels. Colour values are converted to
// luminance before comparison, so two classes that differ only in hue FAIL.
{
  const chips = [...rs.matchAll(/<span data-finding-treatment="([^"]+)" style="([^"]*)"/g)]
    .map(m => ({ cls: m[1], style: m[2] }));
  const lum = (hex) => {
    const h = String(hex).replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    return Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * 1000) / 1000;
  };
  const pick = (style, prop) => (style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`)) ?? [])[1]?.trim() ?? null;
  const signatures = {};
  for (const c of chips) {
    const border = pick(c.style, 'border-left') ?? '';
    const [w, st, col] = border.split(/\s+/);
    signatures[c.cls] = {
      borderWidth: w ?? null,
      borderStyle: st ?? null,
      borderLuminance: lum(col),
      fontWeight: pick(c.style, 'font-weight'),
      fontStyle: pick(c.style, 'font-style'),
      textDecoration: pick(c.style, 'text-decoration'),
      letterSpacing: pick(c.style, 'letter-spacing'),
      fillLuminance: lum(pick(c.style, 'background')),
    };
  }
  const channels = ['borderWidth', 'borderStyle', 'fontWeight', 'fontStyle', 'textDecoration', 'letterSpacing', 'fillLuminance'];
  // NON-VACUITY: the pairwise check runs over ALL SEVEN DECLARED classes (the
  // canonical table emitted by rgm-model-evidence), not merely the classes this
  // one input happens to render — a package with three active finding types must
  // still prove the whole treatment system is monochrome-distinguishable.
  const declaredTable = (ME.findingTreatments?.classes ?? []).concat(
    ME.findingTreatments?.rootGate ? [ME.findingTreatments.rootGate] : []);
  const declaredSignatures = {};
  for (const t of declaredTable) {
    declaredSignatures[t.cls] = {
      borderWidth: t.borderWidth, borderStyle: t.borderStyle, borderLuminance: lum(t.borderColor),
      fontWeight: t.chipWeight, fontStyle: t.chipStyle, textDecoration: t.chipDecoration,
      letterSpacing: t.chipSpacing, fillLuminance: lum(t.fill),
    };
  }
  const declared = Object.keys(declaredSignatures);
  const collisions = [];
  for (let i = 0; i < declared.length; i++) {
    for (let j = i + 1; j < declared.length; j++) {
      const a = declaredSignatures[declared[i]], b = declaredSignatures[declared[j]];
      const differing = channels.filter(k => String(a[k]) !== String(b[k]));
      if (differing.length < 2) collisions.push(`${declared[i]} vs ${declared[j]}: only [${differing.join(', ')}]`);
    }
  }
  const classes = Object.keys(signatures);
  // every RENDERED class must be a declared one, and must render the signature
  // its declaration states (no renderer-local restyling of a treatment).
  const undeclared = classes.filter(c => !declared.includes(c));
  for (const c of classes) {
    const d = declaredSignatures[c];
    if (!d) continue;
    const drift = channels.filter(k => String(signatures[c][k]) !== String(d[k]));
    if (drift.length) collisions.push(`${c}: rendered signature drifts from the declaration in [${drift.join(', ')}]`);
  }
  if (declared.length !== 7) collisions.push(`expected 7 declared treatment classes, found ${declared.length}`);
  // grayscale render (visual artefact + a rendering probe that the desaturated
  // page still contains the distinguishing border rules)
  const grayDir = process.env.RGM_GRAYSCALE_DIR ?? null;
  let grayNote = 'not requested';
  if (grayDir) {
    const shot = spawnSync('node', ['scripts/rgm-grayscale-shot.mjs', htmlPath, grayDir],
      { cwd: repoRoot, encoding: 'utf8', timeout: 300000 });
    grayNote = shot.status === 0 ? `written to ${grayDir}` : `FAILED (${(shot.stderr || '').split('\n')[0]})`;
  }
  gate(17, 'black-and-white-legibility-of-the-finding-type-treatments',
    classes.length >= 2 && collisions.length === 0 && undeclared.length === 0 && declared.length === 7,
    `declaredClasses=[${declared.join(', ')}] pairsChecked=${declared.length * (declared.length - 1) / 2} `
    + `renderedClasses=[${classes.join(', ')}] collisions=${collisions.length} undeclared=${undeclared.length} grayscale=${grayNote}`,
    { declaredSignatures, renderedSignatures: signatures, collisions });
}

// ═══════════════════════════════════════════════════════════════════════════
const failed = gates.filter(g => !g.ok);
const report = {
  harness: 'planset-evidence-rgm',
  directive: 'docs/RELEASE-GATE-MODEL-DIRECTIVE.md',
  mode: MODE,
  html: path.resolve(htmlPath),
  snapshotId: meta.snapshotId, digest: meta.digest,
  sheetCount: pages.length, sheetIds, reviewStatusSheets: rsSheetIds,
  // §10 evidence blocks, verbatim from the canonical model
  releaseSummary: SUMMARY,
  releaseGates: GATES,
  releaseRequirements: REQS,
  requirementToGateMap: EV.requirementToGateMap,
  readinessAxes: EV.readinessAxes,
  issueStatePredicates: EV.issueStatePredicates,
  gateRollup: EV.gateRollup,
  headline: EV.headline,
  modelVerification: ME.verification,
  requirementMultisetReconciliation: ME.requirementMultisetReconciliation,
  antiVacuity: ME.antiVacuity,
  rendered: {
    rs1HeadlineGates: rsHeadlineGates, rs1HeadlineRequirements: rsHeadlineReqs,
    rs1GateCount: rsGateCount, rs1RequirementCount: rsReqCount, rs1AdvisoryCount: rsAdvCount,
    coverGateCount, coverRequirementCount: coverReqCount, coverListedGates,
    requirementRows: renderedRows, gateRows: renderedGateRows,
  },
  gates,
  vacuityNotes: vacuous,
  pass: failed.length === 0,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
const tag = `[rgm-evidence:${MODE}]`;
console.log(`${tag} ${outPath} — snapshot ${meta.snapshotId} (${pages.length} sheets, `
  + `${SUMMARY.openGateCount} gates / ${SUMMARY.unresolvedRequirementCount} requirements)`);
for (const g of gates) {
  console.log(`${tag} ${g.ok ? 'PASS' : 'FAIL'} gate ${String(g.gate).padStart(2)} ${g.id} — ${g.detail}`);
  if (!g.ok && g.evidence) console.log(`${tag}      ${JSON.stringify(g.evidence).slice(0, 1400)}`);
}
if (vacuous.length) console.log(`${tag} vacuity notes: ${vacuous.join(' · ')}`);
if (!ME.antiVacuity.ok) console.error(`${tag} ANTI-VACUITY PROBE FAILURE`);
console.log(`${tag} ${gates.length - failed.length}/${gates.length} gates pass`);
process.exit(failed.length === 0 && ME.antiVacuity.ok && ME.verification.ok ? 0 : 2);
