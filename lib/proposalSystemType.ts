/**
 * lib/proposalSystemType.ts
 * v47.220 — Panel-based system type detection for proposal display layer.
 *
 * SAFE, additive, display-only. Does NOT modify DB schema, API, or routing.
 * All functions have safe fallbacks — never throws, never crashes UI.
 */

import type { PlacedPanel, Layout } from '@/types';

// ─── Step 1: Per-panel mount type detection ──────────────────────────────────
// Uses existing fields on PlacedPanel. Does NOT rely on new fields.
// Falls back to 'roof' if nothing is set.
export function detectPanelMountType(panel: PlacedPanel): 'roof' | 'ground' | 'fence' {
  try {
    // placementType is the authoritative field set by planeEngine.ts
    if (panel.placementType === 'FENCE')  return 'fence';
    if (panel.placementType === 'GROUND') return 'ground';
    if (panel.placementType === 'ROOF')   return 'roof';
    // systemType is the legacy field set by panelLayout.ts / DesignStudio
    if (panel.systemType === 'fence')  return 'fence';
    if (panel.systemType === 'ground') return 'ground';
    if (panel.systemType === 'roof')   return 'roof';
  } catch {
    // never crash
  }
  return 'roof'; // safe fallback
}

// ─── Step 2: Count panels by mount type ──────────────────────────────────────
export function getPanelTypeCounts(
  panels: PlacedPanel[]
): { roof: number; ground: number; fence: number } {
  const counts = { roof: 0, ground: 0, fence: 0 };
  if (!Array.isArray(panels)) return counts;
  for (const panel of panels) {
    const t = detectPanelMountType(panel);
    counts[t]++;
  }
  return counts;
}

// ─── Step 3: Derive system type from panel counts ────────────────────────────
// Returns 'roof' | 'ground' | 'fence' | 'hybrid'
export function deriveSystemTypeFromPanels(
  panels: PlacedPanel[]
): 'roof' | 'ground' | 'fence' | 'hybrid' {
  if (!Array.isArray(panels) || panels.length === 0) return 'roof'; // safe fallback
  const { roof, ground, fence } = getPanelTypeCounts(panels);
  const typeCount = (roof > 0 ? 1 : 0) + (ground > 0 ? 1 : 0) + (fence > 0 ? 1 : 0);
  if (typeCount > 1)  return 'hybrid';
  if (fence  > 0)    return 'fence';
  if (ground > 0)    return 'ground';
  return 'roof';
}

// ─── Step 4: Name-keyword hint (secondary signal) ────────────────────────────
// Used when panels have no type info (e.g. old data without systemType/placementType)
export function getNameHint(projectName: string | null | undefined): 'fence' | 'ground' | 'carport' | '' {
  const nm = (projectName || '').toLowerCase();
  if (nm.includes('sol fence') || nm.includes('solar fence') || nm.includes('fence')) return 'fence';
  if (nm.includes('ground mount') || nm.includes('ground-mount') || nm.includes('ground')) return 'ground';
  if (nm.includes('carport') || nm.includes('car port')) return 'carport';
  return '';
}

// ─── Step 5: Full resolution chain ───────────────────────────────────────────
/**
 * Resolves the display system type for a proposal using a safe, layered approach:
 *
 * Priority (highest → lowest):
 *  1. Panel data (placementType / systemType fields on each PlacedPanel) — most accurate
 *  2. Layout-level systemType from DB — set at design time
 *  3. Project-level systemType from DB — top-level project setting
 *  4. Project name keyword scan — catches corrupted / missing DB data
 *  5. 'roof' — universal safe fallback
 *
 * 'hybrid' is only returned when panels from multiple mount types are present.
 */
export function resolveProposalSystemType(opts: {
  panels:          PlacedPanel[] | null | undefined;
  layoutSystemType: string | null | undefined;
  projSystemType:   string | null | undefined;
  projectName:      string | null | undefined;
}): string {
  const { panels, layoutSystemType, projSystemType, projectName } = opts;

  try {
    // ── 1. Panel-based detection (primary) ───────────────────────────────────
    // Only use panel data if panels exist AND at least some have type info
    const panelList = Array.isArray(panels) ? panels : [];
    const typedPanels = panelList.filter(
      p => p.placementType || p.systemType
    );

    if (typedPanels.length > 0) {
      const derived = deriveSystemTypeFromPanels(panelList);
      // Only use panel-derived type if it's meaningful (not a default-fallback 'roof'
      // on untouched old panels that have no type info set)
      if (derived !== 'roof' || typedPanels.length === panelList.length) {
        return derived;
      }
    }

    // ── 2. Layout-level systemType (non-roof values take priority) ───────────
    if (layoutSystemType && layoutSystemType !== 'roof') return layoutSystemType;

    // ── 3. Project-level systemType (non-roof values take priority) ──────────
    if (projSystemType && projSystemType !== 'roof') return projSystemType;

    // ── 4. Name-keyword scan (catches corrupted DB data) ─────────────────────
    const nameHint = getNameHint(projectName);
    if (nameHint) return nameHint;

    // ── 5. Explicit DB 'roof' values as last resort ──────────────────────────
    if (layoutSystemType) return layoutSystemType;
    if (projSystemType)   return projSystemType;

  } catch (err) {
    // Never crash the proposal UI
    console.error('[resolveProposalSystemType] Error during resolution, falling back to roof:', err);
  }

  return 'roof'; // ultimate safe fallback
}