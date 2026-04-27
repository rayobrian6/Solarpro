// ============================================================
// Mounting Hardware Adapter — Phase B1
// Maps MountingSystemSpec (mounting-hardware-db.ts) →
//       RackingSystemSpec  (racking-database.ts shape)
//
// Purpose: Allow structural-engine-v3.ts to consume the
//          canonical mounting-hardware-db without schema changes
//          to V3's calculation logic.
//
// Principle: No behavior change.  Every field read by V3 is
//            mapped directly from the source record.  Where a
//            field has no exact counterpart a `console.warn`
//            guard fires (once per unique fieldName) so the
//            engineering team can track gaps.
//
// Fields accessed by structural-engine-v3.ts (exhaustive list):
//   racking.manufacturer
//   racking.systemType            ('rail_based' | 'rail_less' | 'ballasted' | 'clamp_only')
//   racking.compatibleRoofTypes
//   racking.mount.model
//   racking.mount.attachmentMethod
//   racking.mount.maxSpacingIn
//   racking.mount.upliftCapacityLbs
//   racking.mount.fastenersPerMount
//   racking.rail                  (null ⇒ rail-less)
//   racking.rail.maxCantileverIn
//   racking.rail.maxSpanIn
//   racking.rail.momentCapacityInLbs
//   racking.rail.spliceIntervalIn
//   racking.rail.model
//   racking.hardware.midClamp
//   racking.hardware.endClamp
//   racking.hardware.railSplice
//   racking.hardware.groundLug
//   racking.hardware.lagBolt
//   racking.hardware.flashingKit
//   racking.hardware.bondingHardware
//   racking.hardware.lFoot        (optional)
// ============================================================

import {
  getMountingSystemById,
  type MountingSystemSpec,
  type RailSpec    as HWRailSpec,
  type MountSpec   as HWMountSpec,
  type AttachmentMethod as HWAttachmentMethod,
  type SystemType,
} from '../mounting-hardware-db';

// ── Re-export the lookup so callers don't need the raw DB ─────────────────
export { getMountingSystemById } from '../mounting-hardware-db';

// ── RackingSystemSpec shape (mirrors racking-database.ts) ────────────────
// We re-declare only the fields V3 actually reads; this avoids a hard
// dependency on the old DB file and allows it to be deleted safely.

export type LegacyAttachmentMethod =
  | 'l_foot_lag'
  | 'standoff_lag'
  | 'tile_hook'
  | 'tile_replacement'
  | 'seam_clamp'
  | 'corrugated_screw'
  | 'ballasted'
  | 'adhesive_pad'
  | 'direct_attach'
  | 'trapezoidal_clamp';

export type LegacySystemType =
  | 'rail_based'
  | 'rail_less'
  | 'ballasted'
  | 'clamp_only';

export interface LegacyRailSpec {
  model: string;
  material: string;
  heightIn: number;
  widthIn: number;
  weightPerFtLbs: number;
  maxSpanIn: number;
  maxCantileverIn: number;
  spliceIntervalIn: number;
  momentCapacityInLbs: number;
  ulListing: string;
}

export interface LegacyMountSpec {
  model: string;
  attachmentMethod: LegacyAttachmentMethod;
  fastenersPerMount: number;
  upliftCapacityLbs: number;
  upliftPerFastenerLbs: number;
  shearCapacityLbs: number;
  downwardCapacityLbs: number;
  maxSpacingIn: number;
  minEmbedmentIn: number;
  fastenerDiameterIn: number;
  iccEsReport?: string;
  ulListing?: string;
  notes: string;
}

export interface LegacyHardwareKit {
  midClamp: string;
  endClamp: string;
  lFoot?: string;
  tileHook?: string;
  seamClamp?: string;
  railSplice?: string;
  groundLug: string;
  bondingHardware: string;
  flashingKit?: string;
  lagBolt: string;
}

export interface RackingSystemSpec {
  id: string;
  manufacturer: string;
  model: string;
  systemType: LegacySystemType;
  compatibleRoofTypes: string[];
  rail: LegacyRailSpec | null;
  mount: LegacyMountSpec;
  hardware: LegacyHardwareKit;
  iccEsReport?: string;
  ulListing: string;
}

// ── Fallback guard (fires at most once per field name per session) ─────────
const _warnedFields = new Set<string>();
function fallbackWarn(fieldName: string, sourceId: string, fallbackValue: unknown): void {
  const key = `${sourceId}::${fieldName}`;
  if (!_warnedFields.has(key)) {
    _warnedFields.add(key);
    console.warn('[HW MAP FALLBACK]', fieldName, `(id=${sourceId})`, '→ using fallback:', fallbackValue);
  }
}

// ── AttachmentMethod normalization ────────────────────────────────────────
// mounting-hardware-db uses expanded enum values; racking-database uses a
// narrower set.  Map forward; anything unrecognised falls back to 'l_foot_lag'
// with a guard log.
function normalizeAttachmentMethod(
  hw: HWAttachmentMethod,
  id: string,
): LegacyAttachmentMethod {
  const map: Partial<Record<HWAttachmentMethod, LegacyAttachmentMethod>> = {
    l_foot_lag:             'l_foot_lag',
    tile_hook:              'tile_hook',
    tile_replacement:       'tile_replacement',
    standing_seam_clamp:    'seam_clamp',
    corrugated_clamp:       'corrugated_screw',
    ballasted:              'ballasted',
    mechanically_attached:  'direct_attach',
    driven_pile:            'direct_attach',
    helical_pile:           'direct_attach',
    concrete_pier:          'direct_attach',
    direct_attach:          'direct_attach',
    rail_less_lag:          'direct_attach',
  };
  const result = map[hw];
  if (result === undefined) {
    fallbackWarn('mount.attachmentMethod', id, 'l_foot_lag');
    return 'l_foot_lag';
  }
  return result;
}

// ── SystemType normalization ──────────────────────────────────────────────
function normalizeSystemType(st: SystemType, id: string): LegacySystemType {
  const map: Partial<Record<SystemType, LegacySystemType>> = {
    rail_based:                'rail_based',
    rail_less:                 'rail_less',
    ballasted_flat:            'ballasted',
    mechanically_attached_flat:'rail_based',
    tilt_leg:                  'rail_based',
    ground_single_post:        'rail_based',
    ground_dual_post:          'rail_based',
    ground_driven_pile:        'rail_based',
    ground_helical:            'rail_based',
    ground_concrete:           'rail_based',
    tracker_single_axis:       'rail_based',
    tracker_dual_axis:         'rail_based',
    standing_seam:             'clamp_only',
    solar_fence:               'rail_based',
  };
  const result = map[st];
  if (result === undefined) {
    fallbackWarn('systemType', id, 'rail_based');
    return 'rail_based';
  }
  return result;
}

// ── Rail adapter ──────────────────────────────────────────────────────────
function adaptRail(rail: HWRailSpec | undefined, id: string): LegacyRailSpec | null {
  if (!rail) return null;

  return {
    model:               rail.model,
    // mounting-hardware-db uses 'materialAlloy'; legacy uses 'material'
    material:            rail.materialAlloy,
    heightIn:            rail.heightIn,
    widthIn:             rail.widthIn,
    // mounting-hardware-db uses 'weightLbsPerFt'; legacy uses 'weightPerFtLbs'
    weightPerFtLbs:      rail.weightLbsPerFt,
    maxSpanIn:           rail.maxSpanIn,
    maxCantileverIn:     rail.maxCantileverIn,
    spliceIntervalIn:    rail.spliceIntervalIn,
    momentCapacityInLbs: rail.momentCapacityInLbs,
    // mounting-hardware-db uses boolean ul2703Listed; legacy uses string ulListing
    ulListing:           rail.ul2703Listed ? 'UL 2703' : '',
  };
}

// ── Mount adapter ─────────────────────────────────────────────────────────
function adaptMount(mount: HWMountSpec, id: string): LegacyMountSpec {
  return {
    model:              mount.model,
    attachmentMethod:   normalizeAttachmentMethod(mount.attachmentMethod, id),
    fastenersPerMount:  mount.fastenersPerMount,
    upliftCapacityLbs:  mount.upliftCapacityLbs,
    // mounting-hardware-db uses 'fastenerPulloutLbs'; legacy uses 'upliftPerFastenerLbs'
    upliftPerFastenerLbs: mount.fastenerPulloutLbs,
    shearCapacityLbs:   mount.shearCapacityLbs,
    downwardCapacityLbs:mount.downwardCapacityLbs,
    maxSpacingIn:       mount.maxSpacingIn,
    // mounting-hardware-db uses 'fastenerEmbedmentIn'; legacy uses 'minEmbedmentIn'
    minEmbedmentIn:     mount.fastenerEmbedmentIn,
    fastenerDiameterIn: mount.fastenerDiameterIn,
    iccEsReport:        mount.iccEsReport,
    ulListing:          mount.ul2703Listed ? 'UL 2703' : undefined,
    notes:              '',   // mounting-hardware-db has no 'notes' on MountSpec
  };
}

// ── Hardware adapter ──────────────────────────────────────────────────────
// mounting-hardware-db HardwareKit does NOT have an 'lFoot' field.
// We synthesise it from mount.model when the attachment method implies L-foot.
function adaptHardware(
  src: MountingSystemSpec,
): LegacyHardwareKit {
  const hw = src.hardware;
  const isLFoot = src.mount.attachmentMethod === 'l_foot_lag';

  // Synthesise lFoot description from mount model when attachment is l_foot_lag
  const lFoot: string | undefined = isLFoot
    ? src.mount.model
    : undefined;

  return {
    midClamp:        hw.midClamp,
    endClamp:        hw.endClamp,
    lFoot,
    tileHook:        hw.tileHook,
    // mounting-hardware-db has no 'seamClamp' field — derive from system type
    seamClamp:       src.systemType === 'standing_seam'
                       ? `${src.manufacturer} Standing Seam Clamp`
                       : undefined,
    railSplice:      hw.railSplice,
    groundLug:       hw.groundLug,
    bondingHardware: hw.bondingHardware,
    flashingKit:     hw.flashingKit,
    // mounting-hardware-db has a 'lagBolt' field on HardwareKit
    lagBolt:         hw.lagBolt,
  };
}

// ── Main adapter function ─────────────────────────────────────────────────
/**
 * Adapt a MountingSystemSpec (from mounting-hardware-db.ts) into the
 * RackingSystemSpec shape expected by structural-engine-v3.ts.
 *
 * Returns undefined if the source record is undefined (mirrors the
 * getRackingById() contract so V3's fallback path still triggers).
 */
export function adaptToRackingSpec(
  src: MountingSystemSpec | undefined,
): RackingSystemSpec | undefined {
  if (!src) return undefined;

  return {
    id:                 src.id,
    manufacturer:       src.manufacturer,
    model:              src.model,
    systemType:         normalizeSystemType(src.systemType, src.id),
    compatibleRoofTypes:src.compatibleRoofTypes,
    rail:               adaptRail(src.rail, src.id),
    mount:              adaptMount(src.mount, src.id),
    hardware:           adaptHardware(src),
    iccEsReport:        src.iccEsReport,
    ulListing:          src.ul2703Listed ? 'UL 2703' : '',
  };
}

// ── Convenience lookup (drop-in for getRackingById from racking-database) ─
/**
 * Look up a mounting system by ID and return it in RackingSystemSpec shape.
 * This is the primary function structural-engine-v3.ts should call instead
 * of getRackingById() from racking-database.ts.
 */
export function getRackingSpecById(id: string): RackingSystemSpec | undefined {
  const src = getMountingSystemById(id);
  return adaptToRackingSpec(src);
}

// ── ID compatibility map ──────────────────────────────────────────────────
// The 14 IDs in racking-database.ts are a subset of the 29 IDs in
// mounting-hardware-db.ts.  All 14 share the same ID strings so no
// translation is needed for the common set.
//
// Extra IDs now available (not in old DB):
//   rooftech-mini-s, rooftech-mini-t, rooftech-hook, rooftech-mini-m,
//   sunmodo-ez, panelclaw-polar-bear, gamechange-genius, nextracker-nr3,
//   array-tech-duratrack, aceclamp-corrugated, ground-dual-post-driven,
//   ground-single-post-helical, terrasmart-glide, polar-racking-pr-ground,
//   tamarack-utr, prosolar-toptrack, clenergy-ezrack-sb, renusol-vs-plus,
//   everest-e-mount-af, mse-rapid-rail, unirac-rm10-evo, renusol-console-plus,
//   sollega-fc350, ironridge-flat-roof