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
import { resolveModuleDatasheetExactness, type ModuleDatasheetExactness } from '../equipmentProjection';

export type ModuleDatasheetCoverageState =
  | 'EXACT'
  | 'RANGE-COVERED'
  | 'RANGE-NOT-COVERED'
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
  /** the document that is genuinely missing (null ⇒ nothing missing). */
  missingDocument: string | null;
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

const state = (ex: ModuleDatasheetExactness): ModuleDatasheetCoverageState => {
  if (ex.stateLabel === 'NO-DOCUMENT') return 'NO-DOCUMENT';
  if (ex.stateLabel === 'EXACT') return 'EXACT';
  return ex.coversSelectedWatts === true ? 'RANGE-COVERED' : 'RANGE-NOT-COVERED';
};

/**
 * Evaluate datasheet coverage for every distinct module in the fleet. PURE —
 * the registry lookup is injected, so tests prove both the offline (table
 * absent) and the bound cases with no database.
 */
export function evaluateModuleDatasheetBinding(
  input: PermitInput,
  registryLookup?: (args: { model: string; watts: number | null }) => { boundDocumentId: string | null; failure: string | null },
): ModuleDatasheetBindingAuthority {
  const seen = new Set<string>();
  const modules: ModuleDatasheetCoverage[] = [];

  for (const inv of input.system?.inverters ?? []) {
    for (const s of inv?.strings ?? []) {
      const model = s?.panelModel;
      if (!model || seen.has(model)) continue;
      seen.add(model);
      const watts = typeof s?.panelWatts === 'number' ? s.panelWatts : null;
      const ex = resolveModuleDatasheetExactness(model, watts);
      const lookup = registryLookup ? registryLookup({ model, watts }) : null;
      modules.push({
        moduleModel: model,
        selectedWatts: ex.selectedWatts,
        state: state(ex),
        documentTitle: ex.asset?.docTitle ?? null,
        documentSourceUrl: ex.asset?.sourceUrl ?? null,
        familyRange: ex.familyRange,
        coversSelectedWatts: ex.coversSelectedWatts,
        basis: ex.coverageBasis,
        missingDocument: lookup?.boundDocumentId ? null : ex.missingDocument,
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

  const bound = modules.filter(m => m.state === 'EXACT' || m.registryLookup.boundDocumentId).map(m => m.moduleModel);
  const pending = modules.filter(m => !(m.state === 'EXACT' || m.registryLookup.boundDocumentId)).map(m => m.moduleModel);

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
