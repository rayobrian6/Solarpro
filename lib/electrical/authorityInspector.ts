// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE DEVELOPER AUTHORITY INSPECTOR — "who decided this, and could anything else disagree?"
//
// Ray: "Build the developer-only inspector… For each show: canonical field, canonical owner,
// persisted source, current canonical value, provenance, writers, production consumers, legacy
// mirrors if any, conflict state. This is a diagnostic tool, not another authority."
//
// 🚨 WHY A TOOL AND NOT A DOCUMENT. `docs/ELECTRICAL-AUTHORITY-MAP.md` answered these questions
// once, by hand, on 2026-10-01. A document cannot be wrong at runtime — it can only be out of date,
// silently, which is how the three competing stores got there in the first place. This module
// answers them FROM THE RUNNING PROJECT: the value and the provenance come from the canonical model,
// so an inspector row cannot claim a value the model does not hold.
//
// 🚨 AND IT IS NOT AN AUTHORITY, which matters more than it sounds. Nothing here is persisted,
// nothing here is read by a production surface, and every row's value is READ OFF the model rather
// than recomputed — a row that recomputed its own answer would be a fourth place to disagree, built
// by the tool meant to find places that disagree.
//
// WHAT IS HAND-MAINTAINED, AND HONESTLY LABELLED AS SUCH: `owner`, `persistedAt`, `writers`,
// `consumers` and `legacyMirrors` are a REGISTRY, transcribed from the audit. They are claims about
// the codebase, not observations of it, so `tests/electricalAuthorityInspector.test.ts` holds them
// to the source — a registry that drifts from the code is worse than none, because it is believed.
// ═══════════════════════════════════════════════════════════════════════════

import type { ElectricalProjectModel, ElectricalConflict } from '@/lib/electrical/projectModel';
import type { LoadedElectricalProject } from '@/lib/electrical/loadElectricalProject';
import { revisionInputs } from '@/lib/electrical/revision';

/** How a legacy store is prevented from winning. Ray: "identify it as legacy, prove it cannot win." */
export interface LegacyMirror {
  /** The store and field, e.g. `selected_equipment.batteryCount`. */
  field: string;
  /** WHY it cannot win — the mechanism, not a reassurance. */
  cannotWinBecause: string;
  /** How it goes away. Ray: "document removal path." */
  removalPath: string;
}

export interface AuthorityRow {
  /** The canonical field, in the words an engineer would use. */
  field: string;
  /** Which store owns the answer — the ONE place entitled to decide it. */
  owner: string;
  /** Where that store physically lives. */
  persistedAt: string;
  /** The value right now, read off the canonical model. */
  value: string;
  /** Who decided it, from the model's own provenance. */
  provenance: string;
  /** The code paths entitled to write it. */
  writers: string[];
  /** The production surfaces that read it — through the canonical model. */
  consumers: string[];
  /** Stores that hold an overlapping copy, and why each cannot win. */
  legacyMirrors: LegacyMirror[];
  /** Is this field currently contradicted by another store? */
  conflict: string | null;
}

export interface ElectricalAuthorityReport {
  projectId: string;
  /** The name of this electrical state — what generated artifacts are stamped with. */
  electricalRevision: string;
  /** Which physical rows were read on this load. */
  sources: LoadedElectricalProject['sources'];
  rows: AuthorityRow[];
  conflicts: ElectricalConflict[];
  /** Every input the revision was taken over, for "which fact moved it?". */
  revisionInputs: string[];
  /**
   * The one-time canonicalization this project still owes, if any. Present ⇒ the project is legacy
   * and the next generation will record the decision; absent ⇒ already canonical, or conflicted.
   */
  pendingCanonicalization: string | null;
}

// ── THE REGISTRY ───────────────────────────────────────────────────────────
// Transcribed from docs/ELECTRICAL-AUTHORITY-MAP.md and held to the source by the inspector test.

const CONSUMERS_ALL = [
  'app/engineering/page.tsx (Engineering + Intelligence sidebar)',
  'app/api/engineering/sld/route.ts (primary SLD)',
  'app/api/engineering/permit/route.ts (permit package + PDF)',
  'app/api/engineering/bom/route.ts (BOM + distributor pricing)',
];

const GRAPH_WRITERS = [
  'app/api/projects/[id]/service-topology/route.ts (the builder saves here)',
  'lib/electrical/loadElectricalProject.ts → persistElectricalCanonicalization (coupling only, once)',
];

/**
 * 🚨 THE MIRROR THE AUDIT NAMED, AND THE MECHANISM THAT DEFEATS IT.
 *
 * `selected_equipment.batteryCount` is a scalar the equipment picker writes. It cannot be deleted
 * yet — the proposal and production paths still read it for capacity — so it is labelled legacy and
 * disarmed instead: the model counts graph instances, and a `batteryCount` that disagrees raises a
 * CONFLICT rather than a second opinion.
 */
const BATTERY_COUNT_MIRROR: LegacyMirror = {
  field: 'selected_equipment.batteryCount',
  cannotWinBecause:
    'resolveElectricalProject counts StorageUnit instances in the graph and uses batteryCount only '
    + 'to RAISE A CONFLICT when the two disagree. It is never summed, never averaged and never '
    + 'preferred. With no graph it is the only answer there is, which is correct — a project with no '
    + 'topology has nothing better.',
  removalPath:
    'Migrate the proposal/production capacity readers onto model.storage.invertingUnitCount, then '
    + 'drop the column write from the equipment picker. Tracked against the equipment-multiplicity '
    + 'ruling (count = capacity, never brand count).',
};

const INVERTER_MIRROR: LegacyMirror = {
  field: 'engineering_config.inverters[] / layouts.design_electrical.strings[]',
  cannotWinBecause:
    "app/api/engineering/permit/route.ts skips its inverter backfill entirely when the canonical "
    + "coupling is 'dc-coupled-storage' or 'storage-only' — a project with no separate AC inverter "
    + 'cannot be given one by a store that still remembers the old design.',
  removalPath:
    'The backfill exists to repair a stale POST from the Engineering page. Once the page posts from '
    + 'the canonical model rather than React state, it has nothing left to repair and can be deleted.',
};

const SERVICE_SCALAR_MIRROR: LegacyMirror = {
  field: 'PermitInput.project.mainPanelAmps (and the mainPanelAmps scalars behind it)',
  cannotWinBecause:
    'When a topology is present, lib/permit/utils/sldAdapter.ts passes serviceTopology and the '
    + 'renderer draws the service side FROM the graph; mainPanelAmps travels on only as the derived '
    + 'compatibility projection unmigrated surfaces still read. See docs/SERVICE-TOPOLOGY-SCALAR-AUDIT.md.',
  removalPath:
    'Finish migrating the scalar readers listed in that audit, then stop projecting it.',
};

const fmt = (v: unknown): string =>
  v === null || v === undefined ? 'NOT ESTABLISHED' : String(v);

/**
 * Build the report. Pure: the model is read, never recomputed, and nothing is persisted.
 */
export function inspectElectricalAuthority(
  loaded: LoadedElectricalProject,
): ElectricalAuthorityReport {
  const m: ElectricalProjectModel = loaded.model;
  const t = m.topology;

  /** The conflict touching a field, if one does. */
  const conflictOn = (fact: string): string | null => {
    const c = m.conflicts.find(x => x.fact === fact);
    return c ? `${c.claims.map(x => `${x.source}: ${x.says}`).join(' ⟷ ')} → ${c.question}` : null;
  };

  const rows: AuthorityRow[] = [
    {
      field: 'Service rating (A)',
      owner: 'service_topology.service.ratedAmps, overridable by engineering_config',
      persistedAt: 'projects.service_topology → topology.service.ratedAmps',
      value: m.serviceRatedAmps === null
        ? 'NOT ESTABLISHED — dependent conclusions report NOT_EVALUATED'
        : `${m.serviceRatedAmps} A`,
      provenance: `${m.serviceProvenance.source} — ${m.serviceProvenance.basis}`,
      writers: GRAPH_WRITERS,
      consumers: CONSUMERS_ALL,
      legacyMirrors: [SERVICE_SCALAR_MIRROR],
      conflict: conflictOn('What the service is rated'),
    },
    {
      field: 'Selected inverter architecture',
      owner: 'selected_equipment (the catalogue pick, and ONLY which product)',
      persistedAt: 'projects.selected_equipment.inverter',
      value: m.hasExternalInverter
        ? 'A separate AC PV inverter is selected'
        : 'No separate AC PV inverter — a real state, not a missing value',
      provenance: `${m.externalInverterProvenance.source} — ${m.externalInverterProvenance.basis}`,
      writers: [
        'app/api/projects/[id]/equipment/route.ts',
        'app/api/engineering/save-config/route.ts',
        'app/api/projects/[id]/layout/route.ts (designer changes)',
      ],
      consumers: CONSUMERS_ALL,
      legacyMirrors: [INVERTER_MIRROR],
      conflict: conflictOn('How the PV is coupled'),
    },
    {
      field: 'solarCoupling (how the PV reaches the premises)',
      owner: 'service_topology.solarCoupling — the one project-level answer',
      persistedAt: 'projects.service_topology → topology.solarCoupling',
      value: `${fmt(m.solarCoupling)} — "${m.solarCouplingLabel}"`,
      provenance: `${m.solarCouplingProvenance.source} — ${m.solarCouplingProvenance.basis}`,
      writers: GRAPH_WRITERS,
      consumers: [
        ...CONSUMERS_ALL,
        'lib/sld-professional-renderer.ts (draws the DC trunk or the AC chain from it)',
      ],
      legacyMirrors: [INVERTER_MIRROR],
      conflict: conflictOn('How the PV is coupled'),
    },
    {
      field: 'Storage unit quantity (inverting cabinets, e.g. Powerwall 3)',
      owner: 'service_topology — physical multiplicity is a property of the graph',
      persistedAt: 'projects.service_topology → topology.storage[] (role = ac-inverting)',
      value: `${m.storage.invertingUnitCount} inverting unit(s)`
        + `, ${m.storage.expansionUnitCount} DC expansion(s)`
        + `${m.storage.models.length ? ` — ${m.storage.models.join(', ')}` : ''}`,
      provenance: `${m.storage.provenance.source} — ${m.storage.provenance.basis}`,
      writers: GRAPH_WRITERS,
      consumers: [
        ...CONSUMERS_ALL,
        'lib/bom/topologyBom.ts → distributor pricing (quantities ARE instance counts)',
      ],
      legacyMirrors: [BATTERY_COUNT_MIRROR],
      conflict: conflictOn('How many storage units this project has'),
    },
    {
      field: 'Gateway quantity',
      owner: 'service_topology — one gateway per backup domain, by construction',
      persistedAt: 'projects.service_topology → topology.domains[].gateway',
      value: `${m.storage.gatewayCount} gateway(s)`,
      provenance: t
        ? 'service-topology — counted from the backup domains in the graph. A gateway is not a '
          + 'catalogue quantity: it exists because a domain exists.'
        : 'none — no graph, so there are no domains to count.',
      writers: GRAPH_WRITERS,
      consumers: [...CONSUMERS_ALL, 'lib/bom/topologyBom.ts → distributor pricing'],
      legacyMirrors: [],
      conflict: null,
    },
    {
      field: 'Generation / combiner panel quantity',
      owner: 'service_topology.aggregationPanels — a first-class device, never an assumption',
      persistedAt: 'projects.service_topology → topology.aggregationPanels[]',
      value: `${m.storage.perSystemGenerationPanelCount} per-system generation panel(s)`
        + (t ? ` of ${t.aggregationPanels.length} DER aggregation panel(s) total` : ''),
      provenance: t
        ? 'service-topology — counted from the panels in the graph. Ray: "Do not represent the '
          + 'combiner as a note or invisible wiring assumption."'
        : 'none — no graph.',
      writers: GRAPH_WRITERS,
      consumers: [
        ...CONSUMERS_ALL,
        'lib/permit/sections/structuralPages.ts (the service-topology schedule page)',
      ],
      legacyMirrors: [],
      conflict: null,
    },
    {
      field: 'Interconnection method',
      owner: 'service_topology.interconnection + pointsOfInterconnection[].relationship',
      persistedAt: 'projects.service_topology → topology.interconnection / pointsOfInterconnection',
      value: t
        ? `arrangement=${fmt(t.interconnection.derArrangement)}`
          + `; POI relationship(s)=${t.pointsOfInterconnection.length
            ? [...new Set(t.pointsOfInterconnection.map(p => p.relationship))].join(', ')
            : 'none recorded'}`
          + `; meter collar ${t.interconnection.meterCollarSelected ? 'SELECTED' : 'not selected'}`
          + ` (permitted=${fmt(t.interconnection.meterCollarPermitted)})`
        : 'NOT ESTABLISHED — no graph',
      provenance: t
        ? 'service-topology — the designer\'s recorded decision. null arrangement ⇒ nobody has '
          + 'chosen, and the sheet refuses to draw a connection nobody chose.'
        : 'none — no graph.',
      writers: GRAPH_WRITERS,
      consumers: [
        ...CONSUMERS_ALL,
        'lib/electrical/serviceTopology.ts → governingArticleFor (derives the NEC article)',
      ],
      legacyMirrors: [],
      conflict: null,
    },
    {
      field: 'PV module count',
      owner: 'layouts.total_panels — the design places modules, the catalogue does not',
      persistedAt: 'layouts.total_panels (newest layout row)',
      value: m.moduleCount === null ? 'NOT ESTABLISHED — no layout read' : `${m.moduleCount} module(s)`,
      provenance: m.moduleCount === null
        ? 'none — no layout row for this project.'
        : 'layouts — read from the newest layout. Decides the storage-only coupling case and enters '
          + 'the electrical revision.',
      writers: ['app/api/projects/[id]/layout/route.ts', 'the Design Studio save path'],
      consumers: CONSUMERS_ALL,
      legacyMirrors: [],
      conflict: null,
    },
    {
      field: 'Service-topology revision (the electrical state)',
      owner: 'DERIVED — lib/electrical/revision.ts, a pure function of the canonical model',
      persistedAt: 'nowhere. There is nothing to forget to bump.',
      value: loaded.revision,
      provenance: `derived — a stable hash over ${revisionInputs(m).length} enumerated electrical `
        + 'facts. Cosmetic changes (labels, notes) are deliberately excluded.',
      writers: ['nobody — it is computed, never stored'],
      consumers: [
        'app/api/engineering/sld/route.ts (stamps the drawing)',
        'app/api/engineering/permit/route.ts (stamps the package)',
        'app/api/engineering/bom/route.ts (reports it alongside the lines)',
      ],
      legacyMirrors: [],
      conflict: null,
    },
    {
      field: 'Generated-SLD revision (is the drawing current?)',
      owner: 'the stamp ON the generated artifact, compared against the live revision',
      persistedAt: 'the stored SLD artifact / project_files row that carries the stamp',
      value: `live revision is ${loaded.revision}; a stored drawing stamped with anything else is `
        + 'STALE, and an unstamped drawing is UNSTAMPED — never reported as current',
      provenance: 'electricalArtifactFreshness(stamped, current) — three states, no silent pass.',
      writers: ['app/api/engineering/sld/route.ts (on generation)'],
      consumers: ['app/engineering/page.tsx (the Diagram tab\'s freshness badge)'],
      legacyMirrors: [{
        field: 'the artifact\'s updated_at timestamp',
        cannotWinBecause:
          'Freshness is decided by comparing REVISIONS, never by comparing times. A timestamp says '
          + 'when a file was written, not what it was written from — which is why a sheet could be '
          + 'newer than the change that invalidated it and still be wrong.',
        removalPath: 'Nothing to remove; the timestamp is legitimate for display, just not for truth.',
      }],
      conflict: null,
    },
  ];

  return {
    projectId: loaded.projectId,
    electricalRevision: loaded.revision,
    sources: loaded.sources,
    rows,
    conflicts: m.conflicts,
    revisionInputs: revisionInputs(m),
    pendingCanonicalization: m.canonicalizationPatch
      ? `solarCoupling = ${m.canonicalizationPatch.solarCoupling} (${m.solarCouplingProvenance.basis})`
      : null,
  };
}

/**
 * 🚨 THE QUESTION RAY SAID MUST ANSWER "NO": can another persisted field disagree and win?
 *
 * A row FAILS when it has a legacy mirror that does not state a mechanism — because "it is a mirror
 * but we are careful" is the arrangement the audit was called to end. The report is a diagnostic;
 * this is the assertion a test can hang on.
 */
export function mirrorsThatCouldWin(report: ElectricalAuthorityReport): string[] {
  const out: string[] = [];
  for (const row of report.rows) {
    for (const mirror of row.legacyMirrors) {
      if (!mirror.cannotWinBecause.trim() || !mirror.removalPath.trim()) {
        out.push(`${row.field} ← ${mirror.field}`);
      }
    }
  }
  return out;
}
