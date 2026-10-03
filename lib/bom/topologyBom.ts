// ═══════════════════════════════════════════════════════════════════════════
// THE BOM LINES FOR A SERVICE TOPOLOGY'S PHYSICAL EQUIPMENT.
//
// Ray: "BOM must consume physical instances from the topology... Do not derive count from a global
// battery quantity scalar." And, on pricing: "Prove: `ServiceTopology equipment instances` =
// `BOM quantities` = `pricing quantities`."
//
// So the quantity on every line below is `instances.filter(...).length`. There is no count
// parameter to this function, and no catalogue default. If the graph has two gateways the BOM has
// two gateways, and the only way to change that is to change the graph.
//
// 🚨 AN EXPANSION BUYS HARDWARE AND SELLS NO CURRENT. It gets its own line AND its harness line —
// it is a real thing somebody has to order — while `contributesAcSource` keeps it out of every
// source count. The two facts live in different fields precisely so neither can be inferred from
// the other.
//
// WHAT THIS DOES NOT DO: it does not replace `lib/bom-engine-v4.ts`. That engine builds the racking,
// conductors, conduit, labels and the rest from the array and the runs. This supplies the
// SERVICE-TOPOLOGY equipment — the instances the old model had no way to enumerate — and
// `reconcileQuantities` is how the two are held to the same numbers.
// ═══════════════════════════════════════════════════════════════════════════

import type { BOMLineItemV4 } from '@/lib/bom-types-v4';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import { panelRemedyWork } from '@/lib/electrical/serviceTopology';
import {
  equipmentInstancesFromTopology, type EquipmentInstance,
} from '@/lib/electrical/topologyEquipment';
import { getBatteryById, getBackupInterfaceById } from '@/lib/equipment-db';
import { resolveUnitCost } from '@/lib/bom/distributorPricing';
import { runScheduleCells, type EngineeredRun } from '@/lib/electrical/electricalRuns';

/** A catalogue-resolved name for a product id, or the id itself when unresolved. */
function nameOf(productId: string): { manufacturer: string; model: string } {
  const b = getBatteryById(productId);
  if (b) return { manufacturer: b.manufacturer, model: b.model };
  const g = getBackupInterfaceById(productId);
  if (g) return { manufacturer: g.manufacturer, model: g.model };
  return { manufacturer: '', model: productId };
}

function line(
  id: string, category: string, productId: string, quantity: number,
  description: string, derivedFrom: string, notes?: string,
): BOMLineItemV4 {
  const { manufacturer, model } = nameOf(productId);
  return {
    id, stageId: 'ac', stageLabel: 'AC / Service',
    category, manufacturer, model,
    partNumber: productId,
    description,
    quantity,
    unit: 'ea',
    derivedFrom,
    required: true,
    notes,
  };
}

export interface TopologyBomResult {
  items: BOMLineItemV4[];
  /** The instances the lines were built from, so a consumer can audit the count. */
  instances: EquipmentInstance[];
  /** Product id → quantity. This is what pricing multiplies. */
  quantities: Record<string, number>;
}

/**
 * Build the service-topology equipment BOM.
 *
 * Every line's quantity is a count of instances in the graph. Nothing is defaulted, nothing is
 * scaled by a site-level number.
 */
/**
 * A DC expansion and the harness it cannot be installed without.
 *
 * One harness per expansion, because that is how many are needed — an expansion that arrives
 * without its harness is not installable, and a BOM that omits it is the reason a crew makes a
 * second trip.
 */
function emitExpansion(
  items: BOMLineItemV4[], productId: string, count: number, where: string,
): void {
  items.push(line(
    `topology-ess-expansion-${productId}`, 'Energy Storage', productId, count,
    `DC battery expansion — energy only, no AC output and no OCPD of its own (${where})`,
    'service topology: energy-expansion storage instances',
    'Contributes usable energy. Contributes NO inverter, NO AC ESS breaker and NO source '
    + 'current to any busbar calculation.',
  ));
  items.push({
    ...line(
      `topology-ess-expansion-harness-${productId}`, 'Energy Storage',
      `${productId}-harness`, count,
      'Expansion harness / accessory kit — one per DC expansion unit',
      'service topology: one harness per energy-expansion instance',
    ),
    // The harness is an accessory of a product, not a catalogue product in its own right.
    manufacturer: nameOf(productId).manufacturer,
    model: `${nameOf(productId).model} expansion harness`,
  });
}

/** The id prefix of a proposed-work line — the BOM half of an applied 120% remedy. */
export const PROPOSED_WORK_LINE_PREFIX = 'topology-remedy-';

/** Is this line proposed work (a remedy's requirement) rather than a graph equipment instance? */
export const isProposedWorkLine = (item: Pick<BOMLineItemV4, 'id'>): boolean =>
  item.id.startsWith(PROPOSED_WORK_LINE_PREFIX);

/**
 * 🚨 AN APPLIED 120% REMEDY IS SOMETHING TO BUY — AND IT IS A REQUIREMENT, NOT A PART.
 *
 * [Apply] on the Service card recorded "replace MSP #1's 200 A main with 175 A" on the graph; the
 * drawing shows the new breaker, so the bill of materials lists it. But the graph records a RATING,
 * not a catalogue number — a main breaker must be the one listed for that panelboard — so the line
 * states the requirement and is NOT orderable until the part is selected. Requirement ≠ part: no
 * brand or catalogue number is invented here. The manufacturer is the panel's own, when recorded.
 */
function emitProposedWork(items: BOMLineItemV4[], t: ServiceTopology): void {
  for (const p of t.panels) {
    const r = p.remedy ?? null;
    const work = panelRemedyWork(p);
    if (!r || !work) continue;
    const derate = r.kind === 'replace-main-breaker';
    const what = derate ? `${r.mainBreakerA} A main breaker` : `${r.busbarRatingA} A bus panelboard, ${r.mainBreakerA} A main`;
    items.push({
      id: `${PROPOSED_WORK_LINE_PREFIX}${derate ? 'main-breaker' : 'panelboard'}-${p.id}`,
      stageId: 'ac', stageLabel: 'AC / Service',
      category: derate ? 'breaker' : 'Electrical',
      manufacturer: derate ? (p.manufacturer ?? '') : '',
      model: `${what} — replacement for ${p.label}`,
      partNumber: `${p.id}-${derate ? `main-breaker-${r.mainBreakerA}a` : `panelboard-${r.busbarRatingA}a`}-replacement`,
      description: `NEW WORK (NEC 705.12(B) remedy) — ${work.label}, ${work.replaces}`
        + (derate ? '. Must be the main breaker listed for this panelboard; a load calculation must show the '
          + 'panel\'s load fits it.' : '. A new panelboard: its manufacturer, SCCR and listing are the new panel\'s.'),
      quantity: 1,
      unit: 'ea',
      necReference: 'NEC 705.12(B)',
      derivedFrom: `service topology: ${p.label} applied remedy (${r.kind})`,
      required: true,
      nonOrderable: true,
      nonOrderableReason: `EQUIPMENT SELECTION REQUIRED — the ${derate ? 'replacement main breaker' : 'replacement panelboard'} `
        + `for ${p.label} is a rating, not a selected catalogue part`,
    });
  }
}

export function bomFromServiceTopology(t: ServiceTopology): TopologyBomResult {
  const instances = equipmentInstancesFromTopology(t);
  const items: BOMLineItemV4[] = [];
  const quantities: Record<string, number> = {};

  const byProduct = new Map<string, EquipmentInstance[]>();
  for (const i of instances) {
    if (!i.productId) continue;          // described, not selected — not orderable, not a line
    const list = byProduct.get(i.productId) ?? [];
    list.push(i);
    byProduct.set(i.productId, list);
  }

  for (const [productId, list] of byProduct) {
    const kind = list[0].kind;
    const where = list.map(i => i.domainId ?? '—').join(', ');

    // 🚨 EXHAUSTIVE, SO A NEW KIND CANNOT BE FORGOTTEN QUIETLY.
    //
    // This used to be a chain of `if`s with `quantities[productId]` stamped ABOVE them and no
    // default. A kind with no branch therefore produced a QUANTITY WITH NO LINE — pricing would
    // multiply something the bill of materials never listed, and the reconciliation compared the
    // stamped number against itself and agreed. The switch below makes the omission a compile
    // error, and `quantities` is now derived from the lines that were actually emitted.
    switch (kind) {
      case 'gateway':
        items.push(line(
          `topology-gateway-${productId}`, 'Backup Gateway', productId, list.length,
          `Backup gateway / controller — one per backup domain (${where})`,
          'service topology: one gateway per backup domain',
        ));
        break;
      case 'generation-unit':
        items.push(line(
          `topology-generation-${productId}`, 'Inverter', productId, list.length,
          `DER generation unit — inverter-class AC source (${where})`,
          'service topology: generation-unit instances',
        ));
        break;
      case 'der-aggregation-panel':
        items.push(line(
          `topology-der-aggregation-${productId}`, 'Electrical', productId, list.length,
          'DER aggregation / AC generation panel — gathers the DER circuits ahead of the point of '
          + 'interconnection',
          'service topology: der-aggregation-panel instances',
          'Sized from the aggregated DER current, not from the service rating.',
        ));
        break;
      case 'panelboard':
        items.push(line(
          `topology-panelboard-${productId}`, 'Electrical', productId, list.length,
          `Panelboard (${where})`, 'service topology: panelboard instances',
        ));
        break;
      case 'disconnect':
        items.push(line(
          `topology-disconnect-${productId}`, 'Electrical', productId, list.length,
          'Disconnecting means', 'service topology: protective-device instances',
        ));
        break;
      case 'storage-inverter':
        items.push(line(
          `topology-ess-${productId}`, 'Energy Storage', productId, list.length,
          `Energy storage unit with integrated inverter (${where})`,
          'service topology: inverter-bearing storage instances',
        ));
        break;
      case 'storage-expansion':
        emitExpansion(items, productId, list.length, where);
        break;
      default: {
        // A new EquipmentInstanceKind reaches here only if this switch was not extended with it.
        const _exhaustive: never = kind;
        void _exhaustive;
      }
    }
  }

  // Quantities come from the lines that were EMITTED, so "BOM quantity" and "priced quantity"
  // cannot drift from each other, and a kind with no line shows up as a real disagreement in
  // `reconcileQuantities` instead of agreeing with a number nobody printed.
  for (const item of items) {
    if (item.partNumber.endsWith('-harness')) continue;
    quantities[item.partNumber] = (quantities[item.partNumber] ?? 0) + item.quantity;
  }

  // Proposed work after the instance count: it is not an equipment instance the graph counts, so it
  // stays out of `quantities` (and so out of `reconcileQuantities`), and it is not priced — it has no part.
  emitProposedWork(items, t);

  // Price from the same lines, so "BOM quantity" and "priced quantity" are one number.
  for (const item of items) {
    if (isProposedWorkLine(item)) continue;
    const unitCost = resolveUnitCost(item.partNumber, item.category);
    if (Number.isFinite(unitCost) && unitCost > 0) {
      item.unitCost = unitCost;
      item.totalCost = Number((unitCost * item.quantity).toFixed(2));
    }
  }

  return { items, instances, quantities };
}

/**
 * What pricing multiplies, keyed by product.
 *
 * 🚨 DERIVED FROM THE SAME LINES, NOT FROM A SECOND LOOKUP. Ray: "No independent `batteryQty` or
 * `gatewayQty` fallback is allowed to silently disagree." The only way for pricing to disagree
 * with the BOM here is for the BOM to disagree with itself.
 */
export function pricedQuantitiesFromBom(result: TopologyBomResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of result.items) {
    // Accessories carry a derived part number; they are priced, but they are not a catalogue
    // product whose count the topology states, so they do not enter the reconciliation. Proposed
    // work (an applied remedy) is a requirement, not an instance — it does not enter either.
    if (item.partNumber.endsWith('-harness') || isProposedWorkLine(item)) continue;
    out[item.partNumber] = (out[item.partNumber] ?? 0) + item.quantity;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SERVICE GRAPH'S CONDUCTORS — FROM THE CANONICAL RUNS.
//
// Ray: "The exact same engineered run must feed SLD, conductor schedule, BOM, permit…". Each line
// below is a group of identical engineered runs (lib/electrical/electricalRuns.ts), worded by
// `runScheduleCells` — the SLD's schedule cell, letter for letter. A conductor footage needs the
// run's length; none is recorded, so the quantity is PENDING (never a default footage) and the line
// is a requirement, not an orderable part. A run the engine could not engineer says NOT EVALUATED
// and names what it needs.
// ═══════════════════════════════════════════════════════════════════════════

export const RUN_LINE_PREFIX = 'topology-run-';
export const isRunLine = (item: Pick<BOMLineItemV4, 'id'>): boolean => item.id.startsWith(RUN_LINE_PREFIX);

export function bomLinesFromRuns(runs: readonly EngineeredRun[]): BOMLineItemV4[] {
  const groups = new Map<string, EngineeredRun[]>();
  for (const r of runs) {
    const c = runScheduleCells(r);
    const key = `${r.role}|${r.name}|${r.ocpdA}|${c.conductors}|${c.raceway}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map(group => {
    const r = group[0];
    const c = runScheduleCells(r);
    const engineered = r.conductor.status === 'ENGINEERED';
    const lengths = group.map(g => g.voltageDrop.lengthFt);
    const allLengths = lengths.every((l): l is number => typeof l === 'number');
    const footage = allLengths ? (lengths as number[]).reduce((a, b) => a + b, 0) : null;
    const needs = [...new Set(group.flatMap(g => g.missingInputs.filter(m => m.blocking).map(m => m.need)))];
    const n = group.length;
    return {
      id: `${RUN_LINE_PREFIX}${r.id}`,
      stageId: 'ac',
      stageLabel: 'AC / Service',
      // Not 'wire': that category carries a per-foot fallback price, and a requirement line is not priced.
      category: 'Conductor Run',
      manufacturer: '',
      model: `${r.ocpdA != null ? `${r.ocpdA} A ` : ''}${r.name}`,
      partNumber: `${RUN_LINE_PREFIX}${r.id}`,
      description: engineered ? `${c.conductors} · ${c.raceway}` : 'CONDUCTORS / RACEWAY — NOT EVALUATED',
      quantity: footage ?? 0,
      unit: 'ft',
      necReference: r.conductor.necReferences.join(', ') || undefined,
      derivedFrom: `canonical electrical run${n === 1 ? '' : 's'}: `
        + group.map(g => `${g.source.deviceLabel} → ${g.destination.deviceLabel}`).join('; '),
      required: true,
      nonOrderable: true,
      nonOrderableReason: !engineered
        ? `NOT EVALUATED — ${needs.join('; ') || 'the run is not engineered'}`
        : footage === null
          ? `LENGTH REQUIRED — the one-way length of ${n === 1 ? 'this run' : `these ${n} runs`} is not recorded, so no footage is ordered`
          : 'RUN TAKE-OFF — conductor and raceway footage from the recorded run lengths',
      ...(footage === null ? {
        quantityState: 'pending' as const,
        quantityStateLabel: `LENGTH REQUIRED — ${n} RUN${n === 1 ? '' : 'S'}`,
      } : { quantityState: 'established' as const }),
      quantitySource: footage === null ? 'unknown' as const : 'route-derived' as const,
      affectedRouteIds: group.map(g => g.id),
      affectedEquipmentIds: [...new Set(group.flatMap(g => [g.source.deviceId, g.destination.deviceId]))],
    };
  });
}
