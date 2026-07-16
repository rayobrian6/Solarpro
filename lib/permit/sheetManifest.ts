// ═══════════════════════════════════════════════════════════════════════════
// PERMIT SHEET MANIFEST — the SINGLE ordered source of truth for the planset.
// The page order, the cover SHEET INDEX, and the engineering-page sheet status
// all derive from this one list so they can never drift (the sheet count varies
// per project — datasheet pages grow the set, conditional sheets add/remove).
//
// Reading order (grouped by discipline):
//   cover → site/array plans → electrical (NEC · conductor · single-line)
//         → structural (attachment · calcs) → labels → schedules/specs/datasheets
//         → certifications → appendices
// E-1 (single-line) sits WITH the electrical sheets, not orphaned after the certs.
// ═══════════════════════════════════════════════════════════════════════════

export interface SheetRef { id: string; title: string; }

export type HybridManifestSub = 'roof' | 'ground' | 'fence';

export interface SheetManifestOptions {
  /** system-aware titles for the plan/attachment sheets */
  pv1Title: string;
  pv3Title: string;
  /** DS-n equipment datasheet pages already resolved (module/inverter/battery) */
  datasheets?: SheetRef[];
  includeSchedCont?: boolean;     // long BOM → SCHED-2
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
    { id: 'PV-1',  title: o.pv1Title },
    // Hybrid: one plan/elevation detail sheet PER additional sub-system
    // (real GPS geometry — never overlays only).
    ...extras.map(sub => ({ id: hybridSheetId('PV-1', sub), title: HYBRID_PLAN_TITLE[sub] })),
    { id: 'PV-1B', title: `ARRAY GEOMETRY — STRING LAYOUT & CONFIGURATION${primaryLabel}` },
    ...extras.map(sub => ({ id: hybridSheetId('PV-1B', sub), title: `ARRAY GEOMETRY — STRING LAYOUT & CONFIGURATION — ${HYBRID_LABEL[sub]}` })),
    // ── electrical ────────────────────────────────────────────────────────
    { id: 'PV-4A', title: 'NEC COMPLIANCE — ELECTRICAL CODE ANALYSIS' },
    { id: 'PV-4B', title: 'CONDUCTOR SCHEDULE — WIRE SIZING & VOLTAGE DROP' },
    { id: 'E-1',   title: 'SINGLE-LINE DIAGRAM — ELECTRICAL SCHEMATIC' },
    // ── structural ────────────────────────────────────────────────────────
    { id: 'PV-3',  title: o.pv3Title },
    ...extras.map(sub => ({ id: hybridSheetId('PV-3', sub), title: HYBRID_STRUCT_TITLE[sub] })),
    { id: 'PV-4C', title: 'STRUCTURAL CALCULATIONS — ASCE 7-22 ANALYSIS' },
    // ── labels ────────────────────────────────────────────────────────────
    { id: 'PV-5',  title: 'WARNING LABELS & PLACARDS — NEC REQUIRED SIGNAGE' },
    { id: 'PV-6',  title: 'DISCONNECT DIRECTORY & EMERGENCY PLACARD — NEC 705.10 / 690.56(B)' },
    // ── schedules · specs · datasheets ────────────────────────────────────
    { id: 'SCHED', title: 'EQUIPMENT SCHEDULE — MODULES, INVERTERS & BOM' },
    ...(o.includeSchedCont ? [{ id: 'SCHED-2', title: 'EQUIPMENT SCHEDULE — BILL OF MATERIALS (CONTINUED)' }] : []),
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
