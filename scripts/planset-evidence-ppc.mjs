// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-ppc — PROJECTION / PROCUREMENT AUTHORITY rendered-truth
// harness. THE 18 PERMANENT GATES of
// docs/PROJECTION-PROCUREMENT-CORRECTIVE-DIRECTIVE.md ("Permanent gates").
//
//   Usage: node scripts/planset-evidence-ppc.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = fixture (frozen acceptance fixture) | insufficient
//                   (the SAME design with the procurement deficit tripped, so
//                    gates 3/12/13 and §2's deficit component are NON-VACUOUS)
//
// It regenerates NOTHING and re-derives NOTHING: it reads the REAL rendered
// package plus its PermitDesignSnapshot and compares each RENDERED claim to the
// CANONICAL object that produced it.
//
// EVERY gate is written against the CLASS of violation, never an enumerated
// phrase list — the §1 miss (a phrase-list gate that let
// `#12 AWG Cu EGC … — with circuit conductors` through four campaigns) is the
// proof that phrase lists do not hold. Gates that could pass vacuously carry an
// explicit NON-VACUITY probe: gate 1's scanner is fed the retired literal, and
// gate 17's page-fit validator is fed an injected over-wide element; a gate whose
// probe fails to fire is itself a FAILURE.
//
// FAILS CLOSED: exit 2 on any violation.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const [htmlPath, snapPath, outPath = 'braidon-ppc.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) {
  console.error('usage: planset-evidence-ppc.mjs <html> <snapshot.json> [out]');
  process.exit(1);
}
const MODE = process.env.EVIDENCE_MODE === 'insufficient' ? 'insufficient' : 'fixture';
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
const el = snap.electrical || {};
const ps = el.procurementSufficiency || null;
const gnd = el.openAirGroundingAuthority || null;
const ra = snap.structural?.rackingAssembly ?? null;

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&nbsp;/g, ' ')
  .replace(/&times;/g, '×').replace(/&middot;/g, '·').replace(/&check;/g, '✓')
  .replace(/&Sigma;/g, 'Σ').replace(/&deg;/g, '°').replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&rsquo;/g, "'").replace(/&sect;/g, '§').replace(/&bull;/g, '•')
  .replace(/&rarr;/g, '→');
/** Rendered TEXT of a fragment (tags out, entities decoded, whitespace collapsed). */
const text = (h) => decode(String(h).replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/data:image[^"')]+/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(td|th|div|p|li|span|strong|em|text|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ');
const flat = (h) => text(h).replace(/\s+/g, ' ');

// ── sheet split (the SHEET wrapper only) ────────────────────────────────────
const pages = rawHtml.split(/<div class="page(?=[ "])/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);
const stripComments = (p) => p.replace(/<!--[\s\S]*?-->/g, '');
const pageWhere = (pred) => pages.map(stripComments).filter(pred);
const sheet = (id) => pages.map(stripComments).filter((p, i) => sheetIds[i] === id).join('\n');
// RGM §5 — the gate-led review-status registry is RS-1 PLUS its RS-1.n
// continuation sheets; the RS surface is the UNION of them (a requirement that
// paginated onto a continuation sheet is still rendered).
const rs1 = pages.map(stripComments).filter((p, i) => /^RS-1/.test(sheetIds[i])).join('\n');
const rs1All = rs1;
// RGM §6 — PV-0 carries the RELEASE-STATUS BLOCK (gate headline + numbered open
// root gates + pointer to RS-1) in place of the verbatim blocker list.
const cover = pages.map(stripComments).filter((p, i) => sheetIds[i] === 'PV-0').join('\n');
const pv3 = sheet('PV-3');
const pv1 = sheet('PV-1');
const pv4b = sheet('PV-4B');
const pv5 = sheet('PV-5');
const e1 = sheet('E-1');
const schedAll = pages.map(stripComments).filter((p, i) => /^SCHED/.test(sheetIds[i])).join('\n');
const branchSchedule = pageWhere(p => p.includes('AC Branch Circuit Schedule')).join('\n');

const registry = (pr.registry ?? []).filter(r => !r.resolved);
const blockingCodes = registry.filter(r => r.severity === 'blocking').map(r => r.code).sort();
const advisoryCodes = registry.filter(r => r.severity !== 'blocking').map(r => r.code).sort();
const hasBlocking = blockingCodes.length > 0;
const activeCode = (c) => registry.some(r => r.code === c);

const gates = [];
const gate = (num, id, ok, detail, evidence) => {
  gates.push({ gate: num, id, ok: !!ok, detail: detail ?? null, evidence: evidence ?? null });
  return !!ok;
};
/** A gate that cannot fire on this input is recorded as VACUOUS, not as a pass:
 *  it is only accepted when the OTHER mode exercises it (stated in the report). */
const vacuous = [];

// ═══════════════════════════════════════════════════════════════════════════
// THE ASSERTION-CLASS SCANNER (gate 1) — identical predicate to
// tests/planset/ppc-ws1-projection-procurement.test.ts, so the unit test and the
// rendered harness cannot drift.
// ═══════════════════════════════════════════════════════════════════════════
const _CTX_OPEN_AIR = /open[- ]air|q[- ]?cable|branch trunk|free air|690\.31\(c\)/i;
const _TOK_EGC = /\begc\b|equipment grounding conductor|grounding conductor/i;
const _TOK_SIZE = /#\s?\d+(?:\/0)?\s*awg|#\s?\d+\b/i;
const _PRED_INSTALLED =
  /\b(installed|install|is run|are run|run with|routed with|with circuit conductors|shall be run|provide|provided|is required|are required|required by)\b/i;
const _QUAL_PENDING =
  /not asserted|pending manufacturer authority|pending exact manufacturer authority|candidate design quantity|non-orderable|not established|not determinative|not part of the approved installation|pending\b/i;
const _QUAL_NEGATED =
  /\bno\s+(additional\s+|separate\s+|raceway\s+)?(equipment grounding conductor|egc|grounding conductor)\b|\bis not (installed|required|asserted)\b|\bnone (is |are )?(installed|required)\b/i;

function installedOpenAirEgcAssertions(sourceHtml) {
  const out = [];
  for (const block of String(sourceHtml).split(/<\/tr>|<\/div>|<\/li>|<\/p>|<\/table>|<\/text>|<\/g>|<\/svg>/i)) {
    const t = text(block);
    if (!_CTX_OPEN_AIR.test(t)) continue;
    for (const seg of t.split(/\n+|(?<=[.;])\s+|\s·\s/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      if (!_TOK_EGC.test(seg)) continue;
      if (!(_TOK_SIZE.test(seg) || _PRED_INSTALLED.test(seg))) continue;
      if (_QUAL_PENDING.test(seg) || _QUAL_NEGATED.test(seg)) continue;
      out.push(seg);
    }
  }
  return out;
}

// ═══ GATE 1 — pending grounding cannot assert an installed EGC ═══════════════
{
  const pending = gnd ? gnd.outcome === 'PENDING_MANUFACTURER_AUTHORITY' : false;
  const assertions = installedOpenAirEgcAssertions(rawHtml);
  // NON-VACUITY — the scanner must catch the retired literal and a paraphrase.
  const probe1 = installedOpenAirEgcAssertions(
    '<tr><td>AC BRANCH B1 — Q-CABLE TRUNK (OPEN AIR)</td>'
    + '<td>#12 AWG Cu EGC (NEC 250.122 @ 20A) — with circuit conductors</td></tr>').length > 0;
  const probe2 = installedOpenAirEgcAssertions(
    '<div>Open-air branch: a #10 AWG copper equipment grounding conductor is installed alongside the Q-Cable trunk.</div>').length > 0;
  const probe3 = installedOpenAirEgcAssertions(
    '<div>Provide an equipment grounding conductor run with the open-air branch trunk.</div>').length > 0;
  const mandated = noB64.includes('OPEN-AIR GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY')
    && noB64.includes('INSTALLED OPEN-AIR EGC: NOT ASSERTED');
  gate(1, 'pending-grounding-cannot-assert-installed-egc',
    assertions.length === 0 && probe1 && probe2 && probe3 && (!pending || mandated),
    `groundingOutcome=${gnd?.outcome ?? 'absent'} assertions=${assertions.length} `
    + `scannerProbes=${[probe1, probe2, probe3].filter(Boolean).length}/3 mandatedRenderPresent=${mandated}`,
    { assertions: assertions.slice(0, 10), scannerNonVacuous: { retiredLiteral: probe1, paraphraseWithSize: probe2, predicateOnly: probe3 } });
  if (!pending) vacuous.push('gate 1 (grounding not pending on this input)');
}

// ═══ GATE 2 — the candidate EGC is NON-ORDERABLE ════════════════════════════
{
  const state = gnd?.bomRowState ?? null;
  const clauses = {
    candidate: /CANDIDATE DESIGN QUANTITY/i.test(noB64),
    nonOrderable: /NON-ORDERABLE/i.test(noB64),
    notApproved: /NOT PART OF THE APPROVED INSTALLATION/i.test(noB64),
    pendingExact: /PENDING EXACT MANUFACTURER AUTHORITY/i.test(noB64),
  };
  // the rendered BOM row for the candidate open-air EGC may never be orderable
  const egcRows = [...noB64.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0])
    .filter(r => /open[- ]air/i.test(text(r)) && /\bEGC\b/i.test(text(r)) && /data-bom-orderable/.test(r));
  const orderableEgcRows = egcRows.filter(r => r.includes('data-bom-orderable="true"'));
  const pending = gnd ? gnd.outcome === 'PENDING_MANUFACTURER_AUTHORITY' : false;
  gate(2, 'candidate-egc-non-orderable',
    !pending
      ? orderableEgcRows.length === 0 || state !== 'design-quantity-non-orderable'
      : state === 'design-quantity-non-orderable' && gnd?.excludedFromProcurementTotals === true
        && Object.values(clauses).every(Boolean) && orderableEgcRows.length === 0,
    `bomRowState=${state} excludedFromTotals=${gnd?.excludedFromProcurementTotals ?? '—'} clauses=${JSON.stringify(clauses)} `
    + `renderedOpenAirEgcRows=${egcRows.length} orderableAmongThem=${orderableEgcRows.length}`,
    { clauses, orderableEgcRows: orderableEgcRows.map(r => flat(r).slice(0, 180)) });
}

// ═══ GATE 3 — blocker detail matches the canonical payload SCHEMA ════════════
// The expected map is PARSED FROM THE SOURCE (lib/permit/sections/reviewStatus.ts
// BLOCKER_PAYLOAD_SCHEMA) rather than duplicated here, so the harness can never
// drift from the dispatcher it is checking.
{
  const src = fs.readFileSync(path.resolve(repoRoot, 'lib/permit/sections/reviewStatus.ts'), 'utf8');
  const tbl = (src.match(/BLOCKER_PAYLOAD_SCHEMA[^=]*=\s*\{([\s\S]*?)\n\};/) ?? [])[1] ?? '';
  const expected = {};
  for (const m of tbl.matchAll(/'([A-Z0-9-]+)'\s*:\s*'([a-z-]+)'/g)) expected[m[1]] = m[2];
  // Rendered: one <tr> per registry row; its payload box carries the schema tag.
  const rows = [...rs1All.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0])
    .map(r => ({
      code: (r.match(/<td class="mono"[^>]*>([A-Z0-9-]+)</) ?? [])[1] ?? null,
      schema: (r.match(/data-blocker-payload-schema="([a-z-]+)"/) ?? [])[1] ?? null,
      hasDeficitBox: /DEFICIT PAYLOAD:/.test(r),
      hasGroundingBox: /GROUNDING AUTHORITY PAYLOAD:/.test(r),
      hasGenericBox: /BLOCKER PAYLOAD:/.test(r),
    }))
    .filter(r => r.code);
  const wrong = [];
  for (const r of rows) {
    const want = expected[r.code] ?? 'generic';
    if (r.schema && r.schema !== want) wrong.push(`${r.code}: rendered ${r.schema} want ${want}`);
    // a row may never carry ANOTHER schema's component
    if (want !== 'qcable-procurement-deficit' && r.hasDeficitBox) wrong.push(`${r.code}: foreign DEFICIT PAYLOAD box`);
    if (want !== 'qcable-grounding-authority' && r.hasGroundingBox) wrong.push(`${r.code}: foreign GROUNDING AUTHORITY box`);
  }
  // every registry code the snapshot carries must be DECLARED in the table
  const undeclared = registry.map(r => r.code).filter(c => !(c in expected));
  // no empty-field template anywhere (the §2 signature)
  const emptyTemplate = /SKU\s*—\s*@\s*—\s*ft|deficit\s*—\s*ft|mfr-doc authority null/.test(flat(rs1All));
  // the deficit component must exist EXACTLY where the deficit exists, and nowhere else
  const deficitBoxes = (rs1All.match(/DEFICIT PAYLOAD:/g) ?? []).length;
  const expectDeficit = ps?.insufficient ? 1 : 0;
  const schemasSeen = [...new Set(rows.map(r => r.schema).filter(Boolean))];
  gate(3, 'blocker-detail-matches-canonical-payload-schema',
    wrong.length === 0 && undeclared.length === 0 && !emptyTemplate
    && deficitBoxes === expectDeficit && rows.length === registry.length,
    `renderedRows=${rows.length} registry=${registry.length} declaredCodes=${Object.keys(expected).length} `
    + `undeclared=${undeclared.join(',') || 'none'} wrong=${wrong.join(' | ') || 'none'} `
    + `deficitBoxes=${deficitBoxes} (expected ${expectDeficit}) emptyTemplate=${emptyTemplate} `
    + `schemasRendered=${schemasSeen.join(',') || 'none'}`,
    { expected, rows, wrong, undeclared });
  if (!ps?.insufficient) vacuous.push('gate 3 deficit component (no procurement deficit on this input)');
}

// ═══ GATE 4 — no unsupported MAX / allowable spacing language ════════════════
{
  const spc = snap.structural?.spacingAuthority ?? null;
  const verified = spc?.verificationState === 'verified';
  const t = flat(noB64);
  // CLASS scan: any MAX/MAXIMUM/allowable/approved qualifier within 40 chars of a
  // spacing token, in either order.
  const CLASSES = [
    /O\.C\.\s*MAX/i,
    /\bMAX(IMUM)?( ALLOWED)?\b[^.<]{0,40}\b(spacing|O\.?C\.?)\b/i,
    /\b(spacing|O\.?C\.?)\b[^.<]{0,40}\bMAX(IMUM)?( ALLOWED)?\b/i,
    /allowable spacing|approved spacing/i,
  ];
  const hits = verified ? [] : CLASSES.filter(re => re.test(t)).map(String);
  // and the canonical line MUST be rendered (a gate that passes because the sheet
  // says nothing about spacing is worthless)
  const canonical = /DESIGN ATTACHMENT SPACING:\s*\d+ IN\. O\.C\./.test(t);
  const status = /PENDING STRUCTURAL VERIFICATION/.test(t) || verified;
  const pv1Ok = /DESIGN ATTACHMENT SPACING/.test(flat(pv1));
  const pv3Ok = /DESIGN ATTACHMENT SPACING/.test(flat(pv3));
  // one unit only — no 4'-0" vs 48" split on the same sheet
  const unitSplit = /4'-0"\s*ATTACH/i.test(flat(pv3));
  gate(4, 'no-unsupported-max-spacing-language',
    hits.length === 0 && canonical && status && pv1Ok && pv3Ok && !unitSplit,
    `spacingVerified=${verified} classHits=${hits.join(' | ') || 'none'} canonicalLine=${canonical} `
    + `statusLine=${status} pv1=${pv1Ok} pv3=${pv3Ok} unitSplitOnPv3=${unitSplit}`,
    { spacingAuthority: spc, hits });
}

// ═══ GATE 5 — a pending fastener assembly renders no exact instruction ══════
{
  const faUnverified = activeCode('FASTENER-ASSEMBLY-UNVERIFIED')
    || ra?.assemblyVerification?.fastener !== 'verified';
  // CLASS scan on the sheets that carry the attachment detail + its schedules.
  const scope = flat(pv3 + '\n' + sheet('PV-4C.1') + '\n' + sheet('APP-A') + '\n' + schedAll);
  const CLASSES = {
    diameter: /\b(5\/16|3\/8|1\/4|1\/2)\s*"?\s*(DIA|diameter)\b/i,
    lengthSpec: /\bDIA[^.<]{0,12}[×x]\s*\d+(\.\d+)?\s*"/i,
    embedment: /\d+(\.\d+)?\s*"?\s*MIN\.?\s*(THREAD\s*)?EMBED/i,
    torque: /\d+\s*[–-]\s*\d+\s*FT-?LBS?|\bft-lbs?\b/i,
    pilot: /PILOT HOLE|7\/32/i,
    coating: /\b316\s*S\.?S\.?\b/i,
    sealantProduct: /ALPHASEAL|SEALANT AT EVERY/i,
    screwCount: /\b\d+\s+(screws?|per pad|per mount)\b/i,
  };
  const leaks = Object.entries(CLASSES).filter(([, re]) => re.test(scope)).map(([k]) => k);
  const mandated = ['FASTENER ASSEMBLY: PENDING VERIFIED SELECTION',
    'INSTALLATION DETAILS: NOT ESTABLISHED'].filter(s => !flat(pv3).includes(s));
  gate(5, 'pending-fastener-renders-no-exact-instruction',
    !faUnverified ? true : leaks.length === 0 && mandated.length === 0,
    `fastenerUnverified=${faUnverified} leaks=${leaks.join(',') || 'none'} `
    + `missingPendingLines=${mandated.join(' | ') || 'none'}`,
    { leaks, fastenerVerification: ra?.assemblyVerification?.fastener ?? null });
  if (!faUnverified) vacuous.push('gate 5 (fastener assembly is verified on this input)');
}

// ═══ GATE 6 — an unverified RT-MINI II document cannot authorize ════════════
{
  const docGapActive = activeCode('EQUIPMENT-DOCUMENT-APPLICABILITY');
  const t = flat(noB64);
  // every mention of the non-applicable document must sit inside a NOT-VERIFIED /
  // NOT-AUTHORITATIVE context (class scan: check each occurrence's neighbourhood)
  const mentions = [];
  const re = /RT-MINI II/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const ctx = t.slice(Math.max(0, m.index - 220), m.index + 260);
    mentions.push({
      context: ctx.trim().slice(0, 200),
      qualified: /NOT VERIFIED|NOT AUTHORITATIVE|UNVERIFIED|APPLICABILITY|DIFFERENT PRODUCT VERSION|DO NOT INSTALL/i.test(ctx),
    });
  }
  const unqualified = mentions.filter(x => !x.qualified);
  const applicabilityLine = t.includes('DOCUMENT APPLICABILITY: RT-MINI II MANUAL NOT VERIFIED FOR SELECTED RT-MINI');
  const banner = /NON-AUTHORITATIVE\b[^.]{0,60}DO NOT INSTALL/i.test(t) || /DO NOT INSTALL FROM THIS DETAIL/i.test(t);
  gate(6, 'unverified-rtmini-ii-cannot-authorize',
    !docGapActive ? unqualified.length === 0
      : unqualified.length === 0 && applicabilityLine && banner && mentions.length > 0,
    `documentApplicabilityBlocker=${docGapActive} mentions=${mentions.length} unqualified=${unqualified.length} `
    + `applicabilityLine=${applicabilityLine} referenceDetailBanner=${banner}`,
    { unqualified: unqualified.slice(0, 5) });
  if (!docGapActive) vacuous.push('gate 6 (document applicability is verified on this input)');
}

// ═══ BOM row parsing (gates 7 / 11 / 12 / 13) ══════════════════════════════
const bomRows = [...noB64.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0])
  .filter(r => /data-bom-orderable="/.test(r))
  .map(r => ({
    html: r,
    text: flat(r),
    orderable: (r.match(/data-bom-orderable="(true|false)"/) ?? [])[1] ?? null,
    quantityState: (r.match(/data-bom-quantity-state="([a-z]+)"/) ?? [])[1] ?? null,
  }));
const procTotal = Number((noB64.match(/data-procurement-total="(\d+)"/) ?? [])[1] ?? NaN);
const procExcluded = Number((noB64.match(/data-procurement-excluded="(\d+)"/) ?? [])[1] ?? NaN);
const procPartial = (noB64.match(/data-procurement-partial="(true|false)"/) ?? [])[1] ?? null;
// ── ECD §1/§2/§10 SUPERSESSION (2026-07-27) ────────────────────────────────
// This harness's procurement gates were written against the PPC-era rendered
// surface: a per-row `data-procurement-excluded-row` enumeration and the prose
// "ORDERABLE ROWS ONLY: N of M BOM line items". The engine-closure pass RETIRED
// both — the enumeration because the honest state model produces 37 exclusions
// (a per-row list clipped the sheet AND duplicated what each row already says in
// its own cell), and the "N of M" prose because §1 bans every hardcoded
// N-of-M-class count. The SUBSTANCE of gates 7/13/18 is unchanged and is now
// read off the state model that replaced them:
//   • the population is `data-bom-population-total` over EVERY row, table or not
//   • each row states its ONE state in `data-bom-authority-state`
//   • the partition is orderable + (every non-VERIFIED_ORDERABLE row) = population
const populationTotal = Number((noB64.match(/data-bom-population-total="(\d+)"/) ?? [])[1] ?? NaN);
/** every row in the POPULATION (table rows + the rows scheduled in their own
 *  tables above), each with its ONE authority state. */
const populationRows = [...noB64.matchAll(/data-bom-line-id="([^"]*)" data-bom-authority-state="([^"]*)"/g)]
  .map(m => ({ bomLineId: m[1], state: m[2] }));
const populationBlocked = populationRows.filter(r => r.state !== 'VERIFIED_ORDERABLE');
/** ECD replacement for the retired per-row exclusion enumeration: every non-A
 *  row states its own state ON the row, and the five state counts render. */
const stateCountsRendered = [...noB64.matchAll(/data-procurement-state-count="([A-Z_]+)">(\d+)/g)]
  .map(m => ({ state: m[1], count: Number(m[2]) }));

// ═══ GATE 7 — pending racking rows are excluded from the totals ═════════════
{
  const pendingRackingRows = bomRows.filter(r => /PENDING RACKING ASSEMBLY SELECTION/i.test(r.text));
  const orderablePending = pendingRackingRows.filter(r => r.orderable === 'true');
  // no pending row may display a manufacturer or an exact SKU
  const skuLeaks = pendingRackingRows.filter(r =>
    /\bRT-MINI-01\b/.test(r.text) || /\bRoof Tech\b/.test(r.text));
  const railUnpinned = !ra?.railSku || activeCode('PENDING-RACKING-ASSEMBLY-SELECTION');
  const totalsPresent = Number.isFinite(procTotal) && Number.isFinite(procExcluded);
  // ECD: count the blocked rows over the POPULATION, not over the rows this one
  // table paginates. The module row is scheduled in its own table above and is
  // CANDIDATE_NON_ORDERABLE; counting only `data-bom-orderable` table cells
  // undercounted the exclusions by exactly that row.
  const excludedRows = populationBlocked;
  const excludedEq = totalsPresent ? procExcluded === excludedRows.length : false;
  gate(7, 'pending-racking-excluded-from-procurement-totals',
    !railUnpinned
      ? true
      : pendingRackingRows.length > 0 && orderablePending.length === 0 && skuLeaks.length === 0
        && totalsPresent && excludedEq && procPartial === 'true',
    `railUnpinned=${railUnpinned} pendingRackingRows=${pendingRackingRows.length} `
    + `orderableAmongThem=${orderablePending.length} mfrOrSkuLeaks=${skuLeaks.length} `
    + `authoritativeTotal=${procTotal} excluded=${procExcluded} taggedExcludedRows=${excludedRows.length} partial=${procPartial}`,
    { skuLeaks: skuLeaks.map(r => r.text.slice(0, 160)), pendingRackingCategories: pendingRackingRows.length });
  if (!railUnpinned) vacuous.push('gate 7 (racking assembly is selected on this input)');
}

// ═══ GATE 8 — a generic PASS cannot hide branch blockers ════════════════════
{
  const t = flat(branchSchedule);
  const header = t.includes('AMPACITY / DEVICE-RATING RESULT');
  const qualifiedPass = t.includes('PASS — ELECTRICAL RATING ONLY');
  const barePass = /✓\s*PASS/.test(t) || /(?<!ELECTRICAL RATING ONLY[^.]{0,40})>\s*PASS\s*</.test(branchSchedule);
  const matrix = t.includes('BRANCH RELEASE STATUS');
  const authorities = ['ROUTE AUTHORITY:', 'GROUNDING AUTHORITY:', 'PROCUREMENT SUFFICIENCY:', 'OVERALL RELEASE:']
    .filter(s => !t.includes(s));
  const blocked = !hasBlocking || /OVERALL RELEASE: BLOCKED/.test(t);
  // the Σ deficit is NEVER apportioned per branch
  const apportioned = /this branch is short by/i.test(t) || /B[123][^.]{0,40}short by \d/i.test(t);
  gate(8, 'generic-pass-cannot-hide-branch-blockers',
    header && qualifiedPass && !barePass && matrix && authorities.length === 0 && blocked && !apportioned,
    `scheduleFound=${branchSchedule.length > 0} ratingColumn=${header} qualifiedPass=${qualifiedPass} `
    + `barePassBadge=${barePass} releaseMatrix=${matrix} missingAuthorities=${authorities.join(',') || 'none'} `
    + `overallBlocked=${blocked} perBranchDeficitApportioned=${apportioned}`,
    { missingAuthorities: authorities });
}

// ═══ GATE 9 — a supply-side design renders no load-side-only citation ═══════
{
  const rule = snap.project?.interconnection?.rule ?? null;
  const supply = rule === '705.11';
  const t = flat(noB64);
  const LOAD_SIDE_ONLY = {
    '705.12(D)': /705\.12\(D\)/,
    '705.12(B)(2)(3)(e)': /705\.12\(B\)\(2\)\(3\)\(e\)/,
    '705.13': /705\.13\b/,
    'bare per-NEC-705.12 requirement': /per NEC 705\.12(?!\()/,
    '690.8(A) / 705.12 heading': /NEC 690\.8\(A\) \/ 705\.12/,
  };
  const leaks = supply ? Object.entries(LOAD_SIDE_ONLY).filter(([, re]) => re.test(t)).map(([k]) => k) : [];
  // the legitimate "705.12(B) does not apply" statements must SURVIVE
  const preserved = !supply || /705\.12\(B\)\)? (does not apply|applies only load-side|N\/A)/.test(t);
  gate(9, 'supply-side-renders-no-load-side-only-citation',
    leaks.length === 0 && preserved,
    `interconnectionRule=${rule ?? '—'} supplySide=${supply} leaks=${leaks.join(' | ') || 'none'} `
    + `notApplicableStatementsPreserved=${preserved}`,
    { leaks });
  if (!supply) vacuous.push('gate 9 (design is load-side on this input)');
}

// ═══ GATE 10 — every rendered grounding row carries a groundingSegmentId ════
{
  const ids = (noB64.match(/data-grounding-segment-id="([^"]*)"/g) ?? [])
    .map(t => (t.match(/="([^"]*)"/) ?? [])[1]);
  const empty = ids.filter(v => !v || !v.trim()).length;
  // THE §7 DEFECT CLASS: a row whose SUBJECT is a grounding conductor. The retired
  // legacy row's own first cell was `EGC` — that is the class. Scoping, stated
  // explicitly so it is auditable rather than convenient:
  //   IN  — any schedule row whose ROW LABEL (first cell) names a grounding /
  //         electrode / bonding conductor. These rows ASSERT a grounding conductor
  //         as their subject and are exactly what §7 requires to reconcile to a
  //         canonical GroundingSegment.
  //   OUT — (a) rows tagged data-grounding-code-basis (a CODE RULE; no conductor is
  //             asserted), (b) POWER-conductor rows that merely list an EGC inside
  //             their conductor set (subject = the feeder/branch circuit; they
  //             reconcile through their own route segment), (c) BOM procurement rows
  //             (subject = a purchase line; they reconcile through the
  //             GroundingSegment's bomLineId and are governed by gates 2/7/13).
  const rowLabel = (r) => {
    const m = r.match(/<td[^>]*>([\s\S]*?)<\/td>/);
    return m ? flat(m[1]).trim() : '';
  };
  const SUBJECT_IS_GROUNDING = (label) => label.length > 0 && label.length <= 60
    && /\b(EGC|GEC|Grounding Conductor|Equipment Grounding Conductor|Grounding Electrode Conductor|Bonding Conductor|Bonding Jumper)\b/i.test(label);
  const groundingRowsIn = (source) => [...String(source).matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0])
    .filter(r => SUBJECT_IS_GROUNDING(rowLabel(r))
      && !/data-grounding-code-basis="/.test(r)
      && !/data-bom-orderable="/.test(r));
  const groundingCells = groundingRowsIn(noB64);
  const untagged = groundingCells.filter(r => !/data-grounding-segment-id="/.test(r));
  // NON-VACUITY — the class predicate must catch the RETIRED legacy row (its own
  // first cell was `EGC`, with no id anywhere on it). A gate whose class matches
  // nothing on the sheet is not evidence.
  const probe = groundingRowsIn(
    '<tr style="background:#fff"><td class="fw7">EGC</td><td>Array</td>'
    + '<td>AC Disconnect (ground bus)</td><td>#10 AWG bare Cu</td><td>—</td><td>—</td>'
    + '<td>—</td><td>PVC Sch 80 1-1/4"</td><td>20 ft</td></tr>');
  const probeFired = probe.length === 1 && !/data-grounding-segment-id="/.test(probe[0]);
  const legacyRow = /AC Disconnect \(ground bus\)/i.test(noB64);
  const canonicalBlock = /CANONICAL GroundingSegment OBJECTS/i.test(noB64);
  gate(10, 'every-grounding-row-carries-a-grounding-segment-id',
    ids.length > 0 && empty === 0 && untagged.length === 0 && !legacyRow && canonicalBlock
    && probeFired && groundingCells.length > 0,
    `taggedIds=${ids.length} distinct=${new Set(ids).size} emptyIds=${empty} `
    + `groundingSubjectRows=${groundingCells.length} untagged=${untagged.length} `
    + `legacyProjectLevelRow=${legacyRow} canonicalBlockRendered=${canonicalBlock} `
    + `classProbeFired=${probeFired}`,
    { ids: [...new Set(ids)], untagged: untagged.map(r => flat(r).slice(0, 160)),
      groundingSubjectRowLabels: groundingCells.map(r => rowLabel(r)), classProbeFired: probeFired });
}

// ═══ GATE 11 — a pending cap quantity cannot render a certain zero ══════════
{
  const capRows = bomRows.filter(r => /sealing cap|Q-SEAL|unused[- ]connector cap/i.test(r.text));
  const pendingCaps = capRows.filter(r => r.quantityState === 'pending');
  const certainZero = capRows.filter(r =>
    r.quantityState !== 'pending' && /QUANTITY PENDING/i.test(r.text));
  // the class: NO row may carry an ESTABLISHED zero next to a PENDING claim
  const establishedZeroWithPendingProse = bomRows.filter(r =>
    r.quantityState === 'established' && /QUANTITY PENDING|FIELD QUANTITY PENDING/i.test(r.text));
  const label = /MODELED \/ FIELD QUANTITY PENDING/.test(flat(noB64));
  gate(11, 'pending-caps-cannot-render-a-certain-zero',
    capRows.length > 0 && pendingCaps.length === capRows.length
    && certainZero.length === 0 && establishedZeroWithPendingProse.length === 0 && label,
    `capRows=${capRows.length} pendingTagged=${pendingCaps.length} certainZeroWithPendingProse=${certainZero.length} `
    + `establishedRowsClaimingPending=${establishedZeroWithPendingProse.length} pendingLabelRendered=${label}`,
    { capRows: capRows.map(r => ({ quantityState: r.quantityState, orderable: r.orderable, text: r.text.slice(0, 160) })) });
}

// ═══ GATE 12 — the insufficient Q-Cable row is itself NON-ORDERABLE ═════════
{
  const insufficient = ps?.insufficient === true;
  // the TRUNK-CABLE row only — not the candidate open-air EGC row that names the
  // same open-air section (that row is gate 2's subject and is legitimately
  // non-orderable under a DIFFERENT authority).
  const trunkRows = bomRows.filter(r => /trunk cable/i.test(r.text) && !/\bEGC\b/i.test(r.text));
  const orderableTrunk = trunkRows.filter(r => r.orderable === 'true');
  const need = insufficient ? [
    'STATUS: NON-ORDERABLE',
    'REASON: QCABLE-PROCUREMENT-INSUFFICIENT',
    `DESIGNED-INSTALLED ${ps.totalDesignedInstalledFt} FT`,
    `CURRENT BASE ${ps.procurementLengthFt} FT`,
    `DEFICIT ${ps.deficitFt} FT`,
    'EXTENSION SOLUTION NOT SELECTED',
  ] : [];
  const schedText = flat(schedAll);
  const missing = need.filter(s => !schedText.includes(s));
  // the SELECTED CABLE IDENTITY is kept (the quantity is insufficient, not the cable)
  const identityKept = !insufficient || /Q-12-10-240/.test(schedText);
  gate(12, 'insufficient-qcable-row-is-non-orderable',
    !insufficient
      // sufficient ⇒ no row may CLAIM a deficit state the design does not have
      ? !schedText.includes('QCABLE-PROCUREMENT-INSUFFICIENT') && !/DEFICIT \d/.test(schedText)
      : trunkRows.length > 0 && orderableTrunk.length === 0 && missing.length === 0 && identityKept,
    `procurementInsufficient=${insufficient} deficitFt=${ps?.deficitFt ?? '—'} trunkRows=${trunkRows.length} `
    + `orderableAmongThem=${orderableTrunk.length} missingRowState=${missing.join(' | ') || 'none'} `
    + `cableIdentityKept=${identityKept}`,
    { trunkRows: trunkRows.map(r => ({ orderable: r.orderable, text: r.text.slice(0, 220) })), missing });
  if (!insufficient) vacuous.push('gate 12 (no procurement deficit on this input)');
}

// ═══ GATE 13 — procurement exports exclude every blocked row ════════════════
{
  const totalsPresent = Number.isFinite(procTotal) && Number.isFinite(procExcluded);
  const blockedRows = populationBlocked;
  // The authoritative total's SCOPE is the FULL BOM (every line the package orders),
  // not the rows this one table paginates — a narrower total would be a second,
  // quieter total: the exact defect class this pass exists to kill. ECD replaced
  // the "N of M BOM line items" prose (a hardcoded N-of-M count, banned by §1)
  // with `data-bom-population-total` over the same scope; the partition is
  // checked against THAT.
  const consistent = totalsPresent && Number.isFinite(populationTotal)
    // the partition is EXACT: orderable + excluded = every BOM line item
    && procTotal + procExcluded === populationTotal
    // every rendered row carries exactly one state, and they cover the population
    && populationRows.length === populationTotal
    && procTotal === populationRows.length - blockedRows.length
    // every row the RENDERED package tags as blocked is inside the excluded count
    && procExcluded === blockedRows.length
    // and this table's rows are a subset of the full BOM
    && bomRows.length <= populationTotal;
  // ECD replacement for the retired per-row exclusion enumeration: every blocked
  // row states its OWN state on the row, and the five state counts render and sum.
  const stateSum = stateCountsRendered.reduce((n, s) => n + s.count, 0);
  const enumeratedAll = procExcluded === 0
    || (blockedRows.every(r => !!r.state && r.state !== 'VERIFIED_ORDERABLE')
        && stateCountsRendered.length === 5 && stateSum === populationTotal);
  const statement = procExcluded === 0
    || (flat(noB64).includes('EXCLUDED from the authoritative total AND from every procurement export')
        && flat(noB64).includes('NOT an approved procurement release'));
  gate(13, 'procurement-exports-exclude-every-blocked-row',
    consistent && enumeratedAll && statement,
    `taggedTableRows=${bomRows.length} populationRows=${populationRows.length} blocked=${blockedRows.length} `
    + `renderedPopulationTotal=${populationTotal} renderedOrderableTotal=${procTotal} renderedExcluded=${procExcluded} `
    + `stateCounts=${stateCountsRendered.map(s => `${s.state}=${s.count}`).join(' ')} Σ=${stateSum} `
    + `partitionExact=${consistent} everyBlockedRowStatesItsState=${enumeratedAll} exportStatement=${statement}`,
    { blocked: blockedRows.slice(0, 20) });
}

// ═══ GATE 14 — a pending issue state cannot render approved-design language ══
{
  const t = flat(noB64);
  const CLASSES = {
    approvedDesign: /\bapproved design\b/i,
    approvedPlans: /\bapproved plans\b/i,
    engineerApproved: /\bengineer[- ]approved\b/i,
    permitApproved: /\bpermit[- ]approved\b/i,
    constructionApproved: /\bconstruction[- ]approved\b/i,
  };
  const hits = hasBlocking ? Object.entries(CLASSES).filter(([, re]) => re.test(t)).map(([k]) => k) : [];
  const honest = !hasBlocking
    || flat(pv5).includes('SITE-COMPUTED FROM THE CURRENT DESIGN-REVIEW SNAPSHOT — NOT YET APPROVED');
  // the legitimate label COUNT line must survive
  const countLine = /SITE-COMPUTED \+ \d+ STANDARD/.test(flat(pv5));
  gate(14, 'pending-issue-state-cannot-render-approved-design',
    hits.length === 0 && honest && countLine,
    `blocking=${blockingCodes.length} issueState=${pa?.issueState ?? '—'} approvedLanguageHits=${hits.join(',') || 'none'} `
    + `pv5HonestBasis=${honest} labelCountLinePreserved=${countLine}`,
    { hits });
  if (!hasBlocking) vacuous.push('gate 14 (nothing blocking on this input)');
}

// ═══ GATE 15 — blocker counts identical across every surface ════════════════
{
  const key = (r) => `${r.code}:${r.severity}`;
  const registryMultiset = registry.map(key).sort();
  const listCodes = (pr.blockers ?? []).map(b => b.code).sort();
  const rs1Rows = [...rs1.matchAll(/>(BLOCKING|ADVISORY)<\/span>\s*<\/td>\s*<td class="mono"[^>]*>([A-Z0-9-]+)</g)]
    .map(m => ({ severity: m[1] === 'BLOCKING' ? 'blocking' : 'warning', code: m[2] }));
  const rs1Multiset = rs1Rows.map(key).sort();
  // RGM §4 — GATE semantics: the REQUIREMENT count must equal the blocking
  // registry count; the ROOT-GATE count is separate and never conflated with it.
  const rs1Header = Number((rs1.match(/(\d+)\s+UNRESOLVED REQUIREMENT/) ?? [])[1] ?? NaN);
  const rs1Gates = Number((rs1.match(/(\d+)\s+OPEN RELEASE GATE/) ?? [])[1] ?? NaN);
  const rs1SumB = Number((rs1.match(/data-release-requirement-count="(\d+)"/) ?? [])[1] ?? NaN);
  const rs1SumA = Number((rs1.match(/data-release-advisory-count="(\d+)"/) ?? [])[1] ?? NaN);
  const coverTotal = Number((cover.match(/data-release-requirement-count="(\d+)"/) ?? [])[1] ?? NaN);
  const coverGates = Number((cover.match(/data-release-open-gate-count="(\d+)"/) ?? [])[1] ?? NaN);
  const coverListedGates = (cover.match(/data-release-open-gate="RG-[^"]+"/g) ?? []).length;
  const eq = {
    listEqRegistry: JSON.stringify(listCodes) === JSON.stringify(blockingCodes),
    rs1EqRegistry: JSON.stringify(rs1Multiset) === JSON.stringify(registryMultiset),
    rs1HeaderEq: rs1Header === blockingCodes.length,
    rs1SummaryEq: rs1SumB === blockingCodes.length && rs1SumA === advisoryCodes.length,
    coverEq: registry.length === 0
      ? true
      : (coverTotal === blockingCodes.length && coverGates === rs1Gates && coverListedGates === coverGates),
    issueGate: hasBlocking
      ? (pr.ready === false && !/CLEARED FOR ISSUE/.test(rs1) && !/ISSUED FOR PERMIT/.test(String(pa?.issueState ?? '')))
      : pr.ready === true,
  };
  gate(15, 'blocker-counts-identical-across-surfaces',
    Object.values(eq).every(Boolean),
    `registry=${registry.length} (blocking ${blockingCodes.length}/advisory ${advisoryCodes.length}) `
    + `rs1Rows=${rs1Rows.length} rs1Requirements=${rs1Header} rs1Gates=${rs1Gates} rs1Summary=${rs1SumB}/${rs1SumA} `
    + `coverRequirements=${Number.isNaN(coverTotal) ? 'MISSING' : coverTotal} coverGates=${coverGates} (listed ${coverListedGates}) ${JSON.stringify(eq)}`,
    { blockingCodes, advisoryCodes, missingFromRs1: registryMultiset.filter(k => !rs1Multiset.includes(k)),
      extraOnRs1: rs1Multiset.filter(k => !registryMultiset.includes(k)) });
}

// ═══ GATE 16 — snapshot ID + digest identical on every sheet ════════════════
{
  const perSheet = pages.map((p, i) => ({
    index: i, sheetId: sheetIds[i],
    ids: [...new Set([...p.matchAll(/data-project-field="snapshot-id">([^<]*)</g)].map(m => decode(m[1]).trim()))],
    digests: [...new Set([...p.matchAll(/data-project-field="digest">([^<]*)</g)].map(m => decode(m[1]).trim()))],
  }));
  const withId = perSheet.filter(s => s.ids.length > 0);
  const idMismatch = withId.filter(s => s.ids.some(v => v !== meta.snapshotId));
  const digestMismatch = perSheet.filter(s => s.digests.some(v => !String(meta.digest || '').startsWith(v)));
  const manifestIds = (pa?.sheetIndex ?? []).map(s => s.id);
  const manifestEq = manifestIds.length === 0 || manifestIds.length === pages.length;
  gate(16, 'snapshot-identity-identical-across-sheets',
    withId.length > 0 && idMismatch.length === 0 && digestMismatch.length === 0 && manifestEq,
    `sheets=${pages.length} withStamp=${withId.length} idMismatch=${idMismatch.length} `
    + `digestMismatch=${digestMismatch.length} manifest=${manifestIds.length} manifestEqPages=${manifestEq} `
    + `snapshot=${meta.snapshotId}`,
    { idMismatch, digestMismatch, sheetIds });
}

// ═══ GATE 17 — page-fit detects HORIZONTAL and VERTICAL clipping ════════════
let pageFitReport = null;
{
  const pfJson = path.join(os.tmpdir(), `ppc-pagefit-${process.pid}.json`);
  const pf = spawnSync(process.execPath,
    [path.resolve(repoRoot, 'scripts/planset-pagefit.mjs'), htmlPath, '--json', pfJson],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { pageFitReport = JSON.parse(fs.readFileSync(pfJson, 'utf8')); } catch { pageFitReport = null; }
  const skipped = /playwright not installed|chromium binary unavailable/.test(String(pf.stdout || '') + String(pf.stderr || ''));
  const axes = pageFitReport?.axes ?? [];
  const bothAxes = axes.includes('vertical') && axes.includes('horizontal');
  // NON-VACUITY PROBE — inject an over-wide block inside the first sheet and
  // require the validator to FAIL. A page-fit gate that cannot detect an actual
  // horizontal clip is not a gate.
  let probeDetected = null;
  if (!skipped) {
    const probePath = path.join(os.tmpdir(), `ppc-pagefit-probe-${process.pid}.html`);
    const injected = rawHtml.replace(/(<div class="page(?=[ "])[^>]*>)/,
      '$1<div style="overflow:hidden;width:200px;"><div style="width:4000px;">PPC PAGE-FIT NON-VACUITY PROBE</div></div>');
    fs.writeFileSync(probePath, injected);
    const probe = spawnSync(process.execPath,
      [path.resolve(repoRoot, 'scripts/planset-pagefit.mjs'), probePath],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    probeDetected = probe.status !== 0 && /internal-clipped-h=[1-9]/.test(String(probe.stdout || ''));
    try { fs.unlinkSync(probePath); } catch { /* best effort */ }
  }
  gate(17, 'page-fit-detects-horizontal-and-vertical-clipping',
    skipped ? false : pf.status === 0 && bothAxes && probeDetected === true,
    skipped
      ? 'playwright/chromium unavailable — the page-fit gate CANNOT be satisfied without the geometry validator'
      : `pagefit exit=${pf.status} axes=${axes.join('+') || 'none'} sheets=${pageFitReport?.sheets ?? '?'} `
        + `clippedV=${pageFitReport?.clipped ?? '?'} internalV=${pageFitReport?.internalClipped ?? '?'} `
        + `clippedH=${pageFitReport?.clippedHorizontal ?? '?'} internalH=${pageFitReport?.internalClippedHorizontal ?? '?'} `
        + `horizontalDetectionProbeFired=${probeDetected}`,
    { pageFit: pageFitReport ? {
      sheets: pageFitReport.sheets, clipped: pageFitReport.clipped, internalClipped: pageFitReport.internalClipped,
      clippedHorizontal: pageFitReport.clippedHorizontal, internalClippedHorizontal: pageFitReport.internalClippedHorizontal,
      tolInches: pageFitReport.tolInches, tolInchesHorizontal: pageFitReport.tolInchesHorizontal,
      worst: (pageFitReport.perSheet ?? []).map(s => ({ sheetId: s.sheetId, belowByIn: s.belowByIn, rightByIn: s.rightByIn })),
    } : null, horizontalDetectionProbeFired: probeDetected });
  try { fs.unlinkSync(pfJson); } catch { /* best effort */ }
}

// ═══ GATE 18 — report == rendered (zero mismatches) ═════════════════════════
const mismatches = [];
{
  const rcheck = (name, canonical, matched, extra) => {
    if (!matched) mismatches.push({ name, canonical: `${canonical}`, ...(extra ?? {}) });
  };
  const t = flat(noB64);
  const projField = (field) => [...new Set(
    [...rawHtml.matchAll(new RegExp(`data-project-field="${field}">([^<]*)<`, 'g'))].map(m => decode(m[1]).trim()))];
  const ids = projField('snapshot-id');
  rcheck('snapshotId', meta.snapshotId, ids.length > 0 && ids.every(v => v === meta.snapshotId), { rendered: ids });
  const digs = projField('digest');
  rcheck('digestPrefix', String(meta.digest || '').slice(0, 12),
    digs.length > 0 && digs.every(v => v && String(meta.digest || '').startsWith(v)), { rendered: digs });
  // RGM §4 — the rendered count is now the UNRESOLVED REQUIREMENT count.
  rcheck('blockingCount', blockingCodes.length,
    Number((rs1.match(/(\d+)\s+UNRESOLVED REQUIREMENT/) ?? [])[1] ?? NaN) === blockingCodes.length);
  // grounding — the OUTCOME, not a fixed result
  if (gnd?.outcome) {
    rcheck('groundingOutcome', gnd.outcome,
      gnd.outcome !== 'PENDING_MANUFACTURER_AUTHORITY'
      || (t.includes('PENDING MANUFACTURER AUTHORITY') && t.includes('INSTALLED OPEN-AIR EGC: NOT ASSERTED')));
    rcheck('groundingBomRowState', gnd.bomRowState,
      gnd.bomRowState !== 'design-quantity-non-orderable' || /CANDIDATE DESIGN QUANTITY/i.test(t));
    if (gnd.bomFootageFt != null && gnd.outcome === 'PENDING_MANUFACTURER_AUTHORITY') {
      rcheck('candidateEgcFootage', gnd.bomFootageFt, t.includes(`${gnd.bomFootageFt}`));
    }
  }
  // spacing authority
  const spc = snap.structural?.spacingAuthority ?? null;
  if (spc?.designSpacingIn != null) {
    rcheck('spacingDesignValue', spc.designSpacingIn,
      new RegExp(`DESIGN ATTACHMENT SPACING:\\s*${spc.designSpacingIn} IN\\. O\\.C\\.`).test(t));
    rcheck('spacingVerificationState', spc.verificationState,
      spc.verificationState === 'verified' ? /MAXIMUM ALLOWED/i.test(t) : !/MAXIMUM ALLOWED/i.test(t));
  }
  // procurement sufficiency
  if (ps) {
    rcheck('procurementInsufficient', ps.insufficient,
      ps.insufficient
        ? t.includes('QCABLE-PROCUREMENT-INSUFFICIENT')
        : !/DEFICIT \d+(\.\d+)? FT/.test(t));
    if (ps.insufficient) {
      rcheck('procurementDeficitFt', ps.deficitFt, t.includes(`DEFICIT ${ps.deficitFt} FT`));
      rcheck('procurementBaseFt', ps.procurementLengthFt, t.includes(`CURRENT BASE ${ps.procurementLengthFt} FT`));
      rcheck('procurementDesignedFt', ps.totalDesignedInstalledFt, t.includes(`DESIGNED-INSTALLED ${ps.totalDesignedInstalledFt} FT`));
    }
  }
  // procurement totals — the rendered numbers vs the rendered row tags
  const blockedRows = populationBlocked.length;
  // ECD §1: the rendered authoritative total is the state-derived counter tag,
  // not a "N of M BOM line items" sentence (that sentence class is retired).
  const orderableStateCount = stateCountsRendered.find(s => s.state === 'VERIFIED_ORDERABLE')?.count ?? NaN;
  rcheck('authoritativeProcurementTotal', procTotal,
    orderableStateCount === procTotal, { renderedStateCount: orderableStateCount });
  rcheck('procurementPartitionExact', `${procTotal}+${procExcluded}`,
    Number.isFinite(populationTotal) && procTotal + procExcluded === populationTotal,
    { renderedPopulationTotal: populationTotal });
  rcheck('procurementExcludedCoversTaggedRows', blockedRows, procExcluded >= blockedRows, { rendered: procExcluded });
  // issue state
  rcheck('issueStateLanguage', pa?.issueState ?? '—',
    !hasBlocking || !/\bapproved design\b/i.test(t));
  // interconnection topology
  rcheck('interconnectionRule', snap.project?.interconnection?.rule ?? '—',
    snap.project?.interconnection?.rule !== '705.11' || !/705\.12\(D\)/.test(t));
  gate(18, 'report-equals-rendered-zero-mismatches', mismatches.length === 0,
    `${mismatches.length} mismatch(es)${mismatches.length ? ': ' + mismatches.map(m => m.name).join(', ') : ''}`,
    { mismatches });
}

// ═══ assemble + emit ═══════════════════════════════════════════════════════
gates.sort((a, b) => a.gate - b.gate);
const failed = gates.filter(g => !g.ok);
const report = {
  generatedAt: new Date().toISOString(),
  harness: 'planset-evidence-ppc (projection / procurement authority, 18 permanent gates)',
  directive: 'docs/PROJECTION-PROCUREMENT-CORRECTIVE-DIRECTIVE.md',
  mode: MODE,
  htmlPath: path.relative(repoRoot, htmlPath).replace(/\\/g, '/'),
  snapshotId: meta.snapshotId, digest: meta.digest,
  sheetCount: pages.length, sheetIds,
  blockerRegistry: {
    blockingCount: blockingCodes.length, advisoryCount: advisoryCodes.length,
    blockingCodes, advisoryCodes, issueState: pa?.issueState ?? null, ready: pr.ready ?? null,
  },
  procurementSufficiency: ps ? {
    insufficient: ps.insufficient, totalDesignedInstalledFt: ps.totalDesignedInstalledFt,
    requiredServiceLoopAllowanceFt: ps.requiredServiceLoopAllowanceFt,
    allowanceProvenance: ps.allowanceProvenance,
    thresholdFt: ps.thresholdFt, procurementLengthFt: ps.procurementLengthFt, deficitFt: ps.deficitFt,
    verificationStatus: ps.verificationStatus,
  } : null,
  openAirGrounding: gnd ? {
    outcome: gnd.outcome, verificationStatus: gnd.verificationStatus,
    bomRowState: gnd.bomRowState, nonOrderable: gnd.nonOrderable,
  } : null,
  procurementApproval: {
    renderedAuthoritativeTotal: Number.isFinite(procTotal) ? procTotal : null,
    renderedExcluded: Number.isFinite(procExcluded) ? procExcluded : null,
    renderedPartial: procPartial,
    // ECD §1/§10 — the per-row exclusion ENUMERATION is retired; the population,
    // the per-row states and the five state counts replace it.
    renderedPopulationTotal: Number.isFinite(populationTotal) ? populationTotal : null,
    populationRowCount: populationRows.length,
    blockedRowCount: populationBlocked.length,
    renderedStateCounts: stateCountsRendered,
    taggedBomRows: bomRows.length,
  },
  pageFit: pageFitReport ? {
    axes: pageFitReport.axes, sheets: pageFitReport.sheets,
    clipped: pageFitReport.clipped, internalClipped: pageFitReport.internalClipped,
    clippedHorizontal: pageFitReport.clippedHorizontal,
    internalClippedHorizontal: pageFitReport.internalClippedHorizontal,
  } : null,
  reportEqualsRendered: { mismatches },
  vacuityNotes: vacuous,
  gates,
  summary: {
    total: gates.length, passed: gates.length - failed.length,
    failed: failed.map(g => `gate ${g.gate}: ${g.id}`), allPass: failed.length === 0,
  },
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`[ppc-evidence:${MODE}] ${outPath} — snapshot ${meta.snapshotId} (${pages.length} sheets, `
  + `${blockingCodes.length} blocking)`);
for (const g of gates) {
  console.log(`[ppc-evidence:${MODE}] ${g.ok ? 'PASS' : 'FAIL'} gate ${String(g.gate).padStart(2)} ${g.id} — ${g.detail}`);
}
if (vacuous.length) console.log(`[ppc-evidence:${MODE}] vacuity notes: ${vacuous.join(' · ')}`);
console.log(`[ppc-evidence:${MODE}] ${report.summary.passed}/${report.summary.total} gates pass`);
if (failed.length) {
  console.error(`[ppc-evidence:${MODE}] BLOCKING FAILURES: ${report.summary.failed.join(' | ')}`);
  process.exit(2);
}
process.exit(0);
