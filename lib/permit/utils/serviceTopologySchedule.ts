// ═══════════════════════════════════════════════════════════════════════════
// THE EQUIPMENT SCHEDULE, FROM THE SERVICE TOPOLOGY.
//
// Ray: "The permit package must consume the same canonical `ServiceTopology` + physical equipment
// instances + `EngineeringCheck` conclusions used by Engineering, SLD, BOM and pricing... It must
// not collapse back to `1 main panel`, `1 gateway`, or `4 Powerwalls`."
//
// ═══ IDENTITY SURVIVES; ONLY PROCUREMENT SUMMARISES ═══
//
// "Do not aggregate away topology merely because two devices have the same model/rating. Quantity
// may be summarized for procurement, but engineering identity must survive."
//
// So there are two functions and they answer different questions:
//
//   `serviceTopologyScheduleRows` — ONE ROW PER PHYSICAL INSTANCE. Gateway #1 is on Branch A
//       backing MSP #1; Gateway #2 is on Branch B backing MSP #2. They are the same model and the
//       same rating and they are NOT one row of quantity 2, because an inspector reading the
//       schedule has to be able to tell which enclosure is which.
//   `serviceTopologyProcurement` — the summarised counts, for ordering. 2 × this, 2 × that.
//
// ═══ AND AN EXPANSION IS NOT AN INVERTER ═══
//
// "A Powerwall 3 Expansion is battery expansion equipment — not inverter, not independent ESS AC
// source, not another AC breaker contribution." Its row says `deviceType: 'battery-expansion'`,
// its AC columns are explicitly none, and it names the host it extends. The schedule's device type
// comes from the instance's `kind`, never from a model string.
// ═══════════════════════════════════════════════════════════════════════════

import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  evaluateServiceTopology, sizeAggregationPanel, governingArticleFor,
} from '@/lib/electrical/serviceTopology';
import {
  equipmentInstancesFromTopology, equipmentQuantities, type EquipmentInstanceKind,
} from '@/lib/electrical/topologyEquipment';
import { getBatteryById, getBackupInterfaceById } from '@/lib/equipment-db';
import { requiredInputs, type EngineeringCheck } from '@/lib/engineering/engineeringStatus';

export type ScheduleDeviceType =
  | 'service'
  | 'service-branch'
  | 'panelboard'
  | 'backup-gateway'
  | 'ess-ac-source'
  | 'battery-expansion'
  | 'disconnect'
  /** A panel that gathers DER circuits ahead of the point of interconnection. */
  | 'der-aggregation-panel'
  /** A PV inverter, a generator, or any other non-storage DER source. */
  | 'generation-unit'
  /**
   * The point of interconnection itself.
   *
   * It is a LOCATION, not a purchasable device, so it appears in the instance schedule an inspector
   * reads and never in the procurement summary. Ray: "No diagram-only invented equipment" — and its
   * converse: no purchase line for a connection point.
   */
  | 'point-of-interconnection';

export interface ServiceScheduleRow {
  /** The instance tag an inspector reads — unique on the sheet. */
  tag: string;
  deviceType: ScheduleDeviceType;
  manufacturer: string;
  model: string;
  /** Which backup domain, where it belongs to one. Engineering identity. */
  domain: string;
  /** What it is rated for, already formatted, or the requirement when unresolved. */
  rating: string;
  /** Its overcurrent protection, or an explicit "none" with the reason. */
  ocpd: string;
  /** Free text: what it feeds, what it extends, what role it plays. */
  notes: string;
}

const A = (v: number | null | undefined) => (typeof v === 'number' ? `${v} A` : 'NOT EVALUATED');

function productName(productId: string): { manufacturer: string; model: string } {
  const b = getBatteryById(productId);
  if (b) return { manufacturer: b.manufacturer, model: b.model };
  const g = getBackupInterfaceById(productId);
  if (g) return { manufacturer: g.manufacturer, model: g.model };
  return { manufacturer: '', model: productId || '—' };
}

const ROLE_TEXT: Record<string, string> = {
  'service-disconnect': 'Service disconnect',
  'der-isolation-disconnect': 'Utility DER isolation disconnect',
  'gateway-isolation': 'Gateway isolation',
  'ess-disconnect': 'ESS disconnect / OCPD',
};

/**
 * One row per physical instance, in reading order: service, branches, panels, then each domain.
 *
 * Nothing here is a count. Every row is a thing on the wall.
 */
export function serviceTopologyScheduleRows(t: ServiceTopology | null | undefined): ServiceScheduleRow[] {
  if (!t) return [];
  const rows: ServiceScheduleRow[] = [];
  const panelById = new Map(t.panels.map(p => [p.id, p]));
  const storageById = new Map(t.storage.map(u => [u.id, u]));
  const domainOfPanel = new Map<string, string>();
  for (const d of t.domains) for (const pid of d.backedUpPanelIds) domainOfPanel.set(pid, d.label);

  rows.push({
    tag: 'SERVICE',
    deviceType: 'service',
    manufacturer: '', model: '',
    domain: '',
    rating: `${t.service.ratedAmps} A, ${t.service.voltage} V `
      + `${t.service.phase === 'split-240' ? 'split phase' : t.service.phase}`,
    ocpd: '—',
    notes: t.service.availableFaultCurrentA === null
      // 🚨 THE REQUIREMENT, WHERE THE NUMBER WOULD HAVE GONE. Not a banner, not a status stamp —
      // the cell that should hold the available fault current says what is needed to fill it.
      // That is what the engineer who stamps this has to know.
      ? 'NOT EVALUATED — AVAILABLE FAULT CURRENT REQUIRED'
      : `Available fault current ${t.service.availableFaultCurrentA} A`,
  });

  for (const b of t.branches) {
    const d = t.domains.find(x => x.branchId === b.id);
    const fed = d ? d.backedUpPanelIds.join(', ') : '—';
    rows.push({
      tag: b.label.toUpperCase(),
      deviceType: 'service-branch',
      manufacturer: '', model: '',
      domain: d?.label ?? '',
      rating: `${b.ratedAmps} A`,
      ocpd: A(b.ocpdAmps),
      notes: `Feeds ${d ? `${d.gateway.label} → ${fed}` : fed}`,
    });
  }

  for (const p of t.panels) {
    rows.push({
      // 🚨 MSP #1 AND MSP #2 STAY SEPARATELY IDENTIFIABLE, same model and same rating or not.
      tag: p.label.toUpperCase(),
      deviceType: 'panelboard',
      manufacturer: '', model: '',
      domain: domainOfPanel.get(p.id) ?? '',
      rating: `${A(p.busbarRatingA)} bus`,
      ocpd: `${A(p.mainBreakerA)} main`,
      notes: p.backedUp ? 'Backed-up panel' : 'Not backed up',
    });
  }

  for (const d of t.domains) {
    const gw = productName(d.gateway.productId);
    rows.push({
      tag: d.gateway.id.toUpperCase(),
      deviceType: 'backup-gateway',
      manufacturer: gw.manufacturer, model: gw.model,
      domain: d.label,
      rating: A(d.gateway.continuousRatingA),
      ocpd: d.gateway.mainBreakerA === null ? 'NOT EVALUATED' : `${d.gateway.mainBreakerA} A main`,
      notes: [
        d.gateway.serviceEntranceRated ? 'Service entrance rated' : '',
        `Fed by ${d.branchId}; backs up ${d.backedUpPanelIds.join(', ')}`,
        d.gateway.sccrA === null ? 'NOT EVALUATED — INTERRUPTING RATING REQUIRED' : '',
      ].filter(Boolean).join('. '),
    });

    for (const id of d.storageUnitIds) {
      const u = storageById.get(id);
      if (!u) continue;
      const name = productName(u.productId);
      if (u.role === 'energy-expansion') {
        const host = u.attachedToUnitId ? storageById.get(u.attachedToUnitId) : null;
        rows.push({
          tag: u.id.toUpperCase(),
          // 🚨 NOT 'ess-ac-source'. The type comes from the instance role, so no downstream reader
          // can classify it from the model name.
          deviceType: 'battery-expansion',
          manufacturer: name.manufacturer, model: name.model,
          domain: d.label,
          rating: u.usableKwh === null ? 'NOT EVALUATED' : `${u.usableKwh} kWh`,
          ocpd: 'None — DC extension of its host unit',
          notes: `DC battery expansion on the manufacturer's expansion harness`
            + `${host ? `, extending ${host.id.toUpperCase()}` : ''}. `
            + 'No inverter, no AC output, no ESS breaker of its own.',
        });
        continue;
      }
      rows.push({
        tag: u.id.toUpperCase(),
        deviceType: 'ess-ac-source',
        manufacturer: name.manufacturer, model: name.model,
        domain: d.label,
        rating: `${A(u.continuousOutputA)} continuous`
          + (u.usableKwh === null ? '' : `, ${u.usableKwh} kWh`),
        ocpd: A(u.ocpdA),
        notes: d.storageConnection === 'gateway-panelboard'
          ? `Lands in ${d.gateway.label}'s panelboard`
          : d.storageConnection === 'backed-up-panel-busbar'
            ? `Lands on ${d.backedUpPanelIds.join(', ')} busbar`
            : 'NOT EVALUATED — POINT OF CONNECTION REQUIRED',
      });
    }
  }

  // ── DER AGGREGATION PANELS ────────────────────────────────────────────────
  //
  // 🚨 THE RATING COLUMN STATES WHAT IT WAS SIZED FROM. A reviewer looking at a 125 A panel on a
  // 400 A service has to be able to see WHY it is 125 A without re-deriving it — and that it was
  // not sized from the service.
  for (const agg of t.aggregationPanels ?? []) {
    const sizing = sizeAggregationPanel(t, agg);
    const n = agg.inputs.length;
    rows.push({
      tag: agg.id.toUpperCase(),
      deviceType: 'der-aggregation-panel',
      manufacturer: '', model: '',
      domain: '',
      rating: agg.busbarRatingA === null
        ? 'NOT EVALUATED — BUSBAR RATING REQUIRED'
        : `${agg.busbarRatingA} A bus`
          + (agg.mainLugOnly ? ', MLO' : agg.mainBreakerA === null ? '' : `, ${agg.mainBreakerA} A main`),
      ocpd: agg.outputOcpdA === null
        ? 'NOT EVALUATED — OUTPUT OCPD REQUIRED' : `${agg.outputOcpdA} A output`,
      notes: [
        `${n} DER circuit${n === 1 ? '' : 's'}`,
        sizing.aggregateContinuousA === null
          ? 'NOT EVALUATED — AGGREGATED DER CURRENT REQUIRED'
          : `${sizing.aggregateContinuousA} A aggregated, ${sizing.standardOcpdA} A minimum at 125%`,
        agg.carriesPremisesLoad === null
          ? 'NOT EVALUATED — DER-ONLY OR LOAD-CARRYING REQUIRED'
          : agg.carriesPremisesLoad ? 'Carries premises load' : 'DER only, no premises load',
        agg.sccrA === null ? 'NOT EVALUATED — SCCR REQUIRED' : `${agg.sccrA} A SCCR`,
      ].filter(Boolean).join('; '),
    });
  }

  // ── POINTS OF INTERCONNECTION ─────────────────────────────────────────────
  for (const poi of t.pointsOfInterconnection ?? []) {
    const article = governingArticleFor(poi.relationship);
    rows.push({
      tag: poi.id.toUpperCase(),
      deviceType: 'point-of-interconnection',
      manufacturer: '', model: '',
      domain: '',
      rating: poi.relationship === 'unresolved'
        ? 'INTERCONNECTION ARRANGEMENT REQUIRED'
        : poi.relationship.replace(/-/g, ' '),
      ocpd: poi.ocpdA === null ? '—' : `${poi.ocpdA} A`,
      notes: [
        poi.connectedToNodeId
          ? `Connects to ${poi.connectedToNodeId}`
          : 'NOT EVALUATED — PREMISES CONNECTION POINT REQUIRED',
        article ?? '',
      ].filter(Boolean).join('; '),
    });
  }

  for (const dev of t.devices) {
    rows.push({
      tag: dev.id.toUpperCase(),
      deviceType: 'disconnect',
      manufacturer: '', model: '',
      domain: '',
      rating: A(dev.ratedAmps),
      ocpd: dev.sccrA === null ? 'NOT EVALUATED — SCCR REQUIRED' : `${dev.sccrA} A SCCR`,
      notes: [
        dev.roles.map(r => ROLE_TEXT[r] ?? r).join(' + '),
        dev.lockableOpen === true ? 'lockable open' : '',
        dev.visibleOpen === true ? 'visible open' : '',
        // Where it sits is what decides what opening it actually disconnects.
        dev.feedsNodeId ? `on the path to ${dev.feedsNodeId}` : '',
        dev.locationNote ?? '',
      ].filter(Boolean).join('; '),
    });
  }

  return rows;
}

export interface ProcurementLine {
  productId: string;
  manufacturer: string;
  model: string;
  quantity: number;
  deviceType: ScheduleDeviceType;
  /** The instance tags this line covers, so identity is recoverable from the summary. */
  instanceTags: string[];
}

/**
 * Summarised for ordering — and it still names the instances it covers.
 *
 * A quantity with no tags behind it is how "2 gateways" becomes "a gateway, quantity 2" becomes
 * "a gateway".
 */
export function serviceTopologyProcurement(t: ServiceTopology | null | undefined): ProcurementLine[] {
  if (!t) return [];
  const instances = equipmentInstancesFromTopology(t).filter(i => i.productId);
  const byProduct = new Map<string, typeof instances>();
  for (const i of instances) {
    const l = byProduct.get(i.productId) ?? [];
    l.push(i);
    byProduct.set(i.productId, l);
  }
  // 🚨 TOTAL OVER THE INSTANCE KINDS, WITH NO SILENT DEFAULT. The old `?? 'disconnect'` meant a new
  // kind of equipment was scheduled as a Disconnect — the wrong device type on the sheet an
  // inspector reads, reached by a fallback nobody would ever see fire. Typed as a total record, a
  // new kind is a compile error instead.
  const typeOf: Record<EquipmentInstanceKind, ScheduleDeviceType> = {
    gateway: 'backup-gateway',
    'storage-inverter': 'ess-ac-source',
    'storage-expansion': 'battery-expansion',
    panelboard: 'panelboard',
    disconnect: 'disconnect',
    'der-aggregation-panel': 'der-aggregation-panel',
    'generation-unit': 'generation-unit',
  };
  return [...byProduct.entries()].map(([productId, list]) => ({
    productId,
    ...productName(productId),
    quantity: list.length,
    deviceType: typeOf[list[0].kind],
    instanceTags: list.map(i => i.instanceId.toUpperCase()),
  }));
}

export interface ReleaseReadiness {
  /**
   * Can the sheet be DRAWN? Almost always yes — a topology with holes in it still has a shape, and
   * the holes are what the sheet is for.
   */
  drawable: boolean;
  /**
   * Is the ENGINEERING complete? Separate question, and the one Ray asked for:
   * "A drawable topology is not necessarily a releasable topology."
   *
   * 🚨 THIS IS NOT PRINTED ON THE OUTBOUND PLANSET. Ray's 2026-09-18 ruling removed every release
   * banner and the whole release-gate sheet from the package he sends to a stamping engineer, and
   * he had to say it three times. This travels in the permit RESULT, for the product's own screens.
   * What DOES go on the sheet is the specific missing requirement, printed in the cell where the
   * number would have been — that is data a reviewer needs, not a status scold.
   */
  releaseReady: boolean;
  /** The requirement lines, already phrased for a sheet cell. */
  requirements: string[];
  /** Every indeterminate check, for a screen that wants the detail. */
  indeterminate: EngineeringCheck[];
  /** Every failure, which is a different thing from an unknown. */
  failures: EngineeringCheck[];
}

/** Read the engineering conclusions and say what is missing, in the words a sheet prints. */
export function serviceTopologyReleaseReadiness(
  t: ServiceTopology | null | undefined,
): ReleaseReadiness {
  if (!t) {
    return { drawable: false, releaseReady: false, requirements: [], indeterminate: [], failures: [] };
  }
  const e = evaluateServiceTopology(t);
  const indeterminate = e.checks.filter(c => c.conclusion === 'NOT_EVALUATED');
  const failures = e.checks.filter(c => c.conclusion === 'FAIL');

  const requirements: string[] = [];
  const needs = requiredInputs(indeterminate);
  if (needs.includes('service.availableFaultCurrentA')) {
    requirements.push('NOT EVALUATED — AVAILABLE FAULT CURRENT REQUIRED');
  }
  if (needs.some(n => n.startsWith('manufacturer-document:'))) {
    const doc = t.interconnection.multiGatewayMeteringDoc?.title ?? 'manufacturer application note';
    requirements.push(`MANUFACTURER DOCUMENT REQUIRED — ${doc}`);
  }
  if (needs.some(n => n.startsWith('manufacturer-limit:'))) {
    requirements.push('NOT EVALUATED — MANUFACTURER LIMIT REQUIRED (gateway internal panelboard)');
  }
  if (needs.includes('device.role:service-disconnect')) {
    requirements.push('NOT EVALUATED — SERVICE DISCONNECT CONFIGURATION REQUIRED');
  }
  if (needs.includes('domain.storageConnection')) {
    requirements.push('NOT EVALUATED — ESS POINT OF CONNECTION REQUIRED');
  }
  // 🚨 A DESIGN DECISION READS DIFFERENTLY FROM A MISSING MEASUREMENT. One is owed by the designer,
  // the other by the utility, and a stamping engineer needs to know which of the two is holding the
  // sheet up.
  if (needs.includes('interconnection.derArrangement')) {
    requirements.push('DESIGN DECISION REQUIRED — DER INTERCONNECTION ARRANGEMENT');
  }
  if (needs.includes('poi.relationship') || needs.includes('poi.connectedToNodeId')) {
    requirements.push('INTERCONNECTION ARRANGEMENT REQUIRED — POINT OF INTERCONNECTION');
  }
  if (needs.includes('poi.supplySideTapConductors')) {
    requirements.push('NOT EVALUATED — SUPPLY-SIDE TAP CONDUCTORS AND OCPD REQUIRED (NEC 705.11)');
  }
  if (needs.includes('aggregation.carriesPremisesLoad')) {
    requirements.push('NOT EVALUATED — DER AGGREGATION PANEL LOAD-CARRYING STATUS REQUIRED');
  }
  if (needs.includes('interconnection.isolationArrangement')) {
    requirements.push('NOT EVALUATED — UTILITY DER ISOLATION ARRANGEMENT REQUIRED');
  }
  for (const n of needs.filter(x => x.startsWith('sccr:'))) {
    requirements.push(`NOT EVALUATED — INTERRUPTING RATING REQUIRED (${n.slice(5)})`);
  }
  // Anything else that is missing, named rather than dropped.
  const covered = new Set([
    'service.availableFaultCurrentA', 'device.role:service-disconnect', 'domain.storageConnection',
    'interconnection.derArrangement', 'poi.relationship', 'poi.connectedToNodeId',
    'poi.supplySideTapConductors', 'aggregation.carriesPremisesLoad',
    'interconnection.isolationArrangement',
  ]);
  for (const n of needs) {
    if (covered.has(n)) continue;
    if (n.startsWith('manufacturer-document:') || n.startsWith('manufacturer-limit:') || n.startsWith('sccr:')) continue;
    requirements.push(`NOT EVALUATED — ${n.toUpperCase()} REQUIRED`);
  }

  return {
    // A topology with an aggregation panel and no backup domain is still a drawable shape.
    drawable: t.domains.length > 0 || t.panels.length > 0
      || (t.aggregationPanels ?? []).length > 0,
    releaseReady: indeterminate.length === 0 && failures.length === 0,
    requirements,
    indeterminate,
    failures,
  };
}

/** The counts every other surface must agree with. Re-exported so the permit reads ONE function. */
export const serviceTopologyQuantities = equipmentQuantities;
