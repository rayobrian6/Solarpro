// ═══════════════════════════════════════════════════════════════════════════
// EVERY DER SOURCE ON THE SITE, AS ONE LIST.
//
// Its own module for a structural reason, not a stylistic one: `serviceTopology.ts` runs the
// DER-isolation-coverage check, which lives in `connectionGraph.ts`, which needs this list. Left in
// `serviceTopology.ts` those two would import each other at run time. Type-only imports are erased,
// so this module can name the topology's types without depending on it.
//
// 🚨 ONE LIST, TWO STORES, NO DUPLICATES. Storage inverter units come from `topology.storage`;
// everything else from `topology.generation`. A storage unit already has an authority, and copying
// it into a second array is how a bill of materials starts counting a battery twice. Energy
// expansions are NOT sources: they contribute energy, never current.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  ServiceTopology, DerSource, DerAggregationInput,
} from '@/lib/electrical/serviceTopology';

export function derSources(topology: ServiceTopology): DerSource[] {
  const domainOf = new Map<string, string>();
  for (const d of topology.domains ?? []) {
    for (const id of d.storageUnitIds) domainOf.set(id, d.id);
  }

  const fromStorage: DerSource[] = (topology.storage ?? [])
    .filter(u => u.role === 'inverter-unit')
    .map(u => ({
      id: u.id,
      label: u.label ?? u.productId,
      kind: 'ess-inverter' as const,
      continuousOutputA: u.continuousOutputA,
      ocpdA: u.ocpdA,
      domainId: domainOf.get(u.id) ?? null,
    }));

  const fromGeneration: DerSource[] = (topology.generation ?? []).map(g => ({
    id: g.id,
    label: g.label,
    kind: g.kind,
    continuousOutputA: g.continuousOutputA,
    ocpdA: g.ocpdA,
    domainId: g.domainId ?? null,
  }));

  return [...fromStorage, ...fromGeneration];
}

/**
 * The sources feeding one aggregation input.
 *
 * An input may name a single source or a whole backup domain — "domain A's DER lands here" is how
 * an installer says it, and fanning it out to that domain's own sources is what makes the sizing
 * read real currents rather than a label.
 */
export function sourcesForAggregationInput(
  topology: ServiceTopology, input: DerAggregationInput,
): DerSource[] {
  const all = derSources(topology);
  const direct = all.find(s => s.id === input.sourceId);
  if (direct) return [direct];
  const domain = (topology.domains ?? []).find(d => d.id === input.sourceId);
  if (domain) return all.filter(s => s.domainId === domain.id);
  return [];
}
