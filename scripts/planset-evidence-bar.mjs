// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-bar — BLOCKER & AUTHORITY RECONCILIATION rendered-truth
// harness. THE 14 PERMANENT GATES of
// docs/BLOCKER-AUTHORITY-RECONCILIATION-DIRECTIVE.md ("Permanent gates").
//
//   Usage: node scripts/planset-evidence-bar.mjs <planset.html> <snapshot.json> [out.json]
//   EVIDENCE_MODE = original (frozen fixture) | live (current DB design)
//
// It regenerates NOTHING and re-derives NOTHING: it reads the REAL rendered
// package + its PermitDesignSnapshot and compares each RENDERED claim to the
// CANONICAL object that produced it. Re-derivation is the drift class this
// campaign kills.
//
// Gate ownership:
//   1,2,3,8  — implemented here (governance / environmental / compliance / fasteners)
//   4,5,6,7,9,10,11 — CHAINED to scripts/planset-evidence-bar-wse.mjs (electrical)
//   12,13,14 — implemented here (report==rendered, page-fit, snapshot identity);
//              gate 13 invokes the TRUE geometry validator scripts/planset-pagefit.mjs
//
// FAILS CLOSED: exit 2 on any violation.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [htmlPath, snapPath, outPath = 'braidon-bar.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) {
  console.error('usage: planset-evidence-bar.mjs <html> <snapshot.json> [out]');
  process.exit(1);
}
const MODE = process.env.EVIDENCE_MODE === 'live' ? 'live' : (process.env.EVIDENCE_MODE || 'original');
const repoRoot = process.cwd();

const rawHtml = fs.readFileSync(htmlPath, 'utf8');
// Value scans run on a COMMENT-STRIPPED, base64-stripped copy: a comment that
// DOCUMENTS a retired claim, or a byte inside a datasheet image blob, must never
// be read as a live rendered claim.
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const noB64 = html.replace(/data:image[^"')]+/g, '');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

const meta = snap.meta || {};
const pr = snap.permitReadiness || {};
const pa = snap.projectAuthority || null;
const env = snap.structural?.env || {};
const ela = env.environmentalLoadAuthority || null;

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, '—');

// ── sheet split (the SHEET wrapper only — `page-content` must not split a sheet) ─
const pages = rawHtml.split(/<div class="page(?=[ "])/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);
const stripComments = (p) => p.replace(/<!--[\s\S]*?-->/g, '');
const pageWhere = (pred) => pages.map(stripComments).filter(pred);
const rs1 = pageWhere(p => p.includes('permitReadiness.registry') && p.includes('OPEN RELEASE BLOCKER')).pop() ?? '';
// PV-0's release surface is the struct-review-banner: it lists the active
// blockers verbatim (capped) plus an explicit "+N more" remainder, so the cover's
// TOTAL is exact without a second count to drift from.
const cover = pageWhere(p => p.includes('struct-review-banner')).shift() ?? '';
// PV-4C is split across the calc sheet + PV-4C.1 conclusion — take the union.
const pv4c = pageWhere(p => p.includes('data-env-source="pv-4c')).join('\n');
const pe1 = pageWhere(p => p.includes('data-env-source="pe-1"')).pop() ?? '';
const sched = pageWhere(p => p.includes('PAGE CONCLUSION — EQUIPMENT SCHEDULE')
  || p.includes('PAGE CONCLUSION &mdash; EQUIPMENT SCHEDULE')).pop() ?? '';

// ═══════════════════════════════════════════════════════════════════════════
// PPC §1 — THE INSTALLED-OPEN-AIR-EGC ASSERTION-CLASS SCANNER (gate 1).
//
// Written against the CLASS of statement, never an enumerated phrase list. The
// retired gate tested three "separate EGC" wordings, so the E-1 schedule's own
// bonding cell (`#12 AWG Cu EGC (NEC 250.122 @ 20A) — with circuit conductors`)
// sailed through every campaign. Cross-checked by the same predicate in
// tests/planset/ppc-ws1-projection-procurement.test.ts.
//
// A violation is any rendered statement that, inside a BLOCK about the open-air /
// listed-cable-assembly section (block scope matters: in a schedule the section
// label and its bonding cell are two <td>s of the same <tr>), names an equipment
// grounding conductor AND presents it as installed — by stating a conductor size
// or by using an installation predicate — without an explicit pending / candidate
// / negating qualifier.
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
  const strip = (h) => h
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/data:image[^"')]+/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|span|strong|em|text|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&rsquo;/g, "'");
  const out = [];
  // SVG has no rows: each <text>/<g> label is its own block, otherwise every
  // legitimate IN-RACEWAY EGC label in the single-line diagram would inherit the
  // diagram's open-air context.
  for (const block of sourceHtml.split(/<\/tr>|<\/div>|<\/li>|<\/p>|<\/table>|<\/text>|<\/g>|<\/svg>/i)) {
    const text = strip(block);
    if (!_CTX_OPEN_AIR.test(text)) continue;
    for (const seg of text.split(/\n+|(?<=[.;])\s+|\s·\s/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      if (!_TOK_EGC.test(seg)) continue;
      if (!(_TOK_SIZE.test(seg) || _PRED_INSTALLED.test(seg))) continue;
      if (_QUAL_PENDING.test(seg) || _QUAL_NEGATED.test(seg)) continue;
      out.push(seg);
    }
  }
  return out;
}

const gates = [];
const gate = (num, id, ok, detail, evidence) => {
  gates.push({ gate: num, id, ok: !!ok, detail: detail ?? null, evidence: evidence ?? null });
  return !!ok;
};

// ═══ GATE 1 — blocker multisets match across every surface ═══════════════════
// registry (canonical) == back-compat blockers list (the issue-state gate input)
// == RS-1 rendered codes+severities == RS-1 header counts == cover banner count.
const registry = (pr.registry ?? []).filter(r => !r.resolved);
const key = (r) => `${r.code}:${r.severity}`;
const registryMultiset = registry.map(key).sort();
const blockingCodes = registry.filter(r => r.severity === 'blocking').map(r => r.code).sort();
const advisoryCodes = registry.filter(r => r.severity !== 'blocking').map(r => r.code).sort();
const listCodes = (pr.blockers ?? []).map(b => b.code).sort();

// RS-1 renders one <tr> per registry item: severity badge, then the mono code cell.
const rs1Rows = [...rs1.matchAll(/>(BLOCKING|ADVISORY)<\/span>\s*<\/td>\s*<td class="mono"[^>]*>([A-Z0-9-]+)</g)]
  .map(m => ({ severity: m[1] === 'BLOCKING' ? 'blocking' : 'warning', code: m[2] }));
const rs1Multiset = rs1Rows.map(key).sort();
const rs1HeaderBlocking = Number((rs1.match(/(\d+)\s+OPEN RELEASE BLOCKER/) ?? [])[1] ?? NaN);
const rs1SummaryBlocking = Number((rs1.match(/BLOCKING<\/span>\s*<span[^>]*>(\d+)</) ?? [])[1] ?? NaN);
const rs1SummaryAdvisory = Number((rs1.match(/ADVISORY<\/span>\s*<span[^>]*>(\d+)</) ?? [])[1] ?? NaN);
// The COVER banner's blocker multiset = the <li> items it prints verbatim, plus
// the explicit "+N more active release blocker(s)" remainder it points at RS-1 for.
const coverBanner = cover.slice(cover.indexOf('struct-review-banner'));
const coverBannerBlock = coverBanner.slice(0, coverBanner.indexOf('</ul>') + 5 || undefined);
const coverListed = (coverBannerBlock.match(/<li[^>]*>/g) ?? []).length;
const coverMore = Number((coverBannerBlock.match(/\+\s*(\d+)\s+more active release blocker/) ?? [])[1] ?? 0);
// the "+N more" <li> is itself one of the listed items — do not double-count it.
const coverTotal = cover ? (coverMore > 0 ? coverListed - 1 + coverMore : coverListed) : NaN;

const g1_registryEqList = JSON.stringify(listCodes) === JSON.stringify(blockingCodes);
const g1_renderedEqRegistry = JSON.stringify(rs1Multiset) === JSON.stringify(registryMultiset);
const g1_headerEq = rs1HeaderBlocking === blockingCodes.length;
const g1_summaryEq = rs1SummaryBlocking === blockingCodes.length && rs1SummaryAdvisory === advisoryCodes.length;
const g1_coverEq = registry.length === 0 ? true : coverTotal === registry.length;
// the derived ISSUE-STATE gate must agree that blockers exist
const g1_issueGate = blockingCodes.length === 0
  ? pr.ready === true
  : (pr.ready === false && !/CLEARED FOR ISSUE/.test(rs1) && !/ISSUED FOR PERMIT/.test(String(pa?.issueState ?? '')));
gate(1, 'blocker-multiset-equality-across-surfaces',
  g1_registryEqList && g1_renderedEqRegistry && g1_headerEq && g1_summaryEq && g1_coverEq && g1_issueGate,
  `registry=${registry.length} (blocking ${blockingCodes.length} / advisory ${advisoryCodes.length}) `
  + `rs1Rows=${rs1Rows.length} rs1Header=${rs1HeaderBlocking} rs1Summary=${rs1SummaryBlocking}/${rs1SummaryAdvisory} `
  + `coverBanner=${Number.isNaN(coverTotal) ? 'MISSING' : coverTotal} (listed ${coverListed} +${coverMore} more) listEq=${g1_registryEqList} `
  + `renderedEq=${g1_renderedEqRegistry} issueGate=${g1_issueGate} issueState=${pa?.issueState ?? '—'}`,
  {
    blockingCodes, advisoryCodes,
    missingFromRs1: registryMultiset.filter(k => !rs1Multiset.includes(k)),
    extraOnRs1: rs1Multiset.filter(k => !registryMultiset.includes(k)),
  });

// ═══ GATE 2 — wind/snow always carry provenance + verification state ═════════
const g2_recordPresent = !!ela && typeof ela.verificationStatus === 'string'
  && 'windSpeedBasis' in ela && 'snowLoadBasis' in ela && !!ela.provenance;
const unverified = !!ela && ela.verificationStatus !== 'verified';
// every rendered wind/snow surface carries its state tag / source line
const envTagRe = /data-env-source="([^"]+)"[^>]*>\s*(?:\[)?([^<\]]+)/g;
const envTags = [...noB64.matchAll(envTagRe)].map(m => ({ id: m[1], text: decode(m[2]).trim() }));
const need = ['pv-4c-wind', 'pv-4c-snow', 'pv-4c-conclusion', 'pe-1'];
const missingTags = need.filter(id => !envTags.some(t => t.id === id));
// every tag must NAME a basis/verification state — never a bare number
const STATE_RE = /(VERIFIED SOURCE|OPERATOR-ENTERED|CODE(-MINIMUM)? DEFAULT|NOT VERIFIED|NOT PROVIDED)/i;
const tagsWithoutState = envTags.filter(t => !STATE_RE.test(t.text)).map(t => `${t.id}='${t.text}'`);
// the state the sheets print must EQUAL the record's state
const claimsVerified = envTags.some(t => /VERIFIED SOURCE/i.test(t.text) || /—\s*VERIFIED/.test(t.text));
const g2_stateAgrees = unverified ? !claimsVerified : claimsVerified;
// an unverified authority must be visible on RS-1 as a blocker, and no sheet may
// call the values "canonical … authority" without a source document.
const g2_blockerWhenUnverified = !unverified || rs1.includes('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED');
const g2_noFalseAuthorityLabel = !unverified
  || (!/canonical project\/AHJ wind authority/i.test(noB64)
      && !String(env.windSpeedSource ?? '').includes('canonical project/AHJ wind authority'));
const g2_retiredCodeGone = !noB64.includes('WIND-SNOW-AUTHORITY-UNRESOLVED');
const g2_overridesRecorded = !unverified
  || (ela.sourceDocumentId == null && ela.evidenceRef == null);
gate(2, 'wind-snow-provenance-and-verification-state',
  g2_recordPresent && missingTags.length === 0 && tagsWithoutState.length === 0 && g2_stateAgrees
  && g2_blockerWhenUnverified && g2_noFalseAuthorityLabel && g2_retiredCodeGone && g2_overridesRecorded,
  `record=${g2_recordPresent} status=${ela?.verificationStatus ?? '—'} windBasis=${ela?.windSpeedBasis ?? '—'} `
  + `snowBasis=${ela?.snowLoadBasis ?? '—'} taggedSurfaces=${envTags.length} missing=${missingTags.join(',') || 'none'} `
  + `tagsWithoutState=${tagsWithoutState.join(' | ') || 'none'} stateAgrees=${g2_stateAgrees} `
  + `blockerWhenUnverified=${g2_blockerWhenUnverified} noFalseLabel=${g2_noFalseAuthorityLabel} retiredCodeGone=${g2_retiredCodeGone}`,
  { environmentalLoadAuthority: ela, windSpeedSource: env.windSpeedSource ?? null, envTags });

// ═══ GATE 3 — no global compliance / PASS statement while blockers exist ═════
const hasBlocking = blockingCodes.length > 0;
const FALSE_COMPLIANCE = [
  /All equipment is UL-listed/i,
  /equipment complies with NEC\s*\d{4}\s*and UL 1741/i,
  /wire sizing verified per NEC 690\.8/i,
  />VERIFIED<\/span>/,
  /FULLY COMPLIANT/i,
  /CLEARED FOR ISSUE/i,
];
const falseHits = hasBlocking ? FALSE_COMPLIANCE.filter(re => re.test(noB64)).map(re => String(re)) : [];
const g3_schedHonest = !hasBlocking
  || (sched.includes('COMPLIANCE NOT YET ESTABLISHED')
      && (sched.includes('SEE RS-1 FOR ACTIVE RELEASE BLOCKERS') || sched.includes('SEE RS-1')));
const g3_bannerHonest = !hasBlocking || /NOT FOR PERMIT SUBMISSION/.test(noB64);
gate(3, 'no-global-compliance-claim-with-blockers',
  falseHits.length === 0 && g3_schedHonest && g3_bannerHonest,
  `blocking=${blockingCodes.length} schedFound=${sched.length > 0} schedHonest=${g3_schedHonest} `
  + `bannerHonest=${g3_bannerHonest} falseClaims=${falseHits.join(' | ') || 'none'}`,
  { falseHits });

// ═══ GATES 4,5,6,7,9,10,11 — CHAINED to the WS-E electrical harness ══════════
const wseOut = outPath.replace(/(\.json)?$/, '') + '.wse.json';
const wse = spawnSync(process.execPath,
  [path.resolve(repoRoot, 'scripts/planset-evidence-bar-wse.mjs'), htmlPath, snapPath, wseOut],
  { encoding: 'utf8' });
let wseReport = null;
try { wseReport = JSON.parse(fs.readFileSync(wseOut, 'utf8')); } catch { wseReport = null; }
const wseByGate = (n) => (wseReport?.results ?? []).filter(r => r.gate === n);
for (const n of [4, 5, 6, 7, 9, 10, 11]) {
  const rs = wseByGate(n);
  const fails = rs.filter(r => !r.pass);
  const NAMES = {
    4: 'six-ccc-ampacity-full-chain', 5: 'missing-ampacity-input-is-pending',
    6: 'grounding-outcome-document-backed', 7: 'grounding-outcome-consistent-across-surfaces',
    9: 'caps-equal-unused-connector-objects', 10: 'terminators-equal-cable-end-objects',
    11: 'legend-equals-segment-wiring-methods',
  };
  gate(n, NAMES[n], wse.status !== null && rs.length > 0 && fails.length === 0,
    `chained bar-wse: ${rs.length - fails.length}/${rs.length} checks pass`
    + (fails.length ? ` — FAILED: ${fails.map(f => f.name).join(' | ')}` : ''),
    { checks: rs });
}
// the chain itself must have RUN (a crashed chain is a violation, not a pass)
if (wse.status === null || wseReport == null) {
  gate(0, 'bar-wse-chain-executed', false,
    `bar-wse exit=${wse.status} stderr=${String(wse.stderr || '').slice(0, 200)}`, null);
}

// ═══ GATE 8 — unverified fasteners are NON-ORDERABLE ════════════════════════
// The rendered-truth source of the fastener verification state: the CANONICAL
// registry blocker + the racking assembly's own verification record. (The
// FastenerAssembly projection is derived at render time, so the harness reads the
// snapshot facts it derives from — never a second derivation of its own.)
const ra = snap.structural?.rackingAssembly ?? null;
const faBlockerActive = registry.some(r => r.code === 'FASTENER-ASSEMBLY-UNVERIFIED');
const fa = ra ? {
  fastenerVerification: ra.assemblyVerification?.fastener ?? null,
  overall: ra.assemblyVerification?.overall ?? null,
  screwLagModel: ra.screwLagModel ?? null,
  datasheetSource: ra.datasheetSource ?? ra.capacitySource ?? null,
  verification: faBlockerActive ? 'unverified' : (ra.assemblyVerification?.fastener ?? null),
} : null;
const faUnverified = faBlockerActive || !ra || ra.assemblyVerification?.overall !== 'verified';
const NON_ORDERABLE = 'DESIGN QUANTITY — NON-ORDERABLE / PENDING VERIFIED FASTENER ASSEMBLY';
const faFlagged = noB64.includes('data-fastener-orderable="false"');
const faLabel = noB64.includes(NON_ORDERABLE) || noB64.includes(NON_ORDERABLE.replace('—', '&mdash;'));
// while unverified, NO manufacturer / SKU / diameter / length / coating / capacity
const SPEC_LEAKS = [
  /5\/16"\s*\(8mm\/M8\)/i, /min(imum)?\.?\s*2\.5"\s*(thread\s*)?embedment/i,
  /structural wood screw,\s*~?3\.5"/i,
];
const specLeaks = faUnverified ? SPEC_LEAKS.filter(re => re.test(noB64)).map(String) : [];
// the calculated quantity is RETAINED (design quantity), just not orderable
const faBlockerShown = !faUnverified || rs1.includes('FASTENER-ASSEMBLY-UNVERIFIED');
gate(8, 'unverified-fasteners-non-orderable',
  !faUnverified
    ? (!faFlagged || faLabel)
    : (faFlagged && faLabel && specLeaks.length === 0 && faBlockerShown
       && !noB64.includes('data-fastener-orderable="true"')),
  `verification=${fa?.verification ?? 'absent'} flagged=${faFlagged} label=${faLabel} `
  + `specLeaks=${specLeaks.join(' | ') || 'none'} blockerOnRs1=${faBlockerShown}`,
  { fastenerAssembly: fa, specLeaks });

// ═══ GATE 12 — report == rendered (zero mismatches) ═════════════════════════
const mismatches = [];
const rcheck = (name, canonical, matched, extra) => {
  if (!matched) mismatches.push({ name, canonical: `${canonical}`, ...(extra ?? {}) });
};
const projField = (field) => [...new Set(
  [...rawHtml.matchAll(new RegExp(`data-project-field="${field}">([^<]*)<`, 'g'))].map(m => decode(m[1]).trim()))];
const idFields = projField('snapshot-id');
rcheck('snapshotId', meta.snapshotId, idFields.length > 0 && idFields.every(v => v === meta.snapshotId), { rendered: idFields });
const digFields = projField('digest');
rcheck('digestPrefix', (meta.digest || '').slice(0, 12),
  digFields.length > 0 && digFields.every(v => v && String(meta.digest || '').startsWith(v)), { rendered: digFields });
// §1 — the counts
rcheck('rs1BlockingCount', blockingCodes.length, rs1HeaderBlocking === blockingCodes.length, { rendered: rs1HeaderBlocking });
rcheck('coverBannerBlockerTotal', registry.length, registry.length === 0 || coverTotal === registry.length, { rendered: coverTotal });
// §2 — the environmental values + state
if (ela) {
  if (ela.ultimateWindSpeedMph != null) {
    rcheck('windSpeedMph', ela.ultimateWindSpeedMph, new RegExp(`${ela.ultimateWindSpeedMph}\\s*mph`).test(noB64));
  }
  if (ela.groundSnowLoadPsf != null) {
    rcheck('groundSnowPsf', ela.groundSnowLoadPsf, new RegExp(`${ela.groundSnowLoadPsf}\\s*psf`).test(noB64));
  }
  rcheck('environmentalVerificationStatus', ela.verificationStatus, unverified ? !claimsVerified : claimsVerified,
    { renderedTags: envTags.map(t => t.text) });
}
// §4/§5/§7/§8 — the chained electrical artifacts, compared to the RENDERED page
const wseArt = wseReport?.artifacts ?? null;
if (wseArt?.sharedRacewayAmpacity) {
  const a = wseArt.sharedRacewayAmpacity;
  rcheck('ampacityCountFactor', a.countAdjustmentFactor,
    noB64.includes(`×${Number(a.countAdjustmentFactor).toFixed(2)}`));
  rcheck('ampacityAmbientFactor', a.ambientCorrectionFactor,
    noB64.includes(`×${Number(a.ambientCorrectionFactor).toFixed(2)}`));
  rcheck('ampacityFinalAllowable', a.finalAllowableAmpacityA,
    new RegExp(`${Number(a.finalAllowableAmpacityA).toFixed(2).replace('.', '\\.')}|${Math.round(a.finalAllowableAmpacityA)}`).test(noB64));
}
// GROUNDING (corrected 2026-07-25) — report == rendered on the OUTCOME, not on a
// fixed "result B". A PENDING outcome must render its pending label + the blocker
// and must NOT render either grounding assertion; only outcome B pins a quantity.
if (wseArt?.openAirBranchGrounding?.outcome) {
  const gr = wseArt.openAirBranchGrounding;
  rcheck('groundingOutcome', gr.outcome,
    ['NO_SEPARATE_EGC_REQUIRED', 'SEPARATE_EGC_REQUIRED', 'PENDING_MANUFACTURER_AUTHORITY'].includes(gr.outcome));
  if (gr.outcome === 'PENDING_MANUFACTURER_AUTHORITY') {
    rcheck('groundingPendingRendered', 'GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY',
      noB64.includes('GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY')
      && noB64.includes('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED'));
    // PPC §1 / GATE 1 — the ASSERTION-CLASS scan. The retired check was a PHRASE
    // LIST (three regexes for "separate EGC" wordings), which is precisely why
    // `#12 AWG Cu EGC (NEC 250.122 @ 20A) — with circuit conductors` — an
    // INSTALLED-conductor assertion in the E-1 schedule's own bonding column —
    // passed cleanly through four consecutive authority campaigns. The gate now
    // asserts on the CLASS: zero rendered statements that name an EGC inside an
    // open-air/listed-cable-assembly context and present it as installed.
    const _assertions = installedOpenAirEgcAssertions(rawHtml);
    rcheck('groundingNoAssertionWhilePending', 'zero installed-open-air-EGC assertions',
      _assertions.length === 0, { assertions: _assertions.slice(0, 8) });
    rcheck('groundingCandidateNonOrderable', 'design-quantity-non-orderable',
      gr.bomRowState === 'design-quantity-non-orderable'
      // Ray's mandated candidate-EGC label (all three clauses, class not phrase)
      && /CANDIDATE DESIGN QUANTITY/i.test(noB64)
      && /NON-ORDERABLE/i.test(noB64)
      && /NOT PART OF THE APPROVED INSTALLATION/i.test(noB64));
    // PPC §7 / GATE 10 — no rendered grounding conductor row without a canonical
    // GroundingSegment id (the legacy PV-4B project-level EGC row had none).
    const _gsegTags = (noB64.match(/data-grounding-segment-id="([^"]*)"/g) ?? [])
      .map(t => (t.match(/="([^"]*)"/) ?? [])[1]);
    rcheck('groundingRowsCarrySegmentId', 'every grounding row has a groundingSegmentId',
      _gsegTags.length > 0 && _gsegTags.every(v => v && v.trim().length > 0),
      { renderedSegmentIds: _gsegTags });
    rcheck('legacyProjectLevelEgcRowDeleted', 'no Array→AC-Disconnect(ground bus) EGC row',
      !/AC Disconnect \(ground bus\)/i.test(noB64));
  } else if (gr.outcome === 'SEPARATE_EGC_REQUIRED' && gr.bomFootageFt != null) {
    rcheck('openAirEgcFootage', gr.bomFootageFt,
      (noB64.match(new RegExp(`${gr.bomFootageFt}\\s*ft`, 'g')) ?? []).length >= 2);
  } else if (gr.outcome === 'NO_SEPARATE_EGC_REQUIRED') {
    rcheck('groundingNoRow', 'no-row', gr.bomRowState === 'no-row');
  }
}
if (wseArt?.connectorTopology?.occupiedDrops != null) {
  rcheck('occupiedDrops', wseArt.connectorTopology.occupiedDrops,
    new RegExp(`\\b${wseArt.connectorTopology.occupiedDrops}\\b`).test(noB64));
}
// §6 — the fastener state
rcheck('fastenerNonOrderable', faUnverified ? 'non-orderable' : 'orderable',
  faUnverified ? (faFlagged && faLabel) : true);
gate(12, 'report-equals-rendered-zero-mismatches', mismatches.length === 0,
  `${mismatches.length} mismatch(es)${mismatches.length ? ': ' + mismatches.map(m => m.name).join(', ') : ''}`,
  { mismatches });

// ═══ GATE 13 — page-fit: zero meaningful clipping (true geometry validator) ══
const pf = spawnSync(process.execPath, [path.resolve(repoRoot, 'scripts/planset-pagefit.mjs'), htmlPath],
  { encoding: 'utf8' });
const pfLine = ((pf.stdout || '').match(/\[pagefit\][^\n]*/g) || []).pop()
  || (pf.stderr || '').trim().slice(0, 200);
gate(13, 'page-fit-zero-meaningful-clipping', pf.status === 0,
  `pagefit exit=${pf.status} · ${pfLine}`, null);

// ═══ GATE 14 — snapshot ID + digest match across ALL sheets ═════════════════
const perSheet = pages.map((p, i) => ({
  index: i, sheetId: sheetIds[i],
  ids: [...new Set([...p.matchAll(/data-project-field="snapshot-id">([^<]*)</g)].map(m => decode(m[1]).trim()))],
  digests: [...new Set([...p.matchAll(/data-project-field="digest">([^<]*)</g)].map(m => decode(m[1]).trim()))],
}));
const sheetsWithId = perSheet.filter(s => s.ids.length > 0);
const idMismatch = sheetsWithId.filter(s => s.ids.some(v => v !== meta.snapshotId));
const digestMismatch = perSheet.filter(s => s.digests.some(v => !String(meta.digest || '').startsWith(v)));
const manifestIds = (pa?.sheetIndex ?? []).map(s => s.id);
const g14_manifestEq = manifestIds.length === 0 || manifestIds.length === pages.length;
gate(14, 'snapshot-identity-consistent-across-sheets',
  sheetsWithId.length > 0 && idMismatch.length === 0 && digestMismatch.length === 0 && g14_manifestEq,
  `sheets=${pages.length} withStamp=${sheetsWithId.length} idMismatch=${idMismatch.length} `
  + `digestMismatch=${digestMismatch.length} manifest=${manifestIds.length} manifestEqPages=${g14_manifestEq} `
  + `snapshot=${meta.snapshotId}`,
  { idMismatch, digestMismatch, sheetIds });

// ═══ assemble + emit ═══════════════════════════════════════════════════════
gates.sort((a, b) => a.gate - b.gate);
const failed = gates.filter(g => !g.ok);
const report = {
  generatedAt: new Date().toISOString(),
  harness: 'planset-evidence-bar (blocker & authority reconciliation, 14 permanent gates; 4/5/6/7/9/10/11 chained to bar-wse)',
  mode: MODE,
  htmlPath: path.relative(repoRoot, htmlPath).replace(/\\/g, '/'),
  snapshotId: meta.snapshotId, digest: meta.digest,
  sheetCount: pages.length, sheetIds, manifestSheetIds: manifestIds,
  blockerRegistry: {
    blockingCount: blockingCodes.length, advisoryCount: advisoryCodes.length,
    blockingCodes, advisoryCodes,
    renderedRs1: rs1Rows, rs1HeaderBlocking, coverBannerTotal: coverTotal, coverListed, coverMore,
    issueState: pa?.issueState ?? null, ready: pr.ready ?? null,
  },
  environmentalLoadAuthority: ela,
  fastenerAssembly: fa,
  chainedWse: wseReport ? {
    out: path.relative(repoRoot, wseOut).replace(/\\/g, '/'),
    gatesRun: wseReport.gatesRun, gatesFailed: wseReport.gatesFailed,
    artifacts: wseReport.artifacts,
  } : null,
  reportEqualsRendered: { mismatches },
  gates,
  summary: {
    total: gates.length, passed: gates.length - failed.length,
    failed: failed.map(g => `gate ${g.gate}: ${g.id}`), allPass: failed.length === 0,
  },
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`[bar-evidence:${MODE}] ${outPath} — snapshot ${meta.snapshotId} (${pages.length} sheets)`);
for (const g of gates) {
  console.log(`[bar-evidence:${MODE}] ${g.ok ? 'PASS' : 'FAIL'} gate ${String(g.gate).padStart(2)} ${g.id} — ${g.detail}`);
}
console.log(`[bar-evidence:${MODE}] ${report.summary.passed}/${report.summary.total} gates pass`);
if (failed.length) {
  console.error(`[bar-evidence:${MODE}] BLOCKING FAILURES: ${report.summary.failed.join(' | ')}`);
  process.exit(2);
}
process.exit(0);
