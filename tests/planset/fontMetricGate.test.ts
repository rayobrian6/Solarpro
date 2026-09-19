/**
 * tests/planset/fontMetricGate.test.ts
 *
 * THE CANONICAL FONT METRIC GATE — the rule, and the defect it was carrying.
 *
 * WHAT HAPPENED
 * -------------
 * The first pull request opened against master in 81 days ran the page-fit gate
 * on a bare-font Linux runner and failed:
 *
 *     EMBEDDED FONT METRICS WRONG — SolarPro Mono 400 (embedded)
 *       measured : 700px   expected : 672.11px (±1.5%)   deviation : 4.15%
 *
 * The font pack was not defective. All five faces match font-pack.manifest.json
 * by sha256 and byte length, every probe glyph is present, and the right face
 * rendered. The GATE was wrong: 571.73 / 672.11 were measured at 16px "on a
 * reference host carrying genuine Arial and Courier New", which silently baked
 * in the assumption that the renderer reports SUBPIXEL advances.
 *
 * Bare-font Linux — which is both CI and the production Lambda renderer —
 * quantizes each glyph advance to a whole pixel. For a FIXED-PITCH face that
 * error is multiplied by every character; for a proportional one the signed
 * errors cancel. That asymmetry is the whole signature, and it is why Sans
 * passed while Mono failed:
 *
 *     Liberation Mono : 1229/2048 em = 9.6015625px @16px, every glyph
 *       subpixel  : 9.6015625 × 70 = 672.109375   (passes)
 *       quantized : 10        × 70 = 700         (+4.15%, fails)
 *     Liberation Sans : proportional
 *       subpixel  : 571.734375   quantized : 571  (−0.13%, passes either way)
 *
 * THE FIX, AND WHY IT IS NOT "ADJUSTING THE NUMBER UNTIL IT PASSES"
 * ----------------------------------------------------------------
 * The probe now runs at the em size, where advance_px = advance_units / upm ×
 * upm = advance_units — an integer by construction. Rounding an integer is the
 * identity, so a quantizing renderer and a subpixel one return the SAME number.
 * The expectations are summed from the shipped WOFF2 hmtx tables, not measured
 * on anyone's machine. Confirmed against a real Chromium: 86030 and 73182,
 * exactly.
 *
 * 🚨 The in-repo warning "Do NOT adjust any sheet layout on the strength of a
 * measurement taken here" is correct and is obeyed: no sheet, column width or
 * font-size moved. Only the gate's measurement basis changed.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FONT_METRIC_PROBE,
  FONT_METRIC_PROBE_PX,
  CANONICAL_ADVANCE_SUM,
  GATED_FAMILIES,
  FONT_METRIC_TOLERANCE_PCT,
  evaluateFontMetric,
  evaluateFontMetrics,
  formatFontMetricFailure,
} from '@/lib/permit/fonts/fontMetricGate.mjs';

/** Liberation Mono is fixed-pitch: every glyph advances 1229/2048 em. */
const MONO_ADVANCE_UNITS = 1229;
const UPM = 2048;

describe('the probe', () => {
  it('is 70 ASCII characters', () => {
    expect(FONT_METRIC_PROBE).toHaveLength(70);
    expect(/^[\x20-\x7E]+$/.test(FONT_METRIC_PROBE)).toBe(true);
  });

  it('measures at the em size, where advances are integers by construction', () => {
    expect(FONT_METRIC_PROBE_PX).toBe(UPM);
  });

  it('expects the exact byte-derived advance sums', () => {
    // Mono is fixed-pitch, so its expectation is derivable in one line.
    expect(CANONICAL_ADVANCE_SUM['SolarPro Mono']).toBe(FONT_METRIC_PROBE.length * MONO_ADVANCE_UNITS);
    expect(CANONICAL_ADVANCE_SUM['SolarPro Mono']).toBe(86030);
    expect(CANONICAL_ADVANCE_SUM['SolarPro Sans']).toBe(73182);
    // Both are integers — that is the property the whole fix rests on.
    for (const f of GATED_FAMILIES) expect(Number.isInteger(CANONICAL_ADVANCE_SUM[f])).toBe(true);
  });
});

describe('THE DEFECT, reproduced as arithmetic', () => {
  /** A renderer that rounds each glyph advance to a whole pixel. */
  const quantizedSum = (advanceUnits: number, n: number, px: number) =>
    Math.round((advanceUnits / UPM) * px) * n;
  /** A renderer that keeps subpixel advances. */
  const subpixelSum = (advanceUnits: number, n: number, px: number) =>
    (advanceUnits / UPM) * px * n;

  const N = 70;

  it('at 16px, the two renderers disagree by exactly the reported 4.15%', () => {
    const subpixel = subpixelSum(MONO_ADVANCE_UNITS, N, 16);
    const quantized = quantizedSum(MONO_ADVANCE_UNITS, N, 16);

    expect(subpixel).toBeCloseTo(672.109375, 6);  // the OLD expectation
    expect(quantized).toBe(700);                   // what CI actually measured

    const deviationPct = ((quantized - 672.11) / 672.11) * 100;
    expect(deviationPct).toBeCloseTo(4.15, 2);     // the reported deviation
    // ...and 4.15% is outside the 1.5% gate, so a perfect font pack failed.
    expect(Math.abs(deviationPct)).toBeGreaterThan(FONT_METRIC_TOLERANCE_PCT);
  });

  it('at the em size, the two renderers agree EXACTLY — quantization is a no-op', () => {
    const subpixel = subpixelSum(MONO_ADVANCE_UNITS, N, FONT_METRIC_PROBE_PX);
    const quantized = quantizedSum(MONO_ADVANCE_UNITS, N, FONT_METRIC_PROBE_PX);

    expect(quantized).toBe(subpixel);
    expect(quantized).toBe(CANONICAL_ADVANCE_SUM['SolarPro Mono']);
    // The gate passes on BOTH kinds of renderer, which is the entire point.
    expect(evaluateFontMetric('SolarPro Mono', quantized).ok).toBe(true);
    expect(evaluateFontMetric('SolarPro Mono', subpixel).ok).toBe(true);
  });

  it('the old 16px basis would still fail a quantizing renderer today', () => {
    // Guards against anyone "restoring" the old constants.
    const OLD_EXPECTED = 672.11;
    const quantized = quantizedSum(MONO_ADVANCE_UNITS, N, 16);
    const off = Math.abs((quantized - OLD_EXPECTED) / OLD_EXPECTED) * 100;
    expect(off).toBeGreaterThan(FONT_METRIC_TOLERANCE_PCT);
  });
});

describe('the gate still has teeth', () => {
  it('accepts the exact canonical measurement', () => {
    const v = evaluateFontMetrics({
      'SolarPro Sans': CANONICAL_ADVANCE_SUM['SolarPro Sans'],
      'SolarPro Mono': CANONICAL_ADVANCE_SUM['SolarPro Mono'],
    });
    expect(v.ok).toBe(true);
  });

  it('REFUSES a genuinely different face', () => {
    // DejaVu Sans (proportional) standing in for Mono — the substitution the
    // gate exists to catch. ~12% wider.
    const v = evaluateFontMetrics({
      'SolarPro Sans': CANONICAL_ADVANCE_SUM['SolarPro Sans'],
      'SolarPro Mono': Math.round(CANONICAL_ADVANCE_SUM['SolarPro Mono'] * 1.12),
    });
    expect(v.ok).toBe(false);
    expect(v.results.find(r => r.family === 'SolarPro Mono')!.ok).toBe(false);
  });

  it('refuses a fallback to the generic default', () => {
    // A face that never loaded measures as the host default. On the CI runner
    // that read 70166 at the em size for serif.
    expect(evaluateFontMetrics({
      'SolarPro Sans': 70166,
      'SolarPro Mono': 70166,
    }).ok).toBe(false);
  });

  it('holds the tolerance at 1.5% and refuses just outside it', () => {
    expect(FONT_METRIC_TOLERANCE_PCT).toBe(1.5);
    const mono = CANONICAL_ADVANCE_SUM['SolarPro Mono'];
    expect(evaluateFontMetric('SolarPro Mono', mono * 1.014).ok).toBe(true);
    expect(evaluateFontMetric('SolarPro Mono', mono * 1.016).ok).toBe(false);
  });

  it('throws rather than passing a family it has no canonical metric for', () => {
    expect(() => evaluateFontMetric('Comic Sans MS', 1000)).toThrow(/no canonical metric/);
  });
});

describe('the failure message', () => {
  it('prints EVERY gated face, passing ones included', () => {
    // The original message named only the failing face. Seeing Sans pass next
    // to Mono failing is what identifies quantization rather than a bad embed —
    // it is the difference between a one-line fix and a two-hour hunt.
    const v = evaluateFontMetrics({
      'SolarPro Sans': CANONICAL_ADVANCE_SUM['SolarPro Sans'],
      'SolarPro Mono': 700 * (FONT_METRIC_PROBE_PX / 16),
    });
    const msg = formatFontMetricFailure({
      results: v.results,
      missingFaces: [],
      status: 'loaded',
      size: 5,
      loaded: [],
      genericSerifPx: 70166,
      genericMonospacePx: 86310,
    });
    expect(msg).toContain('SolarPro Sans');
    expect(msg).toContain('SolarPro Mono');
    expect(msg).toContain('ok');
    expect(msg).toContain('FAILED');
    expect(msg).toContain('em size');
  });
});

describe('the constants stay tied to the shipped bytes', () => {
  it('every face still matches font-pack.manifest.json by sha256 and length', () => {
    // CANONICAL_ADVANCE_SUM is summed from these exact files. If the pack is
    // ever rebuilt or re-subset, this fails FIRST and says so — rather than the
    // metric gate failing later and being mistaken for a renderer problem again.
    const dir = path.join(process.cwd(), 'lib/permit/fonts');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'font-pack.manifest.json'), 'utf8'));
    for (const face of manifest.faces) {
      const bytes = fs.readFileSync(path.join(dir, face.file));
      expect(bytes.length, `${face.file} byte length`).toBe(face.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `${face.file} sha256`).toBe(face.sha256);
    }
  });

  it('both gated families are declared metric-compatible in the manifest', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'lib/permit/fonts/font-pack.manifest.json'), 'utf8'),
    );
    for (const f of GATED_FAMILIES) expect(manifest.metricCompatibility[f]).toBeTruthy();
  });
});

describe('one definition of the rule', () => {
  it('neither call site re-declares the constants or the tolerance', () => {
    // The live PDF export path (lib/pdf/generatePdf.ts) and the page-fit probe
    // (scripts/lib/pagination-probe.mjs) each carried a hand-written copy, and
    // BOTH copies carried the same wrong assumption. That is the shape of
    // defect this repo keeps getting burned by: one fact, two implementations.
    // Strip comments first: both files DISCUSS the old constants at length, on
    // purpose, so the next reader understands why the basis changed. What must
    // not come back is an executable copy of them.
    const codeOf = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const file of ['lib/pdf/generatePdf.ts', 'scripts/lib/pagination-probe.mjs']) {
      const src = codeOf(file);
      expect(src, `${file} must not re-inline the old 16px constants`).not.toMatch(/\b671\.\d|\b672\.11\b/);
      expect(src, `${file} must not re-inline the old Sans constant`).not.toMatch(/\b571\.73\b/);
      expect(src, `${file} must not re-declare the tolerance`).not.toMatch(/TOL\s*=\s*0\.015/);
      // the import survives comment-stripping, so assert it on the raw source
      const raw = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(raw, `${file} must import the shared gate`).toMatch(/fontMetricGate\.mjs/);
    }
  });
});
