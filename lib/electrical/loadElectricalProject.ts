// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE ONE WAY A SERVER SURFACE LEARNS WHAT A PROJECT'S ELECTRICAL STATE IS.
//
// Ray: "Do not simply sprinkle readServiceTopology() calls into them. They must consume the same
// canonical composition used by the engineering page and SLD. One project. Multiple projections."
//
// `resolveElectricalProject` is the composition, and it is deliberately pure — it takes stores and
// returns a model, reads no database, persists nothing. That purity is what makes it testable, and
// it is also why every server caller would otherwise have to assemble its inputs itself. The audit
// found exactly what happens then: the permit route assembling `engineering_config`, then
// `layouts.design_electrical`, then a `?? 'string'`; the SLD route reading the graph but taking the
// inverter from the POST body; the BOM engine counting `selected_equipment.batteryCount`. Three
// surfaces, three assemblies, three answers — with one shared pure resolver sitting underneath,
// unused, looking like it had solved the problem.
//
// So the ASSEMBLY is the thing that has to be single, not just the resolution. This module is it:
// one query, one composition, one revision. A route that wants the project's electrical state calls
// `loadElectricalProject` and gets the same answer every other route gets.
//
// WHAT THIS IS NOT:
//   · Not a store. It writes nothing (see `canonicalizationPatch` below for the one thing a caller
//     MAY choose to persist, and why that is a migration rather than a mirror).
//   · Not a cache. Two calls in one request hit the database twice; correctness first, and a
//     request-scoped cache can be added later without changing a single caller.
//   · Not an authority of its own. Every value it returns traces to a store through the model's
//     provenance, and the inspector at `/api/dev/electrical-authority` prints that trace.
// ═══════════════════════════════════════════════════════════════════════════

import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { parseServiceTopology } from '@/lib/db/serviceTopology';
import {
  resolveElectricalProject,
  type ElectricalProjectModel,
  type SelectedEquipmentView,
} from '@/lib/electrical/projectModel';
import { electricalRevision } from '@/lib/electrical/revision';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

/**
 * Where each of the model's inputs actually came from on this read — recorded so a diagnostic can
 * answer "the coupling resolved from the graph, and the graph came from projects.service_topology"
 * without re-querying. `ElectricalProvenance` on the model names the LOGICAL source; this names the
 * physical row that was read.
 */
export interface ElectricalLoadSources {
  serviceTopology: 'projects.service_topology' | 'absent' | 'unparseable';
  selectedEquipment: 'projects.selected_equipment' | 'absent';
  engineeringConfig: 'projects.engineering_config' | 'absent';
  moduleCount: 'layouts.total_panels' | 'absent';
}

export interface LoadedElectricalProject {
  projectId: string;
  model: ElectricalProjectModel;
  /** The name of this electrical state. Stamp it on anything you generate. */
  revision: string;
  sources: ElectricalLoadSources;
  /**
   * 🚨 THE MANUFACTURER FACTS THIS READ REFRESHED, AND WHAT THEY WERE.
   *
   * Non-empty ⇒ the project was authored against older catalogue data and the load corrected it —
   * e.g. a Powerwall 3 saved with the stale `ocpdA: 50` coming back as Tesla's published 60. Empty
   * on a project that already agrees, so the list is a signal rather than noise.
   *
   * This is the provenance proof Ray asked for: "A current manufacturer correction must reach an
   * active editable project. An issued historical drawing must remain traceable to the data it was
   * issued with." A historical read (`'as-issued'`) refreshes nothing and reports nothing.
   */
  refreshes: import('@/lib/electrical/hydrateInstances').InstanceRefresh[];
}

/** Narrow an unknown JSONB cell to a plain object, tolerating the text form some drivers return. */
function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
    } catch { return null; }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Project `projects.selected_equipment` onto the narrow view the model needs.
 *
 * 🚨 NOTHING IS INVENTED HERE. An absent inverter stays absent — that is the whole point of
 * `cdebde10`, and a loader that filled the gap "to be helpful" would reintroduce the Enphase the
 * project never had. `inverterId` is read from the stored record's own shape and from nowhere else.
 */
export function selectedEquipmentView(raw: unknown): SelectedEquipmentView | null {
  const se = asObject(raw);
  if (!se) return null;
  const inverter = asObject(se.inverter);
  const batteries = Array.isArray(se.batteries) ? se.batteries : null;
  const firstBattery = batteries && batteries.length ? asObject(batteries[0]) : null;
  return {
    inverterId: inverter?.id != null ? String(inverter.id) : null,
    inverterType: inverter?.type != null ? String(inverter.type) : null,
    batteryId: firstBattery?.id != null ? String(firstBattery.id) : null,
    // 🚨 `batteryCount` IS READ AND THEN CHECKED, NOT TRUSTED. The graph's instances answer "how
    // many"; this value exists so the model can RAISE A CONFLICT when the catalogue record and the
    // graph disagree, rather than one of them quietly winning.
    batteryCount: numOrNull(se.batteryCount),
    moduleCount: null,
  };
}

/**
 * 🚨 READ THE PROJECT'S ELECTRICAL STATE. The production entry point.
 *
 * Returns null only when the project does not exist for this user — an empty project is a real
 * answer (a model with no topology and nothing selected), not an error, because the engineering
 * page has to render something for a project nobody has designed yet.
 *
 * One query. Three JSONB columns off `projects` plus the module count off the newest `layouts` row,
 * left-joined so a project with no layout still resolves.
 */
export async function loadElectricalProject(
  projectId: string, userId: string,
): Promise<LoadedElectricalProject | null> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const rows = await sql`
    SELECT p.service_topology,
           p.selected_equipment,
           p.engineering_config,
           (SELECT lo.total_panels FROM layouts lo
             WHERE lo.project_id = p.id ORDER BY lo.updated_at DESC LIMIT 1) AS total_panels
      FROM projects p
     WHERE p.id = ${projectId} AND p.user_id = ${userId} AND p.deleted_at IS NULL
     LIMIT 1
  ` as Array<{
    service_topology: unknown; selected_equipment: unknown;
    engineering_config: unknown; total_panels: unknown;
  }>;
  const row = rows[0];
  if (!row) return null;
  return composeElectricalProject(projectId, row);
}

/**
 * The composition half, separated from the query half so a test can drive the EXACT production
 * composition against a row it built — the query is one statement and PGlite covers it in
 * `topologyAuthoredThenAgreesEverywhere`, but the interpretation of those four cells is where the
 * bugs were, and it must be reachable without a database.
 *
 * Exported for that reason and for the authority inspector, which prints the same composition.
 */
export function composeElectricalProject(
  projectId: string,
  row: {
    service_topology?: unknown; selected_equipment?: unknown;
    engineering_config?: unknown; total_panels?: unknown;
  },
): LoadedElectricalProject {
  const sources: ElectricalLoadSources = {
    serviceTopology: 'absent', selectedEquipment: 'absent',
    engineeringConfig: 'absent', moduleCount: 'absent',
  };

  // ── The connection graph ─────────────────────────────────────────────────
  let topology: ServiceTopology | null = null;
  let refreshes: import('@/lib/electrical/hydrateInstances').InstanceRefresh[] = [];
  if (row.service_topology != null) {
    // 'active': this IS the editable project, so manufacturer facts are refreshed from the
    // catalogue and what moved is reported. A historical read uses 'as-issued' and refreshes nothing.
    const parsed = parseServiceTopology(row.service_topology, 'active');
    if (parsed) {
      topology = parsed.topology;
      refreshes = parsed.refreshes;
      sources.serviceTopology = 'projects.service_topology';
    } else { sources.serviceTopology = 'unparseable'; }
  }

  // ── The catalogue selection ──────────────────────────────────────────────
  const selected = selectedEquipmentView(row.selected_equipment);
  if (selected) sources.selectedEquipment = 'projects.selected_equipment';

  // ── How many modules the design actually places ──────────────────────────
  // Needed for exactly one decision — "no modules at all ⇒ storage-only" — and read from the design
  // rather than the catalogue, because the catalogue says which panel, never how many are on a roof.
  const modules = numOrNull(row.total_panels);
  if (modules !== null) sources.moduleCount = 'layouts.total_panels';

  // ── Explicit engineering overrides, and ONLY those ────────────────────────
  const ec = asObject(row.engineering_config);
  const override = ec ? numOrNull((ec as { serviceRatedAmpsOverride?: unknown }).serviceRatedAmpsOverride) : null;
  if (ec) sources.engineeringConfig = 'projects.engineering_config';

  const model = resolveElectricalProject({
    topology,
    selectedEquipment: selected ? { ...selected, moduleCount: modules } : (modules !== null ? { moduleCount: modules } : null),
    engineeringConfig: override !== null ? { serviceRatedAmpsOverride: override } : null,
  });

  return { projectId, model, revision: electricalRevision(model), sources, refreshes };
}

/**
 * 🚨 THE INTERCONNECTION METHOD, PROJECTED ONTO THE LEGACY SCALAR — and `null` when the graph has
 * not decided.
 *
 * Found in the adversarial sweep. `lib/bom-engine-v4.ts` and the SLD route both read a string scalar
 * and both default it: `String(input.interconnectionMethod ?? 'LOAD_SIDE')`. Meanwhile the canonical
 * authority is `pointsOfInterconnection[].relationship`, which has an explicit `'unresolved'` member
 * that exists precisely to refuse that guess — `serviceTopology.ts` says so in as many words:
 * "without it, creating a POI would force a guess, and the guess would silently inherit that
 * relationship's code article."
 *
 * `LOAD_SIDE` is not a harmless default. It selects NEC 705.12(B), the 120% busbar allowance and a
 * backfed breaker. A project whose POI nobody has classified was being given that article by a `??`.
 *
 * So: a recorded relationship projects onto the scalar, and `'unresolved'` projects NOTHING — the
 * caller leaves whatever it had and says so, rather than being handed an article.
 *
 * Returns null when there is no graph, no POI, or the relationship is unresolved.
 */
export function interconnectionMethodScalar(
  topology: ServiceTopology | null,
): { value: string; basis: string } | null {
  const pois = topology?.pointsOfInterconnection ?? [];
  if (pois.length === 0) return null;
  // Every POI that has actually been classified.
  const decided = pois.filter(p => p.relationship !== 'unresolved');
  if (decided.length === 0) return null;

  const map: Record<string, string | null> = {
    'load-side-busbar': 'LOAD_SIDE',
    'load-side-feeder-tap': 'LOAD_SIDE',
    'supply-side': 'SUPPLY_SIDE_TAP',
    'aggregation-to-supply-side': 'SUPPLY_SIDE_TAP',
    // A manufacturer-integrated connection is governed by the listing, not by an NEC article, and
    // `governingArticleFor` returns null for it. Projecting either scalar would assert an article the
    // graph deliberately declines to name.
    'manufacturer-integrated': null,
    'meter-collar': null,
  };

  const values = [...new Set(decided.map(p => map[p.relationship] ?? null))];
  // Mixed or unmappable: say nothing rather than picking one. A site whose POIs are genuinely
  // different relationships cannot be described by one scalar, and that is the scalar's limitation,
  // not a reason to choose for it.
  if (values.length !== 1 || values[0] === null) return null;
  return {
    value: values[0]!,
    basis: `${decided.length} point(s) of interconnection recorded as `
      + `${[...new Set(decided.map(p => p.relationship))].join(', ')}`,
  };
}

/**
 * Persist the one-time canonicalization the model asks for, if it asks for one.
 *
 * 🚨 THIS IS A MIGRATION, NOT A SYNCHRONIZATION. Ray: "If the persisted evidence is sufficient and
 * non-contradictory, canonicalize to the appropriate coupling with recorded provenance… Treat that
 * as a migration/canonicalization test, not as permission to infer forever."
 *
 * So it runs ONCE per project: after it has written, `solarCoupling` is recorded and the model stops
 * emitting a patch, because recorded coupling wins over derivation. It writes into the graph's own
 * column — the field's existing home — and creates no second store.
 *
 * It is a no-op when there are conflicts (`canonicalizationPatch` is null then, by construction) and
 * a no-op when there is no graph to write into. Failure is non-fatal and logged: a project that
 * could not be migrated still RESOLVES correctly on every read, just without the patch persisted,
 * so a transient write failure can never corrupt the drawing.
 */
export async function persistElectricalCanonicalization(
  loaded: LoadedElectricalProject, userId: string,
): Promise<'written' | 'nothing-to-do' | 'failed'> {
  const patch = loaded.model.canonicalizationPatch;
  if (!patch || !loaded.model.topology) return 'nothing-to-do';
  if (!isValidUUID(loaded.projectId) || !isValidUUID(userId)) return 'nothing-to-do';
  try {
    const { readServiceTopology, writeServiceTopology } = await import('@/lib/db/serviceTopology');
    const stored = await readServiceTopology(loaded.projectId, userId);
    if (!stored) return 'nothing-to-do';
    // Re-read rather than writing the in-memory copy: between the load and here, the row may have
    // moved, and the coupling is the ONLY field this is entitled to set.
    if (stored.topology.solarCoupling) return 'nothing-to-do';
    await writeServiceTopology(loaded.projectId, userId, {
      ...stored.topology, solarCoupling: patch.solarCoupling,
    });
    console.log('[electrical] canonicalized solarCoupling ='
      + ` ${patch.solarCoupling} for project ${loaded.projectId}`
      + ` (${loaded.model.solarCouplingProvenance.basis})`);
    return 'written';
  } catch (e) {
    console.warn('[electrical] canonicalization write skipped (non-fatal):', (e as Error)?.message);
    return 'failed';
  }
}
