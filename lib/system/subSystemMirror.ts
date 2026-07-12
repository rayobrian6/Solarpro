// ═══════════════════════════════════════════════════════════════
// Per-subsystem STORAGE ARMOR — Wave 1b of
// docs/ARCHITECTURE-per-subsystem-equipment.md (FROZEN CONTRACT v1.0).
//
// This module is the single home of:
//   • derivePrimaryMirror()          (§1.4 — deterministic roof > ground > fence,
//                                     NEVER a panel-count vote)
//   • canonicalIdTuple() + compare   (§1.6 / I-5 — the (panelId, inverterId,
//                                     topology, mountingId, batteryId) tuple)
//   • assertMirrorInvariant()        (I-5 save-time assertion: mirror === f(map);
//                                     on violation console.error + REPAIR from
//                                     the map — drift is never persisted)
//   • deriveConfigScalarsFromMirror() / deriveSelectedEquipmentFlatFromMirror()
//                                    (single-writer flat mirrors, §1.4)
//   • renormalizeStaleConfigWrite()  (§1.3 old-client write protection: a
//                                     pre-deploy tab with a stale whitelist
//                                     cannot strip tags / collapse the map)
//   • subSystemEntryFromFlatEquipmentPatch() (legacy selected_equipment writes
//                                     are RE-MIRRORED into the map, not
//                                     interleaved beside it)
//
// Mirror-application rule (§1.4, Wave-1 safety clause): flat scalars are
// REWRITTEN from the map only when the map has >1 entries. Single-entry maps
// mirror identically to today (the entry was synthesized FROM those scalars),
// so Wave 1b has zero live behavior change. The I-5 assertion still runs for
// single-entry maps — strict both-present mismatches are logged AND repaired
// (never persist drift), which is a no-op for every config that exists today.
//
// Like subSystemEquipment.ts, this module only imports that dependency-free
// contract module — safe for client and server bundles alike.
// ═══════════════════════════════════════════════════════════════

import {
  SUB_SYSTEM_KEYS,
  isSubSystemKey,
  toSubSystemKey,
  synthesizeFromLegacyScalars,
  type LegacyScalarConfig,
  type SubSystemEquipment,
  type SubSystemEquipmentMap,
  type SubSystemKey,
} from './subSystemEquipment';

/** §1.4 — fixed derivation order. Never a panel-count majority. */
export const SUB_SYSTEM_MIRROR_ORDER: readonly SubSystemKey[] = SUB_SYSTEM_KEYS;

// ─── Map inspection ──────────────────────────────────────────────────────────

/**
 * Parse an unknown value into a SubSystemEquipmentMap, keeping only valid
 * SubSystemKey entries. Returns null for absent/empty/invalid maps — an empty
 * `{}` is ABSENT per the Wave-1a rule (a degenerate write must not erase the
 * project's one subsystem).
 */
export function normalizeSubSystemMap(raw: unknown): SubSystemEquipmentMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: SubSystemEquipmentMap = {};
  for (const key of SUB_SYSTEM_KEYS) {
    const e = (raw as Record<string, unknown>)[key];
    if (e && typeof e === 'object' && !Array.isArray(e)) out[key] = e as SubSystemEquipment;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function subSystemEntryCount(map: unknown): number {
  const m = normalizeSubSystemMap(map);
  return m ? (Object.keys(m) as SubSystemKey[]).length : 0;
}

/**
 * §1.4 — THE deterministic primary-mirror rule:
 *
 *   Primary subsystem = first present key in fixed order roof > ground > fence.
 *
 * Every legacy flat mirror (selected_equipment top-level, ProjectConfig
 * scalars, …) is derived from the map by THIS function — single writer per
 * store, never computed in parallel (I-5).
 */
export function derivePrimaryMirror(map: unknown): SubSystemEquipment | null {
  const m = normalizeSubSystemMap(map);
  if (!m) return null;
  for (const key of SUB_SYSTEM_MIRROR_ORDER) {
    if (m[key]) return m[key]!;
  }
  return null;
}

/** The MAP key the primary mirror lives under (authoritative even when an
 *  entry's own `key` field is missing/malformed). */
export function derivePrimaryKey(map: unknown): SubSystemKey | null {
  const m = normalizeSubSystemMap(map);
  if (!m) return null;
  for (const key of SUB_SYSTEM_MIRROR_ORDER) {
    if (m[key]) return key;
  }
  return null;
}

// ─── Canonical id-tuple (§1.6 / I-5) ─────────────────────────────────────────

/**
 * The canonical equipment identity of a subsystem entry or a flat mirror.
 * Comparing THIS tuple (never raw field/key sets) makes every check immune to
 * the batteryKwh → batteryKwhPerUnit rename and to provenance fields
 * (source/updatedAt/env) — contract §1.6.
 */
export interface CanonicalIdTuple {
  panelId: string | null;
  inverterId: string | null;
  topology: string | null;
  mountingId: string | null;
  batteryId: string | null;
}

const CANONICAL_TUPLE_FIELDS = [
  'panelId', 'inverterId', 'topology', 'mountingId', 'batteryId',
] as const satisfies readonly (keyof CanonicalIdTuple)[];

const idOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

export function canonicalIdTuple(e: {
  panelId?: string | null;
  inverterId?: string | null;
  topology?: string | null;
  mountingId?: string | null;
  batteryId?: string | null;
} | null | undefined): CanonicalIdTuple {
  return {
    panelId: idOrNull(e?.panelId),
    inverterId: idOrNull(e?.inverterId),
    topology: idOrNull(e?.topology),
    mountingId: idOrNull(e?.mountingId),
    batteryId: idOrNull(e?.batteryId),
  };
}

/** Ordered array form for canonical (deterministic) serialization/hashing. */
export function canonicalIdTupleArray(e: Parameters<typeof canonicalIdTuple>[0]): (string | null)[] {
  const t = canonicalIdTuple(e);
  return CANONICAL_TUPLE_FIELDS.map(f => t[f]);
}

/**
 * Field-wise comparison where `null` on EITHER side is compatible: a flat
 * store that cannot represent a field (ProjectConfig has no flat panelId;
 * selected_equipment has no topology) never reads as drift. Real drift =
 * both sides present AND different.
 */
export function idTuplesCompatible(a: CanonicalIdTuple, b: CanonicalIdTuple): boolean {
  return CANONICAL_TUPLE_FIELDS.every(f => a[f] === null || b[f] === null || a[f] === b[f]);
}

/**
 * §1.6 — degenerate map = exactly one entry whose canonical id-tuple is
 * compatible with the flat mirror's tuple. Degenerate (or absent) maps hash
 * the LEGACY shape, so adding the map to an unchanged single-system project
 * never changes its designVersionId (I-9: no false staleness, no fleet-wide
 * report rebuild). The extended hash kicks in only for genuinely hybrid
 * equipment or real map/mirror drift.
 */
export function isDegenerateSubSystemMap(map: unknown, flatMirrorTuple: CanonicalIdTuple): boolean {
  const m = normalizeSubSystemMap(map);
  if (!m) return true; // absent counts as degenerate → legacy hash
  const keys = (Object.keys(m) as SubSystemKey[]);
  if (keys.length !== 1) return false;
  return idTuplesCompatible(canonicalIdTuple(m[keys[0]]!), flatMirrorTuple);
}

/**
 * Canonical serialization of the map for hashing: fixed roof/ground/fence key
 * order, id-tuples only (rename/provenance immune). Deterministic across
 * key-insertion order.
 */
export function canonicalMapSerialization(map: unknown): Array<[SubSystemKey, (string | null)[]]> {
  const m = normalizeSubSystemMap(map);
  if (!m) return [];
  const out: Array<[SubSystemKey, (string | null)[]]> = [];
  for (const key of SUB_SYSTEM_KEYS) {
    if (m[key]) out.push([key, canonicalIdTupleArray(m[key]!)]);
  }
  return out;
}

// ─── I-5 save-time assertion ─────────────────────────────────────────────────

export interface MirrorAssertionResult {
  /** true when the flat mirror is compatible with derivePrimaryMirror(map). */
  ok: boolean;
  mirror: SubSystemEquipment | null;
  entryCount: number;
  /** Tuple fields that strictly disagreed (both present, different). */
  driftFields: (keyof CanonicalIdTuple)[];
}

/**
 * I-5: `mirror === derivePrimaryMirror(map)` on the canonical id-tuple.
 * On violation: console.error (loud, greppable) — the CALLER repairs by
 * overwriting the drifted flat fields from the returned `mirror` (via the
 * derive*FromMirror helpers below). Drift is never persisted.
 */
export function assertMirrorInvariant(
  flat: Parameters<typeof canonicalIdTuple>[0],
  map: unknown,
  store: string,
): MirrorAssertionResult {
  const m = normalizeSubSystemMap(map);
  const mirror = derivePrimaryMirror(m);
  const entryCount = m ? (Object.keys(m) as SubSystemKey[]).length : 0;
  if (!mirror) return { ok: true, mirror: null, entryCount, driftFields: [] };

  const a = canonicalIdTuple(flat);
  const b = canonicalIdTuple(mirror);
  const driftFields = CANONICAL_TUPLE_FIELDS.filter(
    f => a[f] !== null && b[f] !== null && a[f] !== b[f],
  );
  if (driftFields.length > 0) {
    console.error(
      `[I-5 VIOLATION] ${store}: flat mirror drifted from derivePrimaryMirror(subSystems) — repairing from the map (single-writer rule, contract §1.4)`,
      { driftFields, flat: a, mirror: b, entryCount },
    );
  }
  return { ok: driftFields.length === 0, mirror, entryCount, driftFields };
}

// ─── Mirror → flat derivations (single writer, §1.4) ─────────────────────────

/**
 * ProjectConfig flat scalars derived from the primary mirror. Scope is the
 * mirror-owned scalar set: mountingId + the battery trio. `batteryKwhPerUnit`
 * maps to legacy `batteryKwh` 1:1 — legacy batteryKwh is ALREADY per-unit
 * (page.tsx multiplies by batteryCount for totals); never multiply/divide.
 * `batteryId: null` on the mirror means EXPLICITLY CLEARED → legacy clear
 * shape ('' / 0 / 0). Fields the mirror doesn't define are left untouched.
 */
export function deriveConfigScalarsFromMirror(mirror: SubSystemEquipment): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (idOrNull(mirror.mountingId)) out.mountingId = mirror.mountingId;
  if (mirror.batteryId === null) {
    out.batteryId = '';
    out.batteryCount = 0;
    out.batteryKwh = 0;
  } else if (idOrNull(mirror.batteryId)) {
    out.batteryId = mirror.batteryId;
    if (typeof mirror.batteryCount === 'number') out.batteryCount = mirror.batteryCount;
    if (typeof mirror.batteryKwhPerUnit === 'number') out.batteryKwh = mirror.batteryKwhPerUnit; // 1:1
  }
  return out;
}

/**
 * selected_equipment TOP-LEVEL flat mirror derived from the primary mirror.
 * Ids only — full-record resolution (panel/battery snapshots) stays the job
 * of reconcileFromEngineeringConfig / the design writer.
 */
export function deriveSelectedEquipmentFlatFromMirror(mirror: SubSystemEquipment): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (idOrNull(mirror.panelId)) out.panelId = mirror.panelId;
  if (idOrNull(mirror.inverterId)) out.inverterId = mirror.inverterId;
  if (idOrNull(mirror.mountingId)) out.mountingId = mirror.mountingId;
  if (mirror.batteryId === null) {
    out.batteryId = '';
    out.batteryCount = 0;
    out.batteryKwh = 0;
  } else if (idOrNull(mirror.batteryId)) {
    out.batteryId = mirror.batteryId;
    if (typeof mirror.batteryCount === 'number') out.batteryCount = mirror.batteryCount;
    if (typeof mirror.batteryKwhPerUnit === 'number') out.batteryKwh = mirror.batteryKwhPerUnit; // 1:1
  }
  return out;
}

/**
 * Fold a LEGACY flat selected_equipment patch into a SubSystemEquipment entry
 * patch for the primary key — §1.3: old-client writes against a v2 envelope
 * are "detected via schemaVersion and re-mirrored, not interleaved".
 * batteryKwh (legacy, per-unit) → batteryKwhPerUnit 1:1.
 */
export function subSystemEntryFromFlatEquipmentPatch(
  patch: Record<string, unknown>,
  key: SubSystemKey,
  nowIso: string,
): Partial<SubSystemEquipment> & Pick<SubSystemEquipment, 'key' | 'source' | 'updatedAt'> {
  const out: Record<string, unknown> = {
    key,
    source: patch.source === 'design' ? 'design' : 'engineering',
    updatedAt: nowIso,
  };
  if (idOrNull(patch.panelId as string)) out.panelId = patch.panelId;
  if (idOrNull(patch.inverterId as string)) out.inverterId = patch.inverterId;
  if (idOrNull(patch.mountingId as string)) out.mountingId = patch.mountingId;
  if (patch.batteryId === '' || (patch.batteryId == null && patch.batteryCount === 0 && 'batteryCount' in patch)) {
    out.batteryId = null; // explicit clear
    out.batteryCount = 0;
  } else if (idOrNull(patch.batteryId as string)) {
    out.batteryId = patch.batteryId;
    if (typeof patch.batteryCount === 'number') out.batteryCount = patch.batteryCount;
    if (typeof patch.batteryKwh === 'number' && patch.batteryKwh > 0) {
      out.batteryKwhPerUnit = patch.batteryKwh; // legacy batteryKwh IS per-unit — 1:1
    }
  }
  return out as Partial<SubSystemEquipment> & Pick<SubSystemEquipment, 'key' | 'source' | 'updatedAt'>;
}

// ─── §1.3 server-side re-normalization of stale-schema writes ────────────────

export interface RenormalizeStaleWriteOpts {
  /** The STORED engineering_config (schemaVersion >= 2) the stale client couldn't see. */
  storedConfig: (LegacyScalarConfig & Record<string, unknown>) | null | undefined;
  /**
   * Distinct SubSystemKeys stamped on layouts.panels (membership authority,
   * §1.1) — callers classify via classifyPanel(). Exactly one distinct key =
   * every untagged inverter belongs to it.
   */
  panelStampKeys?: SubSystemKey[] | null;
  /** CAD-side systemType fallback (contract §1.5 inherit chain). */
  cadSystemType?: string | null;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

export interface RenormalizeStaleWriteResult {
  config: Record<string, unknown>;
  /** How many incoming inverters had their subSystemKey restored. */
  retaggedInverters: number;
  /** Stored map keys preserved verbatim (the stale client couldn't see them). */
  preservedKeys: SubSystemKey[];
  /** The key whose entry was re-synthesized from the incoming flat scalars. */
  primaryKey: SubSystemKey;
}

/**
 * §1.3 old-client write protection: a payload with schemaVersion < 2 (or
 * absent) arriving for a project whose STORED engineering_config has
 * schemaVersion >= 2 went through a stale client whitelist — its tags were
 * stripped and it never saw the subSystems map. Rebuild both server-side
 * BEFORE persisting:
 *
 *  1. Re-tag inverters/strings: stored tag by matching id first (the stale
 *     whitelist stripped them — restore, don't guess), else the sole
 *     layouts.panels stamp key, else the §1.5 inherit chain
 *     (config.systemType ?? cad.systemType ?? stored.systemType ?? 'roof').
 *  2. Re-synthesize the map: the stale client's flat-scalar edits belong to
 *     the PRIMARY subsystem (the only one its legacy UI showed); every other
 *     stored entry is preserved verbatim. An explicit battery clear in the
 *     flat scalars clears the primary entry's battery (no resurrection).
 *  3. Envelope keeps the stored schemaVersion (never downgraded) and the
 *     stored defaultsAppliedBySubSystem when the payload lacks it.
 *
 * Pure — never mutates its inputs.
 */
export function renormalizeStaleConfigWrite(
  incoming: LegacyScalarConfig & Record<string, unknown>,
  opts: RenormalizeStaleWriteOpts,
): RenormalizeStaleWriteResult {
  const stored = (opts.storedConfig ?? {}) as LegacyScalarConfig & Record<string, unknown>;
  const storedMap = normalizeSubSystemMap(stored.subSystems);
  const storedVersion = typeof stored.schemaVersion === 'number' ? stored.schemaVersion : 0;
  const nowIso = (opts.now ?? (() => new Date().toISOString()))();

  const stampKeys = Array.from(new Set((opts.panelStampKeys ?? []).filter(isSubSystemKey)));
  const soleStampKey: SubSystemKey | null = stampKeys.length === 1 ? stampKeys[0] : null;

  // Stored tag lookups by id — restore, don't guess.
  const storedInvTag = new Map<string, SubSystemKey>();
  const storedStrTag = new Map<string, SubSystemKey>();
  for (const inv of stored.inverters ?? []) {
    if (inv?.id && isSubSystemKey(inv.subSystemKey)) storedInvTag.set(inv.id, inv.subSystemKey);
    for (const s of inv?.strings ?? []) {
      if (s?.id && isSubSystemKey(s.subSystemKey)) storedStrTag.set(s.id, s.subSystemKey);
    }
  }

  const fallbackKey = toSubSystemKey(
    incoming.systemType ?? opts.cadSystemType ?? stored.systemType ?? 'roof',
  );

  let retagged = 0;
  const inverters = Array.isArray(incoming.inverters)
    ? incoming.inverters.map(inv => {
        let key: SubSystemKey | undefined = isSubSystemKey(inv?.subSystemKey) ? inv.subSystemKey : undefined;
        if (!key) {
          key = (inv?.id ? storedInvTag.get(inv.id) : undefined) ?? soleStampKey ?? fallbackKey;
          retagged++;
        }
        const strings = Array.isArray(inv?.strings)
          ? inv.strings.map(s => {
              if (isSubSystemKey(s?.subSystemKey)) return s;
              const sk = (s?.id ? storedStrTag.get(s.id) : undefined) ?? key!;
              return { ...s, subSystemKey: sk };
            })
          : inv?.strings;
        return { ...inv, subSystemKey: key, ...(strings !== undefined ? { strings } : {}) };
      })
    : incoming.inverters;

  // The stale client's flat edits belong to the PRIMARY subsystem — the only
  // view its legacy UI could show (§1.4 primary = stored-map mirror key).
  const primaryKey: SubSystemKey = derivePrimaryKey(storedMap) ?? fallbackKey;

  const synth = synthesizeFromLegacyScalars(
    { ...incoming, inverters } as LegacyScalarConfig,
    primaryKey,
    nowIso,
  );
  const mergedPrimary: SubSystemEquipment = {
    ...(storedMap?.[primaryKey] ?? {}),
    ...synth, // synth is compacted — stored fields survive where the flat write carries no data
    key: primaryKey,
    source: 'migration',
    updatedAt: nowIso,
  };
  // Explicit battery clear in the flat scalars must clear the entry too —
  // a stale-preserved battery would otherwise resurrect through the mirror.
  const incomingHasBattery = typeof incoming.batteryId === 'string' && incoming.batteryId.length > 0;
  if (!incomingHasBattery && 'batteryId' in incoming) {
    mergedPrimary.batteryId = null;
    delete mergedPrimary.batteryCount;
    delete mergedPrimary.batteryKwhPerUnit;
  }

  const subSystems: SubSystemEquipmentMap = { ...(storedMap ?? {}), [primaryKey]: mergedPrimary };
  const preservedKeys = (Object.keys(storedMap ?? {}) as SubSystemKey[]).filter(k => k !== primaryKey);

  const config: Record<string, unknown> = {
    ...incoming,
    ...(inverters !== undefined ? { inverters } : {}),
    subSystems,
    schemaVersion: Math.max(2, storedVersion),
  };
  if (config.defaultsAppliedBySubSystem === undefined && stored.defaultsAppliedBySubSystem !== undefined) {
    config.defaultsAppliedBySubSystem = stored.defaultsAppliedBySubSystem;
  }

  return { config, retaggedInverters: retagged, preservedKeys, primaryKey };
}

// ─── save-config v2 envelope finalization ────────────────────────────────────

export interface FinalizeConfigResult {
  config: Record<string, unknown>;
  /** true when finalization produced a NEW object (mirror rewrite / version stamp). */
  changed: boolean;
  i5: MirrorAssertionResult | null;
}

/**
 * Final single-writer pass before an engineering_config persists:
 *  • no map → returned UNCHANGED by reference (legacy writes stay
 *    byte-identical — Wave-0 golden bar);
 *  • map present → envelope carries schemaVersion >= 2 (a client that writes
 *    the map is v2-aware even if it forgot the stamp);
 *  • map with >1 entries → flat scalars REWRITTEN from derivePrimaryMirror
 *    (§1.4 single-writer; single-entry maps mirror identically to today);
 *  • I-5 assertion always runs when a map exists; strict drift is repaired
 *    from the map (never persisted) at any entry count.
 */
export function finalizeConfigEnvelope(config: Record<string, unknown>): FinalizeConfigResult {
  const map = normalizeSubSystemMap(config.subSystems);
  if (!map) return { config, changed: false, i5: null };

  const entryCount = (Object.keys(map) as SubSystemKey[]).length;
  const mirror = derivePrimaryMirror(map)!;

  const i5 = assertMirrorInvariant(
    {
      // ProjectConfig's flat surface: mountingId + batteryId (panel lives
      // per-string, inverter/topology per-inverter — null = unrepresentable).
      mountingId: config.mountingId as string | undefined,
      batteryId: config.batteryId as string | undefined,
    },
    map,
    'engineering_config',
  );

  const out: Record<string, unknown> = { ...config };
  let changed = false;

  const version = typeof config.schemaVersion === 'number' ? config.schemaVersion : 0;
  if (version < 2) {
    out.schemaVersion = 2;
    changed = true;
  }

  // §1.4: derived flat scalars — full rewrite only at N>1; targeted repair of
  // strictly-drifted fields at any N (I-5: never persist drift). The battery
  // trio travels together (batteryCount/batteryKwh repair with batteryId).
  const derived = deriveConfigScalarsFromMirror(mirror);
  const applyKeys = entryCount > 1
    ? Object.keys(derived)
    : Object.keys(derived).filter(k => {
        const tupleField: keyof CanonicalIdTuple =
          (k === 'batteryCount' || k === 'batteryKwh') ? 'batteryId' : (k as keyof CanonicalIdTuple);
        return i5.driftFields.includes(tupleField);
      });
  for (const k of applyKeys) {
    if (out[k] !== derived[k]) {
      out[k] = derived[k];
      changed = true;
    }
  }

  return { config: changed ? out : config, changed, i5 };
}
