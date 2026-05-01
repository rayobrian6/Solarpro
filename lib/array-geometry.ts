// ============================================================
// Array Geometry Engine
// Computes full array geometry from panel specs + layout params
// All structural and BOM calculations derive from this output
// ============================================================

export type PanelOrientation = 'portrait' | 'landscape';

export interface PanelSpec {
  lengthIn: number;   // panel long dimension, inches
  widthIn: number;    // panel short dimension, inches
  weightLbs: number;  // per panel
}

export interface ArrayLayoutInput {
  panelCount: number;
  panel: PanelSpec;
  orientation: PanelOrientation;
  rowCount: number;           // number of rows (across slope)
  colCount?: number;          // columns per row (auto-calculated if omitted)
  moduleGapIn?: number;       // gap between modules in same row (default: 0.5")
  rowGapIn?: number;          // gap between rows (default: 6")
  railOverhangIn?: number;    // rail extension past outer modules (default: 6")
  railsPerRow?: number;       // rails per row (default: 2)
}

export interface ArrayGeometry {
  // Panel dimensions in this orientation
  panelLongIn: number;        // dimension along rail (width of array)
  panelShortIn: number;       // dimension across slope (height of array)

  // Layout
  rowCount: number;
  colCount: number;           // panels per row
  totalPanels: number;

  // Array footprint
  arrayWidthIn: number;       // total width along eave (rail direction)
  arrayHeightIn: number;      // total height up slope

  // Rail geometry
  railsPerRow: number;
  railCount: number;          // total rails
  railLengthIn: number;       // length of each rail (includes overhang both ends)
  railLengthFt: number;
  railSpacingIn: number;      // center-to-center between rails in same row (= panelShortIn)
  railOverhangIn: number;     // overhang past outer module each end

  // Clamp positions (relative to rail start)
  midClampPositionsIn: number[][];  // [railIndex][clampIndex] = position along rail
  endClampPositionsIn: number[][];  // [railIndex] = [leftEnd, rightEnd]

  // Clamp counts
  midClampsPerRail: number;
  endClampsPerRail: number;
  totalMidClamps: number;
  totalEndClamps: number;

  // Weight
  totalPanelWeightLbs: number;
  panelWeightPsfApprox: number;  // lbs/ft² over array footprint

  // Cantilever (distance from first/last mount to end of rail)
  // Determined by mount spacing — set after mount layout is calculated
  maxCantileverIn: number;    // placeholder, updated by structural engine
}

export function computeArrayGeometry(input: ArrayLayoutInput): ArrayGeometry {
  const {
    panelCount,
    panel,
    orientation,
    rowCount,
    moduleGapIn = 0.5,
    rowGapIn = 6,
    railOverhangIn = 6,
    railsPerRow = 2,
  } = input;

  // Panel dimensions in chosen orientation
  // Portrait: long dimension is vertical (across slope), short is horizontal (along rail)
  // Landscape: long dimension is horizontal (along rail), short is vertical (across slope)
  const panelLongIn  = orientation === 'portrait' ? panel.lengthIn : panel.widthIn;
  const panelShortIn = orientation === 'portrait' ? panel.widthIn  : panel.lengthIn;

  // Columns = ceil(panelCount / rowCount)
  const colCount = input.colCount ?? Math.ceil(panelCount / rowCount);
  const totalPanels = panelCount; // actual count (last row may be partial)

  // Array width = cols × panelLong + (cols-1) × moduleGap + 2 × railOverhang
  // Rail runs along the width direction
  const arrayWidthIn = colCount * panelLongIn + (colCount - 1) * moduleGapIn;

  // Array height = rows × panelShort + (rows-1) × rowGap
  const arrayHeightIn = rowCount * panelShortIn + (rowCount - 1) * rowGapIn;

  // Rail length = arrayWidth + 2 × overhang (extends past outer modules)
  const railLengthIn = arrayWidthIn + 2 * railOverhangIn;
  const railLengthFt = railLengthIn / 12;

  // Total rails = railsPerRow × rowCount
  const railCount = railsPerRow * rowCount;

  // Rail spacing within a row = panelShortIn (rails run at top and bottom of panel)
  // For 2-rail system: rails are at ~1/4 and 3/4 of panel height
  const railSpacingIn = panelShortIn;

  // Clamp positions along each rail
  // Mid clamps: between each pair of adjacent panels
  // End clamps: at each end of the rail (2 per rail)
  const midClampPositionsIn: number[][] = [];
  const endClampPositionsIn: number[][] = [];

  for (let r = 0; r < railCount; r++) {
    // End clamps at railOverhangIn from each end
    endClampPositionsIn.push([railOverhangIn, railLengthIn - railOverhangIn]);

    // Mid clamps between panels: at each panel joint
    const mids: number[] = [];
    for (let c = 1; c < colCount; c++) {
      const pos = railOverhangIn + c * panelLongIn + (c - 0.5) * moduleGapIn;
      mids.push(pos);
    }
    midClampPositionsIn.push(mids);
  }

  const midClampsPerRail = Math.max(0, colCount - 1);
  const endClampsPerRail = 2;
  const totalMidClamps = midClampsPerRail * railCount;
  const totalEndClamps = endClampsPerRail * railCount;

  // Weight
  const totalPanelWeightLbs = panelCount * panel.weightLbs;
  const arrayAreaFt2 = (arrayWidthIn / 12) * (arrayHeightIn / 12);
  const panelWeightPsfApprox = arrayAreaFt2 > 0 ? totalPanelWeightLbs / arrayAreaFt2 : 0;

  return {
    panelLongIn,
    panelShortIn,
    rowCount,
    colCount,
    totalPanels,
    arrayWidthIn,
    arrayHeightIn,
    railsPerRow,
    railCount,
    railLengthIn,
    railLengthFt,
    railSpacingIn,
    railOverhangIn,
    midClampPositionsIn,
    endClampPositionsIn,
    midClampsPerRail,
    endClampsPerRail,
    totalMidClamps,
    totalEndClamps,
    totalPanelWeightLbs,
    panelWeightPsfApprox,
    maxCantileverIn: railOverhangIn, // updated by structural engine after mount layout
  };
}

// ─── Utility: auto-determine row/col layout from panel count ─────────────────
export function autoLayout(panelCount: number): { rowCount: number; colCount: number } {
  // Prefer landscape-ish layouts: more columns than rows
  // Common residential: 2-4 rows
  if (panelCount <= 6)  return { rowCount: 1, colCount: panelCount };
  if (panelCount <= 12) return { rowCount: 2, colCount: Math.ceil(panelCount / 2) };
  if (panelCount <= 20) return { rowCount: 2, colCount: Math.ceil(panelCount / 2) };
  if (panelCount <= 30) return { rowCount: 3, colCount: Math.ceil(panelCount / 3) };
  if (panelCount <= 40) return { rowCount: 4, colCount: Math.ceil(panelCount / 4) };
  if (panelCount <= 60) return { rowCount: 4, colCount: Math.ceil(panelCount / 4) };
  return { rowCount: 5, colCount: Math.ceil(panelCount / 5) };
}