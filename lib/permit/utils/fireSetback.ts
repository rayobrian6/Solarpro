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
