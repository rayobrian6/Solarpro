// ═══════════════════════════════════════════════════════════════════════════
// THE CANONICAL FONT METRIC GATE — one definition, two call sites.
//
// WHAT THIS GATE IS FOR
// ---------------------
// The planset embeds its own faces (see fontPack.ts). The gate proves the
// EMBEDDED bytes are what actually rendered, rather than a host face that
// fontconfig substituted under the same name. `document.fonts.ready` is not
// sufficient, and neither is `document.fonts.check()` — per spec, check()
// answers "can this be rendered with available fonts", INCLUDING fallback, so
// it returns true for a family that does not exist at all. Measuring advance
// widths is therefore the only load-bearing half of this gate.
//
// 🚨 WHY THE PROBE RUNS AT THE EM SIZE AND NOT AT 16px
// ----------------------------------------------------
// It used to measure at 16px against 571.73 / 672.11. Those constants are
// correct LINEAR metrics, but they silently assume the renderer reports
// SUBPIXEL advances. A renderer that quantizes each glyph advance to a whole
// pixel — which bare-font Linux does, and which is what both CI and the
// production Lambda renderer are — produces a different number, and for a
// FIXED-PITCH face the error is multiplied by every character:
//
//   Liberation Mono advance = 1229/2048 em = 9.6015625px at 16px
//     subpixel : 9.6015625 x 70 = 672.109375   -> matches 672.11, passes
//     quantized:        10      x 70 = 700     -> +4.15%, FAILS
//
//   Liberation Sans is proportional, so its 70 signed rounding errors cancel
//   (571.73 -> 571.00, -0.13%) and Sans passed while Mono failed. That
//   asymmetry is the signature of quantization, not of a bad font.
//
// Measuring at unitsPerEm makes every advance an exact integer by construction
// (advance_px = advance_units / upm * upm = advance_units), so rounding cannot
// change the result and the same number comes back from a quantizing renderer
// and a subpixel one. The expectations below are derived from the shipped
// WOFF2 bytes, not measured on anyone's machine.
//
// The font pack was never the problem: all five faces match
// font-pack.manifest.json sha256 and byte length, every probe glyph is
// present, and the right face was winning. Do not rebuild or re-subset it on
// the strength of a failure here, and do NOT widen the tolerance — 1.5% -> the
// 4.15% needed to pass would turn the gate off entirely.
// ═══════════════════════════════════════════════════════════════════════════

/** The probe string. 70 characters, all ASCII, all present in both faces —
 *  verified against the cmap of the shipped WOFF2s. The M/W/i/l runs make a
 *  proportional substitute diverge sharply from a metric-compatible one. */
export const FONT_METRIC_PROBE =
  'MMMMMMWWWWiiiill1234567890 The quick brown fox jumps over the lazy dog';

/** Measure at the em size, where advances are integers by construction.
 *  Both shipped faces are unitsPerEm = 2048. */
export const FONT_METRIC_PROBE_PX = 2048;

/**
 * Expected advance-width sum of FONT_METRIC_PROBE, in font units — which at
 * FONT_METRIC_PROBE_PX equals the expected pixel width exactly.
 *
 * Derived from the shipped bytes (sum of hmtx advances over the probe's
 * codepoints), NOT measured in a browser:
 *   SolarProSans-Regular.woff2  upm 2048, sum 73182  (= 571.734375px at 16px)
 *   SolarProMono-Regular.woff2  upm 2048, sum 86030  (= 672.109375px at 16px,
 *                                                     70 glyphs x 1229 each)
 *
 * 🚨 These change only if the font pack itself is rebuilt. If a failure here
 * reports a number far from these, the face that rendered is not the face we
 * shipped — which is exactly what this gate is for.
 */
export const CANONICAL_ADVANCE_SUM = Object.freeze({
  'SolarPro Sans': 73182,
  'SolarPro Mono': 86030,
});

/** The faces whose metrics are asserted. */
export const GATED_FAMILIES = Object.freeze(['SolarPro Sans', 'SolarPro Mono']);

/** Every canonical face that must be LOADED, as document.fonts.check() strings.
 *  Weak on its own (see the header) but still catches an absent @font-face. */
export const REQUIRED_FONT_FACES = Object.freeze([
  '400 16px "SolarPro Sans"',
  '700 16px "SolarPro Sans"',
  '400 16px "SolarPro Mono"',
  '700 16px "SolarPro Mono"',
  '400 16px "SolarPro Symbols"',
]);

/** Allowed deviation. Metric-compatible families reproduce advance widths
 *  exactly; this absorbs rasteriser noise without admitting a different face. */
export const FONT_METRIC_TOLERANCE_PCT = 1.5;

/**
 * Measure the probe in each gated family. PASSED TO page.evaluate — it must be
 * self-contained, because a closure does not survive serialisation into the
 * page. Call as: page.evaluate(measureAdvanceSumsInPage, [probe, px, families])
 */
export function measureAdvanceSumsInPage([probe, px, families]) {
  const ctx = document.createElement('canvas').getContext('2d');
  const widthIn = (stack) => { ctx.font = `${px}px ${stack}`; return ctx.measureText(probe).width; };
  const out = { families: {} };
  for (const fam of families) out.families[fam] = widthIn(`"${fam}"`);
  // Kept for the failure message: what the bare generics measure on this host,
  // which is how you tell "fell back" from "wrong face" at a glance.
  out.genericSerifPx = widthIn('serif');
  out.genericMonospacePx = widthIn('monospace');
  const d = document;
  out.status = d.fonts.status;
  out.size = d.fonts.size;
  out.loaded = [...d.fonts].map(f => `${f.family}/${f.weight}/${f.status}`);
  return out;
}

/**
 * Pure verdict for one family. `measuredPx` is the advance sum measured at
 * FONT_METRIC_PROBE_PX.
 */
export function evaluateFontMetric(family, measuredPx) {
  const expectedPx = CANONICAL_ADVANCE_SUM[family];
  if (expectedPx === undefined) throw new Error(`fontMetricGate: no canonical metric for "${family}"`);
  const deltaPct = ((measuredPx - expectedPx) / expectedPx) * 100;
  return {
    family,
    measuredPx,
    expectedPx,
    deltaPct: +deltaPct.toFixed(4),
    ok: Math.abs(deltaPct) <= FONT_METRIC_TOLERANCE_PCT,
  };
}

/** Pure verdict for the whole gate. `families` is {family: measuredPx}. */
export function evaluateFontMetrics(families) {
  const results = GATED_FAMILIES.map(f => evaluateFontMetric(f, families[f]));
  return { ok: results.every(r => r.ok), results };
}

/**
 * The failure message. Prints EVERY gated face, passing ones included — the
 * original message named only the first failure, and seeing Sans pass next to
 * Mono failing is what identifies quantization rather than a bad embed.
 */
export function formatFontMetricFailure({ results, missingFaces = [], status, size, loaded = [], genericSerifPx, genericMonospacePx }) {
  const lines = results.map(r =>
    `  ${r.family.padEnd(16)} : ${r.measuredPx}px (expected ${r.expectedPx} ±${FONT_METRIC_TOLERANCE_PCT}%, ${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct}%) ${r.ok ? 'ok' : '<-- FAILED'}`,
  );
  return [
    `  probe            : ${FONT_METRIC_PROBE.length} chars at ${FONT_METRIC_PROBE_PX}px (em size — advances are integers, so a`,
    '                     renderer that quantizes them cannot change this number)',
    `  faces not loaded : ${missingFaces.join(', ') || 'none'}`,
    `  fonts.status     : ${status} (${size} faces)`,
    ...lines,
    `  generic serif    : ${genericSerifPx}px`,
    `  generic monospace: ${genericMonospacePx}px`,
    loaded.length ? `  registered       : ${loaded.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}
