// ═══════════════════════════════════════════════════════════════════════════
// WHICH GEOMETRY GOVERNS THIS PROPERTY — the provider decision, made explicit.
//
// WHAT WAS WRONG
// --------------
// There was no provider decision. The whole thing was one emergent line:
//
//     if (i.existingPlaneCount !== 0) return false;    // lib/3d/laneA.ts
//
// fed from `roofPlanesRef.current.length`. Nothing about the choice was
// persisted — not the choice, not the rejection, not the reason.
//
// 🚨 SO A REJECTION ERASED ITSELF. "Draw Manually Instead" cleared the planes;
// the empty bundle was then PRUNED rather than archived (`hasContent` is false
// for it); and the next 2D map pan of more than ~12 m re-satisfied every
// condition in `shouldRunLaneA` and re-injected the exact planes the installer
// had just rejected. No address change required. ARCHIVE-NEVER-CLEAR protects
// ENTITIES, and a rejection is not an entity, so the doctrine gave it no cover.
//
// 🚨 AND "NATIVE IS BAD" WAS UNSAYABLE. The fallback could only be reached when
// Google returned nothing at all. A property with native geometry that is
// present but WRONG — which is most of the ones this exists for — had no way to
// say so. "We tried and there is nothing" and "I looked at it and it is not
// good enough to design on" are different facts with different consequences,
// and both used to collapse to an empty array.
//
// THE MODEL
// ---------
// One fact about one PROPERTY, keyed by siteKey exactly as ownership is — so
// that going A → B → A does not lose the judgement, which is the whole failure
// this exists to fix.
//
// 🚨 FIVE VALUES, NOT FOUR. Absence is not a value. A property nobody has
// judged reads `undecided`, and `undecided` must never be coerced into one of
// the other four — that is the same class of defect as `?? 0` turning an
// unknown current into zero amps.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What the installer has decided about this property's native (Google) roof
 * geometry.
 *
 *   undecided   — nobody has judged it yet. The default, and never inferred.
 *   accepted    — native geometry is good and is what the design is built on.
 *   unavailable — we asked and there is no coverage here. A FACT, not a
 *                 judgement: coverage can appear later, so this does not block
 *                 a future acquisition.
 *   rejected    — native geometry exists and the installer looked at it and
 *                 will not design on it. A JUDGEMENT, and it must stick.
 *   custom      — a hand-built model governs this property.
 */
export type NativeGeometryDisposition =
  | 'undecided' | 'accepted' | 'unavailable' | 'rejected' | 'custom';

export const NATIVE_GEOMETRY_DISPOSITIONS: readonly NativeGeometryDisposition[] = [
  'undecided', 'accepted', 'unavailable', 'rejected', 'custom',
] as const;

/** siteKey → disposition. Absent key means `undecided`; it is never written. */
export type NativeGeometryMap = Record<string, NativeGeometryDisposition>;

export function isNativeGeometryDisposition(v: unknown): v is NativeGeometryDisposition {
  return typeof v === 'string'
    && (NATIVE_GEOMETRY_DISPOSITIONS as readonly string[]).includes(v);
}

/**
 * What has been decided about this property.
 *
 * 🚨 AN UNKNOWN SITE READS `undecided`, and so does an unrecognised stored
 * value. Neither is coerced into a judgement — a row written by a newer build,
 * or hand-edited, must degrade to "nobody has decided" rather than to
 * "accepted", which would silently license re-acquisition over custom work.
 */
export function dispositionFor(
  map: NativeGeometryMap | null | undefined,
  siteKey: string | null | undefined,
): NativeGeometryDisposition {
  if (!map || !siteKey) return 'undecided';
  const v = map[siteKey];
  return isNativeGeometryDisposition(v) ? v : 'undecided';
}

/**
 * Record a decision, returning a NEW map.
 *
 * 🚨 `undecided` DELETES the entry rather than storing the word. Absence and
 * "undecided" must be the same state, or a reader has two ways to spell one
 * fact and the day they disagree is a silent wrong answer.
 */
export function withDisposition(
  map: NativeGeometryMap | null | undefined,
  siteKey: string | null | undefined,
  next: NativeGeometryDisposition,
): NativeGeometryMap {
  const out: NativeGeometryMap = { ...(map ?? {}) };
  if (!siteKey) return out;               // an unresolved site owns no decision
  if (next === 'undecided') delete out[siteKey];
  else out[siteKey] = next;
  return out;
}

/**
 * MAY automatic native acquisition run for a property in this state?
 *
 * This is the question `shouldRunLaneA` asks. Only the two states that express
 * a HUMAN judgement refuse it:
 *
 *   rejected — the installer looked at the native roof and said no. Running
 *              again would re-inject exactly what they rejected, which is the
 *              defect this module exists to close.
 *   custom   — a hand-built model governs. A machine's guess must not appear
 *              beside it and be autosaved.
 *
 * `unavailable` deliberately does NOT refuse: it records that there was no
 * coverage, not that coverage is unwanted, and coverage genuinely does appear
 * for addresses over time. `accepted` does not refuse either — native is
 * already the source there, and the existing plane-count guard is what stops a
 * second run from duplicating it.
 */
export function nativeAcquisitionPermitted(d: NativeGeometryDisposition): boolean {
  return d !== 'rejected' && d !== 'custom';
}

/** Does a hand-built model govern this property? Used by the UI to say so. */
export function customModelGoverns(d: NativeGeometryDisposition): boolean {
  return d === 'custom';
}

/** One line of UI copy per state. Written here so every surface says the same
 *  thing, and so "undecided" never renders as a claim about the property. */
export function dispositionLabel(d: NativeGeometryDisposition): string {
  switch (d) {
    case 'accepted':    return 'Using Google 3D geometry';
    case 'unavailable': return 'No Google 3D coverage at this address';
    case 'rejected':    return 'Google 3D rejected as inaccurate — modelling by hand';
    case 'custom':      return 'Hand-built model governs this property';
    default:            return 'Geometry source not yet decided';
  }
}

/**
 * Tolerant parse of the stored map.
 *
 * Unknown keys and unrecognised values are DROPPED rather than defaulted, and
 * the result is always an object, so a hand-edited or newer-build row degrades
 * to "nobody decided" per site rather than breaking the studio or asserting a
 * decision nobody made.
 */
export function parseNativeGeometryMap(raw: unknown): NativeGeometryMap {
  const out: NativeGeometryMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k) continue;
    if (isNativeGeometryDisposition(v)) out[k] = v;
  }
  return out;
}
