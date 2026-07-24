// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-co — FINAL CLOSEOUT rendered-truth harness (20 permanent gates).
//
//   Usage: node scripts/planset-evidence-co.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = original (frozen fixture) | live (current DB design)
//
// The closeout successor to planset-evidence-rp.mjs. It regenerates NOTHING: it
// reads the REAL rendered permit package HTML + its PermitDesignSnapshot and runs
// the 20 PERMANENT BLOCKING GATES from docs/CLOSEOUT-PASS-DIRECTIVE.md against the
// RENDERED output (+ the snapshot authority it must equal). Gate 15 invokes the
// TRUE geometry page-fit validator (scripts/planset-pagefit.mjs) on the same HTML.
// Any stale local calc, projection disagreement, BOM quantity mismatch, code-
// article mismatch, hidden/clipped content, unverified structural PASS, omitted
// blocker, severity-policy violation, or report/rendered mismatch exits NON-ZERO.
//
// It fails CLOSED — a truth matrix over rendered output, not a fixture.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [htmlPath, snapPath, outPath = 'braidon-co.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) { console.error('usage: planset-evidence-co.mjs <html> <snapshot.json> [out]'); process.exit(1); }
const MODE = process.env.EVIDENCE_MODE === 'original' ? 'original' : (process.env.EVIDENCE_MODE || 'live');
const repoRoot = process.cwd();

const rawHtml = fs.readFileSync(htmlPath, 'utf8');
// Value scans run on a COMMENT-STRIPPED copy — a comment documenting a RETIRED
// false claim must never be read as a live claim.
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

const meta = snap.meta || {};
const el = snap.electrical || {};
const st = snap.structural || {};
const pa = snap.projectAuthority || null;
const pr = snap.permitReadiness || {};
const registry = (pr.registry ?? []).filter(r => !r.resolved);
const registryCodes = registry.map(r => r.code);

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const has = (lit) => html.includes(lit);

// ── robust page split: ANY element whose class list STARTS with "page" (cover,
// sld-page, cert-page, continuation … all included). The rp harness split missed
// PV-0/CERT because it hard-coded `class="page"|"page sld-page"`. ────────────────
const pages = rawHtml.split(/<div class="page(?=[ "])/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);
const pageHasTitleBlock = (p) => /tb-sheet-id">/.test(p) || /class="title-block/.test(p);

const manifestIds = (pa?.sheetIndex ?? []).map(s => s.id);

// canonical feeder mirror
const F = el.feeder || {};
const canRaceway = F?.conduit?.raceway ?? null;
const canSize = F?.conduit?.tradeSizeIn ?? null;
const canVd = typeof F?.voltageDropPct === 'number' ? F.voltageDropPct : null;
const conduitLabel = (canRaceway && canSize) ? `${canRaceway} ${canSize}` : (canRaceway ?? null);
const conduitLabelEnc = conduitLabel ? conduitLabel.replace(/"/g, '&quot;') : null;
const topologyMicro = String(el.topology || '').toLowerCase() === 'micro';
const isSupplySide = String(el.interconnectionMethod || '').toUpperCase().includes('SUPPLY_SIDE')
  || (el.serviceTopology || []).some(o => /tap/.test(o.type || ''));

const segs = el.routeSegments || [];
const rws = el.physicalRaceways || [];
const topo = el.serviceTopology || [];

// framing-verified state (directive §13 gate is conditioned on UNVERIFIED framing)
const framingUnverified = registryCodes.includes('STRUCTURAL-FRAMING-UNVERIFIED')
  || st?.engine?.engineeringReviewRequired === true;

// ── gate machinery ─────────────────────────────────────────────────────────
const gates = [];
const gate = (num, id, ok, detail, evidence) => { gates.push({ gate: num, id, ok: !!ok, detail, evidence: evidence ?? null }); return ok; };

// canonical NEC raceway article map (mirror computed-system.racewayNecArticle)
const necArticleFor = (type) => {
  const t = String(type || '').toUpperCase();
  if (/PVC/.test(t)) return '352';
  if (/EMT/.test(t)) return '358';
  if (/RMC|GRC|RIGID/.test(t)) return '344';
  if (/IMC/.test(t)) return '342';
  if (/LFMC/.test(t)) return '350';
  if (/\bFMC\b/.test(t)) return '348';
  return null;
};

// ═══ GATE 1 — no stale PV-4A rule calc (retired legacy busbar-fill PASS). ═════
const g1_275 = /27\.5\s*%[\s\S]{0,80}PASS/i.test(html);
const g1_legacyTable = has('NEC Rule Detail (advisory') || has('rulesResult');
gate(1, 'no-stale-pv4a-rule-calc', !g1_275 && !g1_legacyTable,
  `27.5%-busbar-PASS=${g1_275} legacy-rules-table=${g1_legacyTable}`, null);

// ═══ GATE 2 — supply-side tap cannot display a 705.12 busbar PASS. ═══════════
const g2_busbarPass = /120%\s*Busbar\s*Rule[\s\S]{0,400}?>\s*PASS\s*</i.test(html)
  || /705\.12\(B\)[\s\S]{0,120}?\bPASS\b/i.test(html);
const g2_naShown = /120%\s*(?:N\/A|BUSBAR RULE N\/A)|705\.12\(B\)\)?\s*(?:not applicable|does not apply|applies only to load)/i.test(html);
gate(2, 'no-supply-side-705.12-pass',
  !isSupplySide || (!g2_busbarPass && g2_naShown),
  `supplySide=${isSupplySide} busbarPASS=${g2_busbarPass} naShown=${g2_naShown}`, null);

// ═══ GATE 3 — one raceway type/size per segment ID; no mixed dual-citation. ══
const bySeg = new Map();
for (const s of segs) {
  const key = `${s.raceway ?? '—'}|${s.tradeSizeIn ?? '—'}`;
  if (!bySeg.has(s.segmentId)) bySeg.set(s.segmentId, new Set());
  bySeg.get(s.segmentId).add(key);
}
const multiRacewaySegs = [...bySeg].filter(([, set]) => set.size > 1).map(([id]) => id);
const g3_mixedCitation = /358\.30 \(EMT\) or NEC 352\.30 \(PVC\)/.test(html);
const g3_emtContra = /Conduit type:\s*EMT/i.test(html) && /PVC/.test(conduitLabel || '');
gate(3, 'one-raceway-per-segment-id',
  multiRacewaySegs.length === 0 && !g3_mixedCitation && !g3_emtContra,
  `segments-with->1-raceway=${multiRacewaySegs.length} mixedDualCitation=${g3_mixedCitation} emtVsPvcNote=${g3_emtContra}`,
  { multiRacewaySegs });

// ═══ GATE 4 — every branch physical section has an explicit segment ID. ══════
const branchOpenAir = segs.find(s => s.segmentId === 'BRANCH_RUN');
const branchHomerun = segs.find(s => s.segmentId === 'BRANCH_HOMERUN_RUN');
const everySegHasId = segs.every(s => s.segmentId && s.segmentId.length > 0);
const everyRwHasId = rws.every(r => r.physicalRacewayId && r.physicalRacewayId.length > 0);
gate(4, 'every-branch-section-has-segment-id',
  !!branchOpenAir && !!branchHomerun && branchHomerun.physicalRacewayId
    && everySegHasId && everyRwHasId && rws.length > 0,
  `openAir=${!!branchOpenAir} homerun=${!!branchHomerun} homerunRwId=${branchHomerun?.physicalRacewayId ?? 'none'} allSegs=${everySegHasId} allRws=${everyRwHasId} nRaceways=${rws.length}`,
  { segments: segs.map(s => s.segmentId), raceways: rws.map(r => r.physicalRacewayId) });

// ═══ GATE 5 — branch conductor quantities == object-derived requirements. ════
// derive per-segment hot+egc feet directly from the physical-raceway + segment
// objects (conductorsPerCircuit × sharedCircuitCount × oneWayFt × waste), then
// (a) cross-check the committed reconciliation artifact, (b) assert the rendered
// BOM never merges the whole branch and is segment-tagged.
const WASTE = 1.15;
const derived = [];
for (const s of segs) {
  if (!s.physicalRacewayId) continue;
  const rw = rws.find(r => r.physicalRacewayId === s.physicalRacewayId);
  const scc = s.sharedCircuitCount ?? rw?.sharedCircuitCount ?? 1;
  const perCircuit = s.conductorCount ?? 2;
  const oneWay = s.oneWayFt ?? 0;
  if (!oneWay) continue;
  derived.push({
    segmentId: s.segmentId, gauge: s.conductorGauge, egcGauge: s.egcGauge,
    hotFt: Math.ceil(oneWay * perCircuit * scc * WASTE),
    egcFt: Math.ceil(oneWay * 1 * scc * WASTE) > 0 ? Math.ceil(oneWay * WASTE) : 0,
  });
}
// aggregate hot feet by gauge (the object-derived requirement)
const hotByGauge = {};
for (const d of derived) { if (!d.gauge) continue; hotByGauge[d.gauge] = (hotByGauge[d.gauge] ?? 0) + d.hotFt; }
// rendered: no "all runs" merge, no merged whole-branch "in 1-1/4\" PVC", rows segment-tagged
const g5_allRuns = /all runs/i.test(html);
const g5_mergedBranch = /\d+\s*ft\s*#1[02]\s*(?:AWG\s*)?in\s*1-1\/4/i.test(html);
const g5_segTagged = has('BRANCH_HOMERUN_RUN');
// artifact cross-check (if present) — its aggregation must equal object-derived
let g5_artifactOk = true, g5_artifactNote = 'artifact-not-present';
const reconPath = path.resolve(repoRoot, 'docs/evidence/braidon-branch-conductor-reconciliation.json');
if (fs.existsSync(reconPath)) {
  try {
    const rec = JSON.parse(fs.readFileSync(reconPath, 'utf8'));
    const recAgg = {};
    for (const r of (rec.aggregationProof?.hotByGauge ?? [])) recAgg[r.gauge] = r.ft;
    const keys = new Set([...Object.keys(hotByGauge), ...Object.keys(recAgg)]);
    const mismatches = [...keys].filter(k => (hotByGauge[k] ?? 0) !== (recAgg[k] ?? 0));
    g5_artifactOk = mismatches.length === 0;
    g5_artifactNote = g5_artifactOk ? 'artifact==object-derived' : `mismatch:${mismatches.join(',')}`;
  } catch { g5_artifactOk = false; g5_artifactNote = 'artifact-parse-error'; }
}
gate(5, 'branch-conductors-object-derived',
  derived.length > 0 && !g5_allRuns && !g5_mergedBranch && g5_segTagged && g5_artifactOk,
  `derivedSegs=${derived.length} hotByGauge=${JSON.stringify(hotByGauge)} allRuns=${g5_allRuns} mergedBranch=${g5_mergedBranch} segTagged=${g5_segTagged} ${g5_artifactNote}`,
  { derived });

// ═══ GATE 6 — no generic "all runs" conduit row. ════════════════════════════
gate(6, 'no-all-runs-conduit-row', !/all runs/i.test(html), `"all runs" occurrences=${(html.match(/all runs/gi) || []).length}`, null);

// ═══ GATE 7 — raceway code article matches raceway type. ════════════════════
const g7_snapWrong = rws.filter(r => {
  const want = necArticleFor(r.racewayType);
  return want && r.necArticle && String(r.necArticle) !== want;
}).map(r => `${r.physicalRacewayId}:${r.racewayType}→${r.necArticle}(want ${necArticleFor(r.racewayType)})`);
const g7_pvcCites358 = /PVC[^<]{0,40}NEC\s*358|NEC\s*358[^<]{0,40}PVC\s*Sch/i.test(html);
gate(7, 'raceway-article-matches-type',
  g7_snapWrong.length === 0 && !g7_pvcCites358,
  `snapshotArticleMismatch=${g7_snapWrong.length} renderedPvcCites358=${g7_pvcCites358}`, g7_snapWrong);

// ═══ GATE 8 — no string/DC legend or BOM row without a canonical DC segment. ═
const hasDcSeg = segs.some(s => /DC[_-]?(STRING|HOMERUN|HOME_RUN)/i.test(s.segmentId || '') || s.electricalFunction === 'dc-string');
const dcMaterialRe = /(?:#1[02]\s*(?:AWG\s*)?USE-2|USE-2[^<]{0,40}(?:DC roof wiring|home[- ]?run)|DC Conductor in Conduit)/gi;
const dcRows = (html.match(dcMaterialRe) || []);
gate(8, 'no-unbacked-dc-rows',
  !(topologyMicro && !hasDcSeg && dcRows.length > 0),
  `micro=${topologyMicro} dcSegment=${hasDcSeg} dcRows=${dcRows.length}`, dcRows.slice(0, 3));

// ═══ GATE 9 — device-role graph: no conflation / duplicate physical devices. ═
const fused = topo.find(o => o.type === 'fused-ocpd');
const dupUtility = topo.filter(o => o.type === 'utility-disconnect');
const ids = topo.map(o => o.objectId);
const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
const endpointsOk = (() => {
  const combiner = topo.find(o => o.type === 'combiner');
  const svcDisco = topo.find(o => o.type === 'service-disconnect');
  if (!combiner || !svcDisco) return false;
  // every non-endpoint object links upstream AND downstream
  const mids = topo.filter(o => o !== combiner && o !== svcDisco);
  const chained = mids.every(o => o.upstreamObjectId && o.downstreamObjectId);
  return combiner.upstreamObjectId == null && !!combiner.downstreamObjectId
    && svcDisco.downstreamObjectId == null && !!svcDisco.upstreamObjectId && chained;
})();
// dual-purpose fused device documented when it also serves the utility disconnect role
const dualDocumented = !isSupplySide || (fused && (dupUtility.length === 1
  || (fused.dualPurposeListing === true && fused.utilityRole === 'utility-accessible-disconnect')));
gate(9, 'device-role-graph-coherent',
  topo.length >= 8 && dupIds.length === 0 && dupUtility.length <= 1 && endpointsOk && dualDocumented,
  `objects=${topo.length} dupIds=${dupIds.length} utilityDisco=${dupUtility.length} chainOk=${endpointsOk} dualDoc=${!!dualDocumented} fusedDual=${fused?.dualPurposeListing ?? null}`,
  { types: topo.map(o => o.type + (o.dualPurposeListing ? '(DUAL)' : '')) });

// ═══ GATE 10 — unselected datasheets cannot appear authoritative. ═══════════
const railPending = (st?.rackingAssembly?.railSku ?? null) == null
  || registryCodes.includes('PENDING-RACKING-ASSEMBLY-SELECTION');
const ds4Present = /data-sheet-id="DS-4"/.test(rawHtml);
const authoritativeXr100 = /data-ds-rail="[^"]*"[^>]*rail_spec|data-sheet-id="DS-4"[\s\S]{0,200}XR100/i.test(rawHtml);
gate(10, 'unselected-datasheet-absent',
  !railPending || (!ds4Present && !authoritativeXr100),
  `railPending=${railPending} DS-4-page=${ds4Present} authoritativeXR100=${authoritativeXr100}`, null);

// ═══ GATE 11 — RT-MINI always projects rail_paired. ═════════════════════════
const g11_direct = has('DIRECT-ATTACH MOUNT');
const g11_railPaired = has('RAIL-PAIRED ROOF ATTACHMENT BASE');
gate(11, 'rt-mini-rail-paired', !g11_direct && g11_railPaired,
  `direct-attach=${g11_direct} rail-paired=${g11_railPaired}`, null);

// ═══ GATE 12 — one fastener object rendered IDENTICALLY across all sheets. ═══
const fastenerCells = [...rawHtml.matchAll(/data-(app-a|pe|sched)-field="fastener"[^>]*>([^<]*)</g)]
  .map(m => ({ sheet: m[1], text: decode(m[2].trim()) }));
const fastenerVals = [...new Set(fastenerCells.map(c => c.text))];
const g12_identical = fastenerCells.length >= 2 && fastenerVals.length === 1;
const g12_genericLeak = has('Lag bolt w/ flashing') || has('>Stainless Steel<');
const g12_pendingWhenUnverified = /UNVERIFIED/i.test(fastenerVals[0] || '') ? has('PENDING VERIFIED FASTENER ASSEMBLY') : true;
gate(12, 'fastener-identical-across-sheets',
  g12_identical && !g12_genericLeak && g12_pendingWhenUnverified,
  `cells=${fastenerCells.length} distinctValues=${fastenerVals.length} genericLeak=${g12_genericLeak} pendingGate=${g12_pendingWhenUnverified}`,
  { sheets: fastenerCells.map(c => c.sheet) });

// ═══ GATE 13 — unverified framing cannot display capacity/util/PASS/adequate. ═
const g13_adequate = has('confirms the existing framing has adequate capacity')
  || /existing framing[^.]{0,30}\badequate\b/i.test(html);
const g13_capacityRow = /Truss Load Capacity<\/td>\s*<td[^>]*>\s*\d+\s*PSF/i.test(html)
  || /Utilization Ratio<\/td>\s*<td[^>]*>\s*\d+(?:\.\d+)?%/i.test(html);
const g13_notVerifiedShown = /EXISTING FRAMING CAPACITY NOT VERIFIED|FRAMING[^<]{0,30}UNVERIFIED|NOT VERIFIED/i.test(html);
gate(13, 'no-unverified-framing-capacity',
  !framingUnverified || (!g13_adequate && !g13_capacityRow && g13_notVerifiedShown),
  `framingUnverified=${framingUnverified} adequateVerdict=${g13_adequate} capacityRow=${g13_capacityRow} notVerifiedShown=${g13_notVerifiedShown}`, null);

// ═══ GATE 14 — screening envelope labeled with ratio + basis. ═══════════════
const g14_ok = has('CONSERVATIVE SCREENING ENVELOPE') && has('GOVERNING corner')
  && /ASD/i.test(html) && /\d\.\d{3}×/.test(html)
  && has('NOT an exact per-position zone or tributary geometry')
  && !has('exact tributary geometry.');
gate(14, 'screening-envelope-labeled',
  g14_ok,
  `conservativeEnvelope=${has('CONSERVATIVE SCREENING ENVELOPE')} corner=${has('GOVERNING corner')} asd=${/ASD/i.test(html)} ratio=${/\d\.\d{3}×/.test(html)} noExactClaim=${has('NOT an exact per-position zone or tributary geometry')}`,
  (html.match(/\d\.\d{3}×/) || [])[0] || null);

// ═══ GATE 15 — TRUE geometry page-fit (invoke scripts/planset-pagefit.mjs). ══
const pf = spawnSync(process.execPath, [path.resolve(repoRoot, 'scripts/planset-pagefit.mjs'), htmlPath], { encoding: 'utf8' });
const pfLine = ((pf.stdout || '').match(/\[pagefit\][^\n]*/g) || []).pop() || (pf.stderr || '').trim().slice(0, 120);
gate(15, 'geometry-page-fit', pf.status === 0,
  `pagefit exit=${pf.status} · ${pfLine}`, null);

// ═══ GATE 16 — page count == manifest. ══════════════════════════════════════
const g16_equal = JSON.stringify(sheetIds) === JSON.stringify(manifestIds);
gate(16, 'page-count-equals-manifest', g16_equal && sheetIds.every(id => id && id !== '?'),
  `rendered=${sheetIds.length} manifest=${manifestIds.length} equal=${g16_equal}`,
  g16_equal ? null : { renderedIds: sheetIds, manifestIds });

// ═══ GATE 17 — every continuation has a title block + manifest entry. ═══════
// a sheet is a CONTINUATION iff stripping a trailing ".N" or "-N" yields a base
// sheet id that is ALSO in the manifest (PV-4C.1→PV-4C, SCHED-2→SCHED). This
// excludes primary numbered sheets (PV-0, PV-1, E-1, PV-4B) whose "base" is not a sheet.
const continuationIds = manifestIds.filter(id => {
  const m = id.match(/^(.*?)[.\-]\d+$/);
  return m && manifestIds.includes(m[1]);
});
const contIssues = [];
for (const cid of continuationIds) {
  const inManifest = manifestIds.includes(cid);
  const pageIdx = sheetIds.indexOf(cid);
  const hasTb = pageIdx >= 0 && pageHasTitleBlock(pages[pageIdx]);
  const hasContinuationTitle = pageIdx >= 0 && /(CONTINU|CONT\.|CONTINUED)/i.test(pages[pageIdx]);
  if (!inManifest || pageIdx < 0 || !hasTb || !hasContinuationTitle) contIssues.push({ cid, inManifest, rendered: pageIdx >= 0, hasTb, hasContinuationTitle });
}
gate(17, 'continuations-have-title-block-and-manifest',
  continuationIds.length > 0 && contIssues.length === 0,
  `continuations=${continuationIds.join(',')} issues=${contIssues.length}`, contIssues);

// ═══ GATE 18 — issue wording agrees everywhere. ═════════════════════════════
const g18_stale = has('Issued for permit review');
const g18_pendingShown = has('DESIGN REVIEW PACKAGE — NOT FOR PERMIT SUBMISSION')
  || has('PREPARED FOR ENGINEERING REVIEW') || has('PENDING ENGINEERING REVIEW');
const issueFields = [...new Set([...rawHtml.matchAll(/data-project-field="issue-status">([^<]*)</g)].map(m => decode(m[1].trim())))];
const g18_noIssued = !issueFields.some(v => /ISSUED FOR PERMIT|PERMIT-READY/i.test(v));
gate(18, 'issue-wording-agrees',
  !g18_stale && g18_pendingShown && g18_noIssued,
  `staleIssuedForReview=${g18_stale} pendingShown=${g18_pendingShown} issueFields=${JSON.stringify(issueFields)}`, null);

// ═══ GATE 19 — severity policy: permit-critical missing inputs are blockers. ═
const PERMIT_CRITICAL_PROMOTED = ['CONDUIT-FILL-PENDING', 'TAP-CONDUCTOR-LENGTH-PENDING', 'MODULE-EXACT-DATASHEET-PENDING'];
const sevOf = (code) => (registry.find(r => r.code === code) || {}).severity ?? null;
const notBlocking = PERMIT_CRITICAL_PROMOTED.filter(c => registryCodes.includes(c) && sevOf(c) !== 'blocking');
const anyWarning = registry.filter(r => r.severity === 'warning').map(r => r.code);
const blockingCount = registry.filter(r => r.severity === 'blocking').length;
gate(19, 'severity-policy-compliant',
  notBlocking.length === 0 && anyWarning.length === 0 && blockingCount >= 12,
  `promotedNotBlocking=${notBlocking.length} activeWarnings=${anyWarning.length} blockingCount=${blockingCount}`,
  { notBlocking, anyWarning });

// ═══ GATE 20 — report-equals-rendered: snapshot key values re-extracted. ════
const projField = (field) => {
  const out = [];
  for (const m of rawHtml.matchAll(new RegExp(`data-project-field="${field}">([^<]*)<`, 'g'))) out.push(decode(m[1].trim()));
  return [...new Set(out)];
};
const sldSnapId = (rawHtml.match(/data-sld-snapshot-id="([^"]*)"/) ?? [])[1] ?? null;
const skuTags = [...new Set([...rawHtml.matchAll(/data-sku="([^"]*)"/g)].map(m => m[1]))];
const invSku = pa?.equipmentSummary?.inverterSku || snap.equipment?.microInverters?.[0]?.sku || snap.equipment?.inverters?.[0]?.sku || null;
const moduleModel = [pa?.equipmentSummary?.moduleManufacturer, pa?.equipmentSummary?.moduleModel].filter(Boolean).join(' ').trim();
const reconcile = [];
const rcheck = (name, reportVal, matched, extra) => { reconcile.push({ name, reportVal: `${reportVal}`, matchedInRendered: !!matched, ...extra }); };
const snapIdFields = projField('snapshot-id');
rcheck('snapshotId', meta.snapshotId, snapIdFields.includes(meta.snapshotId) && (sldSnapId === null || sldSnapId === meta.snapshotId), { titleBlockValues: snapIdFields, sld: sldSnapId });
const digestFields = projField('digest');
rcheck('digestPrefix', (meta.digest || '').slice(0, 12), digestFields.length > 0 && digestFields.every(v => v && (meta.digest || '').startsWith(v)), { titleBlockValues: digestFields });
rcheck('feederConduit', conduitLabel, !conduitLabelEnc || has(conduitLabelEnc));
const vdStr = canVd != null ? canVd.toFixed(2) : null;
rcheck('feederVoltageDropPct', vdStr, vdStr == null || has(`${vdStr}%`) || has(vdStr));
rcheck('inverterSku', invSku, invSku == null || skuTags.includes(invSku), { skuTags });
const moduleFields = projField('module-model');
rcheck('moduleModel', moduleModel, moduleModel === '' || moduleFields.some(v => v && (v.includes(moduleModel) || moduleModel.includes(v))));
const issueF = projField('issue-status');
rcheck('issueState', pa?.issueState ?? issueF[0], (pa?.issueState == null) || issueF.includes(pa.issueState));
const rs1 = (rawHtml.split('<div class="page').find(p => p.includes('ACTIVE RELEASE BLOCKERS')) ?? '');
const rs1BlockingNum = (() => { const m = rs1.match(/BLOCKING<\/span>\s*<span[^>]*>(\d+)</); return m ? Number(m[1]) : null; })();
rcheck('blockingBlockerCount', blockingCount, rs1BlockingNum == null || rs1BlockingNum === blockingCount, { rs1Rendered: rs1BlockingNum });
const mismatches = reconcile.filter(r => !r.matchedInRendered);
gate(20, 'report-equals-rendered', mismatches.length === 0,
  `reconciled=${reconcile.length} mismatches=${mismatches.length}`, mismatches);

// ═══ assemble + emit ════════════════════════════════════════════════════════
const failed = gates.filter(g => !g.ok);
const report = {
  generatedAt: new Date().toISOString(),
  harness: 'planset-evidence-co (final closeout rendered-truth, 20 permanent gates)',
  mode: MODE,
  htmlPath: path.relative(repoRoot, htmlPath).replace(/\\/g, '/'),
  snapshotId: meta.snapshotId, digest: meta.digest,
  project: 'BRAIDON M PILLA — Solar TEST',
  sheetCount: pages.length, sheetIds, manifestIds,
  topology: el.topology, supplySide: isSupplySide, framingUnverified,
  feeder: { conduitLabel, voltageDropPct: canVd },
  physicalRaceways: rws.map(r => ({ id: r.physicalRacewayId, type: r.racewayType, size: r.selectedRacewaySize, scc: r.sharedCircuitCount, nec: r.necArticle, fillPct: r.fillPct })),
  serviceTopology: topo.map(o => o.type + (o.dualPurposeListing ? '(DUAL)' : '')),
  branchConductorDerived: derived,
  activeBlockers: registryCodes,
  reportEqualsRendered: { reconciled: reconcile, mismatches },
  gates,
  summary: { total: gates.length, passed: gates.length - failed.length, failed: failed.map(g => `gate ${g.gate}: ${g.id}`), allPass: failed.length === 0 },
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`[co-evidence:${MODE}] ${outPath} — snapshot ${meta.snapshotId} (${pages.length} sheets, manifest ${manifestIds.length})`);
for (const g of gates) console.log(`[co-evidence:${MODE}] ${g.ok ? 'PASS' : 'FAIL'} gate ${String(g.gate).padStart(2)} ${g.id} — ${g.detail}`);
console.log(`[co-evidence:${MODE}] ${report.summary.passed}/${report.summary.total} gates pass`);
if (failed.length) { console.log(`[co-evidence:${MODE}] BLOCKING FAILURES: ${report.summary.failed.join(' | ')}`); process.exit(2); }
process.exit(0);
