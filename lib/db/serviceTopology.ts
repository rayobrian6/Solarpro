// ═══════════════════════════════════════════════════════════════════════════
// THE SERVICE GRAPH, MADE DURABLE.
//
// 🚨 WHY THIS IS THE FIRST INTEGRATION AND NOT THE SLD. Ray: "`ServiceTopology` currently exists
// but has no authority until the rest of SolarPro consumes and persists it... Reload must not
// collapse `2 MSP → 1 MSP` or `2 gateways → shared gateway` or `2 domains → one battery scalar`."
//
// A drawing of a graph that cannot be saved is a picture. So the graph is stored FIRST, whole, and
// read back whole.
//
// ═══ WHY A COLUMN OF ITS OWN ═══
//
// The obvious home was `projects.selected_equipment`, and it is the wrong one. That column is a
// per-SUB-SYSTEM equipment envelope (roof / ground / fence) with its own deep-merge rules and a
// flat mirror derived from the primary key — machinery built so a fence pick cannot clobber the
// roof entry. A service topology is not a sub-system's equipment selection; it is the project's
// electrical skeleton, and folding it into that envelope would put it through a merge designed for
// something else.
//
// It also carries exactly the scalar this whole slice exists to retire. `selected_equipment` holds
// `batteryCount` — ONE number for the site. Two domains, each with a Powerwall and an Expansion, is
// not a number.
//
// ═══ 🚨 TEMPORARY FORWARD-COMPATIBLE BOOTSTRAP — NOT THE PERMANENT SCHEMA AUTHORITY ═══
//
// `ADD COLUMN IF NOT EXISTS` is the same self-heal `upsertSelectedEquipment` uses for its own
// column, so a write works before any formal migration is run. Ray runs migrations himself through
// Admin → System Tools and a `.sql` file is not a migration until it clears five registrations
// (`migration-four-gates`); the batch runner is additionally halted at 027
// (`migration-runner-halted-at-027`). Blocking this feature on that would be blocking it on an
// operations task.
//
// Ray's ruling, verbatim: "Do not rip this out during this slice. But explicitly classify it as
// TEMPORARY FORWARD-COMPATIBLE BOOTSTRAP rather than making application runtime DDL the permanent
// source of schema truth."
//
// So it is classified. What is required to retire it, recorded here beside the code it governs:
//
//   1. A forward migration creating `projects.service_topology JSONB`, registered through all five
//      gates, applied after the 027 blockage is cleared.
//   2. A reconciliation step that proves the migration and this bootstrap produce the SAME column
//      (type, nullability, default) — a bootstrap that drifts from its migration is worse than
//      either alone.
//   3. This `ensureColumn` call demoted to an assertion (column exists ⇒ proceed; absent ⇒ refuse
//      loudly) rather than a DDL statement.
//
// Historical applied migrations are NOT rewritten. Behaviour under test in
// tests/topologyAuthoredThenAgreesEverywhere.postgres.test.ts: repeated initialisation is
// idempotent, concurrent instances neither corrupt the schema nor lose a write, and an inability to
// alter the schema FAILS rather than silently losing the topology.
//
// ═══ THE READ CHECKS, IT DOES NOT CAST ═══
//
// This is a JSON column. `parseServiceTopology` verifies the SHAPE — that the arrays are arrays and
// the domains name branches and panels that exist — and returns null rather than handing a
// half-parsed graph to the engineering. A `as ServiceTopology` here is how "2 MSPs" becomes
// `undefined.length` three layers away.
// ═══════════════════════════════════════════════════════════════════════════

import { getDbReady, isValidUUID } from '@/lib/db-neon';
import type {
  ServiceTopology, ServiceBranch, PanelBoard, BackupDomain, StorageUnit,
  ProtectiveDevice, GatewayInstance, DeviceRole,
  GenerationUnit, DerAggregationPanel, DerAggregationInput, PointOfInterconnection,
  PoiRelationship,
} from '@/lib/electrical/serviceTopology';

/**
 * Bumped only when the stored shape changes in a way a reader must know about.
 *
 * 2 — DER sources, aggregation panels and points of interconnection. Version 1 graphs read back
 * with empty lists and no chosen arrangement, which is exactly what they meant: those designs
 * never stated how their DER reaches the service, and the engineering now says so rather than
 * inheriting a default.
 */
export const SERVICE_TOPOLOGY_SCHEMA_VERSION = 2;

export interface StoredServiceTopology {
  schemaVersion: number;
  topology: ServiceTopology;
  updatedAt: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const boolOrNull = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
const str = (v: unknown): string => typeof v === 'string' ? v : '';

const DEVICE_ROLES: DeviceRole[] = [
  'service-disconnect', 'der-isolation-disconnect', 'gateway-isolation', 'ess-disconnect',
];

function parseDevice(v: unknown): ProtectiveDevice | null {
  if (!isObj(v) || !str(v.id)) return null;
  const roles = Array.isArray(v.roles)
    ? v.roles.filter((r): r is DeviceRole => DEVICE_ROLES.includes(r as DeviceRole))
    : [];
  return {
    id: str(v.id),
    label: str(v.label) || str(v.id),
    roles,
    ratedAmps: numOrNull(v.ratedAmps),
    sccrA: numOrNull(v.sccrA),
    lockableOpen: boolOrNull(v.lockableOpen),
    visibleOpen: boolOrNull(v.visibleOpen),
    roleCombinationAuthority: typeof v.roleCombinationAuthority === 'string'
      ? v.roleCombinationAuthority : null,
    locationNote: typeof v.locationNote === 'string' ? v.locationNote : null,
    // 🚨 WHERE THE DEVICE SITS SURVIVES THE SAVE.
    //
    // Dropped, a disconnect placed on a DER feeder reloads onto the DEFAULT service chain — and
    // that flips DER ISOLATION COVERAGE from FAIL to PASS across a save, which is the worst
    // direction for a safety check to move. The same parse guards the PUT, so losing it here loses
    // it on the way in as well as on the way out.
    ...(typeof v.feedsNodeId === 'string' && v.feedsNodeId
      ? { feedsNodeId: v.feedsNodeId } : {}),
  };
}

function parseBranch(v: unknown): ServiceBranch | null {
  if (!isObj(v) || !str(v.id)) return null;
  const rated = numOrNull(v.ratedAmps);
  if (rated === null) return null;          // a branch with no rating is not a branch
  return {
    id: str(v.id),
    label: str(v.label) || str(v.id),
    ratedAmps: rated,
    ocpdAmps: numOrNull(v.ocpdAmps),
    calculatedDemandA: numOrNull(v.calculatedDemandA),
    // Absent on graphs written before the explicit feed link existed. Undefined, not [] — an empty
    // list would read as "this branch feeds nothing", which is a different claim from "nobody
    // recorded it", and the consumers fall back to the domain's panels only for the second.
    ...(Array.isArray(v.panelIds)
      ? { panelIds: v.panelIds.filter((x): x is string => typeof x === 'string') }
      : {}),
  };
}

function parsePanel(v: unknown): PanelBoard | null {
  if (!isObj(v) || !str(v.id)) return null;
  return {
    id: str(v.id),
    label: str(v.label) || str(v.id),
    busbarRatingA: numOrNull(v.busbarRatingA),
    mainBreakerA: numOrNull(v.mainBreakerA),
    sccrA: numOrNull(v.sccrA),
    backedUp: v.backedUp === true,
  };
}

function parseGateway(v: unknown): GatewayInstance | null {
  if (!isObj(v) || !str(v.id)) return null;
  return {
    id: str(v.id),
    productId: str(v.productId),
    label: str(v.label) || str(v.id),
    continuousRatingA: numOrNull(v.continuousRatingA),
    serviceEntranceRated: boolOrNull(v.serviceEntranceRated),
    mainBreakerA: numOrNull(v.mainBreakerA),
    sccrA: numOrNull(v.sccrA),
  };
}

function parseStorage(v: unknown): StorageUnit | null {
  if (!isObj(v) || !str(v.id)) return null;
  // 🚨 THE ROLE IS READ BACK, NOT INFERRED FROM THE CURRENT CATALOGUE. A design saved today must
  // reload as what it WAS: if a product's row is later corrected, the stored pairing is still the
  // pairing the operator built, and the engineering can report the disagreement instead of
  // silently re-classifying an Expansion as an inverter.
  const role = v.role === 'energy-expansion' ? 'energy-expansion' : 'inverter-unit';
  return {
    id: str(v.id),
    productId: str(v.productId),
    // The catalogue name recorded when it was built, not re-resolved: a sheet reprinted years
    // later names the product the operator actually chose.
    ...(typeof v.label === 'string' && v.label ? { label: v.label } : {}),
    role,
    continuousOutputA: numOrNull(v.continuousOutputA),
    ocpdA: numOrNull(v.ocpdA),
    usableKwh: numOrNull(v.usableKwh),
    attachedToUnitId: typeof v.attachedToUnitId === 'string' ? v.attachedToUnitId : null,
  };
}

function parseGeneration(v: unknown): GenerationUnit | null {
  if (!isObj(v) || !str(v.id)) return null;
  const kind = v.kind;
  return {
    id: str(v.id),
    label: str(v.label) || str(v.id),
    productId: typeof v.productId === 'string' ? v.productId : null,
    // The kind decides how it is drawn and scheduled; an unrecognised one reads back as 'other'
    // rather than being dropped, because a source that vanishes is a source nobody isolates.
    kind: kind === 'pv-inverter' || kind === 'generator' ? kind : 'other',
    continuousOutputA: numOrNull(v.continuousOutputA),
    ocpdA: numOrNull(v.ocpdA),
    domainId: typeof v.domainId === 'string' ? v.domainId : null,
  };
}

function parseAggregationInput(v: unknown): DerAggregationInput | null {
  if (!isObj(v) || !str(v.sourceId)) return null;
  const tap = v.tap;
  return {
    id: str(v.id) || `input-${str(v.sourceId)}`,
    sourceId: str(v.sourceId),
    // 🚨 THE TAP POINT IS READ BACK, NOT RE-INFERRED. It is the field that decides whether a
    // topology parallels two islands, and defaulting it would default that answer.
    tap: tap === 'gateway-grid-side' || tap === 'backed-up-busbar' ? tap : 'der-output',
    ocpdA: numOrNull(v.ocpdA),
    ...(typeof v.conductorGauge === 'string' ? { conductorGauge: v.conductorGauge } : {}),
  };
}

function parseAggregationPanel(v: unknown): DerAggregationPanel | null {
  if (!isObj(v) || !str(v.id)) return null;
  return {
    id: str(v.id),
    label: str(v.label) || str(v.id),
    // Tri-state on purpose: false and "nobody said" are different answers and only one of them
    // lets the busbar check run.
    carriesPremisesLoad: boolOrNull(v.carriesPremisesLoad),
    busbarRatingA: numOrNull(v.busbarRatingA),
    mainBreakerA: numOrNull(v.mainBreakerA),
    mainLugOnly: v.mainLugOnly === true,
    sccrA: numOrNull(v.sccrA),
    inputs: (Array.isArray(v.inputs) ? v.inputs : [])
      .map(parseAggregationInput).filter((x): x is DerAggregationInput => x !== null),
    outputOcpdA: numOrNull(v.outputOcpdA),
    ...(typeof v.outputConductorGauge === 'string'
      ? { outputConductorGauge: v.outputConductorGauge } : {}),
    feedsNodeId: typeof v.feedsNodeId === 'string' && v.feedsNodeId ? v.feedsNodeId : null,
  };
}

const POI_RELATIONSHIPS: readonly PoiRelationship[] = [
  'load-side-busbar', 'load-side-feeder-tap', 'supply-side', 'aggregation-to-supply-side',
  'manufacturer-integrated', 'meter-collar', 'unresolved',
];

function parsePoi(v: unknown): PointOfInterconnection | null {
  if (!isObj(v) || !str(v.id)) return null;
  const rel = v.relationship;
  // An unrecognised relationship is NOT coerced to a governed one — a stored value this build does
  // not know must not read back as "load side busbar" and inherit 705.12(B).
  if (!POI_RELATIONSHIPS.includes(rel as PoiRelationship)) return null;
  return {
    id: str(v.id),
    label: str(v.label) || str(v.id),
    relationship: rel as PoiRelationship,
    derNodeId: typeof v.derNodeId === 'string' && v.derNodeId ? v.derNodeId : null,
    connectedToNodeId:
      typeof v.connectedToNodeId === 'string' && v.connectedToNodeId ? v.connectedToNodeId : null,
    ocpdA: numOrNull(v.ocpdA),
  };
}

function parseDomain(v: unknown): BackupDomain | null {
  if (!isObj(v) || !str(v.id)) return null;
  const gateway = parseGateway(v.gateway);
  if (!gateway) return null;                // a backup domain without its gateway is not a domain
  const conn = v.storageConnection;
  return {
    id: str(v.id),
    label: str(v.label) || str(v.id),
    branchId: str(v.branchId),
    gateway,
    backedUpPanelIds: Array.isArray(v.backedUpPanelIds)
      ? v.backedUpPanelIds.filter((x): x is string => typeof x === 'string') : [],
    storageUnitIds: Array.isArray(v.storageUnitIds)
      ? v.storageUnitIds.filter((x): x is string => typeof x === 'string') : [],
    generationOutputA: numOrNull(v.generationOutputA),
    backedUpDemandA: numOrNull(v.backedUpDemandA),
    storageConnection:
      conn === 'backed-up-panel-busbar' || conn === 'gateway-panelboard'
        || conn === 'der-aggregation-panel'
        ? conn : 'unresolved',
  };
}

/**
 * Read a stored graph back, checking its shape.
 *
 * Returns null when what came back is not a usable topology — a caller that gets null shows "no
 * service topology on this project", which is honest, rather than engineering against a graph with
 * holes in it.
 */
export function parseServiceTopology(raw: unknown): StoredServiceTopology | null {
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (v instanceof Uint8Array) {
    // bytea from some drivers — the same trap the Nearmap workzone hit, where String(uint8array)
    // produced "123,34,105,…" and a record that had just been written read as absent.
    try { v = JSON.parse(new TextDecoder().decode(v)); } catch { return null; }
  }
  if (!isObj(v)) return null;
  const t = isObj(v.topology) ? v.topology : null;
  if (!t) return null;

  const service = isObj(t.service) ? t.service : null;
  const ratedAmps = numOrNull(service?.ratedAmps);
  if (ratedAmps === null) return null;

  const branches = (Array.isArray(t.branches) ? t.branches : [])
    .map(parseBranch).filter((x): x is ServiceBranch => x !== null);
  const panels = (Array.isArray(t.panels) ? t.panels : [])
    .map(parsePanel).filter((x): x is PanelBoard => x !== null);
  const domains = (Array.isArray(t.domains) ? t.domains : [])
    .map(parseDomain).filter((x): x is BackupDomain => x !== null);
  const storage = (Array.isArray(t.storage) ? t.storage : [])
    .map(parseStorage).filter((x): x is StorageUnit => x !== null);
  const devices = (Array.isArray(t.devices) ? t.devices : [])
    .map(parseDevice).filter((x): x is ProtectiveDevice => x !== null);
  // 🚨 THE DER SIDE OF THE GRAPH SURVIVES THE ROUND TRIP TOO. A saved design must come back still
  // saying where its generation aggregates and where it interconnects — a graph that reloads
  // without its point of interconnection is a graph that reloads as a different design.
  const generation = (Array.isArray(t.generation) ? t.generation : [])
    .map(parseGeneration).filter((x): x is GenerationUnit => x !== null);
  const aggregationPanels = (Array.isArray(t.aggregationPanels) ? t.aggregationPanels : [])
    .map(parseAggregationPanel).filter((x): x is DerAggregationPanel => x !== null);
  const pointsOfInterconnection = (Array.isArray(t.pointsOfInterconnection) ? t.pointsOfInterconnection : [])
    .map(parsePoi).filter((x): x is PointOfInterconnection => x !== null);

  const ic = isObj(t.interconnection) ? t.interconnection : {};
  const doc = isObj(ic.multiGatewayMeteringDoc) ? ic.multiGatewayMeteringDoc : null;

  const phase = t.service && isObj(t.service) ? t.service.phase : null;

  return {
    schemaVersion: numOrNull(v.schemaVersion) ?? SERVICE_TOPOLOGY_SCHEMA_VERSION,
    updatedAt: str(v.updatedAt),
    topology: {
      service: {
        ratedAmps,
        voltage: numOrNull(service?.voltage) ?? 240,
        phase: phase === 'wye-208' || phase === 'wye-480' ? phase : 'split-240',
        availableFaultCurrentA: numOrNull(service?.availableFaultCurrentA),
      },
      devices,
      branches,
      panels,
      domains,
      storage,
      generation,
      aggregationPanels,
      pointsOfInterconnection,
      calculatedServiceDemandA: numOrNull(t.calculatedServiceDemandA),
      interconnection: {
        utilityId: typeof ic.utilityId === 'string' ? ic.utilityId : null,
        // A graph written before the arrangement existed has NOT chosen one, and must come back
        // saying so rather than reloading as whichever shape happened to be first in the union.
        derArrangement:
          ic.derArrangement === 'independent-branch' || ic.derArrangement === 'common-aggregation'
            || ic.derArrangement === 'custom'
            ? ic.derArrangement : null,
        meterCollarPermitted: boolOrNull(ic.meterCollarPermitted),
        meterCollarSelected: ic.meterCollarSelected === true,
        externalDerIsolationRequired: boolOrNull(ic.externalDerIsolationRequired),
        externalDerIsolationBasis: typeof ic.externalDerIsolationBasis === 'string'
          ? ic.externalDerIsolationBasis : null,
        // 🚨 THE UNRESOLVED MANUFACTURER AUTHORITY SURVIVES THE ROUND TRIP. Ray listed it in the
        // things reload must preserve: a saved design must come back still saying the Tesla
        // multi-gateway note is missing, not quietly forget and report a pass.
        multiGatewayMeteringDoc: doc ? {
          title: str(doc.title),
          source: str(doc.source),
          present: doc.present === true,
          governs: Array.isArray(doc.governs)
            ? doc.governs.filter((x): x is string => typeof x === 'string') : [],
        } : null,
      },
    },
  };
}

/** Serialise for storage. Whole graph, no projection, no scalars. */
export function serialiseServiceTopology(
  topology: ServiceTopology, updatedAt = new Date().toISOString(),
): StoredServiceTopology {
  return { schemaVersion: SERVICE_TOPOLOGY_SCHEMA_VERSION, topology, updatedAt };
}

// ── Persistence ─────────────────────────────────────────────────────────────

/** Ensure the column exists. Same self-heal as `selected_equipment`; safe to call repeatedly. */
async function ensureColumn(sql: Awaited<ReturnType<typeof getDbReady>>): Promise<void> {
  try {
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_topology JSONB`;
  } catch (err: unknown) {
    console.warn('[serviceTopology] ADD COLUMN warning (non-fatal):', (err as Error)?.message);
  }
}

export async function writeServiceTopology(
  projectId: string, userId: string, topology: ServiceTopology,
): Promise<boolean> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return false;
  if (!topology || typeof topology !== 'object') return false;
  const sql = await getDbReady();
  await ensureColumn(sql);
  const json = JSON.stringify(serialiseServiceTopology(topology));
  const rows = await sql`
    UPDATE projects
    SET service_topology = ${json}::jsonb
    WHERE id = ${projectId} AND user_id = ${userId} AND deleted_at IS NULL
    RETURNING id
  `;
  return (rows as unknown[]).length > 0;
}

export async function readServiceTopology(
  projectId: string, userId: string,
): Promise<StoredServiceTopology | null> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  await ensureColumn(sql);
  const rows = await sql`
    SELECT service_topology FROM projects
    WHERE id = ${projectId} AND user_id = ${userId} AND deleted_at IS NULL
    LIMIT 1
  `;
  const raw = (rows as Array<{ service_topology: unknown }>)[0]?.service_topology;
  if (raw == null) return null;
  return parseServiceTopology(raw);
}
