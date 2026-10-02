// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE ELECTRICAL STATE DUMP — the active truth, then the mirrors, then which mirrors COULD WIN.
//
// Ray's RULE FIFTEEN: "create one diagnostic endpoint/view that returns the current active truth,
// not six stores independently… Then separately show: legacy mirrors … and: mirrorsThatCouldWin: []
// If mirrorsThatCouldWin is not empty, the gauntlet is still open."
//
// 🚨 WHY THIS IS NOT THE EXISTING INSPECTOR. `authorityInspector.ts` answers "who owns this field,
// and who is documented as able to write it" — a registry, transcribed by hand and held to the
// source by a test. Its `mirrorsThatCouldWin` flags a mirror whose DOCUMENTATION is missing. That is
// a lint on the registry, and it would have reported an empty list for Ray's project on the day his
// `engineering_config.inverters` still held two Tesla Solar Inverters that the page composed its
// architecture from.
//
// This module asks a different question, of the ROW: given what is actually persisted right now,
// is there a value in a non-owning store that a production surface would read as architecture?
// It opens the real columns and compares them. A claim about the codebase cannot answer that; only
// the data can.
//
// It writes NOTHING, and it derives NOTHING a consumer reads — every value here is read off the
// canonical model or off a raw column for comparison. A diagnostic that computed its own answer
// would be the next competing authority, built by the tool meant to find them.
// ═══════════════════════════════════════════════════════════════════════════

import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { loadElectricalProject } from '@/lib/electrical/loadElectricalProject';
import type { ElectricalProjectModel } from '@/lib/electrical/projectModel';

/** A persisted value in a non-owning store that a production surface could still read. */
export interface MirrorRisk {
  /** The store and field, e.g. `engineering_config.inverters`. */
  field: string;
  /** What it currently holds. */
  value: string;
  /** The fact it would contradict. */
  contradicts: string;
  /** WHICH surface would read it, and how that becomes a wrong artefact. */
  howItWins: string;
}

export interface ElectricalStateDump {
  projectId: string;
  revision: string;
  /** Where every cell of this answer was read from. */
  sources: Record<string, string>;

  architecture: {
    coupling: string;
    /** 🚨 WHO decided it. `derived` means SolarPro wrote it, not a person. */
    provenanceSource: string;
    provenanceBasis: string;
    resolutionRequired: boolean;
  };

  pv: {
    modules: number | null;
    /** 🚨 NONE / UNKNOWN / SELECTED(device) — never a bare null that a consumer can infer from. */
    externalInverter: string;
    externalInverterOrigin: string | null;
  };

  storage: {
    invertingUnits: number;
    expansionUnits: number;
    gateways: number;
    models: string[];
    usableKwh: number | null;
  };

  topology: {
    serviceRatedAmps: number | null;
    backupDomains: number;
    generationPanels: number;
    storageConnections: string[];
  };

  conflicts: Array<{ code: string; fact: string }>;

  /** Every known overlapping copy, whether or not it is currently dangerous. */
  legacyMirrors: string[];

  /**
   * 🚨 THE ONE THAT MATTERS. Empty ⇒ no non-owning store currently holds a value a production
   * surface would read as architecture. Non-empty ⇒ the gauntlet is still open, with the reason.
   */
  mirrorsThatCouldWin: MirrorRisk[];
}

const asObj = (v: unknown): Record<string, unknown> | null => {
  const o = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : null;
};

/**
 * 🚨 HOW THE EXTERNAL INVERTER IS REPORTED — Ray's RULE SIX.
 *
 * "Every production consumer must distinguish NONE / UNKNOWN / SELECTED(device) / CONFLICT. Do not
 * collapse NONE and UNKNOWN into null and then infer."
 *
 * `hasExternalInverter === false` is NONE — a fact, not a gap. The model never returns UNKNOWN for
 * this today because an unreadable `selected_equipment` yields no view at all, which the sources
 * block reports separately; if that ever changes this is where it surfaces.
 */
function describeExternalInverter(m: ElectricalProjectModel): string {
  if (m.architectureResolutionRequired && m.hasExternalInverter) {
    return `CONFLICT(${m.externalInverterId})`;
  }
  if (!m.hasExternalInverter) return 'NONE';
  return `SELECTED(${m.externalInverterId})`;
}

export async function electricalStateDump(
  projectId: string, userId: string,
): Promise<ElectricalStateDump | null> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return null;
  const loaded = await loadElectricalProject(projectId, userId);
  if (!loaded) return null;
  const m = loaded.model;

  // The raw columns, read for COMPARISON only. Nothing below feeds a production answer.
  const sql = await getDbReady();
  const rows = await sql`
    SELECT selected_equipment, engineering_config
      FROM projects
     WHERE id = ${projectId} AND user_id = ${userId} AND deleted_at IS NULL
     LIMIT 1
  ` as Array<{ selected_equipment: unknown; engineering_config: unknown }>;
  const se = asObj(rows[0]?.selected_equipment);
  const ec = asObj(rows[0]?.engineering_config);

  const legacyMirrors = [
    'selected_equipment.batteryCount — a scalar the picker writes; the graph counts instances.',
    'selected_equipment.inverter / .inverterId — the catalogue pick; the architecture owns whether '
      + 'it is part of the design.',
    'engineering_config.inverters — the page working fleet; it carries strings, not architecture.',
    'engineering_config.mainPanelAmps — what the engineer edits; the graph owns the rating.',
  ];

  // ── 🚨 WHAT COULD ACTUALLY WIN, RIGHT NOW, ON THIS ROW ────────────────────
  const mirrorsThatCouldWin: MirrorRisk[] = [];

  const fleet = Array.isArray(ec?.inverters) ? ec!.inverters as unknown[] : [];
  if (m.solarCoupling === 'dc-coupled-storage' && fleet.length > 0) {
    mirrorsThatCouldWin.push({
      field: 'engineering_config.inverters',
      value: `${fleet.length} standalone inverter entr${fleet.length === 1 ? 'y' : 'ies'}`,
      contradicts: 'architecture = dc-coupled-storage, which has no standalone PV inverter',
      howItWins:
        'The engineering page composes its copy of the canonical model from this fleet, so the badge '
        + 'and the Diagram tab read an architecture the project does not have — and the next autosave '
        + 'writes the fleet back out, making it live again.',
    });
  }

  const seInv = se?.inverterId ?? (asObj(se?.inverter)?.id ?? null);
  if (m.solarCoupling === 'dc-coupled-storage' && seInv) {
    mirrorsThatCouldWin.push({
      field: 'selected_equipment.inverter',
      value: String(seInv),
      contradicts: 'architecture = dc-coupled-storage',
      howItWins:
        'resolveElectricalProject reads this as hasExternalInverter, which re-opens the coupling '
        + 'conflict on every load and blocks every production artefact.',
    });
  }

  // 🚨 A RECORDED COUPLING WITH NO DECISION BEHIND IT. Not a store competing with another store —
  // a DERIVATION sitting in the slot a designer writes to, which is how Ray's project asserted an
  // architecture nobody chose. It cannot "win" against an owner because it IS in the owner's slot.
  if (m.solarCoupling && m.solarCouplingProvenance.source === 'derived') {
    mirrorsThatCouldWin.push({
      field: 'service_topology.solarCoupling',
      value: `${m.solarCoupling} (derived, no decision recorded)`,
      contradicts: 'nothing yet — but it occupies the slot a designer decision would occupy',
      howItWins:
        'Written by persistElectricalCanonicalization rather than by a person. The model re-tests it '
        + 'against the evidence instead of obeying it, so it only stands while the evidence agrees. '
        + 'Recording the designer answer through the service topology clears this.',
    });
  }

  // 🚨 THE SERVICE RATING'S REAL COMPETITOR. The model used to consult
  // `engineering_config.serviceRatedAmpsOverride`, which no production code has ever written — so
  // the documented override channel was unreachable while THIS field, the one the engineer's own
  // control edits and the engineering page computes NEC 705.12(B) from, went unnamed.
  const cfgAmps = typeof ec?.mainPanelAmps === 'number' ? ec.mainPanelAmps as number : null;
  if (m.serviceRatedAmps !== null && cfgAmps !== null && cfgAmps !== m.serviceRatedAmps) {
    mirrorsThatCouldWin.push({
      field: 'engineering_config.mainPanelAmps',
      value: `${cfgAmps} A`,
      contradicts: `${m.serviceRatedAmps} A recorded on the service graph`,
      howItWins:
        'The engineering page computes the 120% busbar allowance, the permit-readiness gate and the '
        + 'Max PV figure from this scalar, not from the graph. The SLD, BOM and PDF routes do project '
        + 'the graph rating over it, so the drawing and the screen can state different services for '
        + 'the same project.',
    });
  }

  const graphUnits = m.storage.invertingUnitCount + m.storage.expansionUnitCount;
  const mirrorCount = typeof se?.batteryCount === 'number' ? se.batteryCount as number : null;
  if (m.topology && mirrorCount !== null && mirrorCount !== graphUnits) {
    mirrorsThatCouldWin.push({
      field: 'selected_equipment.batteryCount',
      value: String(mirrorCount),
      contradicts: `${graphUnits} storage instance(s) in the graph`,
      howItWins:
        'The proposal and production capacity paths still read this scalar directly rather than '
        + 'through the canonical model, so a quote can state a different number from the drawing.',
    });
  }

  return {
    projectId,
    revision: loaded.revision,
    sources: loaded.sources as unknown as Record<string, string>,
    architecture: {
      coupling: m.solarCoupling ?? 'UNRESOLVED',
      provenanceSource: m.solarCouplingProvenance.source,
      provenanceBasis: m.solarCouplingProvenance.basis,
      resolutionRequired: m.architectureResolutionRequired,
    },
    pv: {
      modules: m.moduleCount,
      externalInverter: describeExternalInverter(m),
      externalInverterOrigin: m.externalInverterOrigin?.kind ?? null,
    },
    storage: {
      invertingUnits: m.storage.invertingUnitCount,
      expansionUnits: m.storage.expansionUnitCount,
      gateways: m.storage.gatewayCount,
      models: m.storage.models,
      usableKwh: m.storage.usableKwh,
    },
    topology: {
      serviceRatedAmps: m.serviceRatedAmps,
      backupDomains: m.topology?.domains.length ?? 0,
      generationPanels: m.storage.perSystemGenerationPanelCount,
      storageConnections: (m.topology?.domains ?? []).map(d => `${d.label}: ${d.storageConnection}`),
    },
    conflicts: m.conflicts.map(c => ({ code: c.code, fact: c.fact })),
    legacyMirrors,
    mirrorsThatCouldWin,
  };
}
