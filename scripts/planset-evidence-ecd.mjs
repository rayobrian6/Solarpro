// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-ecd — THE 24 FINAL SOFTWARE-CLOSURE GATES.
// docs/ENGINE-CLOSURE-DIRECTIVE.md §12.
//
//   Usage: node scripts/planset-evidence-ecd.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = fixture | insufficient | identity
//     • fixture      — the frozen acceptance fixture (15 requirements)
//     • insufficient — the SAME design with the documented, clearly-synthetic
//                      service-loop allowance threaded in, so the Q-Cable
//                      procurement DEFICIT fires (16 requirements) and the
//                      trunk-cable row moves out of the orderable population.
//                      Gates 8/9/17/18/19 are non-vacuous only here.
//     • identity     — the SAME design with the real Braidon project IDENTITY
//                      state (non-production name, no designer of record), 17
//                      requirements. This is the mode used for the live-only
//                      operator-entered conditions: the frozen fixture cannot
//                      carry EQUIPMENT-IDENTITY-CONFLICT (a DB condition, and
//                      operator-only by standing rule), so identity mode is the
//                      closest reproducible approximation of the live 19-code
//                      package. The relationship is stated in the report.
//
// It regenerates NOTHING. It reads the REAL rendered package HTML, its
// PermitDesignSnapshot, and the CANONICAL model evidence emitted by
// scripts/ecd-model-evidence.ts (which it spawns in the same mode). Every gate
// compares a RENDERED claim to the canonical object that produced it, and every
// gate carries an ANTI-VACUITY probe from the model evidence.
//
// FAILS CLOSED: exit 2 on any violation or any failed probe.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const [htmlPath, snapPath, outPath = 'braidon-ecd.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) {
  console.error('usage: planset-evidence-ecd.mjs <html> <snapshot.json> [out]');
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
  .replace(/&middot;/g, '·').replace(/&sect;/g, '§').replace(/&times;/g, '×')
  .replace(/&deg;/g, '°').replace(/&check;/g, '✓').replace(/&Sigma;/g, 'Σ');
const text = (h) => decode(String(h).replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/data:image[^"')]+/g, ' ')
  .replace(/<\/(td|th|div|p|li|span|strong|em|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ');
const flat = (h) => text(h).replace(/\s+/g, ' ');
const PAGE_TEXT = flat(noB64);

// ── sheet split ─────────────────────────────────────────────────────────────
const pages = rawHtml.split(/<div class="page(?=[ "])/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);
const stripComments = (p) => p.replace(/<!--[\s\S]*?-->/g, '');
const sheetsMatching = (re) => pages.map(stripComments).filter((p, i) => re.test(sheetIds[i])).join('\n');
const sched = sheetsMatching(/^SCHED/);
const rs = sheetsMatching(/^RS-1/);
const rsPrimary = pages.map(stripComments).filter((p, i) => sheetIds[i] === 'RS-1').join('\n');
const cover = pages.map(stripComments).filter((p, i) => sheetIds[i] === 'PV-0').join('\n');
const appA = sheetsMatching(/^APP-A/);
const pv3 = sheetsMatching(/^PV-3/);
const pv5 = sheetsMatching(/^PV-5/);
const e1Sheet = sheetsMatching(/^E-1/);
const pv4b = sheetsMatching(/^PV-4B/);

// ── the CANONICAL model evidence (spawned, never re-derived here) ───────────
const modelPath = path.join(os.tmpdir(), `ecd-model-evidence-${process.pid}.json`);
const modeArgs = MODE === 'insufficient' ? ['--insufficient'] : MODE === 'identity' ? ['--identity'] : [];
const spawnModel = spawnSync('npx', ['tsx', 'scripts/ecd-model-evidence.ts', modelPath, ...modeArgs],
  { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32', timeout: 900000 });
if (spawnModel.status !== 0 || !fs.existsSync(modelPath)) {
  console.error('[ecd-evidence] ecd-model-evidence.ts FAILED — cannot evaluate the gates');
  console.error((spawnModel.stderr || spawnModel.stdout || '').split('\n')
    .filter(l => l.includes('ecd-model-evidence')).join('\n'));
  process.exit(2);
}
const ME = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const AP = ME.approval;
const ROWS = ME.bomRows;
const PROBE = (n) => ME.antiVacuity.probes.find(p => p.gate === n) ?? { ok: false, id: 'MISSING', detail: 'no probe declared for this gate' };

// The model evidence MUST describe the same package this harness is reading.
if (ME.snapshotId !== meta.snapshotId || ME.snapshotDigest !== meta.digest) {
  console.error(`[ecd-evidence] MODEL/PACKAGE MISMATCH — model ${ME.snapshotId}/${String(ME.snapshotDigest).slice(0, 12)} `
    + `vs package ${meta.snapshotId}/${String(meta.digest).slice(0, 12)}. The evidence would describe a different package.`);
  process.exit(2);
}

const gates = [];
const vacuous = [];
const gate = (num, id, ok, detail, evidence) => {
  const p = PROBE(num);
  gates.push({
    gate: num, id, ok: !!ok && p.ok, renderedOk: !!ok,
    antiVacuity: { id: p.id, ok: p.ok, detail: p.detail },
    detail: detail ?? null, evidence: evidence ?? null,
  });
  if (!p.ok) vacuous.push(`gate ${num}: anti-vacuity probe ${p.id} FAILED — ${p.detail}`);
  return !!ok && p.ok;
};

// ── rendered BOM extraction ────────────────────────────────────────────────
/** every rendered row tag: id + state + quantity basis + blocking codes. */
const renderedRows = [...sched.matchAll(
  /data-bom-line-id="([^"]*)" data-bom-authority-state="([^"]*)"(?: data-bom-quantity-source="([^"]*)")?(?: data-bom-blocking-requirements="([^"]*)")?/g)]
  .map(m => ({ id: m[1], state: m[2], quantitySource: m[3] ?? null, blocking: (m[4] ?? '').split(' ').filter(Boolean) }));
/** the rows the TABLE lists (they also carry the orderable/quantity-state projection). */
const tableRows = [...sched.matchAll(
  /data-bom-line-id="([^"]*)" data-bom-authority-state="([^"]*)" data-bom-quantity-source="([^"]*)"/g)]
  .map(m => ({ id: m[1], state: m[2], quantitySource: m[3] }));
const orderableTags = [...sched.matchAll(/data-bom-orderable="(true|false)"/g)].map(m => m[1]);
const num = (src, attr) => Number((String(src).match(new RegExp(`${attr}="(-?\\d+)"`)) ?? [])[1] ?? NaN);
const renderedPopulationTotal = num(sched, 'data-bom-population-total');
const renderedShownHere = [...sched.matchAll(/data-bom-rows-shown-here="(\d+)"/g)].map(m => Number(m[1]));
const renderedScheduledAbove = num(sched, 'data-bom-rows-scheduled-above');
const renderedProcurementTotal = num(sched, 'data-procurement-total');
const renderedProcurementExcluded = num(sched, 'data-procurement-excluded');
const renderedProcurementReady = (sched.match(/data-procurement-ready="(\w+)"/) ?? [])[1] ?? null;
const renderedStateCounts = Object.fromEntries(
  [...sched.matchAll(/data-procurement-state-count="([A-Z_]+)">(\d+)/g)].map(m => [m[1], Number(m[2])]));
const renderedOpenProcurementCodes =
  [...sched.matchAll(/data-procurement-open-requirement="([^"]*)"/g)].map(m => m[1]);

const ms = (xs) => [...xs].sort();
const eqMs = (a, b) => JSON.stringify(ms(a)) === JSON.stringify(ms(b));

// ═══ GATE 1 — BOM total == unique final row IDs ════════════════════════════
{
  const ids = renderedRows.map(r => r.id).filter(Boolean);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  const audit = AP.rowIdAudit;
  gate(1, 'bom-total-equals-the-unique-final-row-ids',
    renderedPopulationTotal === AP.totalRowCount
    && ids.length === AP.totalRowCount && new Set(ids).size === ids.length && dupes.length === 0
    && audit.total === audit.unique && audit.duplicateIds.length === 0 && audit.missingIds === 0
    && eqMs(ids, AP.allRowIds),
    `rendered ids=${ids.length} distinct=${new Set(ids).size} · population total=${renderedPopulationTotal} · `
    + `model total=${AP.totalRowCount} · audit ${audit.unique}/${audit.total} dup=${audit.duplicateIds.length} missing=${audit.missingIds}`,
    { duplicatesRendered: [...new Set(dupes)], missingFromRender: AP.allRowIds.filter(i => !ids.includes(i)) });
}

// ═══ GATE 2 — exactly ONE state per row ════════════════════════════════════
{
  const STATES = ['VERIFIED_ORDERABLE', 'ESTIMATED_FIELD_VERIFY', 'CANDIDATE_NON_ORDERABLE', 'QUANTITY_PENDING', 'EXCLUDED_NOT_APPLICABLE'];
  const byId = new Map();
  const conflicts = [];
  for (const r of renderedRows) {
    if (!STATES.includes(r.state)) { conflicts.push(`${r.id}: rendered state '${r.state}' is not one of the five`); continue; }
    const prev = byId.get(r.id);
    if (prev && prev !== r.state) conflicts.push(`${r.id}: rendered twice with ${prev} and ${r.state}`);
    byId.set(r.id, r.state);
  }
  // the rendered state must equal the CANONICAL record's state for that row
  const modelById = new Map(ROWS.map(r => [r.bomLineId, r.procurement.authorityState]));
  for (const [id, st] of byId) {
    if (modelById.get(id) !== st) conflicts.push(`${id}: rendered ${st}, canonical ${modelById.get(id) ?? 'MISSING'}`);
  }
  // and the legacy boolean projection may never contradict it
  const trueTags = orderableTags.filter(t => t === 'true').length;
  gate(2, 'exactly-one-procurement-state-per-row',
    conflicts.length === 0 && byId.size === AP.totalRowCount
    && ROWS.every(r => STATES.includes(r.procurement.authorityState))
    && trueTags === tableRows.filter(r => r.state === 'VERIFIED_ORDERABLE').length,
    `distinct rendered rows=${byId.size} conflicts=${conflicts.length} · `
    + `data-bom-orderable=true ×${trueTags} vs VERIFIED_ORDERABLE table rows=${tableRows.filter(r => r.state === 'VERIFIED_ORDERABLE').length}`,
    { conflicts: conflicts.slice(0, 20) });
}

// ═══ GATE 3 — the five state counts SUM to the total ═══════════════════════
{
  const sum = AP.verifiedOrderableCount + AP.estimatedFieldVerifyCount + AP.candidateNonOrderableCount
    + AP.quantityPendingCount + AP.excludedCount;
  const renderedSum = Object.values(renderedStateCounts).reduce((a, b) => a + b, 0);
  const renderedMatchesModel = ['VERIFIED_ORDERABLE', 'ESTIMATED_FIELD_VERIFY', 'CANDIDATE_NON_ORDERABLE', 'QUANTITY_PENDING', 'EXCLUDED_NOT_APPLICABLE']
    .every(k => renderedStateCounts[k] === AP.rowIdsByState[k].length);
  gate(3, 'the-five-state-counts-sum-to-the-total',
    AP.countsReconcile && sum === AP.totalRowCount && renderedSum === AP.totalRowCount
    && Object.keys(renderedStateCounts).length === 5 && renderedMatchesModel,
    `model Σ=${sum}/${AP.totalRowCount} reconcile=${AP.countsReconcile} · rendered Σ=${renderedSum} `
    + `(${Object.entries(renderedStateCounts).map(([k, v]) => `${k}=${v}`).join(' ')}) matchesModel=${renderedMatchesModel}`);
}

// ═══ GATE 4 — no double count ══════════════════════════════════════════════
{
  // a row id appears in EXACTLY ONE state bucket, and the table lists it once.
  const bucketOf = {};
  const doubles = [];
  for (const st of Object.keys(AP.rowIdsByState)) {
    for (const id of AP.rowIdsByState[st]) {
      if (bucketOf[id]) doubles.push(`${id}: in ${bucketOf[id]} and ${st}`);
      bucketOf[id] = st;
    }
  }
  const tableIds = tableRows.map(r => r.id);
  const tableDupes = tableIds.filter((v, i) => tableIds.indexOf(v) !== i);
  // the SCHED pagination must not re-render a row on a continuation sheet
  const shownSum = renderedShownHere.reduce((a, b) => a + b, 0);
  gate(4, 'no-row-is-counted-or-rendered-twice',
    doubles.length === 0 && tableDupes.length === 0
    && shownSum === tableIds.length && tableIds.length + renderedScheduledAbove === AP.totalRowCount,
    `state buckets disjoint=${doubles.length === 0} · table rows=${tableIds.length} duplicates=${tableDupes.length} · `
    + `Σ rows-shown-here=${shownSum} + scheduled-above=${renderedScheduledAbove} = ${shownSum + renderedScheduledAbove} of ${AP.totalRowCount}`,
    { doubles, tableDupes: [...new Set(tableDupes)] });
}

// ═══ GATE 5 — no disappearance from evidence / exports ═════════════════════
{
  const exportIds = ME.exports.orderableRowIds;
  const excludedIds = ME.exports.excluded.map(e => e.bomLineId);
  const union = [...exportIds, ...excludedIds];
  const renderedIds = renderedRows.map(r => r.id);
  // every row in the population is rendered somewhere on SCHED (table row or the
  // "scheduled above" id list) AND is in exactly one of the two export artifacts
  const notRendered = AP.allRowIds.filter(id => !renderedIds.includes(id));
  const notInArtifacts = AP.allRowIds.filter(id => !union.includes(id));
  gate(5, 'no-row-disappears-from-the-evidence-or-the-exports',
    notRendered.length === 0 && notInArtifacts.length === 0
    && union.length === AP.totalRowCount && new Set(union).size === union.length
    && eqMs(renderedIds, AP.allRowIds),
    `population=${AP.totalRowCount} · rendered=${renderedIds.length} missing=${notRendered.length} · `
    + `export(${exportIds.length}) + excluded(${excludedIds.length}) = ${union.length} missing=${notInArtifacts.length}`,
    { notRendered, notInArtifacts });
}

// ═══ GATE 6 — estimated route-derived rows are NEVER VERIFIED_ORDERABLE ════
{
  const routeRows = ROWS.filter(r => r.procurement.quantitySource === 'route-derived');
  const bad = routeRows.filter(r => r.procurement.authorityState === 'VERIFIED_ORDERABLE');
  const renderedRoute = renderedRows.filter(r => r.quantitySource === 'route-derived');
  const renderedBad = renderedRoute.filter(r => r.state === 'VERIFIED_ORDERABLE');
  // the rendered cell must carry the FIELD VERIFY label for every estimated row
  const estRendered = renderedRoute.filter(r => r.state === 'ESTIMATED_FIELD_VERIFY').length;
  const fieldVerifyLabels = (flat(sched).match(/EST — FIELD VERIFY/g) ?? []).length;
  gate(6, 'route-derived-estimated-rows-are-never-verified-orderable',
    ME.routeDependency.open && bad.length === 0 && renderedBad.length === 0
    && renderedRoute.length === routeRows.length && fieldVerifyLabels === estRendered,
    `route-derived rows model=${routeRows.length} rendered=${renderedRoute.length} · orderable=${bad.length}/${renderedBad.length} · `
    + `ESTIMATED rendered=${estRendered} with "EST — FIELD VERIFY" labels=${fieldVerifyLabels}`,
    { orderableRouteRows: bad.map(r => r.bomLineId) });
}

// ═══ GATE 7 — the OPEN ROUTE-LENGTH-ESTIMATE affects its dependent rows ════
{
  const code = ME.routeDependency.requirementCode;
  const openInRegistry = registry.some(r => r.code === code);
  const named = ROWS.filter(r => r.procurement.blockingRequirementCodes.includes(code));
  const renderedNamed = renderedRows.filter(r => r.blocking.includes(code));
  // the SCHED summary must list the code among the OPEN procurement-impact codes
  const inSummary = renderedOpenProcurementCodes.includes(code);
  gate(7, 'the-open-route-requirement-affects-and-names-its-dependent-rows',
    openInRegistry && ME.routeDependency.open && named.length > 0
    && renderedNamed.length === named.length && inSummary
    && named.every(r => r.procurement.authorityState !== 'VERIFIED_ORDERABLE')
    && eqMs(renderedOpenProcurementCodes, AP.openProcurementRequirementCodes),
    `${code} in registry=${openInRegistry} · rows naming it model=${named.length} rendered=${renderedNamed.length} · `
    + `in SCHED summary=${inSummary} · summary codes=[${renderedOpenProcurementCodes.join(', ')}]`);
}

// ═══ GATE 8 — Q-CONN non-orderable without a verified selected solution ════
{
  const conn = ME.cableExtension.connectorRows;
  const renderedConn = renderedRows.filter(r => conn.some(c => c.bomLineId === r.id));
  gate(8, 'the-connector-rows-are-non-orderable-without-a-verified-selected-solution',
    conn.length === 2
    && conn.every(c => c.procurement.authorityState === 'CANDIDATE_NON_ORDERABLE' && c.promotion.promoted === false)
    && renderedConn.length === 2 && renderedConn.every(r => r.state === 'CANDIDATE_NON_ORDERABLE')
    && ME.cableExtension.solutions.length === 0
    && conn.every(c => !AP.orderableRowIds.includes(c.bomLineId)),
    `Q-CONN rows=${conn.length} state=${[...new Set(conn.map(c => c.procurement.authorityState))].join('/')} · `
    + `CableExtensionSolutions=${ME.cableExtension.solutions.length} · promotion=${conn.map(c => c.promotion.promoted).join('/')}`,
    { missing: conn.map(c => ({ id: c.bomLineId, missing: c.promotion.missing })) });
}

// ═══ GATE 9 — the connectors never silently resolve the length deficit ════
{
  const conn = ME.cableExtension.connectorRows;
  const tokens = conn.flatMap(c => [c.partNumber, c.bomLineId].filter(Boolean));
  // A raw byte window around the requirement CODE is not the test — the code
  // appears as a machine tag on the trunk-cable row, which sits a few table rows
  // above the connector rows on the SAME schedule, so proximity proves nothing.
  // The claim under test is SEMANTIC: no rendered SENTENCE may state the deficit
  // and name a candidate connector, and nothing may present a connector as the
  // thing that closes it.
  const sentences = PAGE_TEXT.split(/(?<=[.;:])\s+/);
  const deficitSentences = sentences.filter(s =>
    /QCABLE-PROCUREMENT-INSUFFICIENT|procurement (?:length )?(?:deficit|insufficien)|short of|service[- ]loop allowance|additional .{0,30}ft (?:of )?cable/i.test(s));
  const leaked = [];
  for (const s of deficitSentences) {
    for (const t of tokens) if (s.includes(t)) leaked.push(`deficit sentence names ${t}: "${s.slice(0, 200)}"`);
  }
  const resolutionClaim = conn.some(c => new RegExp(
    `${(c.partNumber ?? 'x').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]{0,160}\\b(resolves?|satisfies|makes up|closes the deficit|provides the required length|supplies the (?:missing|additional))\\b`, 'i')
    .test(PAGE_TEXT));
  // …and the AUTHORITY's own resolution options must not name them either: the
  // deficit is closed by a selected CableExtensionSolution, never by a BOM row.
  const ps = snap.electrical?.procurementSufficiency ?? null;
  const optionText = JSON.stringify(ps?.resolutionOptions ?? []) + JSON.stringify(ps?.solutions ?? []);
  const authorityLeak = tokens.filter(t => optionText.includes(t));
  gate(9, 'the-connector-rows-never-resolve-the-length-deficit',
    leaked.length === 0 && !resolutionClaim && authorityLeak.length === 0
    && conn.every(c => c.procurement.authorityState !== 'VERIFIED_ORDERABLE'),
    `deficit sentences scanned=${deficitSentences.length} · sentences naming a connector=${leaked.length} · `
    + `resolution claim=${resolutionClaim} · authority resolution options naming a connector=${authorityLeak.length}`,
    { leaked, authorityLeak });
  if (!deficitSentences.length) vacuous.push('gate 9 (no rendered deficit statement on this input — see insufficient mode)');
}

// ═══ GATE 10 — IPLD350-3 non-orderable without verified compatibility ══════
{
  const tap = ME.supplySideTap.authority;
  const rows = ME.supplySideTap.rows;
  const renderedTap = renderedRows.filter(r => rows.some(t => t.bomLineId === r.id));
  const label = 'CANDIDATE CONNECTOR — VERIFY EXISTING SERVICE CONDUCTOR AND LUG COMPATIBILITY';
  const labelRendered = PAGE_TEXT.includes(label);
  // the retired prose caveat must not reappear as an instruction on the row
  const oldCaveat = /Verify lug range against actual service conductor size/i.test(PAGE_TEXT);
  gate(10, 'the-tap-connector-is-non-orderable-without-verified-compatibility',
    !!tap && tap.verificationStatus !== 'verified'
    && rows.length >= 1 && rows.every(r => r.procurement.authorityState === 'CANDIDATE_NON_ORDERABLE')
    && renderedTap.length === rows.length && renderedTap.every(r => r.state === 'CANDIDATE_NON_ORDERABLE')
    && labelRendered && !oldCaveat
    && rows.every(r => !AP.orderableRowIds.includes(r.bomLineId)),
    `tap authority verification=${tap?.verificationStatus} unresolvedFacts=${tap?.unresolvedFacts?.length} · `
    + `IPLD rows=${rows.length} rendered=${renderedTap.length} all CANDIDATE · mandated label rendered=${labelRendered} · retired caveat present=${oldCaveat}`);
}

// ═══ GATE 11 — physical grounding IDs are unique ═══════════════════════════
{
  const groupId = ME.grounding.groupAuthorityId;
  const renderedIds = [...rawHtml.matchAll(/data-grounding-segment-id="([^"]*)"/g)].map(m => m[1]);
  const renderedKinds = [...rawHtml.matchAll(/data-grounding-identity-kind="([^"]*)"/g)].map(m => m[1]);
  const physicalRendered = renderedIds.filter(id => id !== groupId);
  const branchRendered = [...new Set(physicalRendered.filter(id => /^gnd-br-\d+$/.test(id)))].sort();
  const canonicalPhysical = [
    ...ME.grounding.physical.map(p => p.id),
    ...ME.grounding.e1Sections.map(s => s.groundingSegmentId).filter(Boolean),
  ];
  gate(11, 'physical-grounding-segment-identities-are-unique',
    new Set(canonicalPhysical).size === canonicalPhysical.length
    && branchRendered.length === ME.grounding.canonicalBranchIds.length
    && eqMs(branchRendered, ME.grounding.canonicalBranchIds)
    && renderedKinds.includes('physical-segment') && renderedKinds.includes('group-authority'),
    `canonical physical ids=${canonicalPhysical.length} unique=${new Set(canonicalPhysical).size} · `
    + `rendered distinct branch ids=[${branchRendered.join(', ')}] vs canonical [${ME.grounding.canonicalBranchIds.join(', ')}]`,
    { renderedIdHistogram: renderedIds.reduce((a, i) => ({ ...a, [i]: (a[i] ?? 0) + 1 }), {}) });
}

// ═══ GATE 12 — the grouped authority is never counted as a physical segment ═
{
  const groupId = ME.grounding.groupAuthorityId;
  const physicalIds = ME.grounding.physical.map(p => p.id);
  const e1Ids = ME.grounding.e1Sections.map(s => s.groundingSegmentId).filter(Boolean);
  // the group node renders, and it renders AS a group authority
  const groupTagged = new RegExp(`data-grounding-segment-id="${groupId}"[^>]*data-grounding-identity-kind="group-authority"`)
    .test(rawHtml.replace(/\n\s*/g, ' '))
    || (rawHtml.includes(`data-grounding-segment-id="${groupId}"`) && rawHtml.includes('data-grounding-identity-kind="group-authority"'));
  // and every E-1 section that references it does so through the GROUP attribute
  const groupRefs = [...rawHtml.matchAll(/data-grounding-authority-group="([^"]*)"/g)].map(m => m[1]);
  gate(12, 'the-grouped-authority-is-never-counted-as-a-physical-segment',
    !physicalIds.includes(groupId) && !e1Ids.includes(groupId)
    && groupTagged && groupRefs.length > 0 && groupRefs.every(g => g === groupId)
    && !/^gnd-br-\d+$/.test(groupId),
    `group id=${groupId} · in physical set=${physicalIds.includes(groupId) || e1Ids.includes(groupId)} · `
    + `rendered as group-authority=${groupTagged} · sections referencing it=${groupRefs.length}`);
}

// ═══ GATE 13 — a PENDING racking assembly cannot assert integrated UL 2703 ═
{
  const b = ME.bonding;
  const pending = b.result === 'METHOD_PENDING_ASSEMBLY_SELECTION';
  // BANNED assertions while the method is pending
  const banned = [
    /UL\s*2703\s+INTEGRATED/i,
    /BONDING\s*(?:METHOD)?\s*:?\s*UL\s*2703\b(?![^.]*PENDING)/i,
    /BONDING JUMPER/i,
    /bonding hardware selected/i,
    /bonding jumper required/i,
  ];
  const hits = pending ? banned.filter(re => re.test(PAGE_TEXT)).map(re => String(re)) : [];
  // the pending METHOD label and the preserved general REQUIREMENT must BOTH render
  const methodRendered = pending
    ? PAGE_TEXT.includes(b.methodCompactLabel) || PAGE_TEXT.includes(b.methodShortLabel) || PAGE_TEXT.includes(b.methodLabel)
    : true;
  const requirementRendered = /BOND(?:ING|ED)\b[\s\S]{0,80}(?:NEC\s*)?250\.134\s*\/\s*690\.43|NEC 250 AND 690\.43/i.test(PAGE_TEXT);
  const resultTagged = (rawHtml.match(new RegExp(`data-(?:app-a-)?bonding-result="${b.result}"`, 'g')) ?? []).length;
  gate(13, 'a-pending-racking-assembly-cannot-assert-integrated-ul-2703-bonding',
    hits.length === 0 && methodRendered && requirementRendered && resultTagged >= 2
    && b.bondingRequired === true,
    `bonding result=${b.result} verification=${b.verificationState} · banned assertions=${hits.length} · `
    + `pending method label rendered=${methodRendered} · general NEC requirement preserved=${requirementRendered} · result tags=${resultTagged}`,
    { hits });
}

// ═══ GATE 14 — APP-A cannot globally approve ═══════════════════════════════
{
  const L = ME.documents.listingConclusion;
  const conclusion = (appA.match(/data-app-a-listing-conclusion="([^"]*)"/) ?? [])[1] ?? null;
  const codes = (appA.match(/data-app-a-listing-open-codes="([^"]*)"/) ?? [])[1] ?? '';
  const bannedGlobal = [
    /All equipment is CEC Listed, UL Listed, and approved for grid interconnection/i,
    /all equipment is (?:UL|CEC) listed and approved/i,
    /approved for grid interconnection/i,
  ].filter(re => re.test(flat(appA)));
  gate(14, 'app-a-cannot-state-a-blanket-approval-while-requirements-are-open',
    L.established === false && conclusion === 'NOT_ESTABLISHED'
    && bannedGlobal.length === 0
    && flat(appA).includes(L.sentence)
    && eqMs(codes.split(',').filter(Boolean), L.openCodes)
    && L.openCodes.length > 0,
    `conclusion=${conclusion} (model established=${L.established}) · banned blanket sentences=${bannedGlobal.length} · `
    + `open in-scope codes rendered=${codes.split(',').filter(Boolean).length} model=${L.openCodes.length}`,
    { bannedGlobal: bannedGlobal.map(String) });
}

// ═══ GATE 15 — ARCHIVED ≠ APPLICABLE ═══════════════════════════════════════
{
  const chips = [...appA.matchAll(/data-ds-doc-state="([A-Z_]+)"/g)].map(m => m[1]);
  const established = ME.documents.establishedStates;
  // every rendered document row's chip set must come from the seven-state enum
  const unknown = chips.filter(c => !ME.documents.states.includes(c));
  // an ARCHIVED chip must never be the ONLY positive signal: the row must also
  // carry a verdict chip, and no ✓ / "verified" tick may sit on a row whose
  // applicability is not established.
  const rowBlocks = [...appA.matchAll(/<li><strong>([^<]+):<\/strong>([\s\S]*?)<\/li>/g)]
    .map(m => ({ label: m[1], html: m[2] }));
  const bad = [];
  for (const r of rowBlocks) {
    const st = [...r.html.matchAll(/data-ds-doc-state="([A-Z_]+)"/g)].map(x => x[1]);
    if (!st.length) { bad.push(`${r.label}: no document state chip`); continue; }
    const verdicts = st.filter(s => s !== 'ARCHIVED');
    if (!verdicts.length) bad.push(`${r.label}: ARCHIVED with no applicability verdict`);
    const positive = verdicts.some(s => established.includes(s));
    if (!positive && /✓|&check;/.test(r.html)) bad.push(`${r.label}: positive tick on a non-established state [${st.join('+')}]`);
  }
  // the RT-MINI case the directive names, verbatim from the canonical evaluator
  const rt = ME.documents.rackingApplicability;
  gate(15, 'archived-is-availability-only-and-never-implies-applicability',
    unknown.length === 0 && bad.length === 0 && chips.includes('ARCHIVED')
    && rt.archived === true && rt.applicabilityVerified === false
    && rt.state === 'PENDING_APPLICABILITY' && rt.authoritative === false,
    `document chips=[${chips.join(', ')}] unknown=${unknown.length} · rows checked=${rowBlocks.length} violations=${bad.length} · `
    + `RT-MINI archived=${rt.archived} applicabilityVerified=${rt.applicabilityVerified} state=${rt.state} authoritative=${rt.authoritative}`,
    { bad, unknown });
}

// ═══ GATE 16 — supply-side labels never render load-side-only citations ════
{
  const labelRows = [...noB64.matchAll(
    /data-label-nec-ref="([^"]*)" data-label-side="([^"]*)" data-label-required="([^"]*)"/g)]
    .map(m => ({ necRef: decode(m[1]), side: m[2], required: m[3] === 'true' }));
  const LOAD_ONLY = /705\.12|705\.13/;
  const bad = [];
  for (const r of labelRows) {
    if (r.side === 'supply-side-only' && LOAD_ONLY.test(r.necRef)) bad.push(`supply-side label cites ${r.necRef}`);
    if (r.required && LOAD_ONLY.test(r.necRef)) bad.push(`required label on a supply-side design cites ${r.necRef}`);
  }
  // package-wide: E-1 / PV-4A / PV-4B / SCHED / PV-5 / warning-label text
  const sheetScan = [
    ['E-1', e1Sheet], ['PV-4B', pv4b], ['SCHED', sched], ['PV-5', pv5],
    ['PV-4A', sheetsMatching(/^PV-4A/)],
  ];
  const sheetHits = [];
  // A 705.12/705.13 reference is legitimate on a SUPPLY-SIDE design ONLY as an
  // explicitly-negated contrast ("the 120% busbar rule does not apply"). It may
  // never appear as this design's GOVERNING interconnection article. The window
  // is ±260 chars because the negation frequently trails the citation by a full
  // clause ("… the 120% busbar rule (705.12(B)) applies only load-side.").
  const NEGATED = /(?:not applicable|\bn\/a\b|does not apply|do(?:es)? not govern|applies only\s+(?:to\s+)?load-?side|only\s+(?:applies\s+)?(?:to\s+)?load-?side|load-?side (?:design|connection|only)|705\.11 applies|is a supply-?side)/i;
  for (const [id, body] of sheetScan) {
    const t = flat(body);
    for (const m of t.matchAll(/705\.1[23][^\s,;)]*/g)) {
      const around = t.slice(Math.max(0, m.index - 260), m.index + 300);
      if (!NEGATED.test(around)) sheetHits.push(`${id}: "${around.trim().slice(0, 200)}"`);
    }
  }
  const modelLabels = ME.topology.labels;
  gate(16, 'a-supply-side-design-never-renders-a-load-side-only-citation',
    bad.length === 0 && sheetHits.length === 0
    && labelRows.length === modelLabels.length
    && modelLabels.filter(l => l.side === 'load-side-only').length >= 1
    && modelLabels.filter(l => l.side === 'supply-side-only').every(l => /705\.11/.test(l.necRef) && !/705\.12/.test(l.necRef)),
    `label rows rendered=${labelRows.length} model=${modelLabels.length} · violations=${bad.length} · `
    + `package-wide 705.12 hits=${sheetHits.length} · supply-side refs=[${modelLabels.filter(l => l.side === 'supply-side-only').map(l => l.necRef).join('; ')}]`,
    { bad, sheetHits: sheetHits.slice(0, 10) });
}

// ═══ GATE 17 — the summary counts DERIVE from the row states ═══════════════
{
  // the retired renderer-local claims must be gone package-wide
  const retired = [
    /\b36 of 48\b/,
    /\b\d+ items are required per NEC \/ manufacturer specification/i,
    /All quantities are derived from CAD geometry and equipment registry\s*[—-]\s*no manual estimates/i,
    /complete procurement package/i,
  ].filter(re => re.test(PAGE_TEXT)).map(String);
  const summaryTagged = (sched.match(/data-procurement-summary="state-derived"/g) ?? []).length;
  gate(17, 'the-summary-counts-derive-from-the-row-states',
    retired.length === 0 && summaryTagged >= 1
    && renderedProcurementTotal === AP.verifiedOrderableCount
    && renderedProcurementExcluded === AP.excludedLineItems
    && renderedProcurementReady === String(AP.procurementReady)
    && renderedStateCounts.VERIFIED_ORDERABLE === AP.verifiedOrderableCount
    && renderedStateCounts.ESTIMATED_FIELD_VERIFY === AP.estimatedFieldVerifyCount
    && renderedStateCounts.CANDIDATE_NON_ORDERABLE === AP.candidateNonOrderableCount
    && renderedStateCounts.QUANTITY_PENDING === AP.quantityPendingCount
    && renderedStateCounts.EXCLUDED_NOT_APPLICABLE === AP.excludedCount
    && /PROCUREMENT READY: NO/.test(PAGE_TEXT) === (AP.procurementReady === false),
    `retired renderer-local claims=${retired.length} · state-derived summary blocks=${summaryTagged} · `
    + `rendered total=${renderedProcurementTotal}/excluded=${renderedProcurementExcluded}/ready=${renderedProcurementReady} `
    + `vs model ${AP.verifiedOrderableCount}/${AP.excludedLineItems}/${AP.procurementReady}`,
    { retired });
}

// ═══ GATE 18 — exports include ONLY VERIFIED_ORDERABLE ═════════════════════
{
  const exportIds = ME.exports.orderableRowIds;
  const byId = new Map(ROWS.map(r => [r.bomLineId, r.procurement]));
  const bad = exportIds.filter(id => byId.get(id)?.authorityState !== 'VERIFIED_ORDERABLE');
  const notExportable = exportIds.filter(id => byId.get(id)?.exportable !== true);
  gate(18, 'the-authoritative-export-contains-only-verified-orderable-rows',
    bad.length === 0 && notExportable.length === 0
    && exportIds.length === AP.authoritativeExportCount
    && exportIds.length === AP.verifiedOrderableCount
    && eqMs(exportIds, AP.orderableRowIds)
    && renderedProcurementTotal === exportIds.length,
    `export rows=${exportIds.length} · non-A rows in export=${bad.length} · non-exportable=${notExportable.length} · `
    + `rendered authoritative total=${renderedProcurementTotal}`,
    { bad, notExportable });
}

// ═══ GATE 19 — non-orderable rows are VISIBLE but never exported ═══════════
{
  const excluded = ME.exports.excluded;
  const exportIds = new Set(ME.exports.orderableRowIds);
  const renderedIds = new Set(renderedRows.map(r => r.id));
  const leaked = excluded.filter(e => exportIds.has(e.bomLineId));
  const invisible = excluded.filter(e => !renderedIds.has(e.bomLineId));
  const stateless = excluded.filter(e => !e.authorityState || !e.reason);
  gate(19, 'non-orderable-rows-are-visible-in-review-and-never-in-an-order-export',
    excluded.length > 0 && leaked.length === 0 && invisible.length === 0 && stateless.length === 0
    && excluded.length === AP.totalRowCount - AP.verifiedOrderableCount,
    `excluded rows=${excluded.length} · leaked into the export=${leaked.length} · not rendered=${invisible.length} · `
    + `without a state/reason=${stateless.length}`,
    { leaked: leaked.map(e => e.bomLineId), invisible: invisible.map(e => e.bomLineId) });
}

// ═══ GATE 20 — cover + RS-1 still state the SAME 7 / N / 0 ════════════════
{
  const rsGates = num(rs, 'data-release-open-gate-count');
  const rsReqs = num(rs, 'data-release-requirement-count');
  const rsAdv = num(rs, 'data-release-advisory-count');
  const coverGates = num(cover, 'data-release-open-gate-count');
  const coverReqs = num(cover, 'data-release-requirement-count');
  const coverListed = [...cover.matchAll(/data-release-open-gate="(RG-[^"]+)"/g)].map(m => m[1]);
  const blocking = registry.filter(r => r.severity === 'blocking').length;
  const advisory = registry.length - blocking;
  const rootGateRows = [...rsPrimary.matchAll(/data-release-gate="(RG-\d)" data-release-gate-status=/g)].map(m => m[1]);
  gate(20, 'the-release-gate-architecture-is-unchanged-seven-gates-n-requirements-zero-advisories',
    rsGates === 7 && coverGates === 7 && coverListed.length === 7
    && JSON.stringify(rootGateRows) === JSON.stringify(['RG-1', 'RG-2', 'RG-3', 'RG-4', 'RG-5', 'RG-6', 'RG-7'])
    && rsReqs === blocking && coverReqs === blocking && rsAdv === advisory && advisory === 0,
    `RS-1 ${rsGates} gates / ${rsReqs} requirements / ${rsAdv} advisories · cover ${coverGates} / ${coverReqs} (listed ${coverListed.length}) · `
    + `registry ${blocking} blocking / ${advisory} advisory · root gate rows=[${rootGateRows.join(', ')}]`);
}

// ═══ GATE 21 — snapshot ID + digest identical on EVERY sheet ═══════════════
{
  const ids = [...rawHtml.matchAll(/data-project-field="snapshot-id">([^<]*)</g)].map(m => m[1].trim());
  const digs = [...rawHtml.matchAll(/data-project-field="digest">([^<]*)</g)].map(m => m[1].trim());
  const idBad = ids.filter(v => v !== meta.snapshotId).length;
  const digBad = digs.filter(v => !String(meta.digest || '').startsWith(v)).length;
  const manifest = (pa?.sheetIndex ?? []).map(s => s.id);
  gate(21, 'snapshot-identity-is-identical-across-every-sheet',
    ids.length === pages.length && digs.length === pages.length && idBad === 0 && digBad === 0
    && manifest.length === pages.length && JSON.stringify(manifest) === JSON.stringify(sheetIds)
    && ME.snapshotId === meta.snapshotId && ME.snapshotDigest === meta.digest,
    `sheets=${pages.length} withId=${ids.length} withDigest=${digs.length} idMismatch=${idBad} digestMismatch=${digBad} · `
    + `manifest=${manifest.length} manifestEqPages=${JSON.stringify(manifest) === JSON.stringify(sheetIds)} · snapshot=${meta.snapshotId}`);
}

// ═══ GATES 22 + 23 — page fit: horizontal + vertical clipping zero ═════════
const pagefitJson = path.join(os.tmpdir(), `ecd-pagefit-${process.pid}.json`);
const pagefit = spawnSync('node', ['scripts/planset-pagefit.mjs', htmlPath, '--json', pagefitJson],
  { cwd: repoRoot, encoding: 'utf8', timeout: 600000 });
const pfOut = `${pagefit.stdout ?? ''}${pagefit.stderr ?? ''}`;
const pfSummary = (pfOut.match(/\[pagefit\][^\n]*sheets=[^\n]*/) ?? [''])[0].trim();
const pfNum = (k) => Number((pfSummary.match(new RegExp(`${k}=(\\d+)`)) ?? [])[1] ?? NaN);
let pfReport = null;
try { pfReport = JSON.parse(fs.readFileSync(pagefitJson, 'utf8')); } catch { /* optional */ }
{
  gate(22, 'horizontal-page-fit-clipping-is-zero',
    pagefit.status === 0 && pfNum('clipped-h') === 0 && pfNum('internal-clipped-h') === 0,
    `pagefit exit=${pagefit.status} · ${pfSummary}`);
}
{
  gate(23, 'vertical-page-fit-clipping-is-zero',
    pagefit.status === 0 && pfNum('clipped') === 0 && pfNum('internal-clipped') === 0,
    `pagefit exit=${pagefit.status} · ${pfSummary}`);
}

// ═══ GATE 24 — report equals rendered, zero mismatches ════════════════════
{
  const mismatches = [];
  // (a) every canonical BOM row: id, state, quantity basis, blocking codes
  const renderedById = new Map();
  for (const r of renderedRows) if (!renderedById.has(r.id)) renderedById.set(r.id, r);
  for (const r of ROWS) {
    const rr = renderedById.get(r.bomLineId);
    if (!rr) { mismatches.push({ name: `bom-row:${r.bomLineId}`, canonical: 'rendered', rendered: 'MISSING' }); continue; }
    if (rr.state !== r.procurement.authorityState) {
      mismatches.push({ name: `bom-state:${r.bomLineId}`, canonical: r.procurement.authorityState, rendered: rr.state });
    }
    if (rr.quantitySource !== null && rr.quantitySource !== r.procurement.quantitySource) {
      mismatches.push({ name: `bom-basis:${r.bomLineId}`, canonical: r.procurement.quantitySource, rendered: rr.quantitySource });
    }
    if (rr.blocking.length && !eqMs(rr.blocking, r.procurement.blockingRequirementCodes)) {
      mismatches.push({ name: `bom-blocking:${r.bomLineId}`, canonical: r.procurement.blockingRequirementCodes, rendered: rr.blocking });
    }
  }
  // (b) the counters
  const counters = [
    ['population-total', AP.totalRowCount, renderedPopulationTotal],
    ['authoritative-export', AP.authoritativeExportCount, renderedProcurementTotal],
    ['excluded', AP.excludedLineItems, renderedProcurementExcluded],
    ['procurement-ready', String(AP.procurementReady), renderedProcurementReady],
    ['scheduled-above', AP.totalRowCount - tableRows.length, renderedScheduledAbove],
  ];
  for (const [name, canonical, rendered] of counters) {
    if (String(canonical) !== String(rendered)) mismatches.push({ name: `counter:${name}`, canonical, rendered });
  }
  for (const st of Object.keys(renderedStateCounts)) {
    if (renderedStateCounts[st] !== AP.rowIdsByState[st].length) {
      mismatches.push({ name: `state-count:${st}`, canonical: AP.rowIdsByState[st].length, rendered: renderedStateCounts[st] });
    }
  }
  // (c) the authority objects
  if (!PAGE_TEXT.includes(ME.documents.listingConclusion.sentence)) {
    mismatches.push({ name: 'app-a:listing-sentence', canonical: ME.documents.listingConclusion.sentence, rendered: 'NOT FOUND' });
  }
  const bondingTag = (rawHtml.match(new RegExp(`data-(?:app-a-)?bonding-result="([^"]*)"`)) ?? [])[1] ?? null;
  if (bondingTag !== ME.bonding.result) {
    mismatches.push({ name: 'pv3:bonding-result', canonical: ME.bonding.result, rendered: bondingTag });
  }
  // (d) grounding identities
  for (const id of ME.grounding.canonicalBranchIds) {
    if (!rawHtml.includes(`data-grounding-segment-id="${id}"`)) {
      mismatches.push({ name: `grounding:${id}`, canonical: 'rendered as a physical segment', rendered: 'MISSING' });
    }
  }
  // (e) the label topology set
  const renderedLabelRefs = [...noB64.matchAll(/data-label-nec-ref="([^"]*)" data-label-side="([^"]*)"/g)]
    .map(m => `${m[2]}|${decode(m[1])}`);
  const modelLabelRefs = ME.topology.labels.map(l => `${l.side}|${l.necRef}`);
  if (!eqMs(renderedLabelRefs, modelLabelRefs)) {
    mismatches.push({ name: 'pv5:label-topology-set', canonical: modelLabelRefs.length, rendered: renderedLabelRefs.length });
  }
  gate(24, 'report-equals-rendered-zero-mismatches', mismatches.length === 0,
    `${mismatches.length} mismatch(es) across ${ROWS.length} BOM rows + ${counters.length + 5} counters + `
    + `${ME.grounding.canonicalBranchIds.length} grounding identities + ${modelLabelRefs.length} labels`,
    { mismatches: mismatches.slice(0, 25) });
}

// ═══════════════════════════════════════════════════════════════════════════
const failed = gates.filter(g => !g.ok);
const report = {
  harness: 'planset-evidence-ecd',
  directive: 'docs/ENGINE-CLOSURE-DIRECTIVE.md §12 (24 final software-closure gates)',
  mode: MODE,
  html: path.resolve(htmlPath),
  snapshotId: meta.snapshotId, digest: meta.digest,
  sheetCount: pages.length, sheetIds,
  releaseRegistry: { blocking: registry.filter(r => r.severity === 'blocking').length, advisory: registry.filter(r => r.severity !== 'blocking').length, codes: registry.map(r => r.code).sort() },
  procurementStateMatrix: {
    totalRowCount: AP.totalRowCount,
    VERIFIED_ORDERABLE: AP.verifiedOrderableCount,
    ESTIMATED_FIELD_VERIFY: AP.estimatedFieldVerifyCount,
    CANDIDATE_NON_ORDERABLE: AP.candidateNonOrderableCount,
    QUANTITY_PENDING: AP.quantityPendingCount,
    EXCLUDED_NOT_APPLICABLE: AP.excludedCount,
    authoritativeExportCount: AP.authoritativeExportCount,
    procurementReady: AP.procurementReady,
    countsReconcile: AP.countsReconcile,
  },
  rendered: {
    populationTotal: renderedPopulationTotal,
    rowsShownHere: renderedShownHere,
    rowsScheduledAbove: renderedScheduledAbove,
    procurementTotal: renderedProcurementTotal,
    procurementExcluded: renderedProcurementExcluded,
    procurementReady: renderedProcurementReady,
    stateCounts: renderedStateCounts,
    openProcurementCodes: renderedOpenProcurementCodes,
    bomRowTags: renderedRows.length,
  },
  modelEvidence: {
    routeDependency: { code: ME.routeDependency.requirementCode, open: ME.routeDependency.open, rows: ME.routeDependency.routeDerivedRowIds.length },
    cableExtension: { solutions: ME.cableExtension.solutions.length, connectorRows: ME.cableExtension.connectorRows.map(c => ({ id: c.bomLineId, state: c.procurement.authorityState, promoted: c.promotion.promoted })) },
    supplySideTap: { verification: ME.supplySideTap.authority?.verificationStatus ?? null, unresolvedFacts: ME.supplySideTap.authority?.unresolvedFacts?.length ?? 0 },
    grounding: ME.grounding,
    bonding: { result: ME.bonding.result, verificationState: ME.bonding.verificationState, bondingRequired: ME.bonding.bondingRequired },
    documents: { established: ME.documents.listingConclusion.established, openCodes: ME.documents.listingConclusion.openCodes },
  },
  pageFit: { exit: pagefit.status, summary: pfSummary, report: pfReport },
  gates,
  antiVacuity: ME.antiVacuity,
  vacuityNotes: vacuous,
  pass: failed.length === 0 && ME.antiVacuity.ok,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
const tag = `[ecd-evidence:${MODE}]`;
console.log(`${tag} ${outPath} — snapshot ${meta.snapshotId} (${pages.length} sheets, ${AP.totalRowCount} BOM rows: `
  + `${AP.verifiedOrderableCount}A/${AP.estimatedFieldVerifyCount}B/${AP.candidateNonOrderableCount}C/`
  + `${AP.quantityPendingCount}D/${AP.excludedCount}E)`);
for (const g of gates) {
  console.log(`${tag} ${g.ok ? 'PASS' : 'FAIL'} gate ${String(g.gate).padStart(2)} ${g.id} — ${g.detail}`);
  console.log(`${tag}      anti-vacuity ${g.antiVacuity.ok ? 'OK' : 'FAILED'} ${g.antiVacuity.id} — ${g.antiVacuity.detail}`);
  if (!g.renderedOk && g.evidence) console.log(`${tag}      ${JSON.stringify(g.evidence).slice(0, 1600)}`);
}
if (vacuous.length) console.log(`${tag} vacuity notes: ${vacuous.join(' · ')}`);
console.log(`${tag} ${gates.length - failed.length}/${gates.length} gates pass · anti-vacuity ${ME.antiVacuity.probes.filter(p => p.ok).length}/${ME.antiVacuity.probes.length}`);
process.exit(failed.length === 0 && ME.antiVacuity.ok ? 0 : 2);
