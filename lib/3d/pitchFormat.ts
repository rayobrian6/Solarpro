/**
 * lib/3d/pitchFormat.ts
 *
 * ONE PITCH AUTHORITY, SEVERAL WAYS TO SAY IT.
 *
 * A roof slope is stored in exactly one form everywhere in this codebase:
 * DEGREES FROM HORIZONTAL, on `RoofPlane.pitch` and `RoofSectionRecord.pitchDeg`.
 * Nothing here stores anything. This module only converts between that one
 * number and the way a roofer says it out loud.
 *
 * 🚨 WHY A SEPARATE MODULE RATHER THAN A SECOND FIELD. The obvious shortcut is
 * to put `riseOver12` on the record beside `pitchDeg`. That is how this
 * repository has already been bitten twice: two stored numbers that mean the
 * same physical thing drift, and then the drawing says 6:12 while the geometry
 * says 25.1°. A derived function cannot drift. So: degrees are canonical, and
 * "6:12" is a rendering of them, in the same way "17 ft 10 in" is a rendering
 * of 5.4384 m.
 *
 * THE ARITHMETIC
 *   rise per 12 of run  =  12 · tan(pitch)
 *   pitch               =  atan(rise / 12)
 *
 * A 4:12 roof is 18.435°. A 6:12 is 26.565°. A 12:12 is 45°. Those are exact,
 * not table lookups, and the round trip is exact to the float.
 */

const DEG = Math.PI / 180;

/** The run a roofer quotes against. Twelve inches, twelve of anything. */
export const PITCH_RUN = 12;

/**
 * A slope below this cannot define a ridge: two faces meeting at it would need
 * an infinitely long run to reach any height at all, and the layout maths
 * divides by its tangent. A 0.25° roof is 0.05:12 — a dead-flat deck with a
 * measurement error, not a pitched roof. `flat` is the kind for that.
 */
export const MIN_RIDGED_PITCH_DEG = 0.25;

/** The steepest slope this editor will build. Matches `clampPitch`. */
export const MAX_PITCH_DEG = 60;

/** Rise per 12 of run, from degrees. 26.565° -> 6. */
export function riseOver12(pitchDeg: number): number {
  if (!isFinite(pitchDeg)) return NaN;
  return PITCH_RUN * Math.tan(pitchDeg * DEG);
}

/** Degrees, from rise per 12 of run. 6 -> 26.565°. */
export function degFromRise12(rise: number): number {
  if (!isFinite(rise)) return NaN;
  return Math.atan(rise / PITCH_RUN) / DEG;
}

/**
 * "6:12", or "6.4:12" when it is not a whole number.
 *
 * 🚨 IT DOES NOT SNAP. A 25.1° roof is 5.63:12 and prints as 5.6:12, not as
 * 6:12. Rounding a measured slope to the nearest builder's fraction is how a
 * drawing ends up disagreeing with the model it was made from; if the installer
 * wants 6:12 they can type it, and then it will be exactly 26.565°.
 */
export function formatRise12(pitchDeg: number | null | undefined, dp = 1): string {
  if (pitchDeg == null || !isFinite(pitchDeg)) return '—';
  const r = riseOver12(pitchDeg);
  if (!isFinite(r)) return '—';
  const whole = Math.abs(r - Math.round(r)) < 0.005;
  return `${whole ? Math.round(r) : r.toFixed(dp)}:${PITCH_RUN}`;
}

/** "26.6° · 6:12" — both readings of one number, for a single read-only row. */
export function formatPitchBoth(pitchDeg: number | null | undefined): string {
  if (pitchDeg == null || !isFinite(pitchDeg)) return '—';
  return `${pitchDeg.toFixed(1)}° · ${formatRise12(pitchDeg)}`;
}

export interface ParsedPitch {
  /** 🚨 Uniform shape — `strict: false`, so narrowing on `ok` is not runtime. */
  ok: boolean;
  /** Degrees from horizontal. NaN when !ok. */
  pitchDeg: number;
  /** How it was read, so the caller can say so: 'degrees' | 'rise-over-run'. */
  as: 'degrees' | 'rise-over-run' | 'none';
  /** Why it was rejected, phrased for a person. Empty when ok. */
  reason: string;
}

const FAIL = (reason: string): ParsedPitch => ({ ok: false, pitchDeg: NaN, as: 'none', reason });

/**
 * Read a pitch the way an installer would type it.
 *
 * Accepted, all meaning the same 26.565°:
 *     26.565   26.565°   6:12   6/12   6 in 12   6in12
 *
 * 🚨 A BARE NUMBER IS DEGREES, ALWAYS. "6" is 6°, not 6:12. That is the one
 * genuinely ambiguous input, and guessing it either way silently builds the
 * wrong roof — a 6:12 is four and a half times steeper than a 6° roof. The
 * field this parses is labelled in degrees and the rise:run field is separate,
 * so the ambiguity never reaches a user who cannot see which box they are in.
 */
export function parsePitchInput(raw: string): ParsedPitch {
  if (typeof raw !== 'string') return FAIL('Type a pitch.');
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return FAIL('Type a pitch.');

  // rise over run: "6:12", "6/12", "6 in 12"
  const rr = s.match(/^(-?\d+(?:\.\d+)?)\s*(?::|\/|\bin\b|in)\s*(\d+(?:\.\d+)?)$/);
  if (rr) {
    const rise = parseFloat(rr[1]);
    const run = parseFloat(rr[2]);
    if (!isFinite(rise) || !isFinite(run)) return FAIL('That is not a pitch.');
    if (!(run > 0)) return FAIL('A run of zero is a wall, not a roof.');
    if (rise < 0) return FAIL('A negative rise is the same roof facing the other way — set the azimuth instead.');
    const deg = Math.atan(rise / run) / DEG;
    if (deg > MAX_PITCH_DEG) {
      return FAIL(`${rise}:${run} is ${deg.toFixed(1)}°, steeper than the ${MAX_PITCH_DEG}° this editor builds.`);
    }
    return { ok: true, pitchDeg: deg, as: 'rise-over-run', reason: '' };
  }

  const degMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)?$/);
  if (degMatch) {
    const deg = parseFloat(degMatch[1]);
    if (!isFinite(deg)) return FAIL('That is not a pitch.');
    if (deg < 0) return FAIL('A negative pitch is the same roof facing the other way — set the azimuth instead.');
    if (deg > MAX_PITCH_DEG) {
      return FAIL(`${deg}° is steeper than the ${MAX_PITCH_DEG}° this editor builds.`);
    }
    return { ok: true, pitchDeg: deg, as: 'degrees', reason: '' };
  }

  return FAIL('Type a pitch as degrees (26.6) or as rise over run (6:12).');
}

/**
 * Read what was typed into a box LABELLED rise:run.
 *
 * 🚨 THIS IS THE OTHER HALF OF THE AMBIGUITY `parsePitchInput` documents.
 * There, a bare "6" is 6° because that box is labelled in degrees. In a box
 * labelled "Rise : run" the same keystroke means 6:12 — four and a half times
 * steeper. Both readings are correct FOR THEIR BOX, and which box you are in
 * is the only thing that disambiguates them.
 *
 * That rule used to live inline in one component, as a regex inside an onBlur
 * handler. A second pitch box anywhere in the product would have had to
 * re-derive it from reading that handler, and the two would eventually disagree
 * about what "6" means — which is not a formatting difference, it is a
 * different roof. So the rule lives here, next to the arithmetic it qualifies,
 * and every rise box calls this.
 *
 * Explicit notation still wins: "26.6°" typed into a rise box is degrees,
 * because the user said so. Only a BARE number is reinterpreted.
 */
export function parseRiseOver12Input(raw: string): ParsedPitch {
  if (typeof raw !== 'string') return FAIL('Type a pitch.');
  const s = raw.trim();
  if (!s) return FAIL('Type a pitch.');
  // Anything carrying its own notation — a colon, a slash, "in", or a degree
  // mark — is passed through untouched and read as written.
  const hasNotation = /[:/°]|\bin\b|deg/i.test(s);
  return parsePitchInput(hasNotation ? s : `${s}:${PITCH_RUN}`);
}
