// ═══════════════════════════════════════════════════════════════
// Structural Input Builder — ONE source of truth for the V4
// structural engine's input, shared by the planset (generatePermit)
// and the BOM (bomForPermit).
//
// Why it exists: generatePermit built the StructuralInputV4 inline,
// so the BOM had no way to reproduce the same structural result —
// it guessed attachmentCount / railSections instead, and the rail
// count, lag-bolt count and rail-bolt count on the BOM disagreed
// with the structural sheets (PV-4C / mounting details). Because
// buildCanonical(input) and this builder are both deterministic,
// generatePermit and bomForPermit run the SAME structural engine
// with the SAME input and therefore get the SAME rackingBOM — the
// BOM and the sheets cannot diverge.
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, CanonicalInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import type { StructuralInputV4 } from '@/lib/structural-engine-v4';
import { resolveArrayStructuralLayout } from './arrayLayout';

/**
 * Build the V4 structural-engine input from the permit input + CAD + canonical
 * site data. Pure/deterministic: same inputs → same StructuralInputV4. Roof
 * systems only (the caller gates on systemType === 'roof').
 */
export function buildStructuralInputForPermit(
  input: PermitInput,
  cad: CADModel,
  canonical: CanonicalInput,
): StructuralInputV4 {
  const roofPitchDeg = cad.roof?.planes?.[0]?.pitch ?? input.project.roofPitch ?? 20;
  const windSpeed    = canonical.site.windSpeed || 115;
  const groundSnow   = canonical.site.groundSnowLoad || 0;
  const rafterSize   = input.project.rafterSize || '2x6';
  const rafterSpIn   = input.project.rafterSpacing || 24;

  // Framing: pass 'unknown' THROUGH so the V4 engine's auto-detect runs
  // (24" O.C. → truss). Coercing to 'rafter' made auto-detect unreachable.
  const framingType: 'truss' | 'rafter' | 'unknown' =
    (input.project.framingType === 'truss' || input.project.framingType === 'rafter')
      ? (input.project.framingType as 'truss' | 'rafter') : 'unknown';
  const _effFraming: 'truss' | 'rafter' = framingType === 'unknown'
    ? (rafterSpIn >= 24 ? 'truss' : 'rafter')
    : framingType;

  // Span: derive from the ROOF GEOMETRY when the project field is empty. Trusses
  // span the building's short dimension; stick rafters run roughly half of it.
  const _geomSpanFt = (() => {
    const polys = (cad.roof?.planes ?? []).flatMap((pl: any) => pl.polygon ?? []);
    if (polys.length < 3) return undefined;
    const xs = polys.map((p: any) => p.x), ys = polys.map((p: any) => p.y);
    const depthM = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (!isFinite(depthM) || depthM <= 0) return undefined;
    const depthFt = depthM * 3.28084;
    return Math.round((_effFraming === 'truss' ? depthFt : depthFt / 2) * 10) / 10;
  })();
  const rafterSpFt = input.project.rafterSpan || _geomSpanFt || 12;

  // Single source for the array layout: the design's real placed modules.
  const arrayLayout = resolveArrayStructuralLayout(input, cad);
  const totalPanels = arrayLayout.panelCount || input.system?.totalPanels || cad.totalPanels || 1;

  return {
    installationType: 'roof_residential',
    windSpeed,
    windExposure: ((): 'B' | 'C' | 'D' => {
      const e = String(canonical.site.exposureCategory || 'C').toUpperCase();
      return e === 'B' || e === 'D' ? e : 'C';
    })(),
    groundSnowLoad: groundSnow,
    meanRoofHeight: 15,
    roofPitch: roofPitchDeg,
    framingType,
    rafterSize,
    rafterSpacingIn: rafterSpIn,
    rafterSpanFt: rafterSpFt,
    woodSpecies: ((): 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir' => {
      const k = (input.project.rafterSpecies ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
      if (k.startsWith('southern')) return 'Southern Pine';
      if (k.startsWith('hem')) return 'Hem-Fir';
      if (k.startsWith('spruce') || k === 'spf') return 'Spruce-Pine-Fir';
      return 'Douglas Fir-Larch';
    })(),
    panelCount: totalPanels,
    panelLengthIn: arrayLayout.panelLengthIn,
    panelWidthIn: arrayLayout.panelWidthIn,
    panelWeightLbs: arrayLayout.panelWeightLbs,
    panelOrientation: arrayLayout.orientation,
    rowCount: arrayLayout.rowCount,
    colCount: arrayLayout.colCount,
    mountingSystemId: input.project.mountingSystemId || 'ironridge-xr100',
    rackingWeightPerPanelLbs: 4,
  };
}
