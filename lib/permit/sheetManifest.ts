// ═══════════════════════════════════════════════════════════════════════════
// PERMIT SHEET MANIFEST — the SINGLE ordered source of truth for the planset.
// The page order, the cover SHEET INDEX, and the engineering-page sheet status
// all derive from this one list so they can never drift (the sheet count varies
// per project — datasheet pages grow the set, conditional sheets add/remove).
//
// Reading order (grouped by discipline — Ray 2026-07-20 "organize the entire
// planset for proper flow"; matches PE-stamped reference sets):
//   cover → site/array plans → STRUCTURAL (attachment · calcs)
//         → ELECTRICAL (single-line first, then NEC calcs · conductor schedule)
//         → labels/placards → schedules/specs/datasheets → certifications
//         → appendices
// The old order interleaved disciplines (electrical, then structural, then the
// electrical labels) — a reviewer bounced between trades mid-set. Structural
// now precedes electrical (how it's held up, then how it's wired), and E-1
// LEADS the electrical section as its key sheet with PV-4A/PV-4B supporting.
// ═══════════════════════════════════════════════════════════════════════════

import type { PlansetProfile } from './plansetProfile';
// TAC WS-16 — the sheet's printed identity is state-dependent (a compliance
// letter only under a digest-bound approval). ONE source, shared with the
// rendering pages.
import { peLetterManifestTitle } from './utils/peLetterIdentity';

/** AAC WS-10 — a sheet belongs either to the numbered DRAWING set or to the
 *  MANUFACTURER ATTACHMENT appendix that follows it. Absent ⇒ 'drawing' (every
 *  pre-WS-10 caller keeps its exact meaning). */
export type SheetSection = 'drawing' | 'appendix';

export interface SheetRef { id: string; title: string; section?: SheetSection; }

export type HybridManifestSub = 'roof' | 'ground' | 'fence';

export interface SheetManifestOptions {
  /** system-aware titles for the plan/attachment sheets */
  pv1Title: string;
  pv3Title: string;
  /** DS-n equipment datasheet pages already resolved (module/inverter/battery) */
  datasheets?: SheetRef[];
  includeSchedCont?: boolean;     // long BOM → SCHED-2 (legacy single-sheet flag)
  /** W9/§15 — number of SCHED continuation sheets (SCHED-2, SCHED-3, …) a long
   *  BOM paginates onto. Overrides includeSchedCont when > 0. */
  schedContCount?: number;
  /** RGM §5 — number of RS-1 continuation sheets (RS-1.1, RS-1.2, …) the
   *  gate-led review-status registry paginates onto. Derived from the SAME
   *  layout function the page assembly uses (reviewStatusContPageCount), so the
   *  printed sheet index can never disagree with the rendered page set. */
  reviewStatusContCount?: number;
  /** W9/§15 page-fit — roof structural calcs spill onto the formal continuation
   *  sheet PV-4C.1 (attachment detail + governing load combination + page
   *  conclusion). Roof, single-system only; the page assembly gates identically. */
  includePv4cCont?: boolean;
  includeValidation?: boolean;    // VAL-1 internal QA (off in AHJ deliverable)
  includeCadAppendix?: boolean;   // APP-CAD non-authoritative preview
  /** Wave 5B — hybrid (multi-sub-system) planset. Present sub keys in fixed
   *  roof > ground > fence order. The PRIMARY sub (first entry) keeps the
   *  legacy unsuffixed ids; additional subs add per-sub detail sheets with a
   *  single-letter suffix (G = ground, F = fence): PV-1G/PV-1F plan sheets,
   *  PV-1BG/PV-1BF circuit layouts, PV-3G/PV-3F structural details and
   *  PE-1G/PE-1F structural letters. Sheet count therefore grows with the
   *  sub-system count — never a single-type sheet claiming another sub's
   *  modules. */
  hybridSubs?: HybridManifestSub[];
  /** §4 (07-22) — microinverter systems have AC BRANCH CIRCUITS, not DC strings.
   *  PV-1B is titled "AC BRANCH CIRCUIT LAYOUT" for micro; string/optimizer keep
   *  the "ARRAY GEOMETRY — STRING LAYOUT" title. Undefined ⇒ string (unchanged). */
  isMicro?: boolean;
  /** AAC WS-10 — output profile. 'full' (default) is the internal package.
   *  'permit' is the AHJ submittal: the compact drawing set + the manufacturer
   *  attachment appendix, certification sheets only under a digest-bound
   *  approval. 'design-review' (post-AAC) is the compact set that ENDS on PE-1
   *  as the final engineer-review sheet in its current (possibly unsigned,
   *  pending) state. */
  profile?: PlansetProfile;
  /** Post-AAC E-1 repair — PV-4B.1 carries the canonical physical section
   *  schedule + full ampacity chain + open-air grounding note (micro
   *  topologies). Mirrors hasPhysicalSectionSchedule in the page assembly. */
  includePv4b1?: boolean;
  /** AAC WS-10 — a digest-bound engineering approval covering THIS snapshot
   *  exists, so the certification sheets carry a real signed release rather
   *  than a placeholder. Only then does the permit profile carry PE-1/CERT. */
  certificationCompleted?: boolean;
}

/** AAC WS-10 — the merged PV-5 + PV-6 labels/directory sheet title (ONE source;
 *  the sheet's own title block mirrors it). */
export const PERMIT_LABELS_SHEET_TITLE =
  'WARNING LABELS, PLACARDS & DISCONNECT DIRECTORY';

/** §4 — PV-1B title, topology-aware (the ONE source; sheet titleBlock mirrors). */
export function pv1bTitle(isMicro: boolean | undefined, suffix = ''): string {
  return isMicro
    ? `AC BRANCH CIRCUIT LAYOUT${suffix}`
    : `ARRAY GEOMETRY — STRING LAYOUT & CONFIGURATION${suffix}`;
}

const HYBRID_SUFFIX: Record<HybridManifestSub, string> = { roof: 'R', ground: 'G', fence: 'F' };
const HYBRID_LABEL: Record<HybridManifestSub, string> = { roof: 'ROOF', ground: 'GROUND', fence: 'FENCE' };
const HYBRID_PLAN_TITLE: Record<HybridManifestSub, string> = {
  roof: 'SITE & ROOF PLAN — MODULE LAYOUT & FIRE SETBACKS',
  ground: 'GROUND ARRAY PLAN — MODULE LAYOUT',
  fence: 'SOLAR FENCE ELEVATION & PLAN',
};
const HYBRID_STRUCT_TITLE: Record<HybridManifestSub, string> = {
  roof: 'ATTACHMENT DETAIL — MOUNTING & CROSS-SECTION',
  ground: 'GROUND MOUNT STRUCTURAL DETAILS',
  fence: 'FENCE STRUCTURAL DETAILS',
};

/** Non-primary hybrid subs (the ones that get suffixed detail sheets). */
function hybridExtras(o: SheetManifestOptions): HybridManifestSub[] {
  const subs = o.hybridSubs ?? [];
  return subs.length > 1 ? subs.slice(1) : [];
}

export function hybridSheetId(base: string, sub: HybridManifestSub): string {
  return `${base}${HYBRID_SUFFIX[sub]}`;
}

/** Ordered SCHED continuation sheet ids for the given options (SCHED-2,
 *  SCHED-3, …). schedContCount is authoritative; includeSchedCont ⇒ one sheet. */
function schedContIds(o: SheetManifestOptions): string[] {
  const n = o.schedContCount != null && o.schedContCount > 0
    ? o.schedContCount
    : (o.includeSchedCont ? 1 : 0);
  return Array.from({ length: n }, (_, i) => (i === 0 ? 'SCHED-2' : `SCHED-${i + 2}`));
}

/**
 * The canonical ordered list of sheets for a permit package. Deterministic and
 * pure — safe to call on both the server (generator, cover index) and the
 * client (engineering-page sheet status / count).
 */
export function buildSheetManifest(o: SheetManifestOptions): SheetRef[] {
  const ds = o.datasheets ?? [];
  const extras = hybridExtras(o);
  const isHybrid = extras.length > 0;
  const primaryLabel = isHybrid ? ` — ${HYBRID_LABEL[(o.hybridSubs ?? ['roof'])[0]]}` : '';

  // ── AAC WS-10 — the PERMIT profile (the AHJ submittal) ────────────────────
  // Removed from the core set: RS-1/.1/.2 (the review registry lives in the
  // application review record and the full profile), SCHED-2/3/4 (procurement
  // BOM continuations — the permit needs ONE major-equipment schedule), APP-A
  // (a duplicate reference to the DS pages that follow it), and the CERT/PE-1
  // certification placeholders while no digest-bound approval exists. PV-5 and
  // PV-6 compose onto ONE labels/directory sheet. DS-n move OUT of the numbered
  // drawing set into the manufacturer attachment appendix.
  //
  // Nothing here decides truth: every requirement these sheets used to print is
  // still in the snapshot registry, still counted by the release gates, and
  // still stated on the cover's single release-status line.
  if (o.profile === 'permit' || o.profile === 'design-review') {
    const cert = o.certificationCompleted === true;
    const designReview = o.profile === 'design-review';
    // Certification tail per the post-AAC profile contract:
    //   permit        — CERT/PE-1 ONLY under a digest-bound approval (before the
    //                   appendix, like the drawing set they certify);
    //   design-review — the package ENDS on PE-1 as the final engineer-review
    //                   sheet (after the appendix), in its current state.
    const certSheets = [
      { id: 'CERT', title: 'ENGINEER CERTIFICATION — PROFESSIONAL REVIEW' },
      { id: 'PE-1', title: peLetterManifestTitle(cert, primaryLabel) },
      ...extras.map(sub => ({ id: hybridSheetId('PE-1', sub), title: peLetterManifestTitle(cert, ` — ${HYBRID_LABEL[sub]}`) })),
    ];
    const reviewTail = [
      ...(cert ? [{ id: 'CERT', title: 'ENGINEER CERTIFICATION — PROFESSIONAL REVIEW' }] : []),
      { id: 'PE-1', title: peLetterManifestTitle(cert, primaryLabel) },
      ...extras.map(sub => ({ id: hybridSheetId('PE-1', sub), title: peLetterManifestTitle(cert, ` — ${HYBRID_LABEL[sub]}`) })),
    ];
    return [
      { id: 'PV-0',  title: 'COVER SHEET — PROJECT OVERVIEW & GENERAL NOTES' },
      // 2026-08-29 — RS-1 RESTORED TO DESIGN-REVIEW, and inserted HERE rather
      // than by falling the profile through to the full manifest: the page
      // assembly emits it in exactly this position (immediately after the
      // cover), and the two lists must stay byte-for-byte in step or V12/V35
      // fail on a page-count-vs-sheet-index desync. It remains out of the
      // PERMIT submittal — our internal review record is not part of an AHJ
      // application.
      ...(designReview ? [
        { id: 'RS-1', title: 'REVIEW STATUS — RELEASE GATES & REQUIREMENTS' },
        ...Array.from({ length: Math.max(0, o.reviewStatusContCount ?? 0) },
          (_unused, i) => ({ id: `RS-1.${i + 1}`, title: 'REVIEW STATUS (CONTINUED) — RELEASE REQUIREMENTS' })),
      ] : []),
      { id: 'PV-1',  title: o.pv1Title },
      ...extras.map(sub => ({ id: hybridSheetId('PV-1', sub), title: HYBRID_PLAN_TITLE[sub] })),
      { id: 'PV-1B', title: pv1bTitle(o.isMicro, primaryLabel) },
      ...extras.map(sub => ({ id: hybridSheetId('PV-1B', sub), title: pv1bTitle(o.isMicro, ` — ${HYBRID_LABEL[sub]}`) })),
      { id: 'PV-3',  title: o.pv3Title },
      ...extras.map(sub => ({ id: hybridSheetId('PV-3', sub), title: HYBRID_STRUCT_TITLE[sub] })),
      { id: 'PV-4C', title: 'STRUCTURAL CALCULATIONS — ASCE 7-22 ANALYSIS' },
      ...(o.includePv4cCont ? [{ id: 'PV-4C.1', title: 'STRUCTURAL CALCULATIONS (CONTINUED) — DETAIL · LOAD COMBINATION · CONCLUSION' }] : []),
      { id: 'E-1',   title: 'SINGLE-LINE DIAGRAM — ELECTRICAL SCHEMATIC' },
      { id: 'PV-4A', title: 'NEC COMPLIANCE — ELECTRICAL CODE ANALYSIS' },
      { id: 'PV-4B', title: 'CONDUCTOR SCHEDULE — WIRE SIZING & VOLTAGE DROP' },
      ...(o.includePv4b1 ? [{ id: 'PV-4B.1', title: 'CONDUCTOR SCHEDULE — PHYSICAL SECTIONS' }] : []),
      { id: 'PV-5',  title: PERMIT_LABELS_SHEET_TITLE },
      { id: 'SCHED', title: 'MAJOR EQUIPMENT SCHEDULE — MODULES, INVERTERS & MOUNTING' },
      // ── D3 (Planset 17) — THE BOM CONTINUATIONS BELONG HERE TOO ───────────
      // These were excluded from the compact profiles on the reasoning quoted
      // above: "the permit needs ONE major-equipment schedule … Nothing here
      // decides truth: every requirement these sheets used to print is still in
      // the snapshot registry." That reasoning holds for the REVIEW sheets it
      // was written about. It does not hold for the BOM, because the procurement
      // lines are not requirements — they are the schedule itself.
      //
      // Measured on the live package: 48 canonical BOM rows, of which the full
      // profile renders all 48 and the permit AND design-review profiles
      // rendered 10. Thirty-eight procurement lines — including every fitting
      // row for RW-COMBINER_TO_DISCO_RUN and RW-DISCO_TO_METER_RUN — never
      // reached the AHJ-facing artifact, and the compact profiles did not even
      // emit a population total to compare against. A schedule that silently
      // omits four fifths of itself is not a compact schedule, it is a wrong one.
      ...schedContIds(o).map(id => ({ id, title: 'EQUIPMENT SCHEDULE — BILL OF MATERIALS (CONTINUED)' })),
      ...(!designReview && cert ? certSheets : []),
      // ── manufacturer attachment appendix (NOT numbered drawing sheets) ────
      ...ds.map(d => ({ ...d, section: 'appendix' as SheetSection })),
      // ── DESIGN_REVIEW: PE-1 is the FINAL engineer-review sheet ────────────
      ...(designReview ? reviewTail : []),
    ];
  }

  return [
    { id: 'PV-0',  title: 'COVER SHEET — PROJECT OVERVIEW & GENERAL NOTES' },
    // W10 (RP-D): the dedicated review-status registry sheet — every active
    // release blocker, referenced from the cover SHEET INDEX. Always present so
    // the manifest and page assembly stay byte-for-byte in sync (V12/V35).
    // RGM §5: the sheet leads with the seven-row ROOT-GATE table; the child
    // requirements group beneath their gate and paginate onto RS-1.n.
    { id: 'RS-1',  title: 'REVIEW STATUS — RELEASE GATES & REQUIREMENTS' },
    ...Array.from({ length: Math.max(0, o.reviewStatusContCount ?? 0) },
      (_unused, i) => ({ id: `RS-1.${i + 1}`, title: 'REVIEW STATUS (CONTINUED) — RELEASE REQUIREMENTS' })),
    { id: 'PV-1',  title: o.pv1Title },
    // Hybrid: one plan/elevation detail sheet PER additional sub-system
    // (real GPS geometry — never overlays only).
    ...extras.map(sub => ({ id: hybridSheetId('PV-1', sub), title: HYBRID_PLAN_TITLE[sub] })),
    { id: 'PV-1B', title: pv1bTitle(o.isMicro, primaryLabel) },
    ...extras.map(sub => ({ id: hybridSheetId('PV-1B', sub), title: pv1bTitle(o.isMicro, ` — ${HYBRID_LABEL[sub]}`) })),
    // ── structural (how it's held up) ─────────────────────────────────────
    { id: 'PV-3',  title: o.pv3Title },
    ...extras.map(sub => ({ id: hybridSheetId('PV-3', sub), title: HYBRID_STRUCT_TITLE[sub] })),
    { id: 'PV-4C', title: 'STRUCTURAL CALCULATIONS — ASCE 7-22 ANALYSIS' },
    // W9/§15: formal continuation of the roof structural calc sheet.
    ...(o.includePv4cCont ? [{ id: 'PV-4C.1', title: 'STRUCTURAL CALCULATIONS (CONTINUED) — DETAIL · LOAD COMBINATION · CONCLUSION' }] : []),
    // ── electrical (how it's wired — the single-line leads, calcs support) ─
    { id: 'E-1',   title: 'SINGLE-LINE DIAGRAM — ELECTRICAL SCHEMATIC' },
    { id: 'PV-4A', title: 'NEC COMPLIANCE — ELECTRICAL CODE ANALYSIS' },
    { id: 'PV-4B', title: 'CONDUCTOR SCHEDULE — WIRE SIZING & VOLTAGE DROP' },
    // Post-AAC E-1 repair: the canonical physical section schedule sheet
    // (micro topologies) — mirrors hasPhysicalSectionSchedule in the assembly.
    ...(o.includePv4b1 ? [{ id: 'PV-4B.1', title: 'CONDUCTOR SCHEDULE — PHYSICAL SECTIONS' }] : []),
    // ── labels ────────────────────────────────────────────────────────────
    { id: 'PV-5',  title: 'WARNING LABELS & PLACARDS — NEC REQUIRED SIGNAGE' },
    { id: 'PV-6',  title: 'DISCONNECT DIRECTORY & EMERGENCY PLACARD — NEC 705.10 / 690.56(B)' },
    // ── schedules · specs · datasheets ────────────────────────────────────
    { id: 'SCHED', title: 'EQUIPMENT SCHEDULE — MODULES, INVERTERS & BOM' },
    // W9/§15: N continuation sheets (SCHED-2 … SCHED-(N+1)) for long BOMs; each
    // capped so no continuation page clips. schedContCount is authoritative;
    // includeSchedCount is the legacy single-sheet fallback.
    ...schedContIds(o).map(id => ({ id, title: 'EQUIPMENT SCHEDULE — BILL OF MATERIALS (CONTINUED)' })),
    { id: 'APP-A', title: 'SPECIFICATION REFERENCE — EQUIPMENT DATA SHEETS' },
    ...ds,
    // ── certifications ────────────────────────────────────────────────────
    { id: 'CERT',  title: 'ENGINEER CERTIFICATION — PROFESSIONAL REVIEW' },
    { id: 'PE-1',  title: peLetterManifestTitle(o.certificationCompleted === true, primaryLabel) },
    ...extras.map(sub => ({ id: hybridSheetId('PE-1', sub), title: peLetterManifestTitle(o.certificationCompleted === true, ` — ${HYBRID_LABEL[sub]}`) })),
    ...(o.includeValidation ? [{ id: 'VAL-1', title: 'VALIDATION SUMMARY — INTERNAL QA (NOT FOR CONSTRUCTION)' }] : []),
    // ── appendix ──────────────────────────────────────────────────────────
    ...(o.includeCadAppendix ? [{ id: 'APP-CAD', title: 'CAD PREVIEW APPENDIX — NON-AUTHORITATIVE' }] : []),
  ];
}
