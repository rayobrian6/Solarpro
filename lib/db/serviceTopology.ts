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
import { hydrateTopologyFromCatalogue } from '@/lib/electrical/hydrateInstances';
import type {
  ServiceTopology, ServiceBranch, PanelBoard, BackupDomain, StorageUnit,
  ProtectiveDevice, GatewayInstance, DeviceRole,
  GenerationUnit, DerAggregationPanel, DerAggregationInput, PointOfInterconnection,
  PoiRelationship, ExistingServiceEquipment, LoadModel, LoadCalculationMethod, PanelLoad,
} from '@/lib/electrical/serviceTopology';

/**
 * Bumped only when the stored shape changes in a way a reader must know about.
 *
 * 2 — DER sources, aggregation panels and points of interconnection. Version 1 graphs read back
 * with empty lists and no chosen arrangement, which is exactly what they meant: those designs
 * never stated how their DER reaches the service, and the engineering now says so rather than
 * inheriting a default.
 *
 * 3 — existing service equipment, in-line device placement, the selected catalogue part, and the
 * optional load model. Earlier graphs read back with no existing-equipment record (so nothing is
 * claimed about an assembly nobody described), no in-line placement (the default service chain,
 * which is what they meant) and no load model — which, with their demand scalars intact, still
 * resolves through `resolveDemands` exactly as it did before.
 *
 * 4 — the project's solar coupling architecture, the generation panel's system ownership and
 * selected part, and each storage unit's commissioned output configuration, PV assignment and
 * manufacturer DC-input limits. A version-3 graph reloads with no coupling recorded, which is
 * exactly what it was: a design whose consumers each inferred one.
 */
export const SERVICE_TOPOLOGY_SCHEMA_VERSION = 4;

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
    // 🚨 AND SO DOES WHAT IT IS IN LINE WITH — for exactly the same reason, one field along. A
    // per-path knife switch that reloads without its load side is a switch beside the conductor
    // instead of in it, so both Powerwalls keep a path to the utility across a save.
    ...(typeof v.inlineOnNodeId === 'string' && v.inlineOnNodeId
      ? { inlineOnNodeId: v.inlineOnNodeId } : {}),
    // The part actually bought. Dropped, `device.selection` reopens on a design that had settled it.
    ...(typeof v.productId === 'string' && v.productId ? { productId: v.productId } : {}),
  };
}

/**
 * The service equipment already on the wall.
 *
 * 🚨 `verified` MUST NOT BE INFERRED FROM THE FIELDS BEING FULL. Reloading a half-read assembly as
 * verified is how "CONFIGURATION TO VERIFY" disappears without anybody going to site.
 */
function parseExistingEquipment(v: unknown): ExistingServiceEquipment | null {
  if (!isObj(v)) return null;
  const strOrNull = (x: unknown) => (typeof x === 'string' && x ? x : null);
  return {
    manufacturer: strOrNull(v.manufacturer),
    catalogNumber: strOrNull(v.catalogNumber),
    mainArrangement: strOrNull(v.mainArrangement),
    feederArrangement: strOrNull(v.feederArrangement),
    sccrA: numOrNull(v.sccrA),
    verified: v.verified === true,
  };
}

const LOAD_METHODS: LoadCalculationMethod[] = [
  'standard-220-part-iii', 'optional-220-82', 'existing-dwelling-220-87', 'engineer-supplied',
];

/**
 * The optional load model.
 *
 * 🚨 A PANEL ENTRY WITH NO NUMBER IS DROPPED, NOT ZEROED. `resolveDemands` treats a panel the model
 * does not cover as making the sum UNKNOWN; reading a corrupt entry back as 0 A would turn a partial
 * calculation into a comfortable pass.
 */
function parseLoadModel(v: unknown): LoadModel | null {
  if (!isObj(v)) return null;
  const method = LOAD_METHODS.includes(v.method as LoadCalculationMethod)
    ? (v.method as LoadCalculationMethod) : 'engineer-supplied';
  const byPanel = (Array.isArray(v.byPanel) ? v.byPanel : [])
    .map((e): PanelLoad | null => {
      if (!isObj(e) || !str(e.panelId)) return null;
      const a = numOrNull(e.calculatedDemandA);
      return a === null ? null : { panelId: str(e.panelId), calculatedDemandA: a };
    })
    .filter((x): x is PanelLoad => x !== null);
  return { method, basis: str(v.basis), byPanel, otherDemandA: numOrNull(v.otherDemandA) };
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
    // 🚨 ALL THREE NUMBERS OR NONE. A half-read internal panelboard would let the landing check
    // compare a 125 A generation breaker against an absent maximum and call it clear.
    ...(() => {
      const ip = v.internalPanelboard;
      if (!isObj(ip)) return {};
      const bus = numOrNull(ip.busbarRatingA);
      const spaces = numOrNull(ip.spaces);
      const maxB = numOrNull(ip.maxBranchBreakerA);
      if (bus === null || spaces === null || maxB === null) return {};
      return {
        internalPanelboard: {
          busbarRatingA: bus, spaces, maxBranchBreakerA: maxB,
          basis: str(ip.basis) || 'Manufacturer documentation (basis not recorded).',
        },
      };
    })(),
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
    // 🚨 THE COMMISSIONED OUTPUT SETTING SURVIVES, FOR THE SAME REASON THE ROLE DOES. Four
    // Powerwalls at 11.5 kW are 48 A and a 60 A device each; reloaded as "unset" they would fall
    // back to the catalogue's top row, which happens to be the same today — and would silently
    // change the whole design the day a configuration is added above it.
    ...(numOrNull(v.outputConfigKw) !== null ? { outputConfigKw: numOrNull(v.outputConfigKw) } : {}),
    ...(numOrNull(v.pvDcStcKw) !== null ? { pvDcStcKw: numOrNull(v.pvDcStcKw) } : {}),
    ...(parsePvInputLimits(v.pvInputLimits) ? { pvInputLimits: parsePvInputLimits(v.pvInputLimits) } : {}),
  };
}

/**
 * The manufacturer's DC input limits as they were resolved onto the unit.
 *
 * 🚨 ALL OF IT OR NONE OF IT. A half-read limit set would let the DC-coupling check compare a
 * string against an absent maximum and call it clear, so a record missing any number comes back as
 * no record at all and the check says the limits are not established.
 */
function parsePvInputLimits(v: unknown): StorageUnit['pvInputLimits'] | null {
  if (!isObj(v)) return null;
  const pair = (x: unknown): readonly [number, number] | null => {
    if (!Array.isArray(x) || x.length !== 2) return null;
    const a = numOrNull(x[0]); const b = numOrNull(x[1]);
    return a === null || b === null ? null : [a, b];
  };
  const maxStcKw = numOrNull(v.maxStcKw);
  const mppts = numOrNull(v.mppts);
  const mpptVdc = pair(v.mpptVdc);
  const inputVdc = pair(v.inputVdc);
  const maxImpPerMpptA = numOrNull(v.maxImpPerMpptA);
  const maxIscPerMpptA = numOrNull(v.maxIscPerMpptA);
  if (maxStcKw === null || mppts === null || !mpptVdc || !inputVdc
    || maxImpPerMpptA === null || maxIscPerMpptA === null) return null;
  return {
    maxStcKw, mppts, mpptVdc, inputVdc, maxImpPerMpptA, maxIscPerMpptA,
    basis: str(v.basis) || 'Manufacturer documentation (basis not recorded).',
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
    // 🚨 WHICH SYSTEM OWNS IT. Dropped, two identical generation panels reload as two site-wide
    // ones: the equipment schedule loses Domain A from Domain B, and the next run of the preset —
    // which replaces per-system panels and leaves site-wide ones alone — would leave both behind
    // and add two more.
    ...(typeof v.domainId === 'string' && v.domainId ? { domainId: v.domainId } : {}),
    ...(typeof v.productId === 'string' && v.productId ? { productId: v.productId } : {}),
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
  // 🚨 THE KILL-SWITCH IS GONE. This used to be `if (ratedAmps === null) return null;` — one
  // absent number discarded the ENTIRE stored graph on read: every branch, panel, gateway,
  // battery, generation panel and switch, silently, indistinguishable from never having built one.
  // A partial project is a partial project; it is not an absent project.
  const ratedAmps = numOrNull(service?.ratedAmps);

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

  const parsed: StoredServiceTopology = {
    schemaVersion: numOrNull(v.schemaVersion) ?? SERVICE_TOPOLOGY_SCHEMA_VERSION,
    updatedAt: str(v.updatedAt),
    topology: {
      service: {
        ratedAmps,
        voltage: numOrNull(service?.voltage) ?? 240,
        phase: phase === 'wye-208' || phase === 'wye-480' ? phase : 'split-240',
        availableFaultCurrentA: numOrNull(service?.availableFaultCurrentA),
        existingEquipment: parseExistingEquipment(service?.existingEquipment),
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
      loads: parseLoadModel(t.loads),
      // 🚨 THE COUPLING SURVIVES OR THE CONTRADICTION COMES BACK. Reloaded as null, every consumer
      // returns to inferring it — which is the exact state Ray found in the browser, where the
      // topology said Tesla and the drawing said MICROINVERTER. An unrecognised value reads back as
      // null rather than as whichever member happens to be first.
      solarCoupling: t.solarCoupling === 'dc-coupled-storage'
        || t.solarCoupling === 'ac-coupled-inverter'
        || t.solarCoupling === 'storage-only'
        ? t.solarCoupling : null,
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
        // 🚨 AN ACCEPTANCE THAT DOES NOT SURVIVE THE SAVE REOPENS AS "NOT ASKED" — annoying. One
        // that APPEARS across a save would be SolarPro inventing a utility approval, which is why
        // `=== true` and nothing looser.
        isolationArrangementAccepted: boolOrNull(ic.isolationArrangementAccepted),
        isolationArrangementBasis: typeof ic.isolationArrangementBasis === 'string'
          ? ic.isolationArrangementBasis : null,
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

  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 REFRESH THE MANUFACTURER FACTS ON EVERY INSTANCE, ON EVERY READ.
  //
  // This is the one read path, so this is the one place it can be done once.
  //
  // `topologyAuthoring.ts` resolves the catalogue onto an instance when it is BUILT — correctly,
  // because that is what keeps `serviceTopology.ts` free of catalogue reach and lets
  // `projectModel.ts` give the same answer on the server and in the browser. But nothing ever
  // re-resolved them, so a project kept whatever the catalogue said on the day it was authored.
  //
  // That froze two things onto Ray's real project and produced the live failure:
  //   · `ocpdA: 50` on every Powerwall 3, from before the catalogue was corrected to Tesla's
  //     published 60 A. Repairing "the canonical equipment authority, not SLD text" changes nothing
  //     if the authority is never consulted again.
  //   · NO `pvInputLimits` at all, because the field postdates the project. `projectModel.ts` tests
  //     exactly that field to decide whether a unit takes PV on its DC inputs, so the model could
  //     never derive `dc-coupled-storage` for it — and fell through to "an inverter is selected ⇒
  //     ac-coupled", which is how four Powerwall 3 came to be drawn with an Enphase chain and then
  //     an invented Tesla string inverter.
  //
  // Design decisions are untouched: which product, which output configuration, every id, label,
  // role, host attachment and relationship. Only the numbers the manufacturer owns are refreshed.
  // See `lib/electrical/hydrateInstances.ts` for the full argument, including why a differing value
  // is NOT treated as a deliberate override.
  // ═══════════════════════════════════════════════════════════════════════
  const { topology: hydrated, refreshes } = hydrateTopologyFromCatalogue(parsed.topology);
  if (refreshes.length > 0) {
    console.log('[serviceTopology] refreshed', refreshes.length,
      'manufacturer fact(s) from the catalogue on read:',
      refreshes.map(r => `${r.instanceId}.${r.field} ${r.was}→${r.now}`).join(', '));
  }
  return { ...parsed, topology: hydrated };
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
