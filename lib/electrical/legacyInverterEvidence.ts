// ═══════════════════════════════════════════════════════════════════════════
// 🚨 GATHER THE EVIDENCE A LEGACY ROW CAN OFFER ABOUT ITS INVERTER.
//
// This file exists because of one constraint that must not be bent:
// `resolveElectricalProject` READS NO CATALOGUE. That is what lets the same function answer in the
// browser for the sidebar and on the server for the permit and give the same answer.
//
// But the question "could the ecosystem auto-select have produced this inverter?" is a question
// ABOUT the catalogue. So the catalogue read happens here, in the load path, exactly as
// `hydrateInstances` resolves manufacturer facts there — and the resolver receives a finished
// verdict, not a lookup.
// ═══════════════════════════════════════════════════════════════════════════

import { getEquipmentByEcosystem, getBatteryById } from '@/lib/equipment-db';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  classifyLegacyInverterSelection,
  type LegacyInverterEvidence,
  type LegacyInverterClassification,
} from '@/lib/electrical/equipmentProvenance';

/**
 * 🚨 WHICH ECOSYSTEM IS THIS PROJECT IN? Answered from the PHYSICAL STORAGE IN THE GRAPH.
 *
 * Not from a persisted "ecosystem" field — there is no trustworthy one, and the ecosystem that
 * matters for this analysis is the one whose apply ran. The storage instances name their products,
 * and the catalogue row for a product names its `ecosystemBrand`. On Ray's project that reads
 * `tesla` from four `tesla-powerwall-3` nodes, which is the ecosystem he switched to and therefore
 * the one whose auto-select fired.
 *
 * Returns null when the graph holds no storage whose product resolves — in which case no evidence
 * about an auto-pick can be reconstructed, and the classifier says so rather than guessing.
 */
export function ecosystemBrandOfStorage(t: ServiceTopology | null): string | null {
  if (!t) return null;
  const brands = new Set<string>();
  for (const u of t.storage ?? []) {
    const row = getBatteryById(u.productId) as { ecosystemBrand?: string } | undefined;
    const brand = (row?.ecosystemBrand ?? '').trim().toLowerCase();
    if (brand) brands.add(brand);
  }
  // 🚨 ONE BRAND, OR NO ANSWER. A graph holding two ecosystems' storage is a real thing (Ray's
  // hybrid jobs), and "the ecosystem" is then not a single value. Returning one of them would make
  // the evidence depend on node ordering — the exact class of defect the branch-ordering fix closed.
  return brands.size === 1 ? [...brands][0] : null;
}

/**
 * Gather the evidence and classify it. Deterministic for a given row and catalogue.
 *
 * `storageTakesPvOnDc` is passed in rather than recomputed: the caller already has the hydrated
 * graph, and `takesPvOnDc` lives with the model. Recomputing it here from a second predicate is how
 * two answers to one question get born.
 */
export function classifyLegacyInverter(opts: {
  inverterId: string | null;
  provenanceRecorded: boolean;
  topology: ServiceTopology | null;
  pvCapableUnitCount: number;
}): LegacyInverterClassification {
  const ecosystemBrand = ecosystemBrandOfStorage(opts.topology);
  const kit = ecosystemBrand ? getEquipmentByEcosystem(ecosystemBrand) : null;
  const ecosystemStringInverterIds = (kit?.stringInverters ?? []).map(i => i.id);

  const evidence: LegacyInverterEvidence = {
    provenanceRecorded: opts.provenanceRecorded,
    inverterId: opts.inverterId,
    // The auto-select's literal expression, from `EcosystemPicker.tsx`: `kit.stringInverters[0]?.id`.
    autoPickWouldHaveChosen: ecosystemStringInverterIds[0] ?? null,
    ecosystemStringInverterIds,
    ecosystemBrand,
    storageTakesPvOnDc: opts.pvCapableUnitCount > 0,
    pvCapableUnitCount: opts.pvCapableUnitCount,
  };
  return classifyLegacyInverterSelection(evidence);
}
