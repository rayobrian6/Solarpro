/**
 * tests/pitchIsOneNumber.test.ts
 *
 * ONE PITCH, ONE FORMULA — AND TWO PLACES THAT DISAGREED WITH IT.
 *
 * Rise over 12 of run is `12·tan(θ)`. It is not linear in degrees and it does
 * not snap to builders' fractions. `lib/3d/pitchFormat.ts` says both of those
 * things in its own header. Two live screens said otherwise:
 *
 *   app/engineering/page.tsx   `Math.round(deg * 12 / 90 * 12)`
 *       Degrees interpolated LINEARLY onto a rise. Agrees with the real
 *       formula nowhere except zero. A true 4:12 (18.435°) printed as 29:12;
 *       a 12:12 (45°) printed as 72:12, which is 80.5° — very nearly a wall.
 *       This is a row on the readiness checklist an installer reads.
 *
 *   components/design/DesignStudio.tsx   `Math.round(tan(θ)·12)`
 *       Right formula, then snapped. 25° displayed "6/12", but 6:12 is
 *       26.565°, so the label named a different roof from the one the slider
 *       was building.
 *
 * Both now render through the authority. These tests pin the arithmetic that
 * makes the old code wrong, so a reintroduction fails rather than merely
 * looking plausible.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import {
  riseOver12, degFromRise12, formatRise12, parsePitchInput, parseRiseOver12Input,
  PITCH_RUN, MAX_PITCH_DEG,
} from '../lib/3d/pitchFormat';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the arithmetic the broken screens got wrong', () => {
  // The builder's fractions every roofer names, and their exact degrees.
  const KNOWN: Array<[rise: number, deg: number]> = [
    [3, 14.036], [4, 18.435], [5, 22.620], [6, 26.565], [8, 33.690], [12, 45],
  ];

  it.each(KNOWN)('%d:12 is %s degrees, both ways', (rise, deg) => {
    expect(degFromRise12(rise)).toBeCloseTo(deg, 2);
    expect(riseOver12(deg)).toBeCloseTo(rise, 2);
  });

  it('the LINEAR formula is wrong everywhere except zero — that is the defect', () => {
    const linear = (deg: number) => Math.round(deg * 12 / 90 * 12);
    expect(linear(0)).toBe(0);                       // the only agreement
    for (const [rise, deg] of KNOWN) {
      expect(linear(deg), String(deg) + ' must NOT linearise to ' + String(rise)).not.toBe(rise);
    }
    // The two headline cases, named exactly, so the numbers in the comment
    // above are checked rather than trusted.
    expect(linear(18.435)).toBe(29);   // a 4:12 roof, printed as 29:12
    expect(linear(45)).toBe(72);       // a 12:12 roof, printed as 72:12
    expect(degFromRise12(72)).toBeGreaterThan(80);   // …which is nearly a wall
  });

  it('SNAPPING makes the label name a different roof — that is the other defect', () => {
    const snapped = (deg: number) => Math.round(riseOver12(deg));
    expect(snapped(25)).toBe(6);                      // 25° displayed as "6/12"
    expect(degFromRise12(6)).toBeCloseTo(26.565, 2);  // but 6:12 is 26.565°
    expect(formatRise12(25)).toBe('5.6:12');          // the authority refuses to snap
    expect(formatRise12(22)).toBe('4.8:12');          // not "5:12"
  });

  it('formatRise12 prints a whole number cleanly and a measured one honestly', () => {
    expect(formatRise12(26.565)).toBe('6:12');
    expect(formatRise12(45)).toBe('12:12');
    expect(formatRise12(25.1)).toBe('5.6:12');
    expect(formatRise12(null)).toBe('—');
    expect(formatRise12(Number.NaN)).toBe('—');
  });
});

describe('parseRiseOver12Input — a bare number means rise, because of the box it is in', () => {
  it('a bare number is a rise over 12, not degrees', () => {
    const r = parseRiseOver12Input('6');
    expect(r.ok).toBe(true);
    expect(r.as).toBe('rise-over-run');
    expect(r.pitchDeg).toBeCloseTo(26.565, 2);
    // The SAME keystroke in the degrees box is six degrees. Both are correct
    // for their box; this is the whole reason the function exists.
    const d = parsePitchInput('6');
    expect(d.ok).toBe(true);
    expect(d.as).toBe('degrees');
    expect(d.pitchDeg).toBe(6);
    expect(Math.abs(r.pitchDeg - d.pitchDeg)).toBeGreaterThan(20);
  });

  it('explicit notation still wins — the user said what they meant', () => {
    expect(parseRiseOver12Input('6:12').pitchDeg).toBeCloseTo(26.565, 2);
    expect(parseRiseOver12Input('6/12').pitchDeg).toBeCloseTo(26.565, 2);
    expect(parseRiseOver12Input('6 in 12').pitchDeg).toBeCloseTo(26.565, 2);
    // A degree mark means degrees even here.
    const deg = parseRiseOver12Input('26.6°');
    expect(deg.as).toBe('degrees');
    expect(deg.pitchDeg).toBeCloseTo(26.6, 2);
  });

  it('a rise against a non-twelve run is honoured, not rewritten', () => {
    expect(parseRiseOver12Input('3:6').pitchDeg).toBeCloseTo(26.565, 2);
  });

  it('it refuses what it cannot read, with a reason a person can act on', () => {
    for (const bad of ['', '   ', 'steep', 'six twelve']) {
      const r = parseRiseOver12Input(bad);
      expect(r.ok, 'this must be refused: ' + JSON.stringify(bad)).toBe(false);
      expect(r.reason.length).toBeGreaterThan(0);
    }
    // Past the editor's limit, refused rather than silently clamped.
    const tooSteep = parseRiseOver12Input(String(PITCH_RUN * 4));
    expect(tooSteep.ok).toBe(false);
    expect(tooSteep.reason).toMatch(new RegExp(String(MAX_PITCH_DEG)));
  });

  it('round-trips whatever it accepts', () => {
    for (const s of ['4', '6', '9.5', '6:12', '4/12']) {
      const p = parseRiseOver12Input(s);
      expect(p.ok, s).toBe(true);
      expect(riseOver12(p.pitchDeg)).toBeCloseTo(parseFloat(s), 5);
    }
  });
});

describe('no screen carries its own copy of the formula', () => {
  const FILES = [
    'app/engineering/page.tsx',
    'components/design/DesignStudio.tsx',
    'components/3d/SolarEngine3D.tsx',
    'components/3d/inspector/SectionInspector.tsx',
  ];

  // 🚨 CODE ONLY. The fixes above each carry a comment QUOTING the formula they
  // replaced, so a raw-text guard matches its own explanation and fails on the
  // fixed file. That is not a false alarm to be silenced by softening the
  // pattern — it is the reason to read code as code.
  const code = (f: string) => stripComments(read(f));

  it.each(FILES)('%s does not linearise degrees into a rise', (f) => {
    const src = code(f);
    expect(src, 'the linear formula is not a pitch').not.toMatch(/\*\s*12\s*\/\s*90\s*\*\s*12/);
  });

  it.each(FILES)('%s does not round a rise to a builders fraction', (f) => {
    const src = code(f);
    // Math.round( … tan( … ) … * 12 ) in any spacing.
    expect(src, 'snapping makes the label name a different roof')
      .not.toMatch(/Math\.round\s*\([^)]*Math\.tan[^;]{0,80}?\*\s*12\s*\)/);
  });

  it('the fixed rows actually call the authority', () => {
    expect(read('app/engineering/page.tsx'))
      .toMatch(/formatRise12\(config\.roofPitch\)/);
    expect(read('components/design/DesignStudio.tsx'))
      .toMatch(/formatRise12\(pendingPlanePitch\)/);
    for (const f of ['app/engineering/page.tsx', 'components/design/DesignStudio.tsx']) {
      expect(read(f), f + ' must import the authority')
        .toMatch(/from '@\/lib\/3d\/pitchFormat'/);
    }
  });
});

describe('the new-roof control speaks rise:run, like the inspector already did', () => {
  const SRC = read('components/3d/SolarEngine3D.tsx');

  it('offers a rise:run box beside the degrees box', () => {
    expect(SRC).toMatch(/data-testid="new-roof-pitch-rise"/);
    expect(SRC, 'it must be labelled, or a bare number is ambiguous')
      .toMatch(/Rise : run/);
  });

  it('it commits into the SAME canonical degrees state, storing no rise', () => {
    const i = SRC.indexOf('data-testid="new-roof-pitch-rise"');
    expect(i).toBeGreaterThan(-1);
    const box = SRC.slice(i, i + 2_000);
    expect(box, 'it must parse through the authority').toMatch(/parseRiseOver12Input\(raw\)/);
    expect(box, 'it must write the one canonical pitch').toMatch(/setRoofPitchDeg\(/);
    expect(box, 'it must honour the same clamp as the degrees box')
      .toMatch(/Math\.max\(5,\s*Math\.min\(60,/);
  });

  it('both boxes render from one number, so they cannot drift', () => {
    const i = SRC.indexOf('data-testid="new-roof-pitch-rise"');
    const box = SRC.slice(i, i + 2_000);
    // The displayed value is derived from roofPitchDeg every render.
    expect(box).toMatch(/newRoofRiseDraft \?\? formatRise12\(roofPitchDeg\)/);
  });

  it('the section inspector routes through the same rule, not its own regex', () => {
    const insp = read('components/3d/inspector/SectionInspector.tsx');
    expect(insp).toMatch(/parseRiseOver12Input\(raw\)/);
    expect(insp, 'the inline rule must be gone, or the two boxes can disagree')
      .not.toMatch(/parsePitchInput\(\/\[:/);
  });
});
