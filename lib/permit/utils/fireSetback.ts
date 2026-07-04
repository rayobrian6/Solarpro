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

/** Plan-view array coverage fraction from CAD aggregates. */
export function arrayCoverageFrac(
  totalPanels: number,
  panelLengthIn: number,
  panelWidthIn: number,
  roofPlanAreaFt2: number,
): number {
  if (!roofPlanAreaFt2 || roofPlanAreaFt2 <= 0) return 0;
  return (totalPanels * (panelLengthIn * panelWidthIn) / 144) / roofPlanAreaFt2;
}
