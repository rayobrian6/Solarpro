// ============================================================
// SHADE ANALYSIS ENGINE — v1.0
// lib/shadeAnalysis.ts
//
// Computes per-panel annual shade factors from:
//   1. Sun path geometry (lat/lng + tilt/azimuth per panel)
//   2. Horizon/obstruction angles (trees, structures, ridge)
//   3. Inter-row self-shading from row spacing
//
// Architecture:
//   • Sample sun positions at 96 times/year (every ~3.8 days, every 30 min)
//   • For each sample: compute panel-normal dot sun-vector
//   • Weight by irradiance (solar elevation proxy)
//   • Apply horizon/obstruction mask if provided
//   • Aggregate → annual shade factor 0..1 (1=no shade, 0=fully shaded)
//
// Output:
//   • annualShadeFactor per panel (0..1)
//   • systemShadeDeratePct: weighted average shade loss across all panels (%)
//   • perPanelDerate: per-panel production multiplier (0..1)
// ============================================================

import { getSunPosition } from '@/lib/solarMath';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PanelShadeInput {
  id: string;
  tilt: number;        // degrees 0=flat, 90=vertical
  azimuth: number;     // degrees 0=N, 90=E, 180=S, 270=W
  row: number;         // row index (0-based, 0 = closest to ridge/back)
  col: number;         // column index (0-based)
  lat?: number;        // panel lat (use system lat if absent)
  lng?: number;        // panel lng (use system lng if absent)
}

export interface ObstructionProfile {
  /** Horizon elevation angle (degrees) blocked by fixed obstructions (trees, structures)
   *  for each compass direction 0..359° at 1° resolution.
   *  Values 0..90 (0 = clear horizon, 45 = tall tree/structure).
   *  If undefined, treated as all zeros (flat horizon).
   */
  horizonElevations?: number[];   // 360 values, index = azimuth degree

  /** Obstruction height above panel top (meters) within a given distance */
  nearbyObstruction?: {
    heightM: number;      // obstruction height above panel (m)
    distanceM: number;    // horizontal distance from panel (m)
    azimuthDeg: number;   // compass direction to obstruction (degrees)
    arcDeg?: number;      // angular width of obstruction (default: 30°)
    /**
     * WHICH OBJECT THIS IS, when the profile was derived from real geometry.
     *
     * 🚨 WITHOUT IT NOBODY CAN ANSWER "WHY IS THIS PANEL SHADED". Four
     * anonymous entries at similar bearings are indistinguishable — a test
     * hunting for "the tree" matched a garage, and a user asking the same
     * question of the UI would get no answer at all. Optional, because a
     * hand-entered profile has no object behind it.
     */
    sourceId?: string;
    /** 'tree' | 'roofObject' | 'building' — what kind of thing it is. */
    kind?: string;
  }[];
}

export interface ShadeAnalysisResult {
  /** Annual shade factor per panel: 0=fully shaded, 1=full sun */
  panelShadeFactors: Record<string, number>;

  /** Weighted-average annual shade derate across all panels, as a % (0..100) */
  systemShadeDeratePct: number;

  /** Per-panel production multiplier (= annualShadeFactor, alias for clarity) */
  perPanelDerate: Record<string, number>;

  /** Shade bucket distribution for heatmap rendering */
  heatmapBuckets: ShadeHeatmapBucket[];

  /** Worst and best panels by shade */
  worstPanelId: string | null;
  bestPanelId:  string | null;
  worstShadeFactor: number;
  bestShadeFactor:  number;
}

export interface ShadeHeatmapBucket {
  panelId: string;
  shadeFactor: number;  // 0..1
  /** CSS color for heatmap rendering */
  color: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

// Sampling grid: 12 representative days × 8 times/day = 96 samples
// Representative days: Jan 15, Feb 15, Mar 15, Apr 15, May 15, Jun 21,
//                      Jul 15, Aug 15, Sep 15, Oct 15, Nov 15, Dec 15
const SAMPLE_MONTHS: { month: number; day: number; weight: number }[] = [
  { month: 0,  day: 15, weight: 1.0 },  // January
  { month: 1,  day: 15, weight: 1.0 },  // February
  { month: 2,  day: 15, weight: 1.1 },  // March (spring equinox)
  { month: 3,  day: 15, weight: 1.2 },  // April
  { month: 4,  day: 15, weight: 1.3 },  // May
  { month: 5,  day: 21, weight: 1.4 },  // June (summer solstice)
  { month: 6,  day: 15, weight: 1.4 },  // July
  { month: 7,  day: 15, weight: 1.3 },  // August
  { month: 8,  day: 15, weight: 1.2 },  // September
  { month: 9,  day: 15, weight: 1.1 },  // October
  { month: 10, day: 15, weight: 1.0 },  // November
  { month: 11, day: 15, weight: 0.9 },  // December
];

// Times: every 2 hours from 6 AM to 8 PM local solar time (UTC offsets handled via simple LMT)
const SAMPLE_HOURS_UTC_OFFSETS = [6, 8, 10, 12, 14, 16, 18, 20]; // local solar hours

const DEG = Math.PI / 180;

// ── Sun vector helpers ────────────────────────────────────────────────────────

function toDeg(rad: number): number { return rad / DEG; }
function toRad(deg: number): number { return deg * DEG; }

/** Panel surface normal in ENU (East-North-Up) frame */
function panelNormal(tiltDeg: number, azimuthDeg: number): [number, number, number] {
  const t = toRad(tiltDeg);
  const a = toRad(azimuthDeg);
  // Normal points away from panel surface toward the sky
  const nx =  Math.sin(t) * Math.sin(a);   // East component
  const ny =  Math.sin(t) * Math.cos(a);   // North component
  const nz =  Math.cos(t);                  // Up component
  return [nx, ny, nz];
}

/** Sun direction unit vector in ENU frame */
function sunVector(elevDeg: number, azDeg: number): [number, number, number] {
  if (elevDeg <= 0) return [0, 0, -1]; // below horizon
  const el = toRad(elevDeg);
  const az = toRad(azDeg);
  return [
    Math.cos(el) * Math.sin(az),  // East
    Math.cos(el) * Math.cos(az),  // North
    Math.sin(el),                  // Up
  ];
}

/** Dot product of panel normal and sun vector → shade factor 0..1 */
function shadeFactor(tiltDeg: number, azimuthDeg: number, sunElev: number, sunAz: number): number {
  if (sunElev <= 0) return 0;
  const [nx, ny, nz] = panelNormal(tiltDeg, azimuthDeg);
  const [sx, sy, sz] = sunVector(sunElev, sunAz);
  return Math.max(0, nx * sx + ny * sy + nz * sz);
}

// ── Obstruction masking ───────────────────────────────────────────────────────

/**
 * Build a 360-element horizon elevation array from an ObstructionProfile.
 * Index i = horizon elevation angle (degrees) blocked from azimuth i°.
 */
function buildHorizonMask(profile: ObstructionProfile): number[] {
  const mask = new Array<number>(360).fill(0);

  // 1) Pre-provided horizon elevations (e.g., from Google Solar API or user input)
  if (profile.horizonElevations && profile.horizonElevations.length === 360) {
    for (let i = 0; i < 360; i++) {
      mask[i] = Math.max(mask[i], profile.horizonElevations[i]);
    }
  }

  // 2) Nearby obstructions (trees, structures)
  if (profile.nearbyObstruction) {
    for (const obs of profile.nearbyObstruction) {
      const blockingElevAngle = toDeg(Math.atan2(obs.heightM, obs.distanceM));
      const arc = (obs.arcDeg ?? 30) / 2;
      for (let deg = -Math.ceil(arc); deg <= Math.ceil(arc); deg++) {
        const azIdx = ((Math.round(obs.azimuthDeg + deg) % 360) + 360) % 360;
        mask[azIdx] = Math.max(mask[azIdx], blockingElevAngle);
      }
    }
  }

  return mask;
}

/**
 * Returns true if the sun at (sunElev, sunAz) is blocked by the horizon mask.
 */
function isSunBlocked(sunElev: number, sunAz: number, horizonMask: number[]): boolean {
  if (sunElev <= 0) return true;
  const azIdx = ((Math.round(sunAz) % 360) + 360) % 360;
  return sunElev < horizonMask[azIdx];
}

// ── Inter-row self-shading model ──────────────────────────────────────────────

/**
 * Simple inter-row shading model.
 * Returns the sun elevation angle below which a given row is shaded by the row in front of it.
 *
 * @param panelHeightM  Vertical panel dimension (meters). Default: 1.134m (60-cell portrait)
 * @param rowSpacingM   Row-to-row spacing (meters). Default: 1.5m typical
 * @param tiltDeg       Panel tilt angle (degrees)
 * @param rowIndex      0 = back/south row (shades rows behind it); higher rows are further back
 * @param totalRows     Total number of rows
 */
function getInterRowShadeElevation(params: {
  panelHeightM: number;
  rowSpacingM: number;
  tiltDeg: number;
}): number {
  const { panelHeightM, rowSpacingM, tiltDeg } = params;
  const tilt = toRad(tiltDeg);
  // Vertical rise of panel
  const panelVerticalRise = panelHeightM * Math.sin(tilt);
  // Row pitch (distance between panel fronts)
  const rowPitch = rowSpacingM;
  if (rowPitch <= 0 || panelVerticalRise <= 0) return 0;
  // Sun elevation angle below which front row shades back row
  return toDeg(Math.atan2(panelVerticalRise, rowPitch));
}

// ── Main analysis function ────────────────────────────────────────────────────

/**
 * Run shade analysis on a set of panels.
 *
 * @param panels     Array of panels with tilt/azimuth/row/col
 * @param lat        Site latitude (degrees)
 * @param lng        Site longitude (degrees)
 * @param obstruction Optional horizon/obstruction profile
 * @param rowSpacingM Row-to-row spacing in meters (default: 1.5m)
 * @param panelHeightM Panel height in meters (default: 1.134m)
 * @param year        Year for sun position calculation (default: current year)
 */
export function computeShadeAnalysis(
  panels: PanelShadeInput[],
  lat: number,
  lng: number,
  /**
   * WHAT STANDS BETWEEN THESE MODULES AND THE SUN.
   *
   * 🚨 A FUNCTION MEANS "PER PANEL", AND THAT IS THE WHOLE POINT OF A SHADE
   * STUDY. One profile for the entire array answers the question the study was
   * asked to avoid: a tree at the south-west corner shades the modules beside
   * it and not the ones forty feet away. `lib/shade/canonicalShadeScene.ts`
   * builds these from the design's own geometry.
   *
   * A single profile still behaves exactly as it always did, so every existing
   * caller is unchanged.
   */
  obstruction?: ObstructionProfile | ((panelId: string) => ObstructionProfile | null),
  rowSpacingM = 1.5,
  panelHeightM = 1.134,
  year?: number,
): ShadeAnalysisResult {
  if (panels.length === 0) {
    return {
      panelShadeFactors: {},
      systemShadeDeratePct: 0,
      perPanelDerate: {},
      heatmapBuckets: [],
      worstPanelId: null,
      bestPanelId: null,
      worstShadeFactor: 0,
      bestShadeFactor: 1,
    };
  }

  const refYear = year ?? new Date().getFullYear();

  // Build horizon mask (0s if no obstruction provided)
  const perPanelProfile = typeof obstruction === 'function' ? obstruction : null;
  const FLAT_HORIZON = new Array<number>(360).fill(0);
  const sharedMask = perPanelProfile
    ? null
    : (obstruction ? buildHorizonMask(obstruction as ObstructionProfile) : FLAT_HORIZON);

  // Compute inter-row shade elevation threshold per panel
  // Panels in later rows (higher row index) are shaded by earlier rows
  const maxRow = Math.max(...panels.map(p => p.row));

  // Compute per-panel shade factor
  const panelShadeFactors: Record<string, number> = {};

  for (const panel of panels) {
    const pLat = panel.lat ?? lat;
    const pLng = panel.lng ?? lng;
    // Built once per panel, not once per sample: the geometry does not move
    // between January and June, only the sun does.
    let horizonMask = sharedMask;
    if (perPanelProfile) {
      const prof = perPanelProfile(panel.id);
      horizonMask = prof ? buildHorizonMask(prof) : FLAT_HORIZON;
    }

    // 🚨 A SHADE FACTOR IS A RATIO OF IRRADIANCE, AND THIS WAS A MEAN COSINE.
    //
    // `shadeFactor()` returns max(0, dot(panelNormal, sunVector)) -- the cosine
    // of the angle of incidence, with nothing to do with obstructions. The
    // annual number was the irradiance-weighted mean of that cosine, normalised
    // by the weights alone:
    //
    //     annualFactor = SUM(cos_i * w_i) / SUM(w_i)
    //
    // For a clear south-facing roof at 38.7 N that is about 0.73, so the product
    // reported "26.6% annual shade loss" ON AN EMPTY SKY -- nothing in the scene
    // at all. A flat deck reported 35%. And lib/pvwatts.ts then stacked it on
    // the 14% baseline AND on PVWatts' own tilt/azimuth factors, which already
    // account for orientation: effective losses 36.9% against a 14% baseline,
    // production multiplied by 0.734 for a roof with nothing shading it.
    //
    // Orientation has exactly one owner and it is not this function. What this
    // function owns is OBSTRUCTION. So the denominator must be the irradiance
    // the same panel would receive with an unobstructed sky:
    //
    //     annualFactor = SUM(cos_i * w_i * visible_i) / SUM(cos_i * w_i)
    //
    // which is 1.0 for a clear sky by construction, and otherwise the fraction
    // of plane-of-array irradiance that actually arrives. The cosine appears in
    // both sums and therefore cancels where nothing blocks -- it weights the
    // hours by how much they were worth to THIS panel, which is exactly what it
    // should do, rather than masquerading as a loss.
    /** SUM(cos_i * w_i) over every daylight sample: the unobstructed sky. */
    let clearSkyWeight = 0;
    /** The same sum, counting only the samples that actually reach the panel. */
    let receivedWeight = 0;

    for (const sample of SAMPLE_MONTHS) {
      const date = new Date(refYear, sample.month, sample.day);

      for (const localHour of SAMPLE_HOURS_UTC_OFFSETS) {
        // Approximate UTC time from local solar time
        // LMT offset: longitude / 15 hours
        const utcOffset = pLng / 15;
        const utcHour = localHour - utcOffset;

        const sampleDate = new Date(Date.UTC(
          refYear,
          sample.month,
          sample.day,
          Math.round(utcHour),
          0,
          0,
        ));

        // Get sun position
        let sunPos: { elevation: number; azimuth: number };
        try {
          sunPos = getSunPosition(pLat, pLng, sampleDate);
        } catch {
          continue; // skip bad samples
        }

        if (sunPos.elevation <= 0) continue; // nighttime — skip

        // Check horizon/obstruction block
        if (isSunBlocked(sunPos.elevation, sunPos.azimuth, horizonMask)) {
          // Sun below the horizon mask: this slot is genuinely lost to something
          // in the scene. It counts in the denominator -- it is irradiance the
          // panel WOULD have had -- and contributes nothing to the numerator.
          //
          // 🚨 AND THE COSINE IS NEEDED HERE TOO. The old code skipped straight
          // past it, which mattered once the denominator became cosine-weighted:
          // without it, an obstruction blocking a low-angle winter morning would
          // be charged at the same rate as one blocking noon in June.
          const irradianceProxy = Math.sin(toRad(sunPos.elevation));
          const cosI = shadeFactor(panel.tilt, panel.azimuth, sunPos.elevation, sunPos.azimuth);
          clearSkyWeight += cosI * sample.weight * irradianceProxy;
          continue;
        }

        // Check inter-row self-shading
        // Panels in row 0 (front/closest to south) may shade panels in higher rows
        // when sun is low. Row 0 = front row = least shaded by inter-row.
        // rowIndex > 0 panels have the threshold elevation applied.
        let interRowBlocked = false;
        if (panel.row > 0 && panel.tilt > 5) {
          const shadeThresholdElevation = getInterRowShadeElevation({
            panelHeightM,
            rowSpacingM,
            tiltDeg: panel.tilt,
          });
          // Only block when sun is roughly aligned with the row direction (near row azimuth)
          // Sun in azimuth within ±90° of panel facing direction is the critical zone
          const azDiff = Math.abs(((sunPos.azimuth - panel.azimuth + 540) % 360) - 180);
          if (azDiff < 90 && sunPos.elevation < shadeThresholdElevation) {
            interRowBlocked = true;
          }
        }

        // The cosine of incidence for this slot: how much this sun position was
        // worth to THIS panel. It is the weight, not the answer.
        const cosI = shadeFactor(panel.tilt, panel.azimuth, sunPos.elevation, sunPos.azimuth);

        // Weight by irradiance proxy (sin of sun elevation) and seasonal weight
        const irradianceProxy = Math.sin(toRad(sunPos.elevation));
        const w = cosI * sample.weight * irradianceProxy;
        clearSkyWeight += w;
        // Inter-row self-shading is a real obstruction -- by the array itself.
        if (!interRowBlocked) receivedWeight += w;
      }
    }

    // 🚨 1.0 MEANS NOTHING IS IN THE WAY. With an empty scene every sample
    // lands in both sums and the ratio is exactly 1 -- which is the property the
    // old formula could not have, at any orientation.
    const annualFactor = clearSkyWeight > 0
      ? Math.max(0, Math.min(1, receivedWeight / clearSkyWeight))
      : 1.0;
    panelShadeFactors[panel.id] = annualFactor;
  }

  // System-level weighted shade derate
  // Weight by wattage-equivalent (all panels equal if no wattage given)
  const allFactors = Object.values(panelShadeFactors);
  const avgFactor = allFactors.length > 0
    ? allFactors.reduce((a, b) => a + b, 0) / allFactors.length
    : 1.0;

  const systemShadeDeratePct = Math.round((1 - avgFactor) * 1000) / 10; // 1 decimal place

  // Per-panel derate is the same as shade factor (1 = no derate, 0.9 = 10% derate)
  const perPanelDerate: Record<string, number> = { ...panelShadeFactors };

  // Heatmap buckets
  const heatmapBuckets: ShadeHeatmapBucket[] = panels.map(panel => ({
    panelId: panel.id,
    shadeFactor: panelShadeFactors[panel.id] ?? 1.0,
    color: shadeFactorToColor(panelShadeFactors[panel.id] ?? 1.0),
  }));

  // Best/worst panels
  //
  // 🚨 SEEDED FROM THE FIRST PANEL, NOT FROM 1.0 AND 0.0.
  //
  // The comparison is strict, so seeding `worstShadeFactor = 1.0` meant that an
  // array where nothing is shaded — every factor exactly 1.0 — never satisfied
  // `factor < worstShadeFactor` and reported `worstPanelId: null`. A UI asking
  // "which module is worst affected" got no answer at all for the commonest
  // case there is: a clear roof.
  //
  // It was invisible while the factor was the mean cosine of incidence, because
  // that number is never exactly 1.0 and differs per panel, so some panel always
  // won. Correcting the factor to a true shade ratio exposed it. That is worth
  // recording: this was always broken, and only a second bug hid it.
  const entries = Object.entries(panelShadeFactors);
  let worstPanelId: string | null = entries.length ? entries[0][0] : null;
  let bestPanelId:  string | null = entries.length ? entries[0][0] : null;
  let worstShadeFactor = entries.length ? entries[0][1] : 0;
  let bestShadeFactor  = entries.length ? entries[0][1] : 1;

  for (const [id, factor] of entries) {
    if (factor < worstShadeFactor) { worstShadeFactor = factor; worstPanelId = id; }
    if (factor > bestShadeFactor)  { bestShadeFactor  = factor; bestPanelId  = id; }
  }

  return {
    panelShadeFactors,
    systemShadeDeratePct,
    perPanelDerate,
    heatmapBuckets,
    worstPanelId,
    bestPanelId,
    worstShadeFactor,
    bestShadeFactor,
  };
}

// ── Utility helpers ───────────────────────────────────────────────────────────

/**
 * Convert a shade factor (0..1) to a CSS heatmap color.
 * 0 (fully shaded) = deep red, 0.5 = orange/yellow, 1 (full sun) = bright green
 */
export function shadeFactorToColor(factor: number): string {
  const f = Math.max(0, Math.min(1, factor));

  if (f < 0.5) {
    // Red → yellow (shaded to medium)
    const t = f * 2; // 0..1
    const r = 220;
    const g = Math.round(t * 200);
    const b = 0;
    return `rgb(${r},${g},${b})`;
  } else {
    // Yellow → green (medium to full sun)
    const t = (f - 0.5) * 2; // 0..1
    const r = Math.round(220 * (1 - t));
    const g = 200;
    const b = 0;
    return `rgb(${r},${g},${b})`;
  }
}

/**
 * Classify a shade factor into a human-readable tier.
 */
export function classifyShade(factor: number): {
  label: string;
  severity: 'excellent' | 'good' | 'moderate' | 'significant' | 'severe';
} {
  if (factor >= 0.97) return { label: 'Minimal shade (<3%)', severity: 'excellent' };
  if (factor >= 0.93) return { label: 'Light shade (3–7%)',  severity: 'good'      };
  if (factor >= 0.85) return { label: 'Moderate shade (7–15%)', severity: 'moderate'  };
  if (factor >= 0.70) return { label: 'Significant shade (15–30%)', severity: 'significant' };
  return               { label: 'Severe shade (>30%)',     severity: 'severe'    };
}

/**
 * Apply per-panel shade derates to production calculations.
 * Returns adjusted system losses percentage (original + shade derate).
 *
 * Standard PVWatts system losses = 14% (includes soiling, wiring, etc.)
 * This function adds the shade derate on top.
 *
 * @param baseLossesPct  Baseline system losses (default 14)
 * @param shadeDeratePct Shade derate from analyzeShade (%)
 * @returns Effective total system losses %
 */
export function applyShadeToLosses(baseLossesPct: number, shadeDeratePct: number): number {
  // Combined via: (1 - shade) × (1 - baseline_losses)
  const baseRetention   = 1 - baseLossesPct   / 100;
  const shadeRetention  = 1 - shadeDeratePct  / 100;
  const combined        = 1 - (baseRetention * shadeRetention);
  return Math.min(50, Math.round(combined * 1000) / 10); // cap at 50% total
}

/**
 * Fast estimate of shading derate from site survey data.
 * Used when full sun-path analysis hasn't been run yet (e.g., initial sizing).
 *
 * @param roofCondition 'excellent' | 'good' | 'fair' | 'poor'
 * @param nearbyTrees   'none' | 'minimal' | 'moderate' | 'heavy'
 * @param tilt          Panel tilt degrees
 * @param azimuthOffset Degrees from south (abs value)
 */
export function estimateShadeDerateFromSurvey(
  roofCondition: 'excellent' | 'good' | 'fair' | 'poor' = 'good',
  nearbyTrees:   'none' | 'minimal' | 'moderate' | 'heavy' = 'none',
  tiltDeg  = 20,
  azimuthOffset = 0,
): number {
  // Base derate from roof condition
  const roofDerate: Record<string, number> = {
    excellent: 1,
    good:      3,
    fair:      6,
    poor:      12,
  };

  // Tree/obstruction derate
  const treeDerate: Record<string, number> = {
    none:     0,
    minimal:  3,
    moderate: 10,
    heavy:    22,
  };

  // Orientation penalty (panels facing away from south lose production)
  const azimuthPenalty = Math.max(0, (azimuthOffset - 30) * 0.1);

  // Flat roof penalty (low tilt gets less irradiance but also less self-shade)
  const tiltPenalty = tiltDeg < 5 ? 2 : 0;

  const total = (roofDerate[roofCondition] ?? 3)
    + (treeDerate[nearbyTrees] ?? 0)
    + azimuthPenalty
    + tiltPenalty;

  return Math.min(35, Math.round(total * 10) / 10);
}
