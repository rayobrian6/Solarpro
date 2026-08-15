// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-2 — THE CANONICAL EQUIPMENT SELECTION AUTHORITY (pure)
// ───────────────────────────────────────────────────────────────────────────
// THE problem (audit §2.4 / Paths 1-4): the permit path has FOUR competing
// equipment authorities and no ranking between them —
//   • projects.selected_equipment.panelId          (the canonical store, mig 101)
//   • projects.selected_equipment.subSystems[k]    (the §1.1 per-sub mirror)
//   • engineering_config.subSystems[k]             (the doctrine owner of the map)
//   • the POSTED fleet: system.inverters[].strings[].panelModel
// buildPermitDesignSnapshot resolves module identity from the POSTED FLEET
// (build.ts:130-133, :141) and then merely REPORTS that the subsystem map
// disagrees (build.ts:680-687 → EQUIPMENT-IDENTITY-CONFLICT). The canonical
// store is never even read by the permit POST (audit Path 1 "Critical").
//
// THIS MODULE is the ONE canonical selection authority WS-2 demands. It is PURE:
// candidates in, verdict out. The DB read, the transactional reconciliation and
// the input re-pin live in the resolver (resolvers.ts) that consumes it.
//
// ── THE PRECEDENCE LATTICE (directive WS-2) ────────────────────────────────
//   explicit user > project > design > fleet > company defaults > subsystem >
//   legacy/generated
// Every candidate carries PROVENANCE (actor, timestamp, record path) and an
// `explicit` flag derived from the WRITING CHANNEL that the data model already
// records (`SubSystemEquipment.source` / `SelectedEquipment.source`:
// 'design' | 'engineering' are USER ACTIONS; 'defaults' | 'migration' are
// generated). Nothing is inferred from a product name — the standing rule
// "product-name topology inference PROHIBITED" applies to identity too.
//
// ── THE SUPERSEDED RULE (Ray's user-authority mandate, 2026-07-27) ─────────
// The old standing rule ("EQUIPMENT-IDENTITY-CONFLICT is cleared only by
// operator reconciliation, never automatically") is SUPERSEDED: a valid CURRENT
// explicit user selection IS the reconciliation authority. A conflict is only a
// conflict when TWO GENUINELY ACTIVE explicit selections disagree.
//
// "Genuinely active" is decided by DOMINATION, never by rank alone:
//
//   canonical DOMINATES a conflicting candidate c  ⇔
//     (1) canonical.rank > c.rank                                     AND
//     (2) c's currency is not contradicted:
//           c carries NO timestamp (an undated record cannot claim currency), OR
//           canonical is at least as recent as c,                      OR
//           a CORROBORATING candidate (same value) is at least as recent as c
//
// Rule (2) is what makes this safe. If the lower-ranked record is NEWER and
// nothing corroborates the higher-ranked one, the engine does NOT get to pick:
// that is the two-active-selections case and it stays OPERATOR_CONFIRMATION.
// It is also why the DB read matters — without projects.selected_equipment the
// posted fleet carries no timestamp at all, so a dated subsystem record is never
// auto-superseded and the blocker correctly survives (which is exactly why a
// no-DB harness run produces a byte-identical snapshot).
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../../types';
import { getPanelById } from '@/lib/equipment-db';
// CMEI — THE canonical module identity accessor. This catalogue delegates to it.
import { resolveModuleIdentity } from '@/lib/equipment/moduleIdentity';
import { EQUIPMENT_SOURCES, type EquipmentSource, type EquipmentSourceValue } from '@/lib/reconciliation/types';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE LATTICE
// ═══════════════════════════════════════════════════════════════════════════

export const EQUIPMENT_SELECTION_TIERS = [
  'explicit-user',      // a user action persisted on the canonical project store
  'project',            // the canonical project store, non-user-authored write
  'design',             // Design Studio's own record (design_electrical / layout)
  'fleet',              // the POSTED engineering fleet (strings)
  'company-default',    // company / catalog default scalars
  'subsystem',          // the §1.1 per-subsystem equipment map
  'legacy-generated',   // a migration- or defaults-synthesized record
] as const;
export type EquipmentSelectionTier = (typeof EQUIPMENT_SELECTION_TIERS)[number];

/** Higher wins. Gaps are deliberate — a later tier can be inserted without
 *  renumbering, and the numbers are recorded in the evidence. */
export const EQUIPMENT_TIER_RANK: Record<EquipmentSelectionTier, number> = {
  'explicit-user': 60,
  project: 50,
  design: 40,
  fleet: 30,
  'company-default': 20,
  subsystem: 10,
  'legacy-generated': 0,
};

/** The writing channels that represent a USER ACTION (the data model's own
 *  vocabulary — SubSystemEquipment.source / SelectedEquipment.source). */
export const EXPLICIT_SELECTION_CHANNELS: readonly string[] = ['design', 'engineering'];
/** Channels that represent a GENERATED record (never a user selection). */
export const GENERATED_SELECTION_CHANNELS: readonly string[] = ['defaults', 'migration'];

export function isExplicitChannel(channel: string | null | undefined): boolean {
  return !!channel && EXPLICIT_SELECTION_CHANNELS.includes(channel);
}

export interface SelectionProvenance {
  /** WHO wrote it — the channel recorded by the store ('design' | 'engineering'
   *  | 'defaults' | 'migration' | 'posted-fleet' | 'reconciliation' | ...). */
  actor: string;
  /** WHEN — ISO timestamp, or null when the store carries none (a posted body). */
  atIso: string | null;
  /** VIA WHAT PATH — the exact record path, quoted in the audit evidence. */
  path: string;
  /** true ⇔ the writing channel is a user action. */
  explicit: boolean;
}

/** The equipment identity fields this authority ranks. Module first (the live
 *  Braidon conflict); the shape is field-generic so inverter / mounting /
 *  battery reconciliation reuses it without a second lattice. */
export const EQUIPMENT_IDENTITY_FIELDS = ['module', 'inverter', 'mounting', 'battery'] as const;
export type EquipmentIdentityField = (typeof EQUIPMENT_IDENTITY_FIELDS)[number];

/** reconcile.ts conflictField names (CANONICAL_KEY_BY_FIELD, reconcile.ts:31). */
export const RECONCILE_FIELD_BY_IDENTITY: Record<EquipmentIdentityField, string> = {
  module: 'module_model',
  inverter: 'inverter_model',
  mounting: 'racking_assembly',
  battery: 'battery_model',
};

export interface EquipmentSelectionCandidate {
  field: EquipmentIdentityField;
  /** roof | ground | fence, or null for a project-wide record. */
  subsystemKey: string | null;
  /** the normalised catalog id (the comparison key). Null ⇒ unusable candidate. */
  value: string | null;
  /** human label for the audit record. */
  label: string | null;
  tier: EquipmentSelectionTier;
  rank: number;
  /** the reconcile.ts source vocabulary (EQUIPMENT_SOURCES). */
  reconciliationSource: EquipmentSource;
  provenance: SelectionProvenance;
}

function candidate(
  field: EquipmentIdentityField,
  tier: EquipmentSelectionTier,
  reconciliationSource: EquipmentSource,
  value: string | null,
  label: string | null,
  provenance: SelectionProvenance,
  subsystemKey: string | null = null,
): EquipmentSelectionCandidate {
  return { field, subsystemKey, value, label, tier, rank: EQUIPMENT_TIER_RANK[tier], reconciliationSource, provenance };
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 — CATALOG RESOLUTION (DI so tests need no catalog, and so the fuzzy match
// is IDENTICAL to the one the pure build uses — build.ts:63-68).
// ═══════════════════════════════════════════════════════════════════════════

export interface PanelIdentity { id: string; manufacturer: string; model: string; watts: number | null }

export interface EquipmentCatalog {
  /** id → identity (the subsystem map + canonical store carry ids). */
  byId(id: string): PanelIdentity | null;
  /** model string → identity (the posted fleet carries model NAMES). */
  byModel(model: string): PanelIdentity | null;
}

/**
 * The production catalog.
 *
 * ══ CMEI — `byModel` NO LONGER SUBSTRING-MATCHES ═══════════════════════════
 * This mirrored build.ts's `fuzz`, which meant the CANONICAL PICKER'S OWN
 * catalogue resolved a posted model string by two-way substring:
 *
 *     list.find(e => e.model.includes(m) || m.includes(e.model))
 *
 * So "REC 400" resolved to "REC 400AA Pure-R", and that became a tiered
 * candidate for the canonical selection — the deepest instance of the defect,
 * sitting underneath the whole tier lattice.
 *
 * It now delegates to `resolveModuleIdentity`, the ONE canonical accessor, which
 * admits an exact unique match (or an exact catalogue-id clue) and FAILS CLOSED
 * on anything ambiguous, partial or fuzzy. A posted model that cannot be
 * identified now contributes NO candidate, which is the honest outcome: the
 * lattice ranks identities, and a guess is not an identity.
 */
export const PRODUCTION_EQUIPMENT_CATALOG: EquipmentCatalog = {
  byId(id: string): PanelIdentity | null {
    const p = getPanelById(id) as { id: string; manufacturer: string; model: string; watts?: number } | undefined;
    return p ? { id: p.id, manufacturer: p.manufacturer, model: p.model, watts: p.watts ?? null } : null;
  },
  byModel(model: string): PanelIdentity | null {
    const idn = resolveModuleIdentity({ model });
    return idn.established && idn.panelId
      ? { id: idn.panelId, manufacturer: idn.manufacturer ?? '', model: idn.model ?? '', watts: idn.watts }
      : null;
  },
};

const labelOf = (p: PanelIdentity | null): string | null => (p ? `${p.manufacturer} ${p.model}` : null);

// ═══════════════════════════════════════════════════════════════════════════
// §3 — CANDIDATE COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

/** The two JSONB stores this authority reads, exactly as they come off the row. */
export interface StoredEquipmentRecord {
  /** projects.selected_equipment (migration 101). */
  selectedEquipment: Record<string, unknown> | null;
  /** engineering_config.subSystems — the doctrine owner of the per-sub map
   *  (lib/db/projects.ts:763-770). */
  engineeringSubSystems: Record<string, unknown> | null;
}

export interface CollectSelectionArgs {
  input: PermitInput;
  /** null when the DB was unreadable / no projectId — the honest offline case. */
  stored: StoredEquipmentRecord | null;
  catalog?: EquipmentCatalog;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const rec = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? (v as Record<string, unknown>) : null;

/**
 * Collect every MODULE-identity candidate the permit path can see, each with
 * full provenance. Order is collection order, not precedence — ranking is
 * decideCanonicalSelection's job.
 */
export function collectModuleSelectionCandidates(args: CollectSelectionArgs): EquipmentSelectionCandidate[] {
  const catalog = args.catalog ?? PRODUCTION_EQUIPMENT_CATALOG;
  const out: EquipmentSelectionCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: EquipmentSelectionCandidate): void => {
    const key = `${c.tier}|${c.provenance.path}|${c.value ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  // ── 1. the CANONICAL STORE, top level (migration 101) ────────────────────
  const sel = rec(args.stored?.selectedEquipment);
  if (sel) {
    const id = str(sel.panelId);
    const channel = str(sel.source) ?? 'unknown';
    const explicit = isExplicitChannel(channel);
    if (id) {
      const p = catalog.byId(id);
      push(candidate(
        'module',
        // A user-authored write on the canonical store is the TOP tier; any other
        // write (reconciliation / unknown channel) is the 'project' tier.
        explicit ? 'explicit-user' : 'project',
        channel === 'design' ? 'design' : 'stored_permit',
        p?.id ?? id, labelOf(p) ?? id,
        { actor: channel, atIso: str(sel.updatedAt), path: 'projects.selected_equipment.panelId', explicit },
      ));
    }
    // ── 2. the canonical store's per-sub mirror ────────────────────────────
    for (const [k, v] of Object.entries(rec(sel.subSystems) ?? {})) {
      const e = rec(v); if (!e) continue;
      const sid = str(e.panelId); if (!sid) continue;
      const ch = str(e.source) ?? 'unknown';
      const ex = isExplicitChannel(ch);
      const p = catalog.byId(sid);
      push(candidate(
        'module', ex ? 'subsystem' : 'legacy-generated', 'subsystem_panel_id',
        p?.id ?? sid, labelOf(p) ?? sid,
        { actor: ch, atIso: str(e.updatedAt), path: `projects.selected_equipment.subSystems.${k}.panelId`, explicit: ex },
        k,
      ));
    }
  }

  // ── 3. engineering_config.subSystems (the map's doctrine owner) ──────────
  for (const [k, v] of Object.entries(rec(args.stored?.engineeringSubSystems) ?? {})) {
    const e = rec(v); if (!e) continue;
    const sid = str(e.panelId); if (!sid) continue;
    const ch = str(e.source) ?? 'unknown';
    const ex = isExplicitChannel(ch);
    const p = catalog.byId(sid);
    push(candidate(
      'module', ex ? 'subsystem' : 'legacy-generated', 'subsystem_panel_id',
      p?.id ?? sid, labelOf(p) ?? sid,
      { actor: ch, atIso: str(e.updatedAt), path: `engineering_config.subSystems.${k}.panelId`, explicit: ex },
      k,
    ));
  }

  // ── 4. the POSTED per-sub map (what generation actually received) ────────
  for (const [k, v] of Object.entries(rec((args.input.project as Record<string, unknown>)?.subSystems) ?? {})) {
    const e = rec(v); if (!e) continue;
    const sid = str(e.panelId); if (!sid) continue;
    const ch = str(e.source) ?? 'unknown';
    const ex = isExplicitChannel(ch);
    const p = catalog.byId(sid);
    push(candidate(
      'module', ex ? 'subsystem' : 'legacy-generated', 'subsystem_panel_id',
      p?.id ?? sid, labelOf(p) ?? sid,
      { actor: ch, atIso: str(e.updatedAt), path: `permit-input#project.subSystems.${k}.panelId`, explicit: ex },
      k,
    ));
  }

  // ── 5. the POSTED FLEET — what the snapshot's module identity is built from
  //    (build.ts:130-133). It carries no timestamp by construction (it is a
  //    request body), which is precisely why it cannot supersede a DATED record
  //    on its own. ─────────────────────────────────────────────────────────
  const invs = (args.input.system?.inverters ?? []) as Array<Record<string, unknown>>;
  for (const inv of invs) {
    for (const s of (inv?.strings ?? []) as Array<Record<string, unknown>>) {
      const model = str(s?.panelModel);
      const pid = str(s?.panelId);
      const p = (pid ? catalog.byId(pid) : null) ?? (model ? catalog.byModel(model) : null);
      const value = p?.id ?? pid ?? null;
      if (!value) continue;
      push(candidate(
        'module', 'fleet', 'fleet', value, labelOf(p) ?? model ?? value,
        {
          actor: 'posted-fleet', atIso: null,
          path: 'permit-input#system.inverters[].strings[].panelModel',
          // The posted fleet is the live engineering model, but the request body
          // is not itself a provenance record: it is not marked explicit.
          explicit: false,
        },
      ));
    }
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — THE VERDICT
// ═══════════════════════════════════════════════════════════════════════════

export interface CanonicalSelectionVerdict {
  field: EquipmentIdentityField;
  /** the winning candidate, or null when nothing usable was found. */
  canonical: EquipmentSelectionCandidate | null;
  /** every candidate that AGREES with the canonical value (corroboration). */
  corroborating: EquipmentSelectionCandidate[];
  /** every candidate whose value DIFFERS from the canonical value. */
  conflicting: EquipmentSelectionCandidate[];
  /** conflicting candidates the canonical DOMINATES ⇒ safe to supersede. */
  superseded: EquipmentSelectionCandidate[];
  /** conflicting candidates the canonical does NOT dominate ⇒ genuinely active. */
  unresolvedActive: EquipmentSelectionCandidate[];
  /** true ⇔ two genuinely active explicit selections disagree. */
  operatorConfirmationRequired: boolean;
  /** true ⇔ there is a divergence at all. */
  divergent: boolean;
  /** the stated ranking basis (rendered into the audit evidence). */
  basis: string;
  reasons: string[];
}

/** `null` timestamps sort oldest. */
const ts = (c: EquipmentSelectionCandidate): string => c.provenance.atIso ?? '';

/**
 * Does `a` dominate `b`? See the module header — rank AND uncontradicted
 * currency, with corroboration allowed to supply the currency evidence.
 */
export function dominates(
  a: EquipmentSelectionCandidate,
  b: EquipmentSelectionCandidate,
  corroborators: EquipmentSelectionCandidate[] = [],
): boolean {
  if (a.rank <= b.rank) return false;
  if (!b.provenance.atIso) return true;                       // undated ⇒ no currency claim
  if (a.provenance.atIso && a.provenance.atIso >= b.provenance.atIso) return true;
  return corroborators.some(c => c.provenance.atIso && c.provenance.atIso >= b.provenance.atIso!);
}

/**
 * THE canonical selection decision. Pure, deterministic, total.
 *
 * Ordering: rank desc, then timestamp desc, then path asc (stable + digest-safe).
 */
export function decideCanonicalSelection(
  candidates: readonly EquipmentSelectionCandidate[],
  field: EquipmentIdentityField = 'module',
): CanonicalSelectionVerdict {
  const usable = candidates.filter(c => c.field === field && c.value);
  if (!usable.length) {
    return {
      field, canonical: null, corroborating: [], conflicting: [], superseded: [], unresolvedActive: [],
      operatorConfirmationRequired: false, divergent: false,
      basis: 'no usable equipment-identity candidate was found in any store or in the posted design',
      reasons: ['no candidate carried a resolvable catalog identity'],
    };
  }
  const ordered = [...usable].sort((x, y) =>
    (y.rank - x.rank) || (ts(y) < ts(x) ? -1 : ts(y) > ts(x) ? 1 : 0)
    || x.provenance.path.localeCompare(y.provenance.path));

  const canonical = ordered[0];
  const corroborating = ordered.filter(c => c !== canonical && c.value === canonical.value);
  const conflicting = ordered.filter(c => c.value !== canonical.value);
  const superseded = conflicting.filter(c => dominates(canonical, c, corroborating));
  const unresolvedActive = conflicting.filter(c => !superseded.includes(c));
  // A genuinely-active EXPLICIT disagreement is the only OPERATOR_CONFIRMATION
  // case. A genuinely-active NON-explicit disagreement (an undominated generated
  // record) is also not auto-reconcilable — it must not be silently overwritten
  // either, so it is reported the same way with its own reason.
  const activeExplicit = unresolvedActive.filter(c => c.provenance.explicit);

  const reasons: string[] = [];
  for (const c of unresolvedActive) {
    reasons.push(
      `${c.provenance.path} = '${c.value}' (${c.label ?? 'unlabelled'}; tier ${c.tier}/${c.rank}, `
      + `${c.provenance.explicit ? 'explicit' : 'generated'} via ${c.provenance.actor}`
      + `${c.provenance.atIso ? ` at ${c.provenance.atIso}` : ', undated'}) is NOT superseded by `
      + `${canonical.provenance.path} = '${canonical.value}' (tier ${canonical.tier}/${canonical.rank}`
      + `${canonical.provenance.atIso ? `, ${canonical.provenance.atIso}` : ', undated'})`,
    );
  }

  const basis = `canonical = ${canonical.provenance.path} = '${canonical.value}' `
    + `(tier ${canonical.tier}, rank ${canonical.rank}, ${canonical.provenance.explicit ? 'explicit' : 'generated'} `
    + `via ${canonical.provenance.actor}${canonical.provenance.atIso ? ` at ${canonical.provenance.atIso}` : ', undated'}); `
    + `${corroborating.length} corroborating, ${superseded.length} superseded, ${unresolvedActive.length} genuinely active`;

  return {
    field, canonical, corroborating, conflicting, superseded, unresolvedActive,
    operatorConfirmationRequired: unresolvedActive.length > 0,
    divergent: conflicting.length > 0,
    basis: activeExplicit.length > 1 || (activeExplicit.length === 1 && canonical.provenance.explicit)
      ? `${basis} — TWO GENUINELY ACTIVE EXPLICIT SELECTIONS`
      : basis,
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 — THE PERSISTED AUTHORITY RECORD (what rides in the snapshot as evidence)
// ═══════════════════════════════════════════════════════════════════════════

export interface SupersededSelectionRecord {
  path: string;
  value: string;
  label: string | null;
  tier: EquipmentSelectionTier;
  actor: string;
  atIso: string | null;
  /** the reason this record lost — never "a newer row won" without saying why. */
  supersededBecause: string;
}

export interface CanonicalEquipmentAuthority {
  field: EquipmentIdentityField;
  /** the canonical identity, persisted with full provenance (WS-2 "persist
   *  canonical identity: mfr, model, rating, registry id, revision, actor,
   *  timestamp"). */
  canonical: {
    catalogId: string;
    manufacturer: string | null;
    model: string | null;
    ratedWatts: number | null;
    tier: EquipmentSelectionTier;
    rank: number;
    actor: string;
    atIso: string | null;
    path: string;
    explicit: boolean;
  } | null;
  /** replaced selections — audit history ONLY. They may never re-enter the
   *  active snapshot (assertSupersededAbsent enforces it). */
  superseded: SupersededSelectionRecord[];
  /** candidates that agreed (the corroboration that carried the currency test). */
  corroboratingPaths: string[];
  /** every candidate considered, for the audit record. */
  consideredPaths: string[];
  divergent: boolean;
  /** true ⇔ two genuinely active selections ⇒ the conflict legitimately stays. */
  operatorConfirmationRequired: boolean;
  /** the stated ranking basis. */
  basis: string;
  /** the reconciliation actually performed (null when none was needed/possible). */
  reconciliation: {
    auditId: string;
    actor: string;
    reason: string;
    reconciledAtIso: string;
    invalidationCount: number;
  } | null;
  /** the record paths the resolver RE-PINNED to the canonical identity. */
  rebuiltRecords: string[];
}

/** The actor a SYSTEM reconciliation is recorded under — never a human id, so
 *  the audit row is honest about who decided. */
export const SYSTEM_RESOLVER_ACTOR = 'system-resolver';

export function buildCanonicalEquipmentAuthority(args: {
  verdict: CanonicalSelectionVerdict;
  catalog?: EquipmentCatalog;
  reconciliation?: CanonicalEquipmentAuthority['reconciliation'];
  rebuiltRecords?: string[];
}): CanonicalEquipmentAuthority {
  const { verdict } = args;
  const catalog = args.catalog ?? PRODUCTION_EQUIPMENT_CATALOG;
  const c = verdict.canonical;
  const p = c?.value ? catalog.byId(c.value) : null;
  return {
    field: verdict.field,
    canonical: c && c.value
      ? {
          catalogId: c.value,
          manufacturer: p?.manufacturer ?? null,
          model: p?.model ?? (c.label ?? null),
          ratedWatts: p?.watts ?? null,
          tier: c.tier, rank: c.rank,
          actor: c.provenance.actor, atIso: c.provenance.atIso, path: c.provenance.path,
          explicit: c.provenance.explicit,
        }
      : null,
    superseded: verdict.superseded.map(s => ({
      path: s.provenance.path, value: s.value as string, label: s.label,
      tier: s.tier, actor: s.provenance.actor, atIso: s.provenance.atIso,
      supersededBecause: `outranked (${s.tier}/${s.rank} < ${c?.tier}/${c?.rank}) and its currency is not `
        + `contradicted (${s.provenance.atIso ?? 'undated'} vs canonical ${c?.provenance.atIso ?? 'undated'})`,
    })),
    corroboratingPaths: verdict.corroborating.map(x => x.provenance.path),
    consideredPaths: [
      ...(c ? [c.provenance.path] : []),
      ...verdict.corroborating.map(x => x.provenance.path),
      ...verdict.conflicting.map(x => x.provenance.path),
    ],
    divergent: verdict.divergent,
    operatorConfirmationRequired: verdict.operatorConfirmationRequired,
    basis: verdict.basis,
    reconciliation: args.reconciliation ?? null,
    rebuiltRecords: args.rebuiltRecords ?? [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.1 — AAC-7 §1(a): STORE OF RECORD vs REQUEST BODY, and the mirrors to fix
// ───────────────────────────────────────────────────────────────────────────
// Candidate paths carry their own origin. A `permit-input#…` path is the POSTED
// REQUEST BODY — it is re-pinned in memory by applyCanonicalEquipmentToInput and
// is not a store, so a divergence there is not something a reconciliation can (or
// should) persist. Only a PERSISTED store divergence justifies writing an audit
// row; that distinction is what makes repeat generation idempotent instead of
// appending an identical reconciliation on every run.
// ═══════════════════════════════════════════════════════════════════════════

/** Path prefix used by collectModuleSelectionCandidates for the request body. */
export const POSTED_PATH_PREFIX = 'permit-input#';

/** true ⇔ the candidate came from a persisted store of record (a DB column). */
export function isPersistedStorePath(path: string): boolean {
  return !path.startsWith(POSTED_PATH_PREFIX);
}

/** A superseded MIRROR record that a reconciliation must re-align, in
 *  reconcile.ts's vocabulary. Shape mirrored (not imported) so this module stays
 *  free of the DB layer; the resolver hands the array straight to
 *  reconcileEquipmentIdentity. */
export interface SupersededMirrorRecord {
  store: 'selected_equipment' | 'engineering_config';
  subsystemKey: string;
  key: string;
  previousValue: string | null;
}

/** The per-subsystem JSONB field for each identity field. */
export const SUBSYSTEM_FIELD_BY_IDENTITY: Record<EquipmentIdentityField, string> = {
  module: 'panelId',
  inverter: 'inverterId',
  mounting: 'mountingId',
  battery: 'batteryId',
};

/**
 * Map the superseded candidates onto the persisted mirror records a
 * reconciliation must re-align. Posted-body candidates are excluded (they are
 * re-pinned, not persisted); the top-level canonical key is excluded (the
 * reconciliation already writes it).
 */
export function supersededMirrorRecords(
  verdict: CanonicalSelectionVerdict,
): SupersededMirrorRecord[] {
  const field = SUBSYSTEM_FIELD_BY_IDENTITY[verdict.field];
  const out: SupersededMirrorRecord[] = [];
  const seen = new Set<string>();
  for (const c of verdict.superseded) {
    const p = c.provenance.path;
    if (!isPersistedStorePath(p)) continue;
    if (!c.subsystemKey) continue;
    const store: SupersededMirrorRecord['store'] | null =
      p.startsWith('projects.selected_equipment.subSystems.') ? 'selected_equipment'
        : p.startsWith('engineering_config.subSystems.') ? 'engineering_config'
          : null;
    if (!store) continue;
    if (!p.endsWith(`.${field}`)) continue;
    const key = `${store}|${c.subsystemKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ store, subsystemKey: c.subsystemKey, key: field, previousValue: c.value });
  }
  return out;
}

/** Superseded candidates that still live in a PERSISTED store — the only ones a
 *  reconciliation has anything to write about. */
export function persistedSupersededCandidates(
  verdict: CanonicalSelectionVerdict,
): EquipmentSelectionCandidate[] {
  return verdict.superseded.filter(c => isPersistedStorePath(c.provenance.path));
}

/** The `sources` array reconcileEquipmentIdentity requires (≥2, one per store). */
export function reconciliationSources(verdict: CanonicalSelectionVerdict): EquipmentSourceValue[] {
  const all = [
    ...(verdict.canonical ? [verdict.canonical] : []),
    ...verdict.corroborating, ...verdict.conflicting,
  ];
  const seen = new Set<string>();
  const out: EquipmentSourceValue[] = [];
  for (const c of all) {
    const key = `${c.reconciliationSource}|${c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: (EQUIPMENT_SOURCES as readonly string[]).includes(c.reconciliationSource)
        ? c.reconciliationSource : 'stored_permit',
      value: c.value,
      label: c.label,
      provenance: `${c.provenance.path} · tier ${c.tier}/${c.rank} · ${c.provenance.explicit ? 'explicit' : 'generated'} `
        + `via ${c.provenance.actor}${c.provenance.atIso ? ` at ${c.provenance.atIso}` : ' (undated)'}`,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 — DOWNSTREAM REBUILD: re-pin every posted record to the canonical identity
// ───────────────────────────────────────────────────────────────────────────
// This is the "invalidate stale dependents ⇒ rebuild downstream" half of WS-2,
// and it reuses the repair the DB layer already performs one level down
// (lib/db/projects.ts:565-613, the P0-11 "recompute-if-contradicts" mirror
// repair) rather than adding a second reconciliation engine: the SAME rule
// (records that contradict the authoritative id are re-aligned to it), applied
// to the permit input instead of the DB row.
//
// Because the pure build, the BOM engine, the datasheet projection and the
// electrical calculations ALL derive from this input, re-pinning it here IS the
// downstream rebuild — there is no parallel "rebuild BOM" path to keep in sync.
// ═══════════════════════════════════════════════════════════════════════════

export interface RepinReport {
  /** record paths actually changed (empty ⇒ nothing to rebuild ⇒ digest stable). */
  changed: string[];
  /** the previous values, by path (audit history). */
  previous: Record<string, string | null>;
}

export function applyCanonicalEquipmentToInput(
  input: PermitInput,
  canonicalCatalogId: string,
  opts?: { catalog?: EquipmentCatalog; nowIso?: string },
): RepinReport {
  const catalog = opts?.catalog ?? PRODUCTION_EQUIPMENT_CATALOG;
  const target = catalog.byId(canonicalCatalogId);
  const changed: string[] = [];
  const previous: Record<string, string | null> = {};
  if (!target) return { changed, previous };

  // ── the posted per-sub map ──────────────────────────────────────────────
  const subs = rec((input.project as Record<string, unknown>)?.subSystems);
  if (subs) {
    for (const [k, v] of Object.entries(subs)) {
      const e = rec(v); if (!e) continue;
      const cur = str(e.panelId);
      if (!cur || cur === target.id) continue;
      previous[`project.subSystems.${k}.panelId`] = cur;
      e.panelId = target.id;
      if (opts?.nowIso) e.updatedAt = opts.nowIso;
      changed.push(`project.subSystems.${k}.panelId`);
    }
  }

  // ── the posted fleet strings (module identity of record for the build) ──
  const invs = (input.system?.inverters ?? []) as Array<Record<string, unknown>>;
  invs.forEach((inv, i) => {
    const strings = (inv?.strings ?? []) as Array<Record<string, unknown>>;
    strings.forEach((s, j) => {
      const curId = str(s.panelId);
      const curModel = str(s.panelModel);
      const resolved = (curId ? catalog.byId(curId) : null) ?? (curModel ? catalog.byModel(curModel) : null);
      if (resolved && resolved.id === target.id) return;
      const path = `system.inverters[${i}].strings[${j}]`;
      previous[`${path}.panelModel`] = curModel;
      s.panelId = target.id;
      s.panelModel = target.model;
      s.panelManufacturer = target.manufacturer;
      if (target.watts != null) s.panelWatts = target.watts;
      changed.push(`${path}.panelModel`);
    });
  });

  return { changed, previous };
}

/**
 * ANTI-VACUITY GUARD: a superseded selection may never re-enter the active
 * snapshot. Returns the paths where a superseded value is still present.
 */
export function findSupersededLeaks(
  input: PermitInput,
  authority: CanonicalEquipmentAuthority,
): string[] {
  const dead = new Set(authority.superseded.map(s => s.value));
  if (!dead.size) return [];
  const leaks: string[] = [];
  const subs = rec((input.project as Record<string, unknown>)?.subSystems);
  for (const [k, v] of Object.entries(subs ?? {})) {
    const e = rec(v); if (!e) continue;
    const cur = str(e.panelId);
    if (cur && dead.has(cur)) leaks.push(`project.subSystems.${k}.panelId=${cur}`);
  }
  const invs = (input.system?.inverters ?? []) as Array<Record<string, unknown>>;
  invs.forEach((inv, i) => {
    ((inv?.strings ?? []) as Array<Record<string, unknown>>).forEach((s, j) => {
      const id = str(s.panelId);
      if (id && dead.has(id)) leaks.push(`system.inverters[${i}].strings[${j}].panelId=${id}`);
    });
  });
  return leaks;
}

/** The dependents a canonical-identity change invalidates. Named explicitly so
 *  the ledger rows say WHAT must be rebuilt, not merely "something changed". */
export const EQUIPMENT_IDENTITY_DEPENDENTS: readonly { scope: string; target: string; reason: string }[] = [
  { scope: 'snapshot', target: 'equipment.modules[0]', reason: 'module identity of record replaced by the canonical selection' },
  { scope: 'calculation', target: 'electrical.conductorAuthority', reason: 'Isc/Voc/Vmp change with the module identity — conductor + OCPD sizing must recompute' },
  { scope: 'calculation', target: 'structural.env / structural utilization', reason: 'module weight + dimensions change the dead load and tributary area' },
  { scope: 'snapshot', target: 'bom (generateBOMForPermit)', reason: 'module line, quantities and per-watt basis derive from the canonical module' },
  { scope: 'snapshot', target: 'equipment document binding (MODULE-EXACT-DATASHEET)', reason: 'the datasheet binding is per module identity and must be re-resolved' },
  { scope: 'engineering_approval', target: 'certification.engineeringReviewApproved', reason: 'a review bound to the pre-reconciliation digest no longer covers this set' },
];
