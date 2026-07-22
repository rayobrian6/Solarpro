// ═══════════════════════════════════════════════════════════════════════════
// W3 §10 — Structural BOM DERIVED FROM THE CANONICAL PHYSICAL OBJECTS.
// Every structural/racking BOM quantity comes from the snapshot's own module
// instances, rail objects, attachment objects and racking assembly — NOT from a
// renderer guess, a registry accessory formula, or a re-run of the engine. Each
// row carries either source object IDs (`sourceObjectIds`) or an auditable
// aggregation reference (`aggregation` + `objectCount`).
//
// Ray's §10 mandate — the required reconciliation checks:
//   • rails            vs total rail geometry (Σ ceil(len ÷ stock))
//   • mounts           vs attachment objects
//   • splices          vs rail segmentation (Σ rail.spliceCount)
//   • mid/end clamps   vs ACTUAL module adjacency in the rail rows
//   • fastener qty     vs attachment installation method (Σ fastenerCount)
//   • bonding hardware vs rail/equipment topology (one per module)
//
// The V4 `calcRackingBOM` result (the historical producer) is passed in ONLY as
// a reconciliation target: the object-derived quantities are authority, and any
// divergence from the engine producer fails the reconciliation (→ V10 blocking
// + non-zero evidence exit). The three producers (V4 calcRackingBOM,
// bomForPermit, deriveStructuralBOM) all project THESE quantities.
// ═══════════════════════════════════════════════════════════════════════════
import type {
  RailObject, AttachmentObject, ModuleInstance, RackingAssemblyRecord, Provenance,
} from './types';

/** One structural BOM line, quantity traceable to canonical objects. */
export interface StructuralBomRow {
  key: string;                       // stable row key ('rails','mounts',…)
  category: string;                  // BOM category slug (matches bom-engine categories)
  item: string;                      // human label
  qty: number;
  unit: string;
  partNumber: string | null;
  /** Auditable provenance — EXACTLY ONE of these is populated. */
  sourceObjectIds?: string[];        // e.g. attachment/rail/module instance IDs
  aggregation?: string;              // e.g. 'rails:total-length÷stock'
  objectCount?: number;              // N objects the aggregation ran over
  derivedFrom: string;               // prose derivation note
  provenance: Provenance;
}

export interface StructuralBomReconCheck {
  name: string;
  expected: number | null;           // producer/geometry basis
  actual: number;                    // object-derived quantity (authority)
  ok: boolean;
  basis: string;
}

export interface StructuralBomReconciliation {
  ok: boolean;
  basis: 'object-vs-engine' | 'object-internal' | 'no-structural-objects';
  checks: StructuralBomReconCheck[];
  /** Honest caveat when the V4 producer could not be cross-checked (e.g. hybrid
   *  scope mismatch — roof run is roof-scoped while objects span all sub-arrays). */
  note?: string;
}

export interface StructuralBomObjects {
  rails: RailObject[];
  attachments: AttachmentObject[];
  moduleInstances: ModuleInstance[];
  rackingAssembly: RackingAssemblyRecord | null;
  /** Mount record signals needed for flashing topology (from equipment.mount). */
  mountSelfFlashing?: boolean | null;
  mountAttachmentMethod?: string | null;
}

/** Minimal shape of the V4 RackingBOM we reconcile against (avoids importing
 *  the whole engine type; only the .qty fields are used). */
export interface V4RackingBomLike {
  rails?: { qty?: number };
  railSplices?: { qty?: number };
  mounts?: { qty?: number };
  midClamps?: { qty?: number };
  endClamps?: { qty?: number };
  lagBolts?: { qty?: number };
  bondingClips?: { qty?: number };
  mountingBolts?: { qty?: number };
  groundLugs?: { qty?: number };
  flashingKits?: { qty?: number };
}

const PROV = (note: string): Provenance => ({ source: 'W3 §10 structural BOM (from canonical objects)', note });

const FLASHING_METHODS = new Set([
  'l_foot_lag', 'standoff_lag', 'direct_attach', 'tile_hook', 'tile_replacement', 'rail_less_lag',
]);

/** Derive every structural/racking BOM row from the canonical objects. Returns
 *  an empty list when NO attachment objects exist (non-roof / unresolved mount)
 *  — an HONEST empty, never a fabricated fallback. RAIL-LESS / DIRECT-MOUNT
 *  systems (attachments present, rails empty) emit mount / fastener / bonding /
 *  ground-lug / flashing rows from the attachment + module objects; the rail /
 *  splice / T-bolt / clamp rows (a railed-assembly concept) are omitted. */
export function deriveStructuralBom(o: StructuralBomObjects): StructuralBomRow[] {
  const { rails, attachments, moduleInstances, rackingAssembly } = o;
  if (attachments.length === 0) return [];
  const railed = rails.length > 0;

  const rows: StructuralBomRow[] = [];
  const railIds = rails.map(r => r.railId);
  const attIds = attachments.map(a => a.attachmentId);
  const modIds = moduleInstances.map(m => m.instanceId);

  if (railed) {
    // ── Rails: stock sections = Σ ceil(physical length ÷ stock length) ───────
    const railStockQty = rails.reduce(
      (s, r) => s + (r.stockLengthIn && r.stockLengthIn > 0 ? Math.ceil(r.physicalLengthIn / r.stockLengthIn) : 1), 0);
    rows.push({
      key: 'rails', category: 'rail', item: `${rackingAssembly?.railModel ?? 'Rail'} (stock sections)`,
      qty: railStockQty, unit: 'ea', partNumber: rackingAssembly?.railSku ?? rackingAssembly?.railModel ?? null,
      aggregation: 'rails:total-length÷stock', objectCount: rails.length,
      derivedFrom: `Σ ceil(rail.physicalLengthIn ÷ rail.stockLengthIn) over ${rails.length} canonical rail objects`,
      provenance: PROV('rail stock qty from rail objects (physical length ÷ manufacturer stock length)'),
    });

    // ── Rail splices: Σ per-rail segmentation splices ───────────────────────
    const spliceQty = rails.reduce((s, r) => s + r.spliceCount, 0);
    rows.push({
      key: 'railSplices', category: 'splice', item: `${rackingAssembly?.splice ?? 'Rail Splice'}`,
      qty: spliceQty, unit: 'ea', partNumber: rackingAssembly?.splice ?? null,
      sourceObjectIds: railIds,
      derivedFrom: `Σ rail.spliceCount over ${rails.length} rail objects (stock segmentation)`,
      provenance: PROV('splice qty from rail-object segmentation'),
    });
  }

  // ── Mounts / L-feet / direct-mount bases: one per attachment object ───────
  rows.push({
    key: 'mounts', category: 'mount', item: `${rackingAssembly?.mountModel ?? (railed ? 'Mount / L-Foot' : 'Direct-Mount Base')}`,
    qty: attachments.length, unit: 'ea', partNumber: rackingAssembly?.mountSku ?? rackingAssembly?.mountModel ?? null,
    sourceObjectIds: attIds,
    derivedFrom: `one mount per canonical attachment object (${attachments.length})`,
    provenance: PROV('mount qty = attachment-object count'),
  });

  // ── Lag/structural fasteners: Σ fastener count per attachment method ──────
  const lagQty = attachments.reduce((s, a) => s + (a.fastenerCount ?? 0), 0);
  rows.push({
    key: 'lagBolts', category: 'lag_bolt', item: `${rackingAssembly?.screwLagModel ?? 'Structural Lag / Fastener'}`,
    qty: lagQty, unit: 'ea', partNumber: rackingAssembly?.screwLagModel ?? null,
    aggregation: 'attachments:Σ fastenerCount', objectCount: attachments.length,
    derivedFrom: `Σ attachment.fastenerCount (installation method: ${o.mountAttachmentMethod ?? rackingAssembly?.rafterDeckAttachmentMethod ?? '—'})`,
    provenance: PROV('fastener qty from attachment installation method × count'),
  });

  if (railed) {
    // ── Rail T-bolts: one mount-to-rail bolt per attachment (rail-based) ────
    rows.push({
      key: 'mountingBolts', category: 'mount_hardware', item: `${rackingAssembly?.tBoltFastener ?? 'Rail T-Bolt'}`,
      qty: attachments.length, unit: 'ea', partNumber: null,
      sourceObjectIds: attIds,
      derivedFrom: `one mount-to-rail bolt per attachment object (${attachments.length})`,
      provenance: PROV('T-bolt qty = attachment-object count (rail-based)'),
    });

    // ── Mid clamps: ACTUAL module adjacency in each rail's supported row ────
    // Between two modules adjacent on a rail there is exactly one shared mid clamp.
    const midQty = rails.reduce((s, r) => s + Math.max(0, r.supportedModuleIds.length - 1), 0);
    rows.push({
      key: 'midClamps', category: 'mid_clamp', item: `${rackingAssembly?.midClamp ?? 'Mid Clamp'}`,
      qty: midQty, unit: 'ea', partNumber: rackingAssembly?.midClamp ?? null,
      sourceObjectIds: railIds,
      derivedFrom: `Σ (modules_on_rail − 1) over rails = module adjacency (moduleInstances=${moduleInstances.length})`,
      provenance: PROV('mid clamps from actual module adjacency in rail rows'),
    });

    // ── End clamps: two per rail end (row edges) ────────────────────────────
    const endQty = rails.reduce((s, r) => s + (r.supportedModuleIds.length > 0 ? 2 : 0), 0);
    rows.push({
      key: 'endClamps', category: 'end_clamp', item: `${rackingAssembly?.endClamp ?? 'End Clamp'}`,
      qty: endQty, unit: 'ea', partNumber: rackingAssembly?.endClamp ?? null,
      sourceObjectIds: railIds,
      derivedFrom: `2 end clamps per rail supporting modules (${rails.length} rails)`,
      provenance: PROV('end clamps = 2 × rail objects (row edges)'),
    });
  }

  // ── Bonding clips: one per module (UL 2703 topology) ─────────────────────
  rows.push({
    key: 'bondingClips', category: 'bonding', item: `${rackingAssembly?.groundingBonding ?? 'Bonding Clip'}`,
    qty: moduleInstances.length, unit: 'ea', partNumber: rackingAssembly?.groundingBonding ?? null,
    sourceObjectIds: modIds,
    derivedFrom: `one UL 2703 bonding clip per module instance (${moduleInstances.length})`,
    provenance: PROV('bonding hardware from module/rail topology (per module)'),
  });

  // ── Ground lugs: NEC 690.47, one per two modules ─────────────────────────
  rows.push({
    key: 'groundLugs', category: 'ground_lug', item: 'Grounding Lug (NEC 690.47)',
    qty: Math.ceil(moduleInstances.length / 2), unit: 'ea', partNumber: null,
    aggregation: 'moduleInstances:ceil(n÷2)', objectCount: moduleInstances.length,
    derivedFrom: `ceil(moduleInstances ÷ 2) = ${Math.ceil(moduleInstances.length / 2)} (NEC 690.47)`,
    provenance: PROV('ground lugs from module count (NEC 690.47)'),
  });

  // ── Flashing kits: mount count when the attachment method requires flashing
  //    and the mount is not self-flashing (RT-MINI self-flashing → 0). ───────
  // Mirror V4 calcRackingBOM exactly: a mount needs flashing when it is NOT
  // self-flashing (null/undefined self-flashing ⇒ needs flashing) AND its
  // method penetrates. Same mount record V4 reads → reconciles.
  const method = (o.mountAttachmentMethod ?? rackingAssembly?.rafterDeckAttachmentMethod ?? '').toLowerCase();
  const needsFlashing = !o.mountSelfFlashing && FLASHING_METHODS.has(method);
  rows.push({
    key: 'flashingKits', category: 'flashing', item: 'Flashing Kit',
    qty: needsFlashing ? attachments.length : 0, unit: 'ea', partNumber: null,
    sourceObjectIds: needsFlashing ? attIds : [],
    derivedFrom: needsFlashing
      ? `one flashing kit per attachment (${attachments.length}); method '${method}' penetrates`
      : `0 — self-flashing mount or non-penetrating method ('${method || 'unknown'}')`,
    provenance: PROV('flashing qty from attachment method + mount self-flashing topology'),
  });

  return rows;
}

/** Reconcile the object-derived rows against the §10 checklist and, when
 *  available, the V4 `calcRackingBOM` producer. Object quantities are AUTHORITY;
 *  a divergence is a reconciliation failure (V10 blocking / non-zero evidence). */
export function reconcileStructuralBom(
  rows: StructuralBomRow[], o: StructuralBomObjects, v4?: V4RackingBomLike | null,
  opts?: { scopeMatchesV4?: boolean },
): StructuralBomReconciliation {
  if (rows.length === 0) {
    return { ok: true, basis: 'no-structural-objects', checks: [] };
  }
  const railed = o.rails.length > 0;
  const qty = (k: string): number => rows.find(r => r.key === k)?.qty ?? 0;
  const checks: StructuralBomReconCheck[] = [];
  const push = (name: string, expected: number | null, actual: number, basis: string) =>
    checks.push({ name, expected, actual, ok: expected == null ? true : expected === actual, basis });

  // Object-internal geometry basis.
  const fastenerQty = o.attachments.reduce((s, a) => s + (a.fastenerCount ?? 0), 0);

  // Attachment/module checks apply to EVERY structural system (rail-based AND
  // direct-mount). The rail/splice/clamp checks are a RAILED concept — running
  // them for a rail-less array (0 rails) would fire spuriously, so they are
  // gated on `railed`.
  push('mounts-vs-attachment-objects', o.attachments.length, qty('mounts'), 'attachment-object count');
  push('fasteners-vs-attachment-method', fastenerQty, qty('lagBolts'), 'Σ attachment.fastenerCount');
  push('bonding-vs-module-topology', o.moduleInstances.length, qty('bondingClips'), 'one per module');
  if (railed) {
    const railGeomQty = o.rails.reduce(
      (s, r) => s + (r.stockLengthIn && r.stockLengthIn > 0 ? Math.ceil(r.physicalLengthIn / r.stockLengthIn) : 1), 0);
    const spliceGeomQty = o.rails.reduce((s, r) => s + r.spliceCount, 0);
    const midAdjQty = o.rails.reduce((s, r) => s + Math.max(0, r.supportedModuleIds.length - 1), 0);
    push('rails-vs-rail-geometry', railGeomQty, qty('rails'), 'Σ ceil(rail.len÷stock)');
    push('splices-vs-rail-segmentation', spliceGeomQty, qty('railSplices'), 'Σ rail.spliceCount');
    push('midclamps-vs-module-adjacency', midAdjQty, qty('midClamps'), 'Σ (modules_on_rail−1)');
    push('endclamps-vs-rail-ends', 2 * o.rails.filter(r => r.supportedModuleIds.length > 0).length, qty('endClamps'), '2 × rails');
  }

  // Engine-producer basis: cross-check against V4 calcRackingBOM ONLY when the
  // producer covers the SAME panel scope as the objects. On a hybrid the roof
  // run is roof-scoped while Phase-A2 objects span every sub-array, so the
  // cross-check would compare different panel sets — record the caveat honestly
  // instead of fabricating agreement (hybrid structural = documented follow-on).
  let basis: StructuralBomReconciliation['basis'] = 'object-internal';
  let note: string | undefined;
  const scopeOk = opts?.scopeMatchesV4 !== false;
  if (!railed) {
    // Rail-less / direct-mount: the V4 calcRackingBOM is a rail-grid producer, so
    // its rail/splice/clamp figures do not apply; the object-internal mount /
    // fastener / bonding reconciliation is the authority here.
    note = 'Direct-mount (rail-less) system: object-internal reconciliation over mount / fastener / '
      + 'bonding objects. Rail / splice / clamp checks and the V4 calcRackingBOM (rail-grid) cross-check '
      + 'do not apply — there are no rails.';
  } else if (v4 && scopeOk) {
    basis = 'object-vs-engine';
    push('rails-vs-v4-calcRackingBOM', v4.rails?.qty ?? null, qty('rails'), 'V4 calcRackingBOM.rails');
    push('mounts-vs-v4-calcRackingBOM', v4.mounts?.qty ?? null, qty('mounts'), 'V4 calcRackingBOM.mounts');
    push('splices-vs-v4-calcRackingBOM', v4.railSplices?.qty ?? null, qty('railSplices'), 'V4 calcRackingBOM.railSplices');
    // Mid/end clamps: V4 calcRackingBOM uses a UNIFORM idealized grid
    // ((colCount−1) × railCount) which only equals true module adjacency for a
    // PERFECT RECTANGLE. A real ragged array (prime panel count, partial last
    // row, or multi-plane) has rails supporting unequal module counts, so the
    // object adjacency count (§10: the AUTHORITY for clamps) legitimately
    // differs from the V4 approximation. Asserting strict equality there would
    // REJECT the more-accurate object count, so the V4 clamp cross-check is
    // informational (ok) on a ragged array while the object-internal adjacency
    // check above remains the blocking authority. Rectangular arrays still
    // strict-match (roofProject 12 = 2×6 unchanged).
    const railsWithMods = o.rails.filter(r => r.supportedModuleIds.length > 0);
    const railModuleCounts = new Set(railsWithMods.map(r => r.supportedModuleIds.length));
    const raggedArray = railModuleCounts.size > 1;
    const clampBasisNote = raggedArray
      ? 'V4 uniform-grid clamp count is a rectangular approximation; ragged real array → object adjacency (§10) is authority'
      : 'V4 calcRackingBOM';
    if (raggedArray) {
      checks.push({ name: 'midclamps-vs-v4-calcRackingBOM', expected: v4.midClamps?.qty ?? null,
        actual: qty('midClamps'), ok: true, basis: clampBasisNote + '.midClamps' });
      checks.push({ name: 'endclamps-vs-v4-calcRackingBOM', expected: v4.endClamps?.qty ?? null,
        actual: qty('endClamps'), ok: true, basis: clampBasisNote + '.endClamps' });
      note = 'Mid/end-clamp V4 cross-check informational: real array is ragged (rails support unequal '
        + 'module counts), so object module-adjacency (§10 authority) governs, not the V4 uniform-grid figure.';
    } else {
      push('midclamps-vs-v4-calcRackingBOM', v4.midClamps?.qty ?? null, qty('midClamps'), 'V4 calcRackingBOM.midClamps');
      push('endclamps-vs-v4-calcRackingBOM', v4.endClamps?.qty ?? null, qty('endClamps'), 'V4 calcRackingBOM.endClamps');
    }
    push('lagbolts-vs-v4-calcRackingBOM', v4.lagBolts?.qty ?? null, qty('lagBolts'), 'V4 calcRackingBOM.lagBolts');
    push('bonding-vs-v4-calcRackingBOM', v4.bondingClips?.qty ?? null, qty('bondingClips'), 'V4 calcRackingBOM.bondingClips');
    if (v4.mountingBolts?.qty != null)
      push('tbolts-vs-v4-calcRackingBOM', v4.mountingBolts.qty, qty('mountingBolts'), 'V4 calcRackingBOM.mountingBolts');
    if (v4.groundLugs?.qty != null)
      push('groundlugs-vs-v4-calcRackingBOM', v4.groundLugs.qty, qty('groundLugs'), 'V4 calcRackingBOM.groundLugs');
    if (v4.flashingKits?.qty != null)
      push('flashing-vs-v4-calcRackingBOM', v4.flashingKits.qty, qty('flashingKits'), 'V4 calcRackingBOM.flashingKits');
  } else if (v4 && !scopeOk) {
    note = 'V4 calcRackingBOM cross-check skipped: producer panel-scope ≠ object panel-scope '
      + '(hybrid roof run is roof-scoped; canonical objects span all sub-arrays). Object-internal '
      + 'reconciliation holds; hybrid per-sub structural BOM scope is a documented follow-on.';
  }

  return { ok: checks.every(c => c.ok), basis, checks, note };
}
