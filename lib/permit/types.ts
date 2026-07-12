// ═══════════════════════════════════════════════════════════════
// Permit Engine Types — Central type hub
// ZERO REGRESSION: All types preserved exactly from route.ts
// ═══════════════════════════════════════════════════════════════

import type { CADModel } from '@/lib/cad/types';
import type { RenderContext } from '@/lib/drafting/renderContext';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { DocumentProvenanceBundle } from '@/lib/documentProvenance';
import type { EngineeringDecisionEvaluationBundle, DecisionAwareBOMMetadata, DecisionAwareSLDMetadata, DecisionAwareReadinessSummary } from '@/lib/engineeringDecisionProvenance';
import type { EngineeringStateRegistry, EngineeringInvalidationLineageMetadata, SelectiveRegenerationPlan } from '@/lib/engineeringStateInvalidation';

// ─── Types ──────────────────────────────────────────────────────────────

// ── Compliance Sub-Interfaces (Error 7e fix) ─────────────────────────────────
// Replace `electrical?: any` and `structural?: any` with proper interfaces
// so the compiler catches typos and missing fields on every
// compliance.electrical.* and compliance.structural.* access site.

export interface ElectricalCompliance {
  acConductorCallout?: string;     // e.g. "#10 AWG" — AC wire gauge callout
  dcConductorCallout?: string;     // e.g. "#10 AWG" — DC wire gauge callout
  acWireAmpacity?: number;         // AC wire ampacity rating (derated)
  acVoltageDrop?: number;          // AC voltage drop percentage
  groundingConductor?: string;     // e.g. "#10 Copper"
  acWireGauge?: string;            // e.g. "#10 AWG" — raw gauge for SLD
  busbar?: {
    backfeedBreakerRequired?: number;  // backfeed breaker amps
    passes?: boolean;                   // 120% rule pass/fail
    busbarRule?: '120%' | 'supply-side';
    busRating?: number;
    mainBreaker?: number;
    solarBreakerRequired?: number;
    maxAllowedSolarBreaker?: number;
    method?: string;
    message?: string;
    necReference?: string;
  };
  conduitFill?: {
    conduitType?: string;
    conduitSize?: string;
    fillPercent?: number;
    passes?: boolean;
  };
  summary?: {
    totalDcKw?: number;
    totalAcKw?: number;
    dcAcRatio?: number;
  };
  // Full ElectricalCalcResult fields for advanced pages / BOM / SLD
  interconnection?: {
    method?: string;
    methodLabel?: string;
    busRating?: number;
    mainBreaker?: number;
    solarBreakerRequired?: number;
    maxAllowedSolarBreaker?: number;
    passes?: boolean;
    necReference?: string;
    message?: string;
  };
  acSizing?: {
    ocpdAmps?: number;
    disconnectAmps?: number;
    disconnectType?: string;
    conductorGauge?: string;
    conductorAmpacity?: number;
    conduitSize?: string;
    conduitFillPct?: number;
    groundingConductor?: string;
  };
  inverters?: Array<{
    inverterId?: number;
    type?: string;
    acOutputKw?: number;
    acOutputCurrentMax?: number;
    strings?: Array<{
      stringId?: number;
      panelCount?: number;
      vocSTC?: number;
      vocCorrected?: number;
      iscSTC?: number;
      iscCorrected?: number;
      maxCurrentNEC?: number;
      ocpdRating?: number;
      wireGauge?: string;
      wireAmpacity?: number;
      voltageDrop?: number;
    }>;
    acWireResult?: {
      selectedGauge?: string;
      effectiveAmpacity?: number;
      voltageDrop?: number;
      conductorCallout?: string;
      wasAutoSized?: boolean;
      overallPass?: boolean;
    };
  }>;
  rapidShutdownCompliant?: boolean;
  status?: 'PASS' | 'WARNING' | 'FAIL';
  // Survey integration notes (set by permitIntegration.ts from site survey data)
  surveyNotes?: string[];
}

export interface StructuralCompliance {
  wind?: {
    windSpeed?: number;
    exposureCategory?: string;
    velocityPressure?: number;
    netUpliftPressure?: number;
    upliftPerAttachment?: number;
  };
  snow?: {
    groundSnowLoad?: number;
    roofSnowLoad?: number;
    snowLoadPerAttachment?: number;   // lbs per attachment point from snow loading
  };
  rafter?: {
    rafterSize?: string;
    rafterSpacing?: number;
    rafterSpan?: number;
    framingType?: string;   // 'rafter' | 'truss' — drives load-vs-bending display
    bendingMoment?: number;
    allowableBendingMoment?: number;
    utilizationRatio?: number;
    deflection?: number;
    allowableDeflection?: number;
    Fb_base?: number;
    Cd?: number;
    Cr?: number;
    Fb_prime?: number;
    totalLoadPsf?: number;
    lineLoad?: number;
  };
  attachment?: {
    safetyFactor?: number;
    lagBoltCapacity?: number;
    maxAllowedSpacing?: number;
    totalUpliftPerAttachment?: number;
  };
  seismic?: {
    sdc?: string;  // Seismic Design Category
  };
  totalDeadLoadPsf?: number;
  moduleLoadPsf?: number;
  rackingLoadPsf?: number;
  /** Hybrid (P2): per-sub-system StructuralResultV4, keyed 'roof'|'ground'|'fence'.
   *  The scalar fields above map from the ROOF run; fence/ground sheets + the
   *  BOM read their own runs here. */
  subSystems?: Record<string, unknown>;
  // Survey integration notes (set by permitIntegration.ts from site survey data)
  surveyNotes?: string[];
}

export interface PermitInput {
  project: {
    projectName: string;
    clientName: string;
    address: string;
    designer: string;
    date: string;
    notes: string;
    systemType: string;
    mainPanelAmps: number;
    mainPanelBrand: string;
    utilityMeter: string;
    utilityName?: string;
    acDisconnect: boolean;
    dcDisconnect: boolean;
    productionMeter: boolean;
    rapidShutdown: boolean;
    conduitType: string;
    wireGauge: string;
    wireLength: number;
    lat?: number;
    lng?: number;
    roofType?: string;
    mountingSystem?: string;
    mountingSystemId?: string;
    roofPitch?: number;
    rafterSize?: string;
    rafterSpacing?: number;
    attachmentSpacing?: number;
    batteryBrand?: string;
    batteryModel?: string;
    batteryCount?: number;
    batteryKwh?: number;
    batteryBackfeedA?: number;
    generatorBrand?: string;
    generatorKw?: number;
    interconnectionMethod?: string;
    panelBusRating?: number;
    // User-selected brand-integrated BOS device(s) — combiner/gateway/"brains"
    // (ids from lib/equipment/integratedBos). When set, overrides the auto-config
    // (the design-studio picker will write this). Read by buildIntegratedEquipment.
    bosDeviceIds?: string[];
    combinerId?: string;
    // Installer preference: cut the AC trunk at row transitions (splice pair per
    // within-branch transition) instead of the cheapest-option service loop.
    // Read by bomForPermit → generateBOMV4 → resolveTrunkCablePlan.
    spliceAtRows?: boolean;
    // AHJ data (auto-populated server-side from ahj-national.ts)
    ahjName?: string;
    ahjWindSpeedMph?: number;
    ahjGroundSnowPsf?: number;
    ahjRoofSetbackIn?: number;
    ahjRidgeSetbackIn?: number;
    ahjNecVersion?: string;
    ahjPermitFee?: string;
    ahjPlanCheckDays?: number;
    ahjSpecialRequirements?: string[];
    // Panel positions from 3D design engine (PlacedPanel[])
    panelPositions?: Array<{
      id: string; lat: number; lng: number;
      x?: number; y?: number; tilt?: number; azimuth?: number;
      wattage?: number; row?: number; col?: number;
      systemType?: string; orientation?: string; arrayId?: string;
      // Error 5x fix: planeId is on PlacedPanel in types/index.ts and accessed
      // via `(p as any).planeId` in roofCAD.ts — must be declared here
      planeId?: string;
    }>;
    roofPlanes?: Array<{
      id: string; vertices: Array<{ lat: number; lng: number }>;
      pitch?: number; azimuth?: number; area?: number;
      edgeTypes?: string[];
      source?: string;
      confirmed?: boolean;
      planeHeightAtCenterMeters?: number;
    }>;
    // Error 5q fix: set by route.ts when roofPlanes come from CanonicalBuildingModel
    roofPlanesSource?: 'canonical_building_model' | 'survey' | 'design' | 'aerial';
    // Panel physical specs
    panelVoc?: number;
    panelIsc?: number;
    panelWeightLbs?: number;
    panelLengthIn?: number;
    panelWidthIn?: number;
    // Location fields for AHJ lookup
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    atsBrand?: string;
    atsAmpRating?: number;
    // ── Error 3e fix: APN was accessed via (project as any).apn in 5+ template ──
    // files but never declared on the type, so it was never passed from the ──
    // frontend or populated server-side. Adding it here so it can flow through ──
    // the PermitInput pipeline and reach coverSheet, sitePlan, titleBlock, etc.
    apn?: string;
    // ── Error 4a fix: Fields accessed via (project as any) but never declared ──
    // on the type — same silent-missing-data pattern as the APN bug.          ──
    // Adding them here so they can flow through the PermitInput pipeline and    ──
    // reach the permit pages that depend on them.                              ──
    projectId?: string;           // generatePermit.ts provenance doc ID
    backfeedBreakerA?: number;    // electricalPages.ts, sldAdapter.ts — PV backfeed breaker rating
    pvBackfeedA?: number;         // electricalPages.ts, sldAdapter.ts — fallback backfeed amps
    exposureCategory?: string;    // structuralPages.ts, certPages.ts — ASCE 7 Exposure Cat (A/B/C/D)
    designTempMin?: number;       // sldAdapter.ts — minimum design temperature (°C)
    conduitSize?: string;         // bomForPermit.ts — conduit trade size (e.g. '3/4', '1')
    panelModel?: string;          // titleBlock.ts — module model name
    moduleModel?: string;         // titleBlock.ts — alias for panelModel
    moduleMfr?: string;           // titleBlock.ts — module manufacturer
    inverterModel?: string;       // titleBlock.ts — inverter model (project-level override)
    inverterMfr?: string;         // titleBlock.ts — inverter manufacturer
    roofLayers?: number;          // coverSheet.ts — number of roofing material layers
    stories?: string;             // coverSheet.ts — building stories (e.g. '1', '2')
    roofLoadPsf?: number;         // coverSheet.ts — existing roof dead load (psf)
    windSpeedMph?: number;        // coverSheet.ts — wind speed (mph) from AHJ or ASCE map
    windExposure?: string;        // coverSheet.ts — wind exposure category letter
    groundSnowPsf?: number;       // coverSheet.ts — ground snow load (psf)
    seismicCategory?: string;     // coverSheet.ts — seismic design category (A-F)
    ahj?: string;                 // titleBlock.ts — Authority Having Jurisdiction name
    attachmentCount?: number;     // bomForPermit.ts — total roof attachments
    railSections?: number;        // bomForPermit.ts — rail sections count
    rackingId?: string;           // bomForPermit.ts — racking system identifier
    batteryId?: string;           // bomForPermit.ts — battery system identifier
    framingType?: string;         // generatePermit.ts — 'rafter' | 'truss' | 'stick'
    rafterSpan?: number;          // generatePermit.ts — rafter span (ft)
    rafterSpecies?: string;       // generatePermit.ts — wood species for structural calc
    // ── Fence / Ground structural overrides (read by canonical.ts from project level) ──
    postEmbedFt?: number;         // fence post embedment depth (ft)
    postSpacingFt?: number;       // fence post spacing O.C. (ft)
    panelHeightFt?: number;       // fence panel height (ft)
    soilResistance?: number;      // soil passive resistance (lbs/ft²)
    pileDepthFt?: number;         // ground mount pile depth (ft)
    pileSpacingFt?: number;       // ground mount pile spacing (ft)
    groundClearIn?: number;       // ground clearance (inches)
    tiltDeg?: number;             // array tilt override (degrees)
    // ── Equipment overrides (read by helpers.ts resolveEquipment() as fallback) ──
    panelManufacturer?: string;   // module manufacturer override
    panelBrand?: string;          // alias for panelManufacturer
    panelWatts?: number;          // module wattage override
    inverterBrand?: string;       // inverter manufacturer alias
    inverterManufacturer?: string;// inverter manufacturer override (project-level)
    inverterType?: string;        // inverter type override (project-level)
    inverterAcOutputKw?: number;  // inverter AC output override (project-level)
    // ── Server-injected canonical (set by generatePermit.ts, read by sheet renderers) ──
    _canonical?: CanonicalInput;  // authoritative canonical model injected at permit-gen time
  };
  // ── Server-injected plan set ID (set by generatePermit.ts, read by CAD appendix) ──
  planSetId?: string;
  // ── Plan set generation options (set by caller, read by sheet renderers) ──
  cadAppendixPreviewV1?: boolean;
  planSetOptions?: { cadAppendixPreviewV1?: boolean; includeInternalValidation?: boolean };
  permitOptions?: { cadAppendixPreviewV1?: boolean; includeInternalValidation?: boolean };
  // ── Engineering data (read by canonical.ts for structural calc) ──
  engineering?: unknown | null;
  // Error 5q fix: canonical model + bridge — set by permit route, read by roofCAD.ts
  _canonicalBuildingModel?: import('@/lib/siteSurveys/unifiedGeometry/types').CanonicalBuildingModel;
  _canonicalCADBridge?: import('@/lib/cad/canonicalBridge').CanonicalBridgeResult;
  canonicalBuildingModel?: import('@/lib/siteSurveys/unifiedGeometry/types').CanonicalBuildingModel;
  // Error 5q fix: top-level projectId (read by route.ts hub lookup)
  projectId?: string;
  // Request mode fields (sent by frontend, used by route.ts)
  mode?: string;
  permitMode?: string;
  intent?: string;
  draft?: boolean;
  allowLegacyRoofGeometry?: boolean;
  canonical_building_model?: import('@/lib/siteSurveys/unifiedGeometry/types').CanonicalBuildingModel;
  system: {
    totalDcKw: number;
    totalAcKw: number;
    totalPanels: number;
    dcAcRatio: number;
    topology: string;
    inverters: Array<{
      manufacturer: string;
      model: string;
      type: string;
      acOutputKw: number;
      maxDcVoltage: number;
      efficiency: number;
      ulListing: string;
      // Error 5c fix: mpptChannels accessed via (inv0 as any)?.mpptChannels in sldAdapter.ts
      mpptChannels?: number;
      /** Per-subsystem tag (contract §1.3 permit carriage — derived cache,
       *  re-stamped from panel stamps; see docs/ARCHITECTURE-per-subsystem-equipment.md). */
      subSystemKey?: import('@/lib/system/subSystemEquipment').SubSystemKey;
      strings: Array<{
        label: string;
        panelCount: number;
        panelManufacturer: string;
        panelModel: string;
        panelWatts: number;
        panelVoc: number;
        panelIsc: number;
        wireGauge: string;
        wireLength: number;
        // FIX v47.318: FIX7 conductor schedule fields (added by v47.315)
        isc?: number;
        ampacity?: number;
        ocpd?: number;
        voltageDrop?: number;
      }>;
    }>;
    // Error 5l fix: modules[] is an alternative payload shape accessed via (system as any)?.modules
    // in helpers.ts resolveEquipment(). Some API routes send panel data in this format.
    modules?: Array<{
      manufacturer?: string;
      panelManufacturer?: string;
      model?: string;
      panelModel?: string;
      watts?: number;
      panelWatts?: number;
      voc?: number;
      panelVoc?: number;
      isc?: number;
      panelIsc?: number;
    }>;
  };
  compliance: {
    overallStatus: string;
    jurisdiction?: {
      state: string;
      necVersion: string;
      ahj: string;
      permitNotes?: string;
    };
    electrical?: ElectricalCompliance;
    structural?: StructuralCompliance;
  };
  rulesResult?: {
    overallStatus: string;
    errorCount: number;
    warningCount: number;
    autoFixCount: number;
    overrideCount: number;
    rules: Array<{
      ruleId: string;
      category: string;
      severity: string;
      title: string;
      message: string;
      value?: string | number;
      limit?: string | number;
      necReference?: string;
      asceReference?: string;
      autoFixed?: boolean;
      autoFixDescription?: string;
    }>;
    structuralAutoResolutions?: Array<{
      field: string;
      originalValue: string | number;
      resolvedValue: string | number;
      reason: string;
      necReference: string;
    }>;
  };
  bom?: Array<{
    // Core identity (always present)
    category: string;
    manufacturer: string;
    model: string;
    partNumber: string;
    quantity: number;
    unit: string;
    // V4 BOM fields (populated when bom is generated from BOM engine V4)
    id?: string;
    stageId?: string;
    stageLabel?: string;
    description?: string;
    necReference?: string;
    derivedFrom?: string;
    formula?: string;
    notes?: string;
    required?: boolean;
    unitCost?: number;
    totalCost?: number;
    // Legacy compat
    ulListing?: string;
  }>;
  overrides?: Array<{
    field: string;
    overrideValue: string | number;
    justification: string;
    engineer: string;
    timestamp: string;
  }>;
  // v47.307: Bill Intelligence Layer integration — optional, additive
  utility?: {
    electricityRate?:  number | null;
    rateSource?:       'bill-derived' | 'electric-subtotal' | 'utility-db' | 'manual' | 'unknown';
    utilityName?:      string | null;
    monthlyKwh?:       number | null;
    annualKwh?:        number | null;
    billInsights?: {
      combinedUtilityDetected: boolean;
      detectedServices:        string[];
      electricSubtotal:        number | null;
      billDerivedRate:         number | null;
      rateSource:              'existing' | 'bill-derived' | 'electric-subtotal';
      confidence:              'high' | 'medium' | 'low';
      suggestedRate:           number | null;
      overrideRecommended:     boolean;
    } | null;
  };
  // Survey photo/physical-data evidence used to trace permit and CAD assumptions.
  // Optional and additive: missing evidence is rendered as warnings, not as a generation blocker.
  surveyEvidence?: EngineeringSurveyEvidence;
  documentProvenance?: DocumentProvenanceBundle;
  decisionProvenance?: EngineeringDecisionEvaluationBundle;
  decisionAwareReadinessSummary?: DecisionAwareReadinessSummary;
  decisionAwareBOMMetadata?: DecisionAwareBOMMetadata[];
  decisionAwareSLDMetadata?: DecisionAwareSLDMetadata;
  engineeringStateRegistry?: EngineeringStateRegistry;
  invalidationLineage?: EngineeringInvalidationLineageMetadata;
  selectiveRegenerationPlan?: SelectiveRegenerationPlan;
  aerialData?: {
    imageBase64?: string;
    imageWidth?: number;
    imageHeight?: number;
    lat?: number;
    lng?: number;
    zoom?: number;
    centerSource?: 'array' | 'segment' | 'pin' | 'nearmap_roof';
    imageSource?: 'nearmap' | 'google';
    roofSegments?: Array<{
      pitchDegrees: number;
      azimuthDegrees: number;
      areaM2: number;
      polygon?: Array<{ lat: number; lng: number }>;
      center?: { lat: number; lng: number };
    }>;
    error?: string;
  };
  // ─── Layout data for ground mount + solar fence ───
  layout?: {
    // Solar Fence
    fenceSegments?: Array<{
      id: string;
      startPoint: { lat: number; lng: number; x?: number; y?: number };
      endPoint:   { lat: number; lng: number; x?: number; y?: number };
      lengthFt:   number;
      azimuth:    number;   // compass bearing of this segment
      panelCount: number;
      tilt?:      number;   // degrees from horizontal (default 90 for fence)
      bifacial?:  boolean;
      label?:     string;
    }>;
    fenceTotalLengthFt?: number;
    fenceGateOpenings?:  Array<{ positionFt: number; widthFt: number }>;
    fencePostSpacingFt?: number;
    fencePostEmbedmentFt?: number;
    fenceRailCount?:     number;
    fencePanelHeightFt?: number;
    // Ground Mount
    groundArrays?: Array<{
      id: string;
      rowCount:    number;
      panelsPerRow: number;
      tiltDeg:     number;
      azimuth:     number;
      rowSpacingFt: number;
      groundClearanceIn: number;
      structureType: string; // 'driven_pile' | 'concrete_pier' | 'ballast'
      pileDepthFt?: number;
      pileSpacingFt?: number;
    }>;
    groundSetbackFt?: number;
    // Layout-level system type (from layouts.system_type in DB) — authoritative fallback
    systemType?: string;
    // Raw fence line points (from layouts.fence_line)
    fenceLine?: Array<{ lat: number; lng: number }>;
    // ═══ Canonical Layout Fields (v47.313) ═══════════════════════════════
    // These three fields are the SINGLE SOURCE OF TRUTH for the planset.
    // The frontend MUST populate all three. buildCanonical() throws if absent.
    // type:     system classification — "roof" | "ground_mount" | "solar_fence"
    // panels:   authoritative panel array from the 3D layout engine
    // geometry: system-specific geometry (roof planes / ground arrays / fence segments)
    type?: string;    // AUTHORITATIVE — from layouts.system_type
    panels?: Array<{
      id: string; lat: number; lng: number;
      x?: number; y?: number; tilt?: number; azimuth?: number;
      wattage?: number; row?: number; col?: number;
      systemType?: string; orientation?: string;
      // Error 5k fix: placementType is read by buildCanonical() for system type detection
      placementType?: 'ROOF' | 'GROUND' | 'FENCE';
    }>;
    geometry?: {
      roofPlanes?:     Array<{ id: string; vertices: Array<{ lat: number; lng: number }>; pitch?: number; azimuth?: number; area?: number; edgeTypes?: string[] }>;
      fenceSegments?:  Array<{ id: string; startPoint: { lat: number; lng: number }; endPoint: { lat: number; lng: number }; lengthFt: number; azimuth: number; panelCount: number }>;
      groundArrays?:   Array<{ id: string; rowCount: number; panelsPerRow: number; tiltDeg: number; azimuth: number; rowSpacingFt: number }>;
    };
  };
}

// ═══ Canonical Pipeline Types (v47.313) ═══

/** Normalized system type — canonical form only. */
export type CanonicalSysType = 'roof' | 'ground_mount' | 'solar_fence';

/** Validated, layout-derived input consumed by the planset generator. */
export interface CanonicalModule {
  manufacturer: string;
  model:        string;
  wattage:      number;
  voc:          number;
  isc:          number;
}

/** Site-level loading parameters — sourced from compliance.structural + jurisdiction */
export interface CanonicalSite {
  windSpeed:        number;    // mph — from compliance.structural.wind.windSpeed
  groundSnowLoad:   number;    // psf — from compliance.structural.snow.groundSnowLoad
  exposureCategory: string;    // ASCE 7-22 Exposure Category (A/B/C/D)
  seismicSDC:       string;    // Seismic Design Category
  state:            string;    // state abbreviation
  ahj:              string;    // Authority Having Jurisdiction
}

/** Structural geometry — sourced from CAD engine / layout */
export interface CanonicalStructure {
  // Fence
  postEmbedFt:    number;    // post embedment depth (ft)
  postSpacingFt:  number;    // post spacing O.C. (ft)
  panelHeightFt:  number;    // fence panel height (ft)
  soilResistance: number;    // soil passive resistance (lbs/ft² — default 200)
  // Ground
  pileDepthFt:    number;    // pile embedment depth (ft)
  pileSpacingFt:  number;    // pile spacing O.C. (ft)
  groundClearIn:  number;    // ground clearance (inches)
  tiltDeg:        number;    // array tilt angle (degrees)
  // Roof
  rafterSize:     string;    // e.g. "2×6"
  rafterSpacingIn: number;   // rafter spacing (inches O.C.)
  attachSpacingIn: number;   // attachment spacing (inches O.C.)
}

/** Electrical summary — sourced from system/compliance */
export interface CanonicalElectrical {
  totalPanels:    number;
  totalDcKw:      number;
  moduleWattage:  number;
  voc:            number;
  isc:            number;
  strings:        number;
  inverterModel:  string;
  inverterKw:     number;
}

/** System layout dimensions — sourced from CAD engine after solve */
export interface CanonicalLayoutDimensions {
  totalLengthFt:   number;   // total system length (fence: run; ground: array width; roof: plane width)
  totalHeightFt:   number;   // total system height (fence: panel height; ground: depth; roof: plane height)
  panelWidthIn:    number;   // module width (inches)
  panelHeightIn:   number;   // module height (inches)
  rowSpacingFt:    number;   // row-to-row or post spacing (ft)
  columnSpacingFt: number;   // column spacing (panel width + gap, ft)
  source:          string;   // which CAD field sourced the data
}

export interface CanonicalInput {
  systemType:       CanonicalSysType;
  /** Set when the design contains panels of MORE THAN ONE system type (e.g.
   *  roof+ground+fence hybrid). The pipeline currently documents only
   *  `systemType` — consumers must surface this as NOT-PERMIT-READY. */
  hybridSystemTypes?: string[];
  /** Phase-1 hybrid support: the per-type partition of the design's panels
   *  (roof→ground→fence). Always ≥1 entry. Consumers iterate this instead of
   *  reading the single `systemType` scalar. */
  subSystems?: import('./utils/subSystems').SubSystem[];
  panels:           NonNullable<NonNullable<PermitInput['layout']>['panels']>;
  geometry:         NonNullable<PermitInput['layout']>['geometry'];
  layout:           NonNullable<PermitInput['layout']>;
  engineering:      unknown | null;
  module:           CanonicalModule;
  mountSystem:      string;  // locked to canonical.systemType via MOUNT_SYSTEM_MAP
  site:             CanonicalSite;
  structure:        CanonicalStructure;
  electrical:       CanonicalElectrical;
  layoutDimensions: CanonicalLayoutDimensions | null;  // populated post-CAD by buildLayoutDimensions()
}

// ─── Equipment Resolver Types ───

export interface ResolvedEquipment {
  panelManufacturer: string;
  panelModel: string;
  panelWatts: number;
  panelVoc: number;
  panelIsc: number;
  inverterManufacturer: string;
  inverterModel: string;
  inverterType: string;
  inverterAcOutputKw: number;
}

// ─── Drawing Types ───

export interface DimOpts {
  color?:       string;  // default #c00
  fontSize?:    number;  // default 7
  tickLen?:     number;  // default 5 (half-tick length px)
  offset?:      number;  // offset from line to text (px, default 8)
  arrowLen?:    number;  // arrow head length (px, default 7)
}

// ═══════════════════════════════════════════════════════════════
// Pre-existing permit types (preserved from original lib/permit/types.ts)
// ═══════════════════════════════════════════════════════════════

export interface PermitCoverData {
  // Project identification
  projectName: string;
  clientName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  apn?: string;

  // Jurisdiction
  ahj: string;
  utility: string;
  necVersion: string;
  ibcVersion: string;
  ifcVersion: string;

  // System sizing
  systemSizeKWDC: number;
  systemSizeKWAC: number;
  moduleCount: number;
  moduleModel: string;
  moduleManufacturer: string;
  moduleWatts: number;
  inverterModel: string;
  inverterManufacturer: string;
  inverterType: 'microinverter' | 'string_inverter' | 'optimizer';
  mountingSystem: string;

  // Battery (optional)
  batteryCount?: number;
  batteryModel?: string;
  batteryManufacturer?: string;
  batteryConfig?: string;

  // Interconnection
  interconnectionMethod: string;
  backfeedAmps: number;
  mainPanelAmps: number;
  mainBreakerDeRatePass: boolean;

  // Structural / design criteria
  roofType: string;
  roofPitch: string;
  roofFraming: string;
  stories: string;
  roofLayers: number;
  roofLoadPsf: number;
  windSpeedMph: number;
  windExposure: string;
  exposureCategory: string;
  groundSnowPsf: number;

  // Satellite / vicinity map
  satelliteImageBase64?: string;   // data:image/jpeg;base64,... from Google Maps Static API
  satelliteImageUrl?: string;      // URL used to fetch the image (for cache/regen)
  satelliteLat?: number;
  satelliteLng?: number;

  // Engineering company branding
  engineerCompany: string;
  engineerAddress: string;
  engineerPhone?: string;

  // Sheet metadata
  preparedDate: string;            // ISO date string
  designer: string;
  revision: string;

  // Sheet index (auto-generated from available sheets)
  sheets: PermitSheetIndexEntry[];

  // Construction notes (NEC-cited, system-config-aware)
  constructionNotes: string[];
}

export interface PermitSheetIndexEntry {
  id: string;           // e.g. 'PV-0', 'PV-1', 'E-1'
  title: string;        // e.g. 'Cover Sheet'
  description?: string; // e.g. 'Project overview, sheet index, aerial view'
}

// ─── Full permit planset sheet definitions ────────────────────────────────────

// Canonical permit plan-set — matches generatePermitHTML() page assembly order.
// PV-1 (standalone site plan) folded into the array sheet 2026-07-08.
// Page indices (0-based) must match exactly:
//   0=PV-0  1=PV-1  2=PV-1B  3=PV-3  4=PV-4A  5=PV-4B  6=PV-4C
//   7=PV-5  8=SCHED  9=APP-A  10=CERT  11=PE-1  12=E-1  13=VAL-1  14=APP-CAD
export type PermitSheetId =
  | 'PV-0'   // Cover Sheet
  | 'PV-1'   // Site & Array Plan (Roof / Ground / Fence — system-routed; integrated site context)
  | 'PV-1B'  // Array Geometry & String Layout
  | 'PV-3'   // Structural Details (Roof / Ground / Fence — system-routed)
  | 'PV-4A'  // NEC Compliance
  | 'PV-4B'  // Conductor Schedule
  | 'PV-4C'  // Structural Calculations (ASCE 7-22)
  | 'PV-5'   // Warning Labels
  | 'SCHED'  // Equipment Schedule
  | 'APP-A'  // Specification Sheets
  | 'CERT'   // Engineering Certification
  | 'PE-1'   // PE Structural Letter
  | 'E-1'    // Single-Line Diagram
  | 'VAL-1'  // Validation Summary
  | 'APP-CAD'; // CAD Preview Appendix

export const PERMIT_SHEET_INDEX: PermitSheetIndexEntry[] = [
  { id: 'PV-0',  title: 'Cover Sheet',                 description: 'Project overview, sheet index, aerial view, design criteria, governing codes' },
  { id: 'PV-1',  title: 'Site & Array Plan',            description: 'Integrated site + roof/ground/fence array: property line, street, service equipment, panel placement, fire setbacks' },
  { id: 'PV-1B', title: 'Array Geometry',               description: 'Array dimensions, string assignments, tilt, spacing, module layout detail' },
  { id: 'PV-3',  title: 'Structural Details',           description: 'Attachment cross-section / pile detail / fence post detail (system-specific)' },
  { id: 'PV-4A', title: 'NEC Compliance',               description: 'NEC 690/705 rules engine results, 120% busbar rule, code citations' },
  { id: 'PV-4B', title: 'Conductor Schedule',           description: 'Wire sizing, conduit schedule, voltage drop calcs, temperature correction' },
  { id: 'PV-4C', title: 'Structural Calculations',      description: 'ASCE 7-22 wind/snow load analysis, dead load, rafter/attachment calcs' },
  { id: 'PV-5',  title: 'Warning Labels',               description: 'NEC-required rapid shutdown, arc-flash, and system identification labels' },
  { id: 'SCHED', title: 'Equipment Schedule',           description: 'Equipment list, model numbers, electrical ratings, quantities, BOM' },
  { id: 'APP-A', title: 'Specification Sheets',         description: 'Module, inverter, and racking cut sheet references with NEC 690.8 calcs' },
  { id: 'CERT',  title: 'Engineering Certification',    description: 'Engineering stamp, certification statement, revision history, document control' },
  { id: 'PE-1',  title: 'PE Structural Letter',         description: 'Licensed PE review letter with ASCE 7-22 analysis and structural attestation' },
  { id: 'E-1',   title: 'Single-Line Diagram',          description: 'Complete electrical SLD — IEEE/ANSI symbols, wire gauges, OCP ratings, grounding' },
  { id: 'VAL-1', title: 'Validation Summary',           description: 'Canonical validation summary and engineering readiness checks' },
  { id: 'APP-CAD', title: 'CAD Preview Appendix',       description: 'Preview-only CAD SVG appendix; non-authoritative and not a PV-1/PV-3 replacement' },
];

// ─── Satellite image result (from satelliteService) ───────────────────────────

export interface SatelliteImageResult {
  imageBase64: string;        // data:image/jpeg;base64,...
  imageUrl: string;           // the static maps URL used
  lat: number;
  lng: number;
  zoom: number;
  widthPx: number;
  heightPx: number;
  error?: string;
}

// ─── Permit artifact (stored in project_files) ────────────────────────────────

export interface PermitArtifact {
  fileName: string;
  fileType: 'permit_cover_sheet' | 'permit_planset' | 'engineering';
  mimeType: string;
  content: string;            // HTML string for cover sheet PDF
  notes: string;
}