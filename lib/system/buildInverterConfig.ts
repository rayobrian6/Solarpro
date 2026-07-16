// ============================================================
// buildInverterConfig — Single Inverter Config Factory
// ============================================================
//
// This is the ONLY place in the codebase that constructs
// InverterConfig or StringConfig objects.
//
// INVARIANTS enforced by this module (tested in .test.ts):
//   inv.stringsPerInverter === inv.strings.length
//   inv.modulesPerString   === inv.strings[0]?.panelCount ?? 10
//
// Any path that builds InverterConfig outside this module is a
// bug — it will eventually cause the reconciler to trim or pad
// strings silently.
//
// USAGE:
//   import { buildInverterConfig, buildStringConfig } from '@/lib/system/buildInverterConfig';
// ============================================================

// ── Types (re-exported so callers share exact shapes) ────────

import { isSubSystemKey, type SubSystemKey } from '@/lib/system/subSystemEquipment';

export type InverterType = 'string' | 'micro' | 'optimizer' | 'hybrid' | 'ecoflow';

// RoofType is intentionally a wide string alias so the builder stays
// decoupled from the page-level RoofType union (which varies across versions).
// Callers cast their local RoofType to this without loss.
export type RoofType = string;

export interface StringConfig {
  id: string;
  label: string;
  panelCount: number;
  panelId: string;
  tilt: number;
  azimuth: number;
  roofType: RoofType;
  mountingSystem: string;
  wireGauge: string;
  wireLength: number;
  ocpdOverride?: number;
  ocpdOverrideAcknowledged?: boolean;
  /** Per-subsystem tag (derived cache — contract §1.1). Inherits the parent
   *  inverter's key when untagged; survives both normalizer whitelists (I-2). */
  subSystemKey?: SubSystemKey;
}

export interface InverterConfig {
  id: string;
  inverterId: string;
  type: InverterType;
  strings: StringConfig[];
  /** Informational — must equal strings.length at all times */
  stringsPerInverter: number;
  /** Informational — must equal strings[0].panelCount at all times */
  modulesPerString: number;
  /** Micro/optimizer ratio override */
  deviceRatioOverride?: number;
  /** For optimizer topology: peripheral optimizer equipment ID */
  optimizerPeripheralId?: string;
  /** Per-subsystem tag (derived cache — contract §1.1, re-stamped from panel
   *  stamps at hydration). MUST survive normalizeRawInverter (I-2). */
  subSystemKey?: SubSystemKey;
}

// ── StringConfig defaults ────────────────────────────────────

export interface BuildStringOptions {
  /** Index within the inverter (0-based) — used for label + unique ID */
  index: number;
  /** System type — drives default panelId */
  systemType?: string;
  /** Panel count for this string */
  panelCount?: number;
  /** Panel equipment ID */
  panelId?: string;
  /** String label override */
  label?: string;
  /** Tilt in degrees */
  tilt?: number;
  /** Azimuth in degrees */
  azimuth?: number;
  roofType?: RoofType;
  mountingSystem?: string;
  wireGauge?: string;
  wireLength?: number;
  /** Existing string ID to preserve (for in-place updates) */
  existingId?: string;
  ocpdOverride?: number;
  ocpdOverrideAcknowledged?: boolean;
  /** Per-subsystem tag to carry through (contract §1.1). */
  subSystemKey?: SubSystemKey;
}

const DEFAULT_PANEL_ID_ROOF    = 'rec-alpha-400w';
const DEFAULT_PANEL_ID_GROUND  = 'rec-alpha-400w';
const DEFAULT_PANEL_ID_FENCE   = 'nexus-ps-mnb108-440w';

function defaultPanelId(systemType?: string): string {
  const t = (systemType ?? 'roof').toLowerCase();
  if (t === 'fence' || t === 'solar_fence') return DEFAULT_PANEL_ID_FENCE;
  if (t === 'ground' || t === 'ground_mount') return DEFAULT_PANEL_ID_GROUND;
  return DEFAULT_PANEL_ID_ROOF;
}

/**
 * Build a single StringConfig with all required defaults filled.
 * Always returns a fully-populated object — no optional fields left
 * undefined unless they are genuinely optional (ocpd overrides).
 */
export function buildStringConfig(opts: BuildStringOptions): StringConfig {
  const idx = opts.index;
  return {
    id:            opts.existingId ?? `str-${Date.now()}-${idx}`,
    label:         opts.label      ?? `String ${idx + 1}`,
    panelCount:    opts.panelCount ?? 10,
    panelId:       opts.panelId    ?? defaultPanelId(opts.systemType),
    tilt:          opts.tilt       ?? 20,
    azimuth:       opts.azimuth    ?? 180,
    roofType:      opts.roofType   ?? 'shingle',
    mountingSystem: opts.mountingSystem ?? 'ironridge-xr100',
    wireGauge:     opts.wireGauge  ?? '#10 AWG',
    wireLength:    opts.wireLength ?? 50,
    ...(opts.ocpdOverride !== undefined ? { ocpdOverride: opts.ocpdOverride } : {}),
    ...(opts.ocpdOverrideAcknowledged !== undefined
      ? { ocpdOverrideAcknowledged: opts.ocpdOverrideAcknowledged }
      : {}),
    ...(opts.subSystemKey !== undefined ? { subSystemKey: opts.subSystemKey } : {}),
  };
}

// ── InverterConfig builder ───────────────────────────────────

export interface BuildInverterOptions {
  /** Inverter equipment DB ID */
  inverterId: string;
  /** Inverter topology type */
  type: InverterType;
  /** Pre-built StringConfig array — caller builds strings via buildStringConfig() */
  strings: StringConfig[];
  /** Existing inverter ID to preserve (for in-place updates) */
  existingId?: string;
  /** Optimizer peripheral equipment ID (SolarEdge optimizer topology) */
  optimizerPeripheralId?: string;
  /** Micro/optimizer device ratio override */
  deviceRatioOverride?: number;
  /** Per-subsystem tag to carry through (contract §1.1). */
  subSystemKey?: SubSystemKey;
}

/**
 * Build a fully-valid InverterConfig.
 *
 * INVARIANT GUARANTEE:
 *   result.stringsPerInverter === result.strings.length
 *   result.modulesPerString   === result.strings[0]?.panelCount ?? 10
 *
 * Throws if strings array is empty (caller must provide at least one string).
 */
export function buildInverterConfig(opts: BuildInverterOptions): InverterConfig {
  if (!opts.strings || opts.strings.length === 0) {
    throw new Error(
      `[buildInverterConfig] strings array must not be empty (inverterId=${opts.inverterId})`
    );
  }

  const strings          = opts.strings;
  const stringsPerInverter = strings.length;
  const modulesPerString   = strings[0].panelCount;

  const inv: InverterConfig = {
    id:               opts.existingId ?? `inv-${Date.now()}`,
    inverterId:       opts.inverterId,
    type:             opts.type,
    strings,
    stringsPerInverter,
    modulesPerString,
  };

  if (opts.optimizerPeripheralId) {
    inv.optimizerPeripheralId = opts.optimizerPeripheralId;
  }
  if (opts.deviceRatioOverride !== undefined) {
    inv.deviceRatioOverride = opts.deviceRatioOverride;
  }
  if (opts.subSystemKey !== undefined) {
    inv.subSystemKey = opts.subSystemKey;
  }

  return inv;
}

// ── Convenience: build a new default inverter ───────────────

export interface NewInverterOptions {
  type: InverterType;
  inverterId: string;
  panelCount?: number;
  panelId?: string;
  systemType?: string;
  stringsCount?: number;
  existingId?: string;
}

/**
 * Build a new InverterConfig with N strings, each carrying the
 * same panelCount. Used for fresh inverter creation.
 */
export function newInverterConfig(opts: NewInverterOptions): InverterConfig {
  const count      = Math.max(1, opts.stringsCount ?? 1);
  const panelCount = opts.panelCount ?? 10;

  const strings = Array.from({ length: count }, (_, i) =>
    buildStringConfig({
      index:      i,
      systemType: opts.systemType,
      panelCount,
      panelId:    opts.panelId,
    })
  );

  return buildInverterConfig({
    inverterId:  opts.inverterId,
    type:        opts.type,
    strings,
    existingId:  opts.existingId,
  });
}

// ── Rebuild an existing InverterConfig with new string count ─

export interface RebuildStringsOptions {
  /** Existing inverter to reuse id/inverterId/type from */
  existing: InverterConfig;
  /** Target string count */
  targetStringCount: number;
  /** Panels per string */
  panelCount: number;
  /** Panel ID override */
  panelId?: string;
  /** System type for defaults */
  systemType?: string;
}

/**
 * Rebuild the strings array of an existing InverterConfig to
 * match a target count, preserving all non-string fields.
 * Always returns a new object (immutable).
 */
export function rebuildInverterStrings(opts: RebuildStringsOptions): InverterConfig {
  const { existing, targetStringCount, panelCount, panelId, systemType } = opts;
  const count = Math.max(1, targetStringCount);

  const strings = Array.from({ length: count }, (_, i) => {
    // Reuse existing string data where possible
    const old = existing.strings[i];
    return buildStringConfig({
      index:         i,
      systemType,
      panelCount,
      panelId:       panelId ?? old?.panelId,
      existingId:    old?.id,
      label:         old?.label,
      tilt:          old?.tilt,
      azimuth:       old?.azimuth,
      roofType:      old?.roofType,
      mountingSystem: old?.mountingSystem,
      wireGauge:     old?.wireGauge,
      wireLength:    old?.wireLength,
      subSystemKey:  old?.subSystemKey ?? existing.subSystemKey,
    });
  });

  return buildInverterConfig({
    inverterId:           existing.inverterId,
    type:                 existing.type,
    strings,
    existingId:           existing.id,
    optimizerPeripheralId: existing.optimizerPeripheralId,
    deviceRatioOverride:  existing.deviceRatioOverride,
    subSystemKey:         existing.subSystemKey,
  });
}

// ── Validate an existing InverterConfig for metadata integrity ──

export interface InverterMetadataViolation {
  field: 'stringsPerInverter' | 'modulesPerString';
  expected: number;
  actual: number | undefined;
}

/**
 * Validate that an InverterConfig's metadata fields are consistent
 * with its strings array. Returns empty array if valid.
 */
export function validateInverterMetadata(inv: InverterConfig): InverterMetadataViolation[] {
  const violations: InverterMetadataViolation[] = [];

  const expectedSPI = inv.strings.length;
  if (inv.stringsPerInverter !== expectedSPI) {
    violations.push({
      field:    'stringsPerInverter',
      expected: expectedSPI,
      actual:   inv.stringsPerInverter,
    });
  }

  const expectedMPS = inv.strings[0]?.panelCount ?? 10;
  if (inv.modulesPerString !== expectedMPS) {
    violations.push({
      field:    'modulesPerString',
      expected: expectedMPS,
      actual:   inv.modulesPerString,
    });
  }

  return violations;
}

/**
 * Assert that an InverterConfig has valid metadata.
 * Throws in development, logs in production.
 */
export function assertInverterMetadata(inv: InverterConfig, context = ''): void {
  const violations = validateInverterMetadata(inv);
  if (violations.length === 0) return;

  const msg = `[buildInverterConfig] Metadata violation${context ? ` (${context})` : ''}:\n` +
    violations.map(v => `  ${v.field}: expected=${v.expected}, actual=${v.actual}`).join('\n');

  if (process.env.NODE_ENV === 'development') {
    throw new Error(msg);
  } else {
    console.error(msg);
  }
}

// ─── Hydration normalizer ────────────────────────────────────────────────────

/**
 * Normalize a single raw inverter object (possibly from DB / localStorage /
 * legacy snapshot) into a fully-validated InverterConfig.
 *
 * Safe to call on already-normalized objects — it is idempotent.
 *
 * Repair strategy:
 *  1. If `strings` is empty / missing, synthesize one string using panelCount
 *     (or modulesPerString or 1 as last resort) so the builder never throws.
 *  2. Pass through buildInverterConfig which enforces all metadata invariants.
 */
export function normalizeRawInverter(raw: Record<string, unknown>): InverterConfig {
  const rawStrings = Array.isArray(raw.strings) ? (raw.strings as Record<string, unknown>[]) : [];

  // Per-subsystem tag survival (contract §1.3 non-negotiable rule, I-2):
  // subSystemKey is whitelisted here; untagged strings inherit the parent
  // inverter's key.
  const invSubSystemKey: SubSystemKey | undefined =
    isSubSystemKey(raw.subSystemKey) ? raw.subSystemKey : undefined;

  // Synthesise a minimal string when none exist
  const strings: BuildStringOptions[] = rawStrings.length > 0
    ? rawStrings.map((s, i) => ({
        index:          i,
        existingId:     typeof s.id === 'string' ? s.id : undefined,
        label:          typeof s.label === 'string' ? s.label : `String ${i + 1}`,
        panelCount:     typeof s.panelCount === 'number' && s.panelCount > 0 ? s.panelCount : 1,
        panelId:        typeof s.panelId === 'string' ? s.panelId : undefined,
        tilt:           typeof s.tilt === 'number' ? s.tilt : undefined,
        azimuth:        typeof s.azimuth === 'number' ? s.azimuth : undefined,
        roofType:       typeof s.roofType === 'string' ? (s.roofType as RoofType) : undefined,
        mountingSystem: typeof s.mountingSystem === 'string' ? s.mountingSystem : undefined,
        wireGauge:      typeof s.wireGauge === 'string' ? s.wireGauge : undefined,
        wireLength:     typeof s.wireLength === 'number' ? s.wireLength : undefined,
        subSystemKey:   isSubSystemKey(s.subSystemKey) ? s.subSystemKey : invSubSystemKey,
      }))
    : [{
        index:      0,
        panelCount: typeof raw.modulesPerString === 'number' && raw.modulesPerString > 0
          ? raw.modulesPerString
          : typeof raw.panelCount === 'number' && raw.panelCount > 0
            ? raw.panelCount
            : 1,
      }];

  const builtStrings = strings.map(s => buildStringConfig(s));

  return buildInverterConfig({
    existingId:            typeof raw.id === 'string' ? raw.id : undefined,
    inverterId:            typeof raw.inverterId === 'string' ? raw.inverterId : 'unknown',
    type:                  typeof raw.type === 'string' ? (raw.type as InverterConfig['type']) : 'string',
    strings:               builtStrings,
    optimizerPeripheralId: typeof raw.optimizerPeripheralId === 'string' ? raw.optimizerPeripheralId : undefined,
    deviceRatioOverride:   typeof raw.deviceRatioOverride === 'number' ? raw.deviceRatioOverride : undefined,
    subSystemKey:          invSubSystemKey,
  });
}

/**
 * Normalize an entire ProjectConfig's inverters array.
 * Pass any loaded config through this before calling setConfig().
 *
 * Idempotent — safe to call on already-normalized configs.
 */
export function normalizeInverterConfig<T extends { inverters?: unknown }>(config: T): T {
  if (!Array.isArray(config.inverters) || config.inverters.length === 0) {
    return config;
  }
  return {
    ...config,
    inverters: (config.inverters as Record<string, unknown>[]).map(normalizeRawInverter),
  };
}

/**
 * Phase 5 hard assertion — alias of assertInverterMetadata.
 * Throws in dev mode, logs in prod. Use in dev-mode useEffect guards.
 */
export function assertValidInverter(inv: InverterConfig, context = ''): void {
  assertInverterMetadata(inv, context);
}