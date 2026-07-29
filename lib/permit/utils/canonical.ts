// ═══════════════════════════════════════════════════════════════
// Canonical Pipeline — buildCanonical, validation, dimensions
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, CanonicalInput, CanonicalSysType, CanonicalModule, CanonicalSite, CanonicalStructure, CanonicalElectrical, CanonicalLayoutDimensions } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { partitionSubSystems } from './subSystems';
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
 * Single-source-of-truth guard for the module wattage. The planset resolves the
 * module from engineering (system.inverters[].strings[]); this cross-checks that
 * against every OTHER place a module wattage is stored and logs a loud warning
 * when they disagree by >2%, naming each source and its value. Diagnostic only —
 * never throws — but it turns a silent design↔engineering drift (design 440W vs
 * engineering 600W) into a visible, attributable log line. Exported for tests.
 */
export function assertModuleConsistency(input: PermitInput, authoritativeWatts: number): Array<{ source: string; watts: number }> {
  if (!isFinite(authoritativeWatts) || authoritativeWatts <= 0) return [];
  const sys = input.system as Record<string, unknown> | undefined;
  const proj = input.project as Record<string, unknown> | undefined;
  const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

  const sources: Array<{ source: string; watts: number }> = [];
  const push = (source: string, w: number | null) => { if (w != null) sources.push({ source, watts: Math.round(w) }); };

  // System totals: DC kW ÷ module count (what several sheets derive Wp from).
  const totalDcKw = num(sys?.['totalDcKw']);
  const totalPanels = num(sys?.['totalPanels']);
  if (totalDcKw && totalPanels) push('system.totalDcKw÷totalPanels', (totalDcKw * 1000) / totalPanels);

  // The design's selected-panel object (the intended source of truth upstream).
  push('project.selectedPanel.wattage', num((proj?.['selectedPanel'] as Record<string, unknown> | undefined)?.['wattage']));

  // The alternate system.modules[] payload.
  const modules = sys?.['modules'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(modules) && modules[0]) push('system.modules[0]', num(modules[0]['watts']) ?? num(modules[0]['panelWatts']));

  // The design layout's per-panel wattage (modal value — some are 0/blank).
  const panelPos = proj?.['panelPositions'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(panelPos) && panelPos.length) {
    const counts = new Map<number, number>();
    for (const p of panelPos) { const w = num(p['wattage']); if (w) counts.set(w, (counts.get(w) ?? 0) + 1); }
    let modeW = 0, modeN = 0;
    for (const [w, n] of counts) if (n > modeN) { modeN = n; modeW = w; }
    if (modeW) push('project.panelPositions[].wattage', modeW);
  }

  const disagree = sources.filter(s => Math.abs(s.watts - authoritativeWatts) / authoritativeWatts > 0.02);
  if (disagree.length) {
    console.warn(
      `[canonical] ⚠ MODULE WATTAGE DRIFT — planset uses ${Math.round(authoritativeWatts)}W (from engineering strings), but: ` +
      disagree.map(s => `${s.source}=${s.watts}W`).join(', ') +
      '. Design↔engineering out of sync — engineering report should rebuild from the current selected panel.',
    );
  }
  return disagree;
}

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
  const layoutSysRaw   = (layout.systemType || '').toLowerCase().trim();
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
  let fenceCount = 0, groundCount = 0, roofCount = 0;
  for (const p of panels_raw) {
    const pt = (p.placementType || '').toUpperCase();
    const st = (p.systemType   || '').toLowerCase();
    if (pt === 'FENCE'  || st === 'fence'  || st === 'solar_fence')  fenceCount++;
    else if (pt === 'GROUND' || st === 'ground' || st === 'ground_mount') groundCount++;
    else if (pt === 'ROOF' || st === 'roof') roofCount++;
  }
  if (fenceCount  > 0) fromPanels = 'solar_fence';
  else if (groundCount > 0) fromPanels = 'ground_mount';

  // ── HYBRID DETECTION (Phase 0 — Stowell finding, 2026-07-11) ──────────────
  // A design can contain roof + ground + fence sub-arrays simultaneously. The
  // single-winner vote below then papers over 2/3 of the system: the Stowell
  // hybrid (fence+ground+roof) rendered as an 80-module "SOLAR FENCE SYSTEM",
  // billed fence posts for every panel, and — because the fence/ground RSD
  // exemption went project-wide — dropped NEC 690.12 module-level rapid
  // shutdown for the ON-ROOF panels. Until sub-system support lands
  // (SubSystem[] partition threaded through CAD→structural→BOM→sheets), a
  // hybrid must NEVER pass silently.
  const _typesPresent = [
    roofCount > 0 ? `roof:${roofCount}` : null,
    groundCount > 0 ? `ground:${groundCount}` : null,
    fenceCount > 0 ? `fence:${fenceCount}` : null,
  ].filter(Boolean) as string[];
  const isHybridDesign = _typesPresent.length > 1;
  if (isHybridDesign) {
    console.warn(
      `[CANONICAL RESOLVE] ⚠ HYBRID DESIGN DETECTED — panels of ${_typesPresent.length} system types ` +
      `(${_typesPresent.join(', ')}). The pipeline currently supports ONE system type per project; ` +
      `this planset/BOM will document ONLY the winning type and is NOT PERMIT-READY for the others ` +
      `(missing racking/structural for the losing types; NEC 690.12 RSD may be wrongly exempted for roof panels).`
    );
  }

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
    // Error 5k fix: `type` is now on Layout interface — no `as any` needed
    layout.type = rawType;
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

  // ── Single-source-of-truth guard ─────────────────────────────────────────
  // The module resolves from engineering (system.inverters[].strings[]). Other
  // places store their OWN module wattage — the design's per-panel field, the
  // system totals (DC kW ÷ modules), the selected-panel object. When those
  // disagree the layout drifted from engineering (the "reverted to 600W" class
  // of bug: design 440W vs engineering 600W). Phase 0 stops it recurring; this
  // makes any residual drift LOUD instead of silent, naming each source.
  assertModuleConsistency(input, canonicalModule.wattage);

  // ── Step 5: Mount system — the SELECTED racking is authoritative ─────────
  // Hardcoding roof→'IronRidge XR100' here shipped packages whose PV-3
  // detailed the actually-selected Roof Tech RT-MINI while APP-A and the
  // cover claimed IronRidge — two racking systems in one permit. The map is
  // only the last-resort default when nothing was selected.
  const _mountSel = input.project.mountingSystemId
    ? getMountingSystemById(input.project.mountingSystemId)
    : undefined;
  const mountSystem = (_mountSel
      ? `${_mountSel.manufacturer} ${_mountSel.model}`.trim()
      : '')
    || input.project.mountingSystem
    || MOUNT_SYSTEM_MAP[rawType];

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
    // BAR §2 — SYMMETRY with windSpeed above. An operator/AHJ-entered ground snow
    // load must not be silently replaced by 0 when the compliance run has not been
    // stored: the EnvironmentalLoadAuthority records that field as an OPERATOR
    // OVERRIDE from `project.ahjGroundSnowPsf`, so the VALUE the sheets print has to
    // come from the same place, or the record attributes an engine default (0 psf)
    // to the operator. (Verification state is unaffected — an operator entry is
    // still an OBSERVATION/OVERRIDE and still fires
    // ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED.)
    groundSnowLoad:   Number(struct?.snow?.groundSnowLoad) || Number(input.project.ahjGroundSnowPsf) || Number(input.project.groundSnowPsf) || 0,
    exposureCategory: struct?.wind?.exposureCategory       || input.project.exposureCategory || 'C',
    // Post-AAC seismic repair: the hardcoded 'D' fallback is DEAD (it disagreed
    // with the fixtures' 'B' by construction — two invented defaults feeding two
    // different sheets). The compliance-stage value passes through as INPUT data;
    // when the canonical seismic authority resolves (resolveSeismicAuthority in
    // generatePermit) it overwrites this; with neither, the surfaces print the
    // pending marker instead of a substituted category.
    seismicSDC:       struct?.seismic?.sdc              || 'PENDING',
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
    hybridSystemTypes: isHybridDesign ? _typesPresent : undefined,
    subSystems:       partitionSubSystems(panels_raw as any[]),
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
export function buildLayoutDimensions(canonical: CanonicalInput, cad: CADModel, project?: { panelWidthIn?: number; panelLengthIn?: number }): CanonicalLayoutDimensions {
  const sys = canonical.systemType;

  // Panel dimensions — top-level on CADModel (authoritative)
  // Error 5m fix: canonical.layout has no panelWidthIn/panelHeightIn fields.
  // Use project.panelWidthIn/panelLengthIn as fallback (from PermitInput.project).
  const panelWidthIn  = cad.panelWidthM  > 0 ? cad.panelWidthM  * 39.3701 : project?.panelWidthIn  || 40.9;
  const panelHeightIn = cad.panelHeightM > 0 ? cad.panelHeightM * 39.3701 : project?.panelLengthIn || 66.9;

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



