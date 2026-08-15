// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-2 — MODULE DATASHEET BINDING (the AUTO_DERIVED half, pure)
// ───────────────────────────────────────────────────────────────────────────
// Audit §2.5: MODULE-EXACT-DATASHEET-PENDING fires whenever the on-file document
// title carries a wattage RANGE — and the selected wattage is NEVER compared
// against that range. A 400 W module with a "385-405 W" series sheet and a 400 W
// module with a "500-600 W" sheet were treated identically, and a module with NO
// document at all emitted nothing (equipmentProjection.ts:203) — the check was
// inverted in effect.
//
// THIS MODULE re-runs the exact-datasheet resolution against the canonical module
// identity and produces the honest state:
//
//   • RANGE-COVERED  — the manufacturer's own series document covers the selected
//                      wattage. The exact-wattage column EXISTS in that document;
//                      what is missing is the REGISTRY BINDING naming the page /
//                      column. The requirement legitimately REMAINS (a document
//                      binding is the AUTO_RETRIEVED half, AAC-3/AAC-5), but its
//                      state now records the attempted retrieval and the exact
//                      missing document instead of a bare "pending".
//   • RANGE-NOT-COVERED — the document genuinely does not cover the selection.
//   • NO-DOCUMENT       — nothing is on file.
//   • EXACT             — the on-file document IS the exact-model datasheet.
//
// NOTHING here clears a requirement by weakening it: the derived half narrows the
// reason, and the registry lookup seam is registered so the retrieval half plugs
// in behind the same resolver id.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../../types';
import { resolveModuleDatasheetExactness } from '../equipmentProjection';
// CMDA — THE canonical module applicability authority. This module PROJECTS it.
import {
  noModuleDocumentAuthority, type ModuleDatasheetApplicabilityAuthority,
} from '../moduleDocumentAuthority';

export type ModuleDatasheetCoverageState =
  | 'EXACT'
  | 'RANGE-COVERED'
  | 'RANGE-NOT-COVERED'
  /** D8 — an asset is on file but states no coverage either way. Unproven, which
   *  is not the same as exact, and was previously reported as EXACT. */
  | 'UNEVIDENCED'
  | 'NO-DOCUMENT';

export interface ModuleDatasheetCoverage {
  /** the module model as it appears in the (canonical) fleet. */
  moduleModel: string;
  selectedWatts: number | null;
  state: ModuleDatasheetCoverageState;
  /** the document on file, when there is one. */
  documentTitle: string | null;
  documentSourceUrl: string | null;
  familyRange: [number, number] | null;
  /** true when the on-file document covers the selected wattage. */
  coversSelectedWatts: boolean | null;
  /** the precise reason, from the (single-sourced) exactness resolution. */
  basis: string;
  /** D8 — WHAT established exactness. `'registry'` only ever accompanies
   *  `state: 'EXACT'`; a static asset is always `'none'`. */
  exactnessAuthority: 'registry' | 'none';
  /** wattages a multi-wattage sheet names (Panasonic "410W/400W"). */
  familyWattages: number[] | null;
  /** models a multi-model sheet names (Tesla "TSP-415/TSP-420"). */
  familyModels: string[] | null;
  /** the document that is genuinely missing (null ⇒ nothing missing). */
  missingDocument: string | null;
  /** ═══ CMDA — THE CANONICAL VERDICT ═══════════════════════════════════════
   *  THE authority for this module. Every field above is a PROJECTION of it.
   *  Any consumer asking "is the selected module's datasheet applicable?" must
   *  read this object (or `snapshot.moduleDocumentAuthority`, which carries the
   *  same frozen values) and must not re-decide from a title, a filename, a
   *  model substring or the presence of a document id. */
  applicability: ModuleDatasheetApplicabilityAuthority;
  /** the registry lookup this coverage evaluation ATTEMPTED. */
  registryLookup: {
    attempted: boolean;
    documentClass: string;
    equipmentModel: string;
    /** the resolved registry document id, when one was found. */
    boundDocumentId: string | null;
    /** the EXACT failure when the lookup did not resolve (never swallowed). */
    failure: string | null;
  };
}

export interface ModuleDatasheetBindingAuthority {
  /** one entry per DISTINCT module model in the canonical fleet. */
  modules: ModuleDatasheetCoverage[];
  /** models whose exact-wattage source is established (EXACT, or bound in the
   *  registry). These are the ones that would clear the requirement. */
  boundModels: string[];
  /** models whose requirement legitimately remains, with the reason. */
  pendingModels: string[];
  /** true ⇔ every module has an established exact-wattage source. */
  allBound: boolean;
  basis: string;
}

/** The document class the exact-wattage binding must live in (lib/documents). */
export const MODULE_DATASHEET_DOCUMENT_CLASS = 'module_datasheet';

/**
 * D8 — THE BOUND RULE, stated ONCE and exported so no consumer can restate it
 * differently. A module's exact-wattage source is established when, and only
 * when, a VERIFIED, current registry document names it.
 *
 * The rule used to be `state === 'EXACT' || boundDocumentId`, written out
 * separately here and in `moduleDatasheetBindingResolver`. Because `EXACT` was
 * granted by a title heuristic over an unhashed static asset, both copies could
 * report a module bound with an empty archive and no lookup performed at all.
 */
/**
 * CMDA — ESTABLISHED means the CANONICAL AUTHORITY cleared it.
 *
 * This used to be `registryLookup.boundDocumentId != null` — the mere PRESENCE
 * of a bound id. A document could be archived, hashed, marked verified and
 * matched on nothing more than `equipment_model_applicability LIKE '%<model>%'`,
 * and this returned true with no proof it covered the selected 400 W variant.
 *
 * The verdict now comes from `evaluateModuleDatasheetApplicability`, which reads
 * the governed structured claims off the SAME registry row whose identity, hash
 * and verification are cited. This function only reports it.
 */
export function moduleSourceIsEstablished(m: ModuleDatasheetCoverage): boolean {
  return m.applicability?.clears === true;
}

// D8 — the coverage state is a projection of the ONE evaluator's verdict, which
// already folded the registry binding in. `EXACT` therefore arrives here only
// when a verified registry row bound the selection; it can no longer be produced
// by a static asset whose title happens to state no wattage range.
/** CMDA — the legacy coverage vocabulary, PROJECTED from the canonical state.
 *  Kept so existing consumers and tests keep reading the words they know, while
 *  the decision itself has exactly one owner. `EXACT` and `RANGE-COVERED` both
 *  now mean CLEARED — a family document that explicitly includes the selection
 *  is a real source, and the old rule that only `EXACT` counted was the false
 *  exact-document requirement this phase removes. */
export function coverageStateOf(a: ModuleDatasheetApplicabilityAuthority): ModuleDatasheetCoverageState {
  switch (a.state) {
    case 'EXACT_VARIANT': return 'EXACT';
    case 'FAMILY_COVERED': return 'RANGE-COVERED';
    case 'NOT_COVERED': return 'RANGE-NOT-COVERED';
    case 'NO_DOCUMENT': return 'NO-DOCUMENT';
    default: return 'UNEVIDENCED';
  }
}

/**
 * Evaluate datasheet coverage for every distinct module in the fleet. PURE —
 * the registry lookup is injected, so tests prove both the offline (table
 * absent) and the bound cases with no database.
 */
export function evaluateModuleDatasheetBinding(
  input: PermitInput,
  registryLookup?: (args: { model: string; watts: number | null }) => {
    boundDocumentId: string | null;
    failure: string | null;
    /** CMDA — THE canonical verdict for this module, produced by
     *  `evaluateModuleDatasheetApplicability` from the SAME registry row whose
     *  identity and hash are reported. When the caller performs no lookup this
     *  is absent and the module is honestly unestablished. */
    applicability?: ModuleDatasheetApplicabilityAuthority | null;
  },
): ModuleDatasheetBindingAuthority {
  const seen = new Set<string>();
  const modules: ModuleDatasheetCoverage[] = [];

  for (const inv of input.system?.inverters ?? []) {
    for (const s of inv?.strings ?? []) {
      const model = s?.panelModel;
      if (!model || seen.has(model)) continue;
      seen.add(model);
      const watts = typeof s?.panelWatts === 'number' ? s.panelWatts : null;
      const lookup = registryLookup ? registryLookup({ model, watts }) : null;
      // CMDA — the LEGACY exactness helper still runs, but ONLY to carry the
      // presentation fields it always carried (the static asset's title and
      // source url). It no longer decides anything: `state` and the established
      // verdict come from the canonical applicability authority below. It may
      // never clear a release requirement again.
      const ex = resolveModuleDatasheetExactness(model, watts, null);
      const applicability = lookup?.applicability
        ?? noModuleDocumentAuthority(
          { equipmentId: null, manufacturer: null, model, watts },
          registryLookup
            ? (lookup?.failure ?? 'no governed module_datasheet registry document covers the selected module')
            : 'no registry lookup was performed on this path — module applicability is not established here',
        );
      modules.push({
        moduleModel: model,
        selectedWatts: watts,
        state: coverageStateOf(applicability),
        // presentation only — the static asset the DS appendix prints
        documentTitle: applicability.documentTitle ?? ex.asset?.docTitle ?? null,
        documentSourceUrl: ex.asset?.sourceUrl ?? null,
        familyRange: applicability.coveredRange
          ? [applicability.coveredRange.minWatts, applicability.coveredRange.maxWatts]
          : null,
        coversSelectedWatts: applicability.state === 'NO_DOCUMENT' || applicability.state === 'EVIDENCE_INCOMPLETE'
          ? null
          : applicability.clears,
        basis: applicability.basis,
        exactnessAuthority: applicability.clears ? 'registry' : 'none',
        familyWattages: applicability.coveredWattages,
        familyModels: applicability.coveredModels,
        missingDocument: applicability.clears
          ? null
          : `governed module_datasheet registry claims covering ${model} at ${watts ?? '?'} W (product/family, wattage and evidence location)`,
        applicability,
        registryLookup: {
          attempted: !!registryLookup,
          documentClass: MODULE_DATASHEET_DOCUMENT_CLASS,
          equipmentModel: model,
          boundDocumentId: lookup?.boundDocumentId ?? null,
          failure: lookup?.failure ?? (registryLookup ? null : 'no registry lookup was performed'),
        },
      });
    }
  }

  const bound = modules.filter(moduleSourceIsEstablished).map(m => m.moduleModel);
  const pending = modules.filter(m => !moduleSourceIsEstablished(m)).map(m => m.moduleModel);

  return {
    modules,
    boundModels: bound,
    pendingModels: pending,
    allBound: modules.length > 0 && pending.length === 0,
    basis: modules.length
      ? modules.map(m => `${m.moduleModel}: ${m.state}${m.missingDocument ? ` — missing ${m.missingDocument}` : ''}`).join(' · ')
      : 'no module model is present in the fleet',
  };
}
