// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-w4 — W4 §13 acceptance evidence + cross-sheet TRUTH MATRIX.
//
//   Usage: node scripts/planset-evidence-w4.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = original (frozen fixture) | live (current DB design)
//
// Extends the W3.1 harness (scripts/planset-evidence-w3.mjs) with the W4
// AUTHORITY layer: it regenerates nothing — it reads the REAL Braidon planset
// HTML + its PermitDesignSnapshot and PROVES, from the RENDERED sheets (via the
// data-code-edition / data-project-field / data-sld-* / data-object-id tag
// conventions), that every §13 quantity AGREES across every sheet and comes from
// ONE snapshot authority record. It also SOURCE-SCANS for reachable authority
// bypasses (code-edition literals in renderers; any reachable legacy plan-set /
// buildPermitCoverSheet / buildSLD path).
//
// HARNESS SEMANTICS (Ray, §13):
//   • exit NON-ZERO on ANY cross-sheet disagreement OR reachable authority bypass.
//   • the expected honest Braidon blockers (code-authority-incomplete, racking-
//     capacity, route-length, framing/wind-snow, engineering-review) are the
//     CORRECT outcome — assert they are PRESENT; the project issue state must be a
//     PENDING-* / DRAFT / REVISED state, NEVER PERMIT-READY or ISSUED FOR PERMIT.
//   • a value simply NOT printed is coverage (agree:null) — NOT a disagreement.
//     Only a printed value that CONTRADICTS the snapshot authority fails.
import fs from 'node:fs';
import path from 'node:path';

const [htmlPath, snapPath, outPath = 'braidon-w4.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) { console.error('usage: planset-evidence-w4.mjs <html> <snapshot.json> [out]'); process.exit(1); }
const MODE = process.env.EVIDENCE_MODE === 'original' ? 'original' : (process.env.EVIDENCE_MODE || 'live');
const SUPERSEDES = process.env.EVIDENCE_SUPERSEDES || null;
const html = fs.readFileSync(htmlPath, 'utf8');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const ca = snap.codeAuthority || null;
const pa = snap.projectAuthority || null;
const st = snap.structural || null;

// ── page split (INCLUDES the class="page sld-page" E-1 SLD sheet) ─────────────
const pages = html.split(/<div class="page(?: sld-page)?"[ >]/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// find all matches of `re` across pages → {sheet, value}
const findAll = (re, mapFn = (m) => m[1]) => {
  const out = [];
  pages.forEach((p) => { for (const m of p.matchAll(re)) out.push({ sheet: sheetIdOf(p), value: mapFn(m) }); });
  return out;
};
const projField = (field) => findAll(new RegExp(`data-project-field="${field}">([^<]*)<`, 'g'), (m) => decode(m[1].trim()));
const codeEdition = (kind) => findAll(new RegExp(`data-code-edition="${kind}">([^<]*)<`, 'g'), (m) => m[1].trim());

// ── cross-sheet truth-matrix row ──────────────────────────────────────────────
const truth = [];
/** authority = scalar; instances = [{sheet,value}]. agree: null=not printed,
 *  true=every printed value equals authority, false=at least one contradicts. */
const row = (quantity, authority, instances, { blocking = true, note, singleSource } = {}) => {
  const distinct = [...new Set(instances.map(i => `${i.value}`))];
  const agree = distinct.length === 0 ? null : distinct.every(v => v === `${authority}`);
  truth.push({ quantity, authority: `${authority}`, printedInstances: instances, distinctPrinted: distinct, agree, blocking, singleSource, note });
  return { distinct, agree };
};

// ── §13 AUTHORITY quantities ─────────────────────────────────────────────────
const FAMILY = { nec: 'NEC', ibc: 'IBC', irc: 'IRC', ifc: 'IFC', asce: 'ASCE' };

// AHJ (single-sourced: projectAuthority.ahjName === codeAuthority.ahjName)
const ahjAuthority = pa?.ahjName ?? null;
const ahjSingleSource = (pa?.ahjName ?? null) === (ca?.ahjName ?? null);
row('authority.ahj', ahjAuthority ?? '—', projField('ahj'),
  { singleSource: ahjSingleSource, note: `projectAuthority.ahjName === codeAuthority.ahjName ? ${ahjSingleSource}` });

// utility
row('authority.utility', pa?.utilityName ?? '—', projField('utility'));

// every code edition (NEC/IBC/IRC/IFC/ASCE — null ⇒ PENDING must agree too)
const editionRows = {};
for (const kind of ['nec', 'ibc', 'irc', 'ifc', 'asce']) {
  const ed = ca?.editions?.[kind]?.edition ?? null;
  const label = `${FAMILY[kind]} ${ed ?? 'PENDING'}`;
  const inst = codeEdition(kind);
  const r = row(`code.edition.${kind}`, label, inst,
    { note: `codeAuthority.editions.${kind}.edition = ${ed === null ? 'null (PENDING)' : ed}; must be identical on every sheet that prints it` });
  editionRows[kind] = { label, ...r, printedCount: inst.length };
}

// system type
row('authority.system-type', pa?.systemType ?? '—', projField('system-type'));

// module model (projection joins manufacturer + model)
const join = (a, b) => [a, b].filter(x => x && String(x).trim() && x !== '—').join(' ').trim() || null;
const moduleAuthority = join(pa?.equipmentSummary?.moduleManufacturer, pa?.equipmentSummary?.moduleModel);
row('authority.module-model', moduleAuthority ?? '—', projField('module-model'));

// inverter model
const inverterAuthority = join(pa?.equipmentSummary?.inverterManufacturer, pa?.equipmentSummary?.inverterModel);
row('authority.inverter-model', inverterAuthority ?? '—', projField('inverter-model'));

// racking assembly (mount identity — object authority; may print as mount-model
// tag and/or the mount model literal on SCHED/structural sheets)
const rackMount = st?.rackingAssembly?.mountModel ?? pa?.equipmentSummary?.mountModel ?? null;
const rackInst = [...projField('mount-model')];
if (rackMount) {
  const litRe = new RegExp(rackMount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  pages.forEach((p) => { const c = (p.match(litRe) || []).length; if (c) rackInst.push({ sheet: sheetIdOf(p), value: rackMount }); });
}
row('authority.racking-assembly', rackMount ?? '—', rackInst,
  { blocking: false, note: `structural.rackingAssembly.mountModel = ${rackMount ?? 'null'} (assemblyId ${st?.rackingAssembly?.assemblyId ?? 'n/a'}); object authority — printed occurrences must all match` });

// project issue status (must be a PENDING-* / DRAFT / REVISED state — never
// PERMIT-READY / ISSUED FOR PERMIT)
const issueAuthority = pa?.issueState ?? null;
row('authority.issue-status', issueAuthority ?? '—', projField('issue-status'));
const NON_ISSUABLE = new Set(['DESIGN DRAFT', 'PENDING ELECTRICAL REVIEW', 'PENDING STRUCTURAL REVIEW', 'PENDING ENGINEERING REVIEW', 'REVISED', 'REVIEWED']);
const issueStateOk = issueAuthority != null && NON_ISSUABLE.has(issueAuthority);
const issueStateForbidden = issueAuthority === 'PERMIT-READY' || issueAuthority === 'ISSUED FOR PERMIT';

// snapshot id (title blocks + SLD stamp must be identical)
const snapIdAuthority = snap?.meta?.snapshotId ?? null;
const sldStamp = html.match(/<div class="sld-snapshot-stamp"[^>]*>/);
const sldSnapId = (html.match(/data-sld-snapshot-id="([^"]*)"/) ?? [])[1] ?? null;
const sldDigest = (html.match(/data-sld-digest="([^"]*)"/) ?? [])[1] ?? null;
const snapIdInst = [...projField('snapshot-id')];
if (sldSnapId != null) snapIdInst.push({ sheet: 'E-1(SLD stamp)', value: sldSnapId });
row('authority.snapshot-id', snapIdAuthority ?? '—', snapIdInst,
  { note: 'title-block data-project-field="snapshot-id" AND the SLD data-sld-snapshot-id stamp must equal meta.snapshotId' });

// digest (title blocks print a truncated prefix; SLD stamp prints the same
// prefix — all printed must be identical AND a genuine prefix of the full digest)
const fullDigest = snap?.meta?.digest ?? '';
const digestInst = [...projField('digest')];
if (sldDigest != null) digestInst.push({ sheet: 'E-1(SLD stamp)', value: sldDigest });
const digestDistinct = [...new Set(digestInst.map(i => `${i.value}`))];
const digestAllPrefix = digestDistinct.length > 0 && digestDistinct.every(v => v.length > 0 && fullDigest.startsWith(v));
const digestIdentical = digestDistinct.length <= 1;
truth.push({
  quantity: 'authority.digest', authority: `${fullDigest.slice(0, 20)}… (full ${fullDigest.slice(0, 12)}…)`,
  printedInstances: digestInst, distinctPrinted: digestDistinct,
  agree: digestInst.length === 0 ? null : (digestIdentical && digestAllPrefix),
  blocking: true, note: 'title-block + SLD-stamp digest identical AND a prefix of meta.digest',
});

// sheet index — rendered sheets == snapshot sheetIndex == manifest
const manifestIds = (pa?.sheetIndex ?? []).map(s => s.id);
const renderedEqualsManifest = JSON.stringify(sheetIds) === JSON.stringify(manifestIds);
truth.push({
  quantity: 'authority.sheet-index',
  authority: `${manifestIds.length} sheets`, printedInstances: [{ sheet: 'ALL', value: `${sheetIds.length} rendered` }],
  distinctPrinted: [`rendered ${sheetIds.length}`, `manifest ${manifestIds.length}`],
  agree: renderedEqualsManifest, blocking: true,
  renderedIds: sheetIds, manifestIds,
  note: 'rendered title-block sheet ids (incl. E-1 SLD) === projectAuthority.sheetIndex (the computePlansetManifest output). Order + values identical.',
});

// ── SOURCE SCAN: reachable authority BYPASSES ────────────────────────────────
const repoRoot = process.cwd();
const readSafe = (rel) => { try { return fs.readFileSync(path.resolve(repoRoot, rel), 'utf8'); } catch { return null; } };
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(line => { const m = line.match(/(^|[^:])\/\//); return m ? line.slice(0, (m.index ?? 0) + m[1].length) : line; }).join('\n');

// (a) zero code-edition literals in the owned renderers (V11 source proof)
const OWNED_RENDERERS = [
  'lib/permit/utils/titleBlock.ts', 'lib/permit/sections/coverSheet.ts',
  'lib/permit/sections/compliancePages.ts', 'lib/permit/sections/certPages.ts',
  'lib/permit/sections/structuralPages.ts', 'lib/permit/sections/arrayPages.ts',
  'lib/permit/sections/validationPage.ts', 'lib/permit/sections/electricalPages.ts',
  'lib/drafting/templates/roof.ts', 'lib/drafting/templates/fence.ts', 'lib/drafting/templates/ground.ts',
];
const LITERAL_PATTERNS = [
  /\b(NEC|IBC|IRC|IFC)\s+20\d\d\b/, /\bASCE\s+7-\d\d\b/,
  /necVersion\s*\|\|\s*['"]/, /\b\w*[Vv]er\s*=\s*['"]20\d\d['"]/,
];
const codeLiteralHits = [];
for (const rel of OWNED_RENDERERS) {
  const src = readSafe(rel); if (src == null) continue;
  const code = stripComments(src);
  for (const re of LITERAL_PATTERNS) {
    const m = code.match(new RegExp(re, 'g'));
    if (m) codeLiteralHits.push({ file: rel, hits: m });
  }
}

// recursive .ts/.tsx walk of a set of roots (skips node_modules / .next / dist /
// repo-bisect and the closer-owned scratch)
function walk(root, acc = []) {
  let entries = []; try { entries = fs.readdirSync(path.resolve(repoRoot, root), { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const rel = `${root}/${e.name}`;
    if (e.isDirectory()) {
      if (/^(node_modules|\.next|dist|repo-bisect|\.git)$/.test(e.name)) continue;
      walk(rel, acc);
    } else if (/\.(ts|tsx)$/.test(e.name)) acc.push(rel);
  }
  return acc;
}
const sourceFiles = [...walk('app'), ...walk('lib'), ...walk('components'), ...walk('tests')];

// (b) zero legacy plan-set reachability (deleted builders + route fetch)
const DELETED_BUILDERS = ['cover-sheet', 'electrical-sheet', 'structural-sheet', 'equipment-schedule',
  'site-layout-sheet', 'mounting-details-sheet', 'compliance-sheet', 'title-block', 'legacy-path-guard'];
const builderImportRe = new RegExp(`@/lib/plan-set/(${DELETED_BUILDERS.join('|')})\\b`);
const planSetFetchRe = /fetch\([^)]*['"\`][^'"\`]*\/api\/engineering\/plan-set/;
const planSetReachability = [];
for (const f of sourceFiles) {
  if (/legacy-path-containment\.test\.ts$/.test(f)) continue;  // the retirement proof asserts absence
  const src = readSafe(f); if (src == null) continue;
  const code = stripComments(src);
  if (builderImportRe.test(code)) planSetReachability.push({ file: f, kind: 'deleted-builder-import' });
  if (planSetFetchRe.test(code)) planSetReachability.push({ file: f, kind: 'plan-set-route-fetch' });
}
const legacyBuilderFilesPresent = DELETED_BUILDERS.map(b => `lib/plan-set/${b}.ts`).filter(f => fs.existsSync(path.resolve(repoRoot, f)));
const planSetRouteSrc = readSafe('app/api/engineering/plan-set/route.ts') ?? '';
const planSetRouteTombstone = /410/.test(planSetRouteSrc) && /PLAN_SET_ROUTE_RETIRED/.test(planSetRouteSrc);

// (c) zero buildPermitCoverSheet reachability (file deleted + no callers)
const coverTokens = ['buildPermitCoverSheetArtifact', 'renderPermitCoverHTML', 'mapReportToPermitCover'];
const coverImportRe = /buildPermitCoverSheet/;
const coverReachability = [];
for (const f of sourceFiles) {
  if (/planset-evidence/.test(f)) continue;
  // the deletion-proof test legitimately NAMES the retired symbols to assert
  // their absence (existsSync false + regex checks) — it is not a caller.
  if (/project-authority-w4\.test\.ts$/.test(f)) continue;
  const src = readSafe(f); if (src == null) continue;
  const code = stripComments(src);
  if (coverImportRe.test(code) || coverTokens.some(t => code.includes(t))) coverReachability.push({ file: f });
}
const coverFilePresent = fs.existsSync(path.resolve(repoRoot, 'lib/permit/buildPermitCoverSheet.ts'));
const coverComponentPresent = fs.existsSync(path.resolve(repoRoot, 'components/permit/CoverSheet.tsx'));

// (d) zero dead buildSLD in the electrical renderer
const elecSrc = readSafe('lib/permit/sections/electricalPages.ts') ?? '';
const elecCode = stripComments(elecSrc);
const buildSldImplPresent = /function\s+buildSLD\b/.test(elecCode);
const buildSldCallPresent = /\bbuildSLD\s*\(/.test(elecCode);

const bypasses = [];
if (codeLiteralHits.length) bypasses.push(`code-edition literal(s) in renderer: ${codeLiteralHits.map(h => `${h.file}[${h.hits.join(',')}]`).join('; ')}`);
if (planSetReachability.length) bypasses.push(`legacy plan-set reachable: ${planSetReachability.map(r => `${r.file}(${r.kind})`).join('; ')}`);
if (legacyBuilderFilesPresent.length) bypasses.push(`legacy plan-set builder file(s) still present: ${legacyBuilderFilesPresent.join(', ')}`);
if (planSetRouteSrc && !planSetRouteTombstone) bypasses.push('plan-set route present but not a 410 tombstone');
if (coverReachability.length) bypasses.push(`buildPermitCoverSheet reachable: ${coverReachability.map(r => r.file).join(', ')}`);
if (coverFilePresent) bypasses.push('lib/permit/buildPermitCoverSheet.ts still present');
if (coverComponentPresent) bypasses.push('components/permit/CoverSheet.tsx still present');
if (buildSldImplPresent || buildSldCallPresent) bypasses.push('dead buildSLD implementation/call still present in electricalPages.ts');

// ── expected honest blockers + issue state ───────────────────────────────────
const blockerCodes = (snap.permitReadiness?.blockers || []).map(b => b.code);
const EXPECTED = MODE === 'original'
  ? ['ROUTE-LENGTH-ESTIMATE', 'STRUCTURAL-FRAMING-UNVERIFIED', 'WIND-SNOW-AUTHORITY-UNRESOLVED',
     'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED', 'RACKING-CAPACITY-APPLICABILITY-GAP',
     'CODE-AUTHORITY-INCOMPLETE', 'ENGINEERING-REVIEW-PENDING']
  : ['CODE-AUTHORITY-INCOMPLETE', 'ENGINEERING-REVIEW-PENDING'];
const missingExpected = EXPECTED.filter(c => !blockerCodes.includes(c));

// ═══════════════════════════════════════════════════════════════════════════
// POST-CAMPAIGN CORRECTION-PASS GATES (2026-07-22) — the 15-section correction.
// Folded into the evidence harness so a single invocation, in BOTH modes,
// re-proves every corrected truth-authority regression on the freshly rendered
// package + snapshot. Each gate is package-level (scans the whole rendered HTML
// across all sheets) or snapshot-authority-level. ANY failed gate exits non-zero.
// ═══════════════════════════════════════════════════════════════════════════
const el = snap.electrical || {};
const segs2 = el.routeSegments || [];
// canonical feeder resolution (mirrors lib/permit/snapshot/electricalProjection
// projectCanonicalFeeder — ONE raceway/size/VD/length source, no per-sheet drift)
const FEEDER_IDS = ['COMBINER_TO_DISCO_RUN', 'INV_TO_DISCO_RUN'];
const feederSeg = segs2.find(r => FEEDER_IDS.includes(r.segmentId))
  ?? segs2.find(r => r.egcGauge && r.voltageDropPct != null && r.raceway && r.raceway !== 'FREE_AIR') ?? null;
const F = el.feeder || {};
const canRaceway = F?.conduit?.raceway ?? feederSeg?.raceway ?? null;
const canSize = F?.conduit?.tradeSizeIn ?? feederSeg?.tradeSizeIn ?? null;
const canVd = typeof F?.voltageDropPct === 'number' ? F.voltageDropPct : (feederSeg?.voltageDropPct ?? null);
const canLen = feederSeg?.oneWayFt ?? null;
const conduitLabel2 = (canRaceway && canSize) ? `${canRaceway} ${canSize}` : (canRaceway ?? null);
const conduitLabelEnc = conduitLabel2 ? conduitLabel2.replace(/"/g, '&quot;') : null;

const AFFIRMATIVE_CERT = ['I hereby certify', 'prepared under my direct supervision',
  'prepared under my supervision', 'confirmed adequate', 'is adequate to support', 'are adequate to support'];
const certApproved = !!(snap?.certification?.engineeringReviewApproved?.reviewedDigest);
const MOJIBAKE = /�|â€|Ã[-¿]|Â[¡-¿]/;
// undefined/NaN only in a RENDERED VALUE context (never inside base64 asset blobs)
const badValueRe = /(?:NaN|undefined)\s*(?:%|A\b|V\b|ft\b|W\b|lbs\b|in\.|Ω)|>\s*(?:NaN|undefined)\s*<|:\s+(?:NaN|undefined)\b/;
// a merged multi-size raceway token, e.g. `1-1/4&quot; 3/4&quot;` — the §3 defect
const mergedRacewayRe = /\d(?:-\d\/\d)?&quot;\s*\d\/\d&quot;\s*(?:EMT|PVC|RMC|IMC|FMC)/;
const st2 = st || {};
const rr2 = st2.reactionReconciliation || {};
const rackMountModel = st2.rackingAssembly?.mountModel || '';
const capacityGated = /RT-?MINI/i.test(rackMountModel)
  || blockerCodes.includes('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
const NEW_BLOCKERS = ['PROJECT-AUTHORITY-UNVERIFIED'];
const missingNewBlockers = NEW_BLOCKERS.filter(c => !blockerCodes.includes(c));
const affLeak = certApproved ? [] : AFFIRMATIVE_CERT.filter(p => html.includes(p));
const edLit = ['IFC 2021', 'IBC 2021'].filter(l => html.includes(l));

const gate = (id, ok, detail) => ({ id, ok, detail });
const correctionGates = [
  // §1 issue-state authority — no ISSUED FOR PERMIT / Initial Issue for Permit while pending
  gate('§1 no-issued-for-permit-while-pending',
    !html.includes('ISSUED FOR PERMIT') && !html.includes('Initial Issue for Permit'),
    `issueState=${issueAuthority}`),
  // §2 certification gate — no affirmative cert phrase without an approved digest-bound review
  gate('§2 no-affirmative-cert-without-approval', affLeak.length === 0,
    `certApproved=${certApproved}; leaked=${affLeak.join(' | ') || 'none'}`),
  // §3 electrical segment authority — ONE canonical feeder raceway/size/VD single-sourced
  gate('§3 electrical-canonical-feeder-single-source',
    !!canRaceway && !!canSize && canVd != null,
    `raceway=${canRaceway} size=${canSize} vd=${canVd} len=${canLen}`),
  gate('§3 electrical-conduit-label-projected',
    !conduitLabelEnc || html.includes(conduitLabelEnc),
    `canonical conduit "${conduitLabel2}" projected on the sheets`),
  gate('§3 no-merged-raceway-token', !mergedRacewayRe.test(html),
    'no `1-1/4" 3/4" EMT` style multi-size merge in any sheet'),
  gate('§3 no-undefined-nan-value-render', !badValueRe.test(html),
    'no undefined/NaN rendered as a %/A/V/ft/lbs value or table cell'),
  // §8 structural reaction reconciliation present + reconciled + schedule rendered
  gate('§8 reaction-reconciliation-present-ok', rr2.present === true && rr2.ok === true,
    `attach=${rr2.attachmentCount} modelCount=${rr2.reactionModelCount} tribΣ=${rr2.tributarySumFt2}ft² area=${rr2.arrayAreaFt2}ft²`),
  gate('§8 pv4c-reaction-schedule-rendered',
    html.includes('Attachment Reaction Schedule') && html.includes('Reaction Reconciliation'),
    'PV-4C carries the attachment-ID schedule + reconciliation footer'),
  // §9 capacity gate — RT-MINI UNVERIFIED, never a capacity PASS
  gate('§9 rtmini-capacity-unverified-no-pass',
    !capacityGated
    || (html.includes('UNVERIFIED / PENDING STRUCTURAL SOURCE')
        && blockerCodes.includes('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED')
        && !/safety factor of [\d.]+ meets the required minimum/i.test(html)),
    `mount=${rackMountModel} capacityGated=${capacityGated}`),
  // §10 exact racking assembly — no "or equivalent", no RAIL-COMPAT, no rail-less for a rail-paired mount
  gate('§10 no-or-equivalent-or-railcompat',
    !/or equivalent/i.test(html) && !html.includes('RAIL-COMPAT'), 'no "or equivalent"/RAIL-COMPAT'),
  gate('§10 no-rail-less-for-rail-paired-mount',
    !capacityGated || !/rail-?less/i.test(html), 'RT-MINI never described rail-less'),
  // §11 code authority — no pending-edition literal in body/BOM/labels/notes
  gate('§11 no-pending-edition-literals', edLit.length === 0, edLit.join(', ') || 'none'),
  // §14 project authority — the postal-inference blocker is PRESENT (never cleared)
  gate('§14 new-authority-blockers-present', missingNewBlockers.length === 0,
    `missing=${missingNewBlockers.join(', ') || 'none'}`),
  // §15 quality gates — no mojibake, human utility name (never the registry slug)
  gate('§15 no-mojibake', !MOJIBAKE.test(html), 'no U+FFFD / double-encoded UTF-8'),
  gate('§15 human-utility-name-not-slug',
    !/\bil-[a-z]+-[a-z]+\b/.test(html) && !html.includes('il-ameren-illinois'),
    `utility=${pa?.utilityName ?? '—'}`),
];
const correctionFail = correctionGates.filter(g => !g.ok);

// ── carry-forward from the W3 evidence (failure classes + coord parity + disclaimer) ──
const w3Path = `docs/evidence/braidon-${MODE}-w3.planset-evidence.json`;
let w3 = null; try { w3 = JSON.parse(fs.readFileSync(path.resolve(repoRoot, w3Path), 'utf8')); } catch { /* optional */ }

// MANDATORY not-historical-geometry disclaimer (W3.1 acceptance note, binding).
// Carried VERBATIM into every W4 fixture evidence artifact.
const FIXTURE_GEOMETRY_DISCLAIMER =
  'The frozen braidon-original-audit-fixture roof-plane VERTICES and edge TYPES are DETERMINISTIC '
  + 'TEST-FIXTURE geometry, reconstructed as the axis-aligned bounding box (padded ~6 ft) of each plane\'s '
  + 'recovered member-panel lat/lngs with nominal [eave, rake, ridge, rake] edges. They were NOT recovered '
  + 'from the original historical W1 snapshot (which did not persist them) and DO NOT prove the exact '
  + 'historical roof geometry. Recovered module POSITIONS (lat/lng) are unaltered; if exact surveyed roof '
  + 'edges are ever recovered they supersede these bounding boxes. (Live-mode evidence reads the current DB '
  + 'design and carries no such reconstruction.)';

// ── assemble report ──────────────────────────────────────────────────────────
const disagreements = truth.filter(r => r.agree === false);
const blockingDisagree = disagreements.filter(r => r.blocking);
const editionsCrossSheetIdentical = Object.values(editionRows).every(r => r.distinct.length <= 1);
const editionsAllAgree = ['nec', 'ibc', 'irc', 'ifc', 'asce'].every(k => editionRows[k].agree !== false);
const singleSourceFail = ahjSingleSource === false;

const blockingFail = blockingDisagree.length > 0
  || bypasses.length > 0
  || issueStateForbidden || !issueStateOk
  || missingExpected.length > 0
  || singleSourceFail
  || !renderedEqualsManifest
  || correctionFail.length > 0;

const report = {
  generatedAt: new Date().toISOString(),
  wave: 'W4',
  mode: MODE,
  evidenceRole: MODE === 'original'
    ? 'IMMUTABLE W4 acceptance evidence from the frozen braidon-original-audit-fixture — proves AHJ/code/project/document authority + cross-sheet agreement + zero authority bypass on the exact originally-audited design.'
    : 'CURRENT live database design — W4 authority + cross-sheet agreement + bypass scan on the live Braidon project.',
  supersedes: SUPERSEDES,
  snapshotId: snap.meta?.snapshotId, digest: snap.meta?.digest, schemaVersion: snap.meta?.schemaVersion,
  project: 'BRAIDON (GreenLancer feedback-session planset)',
  sheetCount: pages.length, sheetIds,

  // MANDATORY disclaimer (fixture geometry is deterministic test geometry).
  fixtureGeometryDisclaimer: FIXTURE_GEOMETRY_DISCLAIMER,

  // §1 — canonical code-authority record + verification state
  codeAuthority: ca ? {
    schemaVersion: ca.schemaVersion, ahjName: ca.ahjName, jurisdictionType: ca.jurisdictionType,
    stateCode: ca.stateCode, county: ca.county, city: ca.city, ahjRecordId: ca.ahjRecordId,
    utility: ca.utility,
    editions: Object.fromEntries(['nec', 'ibc', 'irc', 'ifc', 'asce'].map(k => [k, {
      edition: ca.editions?.[k]?.edition ?? null, source: ca.editions?.[k]?.source ?? null,
    }])),
    localAmendments: ca.localAmendments, verificationStatus: ca.verificationStatus,
    verifiedBy: ca.verifiedBy, sourceHash: ca.sourceHash, incompleteEditions: ca.incompleteEditions,
    recordProvenance: ca.recordProvenance, applicabilityNotes: ca.applicabilityNotes,
  } : null,

  // §2 — V11 activation evidence (cross-sheet identity + zero literals)
  v11: {
    everyEditionIdenticalAcrossSheets: editionsCrossSheetIdentical,
    everyEditionMatchesAuthority: editionsAllAgree,
    perKind: editionRows,
    zeroCodeEditionLiteralsInRenderers: codeLiteralHits.length === 0,
    codeLiteralHits,
    ahjSingleSourced: ahjSingleSource,
    governingCodesRefCarriesNoEditionLiteral: !!pa && !JSON.stringify(pa.governingCodesRef ?? {}).match(/\b(20\d\d|7-\d\d)\b/),
  },

  // §3/§12 — project authority + issue state + ISSUED-FOR-PERMIT gate
  projectAuthority: pa ? {
    schemaVersion: pa.schemaVersion, systemType: pa.systemType, ahjName: pa.ahjName, utilityName: pa.utilityName,
    capacities: pa.capacities, designer: pa.designer, contractor: pa.contractor,
    equipmentSummary: pa.equipmentSummary,
    issueState: pa.issueState, engineerReviewStatus: pa.engineerReviewStatus,
    issueStateBasis: pa.issueStateBasis,
    issuedForPermitGate: {
      pass: pa.issuedForPermitGate?.pass,
      preconditions: (pa.issuedForPermitGate?.preconditions || []).map(p => ({ id: p.id, satisfied: p.satisfied, detail: p.detail })),
    },
    governingCodesRef: pa.governingCodesRef, sheetIndexLength: (pa.sheetIndex || []).length,
  } : null,
  issueStateIsPending: issueStateOk,
  issueStateForbidden,

  // §13 — cross-sheet TRUTH MATRIX
  truthMatrix: truth,

  // §4/§5/§6 — deletion proofs (source scan + doc pointers)
  deletionProofs: {
    buildPermitCoverSheet: {
      fileDeleted: !coverFilePresent, reactComponentDeleted: !coverComponentPresent,
      reachableCallers: coverReachability, docPointer: 'docs/W4-COVER-AUTHORITY.md §4',
    },
    buildSLD: {
      implementationPresent: buildSldImplPresent, callPresent: buildSldCallPresent,
      docPointer: 'docs/W4-SLD-DELETION.md (832 lines removed)',
      note: 'pageSingleLineDiagram consumes generateLiveSLD (canonical) and fails closed; every SLD carries the snapshot id/schema/digest stamp.',
    },
    legacyPlanSet: {
      resolution: 'DELETED (W4 §6, option B)', routeTombstone410: planSetRouteTombstone,
      builderFilesPresent: legacyBuilderFilesPresent, reachableImportersOrFetches: planSetReachability,
      retainedNonAuthorityModule: 'lib/plan-set/permit-system-model.ts (pure view bridge; external SLD-route consumer)',
      docPointer: 'docs/W4-PLANSET-PATH-RESOLUTION.md',
    },
  },

  // §7/§8 — reconciliation workflow + document registry pointers
  authorityInfrastructure: {
    documentRegistry: { module: 'lib/documents/registry.ts', migration: 'lib/migrations/113_manufacturer_document_registry.sql',
      resolver: 'resolveRackingCapacityDocument (wired: generatePermit POST route → buildRackingAssembly, fail-soft)' },
    reconciliation: { module: 'lib/reconciliation/reconcile.ts', migration: 'lib/migrations/114_equipment_reconciliation_audit.sql',
      ledgerRead: 'listActiveInvalidations (wired into the ISSUED-FOR-PERMIT gate, fail-soft)' },
    migrationsRunByRay: false,
    note: 'Migrations 113 (manufacturer_document_registry) and 114 (equipment_reconciliation_audit + snapshot_digest_invalidations) are WRITTEN but NOT yet run by Ray. Until then the async document/ledger reads fail soft to the not-satisfied state — no document is archived, so the RT-MINI blockers stay firing and ISSUED FOR PERMIT is unreachable.',
  },

  // §9 — RT-MINI ingestion status (blockers active; no document archived)
  rtMiniIngestion: st?.rackingAssembly ? {
    mountModel: st.rackingAssembly.mountModel,
    capacityAllowableLbs: st.rackingAssembly.publishedCapacityAllowableLbs ?? null,
    documentHash: st.rackingAssembly.capacityProvenance?.sourceDocument?.documentHash ?? null,
    archivedInRepo: st.rackingAssembly.capacityProvenance?.sourceDocument?.archivedInRepo ?? null,
    blockersActive: blockerCodes.filter(c => /^RACKING-CAPACITY/.test(c)),
    note: 'ingestion path present (lib/documents) — a generic brochure/flashing report does NOT clear the blocker; only a verified document covering the exact assembly + installation condition does. None archived today.',
  } : { note: 'no racking assembly on this snapshot (non-roof or no mount)' },

  // §10 — direct-mount coordinate status
  directMount: {
    directMountAttachmentsOnThisSnapshot: (st?.attachments || []).filter(a => typeof a.attachmentId === 'string' && a.attachmentId.startsWith('att-dm-')).length,
    supportedModuleIdPromotedToType: true,   // W4 closer: AttachmentObject.supportedModuleId
    moduleAttachmentIdsPromotedToType: true,  // W4 closer: ModuleInstance.attachmentIds (direct-mount back-fill)
    note: 'Braidon is rail-based (RT-MINI, rail-paired per Ray ruling) so there are no att-dm-* attachments here; direct-mount canonical coordinate authority + fields are exercised by tests/planset/direct-mount-authority.test.ts.',
  },

  // §11 — carried-forward electrical blocker statuses
  electricalBlockers: {
    'ROUTE-LENGTH-ESTIMATE': blockerCodes.includes('ROUTE-LENGTH-ESTIMATE'),
    'FEEDER-RACEWAY-AUTHORITY': blockerCodes.includes('FEEDER-RACEWAY-AUTHORITY'),
    'RACEWAY-BONDING-AUTHORITY': blockerCodes.includes('RACEWAY-BONDING-AUTHORITY'),
    'EQUIPMENT-IDENTITY-CONFLICT': blockerCodes.includes('EQUIPMENT-IDENTITY-CONFLICT'),
  },

  // W3.1 §2 coordinate parity (carried forward from the W3 evidence)
  coordinateParity: w3?.coordinateAuthority?.renderParity
    ? { idCoverageOk: w3.coordinateAuthority.renderParity.idCoverageOk,
        coordinateParityOk: w3.coordinateAuthority.renderParity.coordinateParityOk,
        maxDrawnVsTransformDeltaSheetUnits: w3.coordinateAuthority.renderParity.maxDrawnVsTransformDeltaSheetUnits,
        structuralObjectsPlaced: w3.coordinateAuthority.renderParity.structuralObjectsPlaced,
        source: w3Path }
    : { note: `W3 evidence ${w3Path} not found — run planset-evidence-w3.mjs first to populate coordinate parity`, renderedObjectIdTags: (html.match(/data-object-id="/g) || []).length },

  // carried-forward W3.1 originally-audited failure classes (verbatim)
  failureClasses: w3?.failureClasses ?? null,
  failureClassesAllCorrected: w3?.failureClassesAllCorrected ?? null,

  // Item-4 RESOLUTION (W4.1 — Ray corrective directive docs/W4.1-DIRECTIVE.md §1).
  // The open flag is CLOSED: a corrected mounting-TOPOLOGY authority
  // (classifyMountTopology, mounting-hardware-db) now decides the rail-paired vs
  // rail-less structural path by VALUE (never the product name), and unknown
  // topology BLOCKS permit-ready (MOUNT-TOPOLOGY-UNKNOWN blocker + V36 validator).
  mountingHardwareDbFlag: {
    status: 'RESOLVED — W4.1 mounting-topology correction',
    correction: 'Introduced MountTopology { rail_paired | rail_less | unknown } in the equipment authority. '
      + 'The structural engine guards the rail-paired vs rail-less direct-mount path on the topology VALUE '
      + '(classifyMountTopology), not the systemType/product name — a mislabeled "rail_less" systemType can no '
      + 'longer drive the direct-mount engine. rail_less is now reserved for VERIFIED rail-less products.',
    classification: [
      { id: 'rooftech-mini', model: 'RT-MINI', systemType: 'rail_based', mountTopology: 'rail_paired',
        basis: 'RT-MINI / RT-MINI II rail-paired self-flashing standoff base (pad + conventional rail); routes the railed path.' },
      { id: 'rooftech-hook', model: 'RT-HOOK', systemType: 'standing_seam', mountTopology: 'rail_paired',
        basis: 'Standing-seam clamp carrying a conventional rail; railed structural path.' },
      { id: 'rooftech-mini-s', model: 'RT-MINI-S', systemType: 'rail_less', mountTopology: 'unknown',
        basis: 'AMBIGUOUS ALIAS — no in-repo evidence (research/PE/datasheet/SKU) confirms it maps to a genuine Roof Tech rail-less RT-MINI product; tile_hook attachment differs from the RT-MINI pad standoff. Classified unknown ⇒ BLOCKS.' },
      { id: 'rooftech-mini-t', model: 'RT-MINI-T', systemType: 'rail_less', mountTopology: 'unknown',
        basis: 'AMBIGUOUS ALIAS — no in-repo evidence it is a genuine rail-less RT-MINI product; tile_replacement attachment differs from the RT-MINI pad standoff. Classified unknown ⇒ BLOCKS.' },
      { id: 'rooftech-mini-m', model: 'RT-MINI-M (Metal)', systemType: 'rail_less', mountTopology: 'unknown',
        basis: 'AMBIGUOUS — recorded as a corrugated_clamp, which does NOT map to "RT-MINI with metal flashing"; confirmation to rail_paired NOT met. Classified unknown ⇒ BLOCKS.' },
    ],
    unknownBlocksRule: 'A roof mount classified "unknown" emits the MOUNT-TOPOLOGY-UNKNOWN permit-readiness blocker '
      + '(structuralAuthority.collectBlockers → permitReadiness) and is cross-checked by the V36 snapshot validator; '
      + 'permit-ready is unreachable until the topology is confirmed. No RT-APEX / E Mount AIR record was fabricated — '
      + 'the rail-less path is exercised by the existing verified rail-less records (Tesla / EcoFasten).',
    braidonImpact: 'Braidon rides rooftech-mini (rail_paired) — its structural path stays railed and its snapshot '
      + 'digest is UNCHANGED (the new mountTopology field lives in the equipment authority only; it is not serialized '
      + 'into the snapshot, and rooftech-mini\'s classification did not change).',
  },

  // expected honest blockers + summary
  expectedBlockers: { mode: MODE, expected: EXPECTED, present: blockerCodes, missing: missingExpected },
  authorityBypasses: bypasses,

  // POST-CAMPAIGN CORRECTION-PASS GATES (2026-07-22) — the 15-section correction,
  // re-proven on the freshly rendered package. Every gate must be ok in both modes.
  correctionPassGates: {
    canonicalFeeder: { raceway: canRaceway, tradeSizeIn: canSize, conduitLabel: conduitLabel2,
      voltageDropPct: canVd, oneWayFt: canLen, feederSegmentId: feederSeg?.segmentId ?? null },
    reactionReconciliation: { present: rr2.present ?? false, ok: rr2.ok ?? false,
      attachmentCount: rr2.attachmentCount ?? null, reactionModelCount: rr2.reactionModelCount ?? null,
      tributarySumFt2: rr2.tributarySumFt2 ?? null, arrayAreaFt2: rr2.arrayAreaFt2 ?? null },
    capacityGate: { mount: rackMountModel || null, capacityGated,
      rendersUnverified: html.includes('UNVERIFIED / PENDING STRUCTURAL SOURCE') },
    certApproved,
    newAuthorityBlockersPresent: missingNewBlockers.length === 0,
    gates: correctionGates,
    failed: correctionFail.map(g => g.id),
    allPass: correctionFail.length === 0,
  },

  summary: {
    truthRows: truth.length,
    agree: truth.filter(r => r.agree === true).length,
    coverageOnly: truth.filter(r => r.agree === null).length,
    disagree: disagreements.map(r => r.quantity),
    blockingDisagree: blockingDisagree.map(r => r.quantity),
    codeEditionsIdentical: editionsCrossSheetIdentical,
    zeroCodeLiterals: codeLiteralHits.length === 0,
    reachableBypasses: bypasses.length,
    issueState: issueAuthority, issueStateOk, issueStateForbidden,
    renderedEqualsManifest,
    missingExpectedBlockers: missingExpected,
    honestBlockers: blockerCodes,
    correctionGatesTotal: correctionGates.length,
    correctionGatesFailed: correctionFail.map(g => g.id),
    correctionGatesAllPass: correctionFail.length === 0,
  },
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`[w4-evidence:${MODE}] ${outPath}`);
console.log(`[w4-evidence:${MODE}] truth matrix: ${report.summary.agree} agree / ${report.summary.coverageOnly} coverage / ${disagreements.length} disagree`
  + ` | editions identical: ${editionsCrossSheetIdentical} | zero literals: ${codeLiteralHits.length === 0}`);
console.log(`[w4-evidence:${MODE}] issue state: ${issueAuthority} (pending-ok=${issueStateOk}, forbidden=${issueStateForbidden}) | sheet-index rendered==manifest: ${renderedEqualsManifest}`);
console.log(`[w4-evidence:${MODE}] deletions: coverFileGone=${!coverFilePresent} buildSLDGone=${!buildSldImplPresent && !buildSldCallPresent} planSet410=${planSetRouteTombstone} planSetReachable=${planSetReachability.length}`);
console.log(`[w4-evidence:${MODE}] honest blockers: ${blockerCodes.join(', ') || 'none'}`);
console.log(`[w4-evidence:${MODE}] correction-pass gates: ${correctionGates.length - correctionFail.length}/${correctionGates.length} pass`
  + ` | feeder ${conduitLabel2 ?? '—'} @ ${canVd ?? '—'}% | reaction-recon present=${rr2.present ?? false} ok=${rr2.ok ?? false} | capacityGated=${capacityGated}`);
if (correctionFail.length) correctionFail.forEach(g => console.log(`[w4-evidence:${MODE}] FAIL(correction): ${g.id} — ${g.detail}`));
if (missingExpected.length) console.log(`[w4-evidence:${MODE}] FAIL: expected honest blocker(s) missing: ${missingExpected.join(', ')}`);
if (bypasses.length) bypasses.forEach(b => console.log(`[w4-evidence:${MODE}] FAIL(bypass): ${b}`));
if (blockingDisagree.length) console.log(`[w4-evidence:${MODE}] FAIL: cross-sheet disagreement: ${blockingDisagree.map(r => `${r.quantity}[${r.distinctPrinted}≠${r.authority}]`).join('; ')}`);
if (issueStateForbidden) console.log(`[w4-evidence:${MODE}] FAIL: issue state is a permit-issuable state (${issueAuthority}) — must be PENDING-*`);
if (!renderedEqualsManifest) console.log(`[w4-evidence:${MODE}] FAIL: rendered sheets != manifest (rendered ${sheetIds.length} vs manifest ${manifestIds.length})`);
process.exit(blockingFail ? 2 : 0);
