// ─── Fire setback width — ONE rule for every sheet ───────────────────────────
// IFC 2021 §1204.2.1.1: the 18" ridge/hip setback is the EXCEPTION, permitted
// only where the array covers ≤ 33% of the roof plan area; otherwise the 36"
// default governs. An AHJ-supplied value of exactly 18" is treated as the bare
// exception value (usually a DB default, not a real amendment) and still has
// to pass the coverage test; only AHJ values ABOVE 18" bypass it as genuine
// local amendments. Drawing (roof.ts), sheet data zones (sheetComposition),
// and note text (arrayPages/compliancePages) must ALL call this — three
// hand-rolled copies shipped a set whose text said 1.5' while the drawing
// hatched 3'-0" bands.

export function resolveFireSetbackIn(
  ahjRidgeSetbackIn: number | undefined | null,
  arrayCoverageFrac: number,
): number {
  if (ahjRidgeSetbackIn && ahjRidgeSetbackIn > 18) return ahjRidgeSetbackIn;
  return arrayCoverageFrac > 0.33 ? 36 : (ahjRidgeSetbackIn || 18);
}

// ─── Fire-setback authority BASIS (closeout 2026-07-23 §15) ──────────────────
// The setback GEOMETRY (3' ridge / 18" hip / pathway) is a modeled design-review
// assumption; it becomes an ADOPTED AHJ requirement only when the jurisdiction's
// identity AND its adopted IFC edition are verified. PV-1/PV-1B used to append
// "IFC §1204.2 per AHJ" unconditionally — describing an unverified assumption as
// an AHJ requirement, and directly contradicting the same sheet's "IFC PENDING"
// title block. This helper projects the honest basis wording from the canonical
// codeAuthority IFC verification state so every fire-setback note agrees.
//
// Separates the three claims the directive requires be kept distinct:
//   • modeled geometry      — the setback dimensions the drawing shows
//   • assumed design basis   — the provisional IFC §1204.2 basis (unverified)
//   • verified requirement   — an AHJ-adopted IFC edition (only when verified)

export interface FireSetbackBasis {
  /** true only when the AHJ identity + adopted IFC edition are both verified. */
  verified: boolean;
  /** short section citation, edition-correct when verified else PENDING. */
  citation: string;
  /** the basis banner phrase (provisional vs adopted authority). */
  basisLabel: string;
  /** compact inline suffix for callouts (no leading separator). */
  calloutSuffix: string;
}

export function resolveFireSetbackBasis(args: {
  /** adopted IFC edition token (e.g. '2021') or null when unknown. */
  ifcEdition: string | null | undefined;
  /** codeAuthority verification status ('verified'|'unverified'|'incomplete'|'absent'). */
  verificationStatus: string | null | undefined;
  /** resolved AHJ name, or null when the jurisdiction is unresolved. */
  ahjName: string | null | undefined;
}): FireSetbackBasis {
  const verified = args.verificationStatus === 'verified' && !!args.ifcEdition && !!args.ahjName;
  if (verified) {
    return {
      verified: true,
      citation: `IFC ${args.ifcEdition} §1204.2`,
      basisLabel: `ADOPTED FIRE SETBACK REQUIREMENT — ${args.ahjName} (IFC ${args.ifcEdition} §1204.2)`,
      calloutSuffix: `IFC ${args.ifcEdition} §1204.2 — ${args.ahjName} ADOPTED`,
    };
  }
  return {
    verified: false,
    citation: `IFC §1204.2 — EDITION PENDING VERIFICATION`,
    basisLabel: `PROVISIONAL FIRE SETBACK BASIS — PENDING AHJ / IFC VERIFICATION`,
    calloutSuffix: `PROVISIONAL BASIS — PENDING AHJ / IFC VERIFICATION`,
  };
}

/** Plan-view array coverage fraction from CAD aggregates.
 *
 * BASIS (slope-space fix, 2026-07-12): roofPlanAreaFt2 is a PLAN area
 * (shoelace of plan-projected vertices), so the array area must be
 * plan-projected too — a tilted module's plan footprint is its real area
 * x cos(pitch). Passing the pitch keeps this helper on the SAME basis as
 * the PV-1 drawing (roof.ts), which decided 18"-vs-36" while this helper's
 * old mixed basis (real array / plan roof) overstated coverage by
 * 1/cos(pitch) — Stowell printed 36.4% next to a drawing that resolved
 * 30.4% and an 18" band. pitchDeg omitted => legacy mixed-basis behavior. */
export function arrayCoverageFrac(
  totalPanels: number,
  panelLengthIn: number,
  panelWidthIn: number,
  roofPlanAreaFt2: number,
  pitchDeg?: number,
): number {
  if (!roofPlanAreaFt2 || roofPlanAreaFt2 <= 0) return 0;
  const cosP = typeof pitchDeg === 'number' && isFinite(pitchDeg)
    ? Math.cos(Math.max(0, Math.min(60, pitchDeg)) * Math.PI / 180)
    : 1;
  return (totalPanels * (panelLengthIn * panelWidthIn) / 144) * cosP / roofPlanAreaFt2;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CANONICAL FIRE-ACCESS PATHWAY WIDTH — one fact, one producer.
//
// Ray's ruling 2026-08-30: SolarPro's modeled fire-access design basis is a
// 36-inch pathway. The `roofSetbackInches` column is NOT authorized to drive
// access-pathway geometry.
//
// ── THE DEFECT THIS REPLACES ──────────────────────────────────────────────
// The drawing derived the pathway from `project.ahjRoofSetbackIn`
// (= ahj-national.roofSetbackInches) while the sheet printed a hard literal
// 36". That column holds 36 for 3,514 rows and 18 for 502 (TX 341, UT 46,
// NM 46, AZ 42, NV 27), so on those 502 the note said 36" and the drawing was
// dimensioned at 18" — two different answers on one permit sheet.
//
// It is a SEMANTIC mapping defect, not a "which source wins" question: a
// PATHWAY WIDTH and a ROOF/RIDGE SETBACK are different concepts, and the
// geometry was consuming the wrong one.
//
// ── WHAT THIS IS AND IS NOT ───────────────────────────────────────────────
// 36" is the MODELED DESIGN BASIS from IFC §1204.2.1. It is NOT a proven local
// adoption. Nothing here may be rendered as "required by the AHJ" — the sheet's
// existing PROVISIONAL / PENDING AHJ / IFC VERIFICATION language stays.
//
// Deliberately NOT said: that 18" is "wrong" or "illegal". It was not governed
// evidence for pathway width and was being read by the wrong field. What it
// legitimately means is unproven and is quarantined, not deleted.
// ═══════════════════════════════════════════════════════════════════════════

/** The modeled fire-access pathway width, in inches. IFC §1204.2.1. */
export const MODELED_ACCESS_PATHWAY_IN = 36;

/** Authority state of the pathway width. Design basis, never local adoption. */
export const ACCESS_PATHWAY_BASIS = {
  valueIn: MODELED_ACCESS_PATHWAY_IN,
  status: 'MODELED_DESIGN_BASIS',
  provenanceIntegrity: 'VERIFIED',
  origin: 'model_code',
  authorityLevel: 'model_code',
  scope: 'fire_access',
  amendmentStatus: 'NOT_CHECKED',
  localAdoption: 'PENDING_VERIFICATION',
  releaseSemantics: {
    usableForDesign: true,
    usableForDesignReview: true,
    /** a modeled basis is not a permit claim about what the AHJ requires. */
    usableForPermitClaim: false,
    blocksPermitRelease: false,
  },
} as const;

/**
 * The one accessor every consumer must use — calculation, geometry, the printed
 * note and the tests. A caller may pass a governed override once local adoption
 * evidence exists; until then there is none, so the modeled basis governs.
 */
export function resolveAccessPathwayIn(governedOverrideIn?: number | null): number {
  return (governedOverrideIn && governedOverrideIn > 0)
    ? governedOverrideIn
    : MODELED_ACCESS_PATHWAY_IN;
}
