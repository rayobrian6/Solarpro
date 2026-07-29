// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-ep — ELECTRICAL / PROCUREMENT CLOSEOUT rendered-truth harness.
//
//   Usage: node scripts/planset-evidence-ep.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = original (frozen fixture) | live (current DB design)
//
// The EP successor to planset-evidence-co.mjs. It regenerates NOTHING: it reads
// the REAL rendered permit package HTML + its PermitDesignSnapshot and runs the
// 21 PERMANENT EP GATES from docs/ELECTRICAL-PROCUREMENT-CLOSEOUT-DIRECTIVE.md
// (+ gate 22: the BAR WS-E electrical-authority harness, CHAINED in both modes)
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

// ═══ GATE 1 — the canonical sectioned schedule renders (no merged branch row).
// Post-AAC E-1 repair: the schedule renders ONCE on PV-4B.1 (E-1 is the
// dedicated SLD sheet again) — same canonical objects, same gate. ═════════════
const g1_header = html.includes('PHYSICAL CONDUCTOR / RACEWAY SCHEDULE — CANONICAL SECTION OBJECTS');
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
// post-AAC: the schedule no longer follows the diagram on E-1 — slice to the
// end of the SLD svg itself.
const e1SvgStart = noB64.indexOf('SINGLE-LINE ELECTRICAL DIAGRAM');
const e1SvgEnd = e1SvgStart >= 0 ? noB64.indexOf('</svg>', e1SvgStart) + 6 : -1;
const e1Svg = (e1SvgStart >= 0 && e1SvgEnd > e1SvgStart) ? noB64.slice(e1SvgStart, e1SvgEnd) : '';
const g2_svgToken = hrCcc != null && e1Svg.includes(`${hrCcc}#10 THWN-2`);
// The original defect was the shared HOME-RUN bundle printing #12 instead of N#10.
// BAR §5 legitimately introduced a `1×#12 GRN EGC` label (the BRANCH EGC gauge, which
// really is #12 at 20 A and differs from the #10 feeder EGC), so this check is scoped
// to the CCC-bundle form it was written for instead of banning the token package-wide.
const g2_svgNo12 = e1Svg.length > 0 && !/\d+#12\s*THWN-2/.test(e1Svg);
// every raceway's CCC = conductorCount − 1 (single shared EGC excluded)
const g2_invEach = rws.every(r => r.currentCarryingCount != null && r.conductorCount != null
  && r.currentCarryingCount === r.conductorCount - 1);
gate(2, 'e1-conductor-count-equals-raceway-inventory',
  g2_cccMath && g2_svgToken && g2_svgNo12 && g2_invEach,
  `hrCcc=${hrCcc} =2×branches(${branches.length})=${g2_cccMath} svg'${hrCcc}#10'=${g2_svgToken} svgNo#12=${g2_svgNo12} ccc==cnt-1(all)=${g2_invEach}`, null);

// ═══ GATE 3 — no E-1 section prints PASS while length/fill/tap is pending. ════
const e1SchedStart = html.indexOf('PHYSICAL CONDUCTOR / RACEWAY SCHEDULE — CANONICAL SECTION OBJECTS');
const e1Sched = e1SchedStart >= 0 ? html.slice(e1SchedStart, e1SchedStart + 4000) : '';
// BAR §4 added the itemized AmpacityAdjustmentResult to each section, and that object
// carries its OWN verdict ("req 20.00A cont · PASS") — a specific ampacity calculation
// that genuinely passes and that BAR gates 4/5 REQUIRE to be shown. This gate is about
// the SECTION verdict (no section may claim PASS while its length / fill / tap authority
// is pending), so the ampacity chain's own verdict is excluded before the scan.
const e1SchedNoAmpacity = e1Sched.replace(/req\s*[\d.]+A\s*cont\s*·\s*(PASS|FAIL|PENDING)/g, 'req … cont · <ampacity>');
const g3_noPass = e1Sched.length > 0 && !/\bPASS\b/.test(e1SchedNoAmpacity);
const g3_pendingShown = /PENDING|REVIEW/.test(e1Sched);
gate(3, 'e1-no-pass-with-pending', g3_noPass && g3_pendingShown,
  `e1SchedFound=${e1Sched.length > 0} noSectionPASS=${g3_noPass} pendingShown=${g3_pendingShown} `
  + `sectionPassCount=${(e1SchedNoAmpacity.match(/\bPASS\b/g) || []).length} `
  + `ampacityVerdicts=${(e1Sched.match(/cont\s*·\s*(PASS|FAIL|PENDING)/g) || []).length}`, null);

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
// AAC-5 RE-VOCABULARY: the WS-8 structural separation deleted the `_capGated`
// echo, so FASTENER-ASSEMBLY-UNVERIFIED no longer fires on an assembly whose
// mount base is fully verified and whose OPEN question is the rail-capacity
// DOCUMENT. The rendered "PENDING VERIFIED FASTENER ASSEMBLY" line is still
// correct there (the projection is capacity-gated), but the requirement that
// governs it now lives in the capacity vocabulary. The gate's intent — nothing
// renders as pending without a REGISTERED requirement behind it — is unchanged;
// it now accepts EITHER owner and names which one it found. Registry silence in
// both vocabularies remains a failure.
const fastenerVisible = html.includes('PENDING VERIFIED FASTENER ASSEMBLY');
const FASTENER_GOVERNING_CODES = [
  'FASTENER-ASSEMBLY-UNVERIFIED',
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
  'RACKING-CAPACITY-APPLICABILITY-GAP',
  'ATTACHMENT-CAPACITY-SOURCE-MISSING',
];
const fastenerGoverning = FASTENER_GOVERNING_CODES.filter(c => registryCodes.includes(c));
gate(13, 'visible-pending-authority-in-registry',
  !fastenerVisible || fastenerGoverning.length > 0,
  `fastenerPendingVisible=${fastenerVisible} governingRequirementsInRegistry=${fastenerGoverning.join(',') || 'none'}`, null);

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
// UPDATED by the PPC pass (2026-07-26), §6 / PPC gate 9. The premise above — that
// the load-side-only clause is PRESENT and merely marked N/A — was itself the
// weaker outcome. `fieldLabels.ts` had a sanitizer BYPASS: when the topology filter
// stripped the only NEC clause it fell back to `codeRefs[0]` UNFILTERED, printing
// `705.12(D)(2)(3)(b)` on a supply-side design. With that bypass fixed the clause is
// not cited at all (the label row itself survives, honestly N/A, citing 705.10). So
// the gate now accepts EITHER: the clause is ABSENT (strongest — nothing load-side-
// only is cited), or it is present and marked N/A. It still FAILS if the clause is
// present as a requirement.
const backfedClauseCited = /705\.12\(D\)\(2\)\(3\)\(b\)/i.test(html);
const backfedRowNa = /Backfed Breaker\s*N\/A/i.test(strip(html))
  || (backfedApplic != null && /N\/A/i.test(backfedApplic));
const g16_backfedNa = !isSupplySide
  || (!backfedClauseCited && backfedRowNa)
  || (backfedApplic != null && /N\/A/i.test(backfedApplic));
gate(16, 'no-load-side-only-labels-on-supply-side',
  g16_backfedNa,
  `supplySide=${isSupplySide} loadSideOnlyClauseCited=${backfedClauseCited} `
  + `backfedRowMarkedNA=${backfedRowNa} backfedBreakerApplicability=${backfedApplic}`, null);

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
// §Q — Q-Cable procurement sufficiency reconciles into report-equals-rendered:
// the deficit + blocker state must be present on the rendered surfaces exactly as
// the snapshot carries them.
const _ps = el.procurementSufficiency || null;
const _qcableBlocker = registryCodes.includes('QCABLE-PROCUREMENT-INSUFFICIENT');
rcheck('qcableProcurementInsufficient', _ps ? !!_ps.insufficient : false,
  _ps ? (!!_ps.insufficient === _qcableBlocker) : !_qcableBlocker, { rs1BlockerPresent: _qcableBlocker });
rcheck('qcableDeficitFt', _ps ? _ps.deficitFt : 0,
  !_ps || !_ps.insufficient || new RegExp(`${_ps.deficitFt}\\s*ft`).test(html));
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

// ═══ GATE 21 — Q-Cable procurement sufficiency: fail-closed deficit blocker. ══
// The §Q gate. In BOTH modes the sufficiency object must be present and CONSISTENT
// with the registry (insufficient ⇔ QCABLE-PROCUREMENT-INSUFFICIENT blocker), and
// when short the deficit + NON-ORDERABLE + PROCUREMENT INSUFFICIENCY must render on
// PV-4B/SCHED/RS-1.
//
// AAC-4 (WS-5) SUPERSEDES THE OLD MODE EXPECTATION. This gate used to hardcode
// "the frozen fixture is SUFFICIENT, the live design is SHORT". That encoded the
// answer of the AGGREGATE-only sufficiency check. The WS-5 topology engine
// evaluates PER BRANCH, and the frozen fixture is the textbook case the campaign
// was built to catch: 152 ft ordered vs 140.5 ft designed is sufficient IN
// AGGREGATE while branch B2 (58.3 ft designed vs 49 ft procured) is 9.3 ft short.
// Asserting the old expectation would demand the engine go back to hiding a real
// per-branch deficit. The mode expectation is therefore replaced by the ENGINE'S
// OWN verdict plus the two things that make it non-vacuous: the per-branch basis
// must be populated, and an insufficiency must NAME the branches it comes from.
const g21_present = !!_ps && _ps.present === true;
const g21_perBranchPopulated = g21_present && Array.isArray(_ps.perBranch) && _ps.perBranch.length > 0
  && _ps.perBranch.every(b => b.branchId && b.designedInstalledLengthFt != null && b.procurementLengthFt != null);
// an insufficiency must be attributable: which branch(es), and a threshold that
// is not merely the aggregate sum restated.
const g21_deficitAttributed = !g21_present || !_ps.insufficient
  || (Array.isArray(_ps.affectedBranchIds) && _ps.affectedBranchIds.length > 0
      && _ps.affectedBranchIds.every(id => _ps.perBranch.some(b => b.branchId === id)));
const g21_consistent = g21_present && (!!_ps.insufficient === _qcableBlocker);
const g21_renderedWhenShort = !g21_present || !_ps.insufficient
  || (new RegExp(`${_ps.deficitFt}\\s*ft`).test(html)
      && /NON-ORDERABLE/i.test(html) && /PROCUREMENT INSUFFICIENC/i.test(html)
      && /QCABLE-PROCUREMENT-INSUFFICIENT/.test(html));
const g21_allowanceHonest = !g21_present
  || (_ps.requiredServiceLoopAllowanceFt === 0 && _ps.allowanceProvenance === 'no-allowance-authority-recorded');
gate(21, 'qcable-procurement-sufficiency',
  g21_present && g21_consistent && g21_renderedWhenShort && g21_allowanceHonest
  && g21_perBranchPopulated && g21_deficitAttributed,
  `mode=${MODE} present=${g21_present} insufficient=${_ps ? _ps.insufficient : null} blocker=${_qcableBlocker} `
  + `designed=${_ps ? _ps.totalDesignedInstalledFt : null} proc=${_ps ? _ps.procurementLengthFt : null} `
  + `deficit=${_ps ? _ps.deficitFt : null} branches=${_ps && _ps.perBranch ? _ps.perBranch.length : 0} `
  + `affected=${_ps && _ps.affectedBranchIds ? (_ps.affectedBranchIds.join(',') || 'none') : 'none'} `
  + `consistent=${g21_consistent} renderedWhenShort=${g21_renderedWhenShort} `
  + `allowanceHonest=${g21_allowanceHonest} perBranchPopulated=${g21_perBranchPopulated} `
  + `deficitAttributed=${g21_deficitAttributed}`,
  _ps ? {
    insufficient: _ps.insufficient, deficitFt: _ps.deficitFt, verificationStatus: _ps.verificationStatus,
    perBranch: _ps.perBranch, affectedBranchIds: _ps.affectedBranchIds,
  } : null);

// ═══ GATE 22 — BAR WS-E electrical gates, CHAINED (fail-closed). ══════════════
// docs/BLOCKER-AUTHORITY-RECONCILIATION-DIRECTIVE.md §4/§5/§7/§8 (permanent gates
// 4, 5, 6, 7, 9, 10, 11) run in the SAME invocation flow as the EP closeout, in
// BOTH modes, against the SAME html + snapshot. The chained harness owns those
// gates (one implementation, no re-derivation here); a non-zero exit fails EP.
const _wseOut = outPath.replace(/(\.json)?$/, '') + '.bar-wse.json';
const _wse = spawnSync(process.execPath,
  [path.resolve(repoRoot, 'scripts/planset-evidence-bar-wse.mjs'), htmlPath, snapPath, _wseOut],
  { encoding: 'utf8' });
const _wseLine = (((_wse.stdout || '').match(/\[bar-wse\][^\n]*/g) || []).pop() || '').trim()
  || (_wse.stderr || '').trim().slice(0, 200);
let _wseReport = null;
try { _wseReport = JSON.parse(fs.readFileSync(_wseOut, 'utf8')); } catch { _wseReport = null; }
gate(22, 'bar-wse-electrical-authority-chained', _wse.status === 0,
  `bar-wse exit=${_wse.status} · ${_wseLine || 'no output'}`,
  _wseReport ? {
    out: path.relative(repoRoot, _wseOut).replace(/\\/g, '/'),
    gatesRun: _wseReport.gatesRun, gatesFailed: _wseReport.gatesFailed,
    failures: (_wseReport.results || []).filter(r => !r.pass).map(r => `gate ${r.gate}: ${r.name}`),
  } : null);
if (_wse.status !== 0) {
  for (const line of String(_wse.stdout || '').split('\n').filter(l => /FAIL/.test(l))) console.log(`[ep-evidence:${MODE}] chained ${line.trim()}`);
}

// ═══ assemble + emit ════════════════════════════════════════════════════════
const failed = gates.filter(g => !g.ok);
const report = {
  generatedAt: new Date().toISOString(),
  harness: 'planset-evidence-ep (electrical/procurement closeout rendered-truth, 21 permanent gates + chained BAR WS-E)',
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
