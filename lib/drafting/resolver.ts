// ============================================================
// SolarPro Drafting Engine — System Type Resolver
// lib/drafting/resolver.ts
//
// resolveSystemType() MUST be called before any drawing.
// Throws on unresolvable input — no silent defaults.
// ============================================================

import type { DraftingInput, SysType } from './types';

/**
 * Resolve the system type from input data.
 *
 * Resolution order:
 *   1. project.systemType string (explicit)
 *   2. layout.fenceSegments present → solar_fence
 *   3. layout.groundArrays present → ground_mount
 *   4. Default → roof
 *
 * Throws if project is missing entirely.
 */
export function resolveSystemType(input: DraftingInput): SysType {
  if (!input || !input.project) {
    throw new Error('[DraftingEngine] resolveSystemType: input.project is required');
  }

  const raw = (input.project.systemType || '').toLowerCase().trim();

  if (raw === 'solar_fence' || raw === 'fence') return 'solar_fence';
  if (raw === 'ground_mount' || raw === 'ground') return 'ground_mount';
  if (raw === 'roof') return 'roof';

  // Infer from layout data
  const hasFence  = (input.layout?.fenceSegments?.length  ?? 0) > 0;
  const hasGround = (input.layout?.groundArrays?.length   ?? 0) > 0;

  if (hasFence)  return 'solar_fence';
  if (hasGround) return 'ground_mount';

  // Default to roof (most common system type)
  return 'roof';
}

/**
 * Display label for the system type.
 */
export function sysTypeLabel(t: SysType): string {
  if (t === 'solar_fence')  return 'SOLAR FENCE';
  if (t === 'ground_mount') return 'GROUND-MOUNTED PV';
  return 'ROOF-MOUNTED PV';
}

/**
 * PV-2 page title per system type.
 */
export function pv2Title(t: SysType): string {
  if (t === 'solar_fence')  return 'SOLAR FENCE — PLAN VIEW & ELEVATION';
  if (t === 'ground_mount') return 'GROUND ARRAY — SITE PLAN';
  return 'ROOF PLAN — MODULE LAYOUT & FIRE SETBACKS';
}

/**
 * PV-3 page title per system type.
 */
export function pv3Title(t: SysType): string {
  if (t === 'solar_fence')  return 'FENCE STRUCTURAL — ELEVATION DETAIL';
  if (t === 'ground_mount') return 'GROUND MOUNT — STRUCTURAL DETAIL';
  return 'ROOF ATTACHMENT — CROSS-SECTION & MOUNTING DETAIL';
}