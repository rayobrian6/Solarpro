/**
 * lib/3d/obstructionPresets.ts
 *
 * MARKING A VENT SHOULD NOT BE A CAD SESSION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS THERE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I do not want a mini CAD program just to mark a vent."
 *
 * The obstruction tool offered three sliders — width, depth, height — and then
 * a click. It stamped `type: 'chimney'` on EVERY object regardless, so a vent
 * pipe, a plumbing stack and a roof hatch were all chimneys with different
 * numbers typed into them. That was not a labelling problem once the type
 * started deciding the keep-out clearance: one wrong noun is one wrong
 * clearance, and a hatch that cannot open is a return visit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pick the noun, click the roof. The noun carries the dimensions a person would
 * otherwise type, and the dimensions stay editable because a preset is a
 * starting point, not a claim about this particular roof.
 *
 * 🚨 THE NUMBERS ARE WORKING DEFAULTS, NOT STANDARDS. They are the sizes these
 * objects usually are, chosen so the common case needs no typing at all. Every
 * one is overridable per object, and the clearance is too — an installer's
 * judgement about a specific roof beats a table, always.
 */

/** Which of the canonical `PlacedObstruction['type']` values this is. */
export type ObstructionPresetId =
  | 'vent' | 'vent_pipe' | 'plumbing_stack' | 'skylight' | 'chimney'
  | 'hvac' | 'roof_hatch' | 'dormer' | 'tree' | 'other';

export interface ObstructionPreset {
  id: ObstructionPresetId;
  /** What a designer calls it. */
  label: string;
  icon: string;
  /** Footprint, metres. A round object uses equal width and depth and is drawn
   *  from `radiusM`; the keep-out treats both the same way. */
  widthM: number;
  depthM: number;
  /** How far it stands proud of the roof, metres. This is what makes it cast
   *  shade, so a flush skylight is genuinely 0.1 and not 1.0. */
  heightM: number;
  /** Round in plan — a pipe, a stack, a tree. Drawn as a circle. */
  round: boolean;
  /** Which space it lives in. A tree stands on the ground and shades; it does
   *  not occupy roof area. See PlacedObstruction['space']. */
  space: 'roof' | 'site';
  /** One line telling the user what the click will place. */
  hint: string;
}

/**
 * 🚨 ORDERED BY HOW OFTEN A RESIDENTIAL ROOF HAS ONE. The first three account
 * for most of the marks anyone makes, and putting the rare ones first costs a
 * scan on every single object.
 */
export const OBSTRUCTION_PRESETS: readonly ObstructionPreset[] = [
  {
    id: 'vent_pipe', label: 'Vent pipe', icon: '│',
    widthM: 0.1, depthM: 0.1, heightM: 0.35, round: true, space: 'roof',
    hint: 'Click the roof. A 100 mm pipe standing ~350 mm proud.',
  },
  {
    id: 'plumbing_stack', label: 'Plumbing stack', icon: '╽',
    widthM: 0.15, depthM: 0.15, heightM: 0.45, round: true, space: 'roof',
    hint: 'Click the roof. A 150 mm stack with room for the boot.',
  },
  {
    id: 'vent', label: 'Vent', icon: '◍',
    widthM: 0.35, depthM: 0.35, heightM: 0.25, round: true, space: 'roof',
    hint: 'Click the roof. A box or turbine vent.',
  },
  {
    id: 'skylight', label: 'Skylight', icon: '▭',
    widthM: 1.2, depthM: 0.8, heightM: 0.12, round: false, space: 'roof',
    hint: 'Click the roof. A flush unit — it takes area, it barely shades.',
  },
  {
    id: 'chimney', label: 'Chimney', icon: '🏠',
    widthM: 0.9, depthM: 0.6, heightM: 1.2, round: false, space: 'roof',
    hint: 'Click the roof. Tall enough to shade — it will appear in Shade.',
  },
  {
    id: 'roof_hatch', label: 'Roof hatch', icon: '⬓',
    widthM: 0.9, depthM: 0.9, heightM: 0.3, round: false, space: 'roof',
    hint: 'Click the roof. Kept clear so it can open.',
  },
  {
    id: 'hvac', label: 'Rooftop unit', icon: '▦',
    widthM: 1.2, depthM: 0.9, heightM: 0.9, round: false, space: 'roof',
    hint: 'Click the roof. Rooftop equipment, with service clearance.',
  },
  {
    id: 'tree', label: 'Tree', icon: '🌳',
    widthM: 6.0, depthM: 6.0, heightM: 8.0, round: true, space: 'site',
    hint: 'Click the GROUND at the trunk. It shades; it does not remove panels.',
  },
  {
    id: 'other', label: 'Other', icon: '▪',
    widthM: 0.6, depthM: 0.6, heightM: 1.0, round: false, space: 'roof',
    hint: 'Click the roof. Set the size yourself.',
  },
] as const;

export const DEFAULT_OBSTRUCTION_PRESET: ObstructionPresetId = 'vent_pipe';

export function presetFor(id: string | null | undefined): ObstructionPreset {
  return OBSTRUCTION_PRESETS.find(p => p.id === id) ?? OBSTRUCTION_PRESETS[0];
}

/**
 * Half the diagonal of the footprint — the legacy circular keep-out radius.
 *
 * Kept because `PlacedObstruction.radiusM` is the fallback every older stored
 * object relies on, and a record that carries a rectangle but no radius would
 * silently lose its keep-out on any path that has not been updated.
 */
export function legacyRadiusFor(widthM: number, depthM: number): number {
  return Math.sqrt(widthM * widthM + depthM * depthM) / 2;
}
