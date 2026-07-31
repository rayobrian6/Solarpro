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
