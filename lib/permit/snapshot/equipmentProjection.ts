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
  stateLabel: 'EXACT' | 'FAMILY-DATASHEET-PENDING' | 'UNEVIDENCED-DATASHEET-PENDING' | 'NO-DOCUMENT';

  // ── D8 — WHAT ESTABLISHED EXACTNESS ────────────────────────────────────────
  /** `'registry'` ⇔ a VERIFIED, current `module_datasheet` registry row binds
   *  this selection. `'none'` for every other case, INCLUDING a static asset
   *  whose title happens to state no wattage range — the absence of a range in a
   *  marketing title is not evidence of anything. Only the registry may make
   *  this `'registry'`, so `isExact` is unreachable from the asset library
   *  alone. (D7 established the same rule for equipment documents: an asset
   *  carries no hash and no verification, so it can never be authoritative.) */
  exactnessAuthority: 'registry' | 'none';
  /** wattages a multi-wattage sheet explicitly names, e.g. [400, 410] for
   *  "410W/400W"; null when the title names no wattage set. */
  familyWattages: number[] | null;
  /** models a multi-model sheet explicitly names, e.g. ['TSP-415','TSP-420'];
   *  null when the title names no model set. */
  familyModels: string[] | null;

  // ── AAC WS-2 (additive; stateLabel semantics deliberately UNCHANGED so no
  //    rendered sheet and no digest moves) ─────────────────────────────────────
  /** Does the on-file family/range document actually COVER the selected wattage?
   *  Audit §2.5: the selected wattage was never compared against the parsed
   *  [lo,hi] the document title already states, so a 400 W module with a
   *  "385-405 W" sheet and a 400 W module with a "500-600 W" sheet were treated
   *  identically. `true` ⇒ the manufacturer's own series sheet covers this
   *  wattage (Qcells publishes one series sheet with a per-wattage column);
   *  `false` ⇒ the document genuinely does not cover the selection;
   *  `null` ⇒ not applicable (exact sheet, no document, or unknown wattage). */
  coversSelectedWatts: boolean | null;
  /** WHY, in one sentence — the precise reason, never "pending". */
  coverageBasis: string;
  /** The document that is genuinely MISSING, named exactly (empty when the
   *  requirement is not document-blocked). */
  missingDocument: string | null;
}

// ─── D8 — the title parser ──────────────────────────────────────────────────
// It EXPLAINS a coverage gap. It never decides authority. Everything below is
// read off a marketing title, which is exactly why none of it may produce
// `isExact`. Widening these patterns can only ever make a reason more precise;
// it can never clear a requirement.

/** A wattage span. The `W` suffix is OPTIONAL: LONGi publishes
 *  "LR5-72HTD 550-580M", which is a series range with no `W` anywhere. */
const WATT_RANGE_RE = /\b(\d{3,4})\s*[–—-]\s*(\d{3,4})\s*(?:W|M|Wp)?\b/i;
/** Two wattages a single sheet names, e.g. Panasonic "410W/400W". */
const WATT_SET_RE = /\b(\d{3,4})\s*W\s*\/\s*(\d{3,4})\s*W\b/i;
/** Two models a single sheet names, e.g. Tesla "(TSP-415/TSP-420)". */
const MODEL_SET_RE = /\b([A-Z][A-Z0-9]{1,7}-\d{2,4})\s*\/\s*([A-Z][A-Z0-9]{1,7}-\d{2,4})\b/;

/** Module wattages live in a knowable band. Without this guard the looser range
 *  pattern reads "2024-2025" in "Series 2024-2025 Product Guide" as 2024-2025 W,
 *  and a catalogue year becomes a fabricated coverage claim. */
const PLAUSIBLE_W_LO = 50;
const PLAUSIBLE_W_HI = 1000;
const plausibleSpan = (lo: number, hi: number) =>
  Number.isFinite(lo) && Number.isFinite(hi) && hi > lo
  && lo >= PLAUSIBLE_W_LO && hi <= PLAUSIBLE_W_HI && hi - lo <= 300;

/** D8 — the registry side of the single evaluator. A VERIFIED, current
 *  `module_datasheet` row naming this selection is the ONLY thing that can
 *  establish exactness. */
export interface ModuleDatasheetRegistryBinding {
  boundDocumentId: string | null;
  /** the page/column the binding names, when the registry records one. */
  pageRef?: string | null;
}

/**
 * THE ONE MODULE-DATASHEET EVALUATOR (D8).
 *
 * Exactness is a function of (registry binding, static-asset evidence) — in that
 * order, and the second term can only ever *explain* a gap, never close one.
 *
 *   EXACT                          a verified registry row binds this selection
 *   FAMILY-DATASHEET-PENDING       the title names a range / wattage set / model
 *                                  set, so the document demonstrably covers more
 *                                  than the selection
 *   UNEVIDENCED-DATASHEET-PENDING  an asset is on file and states nothing either
 *                                  way — unproven, which is NOT the same as exact
 *   NO-DOCUMENT                    nothing on file
 *
 * WHAT CHANGED AND WHY (D8). This function used to return `EXACT` from the
 * *absence* of a regex match, so a static asset with no hash, no verification
 * and no page evidence cleared the exact-datasheet requirement — on the live
 * library that included the Tesla sheet covering TSP-415 **and** TSP-420, and
 * LONGi's 550-580M series sheet. `EXACT` is now unreachable without `binding`.
 */
export function resolveModuleDatasheetExactness(
  moduleModel: string | undefined,
  selectedWatts: number | null | undefined,
  /** the registry binding, when the caller has performed the lookup. Render
   *  paths pass nothing and therefore can never report EXACT. */
  binding?: ModuleDatasheetRegistryBinding | null,
  /** an explicit asset, for testing a title pattern without a catalogue row. */
  assetOverride?: ManufacturerAsset | null,
): ModuleDatasheetExactness {
  const rec = fuzzPanel(moduleModel);
  const asset = assetOverride ?? (rec ? getManufacturerAsset(rec.id, 'module_spec') : null);
  const watts = (typeof selectedWatts === 'number' && Number.isFinite(selectedWatts)) ? selectedWatts : null;
  const boundId = binding?.boundDocumentId ?? null;

  // ── 1 — THE REGISTRY BINDING. The only path to EXACT. ────────────────────
  if (boundId) {
    const where = binding?.pageRef ? ` (${binding.pageRef})` : '';
    return {
      asset, selectedWatts: watts, isExact: true, familyRange: null,
      stateLabel: 'EXACT', exactnessAuthority: 'registry',
      familyWattages: null, familyModels: null,
      coversSelectedWatts: true,
      coverageBasis: `registry document '${boundId}'${where} is the VERIFIED, current module_datasheet bound to ${watts ?? '?'} W for '${moduleModel ?? 'the selected module'}'`,
      missingDocument: null,
    };
  }

  const pending = (over: Partial<ModuleDatasheetExactness> & { coverageBasis: string; missingDocument: string | null }): ModuleDatasheetExactness => ({
    asset, selectedWatts: watts, isExact: false, familyRange: null,
    stateLabel: 'FAMILY-DATASHEET-PENDING', exactnessAuthority: 'none',
    familyWattages: null, familyModels: null, coversSelectedWatts: null,
    ...over,
  });

  // ── 2 — nothing on file ──────────────────────────────────────────────────
  if (!asset) {
    return pending({
      stateLabel: 'NO-DOCUMENT',
      coverageBasis: `no manufacturer module_spec document is on file for '${moduleModel ?? 'unresolved module'}'`,
      missingDocument: `manufacturer module datasheet for '${moduleModel ?? 'the selected module'}'`,
    });
  }

  const title = asset.docTitle ?? asset.model ?? '';
  const named = asset.docTitle ?? asset.model;

  // ── 3a — an explicit wattage SET ("410W/400W") ───────────────────────────
  const setM = title.match(WATT_SET_RE) ?? (asset.model ?? '').match(WATT_SET_RE);
  if (setM) {
    const ws = [parseInt(setM[1], 10), parseInt(setM[2], 10)]
      .filter(n => Number.isFinite(n) && n >= PLAUSIBLE_W_LO && n <= PLAUSIBLE_W_HI)
      .sort((a, b) => a - b);
    if (ws.length === 2) {
      const covers = watts == null ? null : ws.includes(watts);
      return pending({
        familyWattages: ws, coversSelectedWatts: covers,
        coverageBasis: `the on-file document '${named}' is a MULTI-WATTAGE sheet naming ${ws.join(' W and ')} W`
          + (watts == null
            ? ', and the selected module wattage is unknown'
            : covers
              ? ` — the selected ${watts} W is one of them, so its column exists in this document, but no registry binding names it`
              : ` — the selected ${watts} W is NOT among them, so this document is not the source for the selected module`),
        missingDocument: covers
          ? `registry binding (document_class 'module_datasheet') naming the exact ${watts} W page/column of '${named}'`
          : `manufacturer datasheet covering exactly ${watts ?? '?'} W for '${asset.model ?? moduleModel}'`,
      });
    }
  }

  // ── 3b — a wattage RANGE ("385-405W", "550-580M") ────────────────────────
  const m = title.match(WATT_RANGE_RE) ?? (asset.model ?? '').match(WATT_RANGE_RE);
  if (m) {
    const lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
    if (plausibleSpan(lo, hi)) {
      // AAC WS-2 — the RANGE COMPARISON the audit found missing. A covering
      // series sheet is still not the exact-wattage BINDING (which names the
      // page/column and is the AUTO_RETRIEVED half), so the requirement
      // legitimately remains — but the reason is precise, and the two genuinely
      // different situations are distinguishable.
      const covers = watts == null ? null : (watts >= lo && watts <= hi);
      return pending({
        familyRange: [lo, hi], coversSelectedWatts: covers,
        coverageBasis: watts == null
          ? `the on-file document '${named}' states a ${lo}-${hi} W series range, and the selected module wattage is unknown`
          : covers
            ? `the on-file series document '${named}' covers ${lo}-${hi} W and the selected ${watts} W falls INSIDE that range — the exact-wattage column exists in this document but no registry binding names it`
            : `the on-file document '${named}' covers ${lo}-${hi} W, and the selected ${watts} W is OUTSIDE that range — this document is not the source for the selected module`,
        missingDocument: covers
          ? `registry binding (document_class 'module_datasheet') naming the exact ${watts} W page/column of '${named}'`
          : `manufacturer datasheet covering exactly ${watts ?? '?'} W for '${asset.model ?? moduleModel}'`,
      });
    }
  }

  // ── 3c — an explicit MODEL set ("TSP-415/TSP-420") ───────────────────────
  const modelM = title.match(MODEL_SET_RE);
  if (modelM) {
    const models = [modelM[1], modelM[2]];
    return pending({
      familyModels: models,
      coverageBasis: `the on-file document '${named}' is a MULTI-MODEL sheet covering ${models.join(' and ')} — one document for more than one product, so it is not the exact-model sheet for '${asset.model ?? moduleModel}' and no registry binding names which column applies`,
      missingDocument: `registry binding (document_class 'module_datasheet') naming the exact ${asset.model ?? moduleModel ?? 'selected model'} page/column of '${named}'`,
    });
  }

  // ── 4 — an asset with no coverage evidence either way ────────────────────
  // NOT exact. The asset library is a render cache: it carries no hash, no
  // verification and no page reference, so it cannot testify that this document
  // is the exact-wattage source. Saying "unproven" is the honest state; saying
  // "EXACT" was the defect.
  return pending({
    stateLabel: 'UNEVIDENCED-DATASHEET-PENDING',
    coverageBasis: `the on-file document '${named}' states no wattage coverage either way, and the manufacturer-asset entry carries no hash, no verification and no page reference — it cannot establish that this is the exact ${watts ?? '?'} W source`,
    missingDocument: `registry binding (document_class 'module_datasheet') naming the exact ${watts ?? '?'} W page/column for '${asset.model ?? moduleModel}'`,
  });
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

/** D8 — the registry verdict, when the caller holds one. Structural rather than
 *  a named import, so `equipmentProjection` (which `datasheetBinding` imports)
 *  acquires no dependency on it. */
export interface ModuleBindingProjection {
  modules: ReadonlyArray<{
    moduleModel: string;
    registryLookup: { boundDocumentId: string | null };
    /** CMDA — THE canonical verdict. Structural (not a named import) for the
     *  same reason the rest of this interface is: `datasheetBinding` imports
     *  this module, so this module may not import it back. */
    applicability?: {
      clears: boolean;
      state: string;
      basis: string;
      selectedWatts: number | null;
      documentId: string | null;
    } | null;
  }>;
}

/**
 * Collect equipment/document readiness blockers for a permit input:
 *  - a selected microinverter with no verified document on file;
 *  - a module whose exact-wattage source is not established.
 *
 * D8 — `binding` is the registry verdict from `module-datasheet-binding@v1`.
 * A module it reports BOUND raises nothing, because a verified registry document
 * names that selection. Everything else raises the requirement, whatever the
 * static asset's title happens to look like. The binding can therefore only ever
 * ESTABLISH a source; it can never suppress a gap the static evidence shows.
 */
export function collectEquipmentDocumentBlockers(
  input: PermitInput,
  binding?: ModuleBindingProjection | null,
): EquipmentDocumentBlocker[] {
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

  // ══ CMDA — THE BLOCKER IS A PROJECTION, NOT A SECOND OPINION ═════════════
  // This loop used to decide module applicability for itself, by running
  // `resolveModuleDatasheetExactness` over a STATIC ASSET's marketing title, and
  // it suppressed the blocker on the mere PRESENCE of a bound document id. Two
  // independent deciders, neither of which had looked at what the document
  // actually claims.
  //
  // The canonical authority now owns the verdict. When the binding is present
  // (the real permit path) this loop reports it verbatim. When it is absent
  // (a render-only path with no registry access) it raises the honest
  // "not established here" blocker and never claims coverage.
  const canonicalByModel = new Map(
    (binding?.modules ?? []).map(m => [m.moduleModel, m.applicability]),
  );
  const seen = new Set<string>();
  for (const inv of system.inverters ?? []) {
    for (const str of inv.strings ?? []) {
      const model = str?.panelModel;
      if (!model || seen.has(model)) continue;
      seen.add(model);
      const canonicalVerdict = canonicalByModel.get(model) ?? null;
      if (canonicalVerdict) {
        // PROJECTION ONLY — the canonical authority cleared it, or it did not.
        if (canonicalVerdict.clears) continue;
        const w = canonicalVerdict.selectedWatts ?? '?';
        out.push({
          code: 'MODULE-EXACT-DATASHEET-PENDING',
          severity: 'blocking',
          authorityPath: 'snapshot.moduleDocumentAuthority (canonical module applicability)',
          affectedSheets: ['DS-1'],
          explanation: `Module ${model} (${w} W): ${canonicalVerdict.basis}`,
          resolutionAction: canonicalVerdict.state === 'NO_DOCUMENT'
            ? `Register the manufacturer datasheet for ${model} as document_class 'module_datasheet', verify it, and record its structured module coverage claims (product/family, wattages, evidence location).`
            : canonicalVerdict.state === 'NOT_COVERED'
              ? `Register a manufacturer datasheet whose governed claims cover ${model} at ${w} W — the document on file explicitly does not.`
              : `Complete the governed module coverage claims on registry document '${canonicalVerdict.documentId ?? 'the module datasheet'}' (product/family, wattage, evidence location, electrical+mechanical specifications present).`,
          provenance: { source: 'moduleDocumentAuthority', equipmentRecordId: null, documentRecordId: canonicalVerdict.documentId },
        });
        continue;
      }
      // D8 — with no binding this path has NO registry access, so it can never see EXACT. That is
      // correct and deliberate: it states the document gap from static evidence,
      // and `module-datasheet-binding@v1` — which does hold the registry lookup —
      // is what clears the requirement it raises. What it must never do is stay
      // SILENT, which is exactly what it did for every state but the family one:
      // a module with no datasheet at all, and a module whose asset title merely
      // lacked a wattage range, both produced no requirement, so RG-2 had nothing
      // to fail on and passed vacuously.
      // ── CMDA — NO BINDING ⇒ NOT ESTABLISHED. FULL STOP. ──────────────────
      // This branch used to run `resolveModuleDatasheetExactness` over a static
      // asset's marketing title and compose five different verdicts from it
      // ("the on-file document is the 385–405 W family datasheet, not the exact
      // 400 W sheet"). That was a SECOND applicability decision, made from the
      // weakest possible evidence, and it is the wording that told operators to
      // attach a 400 W PDF that never needed to exist.
      //
      // A path with no registry access cannot answer the question. It says so.
      const w = typeof str?.panelWatts === 'number' ? str.panelWatts : '?';
      out.push({
        code: 'MODULE-EXACT-DATASHEET-PENDING',
        // §17 — BLOCKING: the exact selected-module electrical/mechanical source is
        // permit-critical (drives conductor sizing / structural inputs / AHJ
        // acceptance). Authoritative severity is set by severityPolicy.ts; this
        // field is documentary intent and kept in sync.
        severity: 'blocking',
        authorityPath: 'snapshot.moduleDocumentAuthority (canonical module applicability)',
        affectedSheets: ['DS-1'],
        explanation: `Module ${model} (${w} W): module datasheet applicability is NOT ESTABLISHED on this path — `
          + 'no governed registry evaluation was performed, and a manufacturer asset title is not authority.',
        resolutionAction: `Register the manufacturer datasheet for ${model} as document_class 'module_datasheet', `
          + 'verify it through the governed verification policy, and record its structured module coverage claims '
          + '(product/family, wattages covered, evidence location).',
        provenance: { source: 'moduleDocumentAuthority', equipmentRecordId: null, documentRecordId: null },
      });
    }
  }

  return out;
}
