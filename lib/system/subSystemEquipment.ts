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
 * Wave 6.1 (punch item 1a) — the canonical SolFence mounting id.
 *
 * Fence sub-systems mount on SolFence vertical sections, ALWAYS (Ray's real
 * distributor data; the Wave-4B System Config UI offers only fence-typed
 * racking for fence subs; bom-system-profiles hardcodes rackingBrand
 * 'SolFence' for fence BOMs). The legacy flat `config.mountingId` is the
 * PROJECT-WIDE (roof) racking — cloning it into a fence entry produced the
 * Stowell "FENCE SYSTEM: ROOF TECH RT-MINI" planset lie.
 *
 * Cross-ref: lib/equipment-db.ts MOUNTING_SYSTEMS entry { id: 'solfence-8ft',
 * manufacturer: 'SolFence', systemType: 'fence' }. This module is
 * dependency-free by contract, so the id is mirrored here as a constant;
 * the Wave-6 golden test pins the equipment-db entry against it.
 */
export const SOLFENCE_MOUNTING_ID = 'solfence-8ft';

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
  /**
   * Wave 4B.A — layout-stamp partition (§1.1 membership authority): the sub
   * keys with ≥1 stamped panel, in roof > ground > fence order. When >1 key
   * is present:
   *   • an ABSENT map is synthesized with ONE entry PER present key (never
   *     the old winner-vote single bucket — the Ray/Stowell hybrid collapse);
   *   • a stored SINGLE-entry map whose only entry is 'migration'-sourced is
   *     treated as a degenerate collapse and re-synthesized per present key
   *     (logged loudly; entries with source !== 'migration' are NEVER
   *     discarded; an existing migration entry whose §1.6 id-tuple matches
   *     the fresh synthesis is kept by reference for idempotence);
   *   • present keys missing from a healthy map are additively filled with
   *     synthesized 'migration' entries.
   * Omitted / ≤1 key ⇒ byte-identical legacy behavior.
   */
  presentKeys?: SubSystemKey[];
}

/** §1.6 canonical id-tuple equality (panelId, inverterId, topology, mountingId, batteryId). */
function sameIdTuple(a: SubSystemEquipment, b: SubSystemEquipment): boolean {
  return (a.panelId ?? null) === (b.panelId ?? null)
    && (a.inverterId ?? null) === (b.inverterId ?? null)
    && (a.topology ?? null) === (b.topology ?? null)
    && (a.mountingId ?? null) === (b.mountingId ?? null)
    && (a.batteryId ?? null) === (b.batteryId ?? null);
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
    // Wave 6.1 (punch 1a): fence subs FORCE the SolFence system id — the flat
    // legacy mountingId is the project-wide (roof) racking and must never be
    // cloned into a fence entry (Stowell "FENCE SYSTEM: ROOF TECH RT-MINI").
    mountingId: key === 'fence' ? SOLFENCE_MOUNTING_ID : (config.mountingId || undefined),
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

  // Wave 4B.A — hybrid partition from panel stamps (§1.1). Only >1 valid key
  // changes anything; the legacy single-key path below is untouched.
  const presentKeys = (opts.presentKeys ?? []).filter(isSubSystemKey);
  const multiPresent = presentKeys.length > 1;

  let subSystems: SubSystemEquipmentMap;
  if (!hasMap) {
    subSystems = multiPresent
      ? Object.fromEntries(
          presentKeys.map(k => [k, synthesizeFromLegacyScalars(config, k, opts.now?.())]),
        ) as SubSystemEquipmentMap
      : { [inheritedKey]: synthesizeFromLegacyScalars(config, inheritedKey, opts.now?.()) };
  } else if (multiPresent) {
    const storedMap = stored as SubSystemEquipmentMap;
    const storedEntries = Object.entries(storedMap)
      .filter(([k, v]) => isSubSystemKey(k) && !!v) as Array<[SubSystemKey, SubSystemEquipment]>;
    const degenerateSingle =
      storedEntries.length === 1 && storedEntries[0][1]?.source === 'migration';
    const missingPresent = presentKeys.filter(k => !storedMap[k]);

    if (degenerateSingle || missingPresent.length > 0) {
      const next: SubSystemEquipmentMap = {};
      // source !== 'migration' entries are NEVER discarded — user/design/defaults
      // provenance always survives, even for keys outside the current partition.
      for (const [k, v] of storedEntries) {
        if (v.source !== 'migration') next[k] = v;
      }
      // Non-degenerate healthy migration entries for present keys also survive
      // as-is; the degenerate single entry is re-synthesized per key below
      // (kept by reference only when its id-tuple matches fresh synthesis).
      if (!degenerateSingle) {
        for (const [k, v] of storedEntries) {
          if (v.source === 'migration' && presentKeys.includes(k) && !next[k]) next[k] = v;
        }
      }
      for (const k of presentKeys) {
        if (next[k]) continue;
        const fresh = synthesizeFromLegacyScalars(config, k, opts.now?.());
        const existing = storedMap[k];
        next[k] = existing && existing.source === 'migration' && sameIdTuple(existing, fresh)
          ? existing // idempotence: same id-tuple ⇒ keep the stored entry (stable updatedAt)
          : fresh;
      }
      const droppedKeys = storedEntries
        .filter(([k]) => !next[k])
        .map(([k]) => k);
      if (degenerateSingle) {
        // Loud by contract: this is the Ray/Stowell wrong-collapse being healed.
        console.warn(
          '[ensureSubSystemShape] DEGENERATE single-entry migration map re-synthesized per layout partition',
          '\n  stored key:', storedEntries[0][0],
          '\n  layout present keys:', presentKeys.join(', '),
          '\n  dropped migration entries:', droppedKeys.length > 0 ? droppedKeys.join(', ') : '(none)',
          '\n  non-migration entries preserved:', storedEntries.filter(([, v]) => v.source !== 'migration').map(([k]) => k).join(', ') || '(none)',
        );
      }
      subSystems = next;
    } else {
      subSystems = storedMap;
    }
  } else {
    subSystems = stored as SubSystemEquipmentMap;
  }

  // Wave 6.1 (punch 1a) — heal MIGRATION-sourced fence entries that still
  // carry a cloned roof/ground mountingId (pre-Wave-6 synthesis wrote the
  // flat legacy scalar into every key). Only 'migration' provenance is
  // touched — user/design/defaults-authored entries are never rewritten.
  // Idempotent: a healed entry re-enters this branch as a no-op.
  const _fence = subSystems.fence;
  if (_fence && _fence.source === 'migration' && _fence.mountingId !== SOLFENCE_MOUNTING_ID) {
    subSystems = { ...subSystems, fence: { ..._fence, mountingId: SOLFENCE_MOUNTING_ID } };
  }

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

// ─── Degenerate single-fleet detector (Wave 4B items B/D) ────────────────────

/** Minimal structural inverter shape the detector reads (page InverterConfig satisfies it). */
export interface DegenerateFleetInverterLike {
  subSystemKey?: SubSystemKey;
  strings?: Array<{ panelCount?: number }>;
}

export interface DegenerateSingleFleetResult {
  degenerate: boolean;
  /** The one key the whole fleet lives under (null when not degenerate). */
  key: SubSystemKey | null;
  /** Σ panelCount across the fleet's strings. */
  fleetPanelTotal: number;
  /** Σ of the layout-stamp partition counts (the authoritative project total). */
  projectPanelTotal: number;
}

/**
 * TRUE when a HYBRID layout (≥2 stamped sub keys) is paired with a fleet
 * that (a) all lives under ONE sub key (tags or the §1.5 fallback), and
 * (b) whose panel total covers ≈ the WHOLE project rather than that key's
 * own stamp count — i.e. the pre-contract single-system fleet that was
 * never split per sub (Ray's live 85-panel string tagged 'fence' on a
 * 48/20/17 roof/ground/fence layout).
 *
 * Such a fleet must NOT be partitioned into per-sub engine inputs: the one
 * sub would compute the whole fleet at a fraction of its panels while the
 * other subs compute over phantom empty fleets (the 17-device / 2-branch /
 * AC-kW-drift bug class). Callers either fall back to a single whole-fleet
 * engine pass (honest interim view) or split the fleet per sub.
 *
 * Tolerance: |fleetTotal − projectTotal| ≤ max(1, 2% of project total).
 */
export function detectDegenerateSingleFleet(
  inverters: readonly DegenerateFleetInverterLike[] | null | undefined,
  fallbackKey: SubSystemKey,
  expectedBySub: Partial<Record<SubSystemKey, number>>,
): DegenerateSingleFleetResult {
  const present = SUB_SYSTEM_KEYS.filter(k => (expectedBySub[k] ?? 0) > 0);
  const projectPanelTotal = present.reduce((s, k) => s + (expectedBySub[k] ?? 0), 0);
  const list = inverters ?? [];

  let fleetTotal = 0;
  const keys = new Set<SubSystemKey>();
  for (const inv of list) {
    keys.add(isSubSystemKey(inv?.subSystemKey) ? inv.subSystemKey! : fallbackKey);
    for (const s of inv?.strings ?? []) fleetTotal += s?.panelCount ?? 0;
  }

  const notDegenerate: DegenerateSingleFleetResult = {
    degenerate: false, key: null, fleetPanelTotal: fleetTotal, projectPanelTotal,
  };
  if (present.length <= 1 || list.length === 0 || keys.size !== 1 || fleetTotal <= 0) {
    return notDegenerate;
  }
  const only = [...keys][0];
  // A single fleet whose total matches ITS OWN stamp count is a correctly
  // scoped sub fleet (the other subs are merely unseeded) — not degenerate.
  if (fleetTotal === (expectedBySub[only] ?? 0)) return notDegenerate;
  const tolerance = Math.max(1, Math.round(projectPanelTotal * 0.02));
  if (Math.abs(fleetTotal - projectPanelTotal) > tolerance) return notDegenerate;
  return { degenerate: true, key: only, fleetPanelTotal: fleetTotal, projectPanelTotal };
}
