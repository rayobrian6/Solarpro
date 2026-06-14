// ═══════════════════════════════════════════════════════════════
// Text & Label Helpers — resolveSystemType, equipment resolver, etc.
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, ResolvedEquipment } from '../types';


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

export function pv2Title(t: SysType): string {
  if (t === 'solar_fence')  return 'SOLAR FENCE ELEVATION & PLAN';
  if (t === 'ground_mount') return 'GROUND ARRAY PLAN';
  return 'ROOF PLAN — MODULE LAYOUT & FIRE SETBACKS';
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
    SUPPLY_SIDE_TAP: 'Supply Side Tap — NEC 705.12(A)',
    MAIN_BREAKER_DERATE: 'Main Breaker Derate — NEC 705.12(B)(3)',
    PANEL_UPGRADE: 'Panel Upgrade Required',
  };
  return m ? (map[m] || m) : 'Load Side — NEC 705.12(B)';
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
  const modules = (system as any)?.modules;
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
