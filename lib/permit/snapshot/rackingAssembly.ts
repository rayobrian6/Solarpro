// ═══════════════════════════════════════════════════════════════════════════
// W3 §4 — Canonical versioned racking-assembly record.
// ONE source: lib/mounting-hardware-db.ts (the structural store). Capacity is
// the ASD ALLOWABLE normalized through lib/structural/attachmentCapacity.ts.
//
// RT-MINI ruling (Ray, W3): the 600 lb ALLOWABLE in mounting-hardware-db is the
// capacity authority. The 900 lb "ultimate" entries in equipment-db /
// equipment-registry-v4 are NOT authority — the discrepancy is recorded in
// `notes`, never silently reconciled to the higher number.
//
// W3.1 §4 — STRENGTHENED PROVENANCE. The 600 lb value now carries a full
// capacityProvenance record: exact source-document identity, revision/date,
// document hash (or an honest null when the file is not archived in-repo),
// issuing entity, jurisdiction boundary, mount model, fastener pattern,
// substrate condition, adjustment factors, an asd-allowable-vs-ultimate flag,
// and an applicability assessment for the selected mixed assembly. The 900 lb
// "ultimate" records are EXPLICITLY EXCLUDED from allowable-capacity checks in
// code (resolveAsdAllowableLbs refuses an 'ultimate' basis). Where the 600 lb
// source does not cover the exact selected assembly / installation condition, a
// BLOCKING structural-authority gap is emitted rather than applying it
// generically.
//
// IN-REPO EVIDENCE (verified 2026-07-21): NO Roof Tech PE structural letter or
// datasheet PDF exists in this repository (searched docs/, public/, assets,
// _tesla_docs; only manufacturer marketing detail PNGs are present). ESR-3575 is
// a flashing / water-resistance report that Sec. 5.2 says explicitly EXCLUDES
// structural capacity. lib/data/structural/attachment-capacity-basis-research.json
// records the 600 lb value as field-referenced and "provisional … VERIFY against
// Roof Tech's current structural test report / stamped calc." Therefore the
// source documentHash is null and a blocking gap is recorded — nothing invented.
// ═══════════════════════════════════════════════════════════════════════════
import type { RackingAssemblyRecord, Provenance } from './types';
import { contentRevision } from './digest';
import type { MountingSystemSpec } from '@/lib/mounting-hardware-db';
import { allowableUpliftLbs } from '@/lib/structural/attachmentCapacity';

// ── W3.1 §4 — provenance shapes (declared locally; types.ts is not edited here) ──

export interface RackingCapacitySourceDocument {
  identity: string | null;          // exact source document identity
  revisionOrDate: string | null;    // source revision / date
  issuingEntity: string | null;     // issuing engineer / entity
  documentHash: string | null;      // sha256 of the archived file, or null when not archived
  archivedInRepo: boolean;          // whether the actual document exists in-repo
  hashNote: string;                 // honest note on why the hash is null / how derived
  url: string | null;               // referenced source URL, if any
}

export interface RackingAssemblyApplicability {
  selectedMountModel: string;
  selectedRail: string | null;
  selectedSubstrate: string | null;
  sourceCoversMount: boolean | null;
  sourceCoversRail: boolean | null;
  sourceCoversSubstrate: boolean | null;
  assessment: string;               // does the source cover mount + rails + substrate?
}

export interface RackingCapacityProvenance {
  mountModel: string;
  publishedValueLbs: number | null;
  capacityBasis: 'allowable' | 'ultimate' | 'unknown';
  /** ASD allowable resolved through resolveAsdAllowableLbs (null ⇒ refused). */
  asdAllowableLbs: number | null;
  /** true ⇒ an 'ultimate'/unset-basis value was refused for the ASD check. */
  ultimateBasisRefusedForAsd: boolean;
  sourceDocument: RackingCapacitySourceDocument;
  jurisdictionApplicabilityBoundary: string | null;
  fastenerPattern: string | null;
  substrateInstallationCondition: string | null;
  adjustmentFactors: Record<string, number | string>;
  /** Ultimate-basis records explicitly excluded from allowable-capacity calcs. */
  excludedUltimateRecords: { value: number; basis: 'ultimate'; source: string; reason: string }[];
  assemblyApplicability: RackingAssemblyApplicability;
  provenance: Provenance;
}

export interface StructuralAuthorityGap {
  code: string;
  severity: 'blocking' | 'warning';
  message: string;
}

/** RackingAssemblyRecord + W3.1 §4 provenance. A subtype of RackingAssemblyRecord,
 *  so it remains assignable everywhere the base record is consumed; the extra
 *  fields ride along on the immutable snapshot and are part of the record digest. */
export interface RackingAssemblyRecordExt extends RackingAssemblyRecord {
  capacityProvenance: RackingCapacityProvenance;
  structuralAuthorityGaps: StructuralAuthorityGap[];
}

// ── W3.1 §4 — ASD allowable resolver (refuses 'ultimate' basis) ────────────────

export interface AsdAllowableResolution {
  allowableLbs: number | null;
  refused: boolean;
  basis: 'allowable' | 'ultimate' | 'unknown';
  reason: string;
}

/**
 * Resolve a mount capacity to a value usable as an ASD ALLOWABLE in an
 * attachment-capacity check. An 'allowable'-basis value passes through directly.
 * An 'ultimate' (mean-to-failure) basis — OR an unset basis (treated as ultimate,
 * conservative) — is REFUSED: a mean-ultimate number must not be laundered into an
 * allowable without a documented Ω from the product's own stamped structural
 * report. This enforces the W3.1 §4 exclusion of the 900 lb "ultimate" RT-MINI
 * registry entries from allowable-capacity calculations.
 */
export function resolveAsdAllowableLbs(
  capacityLbs: number | null | undefined,
  basis: 'allowable' | 'ultimate' | null | undefined,
): AsdAllowableResolution {
  if (capacityLbs == null || !Number.isFinite(capacityLbs)) {
    return { allowableLbs: null, refused: true, basis: basis ?? 'unknown', reason: 'no capacity value provided' };
  }
  if (basis === 'allowable') {
    return { allowableLbs: capacityLbs, refused: false, basis: 'allowable', reason: 'published ASD allowable used directly' };
  }
  return {
    allowableLbs: null,
    refused: true,
    basis: basis === 'ultimate' ? 'ultimate' : 'unknown',
    reason: basis === 'ultimate'
      ? 'ULTIMATE (mean-to-failure) basis REFUSED as an ASD allowable-capacity value — requires a documented Ω from a stamped structural report'
      : 'UNSET basis treated as ultimate and REFUSED as an ASD allowable-capacity value (conservative)',
  };
}

/** Build the canonical racking-assembly record from a mounting-hardware-db spec.
 *  Returns null when no mount is resolved (a missing-assembly blocker fires
 *  upstream). Pure/deterministic. */
export function buildRackingAssembly(
  system: MountingSystemSpec | null | undefined,
): RackingAssemblyRecordExt | null {
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
    notes.push(
      'W3.1 §4 — the cited PE structural letter is NOT archived in this repository '
      + '(documentHash: null, source-document-not-archived); the 600 lb value is field-referenced '
      + 'and PROVISIONAL. Applicability to the selected mixed assembly / project jurisdiction is '
      + 'UNVERIFIED — see capacityProvenance and the RACKING-CAPACITY-* structural-authority gaps.');
  }
  if (mixedManufacturer) {
    notes.push(
      `Mixed-manufacturer assembly: ${mountBrand} ${mount.model} mount + compatible rail `
      + `(${hw.railSplice}). The mount record carries no rail span-limit authority, so rail `
      + `span / cantilever checks are UNVERIFIABLE until the rail SKU is pinned.`);
  }

  const publishedAllowable = allowableUpliftLbs(mount.upliftCapacityLbs, mount.capacityBasis);
  const basis: 'allowable' | 'ultimate' = mount.capacityBasis ?? 'ultimate';

  // ── W3.1 §4 — capacity provenance + structural-authority gaps ────────────────
  const asd = resolveAsdAllowableLbs(mount.upliftCapacityLbs, mount.capacityBasis);
  const railModel = rail?.model ?? (isRailBased ? 'compatible-rail (SKU unpinned)' : null);
  const installationCondition = system.compatibleRoofTypes.join(', ') || null;
  const fastenerPattern = mount.fastenersPerMount != null
    ? `${mount.fastenersPerMount}× ${hw.lagBolt ?? mount.attachmentMethod}`
    : (hw.lagBolt ?? null);

  const structuralAuthorityGaps: StructuralAuthorityGap[] = [];
  let capacityProvenance: RackingCapacityProvenance;

  if (isRtMini) {
    capacityProvenance = {
      mountModel: mount.model,
      publishedValueLbs: mount.upliftCapacityLbs,
      capacityBasis: basis,
      asdAllowableLbs: asd.allowableLbs,               // 600 (basis 'allowable')
      ultimateBasisRefusedForAsd: asd.refused,          // false for the real 600 record
      sourceDocument: {
        identity: 'Roof Tech RT-MINI II PE-stamped structural letter — "RT-MINI II ASCE 7-10 (KY)". '
          + 'ICC-ES ESR-3575 is a FLASHING / water-resistance report only and Sec. 5.2 explicitly '
          + 'EXCLUDES structural capacity — it is NOT the capacity source.',
        revisionOrDate: `${system.lastUpdated ?? 'unknown'} · basis ASCE 7-10`,
        issuingEntity: 'Roof Tech (registered design professional; specific PE name / license / seal not captured in-repo)',
        documentHash: null,
        archivedInRepo: false,
        hashNote: 'source-document-not-archived — the RT-MINI II PE structural letter is referenced by '
          + 'URL/label only; no PDF/datasheet file exists in this repository (searched docs/, public/, '
          + 'assets, _tesla_docs). sha256 cannot be computed and the 600 lb value cannot be verified '
          + 'against an archived source in-repo. Cross-referenced by '
          + 'lib/data/structural/attachment-capacity-basis-research.json, which flags it PROVISIONAL.',
        url: 'design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_10/',
      },
      jurisdictionApplicabilityBoundary: 'Source basis = ASCE 7-10, Kentucky. The project AHJ / adopted '
        + 'ASCE edition is NOT confirmed against this source in-repo — applicability to the project '
        + 'jurisdiction is UNESTABLISHED.',
      fastenerPattern: '2× 5/16" (8mm/M8) structural wood screw, ~3.5" (90mm) into the rafter, no pilot hole',
      substrateInstallationCondition: 'Weakest standard assembly governing the 613.2 lb allowable: '
        + '15/32" sheathing, 2×4 DF-L #2, 2 screws. Compatible roof types: '
        + (installationCondition ?? 'unspecified') + '. Self-flashing (integrated AlphaSeal/RT Butyl).',
      adjustmentFactors: {
        assumedSpeciesSpecificGravityG: 0.50,
        embedmentIn: mount.fastenerEmbedmentIn ?? 2.5,
        safetyFactorAppliedBySource: 'yes (value stated as ASD allowable)',
        impliedUltimateToAllowableRatio: 1.5,
        impliedRatioStatus: 'UNVERIFIED — inconsistent with the 3.0 documented for lag-withdrawal '
          + '(ICC-ES AC428 §3.2.5 / IronRidge FF2 certification); flagged for field verification',
      },
      excludedUltimateRecords: [{
        value: 900,
        basis: 'ultimate',
        source: 'equipment-db / equipment-registry-v4 (2×450 lb) and ICC-ES ESR-3575 (flashing report)',
        reason: 'ESR-3575 Sec. 5.2 excludes structural capacity; the 900 lb "ultimate" is not a '
          + 'structural authority and is REFUSED as an ASD allowable-capacity value (resolveAsdAllowableLbs).',
      }],
      assemblyApplicability: {
        selectedMountModel: mount.model,
        selectedRail: railModel,
        selectedSubstrate: installationCondition,
        sourceCoversMount: true,      // pad-to-rafter attachment (screw withdrawal)
        sourceCoversRail: false,      // mixed compatible rail (SKU unpinned) — span/cantilever not covered
        sourceCoversSubstrate: null,  // weakest wood assembly only; other substrates uncertain
        assessment: 'The 600 lb ASD allowable covers the RT-MINI pad-to-rafter attachment for the '
          + 'weakest standard wood assembly ONLY. It does NOT establish rail span/cantilever capacity '
          + 'for the mixed-manufacturer compatible rail (SKU unpinned), and the source jurisdiction '
          + '(ASCE 7-10, KY) is not confirmed for the project AHJ. Do NOT apply generically.',
      },
      provenance: {
        source: 'rackingAssembly.buildRackingAssembly',
        ref: system.id,
        note: 'W3.1 §4 RT-MINI capacity provenance — records only in-repo-verifiable evidence; '
          + 'the PE source document is not archived, hence documentHash null + blocking gaps.',
      },
    };
    structuralAuthorityGaps.push({
      code: 'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
      severity: 'blocking',
      message: 'The RT-MINI 600 lb ASD allowable cites a Roof Tech PE structural letter that is NOT '
        + 'archived in-repo (documentHash null). ESR-3575 is a flashing report that excludes structural '
        + 'capacity. The value cannot be verified against a source of record.',
    });
    structuralAuthorityGaps.push({
      code: 'RACKING-CAPACITY-APPLICABILITY-GAP',
      severity: 'blocking',
      message: 'The 600 lb source does not cover the exact selected assembly: the mixed-manufacturer '
        + 'compatible rail (SKU unpinned) span/cantilever is unverified, and the PE-letter jurisdiction '
        + '(ASCE 7-10, KY) is not confirmed for the project AHJ. Do not apply generically.',
    });
  } else {
    capacityProvenance = {
      mountModel: mount.model,
      publishedValueLbs: mount.upliftCapacityLbs,
      capacityBasis: basis,
      asdAllowableLbs: asd.allowableLbs,
      ultimateBasisRefusedForAsd: asd.refused,
      sourceDocument: {
        identity: system.engineeringDataSource ?? system.iccEsReport ?? null,
        revisionOrDate: system.lastUpdated ?? null,
        issuingEntity: mountBrand,
        documentHash: null,
        archivedInRepo: false,
        hashNote: 'source-document-not-archived — engineering data source referenced by label only; '
          + 'no datasheet/ESR file archived in-repo to hash.',
        url: null,
      },
      jurisdictionApplicabilityBoundary: system.iccEsReport ? `Per ${system.iccEsReport}` : null,
      fastenerPattern,
      substrateInstallationCondition: installationCondition,
      adjustmentFactors: {
        omegaUltimateToAllowable: basis === 'allowable' ? 'n/a (published allowable)' : 3.0,
        embedmentIn: mount.fastenerEmbedmentIn ?? 'n/a',
      },
      excludedUltimateRecords: [],
      assemblyApplicability: {
        selectedMountModel: mount.model,
        selectedRail: railModel,
        selectedSubstrate: installationCondition,
        sourceCoversMount: system.iccEsReport ? true : null,
        sourceCoversRail: rail ? true : (mixedManufacturer ? false : null),
        sourceCoversSubstrate: null,
        assessment: mixedManufacturer
          ? 'Mixed-manufacturer assembly — mount source does not cover the compatible rail span/cantilever.'
          : 'Same-manufacturer assembly per the cited engineering source.',
      },
      provenance: {
        source: 'rackingAssembly.buildRackingAssembly',
        ref: system.id,
        note: 'W3.1 §4 capacity provenance (generic mount).',
      },
    };
    if (asd.refused) {
      structuralAuthorityGaps.push({
        code: 'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED',
        severity: 'warning',
        message: `Mount ${mount.model} capacity is ${basis}-basis; the raw value is refused as an ASD `
          + 'allowable (resolveAsdAllowableLbs). The published allowable field applies Ω conversion; '
          + 'verify against the product stamped report before permit use.',
      });
    }
  }

  const base: Omit<RackingAssemblyRecordExt, 'recordRevision'> = {
    assemblyId: `assembly-${system.id}`,
    mountManufacturer: mountBrand,
    mountModel: mount.model,
    mountSku: null,
    railManufacturer: railBrand,
    railModel,
    railSku: null,
    lFootOrAdapter: /l_foot/i.test(mount.attachmentMethod) ? `${mountBrand} L-Foot` : null,
    tBoltFastener: isRailBased ? 'Rail T-bolt / mount-to-rail bolt' : null,
    midClamp: hw.midClamp ?? null,
    endClamp: hw.endClamp ?? null,
    splice: hw.railSplice ?? null,
    groundingBonding: hw.bondingHardware ?? null,
    // Not carried in mounting-hardware-db — honest gap, not fabricated.
    compatibleModuleThicknessInRange: null,
    installationCondition,
    rafterDeckAttachmentMethod: mount.attachmentMethod ?? null,
    screwLagModel: hw.lagBolt ?? null,
    screwLagQtyPerMount: mount.fastenersPerMount ?? null,
    embedmentRequirementIn: mount.fastenerEmbedmentIn ?? null,
    pilotHoleRequired: /no pilot hole/i.test(system.description ?? '') ? false : null,
    publishedCapacityAllowableLbs: publishedAllowable,
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
    // ── W3.1 §4 ──
    capacityProvenance,
    structuralAuthorityGaps,
  };
  return { ...base, recordRevision: contentRevision(base) };
}
