/**
 * lib/obstruction/permitProjection.ts
 *
 * THE HAND-PLACED CHIMNEY MUST REACH THE PLAN SET.
 *
 * 🚨 IT DID NOT, AND THE TWO HALVES OF THE PRODUCT DISAGREED ABOUT WHAT WAS ON
 * THE ROOF.
 *
 * A designer marks a chimney in the 3D studio. The keep-out authority correctly
 * clears panels around it. It is persisted (migration 122). And then the permit
 * package is generated and the chimney is not on the drawing — because
 * `project.roofObstructions`, the field the roof plan draws from, was populated
 * from exactly two sources: the Nearmap AI sweep and the aerial-vision
 * detector. `grep -i obstruct app/engineering/page.tsx` returned zero hits.
 *
 * So the stamped sheet described a roof that the designer had already corrected,
 * and the only obstructions on it were the ones an algorithm happened to spot
 * from above. The drawing layer was never the problem — `lib/drafting/templates/
 * roof.ts` has drawn footprint + dashed keep-out ring + type label the whole
 * time, and its own comment says the source is "Nearmap AI / vision / manual".
 * The manual third was never wired.
 *
 * ── THE RULE THIS FILE ENFORCES ──────────────────────────────────────────────
 *
 * If the user draws physical reality in SolarPro, every downstream consumer
 * must either consume it or say explicitly why it does not. There is no
 * "3D reality" and separate "permit reality".
 *
 * ── AND IT IS NOT A SECOND OBSTRUCTION LIST ──────────────────────────────────
 *
 * This is a PROJECTION, not a store. It reads the canonical
 * `PlacedObstruction[]` the studio already persists and converts it into the
 * shape the drawing consumes. It holds nothing, decides nothing about what
 * exists, and cannot drift — because the two numbers that matter are taken from
 * the same authorities the 3D keep-out uses:
 *
 *   • clearance  ← `clearanceFor` (lib/3d/panelKeepOut.ts)
 *   • radius     ← `legacyRadiusFor` (lib/3d/obstructionPresets.ts)
 *
 * If the drawn ring were computed here independently, the plan set could print
 * a keep-out the design never enforced — which is exactly the class of defect
 * that put panels across a flue in the first place.
 */

import type { PlacedObstruction } from '@/types';
import { clearanceFor } from '@/lib/3d/panelKeepOut';
import { legacyRadiusFor } from '@/lib/3d/obstructionPresets';

/** 1 m = 3.28084 ft — the same conversion the measure bar uses. */
const METER_TO_FEET = 3.28084;

/**
 * The shape `lib/drafting/types.ts` declares for `project.roofObstructions`,
 * which PV-1B and PV-2 draw and `lib/permit/sections/sitePlan.ts` reads.
 */
export interface PermitRoofObstruction {
  lat: number;
  lng: number;
  radiusFt: number;
  clearanceFt: number;
  type: string;
  /** Which face it was marked on, when it was marked on one. */
  planeId?: string;
  /** Always 'manual' here. The aerial sources tag their own. */
  source: 'manual';
}

/**
 * Canonical obstructions → the roof plan's obstruction list.
 *
 * 🚨 SITE OBJECTS ARE DELIBERATELY EXCLUDED, and this is the "say explicitly
 * why it does not" half of the rule.
 *
 * A tree stands on the ground. It occupies no roof area, removes no panels, and
 * its whole effect is SHADE — which already propagates through its own chain
 * (canonicalShadeScene → per-panel annualShadeFactor → production → proposal).
 * Drawing it on the roof plan would be wrong twice over: it is not a roof
 * fixture, and the template renders a canopy as "CONCEALED AREA — FIELD VERIFY"
 * because an aerial canopy hides whatever is under it. A tree the designer
 * placed deliberately conceals nothing — they know what is there. Stamping
 * "field verify" on it would be a fabricated warning on a permit drawing.
 *
 * Absent `space` reads as 'roof', matching every object stored before that
 * field existed.
 */
export function projectObstructionsForPermit(
  obstructions: PlacedObstruction[] | null | undefined,
): PermitRoofObstruction[] {
  const all = Array.isArray(obstructions) ? obstructions : [];
  const out: PermitRoofObstruction[] = [];

  for (const o of all) {
    if (!o) continue;
    if ((o.space ?? 'roof') !== 'roof') continue;   // see the note above
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lng)) continue;

    // 🚨 THE CIRCUMSCRIBING RADIUS, NOT AN AREA-EQUIVALENT ONE.
    //
    // The drawing is a circle and the object is a rectangle, so a single radius
    // cannot be exact. Half the diagonal is the smallest circle that CONTAINS
    // the footprint; an area-matched radius would be smaller and would draw a
    // keep-out that understates the real one. Understating is how a module ends
    // up over a flue, so the error is taken in the safe direction — the same
    // reasoning the keep-out authority itself records.
    //
    // `radiusM` is the stored legacy fallback and is used when the rectangle is
    // absent, which is what every pre-rectangle record has.
    const w = Number.isFinite(o.widthM) ? (o.widthM as number) : null;
    const d = Number.isFinite(o.depthM) ? (o.depthM as number) : null;
    const radiusM = (w != null && d != null && w > 0 && d > 0)
      ? legacyRadiusFor(w, d)
      : (Number.isFinite(o.radiusM) && o.radiusM > 0 ? o.radiusM : 0);
    if (!(radiusM > 0)) continue;   // nothing to draw, and a 0 ft circle is noise

    out.push({
      lat: o.lat,
      lng: o.lng,
      radiusFt: radiusM * METER_TO_FEET,
      // The SAME function the panel exclusion calls. A per-object override the
      // installer typed wins over the type default, in both places, because it
      // is one function and not two tables.
      clearanceFt: clearanceFor(o as any) * METER_TO_FEET,
      type: String(o.type ?? 'other'),
      ...(o.planeId ? { planeId: o.planeId } : {}),
      source: 'manual',
    });
  }

  return out;
}
