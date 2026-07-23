// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-rp — SOURCE-OF-TRUTH REPAIR-PASS rendered-truth harness.
//
//   Usage: node scripts/planset-evidence-rp.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = original (frozen fixture) | live (current DB design)
//
// The repair-pass successor to planset-evidence-w4.mjs. It regenerates nothing:
// it reads the REAL rendered package HTML + its PermitDesignSnapshot and runs the
// 20 PERMANENT BLOCKING GATES (docs/REPAIR-PASS-DIRECTIVE.md) against the RENDERED
// output. Every gate is evaluated on the final HTML (comment-stripped for value
// scans) and/or the snapshot authority, and gate 16 (REPORT-EQUALS-RENDERED)
// re-extracts the snapshot's key values FROM the HTML and compares — any mismatch,
// any hidden blocker, any unverified PASS, any renderer-local calc/selection, any
// substitute-language leak, or any pagination/manifest mismatch exits NON-ZERO.
//
// This is a truth matrix over RENDERED output, not a fixture — it fails closed.
import fs from 'node:fs';
import path from 'node:path';

const [htmlPath, snapPath, outPath = 'braidon-rp.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) { console.error('usage: planset-evidence-rp.mjs <html> <snapshot.json> [out]'); process.exit(1); }
const MODE = process.env.EVIDENCE_MODE === 'original' ? 'original' : (process.env.EVIDENCE_MODE || 'live');
const repoRoot = process.cwd();

const rawHtml = fs.readFileSync(htmlPath, 'utf8');
// Value scans run on a COMMENT-STRIPPED copy — an HTML comment documenting a
// RETIRED false "0 errors / complies" summary must never be read as a claim.
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

const meta = snap.meta || {};
const el = snap.electrical || {};
const st = snap.structural || {};
const pa = snap.projectAuthority || null;
const ca = snap.codeAuthority || null;
const pr = snap.permitReadiness || {};
const registry = (pr.registry ?? []).filter(r => !r.resolved);
const registryCodes = registry.map(r => r.code);
const blockerCodes = (pr.blockers ?? []).map(b => b.code);

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const includesI = (re) => re.test(html);
const has = (lit) => html.includes(lit);

// ── page split (INCLUDES the class="page sld-page" E-1 SLD sheet) ─────────────
const pages = rawHtml.split(/<div class="page(?: sld-page)?"[ >]/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);

// RS-1 review-status fragment (anchored on its unique footer marker).
const rs1 = (() => {
  const parts = rawHtml.split('<div class="page">');
  return parts.find(p => p.includes('permitReadiness.registry') && p.includes('ACTIVE RELEASE BLOCKERS')) ?? '';
})();

// canonical feeder (mirrors electricalProjection.projectCanonicalFeeder).
const F = el.feeder || {};
const canRaceway = F?.conduit?.raceway ?? null;
const canSize = F?.conduit?.tradeSizeIn ?? null;
const canVd = typeof F?.voltageDropPct === 'number' ? F.voltageDropPct : null;
const canFill = F?.conduit?.fillPct ?? null;
const conduitLabel = (canRaceway && canSize) ? `${canRaceway} ${canSize}` : (canRaceway ?? null);
const conduitLabelEnc = conduitLabel ? conduitLabel.replace(/"/g, '&quot;') : null;
const topologyMicro = String(el.topology || '').toLowerCase() === 'micro';

const rr = st.reactionReconciliation || {};
const rackMount = st.rackingAssembly?.mountModel || '';
const capacityGated = /RT-?MINI/i.test(rackMount)
  || registryCodes.includes('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED')
  || registryCodes.includes('PENDING-RACKING-ASSEMBLY-SELECTION');
const certApproved = !!(snap?.certification?.engineeringReviewApproved?.reviewedDigest);

// ── gate machinery ────────────────────────────────────────────────────────────
const gates = [];
/** ok=false ⇒ blocking violation; detail explains; evidence = what was found. */
const gate = (num, id, ok, detail, evidence) => { gates.push({ gate: num, id, ok: !!ok, detail, evidence: evidence ?? null }); return ok; };

// ═══ SOURCE SCAN infrastructure (gates 17-20) ═════════════════════════════════
const readSafe = (rel) => { try { return fs.readFileSync(path.resolve(repoRoot, rel), 'utf8'); } catch { return null; } };
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(line => { const m = line.match(/(^|[^:])\/\//); return m ? line.slice(0, (m.index ?? 0) + m[1].length) : line; }).join('\n');
const OWNED_RENDERERS = [
  'lib/permit/utils/titleBlock.ts', 'lib/permit/sections/coverSheet.ts',
  'lib/permit/sections/compliancePages.ts', 'lib/permit/sections/certPages.ts',
  'lib/permit/sections/structuralPages.ts', 'lib/permit/sections/electricalPages.ts',
  'lib/permit/sections/datasheetAppendix.ts', 'lib/permit/sections/reviewStatus.ts',
  'lib/drafting/templates/roof.ts', 'lib/drafting/templates/fence.ts', 'lib/drafting/templates/ground.ts',
  'lib/drafting/sheetComposition.ts', 'lib/sld-professional-renderer.ts',
];
// The CODE/PROJECT-AUTHORITY PROJECTION surface — the renderers that project the
// codeAuthority/projectAuthority records into title blocks, cover, compliance,
// cert, structural, electrical + datasheet sheets. A hardcoded edition literal
// HERE bypasses the authority projection. The CAD drafting-detail templates
// (sheetComposition / roof / fence / ground) carry method/reference annotations
// (e.g. "ASCE 7-22 §29" wind method) that are validated by the RENDERED
// edition-vs-authority check below, not by this source scan.
const PROJECTION_RENDERERS = [
  'lib/permit/utils/titleBlock.ts', 'lib/permit/sections/coverSheet.ts',
  'lib/permit/sections/compliancePages.ts', 'lib/permit/sections/certPages.ts',
  'lib/permit/sections/structuralPages.ts', 'lib/permit/sections/electricalPages.ts',
  'lib/permit/sections/datasheetAppendix.ts', 'lib/permit/sections/reviewStatus.ts',
];
const scanRenderers = (patterns, exempt = () => false, files = OWNED_RENDERERS) => {
  const hits = [];
  for (const rel of files) {
    const src = readSafe(rel); if (src == null) continue;
    const code = stripComments(src);
    for (const { name, re } of patterns) {
      for (const m of code.matchAll(new RegExp(re, 'g'))) {
        if (exempt(rel, m)) continue;
        const line = code.slice(0, m.index).split('\n').length;
        hits.push({ file: rel, line, pattern: name, text: m[0].slice(0, 80) });
      }
    }
  }
  return hits;
};

// ═══════════════════════════════════════════════════════════════════════════
// GATE 1 — no "wired in series" language on a micro AC-branch design.
// ═══════════════════════════════════════════════════════════════════════════
const seriesHits = (html.match(/wired in series/gi) || []);
gate(1, 'no-wired-in-series-on-micro-branch',
  !(topologyMicro && seriesHits.length > 0),
  `topology=${el.topology} · "wired in series" occurrences=${seriesHits.length}`, seriesHits.slice(0, 3));

// ═══════════════════════════════════════════════════════════════════════════
// GATE 2 — no "field-verified" ROUTE claim without a recorded field verification.
// The affirmative defect literal was "route field-verified". Honest pending
// phrasing ("to be field-verified", "field-verify …") is allowed.
// ═══════════════════════════════════════════════════════════════════════════
const routeFV = (html.match(/route[^<.]{0,40}field-?verified/gi) || []);
gate(2, 'no-field-verified-without-record', routeFV.length === 0,
  `affirmative "route … field-verified" occurrences=${routeFV.length}`, routeFV.slice(0, 3));

// ═══════════════════════════════════════════════════════════════════════════
// GATE 3 — per-segment cross-sheet value equality: ONE canonical feeder
// raceway/size/VD/fill; no merged multi-size raceway token; conduit label
// projected identically; fill PENDING never rendered as a passing 0%.
// ═══════════════════════════════════════════════════════════════════════════
const mergedRacewayRe = /\d(?:-\d\/\d)?&quot;\s*\d\/\d&quot;\s*(?:EMT|PVC|RMC|IMC|FMC)/;
const feederSingleSource = !!canRaceway && !!canSize && canVd != null;
const conduitProjected = !conduitLabelEnc || has(conduitLabelEnc);
const noMerged = !mergedRacewayRe.test(html);
// fill is null on the snapshot ⇒ a CONDUIT-FILL-PENDING blocker must exist and no
// sheet may present the feeder fill as a passing 0.0%.
const fillHonest = canFill != null
  || registryCodes.includes('CONDUIT-FILL-PENDING')
  || registryCodes.includes('FEEDER-RACEWAY-AUTHORITY');
gate(3, 'per-segment-cross-sheet-equality',
  feederSingleSource && conduitProjected && noMerged && fillHonest,
  `feeder=${conduitLabel} @ VD ${canVd}% fill=${canFill ?? 'PENDING'} · projected=${conduitProjected} merged=${!noMerged} fillHonest=${fillHonest}`,
  { canRaceway, canSize, canVd, canFill, segments: (el.routeSegments || []).map(s => s.segmentId) });

// ═══════════════════════════════════════════════════════════════════════════
// GATE 4 — no global zero-error / zero-warning "complies" claim while active
// electrical blockers exist. (The legacy PV-4A rulesResult summary is RETIRED;
// its only trace is an HTML comment, which the comment-strip removes.)
// ═══════════════════════════════════════════════════════════════════════════
const ELECTRICAL_BLOCKER_RE = /(CONDUIT-FILL|TAP-CONDUCTOR|ROUTE-LENGTH|FEEDER-RACEWAY|RACEWAY-BONDING|EQUIPMENT-IDENTITY)/;
const activeElectrical = registryCodes.filter(c => ELECTRICAL_BLOCKER_RE.test(c));
const zeroErrorClaim = (html.match(/\b0\s*errors?\b[^.]{0,30}\b0\s*warnings?\b/gi) || [])
  .concat(html.match(/\b0\s*errors?\s*(?:\/|·|,)?\s*compl(?:ies|iant)/gi) || []);
gate(4, 'no-zero-error-claim-with-active-blockers',
  !(activeElectrical.length > 0 && zeroErrorClaim.length > 0),
  `activeElectricalBlockers=${activeElectrical.length} · zeroErrorClaims=${zeroErrorClaim.length}`,
  { activeElectrical, zeroErrorClaim: zeroErrorClaim.slice(0, 2) });

// ═══════════════════════════════════════════════════════════════════════════
// GATE 5 — no undefined/NaN/null/non-finite rendered as a VALUE.
// ═══════════════════════════════════════════════════════════════════════════
const badValueRe = /(?:NaN|undefined|Infinity)\s*(?:%|A\b|V\b|ft\b|W\b|kW\b|lbs?\b|in\.|Ω|°)|>\s*(?:NaN|undefined|null|Infinity)\s*<|:\s+(?:NaN|undefined|Infinity)\b/g;
const badValues = (html.match(badValueRe) || []);
gate(5, 'no-undefined-nan-null-nonfinite-value', badValues.length === 0,
  `bad value renders=${badValues.length}`, badValues.slice(0, 5));

// ═══════════════════════════════════════════════════════════════════════════
// GATE 6 — no string DC materials (USE-2 home-run wire rows, DC roof wiring) in
// a pure-micro topology with no DC string segment objects.
// ═══════════════════════════════════════════════════════════════════════════
const hasDcStringSegment = (el.routeSegments || []).some(s => /DC[_-]?(STRING|HOMERUN|HOME_RUN)/i.test(s.segmentId || '') || s.electricalFunction === 'dc-string');
const dcMaterialRe = /(?:#1[02]\s*(?:AWG\s*)?USE-2|USE-2[^<]{0,40}(?:DC roof wiring|home[- ]?run|panels? to micro))|DC roof wiring \(open-air, panels to micro/gi;
const dcMaterialRows = (html.match(dcMaterialRe) || []);
gate(6, 'no-dc-materials-in-micro-topology',
  !(topologyMicro && !hasDcStringSegment && dcMaterialRows.length > 0),
  `micro=${topologyMicro} dcStringSegment=${hasDcStringSegment} dcMaterialRows=${dcMaterialRows.length}`,
  dcMaterialRows.slice(0, 3));

// ═══════════════════════════════════════════════════════════════════════════
// GATE 7 — raceway fittings match their segment: no 3/4" EMT DC-conduit fittings
// while the feeder is PVC 1-1/4" and no DC string segment exists (W4b).
// ═══════════════════════════════════════════════════════════════════════════
const emtFittingRe = /3\/4&quot;\s*EMT[^<]{0,40}(?:coupling|connector|fitting|strap|bushing)/gi;
const strayEmtFittings = (html.match(emtFittingRe) || []);
gate(7, 'fittings-match-segment',
  !(topologyMicro && !hasDcStringSegment && strayEmtFittings.length > 0),
  `stray 3/4" EMT DC fittings=${strayEmtFittings.length} (feeder is ${conduitLabel})`,
  strayEmtFittings.slice(0, 3));

// ═══════════════════════════════════════════════════════════════════════════
// GATE 8 — no substitute-equipment language in authoritative rows.
// ═══════════════════════════════════════════════════════════════════════════
const SUBSTITUTE_RES = [
  { name: 'or equivalent', re: /or equivalent/gi },
  { name: 'or approved equal', re: /or approved equal/gi },
  { name: 'or compatible', re: /or compatible/gi },
  { name: 'compatible rail', re: /compatible rail/gi },
  { name: 'contractor-selected', re: /contractor[- ]selected/gi },
  { name: 'RAIL-PENDING-SELECTION', re: /RAIL-PENDING-SELECTION/g },
  { name: 'RAIL-COMPAT', re: /RAIL-COMPAT/g },
];
const substituteHits = [];
for (const { name, re } of SUBSTITUTE_RES) { const m = html.match(re); if (m) substituteHits.push({ phrase: name, count: m.length }); }
gate(8, 'no-substitute-equipment-language', substituteHits.length === 0,
  `substitute phrases found=${substituteHits.length}`, substituteHits);

// ═══════════════════════════════════════════════════════════════════════════
// GATE 9 — no APP-A field differing from its verified document record.
// Every data-app-a-field claiming verified-document must carry a full provenance
// tuple (eq-id + doc-id + sku); and the corrected IQ8A values project (the W5a
// defect scalars 1.46 A / 96.5% / 2.2 lb / "349 … Peak" mislabel are absent).
// ═══════════════════════════════════════════════════════════════════════════
const appAFieldRe = /data-app-a-field="([^"]*)"([^>]*)>/g;
let appAFields = 0, appAProvenanceGaps = [];
for (const m of rawHtml.matchAll(appAFieldRe)) {
  appAFields++;
  const attrs = m[2];
  const verify = (attrs.match(/data-verify="([^"]*)"/) ?? [])[1] ?? null;
  const docId = (attrs.match(/data-doc-id="([^"]*)"/) ?? [])[1] ?? null;
  const eqId = (attrs.match(/data-eq-id="([^"]*)"/) ?? [])[1] ?? null;
  const sku = (attrs.match(/data-sku="([^"]*)"/) ?? [])[1] ?? null;
  if (verify === 'verified-document' && (!docId || !eqId || !sku)) appAProvenanceGaps.push({ field: m[1], verify, docId, eqId, sku });
}
const W5A_DEFECTS = [
  { name: '1.46 A (was max-cont)', re: /1\.46\s*A\b/g },
  { name: '96.5% (was CEC eff)', re: /96\.5\s*%/g },
  { name: '2.2 lb (was weight)', re: /\b2\.2\s*lb/g },
  { name: '349 … "Peak" mislabel', re: /349[^<]{0,20}peak/gi },
];
const w5aLeaks = W5A_DEFECTS.filter(d => d.re.test(html)).map(d => d.name);
gate(9, 'appA-equals-verified-document',
  appAFields > 0 && appAProvenanceGaps.length === 0 && w5aLeaks.length === 0,
  `appAFields=${appAFields} provenanceGaps=${appAProvenanceGaps.length} w5aDefectLeaks=${w5aLeaks.length}`,
  { appAProvenanceGaps: appAProvenanceGaps.slice(0, 3), w5aLeaks });

// ═══════════════════════════════════════════════════════════════════════════
// GATE 10 — one ThermalDesignBasis: the design MIN temp is single-valued.
// The APP-A −10 °C vs ASHRAE −23 °C split is eliminated (only −23 renders).
// ═══════════════════════════════════════════════════════════════════════════
const negTemps = [...new Set((html.match(/[−-]\s?(\d{1,2})\s?°C/g) || []).map(s => s.replace(/\s/g, '')))];
const hasMinus10 = negTemps.some(t => /[−-]10°C/.test(t));
const hasMinus23 = negTemps.some(t => /[−-]23°C/.test(t));
gate(10, 'single-thermal-design-basis',
  !(hasMinus10 && hasMinus23),
  `negative design temps rendered=${negTemps.join(', ') || 'none'} (split −10/−23 present=${hasMinus10 && hasMinus23})`, negTemps);

// ═══════════════════════════════════════════════════════════════════════════
// GATE 11 — RT-MINI capacity UNVERIFIED is never rendered as a PASS.
// No affirmative "600 lb … adequate", no "safety factor of X meets", and PE-1/
// PV-4C carry the UNVERIFIED gate. ("no attachment PASS is asserted" is honest.)
// ═══════════════════════════════════════════════════════════════════════════
const capacityPassLeak = []
  .concat(html.match(/safety factor of [\d.]+\s*(?:meets|exceeds)/gi) || [])
  .concat(html.match(/600\s*lb[^.]{0,40}(?:adequate|passes|acceptable|meets)/gi) || [])
  .concat(html.match(/capacity[^.]{0,30}\bPASS(?:ES|ED)?\b/gi) || [])
  .concat(html.match(/confirmed adequate/gi) || []);
const capacityUnverifiedShown = /UNVERIFIED/i.test(html) && (has('no attachment PASS') || /CAPACITY[^<]{0,40}UNVERIFIED|UNVERIFIED[^<]{0,40}(?:CAPACITY|STRUCTURAL SOURCE)/i.test(html));
gate(11, 'no-unverified-capacity-as-pass',
  !capacityGated || (capacityPassLeak.length === 0 && capacityUnverifiedShown),
  `capacityGated=${capacityGated} passLeaks=${capacityPassLeak.length} unverifiedShown=${capacityUnverifiedShown}`,
  capacityPassLeak.slice(0, 3));

// ═══════════════════════════════════════════════════════════════════════════
// GATE 12 — no affirmative certification conclusion on a pending PE/CERT page.
// ═══════════════════════════════════════════════════════════════════════════
const AFFIRMATIVE_CERT = ['I hereby certify', 'prepared under my direct supervision',
  'prepared under my supervision', 'confirmed adequate', 'is adequate to support', 'are adequate to support'];
const affLeak = certApproved ? [] : AFFIRMATIVE_CERT.filter(p => has(p));
gate(12, 'no-affirmative-on-pending-pe-cert', affLeak.length === 0,
  `certApproved=${certApproved} affirmativeLeaks=${affLeak.length}`, affLeak);

// ═══════════════════════════════════════════════════════════════════════════
// GATE 13 — pagination: every logical sheet has a title block; rendered sheet
// set === manifest (no unnumbered overflow sheet). (Static check; the physical
// per-sheet page-count report is produced separately via the Playwright shoot.)
// ═══════════════════════════════════════════════════════════════════════════
const manifestIds = (pa?.sheetIndex ?? []).map(s => s.id);
const renderedEqualsManifest = JSON.stringify(sheetIds) === JSON.stringify(manifestIds);
const everySheetHasId = sheetIds.every(id => id && id !== '?');
gate(13, 'no-unnumbered-overflow-pages',
  renderedEqualsManifest && everySheetHasId,
  `rendered=${sheetIds.length} manifest=${manifestIds.length} equal=${renderedEqualsManifest} everySheetTitled=${everySheetHasId}`,
  { renderedIds: sheetIds, manifestIds });

// ═══════════════════════════════════════════════════════════════════════════
// GATE 14 — blocker-registry completeness: EVERY active registry blocker is
// rendered on RS-1.
// ═══════════════════════════════════════════════════════════════════════════
const rs1Present = rs1.length > 0 && rs1.includes('ACTIVE RELEASE BLOCKERS');
const missingOnRs1 = registryCodes.filter(c => !rs1.includes(c));
gate(14, 'every-active-blocker-on-RS-1',
  rs1Present && registryCodes.length > 0 && missingOnRs1.length === 0,
  `RS-1 present=${rs1Present} activeBlockers=${registryCodes.length} missingOnRS-1=${missingOnRs1.length}`,
  { missingOnRs1, activeBlockers: registryCodes });

// ═══════════════════════════════════════════════════════════════════════════
// GATE 15 — no hidden equipment conflict: if the REC-405 vs Qcells-400 identity
// conflict is active, it is visibly rendered on RS-1 with its identifying detail.
// ═══════════════════════════════════════════════════════════════════════════
const conflictActive = registryCodes.includes('EQUIPMENT-IDENTITY-CONFLICT');
const conflictRendered = !conflictActive
  || (rs1.includes('EQUIPMENT-IDENTITY-CONFLICT') && /rec-alpha-pure-405|REC[^<]{0,20}405|equipment identity/i.test(rs1));
gate(15, 'no-hidden-equipment-conflict', conflictRendered,
  `conflictActive=${conflictActive} renderedOnRS-1=${conflictRendered}`, null);

// ═══════════════════════════════════════════════════════════════════════════
// GATE 16 — REPORT-EQUALS-RENDERED: the snapshot (the "report") key values are
// re-extracted FROM the final HTML and compared. Any mismatch fails closed.
// ═══════════════════════════════════════════════════════════════════════════
const projField = (field) => {
  const out = [];
  for (const m of rawHtml.matchAll(new RegExp(`data-project-field="${field}">([^<]*)<`, 'g'))) out.push(decode(m[1].trim()));
  return [...new Set(out)];
};
const sldSnapId = (rawHtml.match(/data-sld-snapshot-id="([^"]*)"/) ?? [])[1] ?? null;
const sldDigest = (rawHtml.match(/data-sld-digest="([^"]*)"/) ?? [])[1] ?? null;
const skuTags = [...new Set([...rawHtml.matchAll(/data-sku="([^"]*)"/g)].map(m => m[1]))];
const invSku = pa?.equipmentSummary?.inverterSku || snap.equipment?.inverters?.[0]?.sku || 'IQ8A-72-2-US';
const moduleModel = [pa?.equipmentSummary?.moduleManufacturer, pa?.equipmentSummary?.moduleModel].filter(Boolean).join(' ').trim();

const reconcile = [];
const check = (name, reportVal, foundInHtml, extra) => { reconcile.push({ name, reportVal: `${reportVal}`, matchedInRendered: !!foundInHtml, ...extra }); return !!foundInHtml; };

// snapshot id: title block + SLD stamp both equal meta.snapshotId
const snapIdFields = projField('snapshot-id');
check('snapshotId', meta.snapshotId, snapIdFields.includes(meta.snapshotId) && (sldSnapId === null || sldSnapId === meta.snapshotId),
  { titleBlockValues: snapIdFields, sldStamp: sldSnapId });
// digest prefix is a genuine prefix of meta.digest, identical across title block + SLD
const digestFields = projField('digest');
const digestOk = digestFields.length > 0 && digestFields.every(v => v && (meta.digest || '').startsWith(v))
  && (sldDigest === null || (meta.digest || '').startsWith(sldDigest));
check('digestPrefix', (meta.digest || '').slice(0, 12), digestOk, { titleBlockValues: digestFields, sldStamp: sldDigest });
// feeder conduit label projected verbatim
check('feederConduit', conduitLabel, !conduitLabelEnc || has(conduitLabelEnc));
// feeder VD — the snapshot VD, rounded 2dp, appears
const vdStr = canVd != null ? canVd.toFixed(2) : null;
check('feederVoltageDropPct', vdStr, vdStr == null || has(`${vdStr}%`) || has(vdStr));
// inverter SKU present in a data-sku tag
check('inverterSku', invSku, skuTags.includes(invSku), { skuTagsFound: skuTags });
// module model projected
const moduleFields = projField('module-model');
check('moduleModel', moduleModel, moduleModel === '' || moduleFields.some(v => v && (v.includes(moduleModel) || moduleModel.includes(v))), { titleBlockValues: moduleFields });
// attachment count from the reaction reconciliation appears on the structural sheet
const attCount = rr.attachmentCount ?? st.attachmentCount ?? null;
check('attachmentCount', attCount, attCount == null || new RegExp(`\\b${attCount}\\b`).test(html));
// issue state projected (and is a non-issuable pending state)
const issueFields = projField('issue-status');
check('issueState', pa?.issueState, pa?.issueState == null || issueFields.includes(pa.issueState), { titleBlockValues: issueFields });
// active blocking-blocker count === RS-1 rendered BLOCKING count
const rs1BlockingNum = (() => { const m = rs1.match(/BLOCKING<\/span>\s*<span[^>]*>(\d+)</); return m ? Number(m[1]) : null; })();
const blockingCount = registry.filter(r => r.severity === 'blocking').length;
check('blockingBlockerCount', blockingCount, rs1BlockingNum == null || rs1BlockingNum === blockingCount, { rs1RenderedBlocking: rs1BlockingNum });

const reportRenderedMismatches = reconcile.filter(r => !r.matchedInRendered);
gate(16, 'report-equals-rendered', reportRenderedMismatches.length === 0,
  `reconciled=${reconcile.length} mismatches=${reportRenderedMismatches.length}`,
  reportRenderedMismatches);

// ═══════════════════════════════════════════════════════════════════════════
// GATE 17 — no renderer-local ENGINEERING CALCULATION. The W6b APP-A fastener
// length formula ceil((embedment+1.5)*2)/2 and any electrical/structural math in
// a section renderer is a bypass of the engine.
// ═══════════════════════════════════════════════════════════════════════════
// RENDERED anchor: the W6b defect was APP-A FABRICATING a "5/16" DIA × 4" Min.
// Stainless Steel" lag from a ceil((embed+1.5)*2)/2 formula, CONTRADICTING the
// RT-MINI record's 3.5" structural wood screw. Fail if that fabricated 4" SS lag
// renders. SOURCE anchor: the fastener-length invention formula must not live in
// the APP-A/compliance projection renderer (its W6b home). (The CAD drafting
// detail renders the EXACT record length first and only estimates a stack-up
// length for a mount that pins no fastenerLengthIn — validated against the
// record by the rendered check, not truth-originated for a record-complete mount.)
const fabricatedLag = []
  .concat(html.match(/5\/16&quot;\s*DIA\s*[×x]\s*4&quot;\s*Min\.?\s*Stainless/gi) || [])
  .concat(html.match(/[×x]\s*4(?:\.0)?&quot;[^<]{0,20}(?:SS|Stainless)[^<]{0,10}lag/gi) || []);
const apAFormula = scanRenderers([
  { name: 'APP-A fastener-length invention formula (W6b)', re: /Math\.ceil\(\(\s*_?embed[A-Za-z]*\s*\+\s*1\.5\s*\)\s*\*\s*2\s*\)/ },
], () => false, ['lib/permit/sections/compliancePages.ts']);
gate(17, 'no-renderer-local-engineering-calc',
  fabricatedLag.length === 0 && apAFormula.length === 0,
  `fabricated-4in-lag renders=${fabricatedLag.length} · APP-A length-formula source hits=${apAFormula.length}`,
  { fabricatedLag: fabricatedLag.slice(0, 2), apAFormula });

// ═══════════════════════════════════════════════════════════════════════════
// GATE 18 — no renderer-local PRODUCT SELECTION. Section renderers must consume
// the snapshot equipment projection, never re-select a product from the DB.
// (The W5a APP-A _dbFind path is retired; DS resolution lives in the appendix
// resolver + snapshot, not in APP-A/compliance body selection.)
// ═══════════════════════════════════════════════════════════════════════════
// The W5a defect: APP-A's VERIFIED-DOCUMENT microinverter table SELECTED its
// spec scalars from a renderer-local fuzzy DB find. After the repair the micro
// APP-A table projects from projectMicroinverterDatasheet (verified equipment +
// document record chain, per-value provenance — proven by gate 9). Gate 18 fails
// if a renderer-local product SELECTION originates a value inside the
// verified-document surface: any `_dbMicro.<spec>` scalar printed (only `.id`
// for the citation ref + presence-gating is allowed). (The general module-spec
// reference table renders WITHOUT a data-verify claim — it is not a
// verified-document projection and is out of the W5 verified-record scope.)
const compSrc = stripComments(readSafe('lib/permit/sections/compliancePages.ts') ?? '');
const microProjectionPresent = /projectMicroinverterDatasheet\s*\(/.test(compSrc);
const dbMicroScalarPrints = [];
for (const m of compSrc.matchAll(/_dbMicro\??\.(\w+)/g)) {
  if (m[1] === 'id') continue;              // citation-ref + presence gating only
  const line = compSrc.slice(0, m.index).split('\n').length;
  dbMicroScalarPrints.push({ file: 'lib/permit/sections/compliancePages.ts', line, access: m[0] });
}
gate(18, 'no-renderer-local-product-selection',
  microProjectionPresent && dbMicroScalarPrints.length === 0,
  `micro APP-A projection present=${microProjectionPresent} · _dbMicro scalar prints into verified surface=${dbMicroScalarPrints.length}`,
  dbMicroScalarPrints.slice(0, 5));

// ═══════════════════════════════════════════════════════════════════════════
// GATE 19 — no renderer-local ISSUE-STATE / CERT decision. Issue state comes
// from projectAuthority; cert affirmation gates on certificationApproved.
// ═══════════════════════════════════════════════════════════════════════════
const issueHits = [];
for (const rel of ['lib/permit/sections/coverSheet.ts', 'lib/permit/sections/certPages.ts', 'lib/permit/utils/titleBlock.ts']) {
  const src = readSafe(rel); if (src == null) continue;
  const code = stripComments(src);
  for (const { name, re } of [
    { name: 'literal ISSUED-FOR-PERMIT decision', re: /issueState\s*=\s*['"](?:ISSUED FOR PERMIT|PERMIT-READY)['"]/g },
    { name: 'local approved-boolean from raw field', re: /const\s+\w*[Aa]pproved\s*=\s*(?!certificationApproved|snap|input\._snapshot|_sp\.|pa\.)[^;]*(?:sealed|signature|stamp)/g },
  ]) {
    for (const m of code.matchAll(re)) { const line = code.slice(0, m.index).split('\n').length; issueHits.push({ file: rel, line, pattern: name, text: m[0].slice(0, 60) }); }
  }
}
gate(19, 'no-renderer-local-issue-or-cert-decision', issueHits.length === 0,
  `renderer-local issue/cert decisions=${issueHits.length}`, issueHits.slice(0, 5));

// ═══════════════════════════════════════════════════════════════════════════
// GATE 20 — no body/BOM/note bypass of canonical CODE / PROJECT authority: no
// code-edition literal (NEC/IBC/IRC/IFC 20xx, ASCE 7-xx) hardcoded in a renderer.
// ═══════════════════════════════════════════════════════════════════════════
// RENDERED anchor: no code-edition literal in the package may CONTRADICT the
// codeAuthority. Braidon authority: NEC 2020, ASCE 7-22 (engine basis), IBC/IRC/
// IFC edition = null (PENDING — no AHJ adoption). Rule: NEC literals == the
// authority edition; NO IBC/IRC/IFC edition may be asserted while the authority
// is null; ASCE literals == the authority edition EXCEPT inside an explicitly
// flagged UNVERIFIED source-document citation (the RT-MINI PE letter's "ASCE
// 7-10, KY … not confirmed / do not apply" provenance — the reason the racking
// capacity blocker is active, never a governing-code claim).
const editions = ca?.editions ?? {};
const authNec = editions.nec?.edition ?? null;
const authAsce = editions.asce?.edition ?? null;
const renderedContradictions = [];
// NEC
for (const lit of new Set((html.match(/\bNEC\s+(20\d\d)\b/g) || []))) {
  const yr = lit.match(/(20\d\d)/)[1];
  if (authNec == null || yr !== authNec) renderedContradictions.push({ family: 'NEC', rendered: lit, authority: authNec ?? 'PENDING' });
}
// IBC/IRC/IFC — any asserted edition contradicts a null (PENDING) authority
for (const fam of ['IBC', 'IRC', 'IFC']) {
  const auth = editions[fam.toLowerCase()]?.edition ?? null;
  for (const lit of new Set((html.match(new RegExp(`\\b${fam}\\s+(20\\d\\d)\\b`, 'g')) || []))) {
    const yr = lit.match(/(20\d\d)/)[1];
    if (auth == null || yr !== auth) renderedContradictions.push({ family: fam, rendered: lit, authority: auth ?? 'PENDING' });
  }
}
// ASCE — allow the authority edition; any other edition must sit inside a flagged
// unverified-source citation.
const flaggedSourceCtx = (idx) => {
  const w = html.slice(Math.max(0, idx - 260), idx + 260);
  return /not confirmed|do not apply|do NOT apply|PE[- ]?letter|structural letter|KY\b|Kentucky|jurisdiction/i.test(w);
};
for (const m of html.matchAll(/\bASCE\s+7-(\d\d)\b/g)) {
  const ed = `7-${m[1]}`;
  if (authAsce && ed === authAsce) continue;
  if (flaggedSourceCtx(m.index)) continue;   // honest unverified-source provenance
  renderedContradictions.push({ family: 'ASCE', rendered: m[0], authority: authAsce ?? 'PENDING' });
}
// SOURCE anchor: no edition literal in the authority-PROJECTION renderer surface.
const codeLiteralHits = scanRenderers([
  { name: 'NEC/IBC/IRC/IFC edition literal', re: /\b(?:NEC|IBC|IRC|IFC)\s+20\d\d\b/ },
  { name: 'ASCE edition literal', re: /\bASCE\s+7-\d\d\b/ },
  { name: 'necVersion fallback literal', re: /necVersion\s*(?:\|\||\?\?)\s*['"]20\d\d/ },
], () => false, PROJECTION_RENDERERS);
gate(20, 'no-code-project-authority-bypass',
  renderedContradictions.length === 0 && codeLiteralHits.length === 0,
  `rendered edition contradictions=${renderedContradictions.length} · projection-renderer literals=${codeLiteralHits.length}`,
  { renderedContradictions, codeLiteralHits: codeLiteralHits.slice(0, 6) });

// ═══════════════════════════════════════════════════════════════════════════
// assemble + emit
// ═══════════════════════════════════════════════════════════════════════════
const failed = gates.filter(g => !g.ok);
const report = {
  generatedAt: new Date().toISOString(),
  harness: 'planset-evidence-rp (repair-pass rendered-truth, 20 permanent gates)',
  mode: MODE,
  htmlPath: path.relative(repoRoot, htmlPath).replace(/\\/g, '/'),
  snapshotId: meta.snapshotId, digest: meta.digest, schemaVersion: meta.schemaVersion, engineVersion: meta.engineVersion,
  project: 'BRAIDON M PILLA — Solar TEST',
  sheetCount: pages.length, sheetIds,
  topology: el.topology, feeder: { conduitLabel, voltageDropPct: canVd, fillPct: canFill },
  reactionReconciliation: { present: rr.present, ok: rr.ok, attachmentCount: rr.attachmentCount, tributarySumFt2: rr.tributarySumFt2, arrayAreaFt2: rr.arrayAreaFt2 },
  activeBlockers: registryCodes,
  reportEqualsRendered: { reconciled: reconcile, mismatches: reportRenderedMismatches },
  gates,
  summary: {
    total: gates.length,
    passed: gates.length - failed.length,
    failed: failed.map(g => `gate ${g.gate}: ${g.id}`),
    allPass: failed.length === 0,
  },
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`[rp-evidence:${MODE}] ${outPath} — snapshot ${meta.snapshotId} (${pages.length} sheets)`);
for (const g of gates) console.log(`[rp-evidence:${MODE}] ${g.ok ? 'PASS' : 'FAIL'} gate ${String(g.gate).padStart(2)} ${g.id} — ${g.detail}`);
console.log(`[rp-evidence:${MODE}] ${report.summary.passed}/${report.summary.total} gates pass · report-equals-rendered mismatches=${reportRenderedMismatches.length}`);
if (failed.length) { console.log(`[rp-evidence:${MODE}] BLOCKING FAILURES: ${report.summary.failed.join(' | ')}`); process.exit(2); }
process.exit(0);
