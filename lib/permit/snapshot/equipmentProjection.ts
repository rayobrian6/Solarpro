// ═══════════════════════════════════════════════════════════════════════════
// EQUIPMENT / DOCUMENT PROJECTION AUTHORITY (W5 — repair pass 2026-07-22)
// ───────────────────────────────────────────────────────────────────────────
// APP-A (pageSpecSheetReference) and DS-n MUST NOT hand-enter a parallel
// equipment spec DB. Every manufacturer value they display is PROJECTED here
// from the versioned verified record chain:
//     equipment-db record  (the value)   +   manufacturer-assets-db document
//     (the provenance + verification state).
// Each projected value carries: equipment record id, exact SKU, document
// record id, document revision/date, extracted field path, verification state.
//
// This is a READ-ONLY projection over two canonical static catalogues — it is
// NOT a new engine and performs no engineering calculation. It only resolves,
// labels, and stamps provenance onto values that already live in the catalogues.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import { MICROINVERTERS, SOLAR_PANELS, type Microinverter, type SolarPanel } from '@/lib/equipment-db';
import { getManufacturerAsset, type ManufacturerAsset } from '@/lib/manufacturer-assets-db';

// ─── Provenance primitives ──────────────────────────────────────────────────

export type VerificationState =
  | 'verified-document'       // value reconciled to a verified manufacturer document
  | 'equipment-db-unverified' // value present in equipment-db but no verified document on file
  | 'derived'                 // value computed from other record fields (labelled as such)
  | 'pending';                // value not available — must render PENDING, never a guess

export interface ValueProvenance {
  /** equipment-db canonical record id, e.g. 'enphase-iq8a'. */
  equipmentRecordId: string | null;
  /** exact manufacturer SKU, e.g. 'IQ8A-72-2-US'. */
  sku: string | null;
  /** manufacturer-assets-db document record id, e.g. 'microinverter_spec:enphase-iq8a'. */
  documentRecordId: string | null;
  /** document title / revision, e.g. 'IQ8 Series Microinverters Data Sheet (North America)'. */
  documentRevision: string | null;
  /** page / column reference within the document, e.g. 'p.2 spec table, column IQ8A-72-2-US'. */
  documentPageRef: string | null;
  /** canonical path the value was read from (audit trail). */
  extractedFieldPath: string;
  verification: VerificationState;
}

export interface ProjectedValue<T> {
  value: T;
  provenance: ValueProvenance;
}

// ─── Microinverter datasheet projection ─────────────────────────────────────

export interface MicroinverterDatasheetProjection {
  resolved: boolean;
  equipmentRecordId: string | null;
  sku: string | null;
  documentRecordId: string | null;
  documentRevision: string | null;
  documentPageRef: string | null;
  documentVerified: boolean;
  fields: {
    peakVa: ProjectedValue<number | null>;
    continuousVa: ProjectedValue<number | null>;
    maxContinuousCurrentA: ProjectedValue<number | null>;
    acVoltage: ProjectedValue<number | null>;
    dcInputWMax: ProjectedValue<number | null>;
    mpptMinV: ProjectedValue<number | null>;
    mpptMaxV: ProjectedValue<number | null>;
    maxDcInputCurrentA: ProjectedValue<number | null>;
    cecEfficiency: ProjectedValue<number | null>;
    weightLb: ProjectedValue<number | null>;
    maxUnitsPerBranch20A: ProjectedValue<number | null>;
    connector: ProjectedValue<string | null>;
    rapidShutdown: ProjectedValue<boolean | null>;
    warranty: ProjectedValue<string | null>;
  };
  /** compact, human-readable source line for the rendered table footer. */
  sourceLine: string;
}

/** Same fuzzy model match APP-A/BOM use, kept local so the projection is self-contained. */
function fuzzMicro(model?: string): Microinverter | undefined {
  const m = (model || '').toLowerCase().trim();
  if (!m) return undefined;
  return MICROINVERTERS.find(e => e.model.toLowerCase() === m)
    ?? MICROINVERTERS.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()));
}

function fuzzPanel(model?: string): SolarPanel | undefined {
  const m = (model || '').toLowerCase().trim();
  if (!m) return undefined;
  return SOLAR_PANELS.find(e => e.model.toLowerCase() === m)
    ?? SOLAR_PANELS.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()));
}

/**
 * Project the datasheet reference table for a microinverter MODEL string.
 * Every value is stamped with its verified-document provenance. Values that
 * are absent from the record project as PENDING (never a fabricated default).
 */
export function projectMicroinverterDatasheet(model: string | undefined): MicroinverterDatasheetProjection {
  const rec = fuzzMicro(model);
  const asset = rec ? getManufacturerAsset(rec.id, 'microinverter_spec') : null;
  const docVerified = !!asset?.verified;
  const eqId = rec?.id ?? null;
  const sku = rec?.partNumber ?? null;
  const docId = asset?.id ?? null;
  const docRev = asset?.docTitle ?? null;
  const docPage = asset?.pageRef ?? null;

  // A value that resolves to a record field, backed by a verified document,
  // is 'verified-document'; backed only by the record it is 'equipment-db-
  // unverified'; absent ⇒ 'pending'.
  const stateFor = (present: boolean): VerificationState =>
    !present ? 'pending' : docVerified ? 'verified-document' : 'equipment-db-unverified';

  const prov = (fieldPath: string, present: boolean): ValueProvenance => ({
    equipmentRecordId: eqId,
    sku,
    documentRecordId: docId,
    documentRevision: docRev,
    documentPageRef: docPage,
    extractedFieldPath: fieldPath,
    verification: stateFor(present),
  });

  const V = <T>(value: T | null | undefined, fieldPath: string): ProjectedValue<T | null> => {
    const present = value !== null && value !== undefined && !(typeof value === 'number' && !Number.isFinite(value));
    return { value: present ? (value as T) : null, provenance: prov(fieldPath, present) };
  };

  const fields: MicroinverterDatasheetProjection['fields'] = {
    peakVa:              V<number>(rec?.acOutputVaPeak, 'equipment-db#enphase-iq8a.acOutputVaPeak'),
    continuousVa:        V<number>(rec?.acOutputW, 'equipment-db#enphase-iq8a.acOutputW'),
    maxContinuousCurrentA: V<number>(rec?.acOutputCurrentMax, 'equipment-db#enphase-iq8a.acOutputCurrentMax'),
    acVoltage:           V<number>(rec?.acOutputVoltage, 'equipment-db#enphase-iq8a.acOutputVoltage'),
    dcInputWMax:         V<number>(rec?.dcInputWMax, 'equipment-db#enphase-iq8a.dcInputWMax'),
    mpptMinV:            V<number>(rec?.mpptVoltageMin, 'equipment-db#enphase-iq8a.mpptVoltageMin'),
    mpptMaxV:            V<number>(rec?.mpptVoltageMax, 'equipment-db#enphase-iq8a.mpptVoltageMax'),
    maxDcInputCurrentA:  V<number>(rec?.maxInputCurrent, 'equipment-db#enphase-iq8a.maxInputCurrent'),
    cecEfficiency:       V<number>(rec?.cec_efficiency, 'equipment-db#enphase-iq8a.cec_efficiency'),
    weightLb:            V<number>(rec?.weight, 'equipment-db#enphase-iq8a.weight'),
    maxUnitsPerBranch20A: V<number>(rec?.maxPerBranch20A, 'equipment-db#enphase-iq8a.maxPerBranch20A'),
    connector:           V<string>(rec?.connectorType, 'equipment-db#enphase-iq8a.connectorType'),
    rapidShutdown:       V<boolean>(rec?.rapidShutdownCompliant, 'equipment-db#enphase-iq8a.rapidShutdownCompliant'),
    warranty:            V<string>(rec?.warranty, 'equipment-db#enphase-iq8a.warranty'),
  };

  const host = asset?.sourceUrl
    ? (() => { try { return new URL(asset.sourceUrl!).hostname.replace(/^www\./, ''); } catch { return ''; } })()
    : '';
  const sourceLine = rec
    ? [
        `SOURCE: equipment record ${eqId}${sku ? ` (SKU ${sku})` : ''}`,
        docId ? `document ${docId} — ${[docRev, docPage, host].filter(Boolean).join(' · ')}` : 'no verified document on file',
        docVerified ? 'verification: VERIFIED DOCUMENT' : 'verification: EQUIPMENT-DB (document unverified)',
      ].join(' · ')
    : 'SOURCE: no matching equipment record — values PENDING';

  return {
    resolved: !!rec,
    equipmentRecordId: eqId,
    sku,
    documentRecordId: docId,
    documentRevision: docRev,
    documentPageRef: docPage,
    documentVerified: docVerified,
    fields,
    sourceLine,
  };
}

// ─── DS-n module datasheet exactness (W5 §3) ────────────────────────────────

export interface ModuleDatasheetExactness {
  asset: ManufacturerAsset | null;
  /** the exact selected module wattage, e.g. 400. */
  selectedWatts: number | null;
  /** true when the on-file document is the exact-wattage sheet (not a family/range page). */
  isExact: boolean;
  /** detected wattage range on the family sheet, e.g. [385, 405]; null when exact/none. */
  familyRange: [number, number] | null;
  /** rendered-state text for the page banner. */
  stateLabel: 'EXACT' | 'FAMILY-DATASHEET-PENDING' | 'NO-DOCUMENT';
}

const WATT_RANGE_RE = /(\d{3,4})\s*[–—-]\s*(\d{3,4})\s*W/i;

/**
 * Decide whether the module document on file is the exact selected-wattage
 * datasheet or a generic family/range page. A datasheet whose title carries a
 * wattage RANGE spanning more than the selected wattage (e.g. "385-405W") is a
 * family sheet and must render an explicit PENDING state — never presented as
 * the exact selection.
 */
export function resolveModuleDatasheetExactness(
  moduleModel: string | undefined,
  selectedWatts: number | null | undefined,
): ModuleDatasheetExactness {
  const rec = fuzzPanel(moduleModel);
  const asset = rec ? getManufacturerAsset(rec.id, 'module_spec') : null;
  const watts = (typeof selectedWatts === 'number' && Number.isFinite(selectedWatts)) ? selectedWatts : null;
  if (!asset) {
    return { asset: null, selectedWatts: watts, isExact: false, familyRange: null, stateLabel: 'NO-DOCUMENT' };
  }
  const m = (asset.docTitle ?? '').match(WATT_RANGE_RE) ?? (asset.model ?? '').match(WATT_RANGE_RE);
  if (m) {
    const lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      return { asset, selectedWatts: watts, isExact: false, familyRange: [lo, hi], stateLabel: 'FAMILY-DATASHEET-PENDING' };
    }
  }
  return { asset, selectedWatts: watts, isExact: true, familyRange: null, stateLabel: 'EXACT' };
}

// ─── Equipment / document blockers (for the snapshot readiness registry) ─────
// The closer wires these into build.ts → snapshot.permitReadiness.blockers.
// (Rendered directly by APP-A / DS-n today; also exported here so the canonical
// registry surfaces them alongside the other release blockers.)

export interface EquipmentDocumentBlocker {
  code: string;
  severity: 'blocking' | 'warning';
  authorityPath: string;
  affectedSheets: string[];
  explanation: string;
  resolutionAction: string;
  provenance: { source: string; equipmentRecordId: string | null; documentRecordId: string | null };
}

/**
 * Collect equipment/document readiness blockers for a permit input:
 *  - a selected microinverter with no verified document on file;
 *  - a module datasheet that is only a family/range page (exact-wattage doc pending).
 */
export function collectEquipmentDocumentBlockers(input: PermitInput): EquipmentDocumentBlocker[] {
  const out: EquipmentDocumentBlocker[] = [];
  const { system } = input;

  for (const inv of system.inverters ?? []) {
    if (inv.type !== 'micro') continue;
    const proj = projectMicroinverterDatasheet(inv.model);
    if (proj.resolved && !proj.documentVerified) {
      out.push({
        code: 'EQUIPMENT-DOCUMENT-UNVERIFIED',
        severity: 'warning',
        authorityPath: `equipment-db#${proj.equipmentRecordId} → manufacturer-assets-db`,
        affectedSheets: ['APP-A'],
        explanation: `Microinverter ${inv.manufacturer} ${inv.model} (${proj.sku ?? 'SKU pending'}) has no verified manufacturer document on file; APP-A values project from the equipment record only.`,
        resolutionAction: 'Attach and verify the exact manufacturer datasheet for this SKU.',
        provenance: { source: 'equipmentProjection', equipmentRecordId: proj.equipmentRecordId, documentRecordId: proj.documentRecordId },
      });
    }
  }

  // Module exact-document check (one per distinct module model).
  const seen = new Set<string>();
  for (const inv of system.inverters ?? []) {
    for (const str of inv.strings ?? []) {
      const model = str?.panelModel;
      if (!model || seen.has(model)) continue;
      seen.add(model);
      const ex = resolveModuleDatasheetExactness(model, str?.panelWatts ?? null);
      if (ex.stateLabel === 'FAMILY-DATASHEET-PENDING') {
        out.push({
          code: 'MODULE-EXACT-DATASHEET-PENDING',
          // §17 — BLOCKING: the exact selected-module electrical/mechanical source is
          // permit-critical (drives conductor sizing / structural inputs / AHJ
          // acceptance). Authoritative severity is set by severityPolicy.ts; this
          // field is documentary intent and kept in sync.
          severity: 'blocking',
          authorityPath: `equipment-db(module) → manufacturer-assets-db#${ex.asset?.id ?? 'none'}`,
          affectedSheets: ['DS-1'],
          explanation: `Module ${model} (${ex.selectedWatts ?? '?'} W): the on-file document is the ${ex.familyRange?.[0]}–${ex.familyRange?.[1]} W family datasheet, not the exact ${ex.selectedWatts ?? ''} W sheet.`,
          resolutionAction: `Attach the exact ${ex.selectedWatts ?? ''} W module datasheet (or a single-wattage crop).`,
          provenance: { source: 'equipmentProjection', equipmentRecordId: ex.asset?.equipmentId ?? null, documentRecordId: ex.asset?.id ?? null },
        });
      }
    }
  }

  return out;
}
