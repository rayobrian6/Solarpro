// ═══════════════════════════════════════════════════════════════
// Text & Label Helpers — resolveSystemType, equipment resolver, etc.
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, ResolvedEquipment } from '../types';
import { SOLAR_PANELS, getInverterById, getMicroinverterById } from '@/lib/equipment-db';


// ═══════════════════════════════════════════════════════════════
// SYSTEM TYPE RESOLVER
// ═══════════════════════════════════════════════════════════════

export type SysType = 'roof' | 'ground_mount' | 'solar_fence';

export function resolveSystemType(input: PermitInput): SysType {
  // Priority 1: layout.type — canonical source of truth (v47.313)
  const layoutType = (input.layout?.type || '').toLowerCase().trim();
  if (layoutType === 'solar_fence' || layoutType === 'fence')  return 'solar_fence';
  if (layoutType === 'ground_mount' || layoutType === 'ground') return 'ground_mount';
  if (layoutType === 'roof')                                     return 'roof';
  // Priority 2: layout geometry inference (fence/ground segments present)
  if ((input.layout?.fenceSegments?.length ?? 0) > 0) return 'solar_fence';
  if ((input.layout?.groundArrays?.length  ?? 0) > 0) return 'ground_mount';
  // Priority 3: project.systemType (legacy — only used when layout.type absent)
  const raw = (input.project?.systemType || '').toLowerCase().trim();
  if (raw === 'solar_fence' || raw === 'fence')  return 'solar_fence';
  if (raw === 'ground_mount' || raw === 'ground') return 'ground_mount';
  if (raw === 'roof')                              return 'roof';
  // No source provided — throw rather than silently default to roof
  throw new Error('[resolveSystemType] Cannot determine system type: layout.type is missing and project.systemType is absent/unrecognized. Ensure layout.type is set before generating planset.');
}

export function sysTypeLabel(t: SysType): string {
  if (t === 'solar_fence')  return 'SOLAR FENCE';
  if (t === 'ground_mount') return 'GROUND-MOUNTED';
  return 'ROOF-MOUNTED';
}

// Title for the combined PV-1 site & array sheet (the old standalone PV-1 site
// plan was folded in 2026-07-08). Kept named pv2Title for call-site stability.
export function pv2Title(t: SysType): string {
  if (t === 'solar_fence')  return 'SOLAR FENCE ELEVATION & PLAN';
  if (t === 'ground_mount') return 'SITE & GROUND ARRAY PLAN';
  return 'SITE & ROOF PLAN — MODULE LAYOUT & FIRE SETBACKS';
}

export function pv3Title(t: SysType): string {
  if (t === 'solar_fence')  return 'FENCE STRUCTURAL DETAILS';
  if (t === 'ground_mount') return 'GROUND MOUNT STRUCTURAL DETAILS';
  return 'ATTACHMENT DETAIL — MOUNTING & BILL OF MATERIALS';
}

export function compassDir(azimuth: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(azimuth / 22.5) % 16];
}

export function statusColor(s: string) {
  if (s === 'PASS' || s === 'pass') return '#000';
  if (s === 'WARNING' || s === 'warning') return '#cc6600';
  if (s === 'FAIL' || s === 'error' || s === 'fail') return '#cc0000';
  if (s === 'info' || s === 'INFO') return '#000';
  return '#555';
}
export function statusBg(s: string) {
  if (s === 'PASS' || s === 'pass') return '#fff';
  if (s === 'WARNING' || s === 'warning') return '#fffbeb';
  if (s === 'FAIL' || s === 'error' || s === 'fail') return '#fef2f2';
  if (s === 'info' || s === 'INFO') return '#f5f5f5';
  return '#fff';
}
export function statusBorder(s: string) {
  if (s === 'PASS' || s === 'pass') return '#e0e0e0';
  if (s === 'WARNING' || s === 'warning') return '#f5f5f5';
  if (s === 'FAIL' || s === 'error' || s === 'fail') return '#fecaca';
  if (s === 'info' || s === 'INFO') return '#000';
  return '#ccc';
}
export function statusLabel(s: string) {
  if (s === 'PASS' || s === 'pass') return '✓ PASS';
  if (s === 'WARNING' || s === 'warning') return '⚠ WARNING';
  if (s === 'FAIL' || s === 'error' || s === 'fail') return '✗ FAIL';
  if (s === 'info' || s === 'INFO') return 'ℹ INFO';
  return s?.toUpperCase() || '—';
}

export function roofTypeLabel(rt?: string) {
  const m: Record<string, string> = {
    shingle: 'Asphalt Shingle',
    tile: 'Concrete/Clay Tile',
    metal_standing_seam: 'Metal Standing Seam',
    metal_corrugated: 'Metal Corrugated',
    flat_tpo: 'Flat — TPO Membrane',
    flat_epdm: 'Flat — EPDM Membrane',
    flat_gravel: 'Flat — Gravel Ballast',
  };
  return rt ? (m[rt] || rt) : 'Asphalt Shingle';
}

export function interconnectionLabel(m?: string) {
  const map: Record<string, string> = {
    LOAD_SIDE: 'Load Side — NEC 705.12(B)',
    SUPPLY_SIDE_TAP: 'Supply Side Tap — NEC 705.11',
    MAIN_BREAKER_DERATE: 'Main Breaker Derate — NEC 705.12(B)(3)',
    PANEL_UPGRADE: 'Panel Upgrade Required',
  };
  return m ? (map[m] || m) : 'Load Side — NEC 705.12(B)';
}

/**
 * One source of truth for "does this job actually have a battery". A count alone
 * is not enough — a stale config can carry batteryCount>0 with no model/id (a
 * "phantom battery"), which otherwise renders ESS labels, ESS certification refs,
 * and a 48V/xx-kWh line across the planset for a project that has no battery.
 * A real battery has an identifying model or id, not just a count.
 */
export function hasRealBattery(project: {
  batteryCount?: number; batteryModel?: string; batteryId?: string;
} | null | undefined): boolean {
  if (!project) return false;
  if (!((project.batteryCount ?? 0) > 0)) return false;
  const model = (project.batteryModel ?? '').trim();
  return !!(project.batteryId || (model && model !== '—'));
}

/**
 * One source of truth for "is this job a supply-side interconnection".
 * Reads the RESOLVED electrical compliance first (generatePermit runs the
 * electrical engine and assigns input.compliance.electrical before any sheet
 * renders), falling back to the project's selected method. Every sheet
 * generator must use this — never re-derive the method from local 120% math.
 */
export function isSupplySideInterconnection(input: {
  project?: { interconnectionMethod?: string };
  compliance?: { electrical?: { busbar?: { necReference?: string; method?: string } } };
}): boolean {
  const bus = input.compliance?.electrical?.busbar;
  if (bus?.necReference?.includes('705.11')) return true;
  if (bus?.method && /supply/i.test(bus.method)) return true;
  return input.project?.interconnectionMethod === 'SUPPLY_SIDE_TAP';
}

// ─── FIX v47.341: Topology auto-detection ──────────────────────────────────────
// Resolves the inverter topology from multiple signals:
//   1. inv.type field (most authoritative — set by equipment DB)
//   2. Inverter brand heuristic (Enphase = micro, SolarEdge = optimizer)
//   3. system.topology field (user/frontend-supplied)
//   4. Default: 'MICRO' (safest for residential)
// Returns normalised uppercase value: 'MICRO' | 'OPTIMIZER' | 'STRING'
export function resolveTopology(input: PermitInput): 'MICRO' | 'OPTIMIZER' | 'STRING' {
  const sys = input.system;
  const inv0 = sys?.inverters?.[0];

  // Priority 1: inv.type field (already normalised in equipment DB)
  const invType = (inv0?.type || '').toLowerCase().trim();
  if (invType === 'micro' || invType === 'microinverter')  return 'MICRO';
  if (invType === 'optimizer' || invType === 'power_optimizer') return 'OPTIMIZER';
  if (invType === 'string')  return 'STRING';

  // Priority 2: Inverter brand/model heuristic
  const brand = (inv0?.manufacturer || '').toLowerCase();
  const model = (inv0?.model || '').toLowerCase();
  const brandModel = `${brand} ${model}`;
  if (brand.includes('enphase') || model.includes('iq8') || model.includes('iq7'))  return 'MICRO';
  if (brand.includes('solaredge') || model.includes('optimizer') || brandModel.includes('p370') || brandModel.includes('p400') || brandModel.includes('p505')) return 'OPTIMIZER';
  if (brand.includes('solark') || brand.includes('sol-ark') || brand.includes('sma') || brand.includes('fronius') || brand.includes('growatt') || brand.includes('huawei')) return 'STRING';

  // Priority 3: system.topology field
  const rawTopo = (sys?.topology || '').toLowerCase().trim();
  if (rawTopo.includes('micro'))     return 'MICRO';
  if (rawTopo.includes('optimizer')) return 'OPTIMIZER';
  if (rawTopo === 'string')          return 'STRING';

  // Default: micro (safest — most residential systems)
  return 'MICRO';
}

// ─── FIX v47.341: Topology display label ────────────────────────────────────────
export function topologyDisplayLabel(topo: 'MICRO' | 'OPTIMIZER' | 'STRING'): string {
  if (topo === 'MICRO')     return 'MICROINVERTER';
  if (topo === 'OPTIMIZER') return 'POWER OPTIMIZER + INVERTER';
  if (topo === 'STRING')    return 'STRING INVERTER';
  return 'INVERTER';
}

// ─── FIX v47.341: Inverter count resolver ───────────────────────────────────────
// For microinverters: count = totalPanels (1 inverter per module)
// For string/optimizer: count = inverters array length (physical inverter boxes)
export function resolveInverterCount(input: PermitInput, topology: 'MICRO' | 'OPTIMIZER' | 'STRING'): number {
  if (topology === 'MICRO') {
    return input.system?.totalPanels || input.layout?.panels?.length || 1;
  }
  return input.system?.inverters?.length || 1;
}

// ─── FIX v47.341: Utility slug → display name ──────────────────────────────────
// Converts raw utility slug (e.g. "va-dominion-energy-va") to human-readable name.
export function utilityDisplayName(raw?: string): string {
  if (!raw) return '';
  // If it already looks like a display name (has spaces, no hyphens), return as-is
  if (raw.includes(' ') && !raw.includes('-')) return raw;
  // Common slug → name map
  const UTILITY_MAP: Record<string, string> = {
    'va-dominion-energy-va':       'Dominion Energy Virginia',
    'dominion-energy-va':          'Dominion Energy Virginia',
    'va-appalachian-power':        'Appalachian Power',
    'duke-energy-carolinas':       'Duke Energy Carolinas',
    'duke-energy-progress':        'Duke Energy Progress',
    'pge':                         'Pacific Gas & Electric (PG&E)',
    'sce':                         'Southern California Edison (SCE)',
    'sdge':                        'San Diego Gas & Electric (SDG&E)',
    'pseg':                        'Public Service Electric & Gas (PSE&G)',
    'comed':                       'Commonwealth Edison (ComEd)',
    'fpl':                         'Florida Power & Light (FPL)',
    'pepco':                       'Potomac Electric Power (PEPCO)',
    'eversource':                  'Eversource Energy',
    'national-grid':               'National Grid',
    'con-edison':                  'Consolidated Edison',
    'xcel-energy':                 'Xcel Energy',
    'aps':                         'Arizona Public Service (APS)',
    'entergy':                     'Entergy',
    'ameren':                      'Ameren',
    'consumers-energy':            'Consumers Energy',
    'we-energies':                 'We Energies',
    'rocky-mountain-power':        'Rocky Mountain Power',
    'georgia-power':               'Georgia Power',
    'alabama-power':               'Alabama Power',
  };
  // Exact match
  const lower = raw.toLowerCase().trim();
  if (UTILITY_MAP[lower]) return UTILITY_MAP[lower];
  // Try without state prefix (e.g. "va-dominion-energy-va" → "dominion-energy-va")
  const noPrefix = lower.replace(/^[a-z]{2}-/, '');
  if (UTILITY_MAP[noPrefix]) return UTILITY_MAP[noPrefix];
  // Generic slug → title case conversion
  return raw
    .replace(/^[a-z]{2}-/, '')           // strip state prefix
    .replace(/-[a-z]{2}$/, '')           // strip state suffix
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Equipment Resolver (normalises any payload shape → canonical fields) ──────────────────────

/**
 * Tries 4 sources in priority order so the permit generator works with
 * ANY payload shape: UI strings array, modules array, project-level fields,
 * or system totals only.
 */


export function resolveEquipment(input: PermitInput): ResolvedEquipment {
  const { system, project } = input;

  // ── 1. Standard UI payload: system.inverters[*].strings[*] ──────────────
  const anyString = system?.inverters
    ?.flatMap((inv) => inv.strings ?? [])
    .find((s) => s?.panelModel);
  if (anyString) {
    const inv0 = system.inverters?.[0];
    return {
      panelManufacturer: anyString.panelManufacturer || '—',
      panelModel:        anyString.panelModel        || '—',
      panelWatts:        anyString.panelWatts        || 0,
      panelVoc:          anyString.panelVoc          || 0,
      panelIsc:          anyString.panelIsc          || 0,
      inverterManufacturer: inv0?.manufacturer || '—',
      inverterModel:        inv0?.model        || '—',
      inverterType:         inv0?.type         || '—',
      inverterAcOutputKw:   inv0?.acOutputKw   || 0,
    };
  }

  // ── 2. Alternative payload: system.modules[] ────────────────────────────
  // Error 5l fix: modules[] now on PermitInput.system type — no `as any` needed
  const modules = system?.modules;
  if (Array.isArray(modules) && modules.length > 0) {
    const m = modules[0];
    const inv0 = system?.inverters?.[0];
    return {
      panelManufacturer: m.manufacturer || m.panelManufacturer || '—',
      panelModel:        m.model        || m.panelModel        || '—',
      panelWatts:        m.watts        || m.panelWatts        || 0,
      panelVoc:          m.voc          || m.panelVoc          || 0,
      panelIsc:          m.isc          || m.panelIsc          || 0,
      inverterManufacturer: inv0?.manufacturer || '—',
      inverterModel:        inv0?.model        || '—',
      inverterType:         inv0?.type         || '—',
      inverterAcOutputKw:   inv0?.acOutputKw   || 0,
    };
  }

  // ── 3. Legacy / manual payload: project-level fields ────────────────────
  const p = project;
  if (p?.panelModel) {
    return {
      panelManufacturer: p.panelManufacturer || p.panelBrand || '—',
      panelModel:        p.panelModel        || '—',
      panelWatts:        p.panelWatts        || 0,
      panelVoc:          p.panelVoc          || 0,
      panelIsc:          p.panelIsc          || 0,
      inverterManufacturer: p.inverterBrand  || p.inverterManufacturer || '—',
      inverterModel:        p.inverterModel  || '—',
      inverterType:         p.inverterType   || '—',
      inverterAcOutputKw:   p.inverterAcOutputKw || 0,
    };
  }

  // ── 4. System totals only — derive what we can ──────────────────────────
  const derivedWatts =
    system?.totalPanels && system?.totalDcKw
      ? Math.round((system.totalDcKw * 1000) / system.totalPanels)
      : 0;
  const inv0 = system?.inverters?.[0];
  return {
    panelManufacturer: '—',
    panelModel:        '—',
    panelWatts:        derivedWatts,
    panelVoc:          0,
    panelIsc:          0,
    inverterManufacturer: inv0?.manufacturer || '—',
    inverterModel:        inv0?.model        || '—',
    inverterType:         inv0?.type         || '—',
    inverterAcOutputKw:   inv0?.acOutputKw   || 0,
  };
}


export type { ResolvedEquipment } from '../types';

// ═══════════════════════════════════════════════════════════════
// Wave 2d — per-subsystem equipment resolution (contract §1.7)
// ═══════════════════════════════════════════════════════════════

/** The slice of CADModel the per-sub resolver reads (structural — a full
 *  CADModel satisfies it; tests can pass a hand-built object). */
export interface HybridEquipmentCarrier {
  hybrid?: {
    sections?: Array<{
      key: string;
      totalPanels?: number;
      equipment?: {
        panelModel?: string;
        panelWatts?: number;
        voc?: number;
        isc?: number;
        inverterMfr?: string;
        inverterModel?: string;
        topology?: 'string' | 'micro' | 'optimizer';
        acKwPerDevice?: number;
      };
    }>;
  } | null;
}

const _blankStr = (s?: string) => !s || s === '—';
const _blankNum = (n?: number) => !(typeof n === 'number' && n > 0);

/** Resolve equipment-db ids from a §1.1 subSystems map entry into `out`,
 *  filling ONLY blank fields (tagged-fleet names always win). Micro registry
 *  is tried first — a micro id in the string registry is impossible, and the
 *  two carry different AC-output units (acOutputW vs acOutputKw). */
function fillFromEquipmentIds(
  out: ResolvedEquipment,
  entry: { inverterId?: string; panelId?: string; topology?: string },
): void {
  if (entry.inverterId) {
    const micro = getMicroinverterById(entry.inverterId) as
      { manufacturer?: string; model?: string; acOutputW?: number } | undefined;
    const str = micro ? undefined : getInverterById(entry.inverterId) as
      { manufacturer?: string; model?: string; acOutputKw?: number } | undefined;
    const dev = micro ?? str;
    if (dev) {
      if (_blankStr(out.inverterManufacturer) && dev.manufacturer) out.inverterManufacturer = dev.manufacturer;
      if (_blankStr(out.inverterModel)        && dev.model)        out.inverterModel = dev.model;
      const kw = micro
        ? (micro.acOutputW ? micro.acOutputW / 1000 : 0)
        : (str?.acOutputKw ?? 0);
      if (_blankNum(out.inverterAcOutputKw) && kw > 0) out.inverterAcOutputKw = kw;
      if (_blankStr(out.inverterType)) out.inverterType = micro ? 'micro' : (entry.topology || 'string');
    }
  }
  if (entry.panelId) {
    const p = (SOLAR_PANELS as Array<{ id: string; manufacturer?: string; model?: string;
      watts?: number; voc?: number; isc?: number }>).find(x => x.id === entry.panelId);
    if (p) {
      if (_blankStr(out.panelManufacturer) && p.manufacturer) out.panelManufacturer = p.manufacturer;
      if (_blankStr(out.panelModel)        && p.model)        out.panelModel = p.model;
      if (_blankNum(out.panelWatts)        && p.watts)        out.panelWatts = p.watts;
      if (_blankNum(out.panelVoc)          && p.voc)          out.panelVoc = p.voc;
      if (_blankNum(out.panelIsc)          && p.isc)          out.panelIsc = p.isc;
    }
  }
}

/**
 * Per-subsystem equipment resolution — the hybrid-safe sibling of
 * `resolveEquipment`. Reads the PermitInput carriage in priority order:
 *
 *   1. Tagged inverters (`system.inverters[].subSystemKey === key`) + their
 *      strings' panel fields — the sub's OWN fleet, never `inverters[0]`.
 *   2. `cad.hybrid.sections[key].equipment` (panelModel/watts/voc/isc,
 *      inverterMfr/Model, topology, acKwPerDevice — per-device kW contract).
 *   3. `input.project._canonical.subSystems[key].panels[].wattage` (panel
 *      wattage from the sub's own placement stamps).
 *   4. NO per-sub carriage at all (untagged single-system legacy payloads):
 *      full fallback to `resolveEquipment(input)` — byte-identical legacy.
 *
 * When PARTIAL per-sub carriage exists, missing fields stay '—'/0 rather than
 * backfilling from the project-wide winner — a fence sub must never print the
 * roof sub's panel model (the contamination class this wave kills).
 */
export function resolveEquipmentBySubSystem(
  input: PermitInput,
  key: 'roof' | 'ground' | 'fence',
  cad?: HybridEquipmentCarrier | null,
): ResolvedEquipment {
  const inverters = input.system?.inverters ?? [];
  const tagged = inverters.filter(inv => (inv as { subSystemKey?: string }).subSystemKey === key);
  const section = cad?.hybrid?.sections?.find(s => s.key === key);
  const canonSubs = (input.project?._canonical as
    { subSystems?: Array<{ key: string; panels?: Array<{ wattage?: number }> }> } | undefined)?.subSystems;
  const canonSub = canonSubs?.find(s => s.key === key);
  // §1.1 equipment authority map (project.subSystems carriage) — id-based
  // fallback so a thin/legacy payload (untagged fleet, no enriched names)
  // still resolves the sub's REAL equipment instead of '—'/0 (the Stowell v3
  // "48 × 0W · Inverter" E-1 class).
  const mapEntry = (input.project as { subSystems?: Record<string, {
    inverterId?: string; panelId?: string; topology?: string;
  }> })?.subSystems?.[key];

  // 4. Untagged / N=1 legacy: no per-sub carriage → legacy resolver unchanged.
  if (tagged.length === 0 && !section?.equipment && !canonSub && !mapEntry) {
    return resolveEquipment(input);
  }

  const out: ResolvedEquipment = {
    panelManufacturer: '—', panelModel: '—', panelWatts: 0, panelVoc: 0, panelIsc: 0,
    inverterManufacturer: '—', inverterModel: '—', inverterType: '—', inverterAcOutputKw: 0,
  };

  // 1. The sub's own tagged fleet.
  if (tagged.length > 0) {
    const inv0 = tagged[0];
    const anyString = tagged.flatMap(inv => inv.strings ?? []).find(s => s?.panelModel);
    if (anyString) {
      out.panelManufacturer = anyString.panelManufacturer || '—';
      out.panelModel        = anyString.panelModel        || '—';
      out.panelWatts        = anyString.panelWatts        || 0;
      out.panelVoc          = anyString.panelVoc          || 0;
      out.panelIsc          = anyString.panelIsc          || 0;
    }
    out.inverterManufacturer = inv0.manufacturer || '—';
    out.inverterModel        = inv0.model        || '—';
    out.inverterType         = inv0.type         || '—';
    out.inverterAcOutputKw   = inv0.acOutputKw   || 0;
  }

  // 1.5. Equipment-authority ids → equipment-db specs (fills blanks only —
  // the tagged fleet's enriched names always win when present).
  if (mapEntry?.inverterId || mapEntry?.panelId) {
    fillFromEquipmentIds(out, mapEntry);
  }

  // 2. The sub's CAD section equipment carriage fills what the fleet lacks.
  const se = section?.equipment;
  if (se) {
    if (_blankStr(out.panelModel)           && se.panelModel)    out.panelModel = se.panelModel;
    if (_blankNum(out.panelWatts)           && se.panelWatts)    out.panelWatts = se.panelWatts;
    if (_blankNum(out.panelVoc)             && se.voc)           out.panelVoc = se.voc;
    if (_blankNum(out.panelIsc)             && se.isc)           out.panelIsc = se.isc;
    if (_blankStr(out.inverterManufacturer) && se.inverterMfr)   out.inverterManufacturer = se.inverterMfr;
    if (_blankStr(out.inverterModel)        && se.inverterModel) out.inverterModel = se.inverterModel;
    if (_blankStr(out.inverterType)         && se.topology)      out.inverterType = se.topology;
    if (_blankNum(out.inverterAcOutputKw)   && se.acKwPerDevice) out.inverterAcOutputKw = se.acKwPerDevice;
  }

  // 3. Panel wattage from the sub's OWN placement-stamped panels.
  if (_blankNum(out.panelWatts) && canonSub?.panels?.length) {
    const w = canonSub.panels.find(p => typeof p?.wattage === 'number' && p.wattage > 0)?.wattage;
    if (w) out.panelWatts = w;
  }

  return out;
}


// Error 5bb fix: NEC 240.6(A) standard OCPD ampere ratings
// DO NOT use Math.ceil(x/5)*5 — it can produce 55, 65, 75, 85, 95A which are NOT standard.
export const NEC_STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200] as const;

/** Return the next standard NEC OCPD rating ≥ the given ampere value.
 *  Must NEVER return below the requested ampacity (NEC 240.4) — if it exceeds
 *  the largest standard rating, round up to the next 100A. */
export function necNextStandardOcpd(amps: number): number {
  return NEC_STANDARD_OCPD.find(s => s >= amps) ?? Math.ceil(amps / 100) * 100;
}
