/**
 * lib/3d/lidar/colorRamp.ts
 *
 * Aurora parity: rainbow elevation ramp (blue = low → red = high).
 *
 * Pure functions. No Cesium. Returns plain {r,g,b,a} objects in 0..1 so
 * the same code drives both the Cesium `Color` and the test assertions.
 *
 * The ramp is the standard MATLAB "jet" colormap, which is what Aurora 2017
 * uses. We compute it in HSL space (H from 240° to 0° as t goes 0→1) for
 * smooth, well-saturated transitions.
 */

/** A color in 0..1 RGBA. */
export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Convert HSL (0..1 hue, 0..1 sat, 0..1 light) to RGBA (0..1 each).
 * Standard formula, alpha=1.
 */
export function hslToRgba(h: number, s: number, l: number, a = 1): RGBAColor {
  const H = ((h % 1) + 1) % 1;          // wrap to [0,1)
  const S = Math.min(1, Math.max(0, s));
  const L = Math.min(1, Math.max(0, l));
  if (S === 0) return { r: L, g: L, b: L, a };

  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const hk = (t: number) => {
    let T = t;
    if (T < 0) T += 1;
    if (T > 1) T -= 1;
    if (T < 1 / 6) return p + (q - p) * 6 * T;
    if (T < 1 / 2) return q;
    if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
    return p;
  };
  return { r: hk(H + 1 / 3), g: hk(H), b: hk(H - 1 / 3), a };
}

/**
 * Aurora's rainbow elevation ramp. `t` is the normalized elevation:
 *   0   → blue   (240° hue)
 *   0.5 → green  (120° hue)
 *   1   → red    (0° hue)
 *
 * Saturation = 1, lightness = 0.5 (vivid, true-to-Aurora).
 */
export function elevationColor(t: number): RGBAColor {
  const T = Math.min(1, Math.max(0, t));
  // hue goes from 240° (blue) to 0° (red) as t goes 0→1
  // in normalized 0..1, that's 2/3 → 0
  const hue = (2 / 3) * (1 - T);
  return hslToRgba(hue, 1, 0.5, 1);
}

/**
 * Same as `elevationColor` but with a custom alpha. Used by the textured
 * toggle (alpha = 0.4 over satellite) vs raw (alpha = 0.85).
 */
export function elevationColorAlpha(t: number, alpha: number): RGBAColor {
  return { ...elevationColor(t), a: Math.min(1, Math.max(0, alpha)) };
}

/**
 * Given a value `v` in the range [vMin, vMax], return its normalized
 * position `t` in [0, 1]. If vMin === vMax, returns 0.5 (midpoint of
 * the ramp, neutral green).
 */
export function normalizeElevation(v: number, vMin: number, vMax: number): number {
  if (!isFinite(v) || !isFinite(vMin) || !isFinite(vMax)) return 0.5;
  if (vMax === vMin) return 0.5;
  return Math.min(1, Math.max(0, (v - vMin) / (vMax - vMin)));
}
