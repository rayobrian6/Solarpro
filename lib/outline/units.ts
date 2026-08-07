// lib/outline/units.ts
// Imperial / metric conversion for the design outline tool.
//
// Internal storage is ALWAYS meters. The UI reads the user's `units`
// preference and converts to feet (or stays in meters) for display
// and input. We never store feet in the OutlineDocument.
//
// Pitch is always stored as a ratio (rise/run) where rise and run are
// unitless; display is "X:12" (US construction convention).

export type Units = 'metric' | 'imperial';

export const FT_PER_M = 3.28084;
export const IN_PER_FT = 12;

/**
 * Format a length in meters as a display string in the user's units.
 * Imperial: "8.5 ft" (decimal feet, 1 decimal). Metric: "2.6 m"
 * (1 decimal). Long imperial lengths (>30 ft) use feet; short ones
 * (<3 ft) keep one decimal.
 */
export function formatLength(meters: number, units: Units): string {
  if (units === 'metric') {
    return `${meters.toFixed(1)} m`;
  }
  // Imperial — always show feet with 1 decimal, even for sub-foot
  // lengths. The user can do the conversion in their head.
  const ft = meters * FT_PER_M;
  return `${ft.toFixed(1)} ft`;
}

/**
 * Parse a user-entered length string back to meters. Accepts:
 *   "8.5"   "8.5 ft"   "8.5ft"   "8.5'"   "8 ft"   "2' 6""   "26"
 * Returns null if the input is unparseable.
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim();
  if (s === '') return null;
  if (units === 'metric') {
    // Accept "2.5", "2.5m", "2.5 m"
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(m|meters?)?$/i);
    if (m) return Number(m[1]);
    // Also accept "8.5 ft" / "8.5ft" in metric mode (user might paste imperial)
    const ft = s.match(/^(-?\d+(?:\.\d+)?)\s*(ft|feet|')?$/i);
    if (ft) return Number(ft[1]) / FT_PER_M;
    return null;
  }
  // Imperial — "8.5", "8.5 ft", "8.5ft", "8.5'", "2' 6\"", "26 in", "26in"
  // "2' 6"" format: 2 feet 6 inches
  const ftInMatch = s.match(/^(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"/);
  if (ftInMatch) {
    const ft = Number(ftInMatch[1]);
    const inches = Number(ftInMatch[2]);
    return (ft + inches / IN_PER_FT) / FT_PER_M;
  }
  // "8.5 ft" / "8.5ft" / "8.5'"
  const ftMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*(ft|feet|')?$/i);
  if (ftMatch) return Number(ftMatch[1]) / FT_PER_M;
  // "26 in" / "26in" / "26\""
  const inMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*(in|inch|inches|")?$/i);
  if (inMatch && /in|inch|"/i.test(s)) return Number(inMatch[1]) / IN_PER_FT / FT_PER_M;
  return null;
}

/**
 * Format a pitch as "rise:12" (US construction convention).
 * Rounds the rise to the nearest integer for display.
 */
export function formatPitch(rise: number, run: number = 12): string {
  // Normalise so run = 12
  const scaled = (rise / run) * 12;
  return `${scaled.toFixed(1)}:12`;
}

/**
 * Parse a pitch string like "6:12", "6/12", "8.5:12", "0.5/12".
 * Returns the ratio (rise/run, unitless) or null if unparseable.
 */
export function parsePitch(input: string): { rise: number; run: number } | null {
  const s = input.trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const rise = Number(m[1]);
  const run = Number(m[2]);
  if (run === 0) return null;
  return { rise, run };
}

/**
 * Convert a pitch ratio to an angle in radians.
 */
export function pitchToAngle(rise: number, run: number): number {
  return Math.atan(rise / run);
}

/**
 * Convert a pitch ratio to a height multiplier: for a given horizontal
 * run, the rise is `run * (rise/run_ratio)`.
 * Convenience: height per unit horizontal run.
 */
export function pitchSlope(rise: number, run: number): number {
  return rise / run; // = tan(angle)
}
