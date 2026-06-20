// ═══════════════════════════════════════════════════════════════
// Permit HTML Generator — Orchestrator
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, CanonicalInput } from './types';
import type { CADModel } from '@/lib/cad/types';
import { PLANSET_ENGINE_VERSION } from './constants';
import { buildCanonical, validateCanonicalStrict, buildLayoutDimensions } from './utils/canonical';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import type { PermitInputShape } from '@/lib/drafting/permitInputShape';
import { buildRenderContext, type RenderContext } from '@/lib/drafting/renderContext';
import { buildDocumentProvenanceBundle } from '@/lib/documentProvenance';
import { buildEngineeringStateRegistry, buildInvalidationLineageMetadata, staleMetadataForState } from '@/lib/engineeringStateInvalidation';
import {
  buildDecisionAwareBOMMetadata,
  buildDecisionAwareReadinessSummary,
  buildDecisionAwareSLDMetadata,
  buildEngineeringDecisionProvenanceBundle,
} from '@/lib/engineeringDecisionProvenance';
import { deriveRunLengths } from '@/lib/bom/deriveRunLengths';
import { necNextStandardOcpd } from './utils/helpers';
import { runElectricalCalc, type ElectricalCalcInput, type InverterInput, type StringInput, type InterconnectionMethod } from '@/lib/electrical-calc';
import { getPanelById, getInverterById, getMicroinverterById } from '@/lib/equipment-db';
import type { ElectricalCompliance } from './types';

// Section imports
import { pageCoverSheet } from './sections/coverSheet';
import { pageSiteInformation } from './sections/sitePlan';
import { pageArrayPrimary, pageArrayGeometry } from './sections/arrayPages';
import { pageStructuralPrimary, pageStructural, pageEquipmentSchedule } from './sections/structuralPages';
import { pageNECCompliance, pageConductorSchedule, pageSingleLineDiagram } from './sections/electricalPages';
import { pageWarningLabels, pageSpecSheetReference } from './sections/compliancePages';
import { pageEngineerCert, pagePELetter } from './sections/certPages';
import { pageValidationSummary } from './sections/validationPage';
import { pageCADAppendixPreview } from './sections/cadAppendixPreviewPage';
// pageInterconnection removed from planset (v48.35) — ICA/PTO Roadmap moved to Permit tab UI in engineering page
import { generateBOMForPermit } from './utils/bomForPermit';

export function generatePermitHTML(input: PermitInput, storedSldSvg?: string): string {
  const { project } = input;

  // ── STEP 7: Canonical pipeline entry point ─────────────────────────────
  // buildCanonical() reads layout.type/panels/geometry as single source of truth.
  // It throws if layout is missing or invalid — no silent fallbacks.
  // After canonical is built, we inject canonical.systemType into input so the
  // CAD engine (which reads input.project.systemType) always gets the right type.
  const canonical = buildCanonical(input);
  // Inject canonical fields into input so CAD engine + sheet renderers read correctly
  input.project.systemType   = canonical.systemType;
  input.project._canonical   = canonical;  // Step 2: sheet renderers read canonical.* via input.project._canonical
  if (input.layout) input.layout.systemType = canonical.systemType;

  // Step 6: Panel consistency — canonical.panels vs CAD totalPanels
  // (checked after CAD runs below)

  // ── CAD ENGINE: Single source of truth ────────────────────────────────
  // Generate CADModel ONCE here. All page functions receive cad directly.
  // cad.systemType is authoritative — never use resolveSystemType() in pages.
  // Error 5s fix: use PermitInputShape (with index signatures) instead of `any`
  const cad = generateCADLayout(input as PermitInputShape);

  // Post-CAD sanitization: strip empty planes/rows/segments
  // The CAD solvers can emit empty geometry when setback-cleared or
  // constrained areas have no room for panels. validatePlanSet() (locked lib)
  // throws hard on these. Filter before validation — empty geometry has
  // nothing to render and would only produce blank sheets.
  if (cad.roof?.planes) {
    const before = cad.roof.planes.length;
    cad.roof.planes = cad.roof.planes.filter(
      (p: any) => p.panels && p.panels.length > 0
    );
    const removed = before - cad.roof.planes.length;
    if (removed > 0) {
      console.warn('[PLANSET] Filtered ' + removed + ' empty roof plane(s) (no panels after setback solve)');
    }
  }
  if (cad.ground?.arrays) {
    cad.ground.arrays = cad.ground.arrays.map((arr: any) => ({
      ...arr,
      rows: (arr.rows || []).filter((r: any) => r.panels && r.panels.length > 0),
    })).filter((arr: any) => arr.rows.length > 0);
  }
  if (cad.fence?.segments) {
    cad.fence.segments = cad.fence.segments.filter(
      (s: any) => isFinite(s.panelCount) && s.panelCount >= 1
    );
  }
  // Cross-contamination guard: strip stale fields from other system types.
  // The CAD engine may leave residual roof/ground/fence sub-models when
  // systemType changes between runs. validatePlanSet() (locked) throws on these.
  if (cad.systemType === 'solar_fence') {
    delete cad.roof;
    delete cad.ground;
  } else if (cad.systemType === 'ground_mount') {
    delete cad.roof;
    delete cad.fence;
  } else if (cad.systemType === 'roof') {
    delete cad.ground;
    delete cad.fence;
  }

  const sysType = cad.systemType;

  // Step 6: Panel consistency check
  if (canonical.panels.length !== cad.totalPanels) {
    console.warn('[CANONICAL] Panel count mismatch: layout.panels=', canonical.panels.length, 'vs cad.totalPanels=', cad.totalPanels, '— using CAD value');
  }

  // ── CAD patch: update canonical.structure with authoritative CAD geometry ──
  // buildCanonical() runs before CAD, so CAD values are patched in here.
  // Error 5e fix: all these fields exist on CanonicalStructure/CanonicalElectrical — no `as any` needed.
  if (cad.fence) {
    canonical.structure.postEmbedFt   = cad.fence.postEmbedM  ? cad.fence.postEmbedM  * 3.28084 : canonical.structure.postEmbedFt;
    canonical.structure.postSpacingFt = cad.fence.postSpacingM ? cad.fence.postSpacingM * 3.28084 : canonical.structure.postSpacingFt;
    canonical.structure.panelHeightFt = cad.fence.panelHeightM ? cad.fence.panelHeightM * 3.28084 : canonical.structure.panelHeightFt;
  }
  if (cad.ground?.arrays?.[0]) {
    const gArr = cad.ground.arrays[0];
    canonical.structure.pileDepthFt   = gArr.pileDepthM    ? gArr.pileDepthM    * 3.28084 : canonical.structure.pileDepthFt;
    canonical.structure.pileSpacingFt = gArr.pileSpacingM  ? gArr.pileSpacingM  * 3.28084 : canonical.structure.pileSpacingFt;
    canonical.structure.groundClearIn = gArr.groundClearanceM ? gArr.groundClearanceM * 39.3701 : canonical.structure.groundClearIn;
    canonical.structure.tiltDeg       = gArr.tiltDeg ?? canonical.structure.tiltDeg;
  }
  // electrical.totalPanels / totalDcKw from CAD (authoritative)
  canonical.electrical.totalPanels = cad.totalPanels || canonical.electrical.totalPanels;
  canonical.electrical.totalDcKw   = cad.totalDcKw   || canonical.electrical.totalDcKw;

  // ── Error 5aa fix: Propagate CAD-derived system values to input.system & input.project ──
  // Before this fix, the permit route initialized system.totalAcKw/totalDcKw to 0 and
  // never updated them after CAD computation. electricalPages.ts and sldAdapter.ts read
  // system.totalAcKw (always 0) and project.backfeedBreakerA (never set), falling back
  // to hardcoded defaults (acOCPD=40, backfeedAmps=46, batteryKwh=0).
  // Now: propagate authoritative CAD + equipment values to system/project level.
  {
    // totalPanels and totalDcKw from CAD (authoritative source)
    if (cad.totalPanels > 0) {
      input.system.totalPanels = cad.totalPanels;
    }
    if (cad.totalDcKw > 0) {
      input.system.totalDcKw = cad.totalDcKw;
    }

    // totalAcKw: compute from inverter specs (micro: panels * per-micro kW; string: inverter kW)
    // Prefer explicit inverter data from system.inverters[], fall back to equipment context.
    const inv0 = input.system.inverters?.[0];
    const isMicro = (input.system.topology || '').toLowerCase().includes('micro')
      || (inv0?.type || '').toLowerCase().includes('micro');
    if (isMicro && inv0?.acOutputKw && cad.totalPanels > 0) {
      // Microinverter: totalAcKw = panels * per-micro AC output
      input.system.totalAcKw = cad.totalPanels * inv0.acOutputKw;
    } else if (inv0?.acOutputKw && input.system.totalAcKw === 0) {
      // String inverter(s): SUM each inverter's own AC output — do not scale
      // inverters[0] by the count (wrong for a mixed-size inverter array, e.g.
      // 7.6kW + 3.8kW = 11.4kW, not 7.6×2).
      const summed = input.system.inverters.reduce(
        (sum, inv) => sum + (inv?.acOutputKw || 0), 0,
      );
      input.system.totalAcKw = summed > 0 ? summed : inv0.acOutputKw;
    } else if (input.system.totalAcKw === 0 && cad.totalDcKw > 0) {
      // Last resort: estimate AC from DC with typical 1.2 DC/AC ratio
      input.system.totalAcKw = cad.totalDcKw / 1.2;
    }

    // DC/AC ratio
    if (input.system.totalAcKw > 0) {
      input.system.dcAcRatio = input.system.totalDcKw / input.system.totalAcKw;
    }

    // backfeedBreakerA / pvBackfeedA: NEC 690.8 sizing
    // acOCPD = next standard breaker >= (acOutputAmps * 1.25)
    // acOutputAmps = totalAcKw * 1000 / 240
    if (!project.backfeedBreakerA && input.system.totalAcKw > 0) {
      const acOutputAmps = (input.system.totalAcKw * 1000) / 240;
      const continuousA = acOutputAmps * 1.25; // NEC 690.8
      const ocpd = necNextStandardOcpd(continuousA);
      project.backfeedBreakerA = ocpd;
      if (!project.pvBackfeedA) {
        project.pvBackfeedA = ocpd;
      }
    }

    // Battery fields: propagate batteryKwh and batteryBackfeedA if battery info exists
    // in project (set by the route from frontend data). Do NOT fabricate battery data.
    // The electrical pages compute batteryKwh = batteryCount * batteryKwh per unit,
    // so both fields must be populated together if battery is present.
    if (project.batteryCount && project.batteryCount > 0 && project.batteryKwh && project.batteryKwh > 0) {
      // Already populated — nothing to do
    } else if (project.batteryCount && project.batteryCount > 0 && !project.batteryKwh) {
      // batteryCount is set but batteryKwh per unit is missing — default per unit
      // Most common residential battery (e.g. Enphase IQ Battery 5P) is ~5 kWh
      project.batteryKwh = 5.0;
    }
    // batteryBackfeedA: if battery exists but backfeed not set, compute from battery spec
    // Typical Enphase IQ Battery 5P backfeed: 20A per unit
    if (project.batteryCount && project.batteryCount > 0 && !project.batteryBackfeedA) {
      const backfeedPerUnit = 20; // A — typical for residential AC-coupled battery
      project.batteryBackfeedA = backfeedPerUnit * project.batteryCount;
    }
  }

  // ── Derive wire run lengths from CAD geometry ─────────────────────────────────
  // Inject into input.project.wireLength (AC run) and per-string wireLength (DC run)
  // only when the caller has not already provided a value (non-zero).
  // This is additive/non-breaking: existing explicit values are always preserved.
  try {
    const { runLengths, derivationNotes } = deriveRunLengths(cad);
    // AC run: DISCO_TO_METER_RUN → project.wireLength
    const acRunFt = runLengths.DISCO_TO_METER_RUN;
    if (acRunFt && acRunFt > 0 && !input.project.wireLength) {
      input.project.wireLength = acRunFt;
      console.log('[CAD-RUN] Derived AC wire run:', acRunFt, 'ft —', derivationNotes.DISCO_TO_METER_RUN);
    }
    // DC run: DC_STRING_RUN → each string's wireLength (if not already set)
    const dcRunFt = runLengths.DC_STRING_RUN;
    if (dcRunFt && dcRunFt > 0 && input.system?.inverters) {
      for (const inv of input.system.inverters) {
        if (inv.strings) {
          for (const str of inv.strings) {
            if (!str.wireLength) {
              str.wireLength = dcRunFt;
            }
          }
        }
      }
      console.log('[CAD-RUN] Derived DC string run:', dcRunFt, 'ft —', derivationNotes.DC_STRING_RUN);
    }
  } catch (runErr) {
    // Non-critical: run length derivation failures should never block permit generation
    console.warn('[CAD-RUN] deriveRunLengths failed (non-critical):', runErr);
  }

  // ── Wind speed: apply project fallback if compliance not yet run ─────────────────
  // Error 5t fix: propagate seismicCategory from canonical.site to project level
  // so coverSheet.ts can read project.seismicCategory
  if (canonical.site.seismicSDC && !input.project.seismicCategory) {
    input.project.seismicCategory = canonical.site.seismicSDC;
  }
  // Error 5t fix: propagate wind speed + ground snow to project bare fields
  // as fallbacks for coverSheet.ts which reads project.windSpeedMph / project.groundSnowPsf
  if (canonical.site.windSpeed > 0 && !input.project.windSpeedMph && !input.project.ahjWindSpeedMph) {
    input.project.windSpeedMph = canonical.site.windSpeed;
  }
  if (canonical.site.groundSnowLoad > 0 && !input.project.groundSnowPsf && !input.project.ahjGroundSnowPsf) {
    input.project.groundSnowPsf = canonical.site.groundSnowLoad;
  }

  if (!canonical.site.windSpeed || canonical.site.windSpeed <= 0) {
    const projV = Number(input.project.ahjWindSpeedMph) || Number(input.project.windSpeedMph) || 0;
    if (projV > 0) {
      canonical.site.windSpeed = projV;
      console.log('[CANONICAL] Wind speed from project fields:', projV, 'mph');
    } else {
      canonical.site.windSpeed = 115;  // ASCE 7-22 code minimum
      console.warn('[CANONICAL] Wind speed defaulted to 115 mph — run Compliance Check for AHJ value');
    }
  }

  // ── Build layout dimensions from CAD (REQUIRED before validation gate) ──────────
  try {
    canonical.layoutDimensions = buildLayoutDimensions(canonical, cad, input.project);
    console.log('[CANONICAL] Layout dimensions resolved:', {
      system:        canonical.systemType,
      totalLengthFt: canonical.layoutDimensions!.totalLengthFt.toFixed(1),
      totalHeightFt: canonical.layoutDimensions!.totalHeightFt.toFixed(1),
      panelWidthIn:  canonical.layoutDimensions!.panelWidthIn,
      panelHeightIn: canonical.layoutDimensions!.panelHeightIn,
      source:        canonical.layoutDimensions!.source,
    });
  } catch (dimErr) {
    throw new Error(`[PLANSET BLOCKED] Dimension extraction failed: ${(dimErr as Error).message}`);
  }

  // ── HARD VALIDATION GATE — throws on any missing engineering field ─────────────
  validateCanonicalStrict(canonical);

  // ── Server-side structural calculation (Error 3d fix) ──────────────
  // When compliance.structural.rafter has zero/missing bending moment, the
  // frontend's structural V4 API was never called before permit generation.
  // Run the V4 engine server-side so the structural page always shows real
  // calculated values instead of "0 ft-lbs".
  try {
    const existingRafter = input.compliance?.structural?.rafter;
    const needsCalc = !existingRafter
      || (existingRafter.bendingMoment == null || existingRafter.bendingMoment === 0);
    if (needsCalc && sysType === 'roof') {
      const { runStructuralCalcV4 } = require('@/lib/structural-engine-v4');
      const roofPitchDeg = cad.roof?.planes?.[0]?.pitch ?? input.project.roofPitch ?? 20;
      const windSpeed    = canonical.site.windSpeed || 115;
      const groundSnow   = canonical.site.groundSnowLoad || 0;
      const rafterSize   = input.project.rafterSize || '2x6';
      const rafterSpIn   = input.project.rafterSpacing || 24;
      const rafterSpFt   = input.project.rafterSpan || 12;
      const framingType  = input.project.framingType || 'rafter';
      const totalPanels  = input.system?.totalPanels || cad.totalPanels || 1;
      const structInput = {
        installationType: 'residential_pitched',
        windSpeed,
        windExposure: canonical.site.exposureCategory || 'C',
        groundSnowLoad: groundSnow,
        meanRoofHeight: 15,
        roofPitch: roofPitchDeg,
        framingType: framingType === 'truss' ? 'truss' : 'rafter',
        rafterSize,
        rafterSpacingIn: rafterSpIn,
        rafterSpanFt: rafterSpFt,
        // Normalize to the WoodSpecies enum ('Douglas Fir-Larch' | 'Southern Pine'
        // | 'Hem-Fir' | 'Spruce-Pine-Fir'). The old default 'douglas_fir_larch'
        // (and any lowercase/underscored UI value) matched no NDS_FB/FV/E key, so
        // the engine silently used generic Fb 1000 psi for EVERY project. (Audit
        // structural finding 3.)
        woodSpecies: ((): 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir' => {
          const k = (input.project.rafterSpecies ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
          if (k.startsWith('southern')) return 'Southern Pine';
          if (k.startsWith('hem')) return 'Hem-Fir';
          if (k.startsWith('spruce') || k === 'spf') return 'Spruce-Pine-Fir';
          return 'Douglas Fir-Larch';
        })(),
        panelCount: totalPanels,
        panelLengthIn: input.project.panelLengthIn || 65,
        panelWidthIn: input.project.panelWidthIn || 40,
        panelWeightLbs: input.project.panelWeightLbs || 50,
        panelOrientation: 'portrait' as const,
        mountingSystemId: input.project.mountingSystemId || 'ironridge-xr100',
        rackingWeightPerPanelLbs: 4,
      };
      const structResult = runStructuralCalcV4(structInput);
      const ra = structResult.rafterAnalysis;
      const wa = structResult.windAnalysis;
      const sa = structResult.snowAnalysis;
      const ml = structResult.mountLayout;
      // Map V4 result → compliance.structural (same shape as frontend mapping in page.tsx)
      if (!input.compliance) input.compliance = { overallStatus: '' } as PermitInput['compliance'];
      const s = input.compliance.structural || {};
      s.wind = s.wind || {};
      if (!s.wind.windSpeed)            s.wind.windSpeed = wa.designWindSpeedMph;
      if (!s.wind.exposureCategory)     s.wind.exposureCategory = structInput.windExposure;
      // Error 5t fix: propagate exposure category to project level for coverSheet.ts
      if (!input.project.windExposure)   input.project.windExposure = structInput.windExposure;
      if (!s.wind.velocityPressure)     s.wind.velocityPressure = wa.velocityPressurePsf;
      if (!s.wind.netUpliftPressure)    s.wind.netUpliftPressure = wa.netUpliftPressurePsf;
      if (!s.wind.upliftPerAttachment)  s.wind.upliftPerAttachment = ml?.upliftPerMountLbs;
      s.snow = s.snow || {};
      if (!s.snow.groundSnowLoad)       s.snow.groundSnowLoad = sa.groundSnowLoadPsf;
      if (!s.snow.roofSnowLoad)         s.snow.roofSnowLoad = sa.roofSnowLoadPsf;
      s.rafter = {
        rafterSize:             ra.size,
        rafterSpacing:          ra.spacingIn,
        rafterSpan:             ra.spanFt,
        bendingMoment:          ra.bendingMomentDemandFtLbs,
        allowableBendingMoment: ra.bendingMomentCapacityFtLbs,
        utilizationRatio:       ra.overallUtilization,
        deflection:             ra.deflectionIn,
        allowableDeflection:    ra.allowableDeflectionIn,
        Fb_base:                1150,
        Cd: 1.15, Cr: 1.15,
        Fb_prime:               1150 * 1.15 * 1.15,
        totalLoadPsf:           ra.totalLoadPsf,
        lineLoad:               ra.totalLoadPsf * (ra.spacingIn / 12),
      };
      s.attachment = s.attachment || {};
      if (!s.attachment.safetyFactor)         s.attachment.safetyFactor = ml?.safetyFactor;
      if (!s.attachment.lagBoltCapacity)       s.attachment.lagBoltCapacity = ml?.upliftPerMountLbs ? ml.upliftPerMountLbs * (ml.safetyFactor || 2) : undefined;
      if (!s.attachment.maxAllowedSpacing)     s.attachment.maxAllowedSpacing = ml?.mountSpacingIn;
      if (!s.attachment.totalUpliftPerAttachment) s.attachment.totalUpliftPerAttachment = ml?.upliftPerMountLbs;
      if (!s.totalDeadLoadPsf)   s.totalDeadLoadPsf = ra.pvDeadLoadPsf + ra.roofDeadLoadPsf;
      if (!s.moduleLoadPsf)      s.moduleLoadPsf = ra.pvDeadLoadPsf;
      if (!s.rackingLoadPsf)     s.rackingLoadPsf = ra.pvDeadLoadPsf > 0 ? ra.pvDeadLoadPsf * 0.15 : 0.5;
      input.compliance.structural = s;
      console.log('[PLANSET] Server-side structural V4 computed rafter bending:', ra.bendingMomentDemandFtLbs?.toFixed(0), 'ft-lbs / capacity:', ra.bendingMomentCapacityFtLbs?.toFixed(0), 'ft-lbs');
    }
  } catch (structErr: unknown) {
    // Non-critical: permit still generates, structural page will show defaults
    console.warn('[PLANSET] Server-side structural V4 failed (non-critical):', (structErr as Error)?.message ?? structErr);
  }


  // ── Server-side electrical calculation (Error 7d fix) ────────────────────────
  // When compliance.electrical is empty or missing key computed fields, the
  // frontend's electrical calculation API was never called before permit generation.
  // Run the electrical engine server-side so permit pages always show real
  // calculated values (busbar rule, conduit fill, wire sizing, OCPD, etc.)
  // instead of "—" placeholders.
  try {
    const existingElec = input.compliance?.electrical;
    const needsElecCalc = !existingElec
      || (existingElec.busbar == null && existingElec.acConductorCallout == null);
    if (needsElecCalc && input.system?.inverters?.length) {
      const { runElectricalCalc: _runElec } = require('@/lib/electrical-calc');
      const { getPanelById: _getPanelById } = require('@/lib/equipment-db');
      const { getInverterById: _getInvById } = require('@/lib/equipment-db');
      const { getMicroinverterById: _getMicroById } = require('@/lib/equipment-db');

      // ── Build InverterInput[] from system.inverters + equipment-db backfill ──
      const invInputs: InverterInput[] = input.system.inverters.map((inv, invIdx) => {
        // Resolve full inverter spec from equipment DB if model matches
        let invSpec: any = null;
        if (inv.type === 'micro') {
          invSpec = _getMicroById(inv.model) || _getMicroById(inv.model?.toLowerCase());
        } else {
          invSpec = _getInvById(inv.model) || _getInvById(inv.model?.toLowerCase());
        }

        // Determine inverter type for electrical-calc
        const invType: 'string' | 'micro' | 'optimizer' =
          inv.type === 'micro' ? 'micro'
            : inv.type === 'optimizer' ? 'optimizer'
            : 'string';

        // Build StringInput[] — backfill missing panel specs from equipment DB
        const stringInputs: StringInput[] = (inv.strings || []).map((str) => {
          // Try to resolve panel spec from equipment DB
          const panelSpec = _getPanelById(str.panelModel)
            || _getPanelById(str.panelModel?.toLowerCase().replace(/\s+/g, '-'));

          // Fallback: try project-level panel model/manufacturer fields
          const projPanelModel = input.project.panelModel || input.project.moduleModel;
          const projPanel = projPanelModel
            ? (_getPanelById(projPanelModel) || _getPanelById(projPanelModel.toLowerCase().replace(/\s+/g, '-')))
            : null;

          const db = panelSpec || projPanel;

          return {
            panelCount:   str.panelCount || 0,
            panelVoc:     str.panelVoc   || db?.voc   || 0,
            panelIsc:     str.panelIsc   || db?.isc   || str.isc || 0,
            panelImp:     db?.imp        || 0,
            panelVmp:     db?.vmp        || 0,
            panelWatts:   str.panelWatts || db?.watts || 0,
            tempCoeffVoc: db?.tempCoeffVoc  ?? -0.27,   // %/°C — common default for silicon
            tempCoeffIsc: db?.tempCoeffIsc  ?? 0.05,     // %/°C — common default
            maxSeriesFuseRating: db?.maxSeriesFuseRating ?? 20, // A — common default
            wireGauge:    str.wireGauge  || input.project.wireGauge || '#12 AWG',
            wireLength:   str.wireLength || input.project.wireLength || 50,
            conduitType:  input.project.conduitType || 'EMT',
          };
        });

        // For microinverters: create a synthetic single "string" per device
        // if no strings are provided (typical for micro topology)
        if (invType === 'micro' && stringInputs.length === 0) {
          const panelSpec = _getPanelById(
            input.system.modules?.[0]?.panelModel || input.system.modules?.[0]?.model || ''
          );
          const microSpec = invSpec;
          stringInputs.push({
            panelCount:   microSpec?.modulesPerDevice || 1,
            panelVoc:     panelSpec?.voc  || input.project.panelVoc || 0,
            panelIsc:     panelSpec?.isc  || input.project.panelIsc || 0,
            panelImp:     panelSpec?.imp  || 0,
            panelVmp:     panelSpec?.vmp  || 0,
            panelWatts:   panelSpec?.watts || input.system.modules?.[0]?.panelWatts || 0,
            tempCoeffVoc: panelSpec?.tempCoeffVoc ?? -0.27,
            tempCoeffIsc: panelSpec?.tempCoeffIsc ?? 0.05,
            maxSeriesFuseRating: panelSpec?.maxSeriesFuseRating ?? 20,
            wireGauge:    input.project.wireGauge || '#12 AWG',
            wireLength:   input.project.wireLength || 50,
            conduitType:  input.project.conduitType || 'EMT',
          });
        }

        return {
          type:              invType,
          acOutputKw:        inv.acOutputKw || invSpec?.acOutputKw || 0,
          maxDcVoltage:      inv.maxDcVoltage || invSpec?.maxDcVoltage || 600,
          mpptVoltageMin:    invSpec?.mpptVoltageMin || 0,
          mpptVoltageMax:    invSpec?.mpptVoltageMax || invSpec?.mpptVoltageMax || 0,
          maxInputCurrentPerMppt: invSpec?.maxInputCurrentPerMppt || invSpec?.maxInputCurrent || 0,
          acOutputCurrentMax: invSpec?.acOutputCurrentMax || 0,
          strings:           stringInputs,
          modulesPerDevice:  invSpec?.modulesPerDevice,
          deviceCount:       inv.type === 'micro'
            ? Math.ceil((input.system.totalPanels || 1) / (invSpec?.modulesPerDevice || 1))
            : undefined,
          integratedDcDisconnect: invSpec?.integratedDcDisconnect,
        } as InverterInput;
      });

      // ── Determine NEC version from jurisdiction or AHJ ──
      const _rawNec = input.compliance?.jurisdiction?.necVersion ?? '';
      const necVersion: '2017' | '2020' | '2023' =
        _rawNec === '2017' ? '2017'
          : _rawNec === '2023' ? '2023'
          : '2020';

      // ── Determine interconnection method ──
      const interconnMethod = input.project.interconnectionMethod || 'LOAD_SIDE';
      const panelBusRating = input.project.panelBusRating || input.project.mainPanelAmps || 200;

      // ── Build the full ElectricalCalcInput ──
      const electricalInput: ElectricalCalcInput = {
        inverters:          invInputs,
        mainPanelAmps:      input.project.mainPanelAmps || 200,
        systemVoltage:      240,
        designTempMin:      input.project.designTempMin ?? -10,
        designTempMax:      35,   // °C — typical ASHRAE 2% design temp
        rooftopTempAdder:   35,   // °C — NEC 310.15(A)(3) rooftop adder
        wireGauge:          input.project.wireGauge || '#10 AWG',
        wireLength:         input.project.wireLength || 50,
        conduitType:        input.project.conduitType || 'EMT',
        rapidShutdown:      input.project.rapidShutdown ?? false,
        acDisconnect:       input.project.acDisconnect ?? false,
        dcDisconnect:       input.project.dcDisconnect ?? false,
        necVersion,
        interconnection: {
          method: (interconnMethod === 'SUPPLY_SIDE_TAP' ? 'SUPPLY_SIDE_TAP'
                  : interconnMethod === 'MAIN_BREAKER_DERATE' ? 'MAIN_BREAKER_DERATE'
                  : interconnMethod === 'PANEL_UPGRADE' ? 'PANEL_UPGRADE'
                  : 'LOAD_SIDE') as InterconnectionMethod,
          busRating:   panelBusRating,
          mainBreaker: input.project.mainPanelAmps || panelBusRating,
        },
        // Battery fields
        batteryBackfeedA:        input.project.batteryBackfeedA ?? 0,
        batteryCount:            input.project.batteryCount ?? 0,
        batteryContinuousOutputA: 0,
        batteryModel:            input.project.batteryModel,
        batteryManufacturer:     input.project.batteryBrand,
        // Generator fields
        generatorKw:             input.project.generatorKw,
      };

      const elecResult = _runElec(electricalInput);

      // ── Map ElectricalCalcResult → ElectricalCompliance ──
      if (!input.compliance) input.compliance = { overallStatus: '' } as PermitInput['compliance'];
      const e: ElectricalCompliance = {};
      e.status = elecResult.status;
      e.acConductorCallout = elecResult.acConductorCallout || elecResult.acWireGauge;
      e.acWireGauge = elecResult.acWireGauge;
      e.acWireAmpacity = elecResult.acWireAmpacity;
      e.acVoltageDrop = elecResult.acVoltageDrop;
      e.groundingConductor = elecResult.groundingConductor;
      e.rapidShutdownCompliant = elecResult.rapidShutdownCompliant;

      // Busbar
      if (elecResult.busbar) {
        e.busbar = {
          backfeedBreakerRequired: elecResult.busbar.backfeedBreakerRequired,
          passes:                  elecResult.busbar.passes,
          busbarRule:              elecResult.busbar.busbarRule,
          busRating:               elecResult.busbar.mainPanelAmps,
          mainBreaker:             electricalInput.interconnection?.mainBreaker,
          solarBreakerRequired:    elecResult.busbar.backfeedBreakerRequired,
          maxAllowedSolarBreaker:  elecResult.busbar.maxAllowedBackfeed,
          method:                  elecResult.busbar.busbarRule === 'supply-side' ? 'Supply-Side Tap (NEC 705.11)' : 'Load-Side Connection (NEC 705.12(B))',
          necReference:            elecResult.busbar.busbarRule === 'supply-side' ? 'NEC 705.11' : 'NEC 705.12(B)',
          message:                 elecResult.busbar.passes ? 'Busbar rule satisfied' : 'Busbar rule NOT satisfied — review required',
        };
      }

      // Conduit fill
      if (elecResult.conduitFill) {
        e.conduitFill = {
          conduitType:  elecResult.conduitFill.conduitType,
          conduitSize:  elecResult.conduitFill.conduitSize,
          fillPercent:   elecResult.conduitFill.fillPercent,
          passes:       elecResult.conduitFill.passes,
        };
      }

      // Interconnection
      if (elecResult.interconnection) {
        e.interconnection = {
          method:                 elecResult.interconnection.method,
          methodLabel:            elecResult.interconnection.methodLabel,
          busRating:              elecResult.interconnection.busRating,
          mainBreaker:            elecResult.interconnection.mainBreaker,
          solarBreakerRequired:   elecResult.interconnection.solarBreakerRequired,
          maxAllowedSolarBreaker: elecResult.interconnection.maxAllowedSolarBreaker,
          passes:                 elecResult.interconnection.passes,
          necReference:           elecResult.interconnection.necReference,
          message:                elecResult.interconnection.message,
        };
      }

      // AC Sizing
      if (elecResult.acSizing) {
        e.acSizing = {
          ocpdAmps:          elecResult.acSizing.ocpdAmps,
          disconnectAmps:    elecResult.acSizing.disconnectAmps,
          disconnectType:    elecResult.acSizing.disconnectType,
          conductorGauge:    elecResult.acSizing.conductorGauge,
          conductorAmpacity: elecResult.acSizing.conductorAmpacity,
          conduitSize:       elecResult.acSizing.conduitSize,
          conduitFillPct:    elecResult.acSizing.conduitFillPct,
          groundingConductor: elecResult.acSizing.groundingConductor,
        };
      }

      // Inverters (per-inverter results with string details)
      if (elecResult.inverters?.length) {
        e.inverters = elecResult.inverters.map((invR: any, idx: number) => ({
          inverterId:         invR.inverterId ?? idx,
          type:               invR.type,
          acOutputKw:         invR.acOutputKw,
          acOutputCurrentMax: invR.acOutputCurrentMax,
          strings: (invR.strings || []).map((strR: any) => ({
            stringId:      strR.stringId,
            panelCount:    strR.panelCount,
            vocSTC:        strR.vocSTC,
            vocCorrected:  strR.vocCorrected,
            iscSTC:        strR.iscSTC,
            iscCorrected:  strR.iscCorrected,
            maxCurrentNEC: strR.maxCurrentNEC,
            ocpdRating:    strR.ocpdRating,
            wireGauge:     strR.wireGauge,
            wireAmpacity:  strR.wireAmpacity,
            voltageDrop:   strR.voltageDrop,
          })),
          acWireResult: invR.acWireResult ? {
            selectedGauge:    invR.acWireResult.selectedGauge,
            effectiveAmpacity: invR.acWireResult.effectiveAmpacity,
            voltageDrop:      invR.acWireResult.voltageDrop,
            conductorCallout: invR.acWireResult.conductorCallout,
            wasAutoSized:     invR.acWireResult.wasAutoSized,
            overallPass:      invR.acWireResult.overallPass,
          } : undefined,
        }));
        // DC conductor callout: use first string's wire gauge
        const firstStr = elecResult.inverters[0]?.strings?.[0];
        if (firstStr?.wireGauge) {
          e.dcConductorCallout = firstStr.wireGauge;
        }
      }

      // Summary
      if (elecResult.summary) {
        e.summary = {
          totalDcKw:  elecResult.summary.totalDcKw,
          totalAcKw:  elecResult.summary.totalAcKw,
          dcAcRatio:  elecResult.summary.dcAcRatio,
        };
      }

      input.compliance.electrical = e;

      // ── Propagate key values to project level for downstream consumers ──
      if (e.busbar?.backfeedBreakerRequired && !input.project.backfeedBreakerA) {
        input.project.backfeedBreakerA = e.busbar.backfeedBreakerRequired;
      }
      if (e.busbar?.backfeedBreakerRequired && !input.project.pvBackfeedA) {
        input.project.pvBackfeedA = e.busbar.backfeedBreakerRequired;
      }

      console.log('[PLANSET] Server-side electrical calc completed:',
        'status=', elecResult.status,
        '| busbar=', elecResult.busbar?.passes ? 'PASS' : 'FAIL',
        '| backfeedA=', elecResult.busbar?.backfeedBreakerRequired,
        '| acWire=', elecResult.acConductorCallout,
        '| vDrop=', elecResult.acVoltageDrop?.toFixed(2) + '%');
    }
  } catch (elecErr: unknown) {
    // Non-critical: permit still generates, electrical pages will show defaults
    console.warn('[PLANSET] Server-side electrical calc failed (non-critical):', (elecErr as Error)?.message ?? elecErr);
  }

  console.log('[PLANSET] CAD engine resolved systemType:', sysType, {
    totalPanels:  cad.totalPanels,
    totalDcKw:    cad.totalDcKw.toFixed(2),
    warnings:     cad.warnings,
    solveMs:      cad.solveMs,
  });

  if (!sysType) { throw new Error('[PLANSET] CAD engine did not resolve system type'); }

  // ── STEP 1: Build RenderContext (Unified Rendering Pipeline) ────────────
  // Assembles systemType + CAD + billInsights + engineering into one object.
  // ctx is optional — all templates render normally when ctx is null/absent.
  const utilityOpts = input.utility;
  const provenanceDocumentId = `permit:${project.projectId ?? project.projectName ?? 'unknown'}`;
  const decisionProvenance = buildEngineeringDecisionProvenanceBundle({
    bundleId: `${provenanceDocumentId}.decision-provenance`,
    generatedAt: input.surveyEvidence?.source.normalizedAt,
    surveyEvidence: input.surveyEvidence ?? null,
    documentProvenance: input.documentProvenance ?? input.surveyEvidence?.documentProvenance ?? null,
    cad,
    permitInput: input,
    renderContextIds: ['renderContext:primary'],
    includeDocumentMetadataDecisions: true,
  });
  input.decisionProvenance = decisionProvenance;
  input.decisionAwareReadinessSummary = buildDecisionAwareReadinessSummary(decisionProvenance);

  const documentProvenance = input.surveyEvidence
    ? buildDocumentProvenanceBundle({
        documentId: provenanceDocumentId,
        documentType: 'permit_package',
        surveyEvidence: input.surveyEvidence,
        cad,
        permitInput: input,
        decisionProvenance,
        generatedAt: input.surveyEvidence.source.normalizedAt,
        renderInputs: {
          inputKeys: ['PermitInput', 'EngineeringSurveyEvidence', 'EngineeringDecisionProvenance'],
          canonicalInputKeys: ['CanonicalInput', 'SurveyEvidenceManifest', 'EngineeringRequirementEvaluationSummary'],
          cadPrimitiveIds: [`cad:${cad.systemType}:model`],
          legacyFallbackKeys: [],
        },
      })
    : undefined;
  if (documentProvenance) {
    input.documentProvenance = documentProvenance;
  }


  // ── BOM Integration (v48.x) ─────────────────────────────────────────────
  // generateBOMForPermit() merges V4 electrical BOM + structural BOM.
  // Result is injected into input.bom so pageEquipmentSchedule() renders
  // real part numbers, NEC references, and structural items.
  // Non-blocking: if BOM generation fails, permit still renders with empty bom[].
  try {
    const generatedBOM = generateBOMForPermit(input, cad);
    if (generatedBOM.length > 0) {
      input.bom = generatedBOM;
    }
    input.decisionAwareBOMMetadata = buildDecisionAwareBOMMetadata({
      bomItems: input.bom ?? generatedBOM,
      decisionBundle: decisionProvenance,
    });
  } catch (bomErr: unknown) {
    console.warn('[generatePermitHTML] BOM generation failed (non-critical):', (bomErr as Error)?.message ?? bomErr);
  }
  if (!input.decisionAwareBOMMetadata) {
    input.decisionAwareBOMMetadata = buildDecisionAwareBOMMetadata({
      bomItems: input.bom ?? [],
      decisionBundle: decisionProvenance,
    });
  }

  input.decisionAwareSLDMetadata = buildDecisionAwareSLDMetadata({ decisionBundle: decisionProvenance });

  const engineeringStateRegistry = buildEngineeringStateRegistry({
    registryId: `${provenanceDocumentId}.engineering-state`,
    generatedAt: input.surveyEvidence?.source.normalizedAt,
    documentProvenance: documentProvenance ?? null,
    decisionProvenance,
    dependencyGraph: documentProvenance?.dependencyGraph ?? null,
    renderContextIds: ['renderContext:primary'],
    bomMetadata: input.decisionAwareBOMMetadata ?? [],
    sldMetadata: input.decisionAwareSLDMetadata ?? null,
  });
  const invalidationLineage = buildInvalidationLineageMetadata({ registry: engineeringStateRegistry });
  input.engineeringStateRegistry = engineeringStateRegistry;
  input.invalidationLineage = invalidationLineage;
  if (documentProvenance) {
    documentProvenance.engineeringStateRegistry = engineeringStateRegistry;
    documentProvenance.invalidationLineage = invalidationLineage;
  }

  const renderCtx = buildRenderContext(cad, {
    electricityRate: utilityOpts?.electricityRate,
    rateSource:      utilityOpts?.rateSource,
    utilityName:     utilityOpts?.utilityName ?? input.project.utilityName ?? null,
    monthlyKwh:      utilityOpts?.monthlyKwh,
    annualKwh:       utilityOpts?.annualKwh,
    billInsights:    utilityOpts?.billInsights ?? null,
    documentProvenance: documentProvenance ?? null,
    decisionProvenance,
    engineeringStateRegistry,
    invalidationLineage,
    staleStateMetadata: staleMetadataForState(engineeringStateRegistry.stateRecords.find((record: any) => record.stateId === 'state:renderContext:renderContext:primary') ?? engineeringStateRegistry.stateRecords[0]),
  });

  const includeCADAppendixPreview = input.cadAppendixPreviewV1 === true
    || input.planSetOptions?.cadAppendixPreviewV1 === true
    || input.permitOptions?.cadAppendixPreviewV1 === true;
  const TOTAL = includeCADAppendixPreview ? 16 : 15;

  // Dynamic page assembly — CADModel + RenderContext passed to ALL page functions
  const pages = [
    pageCoverSheet(input, cad, 1, TOTAL),                              // PV-0: Cover (all systems)
    pageSiteInformation(input, cad, 2, TOTAL),                         // PV-1: Site Plan (all systems)
    pageArrayPrimary(input, cad, 3, TOTAL, renderCtx),                 // PV-2: Roof / Ground / Fence (cad.systemType)
    pageArrayGeometry(input, cad, 4, TOTAL),                           // PV-2B: Array geometry (system-aware)
    pageStructuralPrimary(input, cad, 5, TOTAL, renderCtx),            // PV-3: Structural (cad.systemType)
    pageNECCompliance(input, cad, 6, TOTAL),                      // PV-4A: NEC (all)
    pageConductorSchedule(input, cad, 7, TOTAL),                  // PV-4B: Conductor (system-aware)
    pageStructural(input, cad, 8, TOTAL),                         // PV-4C: Structural calcs (system-aware)
    pageWarningLabels(input, cad, 9, TOTAL),                      // PV-5: Labels (system-aware)
    pageEquipmentSchedule(input, cad, 10, TOTAL),                 // SCHED (all)
    pageSpecSheetReference(input, cad, 11, TOTAL),                // APP-A (all)
    pageEngineerCert(input, cad, 12, TOTAL),                      // CERT (all)
    pagePELetter(input, cad, 13, TOTAL),                          // PE-1 (all)
    pageSingleLineDiagram(input, cad, 14, TOTAL, storedSldSvg),   // E-1: SLD (all, system-labeled)
    pageValidationSummary(input, canonical, cad, 15, TOTAL),      // VAL-1: Validation summary (engineering authority)
  ];

  if (includeCADAppendixPreview) {
    try {
      pages.push(pageCADAppendixPreview(input, cad, 16, TOTAL));       // APP-CAD: non-authoritative CAD preview appendix
    } catch (appendixErr: unknown) {
      console.warn('[generatePermitHTML] CAD appendix preview omitted (non-critical):', appendixErr instanceof Error ? appendixErr.message : appendixErr);
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="planset-version" content="${PLANSET_ENGINE_VERSION}">
<title>Permit Package — ${project.projectName}</title>
<style>
  /* ═══════════════════════════════════════════════════════════════════════════
     SOLARPRO ENGINEERING DOCUMENT SYSTEM — CANONICAL STYLESHEET v47.270
     CAD-standard. Rigid grid. Zero rounded corners. Zero UI colors.
     Shared across ALL 14 sheets for absolute visual consistency.
     ONE section system (.sec only). ALL data in tables. No tier variants.

     SPACING SCALE (use ONLY these values):
       --xs:  8px   (tight gaps, table cell padding)
       --sm: 12px   (section internal padding)
       --md: 16px   (between sections)
       --lg: 24px   (column gaps)
       --xl: 32px   (page margins)

     GRID SYSTEM:
       - 2-column: grid-template-columns: 1fr 1fr
       - 3-column: grid-template-columns: 1fr 1fr 1fr
       - Wide (full-width): grid-template-columns: 1fr
       - All grids use gap: var(--md)
       - All page margins: var(--xl) on all sides

     SECTION BLOCK STANDARD:
       <div class="sec">
         <div class="sec-hdr">SECTION TITLE</div>
         <div class="sec-body"> ... </div>
       </div>
  ═══════════════════════════════════════════════════════════════════════════ */

  /* ── Reset ─────────────────────────────────────────────────────────────── */
  * { margin: 0; padding: 0; box-sizing: border-box; }

  /* ── Design tokens ──────────────────────────────────────────────────────── */
  :root {
    --xs:  8px;
    --sm: 12px;
    --md: 16px;
    --lg: 24px;
    --xl: 32px;

    --border:     1px solid #000;
    --border-hvy: 2px solid #000;
    --border-med: 1.5px solid #000;

    --f-xs:  6.2px;
    --f-sm:  6.6px;
    --f-md:  7px;
    --f-lg:  8px;
    --f-xl:  9px;
    --f-2xl:10px;
    --f-3xl:12px;
    --f-4xl:16px;

    --mono: 'Courier New', Courier, monospace;
    --sans: Arial, 'Helvetica Neue', sans-serif;

    /* Vertical rhythm — space between major content blocks */
    --gap-section: var(--md);   /* default gap between .sec blocks */
  }

  body {
    font-family: var(--sans);
    font-size: var(--f-md);
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Page container ─────────────────────────────────────────────────────── */
  /* PIPELINE v47.343: Engineering border frame (4-line CAD border system)
   * Outer border: thick black rule on .page element itself
   * Inner border hairline via ::before pseudo — replicates ANSI B permit set framing */
  .page {
    width: 17in;
    height: 11in;
    padding: 0.28in 0.28in 0.16in 0.28in;
    page-break-after: always;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 0;
    overflow: hidden;
    box-sizing: border-box;
    background: #fff;
    outline: 2.5px solid #000;
    outline-offset: -6px;
    position: relative;
  }
  .page:last-child { page-break-after: avoid; }

  /* ── Page body grid variants ────────────────────────────────────────────── */
  /* All page-body variants: fill remaining height, gap = --md */
  /* PIPELINE v47.343: align-content:start prevents ghost-stretching of short sections */
  .page-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--md);
    align-content: start;
    align-items: start;
    overflow: hidden;
    margin-top: var(--md);
  }
  .page-body-wide {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--md);
    align-content: start;
    align-items: start;
    overflow: hidden;
    margin-top: var(--md);
  }
  .page-body-3col {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--md);
    align-content: start;
    align-items: start;
    overflow: hidden;
    margin-top: var(--md);
  }
  /* span helpers */
  .span-2 { grid-column: span 2; }
  .span-3 { grid-column: span 3; }

  /* Column stack: vertical flex with canonical gap */
  .col-stack       { display: flex; flex-direction: column; gap: var(--gap-section); }

  /* ── Page footer ────────────────────────────────────────────────────────── */
  .page-footer {
    font-size: var(--f-xs);
    color: #555;
    border-top: var(--border);
    padding-top: var(--xs);
    margin-top: var(--xs);
    flex-shrink: 0;
  }

  /* ── Page content area (fills grid row 2 — used by non-cover pages) ─────── */
  .page-content {
    display: flex;
    flex-direction: column;
    gap: var(--gap-section);
    overflow: hidden;
    margin-top: var(--md);
    flex: 1;
  }
  /* 2-column variant for pages with left/right panels */
  .page-content-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap-section);
    overflow: hidden;
    margin-top: var(--md);
    flex: 1;
  }

  /* ── Section block (canonical) ──────────────────────────────────────────── */
  /*
     Standard section pattern:
       <div class="sec">
         <div class="sec-hdr">SECTION TITLE</div>
         <div class="sec-body"> ... </div>
       </div>
  */
  .sec {
    border: var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 0 0 auto;          /* PIPELINE v47.343: size to content, never ghost-stretch */
    box-sizing: border-box;
  }
  .sec-hdr {
    font-size: var(--f-sm);
    font-weight: 900;
    color: #fff;
    background: #000;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 3px var(--xs);
    flex-shrink: 0;
    font-family: var(--sans);
    border-bottom: var(--border);
  }
  .sec-body {
    flex-grow: 1;
    padding: var(--xs);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* sec-body-np: no padding (for flush tables) */
  .sec-body-np {
    flex-grow: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* sec-scroll: allow internal scroll (for long tables) */
  .sec-scroll {
    flex-grow: 1;
    overflow: auto;
  }

  /* -- Drawing-package layout (v47.273) -- */
  /* ═══ Sheet Composition Layout System (v47.308) ═══════════════════════════ */
  /* .page-draw: ALWAYS row — draw zone left, data zone right                  */
  .page-draw {
    display: flex; flex-direction: row; gap: 0;
    overflow: hidden; margin-top: var(--md); flex: 1 1 0%;
    align-items: stretch;
    /* PIPELINE v47.343: fill 1fr row without collapsing; height:100% removed */
    min-height: 0;
    align-self: stretch;
  }

  /* Layout mode variants — set on .page-draw */
  /* elevation_dominant: fence — 78% draw / 22% data */
  .layout-elevation-dominant .draw-zone { flex: 0 0 78%; max-width: 78%; }
  .layout-elevation-dominant .data-zone { flex: 0 0 22%; max-width: 22%; }
  /* plan_dominant: roof — 82% draw / 18% data */
  .layout-plan-dominant      .draw-zone { flex: 0 0 82%; max-width: 82%; }
  .layout-plan-dominant      .data-zone { flex: 0 0 18%; max-width: 18%; }
  /* split_view: ground — 65% draw / 35% data */
  .layout-split-view         .draw-zone { flex: 0 0 65%; max-width: 65%; }
  .layout-split-view         .data-zone { flex: 0 0 35%; max-width: 35%; }

  .draw-zone {
    overflow: hidden;
    display: flex; flex-direction: column;
    border: var(--border); background: #fff;
    /* PIPELINE v47.343: draw zone fills full height of page-draw row */
    align-self: stretch;
    min-height: 0;
  }
  .draw-zone-hdr {
    background: #000; color: #fff;
    font-size: var(--f-sm); font-weight: 900;
    text-transform: uppercase; letter-spacing: 0.8px;
    padding: 3px var(--xs); flex-shrink: 0;
  }
  /* fit-drawing: SVG fills draw zone, centered, aspect-preserved */
  .draw-zone-body {
    flex: 1; display: flex; align-items: center;
    justify-content: center; overflow: hidden; padding: 6px;
    background: #fff;
  }
  /* SVG: fill flex cell, aspect ratio preserved by preserveAspectRatio="xMidYMid meet" on SVG.
     width:100% height:100% is REQUIRED for SVGs without explicit w/h attrs to render in flex.
     object-fit:contain is honored for non-SVG content. Engineering scale is preserved because
     all SVGs use viewBox + preserveAspectRatio="xMidYMid meet" — no distortion occurs. */
  .draw-zone-body svg {
    width: 100%; height: 100%;
    max-width: 100%; max-height: 100%;
    display: block;
    object-fit: contain;
  }
  .data-zone {
    overflow: hidden;
    display: flex; flex-direction: column; gap: 0;
    border: var(--border); border-left: none;
    /* PIPELINE v47.343: data zone fills full height of page-draw row */
    align-self: stretch;
    min-height: 0;
  }
  .data-zone-2col {
    display: flex; flex-direction: column;
    gap: 0; flex: 1; overflow: hidden;
  }
  .data-zone-2col > * { border-bottom: var(--border); overflow: hidden; }
  .data-zone-2col > *:last-child { border-bottom: none; }

  /* Data table: system-specific rows */
  .comp-data-table {
    width: 100%; border-collapse: collapse; font-size: 7px; line-height: 1.5;
  }
  .comp-data-table tr { border-bottom: 1px solid #eee; }
  .comp-data-table tr:last-child { border-bottom: none; }
  .comp-data-table td:first-child {
    padding: 2px 3px 2px 4px; color: #555; font-size: 6.5px;
    white-space: nowrap; width: 48%;
  }
  .comp-data-table td:last-child {
    padding: 2px 4px 2px 2px; font-weight: 600; color: #000; font-size: 7px;
  }
  .comp-data-table .row-bold td { font-weight: 900 !important; color: #000 !important; }
  .comp-data-table .row-highlight td { color: #cc0000 !important; font-weight: 900 !important; }

  .callout-bubble {
    display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border: 1.5px solid #000; border-radius: 50%;
    font-size: 8px; font-weight: 900; background: #fff; color: #000; flex-shrink: 0;
  }
  .callout-row {
    display: flex; align-items: flex-start; gap: 3px;
    padding: 2px 4px; font-size: var(--f-xs);
    border-bottom: 1px solid #eee; line-height: 1.6;
  }
  .callout-row:last-child { border-bottom: none; }

  /* -- CAD line weight system (v47.280) -- */
  .line-struct { stroke: #000; stroke-width: 3.0; fill: none; }
  .line-panel  { stroke: #2255aa; stroke-width: 1.5; fill: none; }
  .line-dim    { stroke: #0055aa; stroke-width: 0.7; fill: none; stroke-dasharray: none; }
  .line-grade  { stroke: #5C4A20; stroke-width: 2.5; fill: none; }
  .line-hidden { stroke: #888; stroke-width: 0.8; fill: none; stroke-dasharray: 4,3; }
  .line-wind   { stroke: #cc0000; stroke-width: 1.8; fill: none; }
  .line-setbk  { stroke: #cc0000; stroke-width: 1.0; fill: none; stroke-dasharray: 6,3; }
  .line-conduit { stroke: #ff8800; stroke-width: 1.5; fill: none; stroke-dasharray: 8,4; }

  /* Legacy aliases — map old class names to new sec system */
  .section     { border: var(--border); display: flex; flex-direction: column; overflow: hidden; flex: 0 0 auto; box-sizing: border-box; }
  .section-hdr { font-size: var(--f-sm); font-weight: 900; color: #fff; background: #000; text-transform: uppercase; letter-spacing: 0.8px; padding: 3px var(--xs); flex-shrink: 0; border-bottom: var(--border); }
  .section-content { flex-grow: 1; padding: var(--xs); overflow: hidden; display: flex; flex-direction: column; }
  .section-title { font-size: var(--f-sm); font-weight: 900; color: #fff; background: #000; text-transform: uppercase; letter-spacing: 0.8px; padding: 3px var(--xs); flex-shrink: 0; border-bottom: var(--border); margin-top: var(--xs); }
  .section-title:first-child { margin-top: 0; }

  /* ── Utility: dark header bar (reused across pages) ─────────────────────── */
  .sec-hdr-dark {
    background: #000; color: #fff;
    padding: 3px var(--xs);
    font-size: var(--f-xs); font-weight: 900;
    text-transform: uppercase; letter-spacing: 1px;
    width: 100%; box-sizing: border-box;
  }

  /* ── Warning label card ─────────────────────────────────────────────────── */
  .lbl-card { border: var(--border-med); overflow: hidden; width: 100%; box-sizing: border-box; }
  .lbl-hdr {
    background: #000; color: #fff;
    padding: 3px 6px;
    display: flex; justify-content: space-between; align-items: center;
    width: 100%; box-sizing: border-box;
  }
  .lbl-hdr-id  { font-weight: 900; font-size: 9px; font-family: var(--mono); letter-spacing: 1px; color: #fff; }
  .lbl-hdr-ref { font-size: 7.5px; font-family: var(--mono); color: #ccc; }
  .lbl-footer  { background: #f5f5f5; border-top: var(--border); padding: 3px 6px; font-size: 7.5px; color: #000; }

  /* ── Note / callout bar ──────────────────────────────────────────────────── */
  .note-bar {
    border: var(--border);
    padding: 4px var(--sm);
    background: #fff;
    font-size: var(--f-xs);
    color: #000;
    line-height: 1.5;
  }
  .note-bar-label {
    font-weight: 900; font-size: var(--f-xs);
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-right: 6px;
  }

  /* ── Table header row (black) ────────────────────────────────────────────── */
  .tbl-hdr-row th {
    background: #000; color: #fff;
    padding: 2px 3px;
    font-size: var(--f-xs); text-align: left;
    font-weight: 700;
  }
  .tbl-hdr-row th.center { text-align: center; }

  /* ── PE Letter: signature / stamp ────────────────────────────────────────── */
  .sig-grid {
    display: grid; grid-template-columns: 3fr 2fr; gap: 0;
    padding: var(--xs);
  }
  .sig-col { padding-right: var(--sm); }
  .sig-col-stamp {
    border-left: var(--border);
    padding-left: var(--sm);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .sig-field { margin-bottom: var(--xs); font-size: var(--f-xs); }
  .sig-line     { border-bottom: var(--border);     display: inline-block; }
  .sig-line-hvy { border-bottom: var(--border-hvy); display: inline-block; }
  .stamp-box {
    width: 90px; height: 90px;
    border: var(--border-hvy);
    display: flex; align-items: center; justify-content: center;
  }

  /* ── SVG / diagram wrapper ───────────────────────────────────────────────── */
  .svg-wrap { background: #fff; border: var(--border); padding: 4px; overflow: hidden; }
  .svg-wrap img, .svg-wrap svg { display: block; width: 100%; height: auto; }

  /* ── Aerial/map image wrapper ────────────────────────────────────────────── */
  .aerial-wrap { position: relative; display: block; width: 100%; overflow: hidden; border: 1.5px solid #374151; }
  .aerial-wrap img { display: block; width: 100%; height: auto; }
  .aerial-wrap svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
  .aerial-pin-label { background: #fff; border: var(--border); padding: 2px 5px; white-space: nowrap; margin-top: 1px; }
  .aerial-nts { position: absolute; bottom: 3px; right: 3px; background: #fff; border: var(--border); padding: 1px 4px; }

  /* ── Sec-body table (table fills sec-body, no internal padding) ──────────── */
  .sec-body-table { padding: 0; }
  .sec-body-table table { width: 100%; border-collapse: collapse; }

  /* ── Cover: 2-col grid layout ────────────────────────────────────────────── */
  .cover-grid { display: grid; grid-template-columns: 2fr 1fr; gap: var(--md); }

  /* ── Inline sub-header (within sec-body, not a full sec-hdr) ─────────────── */
  .sub-hdr {
    font-size: var(--f-xs); font-weight: 900; text-transform: uppercase; color: #000;
    border-bottom: var(--border); padding-bottom: 2px; margin-bottom: 4px;
  }
  .sub-hdr-hvy { border-bottom: var(--border-hvy) !important; }

  /* ── Sig line underlines (PE letter) ─────────────────────────────────────── */
  .sig-underline-sm  { border-bottom: var(--border);     display: inline-block; width: 130px; }
  .sig-underline-md  { border-bottom: var(--border);     display: inline-block; width: 160px; }
  .sig-underline-xl  { border-bottom: var(--border-hvy); display: inline-block; width: 200px; }
  .sig-underline-110 { border-bottom: var(--border);     display: inline-block; width: 110px; }

  /* ── Centered callout block (e.g. "no data" placeholder) ─────────────────── */
  .callout-center {
    display: flex; align-items: center; justify-content: center;
    text-align: center; width: 100%;
  }

  /* ── Title block (bottom strip on every sheet) ──────────────────────────── */
  .title-block {
    display: table;
    width: 100%;
    border: var(--border-hvy);
    background: #fff;
    border-collapse: collapse;
    flex-shrink: 0;
    margin-bottom: var(--xs);
  }
  .tb-left {
    display: table-cell;
    width: 30%;
    padding: var(--xs);
    border-right: var(--border);
    vertical-align: top;
  }
  .tb-center {
    display: table-cell;
    width: 40%;
    padding: var(--xs);
    border-right: var(--border);
    vertical-align: middle;
    text-align: center;
  }
  .tb-right {
    display: table-cell;
    width: 30%;
    padding: 0;
    vertical-align: top;
  }
  .tb-company     { font-size: var(--f-xl); font-weight: 900; color: #000; letter-spacing: 2px; text-transform: uppercase; border-bottom: var(--border); padding-bottom: 2px; margin-bottom: 2px; }
  .tb-project     { font-size: var(--f-xl); font-weight: 700; color: #000; margin-top: 2px; text-transform: uppercase; }
  .tb-address     { font-size: var(--f-sm); color: #333; margin-top: 1px; }
  .tb-client      { font-size: var(--f-sm); color: #333; margin-top: 1px; }
  .tb-meta        { font-size: var(--f-xs); color: #555; margin-top: 1px; }
  .tb-sheet-id    { font-size: var(--f-4xl); font-weight: 900; color: #000; font-family: var(--mono); letter-spacing: 4px; border-bottom: var(--border-hvy); padding-bottom: 3px; margin-bottom: 2px; }
  .tb-sheet-title { font-size: var(--f-2xl); font-weight: 900; color: #000; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
  .tb-codes       { font-size: var(--f-xs); color: #555; margin-top: 3px; }
  .tb-size        { font-size: var(--f-xs); color: #777; margin-top: 1px; }

  /* Title block right column — meta table */
  .tb-table { width: 100%; border-collapse: collapse; font-size: var(--f-sm); }
  .tb-table tr { border-bottom: var(--border); }
  .tb-table tr:last-child { border-bottom: none; }
  .tbl {
    color: #000;
    padding: 2px var(--xs);
    white-space: nowrap;
    font-weight: 700;
    width: 38%;
    font-size: var(--f-xs);
    border-right: var(--border);
    text-transform: uppercase;
    background: #f0f0f0;
  }
  .tbv {
    font-weight: 500;
    color: #000;
    padding: 2px var(--xs);
    font-size: var(--f-sm);
  }
  .pe-seal-box {
    font-size: var(--f-xs);
    color: #555;
    text-align: center;
    border: var(--border);
    padding: 2px var(--xs);
    text-transform: uppercase;
    font-weight: 700;
  }

  /* ── Info table (label / value pairs) ───────────────────────────────────── */
  .info-table { width: 100%; border-collapse: collapse; font-size: var(--f-md); }
  .info-table tr { border-bottom: var(--border); }
  .info-table tr:last-child { border-bottom: none; }
  .il {
    font-weight: 900;
    padding: 2px var(--xs);
    width: 38%;
    white-space: nowrap;
    border-right: var(--border);
    font-size: var(--f-sm);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    background: #f0f0f0;
    vertical-align: top;
  }
  .iv {
    color: #000;
    padding: 2px var(--xs);
    font-size: var(--f-md);
    vertical-align: top;
    line-height: 1.4;
  }
  /* Emphasized value — key metrics (system size, module count) */
  .iv-em {
    color: #000;
    padding: 2px var(--xs);
    font-size: var(--f-lg);
    font-weight: 900;
    font-family: var(--mono);
    vertical-align: top;
    line-height: 1.4;
    letter-spacing: 0.3px;
  }

  /* ── Equipment / BOM tables ─────────────────────────────────────────────── */
  .equip-table, .bom-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--f-md);
    border: var(--border);
  }
  .equip-table th, .bom-table th {
    background: #000;
    color: #fff;
    padding: 3px var(--xs);
    text-align: left;
    font-weight: 900;
    font-size: var(--f-xs);
    letter-spacing: 0.5px;
    border-right: 1px solid #444;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .equip-table th:last-child, .bom-table th:last-child { border-right: none; }
  .equip-table td, .bom-table td {
    padding: 2px var(--xs);
    border-bottom: var(--border);
    border-right: 1px solid #ddd;
    vertical-align: middle;
    color: #000;
    font-size: var(--f-md);
  }
  .equip-table td:last-child, .bom-table td:last-child { border-right: none; }
  .equip-table tbody tr:last-child td,
  .bom-table   tbody tr:last-child td { border-bottom: var(--border-hvy); }
  .equip-table tr:nth-child(even) td,
  .bom-table   tr:nth-child(even) td { background: #f8f8f8; }
  .bom-note { font-size: var(--f-xs); color: #444; margin-top: var(--xs); flex-shrink: 0; }

  /* ── Calc / structural tables ───────────────────────────────────────────── */
  .calc-table { width: 100%; border-collapse: collapse; }
  .calc-table tr { border-bottom: var(--border); }
  .calc-table tr:last-child { border-bottom: none; }
  .calc-table td { padding: 2px var(--xs); font-size: var(--f-md); color: #000; }
  .cv { text-align: right; font-weight: 700; font-family: var(--mono); }

  /* ── Sheet index table ──────────────────────────────────────────────────── */
  .sheet-index-table { width: 100%; border-collapse: collapse; font-size: var(--f-md); }
  .sheet-index-table th {
    background: #000;
    color: #fff;
    padding: 3px var(--xs);
    text-align: left;
    font-weight: 900;
    font-size: var(--f-xs);
    text-transform: uppercase;
    border-right: 1px solid #444;
    letter-spacing: 0.5px;
  }
  .sheet-index-table th:last-child { border-right: none; }
  .sheet-index-table td {
    padding: 2px var(--xs);
    border-bottom: var(--border);
    color: #000;
    font-size: var(--f-md);
    border-right: 1px solid #ddd;
  }
  .sheet-index-table td:last-child { border-right: none; }
  .si-id { font-weight: 900; font-family: var(--mono); color: #000; width: 64px; }

  /* ── Structural cards ───────────────────────────────────────────────────── */
  .struct-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--md); width: 100%; }
  .struct-card { border: var(--border); overflow: hidden; }
  .sct {
    background: #000;
    color: #fff;
    padding: 3px var(--xs);
    font-weight: 900;
    font-size: var(--f-sm);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* ── NEC rules summary bar ──────────────────────────────────────────────── */
  .rules-summary { display: flex; flex-direction: row; border: var(--border); border-bottom: none; margin-bottom: var(--xs); overflow: hidden; }
  .rs { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--xs) var(--sm); border-right: var(--border); flex: 1; }
  .rs:last-child { border-right: none; }
  .rs-val { font-size: var(--f-3xl); font-weight: 900; color: #000; font-family: var(--mono); }
  .rs-lbl { font-size: var(--f-xs); color: #444; text-transform: uppercase; letter-spacing: 0.3px; }

  /* ── Warning labels ─────────────────────────────────────────────────────── */
  .label-intro {
    font-size: var(--f-md);
    color: #000;
    background: #fff;
    border: var(--border);
    padding: var(--xs);
    margin-bottom: var(--xs);
    line-height: 1.5;
    flex-shrink: 0;
  }
  .labels-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--md); width: 100%; }
  .label-card { border: var(--border); overflow: hidden; display: flex; flex-direction: column; }
  .label-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #000;
    padding: 3px var(--xs);
    flex-shrink: 0;
  }
  .label-id  { font-weight: 900; font-size: var(--f-md); color: #fff; text-transform: uppercase; }
  .label-nec { font-size: var(--f-xs); color: #ccc; font-family: var(--mono); }
  .label-visual { padding: var(--xs); flex-grow: 1; display: block; }
  .label-warning-line { font-size: var(--f-lg); font-weight: 900; letter-spacing: 0.5px; margin-bottom: 3px; }
  .label-body-line { font-size: var(--f-md); line-height: 1.5; }
  .label-placement {
    font-size: var(--f-sm);
    color: #000;
    padding: var(--xs);
    border-top: var(--border);
    background: #f8f8f8;
    flex-shrink: 0;
  }

  /* ── Map / aerial placeholder ───────────────────────────────────────────── */
  .map-placeholder {
    border: var(--border-hvy);
    flex-grow: 1;
    display: flex;
    width: 100%;
    background: #e8e8e8;
  }
  .map-inner {
    text-align: center;
    padding: var(--sm);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    width: 100%;
  }
  .map-icon  { font-size: 28px; opacity: 0.4; }
  .map-title { font-size: var(--f-xl); font-weight: 900; color: #333; margin-top: var(--xs); text-transform: uppercase; }
  .map-addr  { font-size: var(--f-lg); color: #555; margin-top: var(--xs); }
  .map-note  { font-size: var(--f-md); color: #777; margin-top: var(--xs); }

  /* ── Rapid shutdown box ─────────────────────────────────────────────────── */
  .rapid-shutdown-box { background: #fff; border: var(--border); padding: var(--xs); margin-top: var(--xs); }
  .rs-title { font-size: var(--f-lg); font-weight: 900; color: #cc0000; margin-bottom: var(--xs); text-transform: uppercase; }
  .rs-body  { font-size: var(--f-md); color: #000; line-height: 1.5; }

  /* ── Attachment note ────────────────────────────────────────────────────── */
  .attach-note {
    background: #fff;
    border: var(--border);
    padding: var(--xs);
    margin-top: var(--xs);
    font-size: var(--f-sm);
    color: #000;
    line-height: 1.5;
    flex-shrink: 0;
  }

  /* ── Certification page ─────────────────────────────────────────────────── */
  .cert-header {
    font-size: var(--f-2xl);
    font-weight: 900;
    text-align: center;
    color: #000;
    border-bottom: var(--border-hvy);
    padding-bottom: var(--xs);
    margin-bottom: var(--xs);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    flex-shrink: 0;
  }
  .cert-statement {
    font-size: var(--f-md);
    line-height: 1.5;
    color: #000;
    background: #fff;
    border: var(--border);
    padding: var(--xs);
    margin-bottom: var(--xs);
  }
  .cert-statement li { margin-bottom: 2px; margin-left: var(--md); }
  .cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--md); width: 100%; margin-bottom: var(--xs); }
  .cert-block-title { font-size: var(--f-sm); font-weight: 900; color: #fff; background: #000; text-transform: uppercase; letter-spacing: 0.8px; padding: 3px var(--xs); flex-shrink: 0; border-bottom: var(--border); margin-top: var(--xs); }
  .cert-block-title:first-child { margin-top: 0; }
  .cert-field { margin-bottom: var(--xs); }
  .cf-val { font-size: var(--f-xl); font-weight: 600; color: #000; border-bottom: var(--border-hvy); padding-bottom: 3px; min-height: 22px; }
  .cf-lbl { font-size: var(--f-sm); color: #555; margin-top: 2px; text-transform: uppercase; }
  .stamp-box { border: var(--border-hvy); min-height: 96px; display: flex; align-items: center; justify-content: center; width: 100%; text-align: center; }
  .cert-footer {
    font-size: var(--f-sm);
    color: #555;
    text-align: center;
    border-top: var(--border);
    padding-top: var(--xs);
    margin-top: var(--md);
  }
  .notes-box { background: #fff; border: var(--border); padding: var(--xs); font-size: var(--f-lg); color: #000; }

  /* ── Construction notes list ────────────────────────────────────────────── */
  .construction-notes { padding-left: var(--md); font-size: var(--f-md); line-height: 1.5; color: #000; }
  .construction-notes li { margin-bottom: 2px; }

  /* ── Cover sheet specific ───────────────────────────────────────────────── */
  .cover-section-hdr {
    font-size: var(--f-md);
    font-weight: 900;
    color: #000;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: var(--border-hvy);
    padding-bottom: 2px;
    margin-bottom: var(--xs);
  }
  .cover-list-table { width: 100%; border-collapse: collapse; font-size: var(--f-md); }
  .cover-list-table tr td { padding: 2px var(--xs); vertical-align: top; color: #000; border-bottom: var(--border); }
  .cover-list-table tr:last-child td { border-bottom: none; }
  .cli { width: 64px; font-weight: 700; color: #000; white-space: nowrap; border-right: var(--border); }

  /* cv0 = cover sheet data rows */
  .cv0-hdr {
    font-size: var(--f-md);
    font-weight: 900;
    color: #000;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    border-bottom: var(--border-hvy);
    padding-bottom: 2px;
    margin-bottom: var(--xs);
  }
  .cv0-tbl { width: 100%; border-collapse: collapse; font-size: var(--f-md); line-height: 1.5; }
  .cv0-tbl tr td { padding: 2px var(--xs); vertical-align: top; color: #000; border-bottom: var(--border); }
  .cv0-tbl tr:last-child td { border-bottom: none; }
  .cv0-tag { width: 28px; font-weight: 900; color: #000; white-space: nowrap; font-family: var(--mono); border-right: var(--border); }
  .cv0-key { width: 110px; font-weight: 700; color: #000; white-space: nowrap; border-right: var(--border); }

  /* ── SLD page ───────────────────────────────────────────────────────────── */
  .sld-page { padding: var(--xl); height: 11in; }
  .sld-page .title-block { margin-bottom: var(--xs); }
  .sld-page svg { max-width: 100%; max-height: calc(11in - 1.8in); object-fit: contain; }

  /* ── Two-column layout helper (legacy) ──────────────────────────────────── */
  .two-col-layout { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap-section); width: 100%; overflow: hidden; }
  .col-left  { overflow: hidden; }
  .col-right { overflow: hidden; }

  /* ── NEC 120% rule box ──────────────────────────────────────────────────── */
  .nec-rule-box {
    border: var(--border-hvy);
    padding: var(--xs);
    font-size: var(--f-md);
    font-family: var(--mono);
    font-weight: 700;
    color: #000;
    background: #fff;
    line-height: 1.6;
  }

  /* ── Utility classes ────────────────────────────────────────────────────── */
  .mono { font-family: var(--mono); }
  .bold { font-weight: 900; }
  .caps { text-transform: uppercase; }
  .center { text-align: center; }
  .right  { text-align: right; }
  .muted  { color: #555; }
  .danger { color: #cc0000; font-weight: 900; }
  .w100   { width: 100%; }

  /* ── Inline-style replacement utility classes ──────────────────────────── */
  /* These replace the most common inline style patterns across page functions */
  .tr   { text-align: right; }
  .tc   { text-align: center; }
  .tl   { text-align: left; }
  .fw9  { font-weight: 900; }
  .fw7  { font-weight: 700; }
  .fw6  { font-weight: 600; }
  .fw4  { font-weight: 400; }
  .mono { font-family: var(--mono); }
  .f-xs { font-size: var(--f-xs); }
  .f-sm { font-size: var(--f-sm); }
  .f-md { font-size: var(--f-md); }
  .f-lg { font-size: var(--f-lg); }
  /* ── Flex helpers ─────────────────────────────────────────────────────── */
  .df  { display: flex; }
  .aic { align-items: center; }
  .jcc { justify-content: center; }
  .jsb { justify-content: space-between; }
  .f1  { flex: 1; }
  .fs0 { flex-shrink: 0; }

  .mt-xs { margin-top: var(--xs); }
  .mt-sm { margin-top: var(--sm); }
  .mt-md { margin-top: var(--md); }
  .mb-xs { margin-bottom: var(--xs); }
  .mb-sm { margin-bottom: var(--sm); }
  .mb-md { margin-bottom: var(--md); }
  .pt-xs { padding-top: var(--xs); }
  .pt-sm { padding-top: var(--sm); }
  .pb-xs { padding-bottom: var(--xs); }
  .pb-sm { padding-bottom: var(--sm); }
  .p-xs  { padding: var(--xs); }
  .bb-1   { border-bottom: var(--border); }
  .bb-hvy { border-bottom: var(--border-hvy); }
  .bt-1   { border-top: var(--border); }
  .bl-1   { border-left: var(--border); }
  .c000  { color: #000; }
  .c555  { color: #555; }
  .c999  { color: #999; }
  .c444  { color: #444; }
  .c666  { color: #666; }
  .bg000 { background: #000; color: #fff; }
  .bg-lt { background: #f8f8f8; }
  /* Inline section header bar (no outer .sec container needed) */
  .blk-hdr {
    font-size: var(--f-sm);
    font-weight: 900;
    color: #fff;
    background: #000;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 3px var(--xs);
    font-family: var(--sans);
  }
  /* Inline content box (border, padding) */
  .blk-body {
    border: var(--border);
    border-top: none;
    padding: var(--xs);
  }
  /* NEC note / code reference line */
  .code-ref {
    font-size: var(--f-xs);
    font-family: var(--mono);
    color: #555;
    margin-top: 2px;
  }
  /* Numbered note row */
  .note-row { display: table; width: 100%; margin-bottom: 2px; }
  .note-num { display: table-cell; width: var(--md); font-family: var(--mono); font-weight: 900; font-size: var(--f-md); vertical-align: top; color: #000; }
  .note-txt { display: table-cell; font-size: var(--f-md); line-height: 1.5; color: #000; font-family: var(--sans); }

  /* ── Print ──────────────────────────────────────────────────────────────── */
  /* Explicit 17in x 11in IS landscape. Do NOT add the orientation keyword after
     explicit lengths — that combination is invalid CSS and browsers fall back to
     Letter portrait, clipping the right ~8in on print/PDF export. */
  @page { size: 17in 11in; margin: 0; }
  @media print { .page { page-break-after: always; } }
</style>
</head>
<body>
${pages.join('\
')}
</body>
</html>`;
}
