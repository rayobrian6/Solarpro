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

export interface SheetRef { id: string; title: string; }

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
}

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
    { id: 'PE-1',  title: `PE STRUCTURAL LETTER — LETTER OF COMPLIANCE${primaryLabel}` },
    ...extras.map(sub => ({ id: hybridSheetId('PE-1', sub), title: `PE STRUCTURAL LETTER — LETTER OF COMPLIANCE — ${HYBRID_LABEL[sub]}` })),
    ...(o.includeValidation ? [{ id: 'VAL-1', title: 'VALIDATION SUMMARY — INTERNAL QA (NOT FOR CONSTRUCTION)' }] : []),
    // ── appendix ──────────────────────────────────────────────────────────
    ...(o.includeCadAppendix ? [{ id: 'APP-CAD', title: 'CAD PREVIEW APPENDIX — NON-AUTHORITATIVE' }] : []),
  ];
}
