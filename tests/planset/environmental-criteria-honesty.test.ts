// ═══════════════════════════════════════════════════════════════════════════
// D2 / D6 / D7 — a value nobody established may not print as a number.
//
// Every consumer tested the VALUE and never the BASIS:
//     _proj.groundSnowPsf != null ? String(_proj.groundSnowPsf) : '—'
// `groundSnowPsf` is 0 when nothing was established — not null — so the sheets
// printed `0 psf` as the answer, while the authority said `snowLoadBasis:
// 'not-established'`. Three printed consequences, all now closed:
//   1. `Ground Snow Load (pg) | 0 psf` on an Illinois project (~20 psf real)
//   2. `Snow loading is not a controlling factor` — a conclusion from a non-value
//   3. `Ground Snow Load Verified | PASS`, because `0 >= 0`
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isGroundSnowEstablished, groundSnowLabel, roofSnowLabel, riskCategoryLabel,
  snowNarrativeSentence, ENV_NOT_ESTABLISHED,
} from '@/lib/permit/utils/environmentalDisplay';

const NOT_EST = { groundSnowPsf: 0, environmentalLoadAuthority: { snowLoadBasis: 'not-established', snowLoadSource: null } };
const EST = { groundSnowPsf: 20, roofSnowPsf: 14, environmentalLoadAuthority: { snowLoadBasis: 'asce-hazard-tool', snowLoadSource: 'ASCE 7 Hazard Tool' } };

describe('the basis decides, never the value', () => {
  it('a zero with basis not-established is NOT established', () => {
    // The exact live Braidon shape.
    expect(isGroundSnowEstablished(NOT_EST)).toBe(false);
    expect(groundSnowLabel(NOT_EST)).toBe(ENV_NOT_ESTABLISHED);
    expect(groundSnowLabel(NOT_EST)).not.toContain('0');
  });

  it('a real value with a stated basis prints as a value', () => {
    expect(isGroundSnowEstablished(EST)).toBe(true);
    expect(groundSnowLabel(EST)).toBe('20 psf');
    expect(roofSnowLabel(EST)).toBe('14.0 psf');
  });

  it('a legacy row with a real figure but no basis field still counts', () => {
    // Being strict here would have erased genuine data to fix a fabrication.
    expect(isGroundSnowEstablished({ groundSnowPsf: 25 })).toBe(true);
    expect(groundSnowLabel({ groundSnowPsf: 25 })).toBe('25 psf');
  });

  it('roof snow cannot be established when its own input is not', () => {
    expect(roofSnowLabel({ ...NOT_EST, roofSnowPsf: 0 })).toBe(ENV_NOT_ESTABLISHED);
  });

  it('risk category is never inferred to fill the blank', () => {
    // ASCE 7 Table 1.5-1 is an engineering determination about occupancy and
    // consequence of failure. Guessing "II" because most houses are II would
    // put the renderer's judgement on a stamped sheet.
    for (const v of [null, undefined, '', '  ', 'unknown', 'UNKNOWN']) {
      expect(riskCategoryLabel({ riskCategory: v as never })).toBe(ENV_NOT_ESTABLISHED);
    }
    expect(riskCategoryLabel({ riskCategory: 'II' })).toBe('II');
  });

  it('the snow narrative is OMITTED rather than concluding non-controlling', () => {
    expect(snowNarrativeSentence(NOT_EST, () => 'CONCLUSION')).toBeNull();
    expect(snowNarrativeSentence(EST, g => `at ${g} psf`)).toBe('at 20 psf');
  });
});

describe('the rendered package carries no fabricated criteria', () => {
  const html = (() => { try { return readFileSync(join(process.cwd(), '_tmp_prod.html'), 'utf8'); } catch { return null; } })();
  const text = html ? html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ') : '';

  it('never asserts snow is non-controlling', () => {
    if (!html) return;
    expect(text).not.toMatch(/not a controlling factor/i);
  });

  it('prints no unit with no value, and no NaN', () => {
    if (!html) return;
    expect(text.match(/[\u2014-]\s+(lbs|psf|ft|in|mph)\b/g) ?? []).toEqual([]);
    expect(text).not.toMatch(/\bNaN\b/);
    expect(text).not.toMatch(/NOT ESTABLISHED\s+(psf|lbs)/i);
  });

  it('leaves no blank Risk Category', () => {
    if (!html) return;
    expect(text).not.toMatch(/Risk Category\s*[\u2014-]\s/);
  });
});
