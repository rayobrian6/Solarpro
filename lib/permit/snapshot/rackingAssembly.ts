// ═══════════════════════════════════════════════════════════════════════════
// W3 §4 — Canonical versioned racking-assembly record.
// ONE source: lib/mounting-hardware-db.ts (the structural store). Capacity is
// the ASD ALLOWABLE normalized through lib/structural/attachmentCapacity.ts.
//
// RT-MINI ruling (Ray, W3): the 600 lb ALLOWABLE in mounting-hardware-db
// (PE-letter-verified, 613.2 lb weakest assembly) is the capacity authority.
// The 900 lb "ultimate" entries in equipment-db / equipment-registry-v4 are
// NOT authority — the discrepancy is recorded in `notes`, never silently
// reconciled to the higher number.
// ═══════════════════════════════════════════════════════════════════════════
import type { RackingAssemblyRecord } from './types';
import { contentRevision } from './digest';
import type { MountingSystemSpec } from '@/lib/mounting-hardware-db';
import { allowableUpliftLbs } from '@/lib/structural/attachmentCapacity';

/** Build the canonical racking-assembly record from a mounting-hardware-db spec.
 *  Returns null when no mount is resolved (a missing-assembly blocker fires
 *  upstream). Pure/deterministic. */
export function buildRackingAssembly(
  system: MountingSystemSpec | null | undefined,
): RackingAssemblyRecord | null {
  if (!system) return null;
  const mount = system.mount;
  const rail = system.rail ?? null;
  const hw = system.hardware;
  const mountBrand = system.manufacturer;

  const isRailBased = system.systemType === 'rail_based' || system.systemType === 'standing_seam';
  // A rail-based mount that carries NO own rail spec is paired with a COMPATIBLE
  // rail from a different manufacturer (documented in hw.railSplice).
  const mixedManufacturer = isRailBased && !rail;
  const railBrand = rail ? system.manufacturer : null;
  // Documented compatibility (hw.railSplice names the accepted rails) ⇒ supported.
  const assemblySupported = !mixedManufacturer
    || /compatible|xr100|xr1000|pegasus|unirac|sfm|equivalent/i.test(hw.railSplice ?? '');

  const notes: string[] = [];
  const isRtMini = system.id === 'rooftech-mini' || /RT-?MINI/i.test(system.model);
  if (isRtMini) {
    notes.push(
      'CAPACITY AUTHORITY = 600 lb ASD ALLOWABLE (Roof Tech RT-MINI II PE letter, 613.2 lb '
      + 'weakest standard assembly, conservative round-down). The 900 lb "ultimate" (2×450) '
      + 'entries in equipment-db / equipment-registry-v4 are NOT structural authority '
      + '(ESR-3575 is a flashing / water-resistance report and carries no structural value).');
  }
  if (mixedManufacturer) {
    notes.push(
      `Mixed-manufacturer assembly: ${mountBrand} ${mount.model} mount + compatible rail `
      + `(${hw.railSplice}). The mount record carries no rail span-limit authority, so rail `
      + `span / cantilever checks are UNVERIFIABLE until the rail SKU is pinned.`);
  }

  const base: Omit<RackingAssemblyRecord, 'recordRevision'> = {
    assemblyId: `assembly-${system.id}`,
    mountManufacturer: mountBrand,
    mountModel: mount.model,
    mountSku: null,
    railManufacturer: railBrand,
    railModel: rail?.model ?? (isRailBased ? 'compatible-rail (SKU unpinned)' : null),
    railSku: null,
    lFootOrAdapter: /l_foot/i.test(mount.attachmentMethod) ? `${mountBrand} L-Foot` : null,
    tBoltFastener: isRailBased ? 'Rail T-bolt / mount-to-rail bolt' : null,
    midClamp: hw.midClamp ?? null,
    endClamp: hw.endClamp ?? null,
    splice: hw.railSplice ?? null,
    groundingBonding: hw.bondingHardware ?? null,
    // Not carried in mounting-hardware-db — honest gap, not fabricated.
    compatibleModuleThicknessInRange: null,
    installationCondition: system.compatibleRoofTypes.join(', ') || null,
    rafterDeckAttachmentMethod: mount.attachmentMethod ?? null,
    screwLagModel: hw.lagBolt ?? null,
    screwLagQtyPerMount: mount.fastenersPerMount ?? null,
    embedmentRequirementIn: mount.fastenerEmbedmentIn ?? null,
    pilotHoleRequired: /no pilot hole/i.test(system.description ?? '') ? false : null,
    publishedCapacityAllowableLbs: allowableUpliftLbs(mount.upliftCapacityLbs, mount.capacityBasis),
    capacityBasis: mount.capacityBasis ?? 'ultimate',
    capacitySource: system.engineeringDataSource ?? null,
    datasheetRevision: system.lastUpdated ?? null,
    datasheetSource: system.iccEsReport ?? system.engineeringDataSource ?? null,
    ul2703ListingBasis: system.ul2703Listed ? (system.iccEsReport ?? 'UL 2703 listed') : null,
    iccEsReport: system.iccEsReport ?? null,
    mixedManufacturer,
    assemblySupported,
    provenance: {
      source: 'mounting-hardware-db',
      ref: system.id,
      note: 'uplift capacity = ASD allowable via attachmentCapacity (Ω=3.0 for ultimate-basis; '
        + 'unchanged for allowable-basis) — one code factor applied once',
    },
    notes,
  };
  return { ...base, recordRevision: contentRevision(base) };
}
