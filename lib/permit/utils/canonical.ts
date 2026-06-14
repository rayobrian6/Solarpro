// ═══════════════════════════════════════════════════════════════
// Canonical Pipeline — buildCanonical, validation, dimensions
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, CanonicalInput, CanonicalSysType, CanonicalModule, CanonicalSite, CanonicalStructure, CanonicalElectrical, CanonicalLayoutDimensions } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { resolveEquipment } from './helpers';

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL PIPELINE (v47.313)
// layout is the SINGLE SOURCE OF TRUTH. All planset generation reads
// from CanonicalInput only. project.systemType / engineering.systemType
// are IGNORED — only layout.type, layout.panels, layout.geometry are used.
// ═══════════════════════════════════════════════════════════════════════════

// Mount system name map — locked to canonical systemType, no drift
export const MOUNT_SYSTEM_MAP: Record<CanonicalSysType, string> = {
  roof:         'IronRidge XR100',
  solar_fence:  'Solar Fence Rail System',
  ground_mount: 'Ground Mount Racking System',
};

export const VALID_CANONICAL_TYPES: CanonicalSysType[] = ['roof', 'ground_mount', 'solar_fence'];

/**
 * buildCanonical — Layout-locked pipeline entry point.
 * Reads layout.type, layout.panels, layout.geometry.
 * Throws hard on any missing/invalid field — no silent fallbacks.
 */
export function buildCanonical(input: PermitInput): CanonicalInput {
  const layout = input.layout;

  if (!layout) {
    throw new Error('[CANONICAL] Missing layout — pipeline broken. Frontend must send layout object.');
  }

  // FIX v47.319: Resolve canonical system type with full priority chain.
  // Sources checked in order — first non-roof fence/ground signal wins:
  //   1. Panel placementType/systemType fields (actual design geometry — most reliable)
  //   2. Project name keyword scan (catches DB corruption)
  //   3. layout.type / layout.systemType / project.systemType
  //   4. mountingSystemId category lookup
  // This catches projects where bill-upload hardcoded system_type='roof' in the DB.
  const layoutTypeRaw  = (layout.type     || '').toLowerCase().trim();
  const layoutSysRaw   = ((layout as any).systemType || '').toLowerCase().trim();
  const projectSysRaw  = (input.project.systemType || '').toLowerCase().trim();
  const mountingId     = (input.project.mountingSystemId || '').toLowerCase().trim();
  const projectName    = input.project.projectName.toLowerCase();

  // Normalise any source to a canonical type
  function toCanonical(s: string): CanonicalSysType | null {
    if (s === 'solar_fence'  || s === 'fence')  return 'solar_fence';
    if (s === 'ground_mount' || s === 'ground') return 'ground_mount';
    if (s === 'roof')                            return 'roof';
    return null;
  }

  // Priority 1: Panel-based detection (placementType/systemType on each panel)
  let fromPanels: CanonicalSysType | null = null;
  const panels_raw = layout.panels || [];
  let fenceCount = 0, groundCount = 0;
  for (const p of panels_raw) {
    const pt = ((p as any).placementType || '').toUpperCase();
    const st = ((p as any).systemType   || '').toLowerCase();
    if (pt === 'FENCE'  || st === 'fence'  || st === 'solar_fence')  fenceCount++;
    if (pt === 'GROUND' || st === 'ground' || st === 'ground_mount') groundCount++;
  }
  if (fenceCount  > 0) fromPanels = 'solar_fence';
  else if (groundCount > 0) fromPanels = 'ground_mount';

  // Priority 2: Project name keyword scan
  let fromName: CanonicalSysType | null = null;
  if (projectName.includes('sol fence') || projectName.includes('solar fence') || projectName.includes('fence')) fromName = 'solar_fence';
  else if (projectName.includes('ground mount') || projectName.includes('ground-mount')) fromName = 'ground_mount';

  // Priority 3: layout/project systemType fields
  const fromLayoutType  = toCanonical(layoutTypeRaw);
  const fromLayoutSys   = toCanonical(layoutSysRaw);
  const fromProjectSys  = toCanonical(projectSysRaw);

  // Priority 4: mountingSystemId category lookup
  let fromMountingId: CanonicalSysType | null = null;
  if (mountingId) {
    const mountSpec = getMountingSystemById(mountingId);
    if (mountSpec) {
      const cat = mountSpec.category;
      if (cat === 'solar_fence')                              fromMountingId = 'solar_fence';
      else if (cat === 'ground_mount' || cat === 'tracker')  fromMountingId = 'ground_mount';
      else if (cat === 'roof_residential' || cat === 'roof_commercial' || cat === 'carport') fromMountingId = 'roof';
    }
  }

  // Resolve: first non-roof fence/ground signal wins
  let resolvedType: CanonicalSysType | null = null;
  const allSignals: (CanonicalSysType | null)[] = [
    fromPanels, fromName, fromLayoutType, fromLayoutSys, fromProjectSys, fromMountingId
  ];
  const nonRoofSignal = allSignals.find(t => t === 'solar_fence' || t === 'ground_mount');
  if (nonRoofSignal) {
    resolvedType = nonRoofSignal;
  } else {
    resolvedType = allSignals.find(t => t !== null) || 'roof';
  }

  console.log('[CANONICAL RESOLVE]', {
    fromPanels, fromName, fromLayoutType, fromLayoutSys, fromProjectSys, fromMountingId, resolvedType,
  });

  const rawType = resolvedType as CanonicalSysType;

  if (!rawType) {
    throw new Error('[CANONICAL] layout.type is missing — cannot determine system type.');
  }
  if (!VALID_CANONICAL_TYPES.includes(rawType)) {
    throw new Error(`[CANONICAL] Invalid layout.type: "${rawType}" — must be one of: ${VALID_CANONICAL_TYPES.join(', ')}`);
  }

  // FIX v47.318: If we corrected the type away from what layout.type said, patch layout.type
  // so downstream code reading layout.type also sees the correct value.
  if (layout.type !== rawType) {
    console.warn('[CANONICAL] FIX v47.318: layout.type corrected from', layout.type,
      '->', rawType, '| layoutSys:', layoutSysRaw, '| projectSys:', projectSysRaw);
    (layout as any).type = rawType;
  }

  const panels = layout.panels;
  if (!panels || panels.length === 0) {
    throw new Error(`[CANONICAL] layout.panels is missing or empty for system type "${rawType}". Layout must include panel positions.`);
  }

  console.log('[CANONICAL LOCK]', {
    systemType:      rawType,
    panels:          panels.length,
    layoutType:      layout.type,
    layoutTypeSent:  layoutTypeRaw,
    layoutSysType:   layoutSysRaw,
    projectSysType:  projectSysRaw,
    hasGeometry:     !!layout.geometry,
  });

  // ── Step 4: Resolve module (hard-fail if missing) ────────────────────────
  // Priority: system.inverters[*].strings[*] → system.modules[0] → project fields
  const eq = resolveEquipment(input);
  if (!eq.panelModel || eq.panelModel === '—') {
    throw new Error('[CANONICAL] Missing module data — panelModel is required. Frontend must send system.inverters[].strings[].panelModel.');
  }
  const canonicalModule: CanonicalModule = {
    manufacturer: eq.panelManufacturer,
    model:        eq.panelModel,
    wattage:      eq.panelWatts,
    voc:          eq.panelVoc,
    isc:          eq.panelIsc,
  };

  // ── Step 5: Mount system — locked to systemType, no input drift ──────────
  const mountSystem = MOUNT_SYSTEM_MAP[rawType];

  // ── Step 7: Hard validation gates ────────────────────────────────────────
  if (!rawType)              throw new Error('[CANONICAL] HARD FAIL: systemType is missing');
  if (!panels.length)        throw new Error('[CANONICAL] HARD FAIL: panels array is empty');
  if (!canonicalModule)      throw new Error('[CANONICAL] HARD FAIL: module is missing');

  // ── Step 8: Debug log ─────────────────────────────────────────────────────
  console.log('[PLANSET FINAL]', {
    type:    rawType,
    panels:  panels.length,
    wattage: canonicalModule.wattage,
    model:   canonicalModule.model,
    mount:   mountSystem,
  });

  // ── Populate site sub-object ──────────────────────────────────────────────
  const struct = input.compliance?.structural;
  const jx     = input.compliance?.jurisdiction;
  const canonicalSite: CanonicalSite = {
    windSpeed:        Number(struct?.wind?.windSpeed) || Number(input.project.ahjWindSpeedMph) || Number(input.project.windSpeedMph) || 0,
    groundSnowLoad:   Number(struct?.snow?.groundSnowLoad) || 0,
    exposureCategory: struct?.wind?.exposureCategory       || input.project.exposureCategory || 'C',
    seismicSDC:       (struct as any)?.seismic?.sdc        || 'D',
    state:            jx?.state                            || '—',
    ahj:              jx?.ahj                              || '—',
  };

  // ── Populate structure sub-object (CAD + project fields) ─────────────────
  // NOTE: cad is not available inside buildCanonical — use layout geometry + project fields.
  // cad-derived values are injected post-build in generatePermitHTML via _canonical._cadPatch.
  const fenceSegs = layout.geometry?.fenceSegments || [];
  const firstGnd  = layout.geometry?.groundArrays?.[0];
  const canonicalStructure: CanonicalStructure = {
    // Fence defaults (patched with CAD values post-build)
    postEmbedFt:     input.project.postEmbedFt    || 3.5,
    postSpacingFt:   input.project.postSpacingFt  || 8.0,
    panelHeightFt:   input.project.panelHeightFt  || 6.0,
    soilResistance:  input.project.soilResistance || 200,
    // Ground defaults
    pileDepthFt:     input.project.pileDepthFt    || 5.0,
    pileSpacingFt:   input.project.pileSpacingFt  || 8.0,
    groundClearIn:   input.project.groundClearIn  || 12,
    tiltDeg:         firstGnd?.tiltDeg                     || input.project.tiltDeg || 20,
    // Roof
    rafterSize:      input.project.rafterSize     || '2×6',
    rafterSpacingIn: Number(input.project.rafterSpacing)   || 24,
    attachSpacingIn: Number(input.project.attachmentSpacing) || 48,
  };

  // ── Populate electrical sub-object ───────────────────────────────────────
  const inv0   = input.system?.inverters?.[0];
  const str0   = inv0?.strings?.[0];
  const canonicalElectrical: CanonicalElectrical = {
    totalPanels:   input.system?.totalPanels  || panels.length,
    totalDcKw:     input.system?.totalDcKw    || (panels.length * canonicalModule.wattage / 1000),
    moduleWattage: canonicalModule.wattage,
    voc:           canonicalModule.voc,
    isc:           canonicalModule.isc,
    strings:       inv0?.strings?.length      || 1,
    inverterModel: inv0 ? `${inv0.manufacturer || ''} ${inv0.model || ''}`.trim() : '—',
    inverterKw:    inv0?.acOutputKw           || 0,
  };

  return {
    systemType:       rawType,
    panels,
    geometry:         layout.geometry ?? undefined,
    layout,
    engineering:      input.engineering ?? null,
    module:           canonicalModule,
    mountSystem,
    site:             canonicalSite,
    structure:        canonicalStructure,
    electrical:       canonicalElectrical,
    layoutDimensions: null,  // populated post-CAD by buildLayoutDimensions()
  };
}

/**
 * getLayoutMode — Template lock.
 * Returns the CSS layout class for a given system type.
 * Throws on unknown type — prevents cross-contamination.
 */
export function getLayoutMode(systemType: CanonicalSysType): string {
  switch (systemType) {
    case 'solar_fence':  return 'layout-elevation-dominant';
    case 'roof':         return 'layout-plan-dominant';
    case 'ground_mount': return 'layout-split-view';
    default: {
      const _never: never = systemType;
      throw new Error(`[CANONICAL] getLayoutMode: unknown system type "${String(_never)}"`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATION ENGINE — validateCanonical()
// Called before ANY page render. Throws named errors on missing engineering data.
// Result: no fake plansets, only valid engineering outputs.
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// HARD VALIDATION GATE — validateCanonicalStrict()
// Throws immediately on ANY missing required engineering field.
// NO silent fallbacks. NO defaults. NO warnings-only.
// A planset MUST NOT generate unless it passes ALL checks.
// ══════════════════════════════════════════════════════════════════════════════
export function validateCanonicalStrict(canonical: CanonicalInput): void {
  if (!canonical.systemType)
    throw new Error('[PLANSET BLOCKED] MISSING SYSTEM TYPE — canonical.systemType is not set. Pipeline broken.');

  if (!canonical.panels?.length)
    throw new Error('[PLANSET BLOCKED] NO PANEL LAYOUT — canonical.panels is empty. Layout must include panel positions.');

  if (!canonical.module || !canonical.module.wattage || canonical.module.wattage <= 0)
    throw new Error('[PLANSET BLOCKED] MISSING MODULE DATA — canonical.module.wattage is zero or missing. Equipment list incomplete.');

  if (!canonical.site?.windSpeed || canonical.site.windSpeed <= 0)
    throw new Error('[PLANSET BLOCKED] MISSING WIND SPEED — canonical.site.windSpeed is zero. Run Compliance Check first to set AHJ wind speed.');

  if (!canonical.structure)
    throw new Error('[PLANSET BLOCKED] MISSING STRUCTURAL DATA — canonical.structure is not populated. CAD engine did not resolve geometry.');

  if (!canonical.layoutDimensions)
    throw new Error('[PLANSET BLOCKED] MISSING LAYOUT DIMENSIONS — canonical.layoutDimensions is null. buildLayoutDimensions() must run after CAD.');

  console.log('[CANONICAL STRICT] ✓ All checks passed —', {
    systemType:     canonical.systemType,
    panels:         canonical.panels.length,
    windSpeed:      canonical.site.windSpeed,
    moduleWatts:    canonical.module.wattage,
    totalDcKw:      canonical.electrical?.totalDcKw?.toFixed(2) ?? '—',
    mountSystem:    canonical.mountSystem,
    totalLengthFt:  canonical.layoutDimensions.totalLengthFt.toFixed(1),
    totalHeightFt:  canonical.layoutDimensions.totalHeightFt.toFixed(1),
  });
}

// Legacy alias — kept for safety; routes to strict gate
export function validateCanonical(canonical: CanonicalInput): void {
  return validateCanonicalStrict(canonical);
}

// ══════════════════════════════════════════════════════════════════════════════
// DIMENSION BUILDER — buildLayoutDimensions()
// Extracts authoritative system dimensions from the CAD model.
// Called AFTER CAD engine runs and BEFORE validateCanonicalStrict().
// Throws if dimensions cannot be computed — no planset without dimensions.
// ══════════════════════════════════════════════════════════════════════════════
export function buildLayoutDimensions(canonical: CanonicalInput, cad: CADModel): CanonicalLayoutDimensions {
  const sys = canonical.systemType;

  // Panel dimensions — top-level on CADModel (authoritative)
  const panelWidthIn  = cad.panelWidthM  > 0 ? cad.panelWidthM  * 39.3701 : (canonical.layout as any)?.panelWidthIn  || 40.9;
  const panelHeightIn = cad.panelHeightM > 0 ? cad.panelHeightM * 39.3701 : (canonical.layout as any)?.panelHeightIn || 66.9;

  let totalLengthFt   = 0;
  let totalHeightFt   = 0;
  let rowSpacingFt    = 0;
  let columnSpacingFt = 0;
  let source          = '';

  if (sys === 'solar_fence') {
    totalLengthFt   = cad.fence?.totalLengthM  ? cad.fence.totalLengthM  * 3.28084 : 0;
    totalHeightFt   = cad.fence?.panelHeightM   ? cad.fence.panelHeightM  * 3.28084 : canonical.structure.panelHeightFt || 0;
    rowSpacingFt    = cad.fence?.postSpacingM   ? cad.fence.postSpacingM  * 3.28084 : canonical.structure.postSpacingFt || 8.0;
    columnSpacingFt = panelWidthIn / 12;
    source = 'cad.fence (totalLengthM/panelHeightM/postSpacingM)';

  } else if (sys === 'ground_mount') {
    const gArr = cad.ground?.arrays?.[0];
    totalLengthFt   = gArr?.dimensions?.arrayWidthM ? gArr.dimensions.arrayWidthM * 3.28084 : 0;
    totalHeightFt   = gArr?.dimensions?.arrayDepthM ? gArr.dimensions.arrayDepthM * 3.28084 : 0;
    rowSpacingFt    = gArr?.rowSpacingM             ? gArr.rowSpacingM             * 3.28084 : 0;
    columnSpacingFt = panelWidthIn / 12;
    source = 'cad.ground.arrays[0].dimensions';

  } else {
    // roof
    const plane = cad.roof?.planes?.[0];
    totalLengthFt   = plane?.dimensions?.widthM  ? plane.dimensions.widthM  * 3.28084 : 0;
    totalHeightFt   = plane?.dimensions?.heightM ? plane.dimensions.heightM * 3.28084 : 0;
    rowSpacingFt    = (panelHeightIn + 1) / 12;
    columnSpacingFt = panelWidthIn / 12;
    source = 'cad.roof.planes[0].dimensions';
  }

  // Fallback to bounds if system data unavailable
  if (totalLengthFt <= 0 || totalHeightFt <= 0) {
    const bW = (cad.bounds.maxX - cad.bounds.minX) * 3.28084;
    const bH = (cad.bounds.maxY - cad.bounds.minY) * 3.28084;
    if (bW > 0 && totalLengthFt <= 0) { totalLengthFt = bW; source += '+bounds.W'; }
    if (bH > 0 && totalHeightFt <= 0) { totalHeightFt = bH; source += '+bounds.H'; }
  }

  // Hard throw if still zero — no planset without dimensions
  if (totalLengthFt <= 0 || totalHeightFt <= 0) {
    throw new Error(
      `[PLANSET BLOCKED] CANNOT COMPUTE DIMENSIONS — system=${sys} ` +
      `totalLengthFt=${totalLengthFt.toFixed(2)} totalHeightFt=${totalHeightFt.toFixed(2)}. ` +
      'CAD engine did not produce valid geometry. Check panel layout.'
    );
  }

  return {
    totalLengthFt:   parseFloat(totalLengthFt.toFixed(2)),
    totalHeightFt:   parseFloat(totalHeightFt.toFixed(2)),
    panelWidthIn:    parseFloat(panelWidthIn.toFixed(1)),
    panelHeightIn:   parseFloat(panelHeightIn.toFixed(1)),
    rowSpacingFt:    parseFloat(rowSpacingFt.toFixed(2)),
    columnSpacingFt: parseFloat(columnSpacingFt.toFixed(2)),
    source,
  };
}



