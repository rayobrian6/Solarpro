// ═══════════════════════════════════════════════════════════════
// Per-subsystem equipment contract — Wave 1 of
// docs/ARCHITECTURE-per-subsystem-equipment.md (FROZEN CONTRACT v1.0).
//
// This module is the SHARED, dependency-free home of:
//   • SubSystemKey            (§1.1 vocabulary — canonical declaration)
//   • SubSystemEquipment      (§1.2 — one shape, reused at every layer)
//   • ensureSubSystemShape()  (§1.5 — the ONE idempotent legacy-collapse rule)
//   • synthesizeFromLegacyScalars() + toSubSystemKey() helpers
//
// It is importable by BOTH client (engineering page, lib/system) and server
// (permit routes, lib/db) code — it has zero imports, so it can never drag
// permit/CAD machinery into a client bundle. lib/permit/utils/subSystems.ts
// re-exports these types so permit-side consumers keep one import path.
//
// Wave 1 scope note: NOTHING here is wired into page.tsx hydration or the
// storage layer yet (Wave 1b owns schemaVersion 2 / deep-merge upsert /
// mirror derivation; Wave 3 wires hydration). This file is pure contract.
// ═══════════════════════════════════════════════════════════════

/** §1.1 — canonical subsystem partition key. */
export type SubSystemKey = 'roof' | 'ground' | 'fence';

export const SUB_SYSTEM_KEYS = ['roof', 'ground', 'fence'] as const;

export function isSubSystemKey(v: unknown): v is SubSystemKey {
  return v === 'roof' || v === 'ground' || v === 'fence';
}

/**
 * Normalize ANY systemType spelling (engineering 'roof'|'ground'|'fence',
 * canonical 'ground_mount'|'solar_fence', CAD variants) to a SubSystemKey.
 * Mirrors classifyPanel() in lib/permit/utils/subSystems.ts — roof is the
 * end-to-end default placement type.
 */
export function toSubSystemKey(systemType: unknown): SubSystemKey {
  const st = String(systemType ?? '').toLowerCase();
  if (st === 'fence' || st === 'solar_fence') return 'fence';
  if (st === 'ground' || st === 'ground_mount') return 'ground';
  return 'roof';
}

/**
 * §1.2 — the per-subsystem equipment record (one shape, reused at every
 * layer). ALL equipment fields optional: a fence drawn in CAD before
 * equipment is picked is representable (no placeholder-id contamination).
 *
 * NOTE `batteryKwhPerUnit` — renamed, per-unit ONLY. This structurally kills
 * the battery-reverts ratchet; never add a `batteryKwh` (total) field here.
 */
export interface SubSystemEquipment {
  key: SubSystemKey;
  panelId?: string;
  /** Ecosystem root; topology implied via equipment-db registry. */
  inverterId?: string;
  topology?: 'string' | 'micro' | 'optimizer';
  /** 'enphase' | 'ecoflow' | 'solis' | 'apsystems' | ... */
  ecosystemBrand?: string;
  optimizerId?: string;
  /** IronRidge roof / SolFence fence / ground racking. */
  mountingId?: string;
  batteryId?: string | null;
  batteryCount?: number;
  /** RENAMED, per-unit ONLY — structurally kills the battery-reverts ratchet. */
  batteryKwhPerUnit?: number;
  /** Per-sub integrated BOS brains (extends project.bosDeviceIds precedent). */
  bosDeviceIds?: string[];
  /** Roof only. */
  roofType?: string;
  /** Ground/fence only. */
  trenchRunLengthFt?: number;
  env?: {
    /** 30 roof / 0 ground+fence. */
    rooftopTempAdderC: number;
    conduitType?: string;
    wireLengthFt?: number;
  };
  /** DERIVED: key==='roof' && !inverter.rsdIntegrated (NEC 690.12 scopes to buildings). */
  rsdRequired?: boolean;
  source: 'design' | 'engineering' | 'defaults' | 'migration';
  /** ISO — Frankenstein interleaves become diagnosable, not forensic. */
  updatedAt: string;
}

/** ProjectConfig.subSystems / selected_equipment.subSystems map shape. */
export type SubSystemEquipmentMap = Partial<Record<SubSystemKey, SubSystemEquipment>>;

// ─── Legacy-collapse helper (§1.5) ───────────────────────────────────────────

/**
 * The minimal legacy-scalar surface ensureSubSystemShape reads. Structural —
 * the engineering ProjectConfig (both copies) satisfies it, and so does any
 * loosely-typed DB payload.
 */
export interface LegacyScalarConfig {
  systemType?: string;
  subSystems?: SubSystemEquipmentMap | null;
  inverters?: Array<{
    id?: string;
    subSystemKey?: SubSystemKey;
    inverterId?: string;
    type?: string;
    optimizerPeripheralId?: string;
    strings?: Array<{
      id?: string;
      label?: string;
      panelCount?: number;
      subSystemKey?: SubSystemKey;
      panelId?: string;
    }>;
  }>;
  mountingId?: string;
  batteryId?: string;
  batteryCount?: number;
  /** Legacy PER-UNIT battery capacity (page.tsx multiplies by batteryCount for totals). */
  batteryKwh?: number;
  roofType?: string;
  trenchRunLengthFt?: number;
  conduitType?: string;
  wireLength?: number;
  selectedBrand?: string;
}

export interface EnsureSubSystemShapeOpts {
  /** CAD-side systemType fallback (contract: config.systemType ?? cad.systemType ?? 'roof'). */
  cadSystemType?: string | null;
  /** Injectable clock for deterministic tests. Defaults to new Date().toISOString(). */
  now?: () => string;
}

/** Drop undefined-valued keys so synthesized records serialize minimally + stably. */
function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function mapLegacyTopology(invType: unknown): SubSystemEquipment['topology'] {
  if (invType === 'micro') return 'micro';
  if (invType === 'optimizer') return 'optimizer';
  if (typeof invType === 'string' && invType.length > 0) return 'string'; // string | hybrid | ecoflow
  return undefined;
}

/**
 * §1.5 — synthesize one SubSystemEquipment entry from a config's legacy flat
 * scalars. Used when a stored config has no `subSystems` map yet.
 *
 * `source: 'migration'` — the entry was inferred from a pre-contract shape.
 */
export function synthesizeFromLegacyScalars(
  config: LegacyScalarConfig,
  key: SubSystemKey,
  nowIso?: string,
): SubSystemEquipment {
  const inv0 = Array.isArray(config.inverters) ? config.inverters[0] : undefined;
  const firstStringPanelId = inv0?.strings?.find(s => typeof s?.panelId === 'string' && s.panelId)?.panelId;
  const hasBattery = typeof config.batteryId === 'string' && config.batteryId.length > 0;

  return compact<SubSystemEquipment>({
    key,
    panelId: firstStringPanelId || undefined,
    inverterId: inv0?.inverterId || undefined,
    topology: mapLegacyTopology(inv0?.type),
    ecosystemBrand: config.selectedBrand || undefined,
    optimizerId: inv0?.optimizerPeripheralId || undefined,
    mountingId: config.mountingId || undefined,
    batteryId: hasBattery ? config.batteryId : undefined,
    batteryCount: hasBattery && typeof config.batteryCount === 'number' && config.batteryCount > 0
      ? config.batteryCount
      : undefined,
    // Legacy config.batteryKwh is ALREADY per-unit (page.tsx multiplies by
    // batteryCount to display totals) — carry it over 1:1, never divide.
    batteryKwhPerUnit: hasBattery && typeof config.batteryKwh === 'number' && config.batteryKwh > 0
      ? config.batteryKwh
      : undefined,
    roofType: key === 'roof' ? (config.roofType || undefined) : undefined,
    trenchRunLengthFt: key !== 'roof' && typeof config.trenchRunLengthFt === 'number'
      ? config.trenchRunLengthFt
      : undefined,
    env: {
      rooftopTempAdderC: key === 'roof' ? 30 : 0,
      ...(config.conduitType ? { conduitType: config.conduitType } : {}),
      ...(typeof config.wireLength === 'number' ? { wireLengthFt: config.wireLength } : {}),
    },
    source: 'migration',
    updatedAt: nowIso ?? new Date().toISOString(),
  });
}

/**
 * §1.5 — THE one idempotent legacy-collapse rule, applied at every hydration
 * boundary (Wave 3 wires the call sites; Wave 1 only ships + tests it):
 *
 *   effectiveSubSystems = stored.subSystems
 *     ?? { [config.systemType ?? cad.systemType ?? 'roof']: synthesizeFromLegacyScalars(config) }
 *
 * Also re-stamps derived tag caches: untagged inverters inherit the config's
 * systemType key (NEVER a bare 'roof' default — a saved fence-only project
 * default-tagged roof would flip its structural/BOM/RSD authority), and
 * untagged strings inherit their parent inverter's key.
 *
 * Guarantees:
 *  • PURE + in-memory — never mutates its input; the DB row is untouched
 *    until the user saves.
 *  • IDEMPOTENT — ensureSubSystemShape(ensureSubSystemShape(x)) deep-equals
 *    ensureSubSystemShape(x) (given a stable `now`; the synthesized
 *    updatedAt is only minted on the first pass because the second pass
 *    takes the map-passthrough branch).
 *  • SERIALIZATION SUPERSET — output JSON contains every input key/value
 *    unchanged; only additive fields appear. Every legacy reader sees
 *    identical values.
 *
 * An EMPTY `subSystems: {}` is treated as absent (a degenerate write must
 * not erase the project's one subsystem).
 */
export function ensureSubSystemShape<T extends LegacyScalarConfig>(
  config: T,
  opts: EnsureSubSystemShapeOpts = {},
): T & { subSystems: SubSystemEquipmentMap } {
  const stored = config.subSystems;
  const hasMap = !!stored && Object.keys(stored).length > 0;

  // The inherited tag for untagged inverters — config.systemType first,
  // CAD systemType second, 'roof' only as the documented final fallback.
  const inheritedKey = toSubSystemKey(
    config.systemType ?? opts.cadSystemType ?? 'roof',
  );

  const subSystems: SubSystemEquipmentMap = hasMap
    ? stored as SubSystemEquipmentMap
    : { [inheritedKey]: synthesizeFromLegacyScalars(config, inheritedKey, opts.now?.()) };

  // Re-stamp derived tag caches (§1.1: tags are cache, re-stampable at every
  // hydration). Only fills MISSING tags — existing tags are never overwritten
  // here (stamp-vs-tag disagreement resolution belongs to partitionSubSystems
  // + Wave 3 gates, not this helper).
  const inverters = Array.isArray(config.inverters)
    ? config.inverters.map(inv => {
        const invKey = isSubSystemKey(inv?.subSystemKey) ? inv.subSystemKey : inheritedKey;
        const strings = Array.isArray(inv?.strings)
          ? inv.strings.map(s =>
              isSubSystemKey(s?.subSystemKey) ? s : { ...s, subSystemKey: invKey })
          : inv?.strings;
        return { ...inv, subSystemKey: invKey, ...(strings !== undefined ? { strings } : {}) };
      })
    : config.inverters;

  return {
    ...config,
    ...(inverters !== undefined ? { inverters } : {}),
    subSystems,
  } as T & { subSystems: SubSystemEquipmentMap };
}
