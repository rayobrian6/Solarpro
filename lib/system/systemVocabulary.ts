// ═══════════════════════════════════════════════════════════════════
// System Vocabulary — Canonical Internal Language
//
// ONE SOURCE OF TRUTH for all system classification terms.
// All subsystems import from here instead of defining their own.
//
// CANONICAL INTERNAL:
//   SystemType:       'roof' | 'ground' | 'fence'
//   InverterTopology: 'micro' | 'string' | 'optimizer'
//   MountType:        'fixed_tilt' | 'pole_mount' | 'tracker'
//
// LEGACY ADAPTERS:
//   Verbose system types ('ground_mount', 'solar_fence') accepted
//   by all normalizers and predicates — never rejected, always mapped.
//
// DISPLAY LABELS:
//   displaySystemType(), displayTopology() for UI/PDF rendering.
// ═══════════════════════════════════════════════════════════════════

// ── Canonical Internal Types ─────────────────────────────────────

/** Canonical system type — short form, used internally */
export type CanonicalSystemType = 'roof' | 'ground' | 'fence';

/** Canonical inverter topology — lowercase, used internally */
export type InverterTopology = 'micro' | 'string' | 'optimizer' | 'ecoflow';

/** Canonical mount type — ground sub-classification */
export type MountType = 'fixed_tilt' | 'pole_mount' | 'tracker';

// ── Legacy / Verbose System Type (from CAD engine, helpers.ts) ───

/** Verbose system type — used by CADSystemType and helpers.ts SysType */
export type VerboseSystemType = 'roof' | 'ground_mount' | 'solar_fence';

// ── System Type Normalization ────────────────────────────────────

const SYSTEM_TYPE_MAP: Record<string, CanonicalSystemType> = {
  // Canonical (already correct)
  'roof':         'roof',
  'ground':       'ground',
  'fence':        'fence',
  // Verbose (from CAD engine / helpers.ts)
  'ground_mount': 'ground',
  'solar_fence':  'fence',
  // DB / frontend variants
  'ground mount': 'ground',
  'solar fence':  'fence',
  'groundmount':  'ground',
  'solarfence':   'fence',
};

/**
 * Normalize any system type string to canonical short form.
 * Accepts both 'ground_mount' and 'ground', 'solar_fence' and 'fence'.
 * Returns 'roof' as safe default for unrecognized values.
 */
export function normalizeSystemType(raw: string | undefined | null): CanonicalSystemType {
  if (!raw) return 'roof';
  const key = raw.toLowerCase().trim();
  return SYSTEM_TYPE_MAP[key] ?? 'roof';
}

/**
 * Convert canonical short form to verbose format (for CAD engine / legacy code).
 * 'ground' → 'ground_mount', 'fence' → 'solar_fence', 'roof' → 'roof'
 */
export function toVerboseSystemType(canonical: CanonicalSystemType | VerboseSystemType): VerboseSystemType {
  if (canonical === 'ground') return 'ground_mount';
  if (canonical === 'fence') return 'solar_fence';
  // Already verbose or 'roof'
  if (canonical === 'ground_mount') return 'ground_mount';
  if (canonical === 'solar_fence') return 'solar_fence';
  return 'roof';
}

/**
 * Convert verbose format to canonical short form.
 * 'ground_mount' → 'ground', 'solar_fence' → 'fence', 'roof' → 'roof'
 */
export function toCanonicalSystemType(verbose: VerboseSystemType | CanonicalSystemType): CanonicalSystemType {
  if (verbose === 'ground_mount') return 'ground';
  if (verbose === 'solar_fence') return 'fence';
  if (verbose === 'ground') return 'ground';
  if (verbose === 'fence') return 'fence';
  return 'roof';
}

// ── System Type Predicates ───────────────────────────────────────
// Accept BOTH canonical and verbose formats for zero-friction migration.

/** Is this a roof system? Accepts 'roof' */
export function isRoof(type: string | undefined | null): boolean {
  return normalizeSystemType(type) === 'roof';
}

/** Is this a ground mount system? Accepts 'ground', 'ground_mount' */
export function isGround(type: string | undefined | null): boolean {
  return normalizeSystemType(type) === 'ground';
}

/** Is this a fence system? Accepts 'fence', 'solar_fence' */
export function isFence(type: string | undefined | null): boolean {
  return normalizeSystemType(type) === 'fence';
}

// ── Topology Normalization ───────────────────────────────────────

const TOPOLOGY_MAP: Record<string, InverterTopology> = {
  // Canonical (already correct)
  'micro':            'micro',
  'string':           'string',
  'optimizer':        'optimizer',
  'ecoflow':          'ecoflow',
  // Uppercase (from helpers.ts resolveTopology)
  'MICRO':            'micro',
  'STRING':           'string',
  'OPTIMIZER':        'optimizer',
  'ECOFLOW':          'ecoflow',
  // DB / frontend variants
  'microinverter':    'micro',
  'Microinverter':    'micro',
  'MICROINVERTER':    'micro',
  'power_optimizer':  'optimizer',
  'POWER_OPTIMIZER':  'optimizer',
  'string_inverter':  'string',
  'STRING_INVERTER':  'string',
  'hybrid':           'ecoflow',
  'HYBRID':           'ecoflow',
  'hybrid_inverter':  'ecoflow',
  'HYBRID_INVERTER':  'ecoflow',
  'EcoFlow':          'ecoflow',
};

/**
 * Normalize any topology string to canonical InverterTopology.
 * Returns 'micro' as safe default for unrecognized values.
 */
export function normalizeTopology(raw: string | undefined | null): InverterTopology {
  if (!raw) return 'micro';
  const mapped = TOPOLOGY_MAP[raw] ?? TOPOLOGY_MAP[raw.trim()];
  if (mapped) return mapped;
  // Last-resort pattern matching
  const lower = raw.toLowerCase().trim();
  if (lower.includes('micro')) return 'micro';
  if (lower.includes('optim')) return 'optimizer';
  if (lower === 'string') return 'string';
  return 'micro';
}

/**
 * Convert canonical topology to legacy uppercase format.
 * 'micro' → 'MICRO', 'optimizer' → 'OPTIMIZER', 'string' → 'STRING'
 */
export function toUpperTopology(topo: InverterTopology): 'MICRO' | 'OPTIMIZER' | 'STRING' {
  if (topo === 'micro') return 'MICRO';
  if (topo === 'optimizer') return 'OPTIMIZER';
  return 'STRING';
}

// ── Topology Predicates ──────────────────────────────────────────

/** Is this a microinverter system? Accepts any variant. */
export function isMicro(topo: string | undefined | null): boolean {
  return normalizeTopology(topo) === 'micro';
}

/** Is this a string inverter system? Accepts any variant. */
export function isString(topo: string | undefined | null): boolean {
  return normalizeTopology(topo) === 'string';
}

/** Is this an optimizer system? Accepts any variant. */
export function isOptimizer(topo: string | undefined | null): boolean {
  return normalizeTopology(topo) === 'optimizer';
}

// ── Display Labels ───────────────────────────────────────────────
// For UI rendering / PDF output. NOT for internal comparisons.

const SYSTEM_DISPLAY_MAP: Record<CanonicalSystemType, string> = {
  'roof':   'ROOF-MOUNTED',
  'ground': 'GROUND-MOUNTED',
  'fence':  'SOLAR FENCE',
};

const SYSTEM_SHORT_DISPLAY_MAP: Record<CanonicalSystemType, string> = {
  'roof':   'ROOF MOUNT',
  'ground': 'GROUND MOUNT',
  'fence':  'SOLAR FENCE',
};

const TOPOLOGY_DISPLAY_MAP: Record<InverterTopology, string> = {
  'micro':     'MICROINVERTER',
  'string':    'STRING INVERTER',
  'optimizer': 'POWER OPTIMIZER + INVERTER',
  'ecoflow':   'ECOFLOW POWEROCEAN HYBRID',
};

/**
 * Display label for system type — e.g., 'ROOF-MOUNTED', 'GROUND-MOUNTED', 'SOLAR FENCE'
 * Accepts any system type variant (canonical or verbose).
 */
export function displaySystemType(type: string | undefined | null): string {
  return SYSTEM_DISPLAY_MAP[normalizeSystemType(type)] ?? 'ROOF-MOUNTED';
}

/**
 * Short display label — e.g., 'ROOF MOUNT', 'GROUND MOUNT', 'SOLAR FENCE'
 * Accepts any system type variant.
 */
export function displaySystemTypeShort(type: string | undefined | null): string {
  return SYSTEM_SHORT_DISPLAY_MAP[normalizeSystemType(type)] ?? 'ROOF MOUNT';
}

/**
 * Display label for topology — e.g., 'MICROINVERTER', 'STRING INVERTER'
 * Accepts any topology variant.
 */
export function displayTopology(topo: string | undefined | null): string {
  return TOPOLOGY_DISPLAY_MAP[normalizeTopology(topo)] ?? 'INVERTER';
}

/**
 * Sheet title for PV-2 page based on system type.
 */
export function pv2SheetTitle(type: string | undefined | null): string {
  const t = normalizeSystemType(type);
  if (t === 'fence') return 'SOLAR FENCE ELEVATION & PLAN';
  if (t === 'ground') return 'GROUND ARRAY PLAN';
  return 'ROOF PLAN — MODULE LAYOUT & FIRE SETBACKS';
}

/**
 * Sheet title for PV-3 page based on system type.
 */
export function pv3SheetTitle(type: string | undefined | null): string {
  const t = normalizeSystemType(type);
  if (t === 'fence') return 'FENCE STRUCTURAL DETAILS';
  if (t === 'ground') return 'GROUND MOUNT STRUCTURAL DETAILS';
  return 'ATTACHMENT DETAIL — MOUNTING & BILL OF MATERIALS';
}