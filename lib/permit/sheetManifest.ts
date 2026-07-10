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

export interface SheetManifestOptions {
  /** system-aware titles for the plan/attachment sheets */
  pv1Title: string;
  pv3Title: string;
  /** DS-n equipment datasheet pages already resolved (module/inverter/battery) */
  datasheets?: SheetRef[];
  includeSchedCont?: boolean;     // long BOM → SCHED-2
  includeValidation?: boolean;    // VAL-1 internal QA (off in AHJ deliverable)
  includeCadAppendix?: boolean;   // APP-CAD non-authoritative preview
}

/**
 * The canonical ordered list of sheets for a permit package. Deterministic and
 * pure — safe to call on both the server (generator, cover index) and the
 * client (engineering-page sheet status / count).
 */
export function buildSheetManifest(o: SheetManifestOptions): SheetRef[] {
  const ds = o.datasheets ?? [];
  return [
    { id: 'PV-0',  title: 'COVER SHEET — PROJECT OVERVIEW & GENERAL NOTES' },
    { id: 'PV-1',  title: o.pv1Title },
    { id: 'PV-1B', title: 'ARRAY GEOMETRY — STRING LAYOUT & CONFIGURATION' },
    // ── electrical ────────────────────────────────────────────────────────
    { id: 'PV-4A', title: 'NEC COMPLIANCE — ELECTRICAL CODE ANALYSIS' },
    { id: 'PV-4B', title: 'CONDUCTOR SCHEDULE — WIRE SIZING & VOLTAGE DROP' },
    { id: 'E-1',   title: 'SINGLE-LINE DIAGRAM — ELECTRICAL SCHEMATIC' },
    // ── structural ────────────────────────────────────────────────────────
    { id: 'PV-3',  title: o.pv3Title },
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
    { id: 'PE-1',  title: 'PE STRUCTURAL LETTER — LETTER OF COMPLIANCE' },
    ...(o.includeValidation ? [{ id: 'VAL-1', title: 'VALIDATION SUMMARY — INTERNAL QA (NOT FOR CONSTRUCTION)' }] : []),
    // ── appendix ──────────────────────────────────────────────────────────
    ...(o.includeCadAppendix ? [{ id: 'APP-CAD', title: 'CAD PREVIEW APPENDIX — NON-AUTHORITATIVE' }] : []),
  ];
}
