// ═══════════════════════════════════════════════════════════════════════════
// THE PHYSICAL EQUIPMENT IN A SERVICE TOPOLOGY — ONE LIST, EVERY CONSUMER.
//
// Ray: "BOM must consume physical instances from the topology... Do not derive count from a global
// battery quantity scalar." And: "Pricing must consume the same physical equipment instances as
// BOM. Prove: `ServiceTopology equipment instances` = `BOM quantities` = `pricing quantities`. No
// independent `batteryQty` or `gatewayQty` fallback is allowed to silently disagree."
//
// So there is ONE enumeration of what is physically on the job, it comes from the graph, and the
// BOM and the pricing both read it. Not two counts that happen to agree today.
//
// 🚨 WHY AN INSTANCE LIST AND NOT A QUANTITY MAP. A quantity map is the scalar again, one level up.
// `{ 'gateway-3': 2 }` cannot say WHICH domain each one is in, and the moment a job has two
// gateways on different branches — this job — the assignment is the part that matters. Quantities
// are DERIVED from instances here (`equipmentQuantities`), never the other way round.
//
// 🚨 AND AN EXPANSION IS HARDWARE WITHOUT BEING A SOURCE. Ray: an Expansion contributes "battery
// expansion hardware, applicable harness/accessories — but never another AC inverter, another AC
// ESS breaker, another 48/50 A source contribution." Both halves are enforced here: it appears in
// the instance list (so the BOM buys it and the harness), and its `contributesAcSource` is false
// (so no backfeed, no breaker, no source count).
// ═══════════════════════════════════════════════════════════════════════════

import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

export type EquipmentInstanceKind =
  | 'gateway'
  | 'storage-inverter'
  | 'storage-expansion'
  | 'panelboard'
  | 'disconnect'
  /**
   * A DER aggregation panel. Real hardware — it is bought, scheduled and inspected — and it
   * contributes no AC source of its own: it gathers other sources' current, it does not make any.
   */
  | 'der-aggregation-panel'
  /** A PV inverter, a generator, or any other non-storage DER source. */
  | 'generation-unit';

export interface EquipmentInstance {
  /** Unique within the topology — the instance, not the product. */
  instanceId: string;
  /** Catalogue id, so the BOM and the pricing resolve the same row. */
  productId: string;
  kind: EquipmentInstanceKind;
  label: string;
  /** Which backup domain it belongs to, when it is inside one. */
  domainId?: string;
  /**
   * Does this instance put AC current onto the system?
   *
   * False for every expansion, every panelboard and every disconnect. The one place this is
   * decided, so a consumer cannot reach its own conclusion from a product name.
   */
  contributesAcSource: boolean;
  /** Continuous AC output, for the instances that have one. */
  continuousOutputA: number | null;
  /** Usable energy, for storage instances. Expansions have this and no power. */
  usableKwh: number | null;
  /** For an expansion: the instance it is harnessed to. */
  attachedToInstanceId?: string | null;
}

/**
 * Everything physically installed, from the graph.
 *
 * Deterministic order — gateways, then storage in domain order, then panels, then disconnects — so
 * a BOM built twice from the same topology is byte-identical.
 */
export function equipmentInstancesFromTopology(t: ServiceTopology): EquipmentInstance[] {
  if (!t) return [];
  const out: EquipmentInstance[] = [];
  const storageById = new Map((t.storage ?? []).map(u => [u.id, u]));

  for (const d of t.domains ?? []) {
    out.push({
      instanceId: d.gateway.id,
      productId: d.gateway.productId,
      kind: 'gateway',
      label: d.gateway.label,
      domainId: d.id,
      contributesAcSource: false,
      continuousOutputA: d.gateway.continuousRatingA,
      usableKwh: null,
    });
  }

  for (const d of t.domains ?? []) {
    for (const id of d.storageUnitIds ?? []) {
      const u = storageById.get(id);
      if (!u) continue;
      const isExpansion = u.role === 'energy-expansion';
      out.push({
        instanceId: u.id,
        productId: u.productId,
        kind: isExpansion ? 'storage-expansion' : 'storage-inverter',
        label: u.productId,
        domainId: d.id,
        // 🚨 THE ONE DECISION. Not "does its catalogue row have a backfeed breaker", not "is its
        // model name an Expansion" — the role the operator built into the graph.
        contributesAcSource: !isExpansion,
        continuousOutputA: isExpansion ? 0 : u.continuousOutputA,
        usableKwh: u.usableKwh,
        attachedToInstanceId: isExpansion ? (u.attachedToUnitId ?? null) : null,
      });
    }
  }

  // 🚨 GENERATION IS AN AC SOURCE AND MUST APPEAR HERE, or this list and `derSources` disagree the
  // first time a PV inverter is recorded — the engineering would count it and the BOM, the pricing
  // and the SLD would not. The two enumerations are held equal by a test, not by coincidence.
  for (const g of t.generation ?? []) {
    out.push({
      instanceId: g.id,
      productId: g.productId ?? '',
      kind: 'generation-unit',
      label: g.label,
      ...(g.domainId ? { domainId: g.domainId } : {}),
      contributesAcSource: true,
      continuousOutputA: g.continuousOutputA,
      usableKwh: null,
    });
  }

  for (const p of t.panels ?? []) {
    out.push({
      instanceId: p.id, productId: '', kind: 'panelboard', label: p.label,
      contributesAcSource: false, continuousOutputA: null, usableKwh: null,
    });
  }

  for (const agg of t.aggregationPanels ?? []) {
    out.push({
      // 🚨 THE PANELBOARD THE INSTALLER CHOSE IS WHAT GETS ORDERED. System Config records it
      // (`answerGenerationPanelPart` → `agg.productId`) and this was hard-coded '', so the BOM, pricing
      // and the procurement schedule never listed the part the editor said "nothing is ordered until".
      // None chosen ⇒ '' — a calculated minimum is not a purchase, and no line is invented for it.
      instanceId: agg.id, productId: agg.productId?.trim() || '', kind: 'der-aggregation-panel', label: agg.label,
      contributesAcSource: false, continuousOutputA: null, usableKwh: null,
    });
  }

  for (const dev of t.devices ?? []) {
    out.push({
      instanceId: dev.id, productId: '', kind: 'disconnect', label: dev.label,
      contributesAcSource: false, continuousOutputA: null, usableKwh: null,
    });
  }

  return out;
}

/**
 * Product id → how many, derived from the instances.
 *
 * This is what a BOM quantity column must equal. Instances with no catalogue id (a panelboard or a
 * disconnect the operator described rather than selected) are not counted here — they are not
 * orderable until a product is chosen, and inventing a line for them would be inventing a part.
 */
export function equipmentQuantities(t: ServiceTopology): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of equipmentInstancesFromTopology(t)) {
    if (!i.productId) continue;
    out[i.productId] = (out[i.productId] ?? 0) + 1;
  }
  return out;
}

/**
 * The AC sources on the job, and what they contribute.
 *
 * 🚨 THIS IS THE NUMBER AN EXPANSION MUST NOT APPEAR IN. A consumer that wants "how many inverting
 * units and how much current" asks here rather than counting storage rows.
 */
export function acSourcesFromTopology(t: ServiceTopology): {
  count: number;
  totalContinuousOutputA: number | null;
  byDomain: Record<string, { count: number; continuousOutputA: number | null }>;
} {
  const inst = equipmentInstancesFromTopology(t).filter(i => i.contributesAcSource);
  const sum = (list: EquipmentInstance[]): number | null =>
    list.some(i => i.continuousOutputA === null)
      ? null
      : list.reduce((n, i) => n + (i.continuousOutputA as number), 0);

  const byDomain: Record<string, { count: number; continuousOutputA: number | null }> = {};
  for (const d of t.domains ?? []) {
    const mine = inst.filter(i => i.domainId === d.id);
    byDomain[d.id] = { count: mine.length, continuousOutputA: sum(mine) };
  }
  return { count: inst.length, totalContinuousOutputA: sum(inst), byDomain };
}

// ── The reconciliation every downstream consumer is held to ─────────────────

export interface QuantityDisagreement {
  productId: string;
  topology: number;
  consumer: number;
}

/**
 * Compare a consumer's quantities to the topology's.
 *
 * 🚨 THE OUTPUT-CONSISTENCY LAW, APPLIED TO EQUIPMENT COUNT. "There must not be drawing = 2,
 * BOM = 1 ever again." A consumer that disagrees is not rounded towards the topology and not
 * warned about — it is REPORTED, with both numbers, so the disagreement is a failure somebody has
 * to resolve rather than a discrepancy somebody has to notice.
 */
export function reconcileQuantities(
  t: ServiceTopology, consumerQuantities: Record<string, number>,
): QuantityDisagreement[] {
  const mine = equipmentQuantities(t);
  const ids = new Set([...Object.keys(mine), ...Object.keys(consumerQuantities ?? {})]);
  const out: QuantityDisagreement[] = [];
  for (const id of [...ids].sort()) {
    const a = mine[id] ?? 0;
    const b = consumerQuantities?.[id] ?? 0;
    if (a !== b) out.push({ productId: id, topology: a, consumer: b });
  }
  return out;
}
