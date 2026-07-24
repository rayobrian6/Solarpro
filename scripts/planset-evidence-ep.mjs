// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-ep — ELECTRICAL / PROCUREMENT CLOSEOUT rendered-truth harness.
//
//   Usage: node scripts/planset-evidence-ep.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = original (frozen fixture) | live (current DB design)
//
// The EP successor to planset-evidence-co.mjs. It regenerates NOTHING: it reads
// the REAL rendered permit package HTML + its PermitDesignSnapshot and runs the
// 20 PERMANENT EP GATES from docs/ELECTRICAL-PROCUREMENT-CLOSEOUT-DIRECTIVE.md
// ("Permanent regression gates (rendered output)") against the RENDERED output
// (+ the snapshot authority it must equal). Gate 19 invokes the TRUE geometry
// page-fit validator (scripts/planset-pagefit.mjs — incl. internal-clip scan).
//
// It fails CLOSED. Any stale electrical projection, conductor-count mismatch, Q
// Cable quantity mismatch, hidden pending PASS, unselected procurement authority,
// code/topology label mismatch, omitted blocker, clipping, or evidence/rendered
// mismatch exits NON-ZERO.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [htmlPath, snapPath, outPath = 'braidon-ep.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) { console.error('usage: planset-evidence-ep.mjs <html> <snapshot.json> [out]'); process.exit(1); }
const MODE = process.env.EVIDENCE_MODE === 'live' ? 'live' : (process.env.EVIDENCE_MODE || 'original');
const repoRoot = process.cwd();

const rawHtml = fs.readFileSync(htmlPath, 'utf8');
// value scans run on a COMMENT-STRIPPED, base64-image-stripped copy — a comment
// documenting a RETIRED claim, or an "EMT" byte inside a datasheet image blob,
// must never be read as a live rendered claim.
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const noB64 = html.replace(/data:image[^"')]+/g, '');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

const meta = snap.meta || {};
const el = snap.electrical || {};
const st = snap.structural || {};
const pa = snap.projectAuthority || null;
const pr = snap.permitReadiness || {};
const registry = (pr.registry ?? []).filter(r => !r.resolved);
const registryCodes = registry.map(r => r.code);
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const segs = el.routeSegments || [];
const rws = el.physicalRaceways || [];
const topo = el.serviceTopology || [];
const asm = el.listedCableAssembly || null;
const paths = el.branchCablePaths || [];
const branches = el.branches || [];
const WASTE = 1.15;

const isSupplySide = String(el.interconnectionMethod || '').toUpperCase().includes('SUPPLY_SIDE')
  || /705\.11/.test(html) && topo.some(o => /tap/.test(o.type || ''))
  || topo.some(o => /tap/.test(o.type || ''));
const topologyMicro = String(el.topology || '').toLowerCase() === 'micro';
const hasEmtRaceway = rws.some(r => /EMT/i.test(r.racewayType || ''));

const pages = rawHtml.split(/<div class="page(?=[ "])/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);
const manifestIds = (pa?.sheetIndex ?? []).map(s => s.id);

const gates = [];
const gate = (num, id, ok, detail, evidence) => { gates.push({ gate: num, id, ok: !!ok, detail, evidence: evidence ?? null }); return ok; };

// ═══ GATE 1 — E-1 renders canonical section IDs (no merged branch row). ══════
const g1_header = html.includes('E-1 PHYSICAL CONDUCTOR / RACEWAY SCHEDULE');
const g1_ids = ['BRANCH_RUN', 'BRANCH_HOMERUN_RUN', 'COMBINER_TO_DISCO_RUN', 'svc-tap-conductors'];
const g1_missing = g1_ids.filter(id => !html.includes(id));
const g1_snapSecs = !!segs.find(s => s.segmentId === 'BRANCH_RUN') && !!segs.find(s => s.segmentId === 'BRANCH_HOMERUN_RUN');
gate(1, 'e1-canonical-section-ids', g1_header && g1_missing.length === 0 && g1_snapSecs,
  `header=${g1_header} missingIds=${g1_missing.join(',') || 'none'} snapSectioned=${g1_snapSecs}`, { g1_missing });

// ═══ GATE 2 — E-1 conductor counts == physical-raceway inventory. ════════════
const hrRw = rws.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId));
const hrCcc = hrRw?.currentCarryingCount ?? null;
const g2_cccMath = hrCcc != null && hrCcc === branches.length * 2;
// the E-1 SVG must print N#10 for the shared home-run, never #12.
const e1SvgStart = noB64.indexOf('SINGLE-LINE ELECTRICAL DIAGRAM');
const e1SvgEnd = noB64.indexOf('E-1 PHYSICAL CONDUCTOR');
const e1Svg = (e1SvgStart >= 0 && e1SvgEnd > e1SvgStart) ? noB64.slice(e1SvgStart, e1SvgEnd) : '';
const g2_svgToken = hrCcc != null && e1Svg.includes(`${hrCcc}#10 THWN-2`);
const g2_svgNo12 = e1Svg.length > 0 && !e1Svg.includes('#12');
// every raceway's CCC = conductorCount − 1 (single shared EGC excluded)
const g2_invEach = rws.every(r => r.currentCarryingCount != null && r.conductorCount != null
  && r.currentCarryingCount === r.conductorCount - 1);
gate(2, 'e1-conductor-count-equals-raceway-inventory',
  g2_cccMath && g2_svgToken && g2_svgNo12 && g2_invEach,
  `hrCcc=${hrCcc} =2×branches(${branches.length})=${g2_cccMath} svg'${hrCcc}#10'=${g2_svgToken} svgNo#12=${g2_svgNo12} ccc==cnt-1(all)=${g2_invEach}`, null);

// ═══ GATE 3 — no E-1 section prints PASS while length/fill/tap is pending. ════
const e1SchedStart = html.indexOf('E-1 PHYSICAL CONDUCTOR / RACEWAY SCHEDULE');
const e1Sched = e1SchedStart >= 0 ? html.slice(e1SchedStart, e1SchedStart + 4000) : '';
const g3_noPass = e1Sched.length > 0 && !/\bPASS\b/.test(e1Sched);
const g3_pendingShown = /PENDING|REVIEW/.test(e1Sched);
gate(3, 'e1-no-pass-with-pending', g3_noPass && g3_pendingShown,
  `e1SchedFound=${e1Sched.length > 0} noPASS=${g3_noPass} pendingShown=${g3_pendingShown} passCount=${(e1Sched.match(/\bPASS\b/g) || []).length}`, null);

// ═══ GATE 4 — no live EMT literal without an EMT raceway object. ══════════════
const g4_emtHits = (noB64.match(/\bEMT\b/g) || []).length;
gate(4, 'no-emt-literal-without-emt-raceway', hasEmtRaceway || g4_emtHits === 0,
  `emtRacewayObject=${hasEmtRaceway} liveEmtLiterals=${g4_emtHits}`, null);

// ═══ GATE 5 — PV-4A blocker codes/severities == RS-1 electrical domain subset. ═
const elecReg = registry.filter(r => r.domain === 'electrical');
const g5_missing = elecReg.filter(r => !html.includes(r.code)).map(r => r.code);
const g5_tapExact = html.includes('TAP-CONDUCTOR-LENGTH-PENDING') && !html.includes('TAP-LENGTH-PENDING<');
gate(5, 'pv4a-blocker-multiset-equals-rs1-subset',
  elecReg.length > 0 && g5_missing.length === 0 && g5_tapExact,
  `elecCodes=${elecReg.length} missingOnRendered=${g5_missing.join(',') || 'none'} tapExactCode=${g5_tapExact}`, { g5_missing });

// ═══ GATE 6 — Q Cable is a listed assembly, never generic THWN-2. ════════════
const g6_asmPresent = !!asm && !!asm.sku;
const g6_skuRendered = g6_asmPresent && html.includes(asm.sku);
const g6_modelRendered = /Q[- ]?Cable/i.test(html);
// the free-air branch trunk must NOT be described as a generic #12 THWN-2 row.
// The only legitimate '#12 AWG THWN-2' is a green EGC in a conduit run.
const g6_genericBranch = [...html.matchAll(/#12 AWG THWN-2([^<]{0,18})/g)]
  .map(m => m[1]).filter(tail => !/Green EGC|EGC|Ground/i.test(tail));
gate(6, 'qcable-never-generic-thwn2',
  g6_asmPresent && g6_skuRendered && g6_modelRendered && g6_genericBranch.length === 0,
  `assembly=${g6_asmPresent} sku'${asm?.sku}'=${g6_skuRendered} qcableLabel=${g6_modelRendered} genericBranchRows=${g6_genericBranch.length}`,
  { g6_genericBranch });

// ═══ GATE 7 — Q Cable route lengths == BOM cable quantities (recompute). ═════
const dropSum = paths.reduce((s, p) => s + (p.dropCount || 0), 0);
const procSum = paths.reduce((s, p) => s + (p.procurementLengthFt || 0), 0);
const moduleInstances = (snap.geometry?.moduleInstances || []).length;
const branchModuleSum = branches.reduce((s, b) => s + (b.moduleCount || 0), 0);
// independent recompute: procurement footage = ceil(Σ drops × pitch × waste)
const g7_recompute = asm?.connectorSpacingFt ? Math.ceil(dropSum * asm.connectorSpacingFt * WASTE) : null;
const g7_dropInvariant = dropSum > 0 && moduleInstances === dropSum && branchModuleSum === dropSum;
const g7_procMatch = g7_recompute != null && procSum === g7_recompute;
// the reconciling drop count + the recomputed footage both appear in the BOM.
const g7_bomDrops = new RegExp(`\\b${dropSum}\\b`).test(html);
const g7_bomFootage = new RegExp(`${g7_recompute}\\s*ft`).test(html) || new RegExp(`≈?\\s*${g7_recompute}`).test(html);
gate(7, 'qcable-lengths-equal-bom',
  g7_dropInvariant && g7_procMatch && g7_bomDrops && g7_bomFootage,
  `dropSum=${dropSum} modInst=${moduleInstances} branchSum=${branchModuleSum} recompute=ceil(${dropSum}×${asm?.connectorSpacingFt}×${WASTE})=${g7_recompute} procSum=${procSum} procMatch=${g7_procMatch} bomDrops=${g7_bomDrops} bomFootage=${g7_bomFootage}`, null);

// ═══ GATE 8 — no module DC wire row without a canonical DC segment. ══════════
const hasDcSeg = segs.some(s => /DC[_-]?(STRING|HOMERUN|HOME_RUN)/i.test(s.segmentId || '') || s.electricalFunction === 'dc-string');
const dcRows = (html.match(/(?:#1[02]\s*(?:AWG\s*)?USE-2|USE-2[^<]{0,40}(?:DC roof wiring|home[- ]?run)|DC Conductor in Conduit)/gi) || []);
gate(8, 'no-unbacked-module-dc-row',
  !(topologyMicro && !hasDcSeg && dcRows.length > 0),
  `micro=${topologyMicro} dcSegment=${hasDcSeg} dcRows=${dcRows.length}`, dcRows.slice(0, 3));

// ═══ GATE 9 — supply-side never COMPLIES while the tap rule is pending. ══════
const tapPending = registryCodes.includes('TAP-CONDUCTOR-LENGTH-PENDING')
  || (el.serviceTopology || []).some(o => /tap/.test(o.type || '') && String(o.verificationStatus || '').includes('pending'));
const g9_bareComplies = (strip(noB64).match(/\bCOMPLIES\b/g) || []).length;
const g9_methodSelected = /SUPPLY-SIDE TAP\s*[—-]\s*SELECTED/i.test(strip(noB64)) || /Supply.?Side Tap[^.]{0,40}NEC 705\.11/i.test(strip(noB64));
const g9_installPending = /tap-conductor[^.]{0,60}(?:PENDING|not measured|not verified)/i.test(strip(noB64))
  || /Install compliance:[^.]{0,80}(?:pending|gated)/i.test(strip(noB64));
gate(9, 'supply-side-never-complies-while-tap-pending',
  !isSupplySide || (g9_bareComplies === 0 && g9_methodSelected && (!tapPending || g9_installPending)),
  `supplySide=${isSupplySide} tapPending=${tapPending} bareComplies=${g9_bareComplies} methodSelected=${g9_methodSelected} installPendingShown=${g9_installPending}`, null);

// ═══ GATE 10 — every printed length identifies design/calc/procurement. ══════
// the length taxonomy exists on the canonical segments AND is projected: route
// drawings label the estimate provenance, calc sheets a calc length, the BOM a
// procurement length. Verify the taxonomy fields exist and the labels render.
const branchSeg = segs.find(s => s.segmentId === 'BRANCH_RUN');
const g10_taxonomy = !!branchSeg
  && branchSeg.geometricDesignLengthFt != null && branchSeg.calculationLengthFt != null
  && branchSeg.procurementLengthFt != null && !!branchSeg.lengthProvenance && !!branchSeg.verificationState;
const g10_designLabel = /CAD-derived|design length|geometry-derived|estimate/i.test(html);
const g10_procLabel = /PROCUREMENT/i.test(html);
gate(10, 'length-taxonomy-labeled',
  g10_taxonomy && g10_designLabel && g10_procLabel,
  `taxonomyFields=${g10_taxonomy} designLabel=${g10_designLabel} procLabel=${g10_procLabel}`,
  branchSeg ? { geo: branchSeg.geometricDesignLengthFt, calc: branchSeg.calculationLengthFt, proc: branchSeg.procurementLengthFt, prov: branchSeg.lengthProvenance } : null);

// ═══ GATE 11 — no unselected racking candidate as orderable BOM authority. ═══
const railPending = (st?.rackingAssembly?.railSku ?? null) == null
  || registryCodes.includes('PENDING-RACKING-ASSEMBLY-SELECTION');
const g11_pendingShown = html.includes('PENDING RACKING ASSEMBLY SELECTION');
// no assembly-dependent orderable SKU rows while the rail is unpinned.
const g11_orderableLeaks = ['T-BOLT-38', 'RT-MINI End Clamp', 'RT-MINI Mid Clamp', 'RT-MINI Bond Clip', 'XR100']
  .filter(sku => html.includes(sku));
gate(11, 'no-unselected-racking-orderable',
  !railPending || (g11_pendingShown && g11_orderableLeaks.length === 0),
  `railPending=${railPending} pendingShown=${g11_pendingShown} orderableLeaks=${g11_orderableLeaks.join(',') || 'none'}`,
  { g11_orderableLeaks });

// ═══ GATE 12 — equipment-document applicability enforced. ════════════════════
const docApplBlocker = registryCodes.includes('EQUIPMENT-DOCUMENT-APPLICABILITY');
const g12_ds3NonAuth = /not authoritative|different product version|non-authoritative/i.test(html);
gate(12, 'equipment-document-applicability',
  !docApplBlocker || g12_ds3NonAuth,
  `applicabilityBlocker=${docApplBlocker} ds3MarkedNonAuthoritative=${g12_ds3NonAuth}`, null);

// ═══ GATE 13 — every visible pending authority is in the registry. ═══════════
const fastenerVisible = html.includes('PENDING VERIFIED FASTENER ASSEMBLY');
const fastenerRegistered = registryCodes.includes('FASTENER-ASSEMBLY-UNVERIFIED');
gate(13, 'visible-pending-authority-in-registry',
  !fastenerVisible || fastenerRegistered,
  `fastenerPendingVisible=${fastenerVisible} FASTENER-ASSEMBLY-UNVERIFIED-in-registry=${fastenerRegistered}`, null);

// ═══ GATE 14 — unverified spacing never "maximum allowed". ═══════════════════
const g14_maxOc = /48"?\s*max(?:imum)?\s*(?:allowed\s*)?O\.?C/i.test(html)
  || /max(?:imum)?\s*(?:allowed\s*)?(?:attach(?:ment)?\s*)?spacing[^.<]{0,20}48/i.test(html);
const g14_designShown = /DESIGN ATTACHMENT SPACING/i.test(html) && /PENDING STRUCTURAL VERIFICATION/i.test(html);
gate(14, 'unverified-spacing-never-max-allowed',
  !g14_maxOc && g14_designShown,
  `maxAllowedWording=${g14_maxOc} designSpacing+pending=${g14_designShown}`, null);

// ═══ GATE 15 — unverified fire basis never an "AHJ requirement". ═════════════
const g15_provisional = html.includes('PROVISIONAL FIRE SETBACK BASIS');
const g15_perAhj = /\bper AHJ\b/.test(html);
gate(15, 'unverified-fire-basis-never-ahj-requirement',
  g15_provisional && !g15_perAhj,
  `provisionalBasisShown=${g15_provisional} barePerAHJ=${g15_perAhj}`, null);

// ═══ GATE 16 — no load-side-only labels on a supply-side system. ═════════════
// the load-side-only back-fed-breaker placard (NEC 705.12(D)(2)(3)(b)) must be
// marked N/A — never required — on a supply-side (705.11) design.
const backfedRowM = html.match(/705\.12\(D\)\(2\)\(3\)\(b\)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*</i)
  ?? strip(html).match(/705\.12\(D\)\(2\)\(3\)\(b\)\s*(N\/A|YES\*?)/i);
const backfedApplic = backfedRowM ? decode(backfedRowM[1].trim()) : null;
const g16_backfedNa = !isSupplySide || (backfedApplic != null && /N\/A/i.test(backfedApplic));
gate(16, 'no-load-side-only-labels-on-supply-side',
  g16_backfedNa,
  `supplySide=${isSupplySide} backfedBreakerApplicability=${backfedApplic}`, null);

// ═══ GATE 17 — pending adopted codes are never compliance authority. ═════════
const g17_split = html.includes('CALC BASIS:') && html.includes('AHJ-ADOPTED IBC / IRC / IFC:') && html.includes('PENDING VERIFICATION');
const g17_conflated = /designed per[^.]*IBC PENDING/i.test(html) || /designed per\s+NEC/i.test(html);
gate(17, 'pending-adopted-codes-not-compliance-authority',
  g17_split && !g17_conflated,
  `basisSplit=${g17_split} conflatedDesignedPer=${g17_conflated}`, null);

// ═══ GATE 18 — RS continuation pagination complete + every blocker legible. ══
const g18_rs1Manifest = manifestIds.includes('RS-1');
const g18_allCodes = registry.filter(r => !html.includes(r.code)).map(r => r.code);
const g18_enlarged = html.includes('font-size:8.7px');
// if the registry spills past one RS-1 page, a formal RS-1.1 continuation must
// exist; at the current count it fits on RS-1 (RS-1.1 not required).
const g18_needsCont = registry.length > 22;
const g18_contOk = !g18_needsCont || manifestIds.includes('RS-1.1');
gate(18, 'rs-pagination-complete',
  g18_rs1Manifest && g18_allCodes.length === 0 && g18_enlarged && g18_contOk,
  `rs1InManifest=${g18_rs1Manifest} missingCodes=${g18_allCodes.join(',') || 'none'} enlarged8.7px=${g18_enlarged} needsCont=${g18_needsCont} contOk=${g18_contOk}`,
  { g18_allCodes });

// ═══ GATE 19 — zero meaningful overflow incl. internal clips (pagefit). ══════
const pf = spawnSync(process.execPath, [path.resolve(repoRoot, 'scripts/planset-pagefit.mjs'), htmlPath], { encoding: 'utf8' });
const pfLine = ((pf.stdout || '').match(/\[pagefit\][^\n]*/g) || []).pop() || (pf.stderr || '').trim().slice(0, 160);
gate(19, 'geometry-page-fit-incl-internal-clips', pf.status === 0,
  `pagefit exit=${pf.status} · ${pfLine}`, null);

// ═══ GATE 20 — evidence JSON == re-extracted rendered values. ════════════════
const projField = (field) => [...new Set([...rawHtml.matchAll(new RegExp(`data-project-field="${field}">([^<]*)<`, 'g'))].map(m => decode(m[1].trim())))];
const reconcile = [];
const rcheck = (name, reportVal, matched, extra) => { reconcile.push({ name, reportVal: `${reportVal}`, matchedInRendered: !!matched, ...extra }); };
const snapIdFields = projField('snapshot-id');
rcheck('snapshotId', meta.snapshotId, snapIdFields.includes(meta.snapshotId), { titleBlockValues: snapIdFields });
const digestFields = projField('digest');
rcheck('digestPrefix', (meta.digest || '').slice(0, 12), digestFields.length > 0 && digestFields.every(v => v && (meta.digest || '').startsWith(v)), { titleBlockValues: digestFields });
const F = el.feeder || {};
const conduitLabel = (F?.conduit?.raceway && F?.conduit?.tradeSizeIn) ? `${F.conduit.raceway} ${F.conduit.tradeSizeIn}` : (F?.conduit?.raceway ?? null);
rcheck('feederConduit', conduitLabel, !conduitLabel || html.includes(conduitLabel.replace(/"/g, '&quot;')));
rcheck('qcableSku', asm?.sku, asm?.sku == null || html.includes(asm.sku));
rcheck('qcableDropCount', dropSum, dropSum === 0 || new RegExp(`\\b${dropSum}\\b`).test(html));
const blockingCount = registry.filter(r => r.severity === 'blocking').length;
const rs1 = (rawHtml.split('<div class="page').find(p => /ACTIVE RELEASE BLOCKERS/i.test(p)) ?? '');
const rs1BlockingNum = (() => { const m = rs1.match(/BLOCKING<\/span>\s*<span[^>]*>(\d+)</) ?? rs1.match(/(\d+)\s*(?:OPEN\s*)?(?:RELEASE\s*)?BLOCKERS?/i); return m ? Number(m[1]) : null; })();
rcheck('blockingBlockerCount', blockingCount, rs1BlockingNum == null || rs1BlockingNum === blockingCount, { rs1Rendered: rs1BlockingNum });
const moduleModel = [pa?.equipmentSummary?.moduleManufacturer, pa?.equipmentSummary?.moduleModel].filter(Boolean).join(' ').trim();
const moduleFields = projField('module-model');
rcheck('moduleModel', moduleModel, moduleModel === '' || moduleFields.some(v => v && (v.includes(moduleModel) || moduleModel.includes(v))));
const mismatches = reconcile.filter(r => !r.matchedInRendered);
gate(20, 'evidence-equals-rendered', mismatches.length === 0,
  `reconciled=${reconcile.length} mismatches=${mismatches.length}`, mismatches);

// ═══ assemble + emit ════════════════════════════════════════════════════════
const failed = gates.filter(g => !g.ok);
const report = {
  generatedAt: new Date().toISOString(),
  harness: 'planset-evidence-ep (electrical/procurement closeout rendered-truth, 20 permanent gates)',
  mode: MODE,
  htmlPath: path.relative(repoRoot, htmlPath).replace(/\\/g, '/'),
  snapshotId: meta.snapshotId, digest: meta.digest,
  project: 'BRAIDON M PILLA — Solar TEST',
  sheetCount: pages.length, sheetIds, manifestIds,
  topology: el.topology, supplySide: isSupplySide, hasEmtRaceway,
  physicalRaceways: rws.map(r => ({ id: r.physicalRacewayId, type: r.racewayType, size: r.selectedRacewaySize, ccc: r.currentCarryingCount, cnt: r.conductorCount, nec: r.necArticle })),
  listedCableAssembly: asm ? { sku: asm.sku, manufacturer: asm.manufacturer, dropCount: asm.dropCount, connectorSpacingFt: asm.connectorSpacingFt } : null,
  qcableReconcile: { dropSum, procSum, recompute: g7_recompute, moduleInstances, branchModuleSum },
  activeBlockers: registryCodes, blockingCount,
  evidenceEqualsRendered: { reconciled: reconcile, mismatches },
  gates,
  summary: { total: gates.length, passed: gates.length - failed.length, failed: failed.map(g => `gate ${g.gate}: ${g.id}`), allPass: failed.length === 0 },
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`[ep-evidence:${MODE}] ${outPath} — snapshot ${meta.snapshotId} (${pages.length} sheets, manifest ${manifestIds.length})`);
for (const g of gates) console.log(`[ep-evidence:${MODE}] ${g.ok ? 'PASS' : 'FAIL'} gate ${String(g.gate).padStart(2)} ${g.id} — ${g.detail}`);
console.log(`[ep-evidence:${MODE}] ${report.summary.passed}/${report.summary.total} gates pass`);
if (failed.length) { console.log(`[ep-evidence:${MODE}] BLOCKING FAILURES: ${report.summary.failed.join(' | ')}`); process.exit(2); }
process.exit(0);
