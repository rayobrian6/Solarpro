'use client';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { computeSystem, type ComputedSystem, type ComputedSystemInput } from '@/lib/computed-system';
import AppShell from '@/components/ui/AppShell';
import PlanGate from '@/components/ui/PlanGate';
import { useSubscription } from '@/hooks/useSubscription';
import {
  Zap, Download, Printer, Plus, Trash2, Settings,
  ChevronDown, ChevronRight, Sun, Shield, AlertTriangle,
  FileText, Home, CheckCircle, Info, Grid, Layers,
  MapPin, Activity, BarChart2, Wrench, RefreshCw,
  XCircle, AlertCircle, TrendingUp, Book, Cpu,
  Wind, Snowflake, Weight, Ruler, ClipboardCheck,
  ChevronUp, Eye, EyeOff, Lock, Stamp, Package, Cpu as CpuIcon,
  FolderOpen, Upload, File, Image, FileBadge, ExternalLink,
  DollarSign, Power, Battery, GitBranch
} from 'lucide-react';
import { SOLAR_PANELS, STRING_INVERTERS, MICROINVERTERS, RACKING_SYSTEMS, OPTIMIZERS, BATTERIES, GENERATORS, ATS_UNITS, getBatteryById, getGeneratorById, getATSById, getBackupInterfaceById } from '@/lib/equipment-db';
import { getAllMountingSystems, getMountingSystemsByCategory, getMountingSystemsByRoofType, type MountingSystemSpec, type SystemCategory as MountingCategory } from '@/lib/mounting-hardware-db';

// ── Mounting systems from the canonical mounting-hardware-db (38 systems, 24 manufacturers) ──
const ALL_MOUNTING_SYSTEMS: MountingSystemSpec[] = getAllMountingSystems();
const MOUNTING_BRANDS: string[] = Array.from(new Set(ALL_MOUNTING_SYSTEMS.map(s => s.manufacturer))).sort();
import { BUILD_VERSION, BUILD_DATE, BUILD_FEATURES } from '@/lib/version';
// Phase 11 — brand-driven sizing recommendation UI
import { sizeSystemFromBrand, type SystemSizingResult } from '@/lib/system/sizingEngine';
import {
  SizingRecommendation,
  type CurrentConfigSnapshot,
  detectStringLayoutMismatch,
} from '@/components/engineering/SizingRecommendation';
// MASTER TASK — panel count source of truth. Sizing engine / UI displays
// MUST read from CAD → SystemDefinition → config (fallback), never directly
// from inverter.strings[].panelCount (which can be stale).
import { resolveSystemPanelCount } from '@/lib/system/panelCountSource';
// Phase 12 — System-wide validation layer.
import { validateSystem, type ValidationResult } from '@/lib/system/validationEngine';
import { ValidationPanel } from '@/components/engineering/ValidationPanel';
import EcosystemPicker, { type EcosystemApplyPayload } from '@/components/engineering/EcosystemPicker';
// v47.423 — Panel↔brand compatibility auto-swap banner.
import { PanelCompatibilityBanner } from '@/components/engineering/PanelCompatibilityBanner';
// Phase 12.5 — Unified inverter-count semantics (physicalUnits vs logicalGroups).
import { diffNormalizedInverterState } from '@/lib/system/normalizedInverter';
// Phase 13 — Smart defaults (once-only initialization layer).
// Applies a valid working system to a fresh project exactly ONCE. Never
// overrides user edits after that. The sizing engine remains the single
// source of system logic — this module is pure bookkeeping + a thin call
// to sizeSystemFromBrand() and hydration of the result into config.
import { applySmartDefaultsOnce } from '@/lib/system/smartDefaults';
// Phase 13.7 — Feasibility-driven Fix Engine
import { applyFeasibleFix } from '@/lib/system/fixEngine';
// Phase 13.9 — Brand inference from current inverter (prevents stale selectedBrand mismatch loop)
import { getBrandProfileByInverterId, getBrandProfile } from '@/lib/system/brandProfiles';
import { getUtilitiesByState } from '@/lib/utility-rules';
// Phase B2 — Decision Consistency Lock: canonical DC/AC ratio helpers
import { calcDcAcRatio } from '@/lib/system/calcDcAcRatio';
import { DC_AC_TARGET } from '@/lib/system/dcAcConstants';
import { getUtilitiesByStateNational, STATE_UTILITY_FALLBACK } from '@/lib/utilityDetector';
import { lookupAhj } from '@/lib/jurisdictions/ahj';
import { getAhjsByState } from '@/lib/computed-plan';
import { searchAhj } from '@/lib/jurisdictions/ahj-national';

// ── Auto-detect state + utility from address string ──────────────────────────
/**
 * Calculate total battery backfeed breaker amps for NEC 705.12(B) bus loading.
 *
 * KEY RULE: Gateway-based systems (Enphase IQ, Tesla Powerwall) use ONE shared
 * backfeed breaker for ALL units — the gateway/controller is the single point of
 * interconnection. Non-gateway systems (Franklin WH, SolarEdge Home Battery)
 * each require their own dedicated breaker, so multiply by count.
 *
 * References:
 *   - Enphase IQ Battery install guide: single 20A/40A breaker per system (not per unit)
 *   - Tesla Powerwall install guide: single 50A breaker per Backup Gateway
 *   - NEC 705.12(B)(2): each separately-fused backfeed source counts
 */
function calcBatteryBackfeedAmps(batteryId: string | undefined, batteryCount: number): number {
  if (!batteryId) return 0;
  const b = getBatteryById(batteryId);
  if (!b || !b.backfeedBreakerA) return 0;
  // Gateway-based: single shared breaker regardless of unit count
  if (b.requiresGateway) return b.backfeedBreakerA;
  // Non-gateway: each unit has its own breaker
  const qty = batteryCount && batteryCount > 0 ? batteryCount : 1;
  return b.backfeedBreakerA * qty;
}

function parseStateFromAddress(address: string): string | null {
  if (!address) return null;
  // Match "City, ST 12345" or "City, ST" or ", ST " patterns
  const stateAbbrevMatch = address.match(/,\s*([A-Z]{2})(?:\s+\d{5})?(?:\s*,|\s*$)/);
  if (stateAbbrevMatch) {
    const code = stateAbbrevMatch[1];
    const validStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
      'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
      'VT','VA','WA','WV','WI','WY','DC'];
    if (validStates.includes(code)) return code;
  }
  // Match full state names
  const stateNames: Record<string, string> = {
    'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
    'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
    'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
    'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
    'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
    'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
    'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
    'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
    'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
    'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
    'district of columbia':'DC','washington dc':'DC','washington d.c.':'DC',
  };
  const lower = address.toLowerCase();
  for (const [name, code] of Object.entries(stateNames)) {
    if (lower.includes(name)) return code;
  }
  return null;
}

function parseCityFromAddress(address: string): string | null {
  if (!address) return null;
  // "123 Main St, Chicago, IL 60601" → "Chicago"
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    // Second-to-last part before state is usually city
    const cityPart = parts[parts.length - 2];
    if (cityPart && !/^\d/.test(cityPart)) return cityPart;
  }
  return null;
}

// ── Types ──────────────────────────────────────────────────────────────────
// v47.418 — 'hybrid' added as first-class member for Sol-Ark and other
// hybrid (battery-capable) inverters. 'ecoflow' retained as legacy alias.
type InverterType = 'string' | 'micro' | 'optimizer' | 'hybrid' | 'ecoflow';
type RoofType = 'shingle' | 'tile' | 'metal_standing_seam' | 'metal_corrugated' | 'flat_tpo' | 'flat_epdm' | 'flat_gravel';
type SystemType = 'roof' | 'ground' | 'fence';
type TabId = 'config' | 'compliance' | 'electrical' | 'diagram' | 'schedule' | 'structural' | 'mounting' | 'permit' | 'bom' | 'files';

interface StringConfig {
  id: string;
  label: string;
  panelCount: number;
  panelId: string;
  tilt: number;
  azimuth: number;
  roofType: RoofType;
  mountingSystem: string;
  wireGauge: string;
  wireLength: number;
  ocpdOverride?: number;
  ocpdOverrideAcknowledged?: boolean;
}

interface InverterConfig {
  id: string;
  inverterId: string;
  type: InverterType;
  strings: StringConfig[];
  // User-controlled ratio overrides — override registry defaults
  deviceRatioOverride?: number;   // micro: modules per microinverter; optimizer: optimizers per module
  modulesPerString?: number;      // string: modules per string (informational, used for string count display)
  stringsPerInverter?: number;    // string: strings per inverter (informational)
  // v58.6: For optimizer topology, peripheral optimizer ID (e.g. 'se-p505') stored separately
  // from inverterId (which holds the central string inverter, e.g. 'se-11400h').
  // inverterId -> brand inference + sizing engine
  // optimizerPeripheralId -> BOM Stage 1 optimizer line items
  optimizerPeripheralId?: string;
}

interface ProjectConfig {
  projectName: string;
  clientName: string;
  address: string;
  state: string;          // Explicit state code (e.g. 'CA', 'TX') — overrides address parsing
  city: string;           // City name — used for AHJ city-level overrides
  county: string;         // County name — used for AHJ county-level overrides
  designer: string;
  date: string;
  systemType: SystemType;
  inverters: InverterConfig[];
  batteryBrand: string;
  batteryModel: string;
  batteryCount: number;
  batteryKwh: number;
  batteryId: string;        // equipment-db battery ID — drives NEC 705.12(B) bus impact calc
  generatorId: string;      // equipment-db generator ID
  generatorWireLength: number;  // ft — distance from generator to ATS (user-configurable)
  atsId: string;            // equipment-db ATS ID
  backupInterfaceId: string; // equipment-db backup interface ID (Enphase IQ SC3, Tesla Gateway, etc.)
  mainPanelAmps: number;
  mainPanelBrand: string;
  utilityMeter: string;
  acDisconnect: boolean;
  dcDisconnect: boolean;
  productionMeter: boolean;
  rapidShutdown: boolean;
  roofType: RoofType;
  mountingId: string;
  wireGauge: string;
  conduitType: string;
  wireLength: number;
  windSpeed: number;
  windExposure: 'B' | 'C' | 'D';
  groundSnowLoad: number;
  roofPitch: number;
  rafterSpacing: number;
  rafterSpan: number;
  rafterSize: string;
  rafterSpecies: string;
  framingType: 'truss' | 'rafter' | 'unknown';  // V3 structural engine
  meanRoofHeight?: number;              // ft — mean height of eave to ridge midpoint (ASCE 7 Kz)
  panelOrientation?: 'portrait' | 'landscape';  // V3 array geometry
  attachmentSpacing: number;
  railSpacing: number;           // inches — distance between rail rows (row-to-row)
  // Layout fields (Phase 3 - Future Layout Engine)
  rowCount?: number;
  columnCount?: number;
  layoutOrientation?: 'portrait' | 'landscape';
  panelCoordinates?: Array<{ x: number; y: number; row: number; col: number; }>;
  notes: string;
  // Interconnection method
  interconnectionMethod: 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MAIN_BREAKER_DERATE' | 'PANEL_UPGRADE';
  panelBusRating: number;        // Bus bar rating (may differ from mainPanelAmps)
  // Utility + AHJ (persisted to project, used by interconnection + compliance)
  utilityId: string;             // e.g. 'ameren', 'comed', 'pge' — '' = auto/unknown
  ahjId: string;                 // e.g. 'il-icc', 'manual' — '' = auto
  // v44.0 optional fields — site geometry, equipment locations, mounting hardware, contractor
  roofWidth?: number;            // approximate roof width (ft) — for A-1 site layout
  roofLength?: number;           // approximate roof length ridge-to-eave (ft) — for A-1
  inverterLocation?: string;     // e.g. 'Garage wall, south side'
  disconnectLocation?: string;   // e.g. 'Adjacent to inverter'
  meterLocation?: string;        // e.g. 'North exterior wall'
  mainPanelLocation?: string;    // e.g. 'Garage, east wall'
  railType?: string;             // e.g. 'IronRidge XR-100'
  flashingType?: string;         // e.g. 'Flashed L-Foot'
  lagBoltSize?: string;          // e.g. '5/16" × 3"'
  sheathingType?: string;        // e.g. '7/16" OSB'
  contractorLicense?: string;    // contractor license number
  electricalLicense?: string;    // electrical contractor license number
  ownerPhone?: string;           // owner contact phone
  ownerEmail?: string;           // owner contact email
  zip?: string;                  // ZIP code — used for AHJ lookup
  // Phase 13 — Smart Defaults sentinel + seed brand.
  // `defaultsApplied` is set exactly ONCE by applySmartDefaultsOnce() and
  // must remain true until the user explicitly resets the system (via the
  // reset hook clearDefaultsAppliedFlag). It blocks the defaults layer
  // from ever overriding user edits after the first bootstrap.
  // `selectedBrand` records the seed brand chosen by the defaults layer
  // (only when the user had not already picked one). The user may freely
  // overwrite it later; defaults will NOT re-fire on brand changes.
  defaultsApplied?: boolean;
  selectedBrand?: string;
  // Phase 13.1 — USER INTENT LOCK.
  // Set to `true` the moment the user touches ANY inverter / string field
  // (model, count, layout, topology). Once this flag is on:
  //   - Smart defaults (smartDefaults.useEffect) is a hard no-op.
  //   - Auto-apply of the sizing recommendation is a hard no-op.
  // Only an explicit user action flips it off again:
  //   - Clicking "Apply Recommendation" (user has now adopted the system's
  //     plan as-is — treat it as no longer "edited away from rec").
  //   - "Reset System" (clearDefaultsAppliedFlag + clear inverters).
  // NON-NEGOTIABLE: the sizing engine MAY still compute a recommendation
  // for display, but it MUST NOT mutate the user's config once this lock
  // is engaged. Source of truth is always the user config.
  userHasEditedInverters?: boolean;
}

interface ComplianceResult {
  overallStatus: 'PASS' | 'WARNING' | 'FAIL' | null;
  utilityName?: string;
  jurisdiction?: any;
  electrical?: any;
  structural?: any;
  autoDetected?: any;
  stringConfig?: {
    totalStrings: number;
    panelsPerString: number;
    lastStringPanels: number;
    maxPanelsPerString: number;
    minPanelsPerString: number;
    recommendedPanelsPerString: number;
    designTempMin: number;
    tempCorrectionFactor: number;
    vocCorrected: number;
    vmpCorrected: number;
    stringVoc: number;
    stringVmp: number;
    stringIsc: number;
    totalDcPower: number;
    totalDcVoltageMax: number;
    totalDcCurrentMax: number;
    ocpdPerString: number;
    dcWireAmpacity: number;
    combinerType: string;
    combinerLabel: string;
    mpptChannels: Array<{ channelIndex: number; stringCount: number; totalPower: number; totalIsc: number }>;
    dcAcRatio: number;
    warnings: string[];
    errors: string[];
    isValid: boolean;
  } | null;
}

// ── Constants ──────────────────────────────────────────────────────────────
const ROOF_TYPES: Record<RoofType, { label: string; attachment: string; hardware: string; notes: string }> = {
  shingle: { label: 'Asphalt Shingle', attachment: 'Flashed L-Foot with lag bolt into rafter', hardware: 'IronRidge XR100 rail + L-feet, 5/16" × 3" lag bolts, EPDM flashing', notes: 'Locate rafters with stud finder. Min. 2.5" embedment into rafter. Flash all penetrations.' },
  tile: { label: 'Concrete / Clay Tile', attachment: 'Tile hook or tile replacement mount', hardware: 'QuickMount PV Tile Hook, or Wiehle tile replacement, 5/16" × 3" lag bolts', notes: 'Remove tile, install flashing + hook, replace tile. Do not crack tiles.' },
  metal_standing_seam: { label: 'Metal — Standing Seam', attachment: 'S-5! clamp (no penetrations)', hardware: 'S-5! PVKIT 2.0 or S-5! U-Clamp, no roof penetrations required', notes: 'No penetrations. Clamp directly to seam. Verify seam profile matches clamp model.' },
  metal_corrugated: { label: 'Metal — Corrugated / R-Panel', attachment: 'SnapNrack or Unirac corrugated mount with EPDM seal', hardware: 'SnapNrack Series 100, self-tapping screws with EPDM washers, butyl tape seal', notes: 'Drill into structural purlins only. Apply butyl tape + EPDM washer at every penetration.' },
  flat_tpo: { label: 'Flat — TPO / PVC Membrane', attachment: 'Ballasted tray (no penetrations) or heat-welded pad', hardware: 'Esdec FlatFix Fusion, Unirac RM Ballast, or SunModo EzBallast', notes: 'Ballasted systems preferred. If penetrating, use TPO-compatible flashing welded by certified roofer.' },
  flat_epdm: { label: 'Flat — EPDM Rubber', attachment: 'Ballasted tray or EPDM-bonded pad', hardware: 'Esdec FlatFix, or bonded rubber pad with stainless hardware', notes: 'Use EPDM-compatible adhesive for bonded mounts. Ballasted preferred to avoid warranty issues.' },
  flat_gravel: { label: 'Flat — Built-Up / Gravel', attachment: 'Ballasted tray system', hardware: 'Unirac RM Ballast or IronRidge ballasted flat roof system', notes: 'Clear gravel from mount footprint. Verify roof load capacity with structural engineer.' },
};

// MASTER TASK: System-type-aware panel default.
// Roof = Q CELLS 400W, Fence = Philadelphia Solar Nexus 440W (panel-fence-ps1),
// Ground = Q CELLS 400W (no dedicated default yet).
// Used by newString() and any other site that needs a seed panel ID.
function defaultPanelForSystemType(sysType?: string): string {
  if (sysType === 'fence') return 'panel-fence-ps1';
  return 'qcells-peak-duo-400';
}

// v47.357: The set of panel IDs that are recognized as "hardcoded defaults"
// (not real user choices). When we detect a fence project using one of these,
// we auto-correct to panel-fence-ps1. This preserves the non-destructive-defaults
// rule because we only swap when the current value was a default we ourselves planted.
const HARDCODED_DEFAULT_PANELS = new Set(['qcells-peak-duo-400']);

// v47.358: Set of inverter IDs that are recognized as hardcoded UI defaults
// (not real user choices). Used for fence→EcoFlow default promotion.
const HARDCODED_DEFAULT_INVERTERS = new Set<string>([
  'se-7600h',            // default for 'string' type
  'fronius-primo-8.2',   // common legacy default
]);

// Fence → EcoFlow default promotion (v47.358):
// If systemType is 'fence', topology is still 'string' (our default), AND the
// inverter is a hardcoded default (never a real user choice), promote the whole
// inverter to EcoFlow 'ecoflow-power-ocean-10kw' so SolFence projects automatically
// get EcoFlow PowerOcean as the baseline.
//
// This is a DEFAULT only — any explicit user inverter selection is preserved.
// Phase 11: kept as a library helper for future use / tests. No longer called
// from page.tsx runtime — silent promotion is prohibited.
// eslint-disable-next-line no-unused-vars
function reconcileFenceEcoFlowDefault(
  inverters: InverterConfig[],
  systemType: SystemType | undefined,
): InverterConfig[] {
  if (systemType !== 'fence') return inverters;
  let changed = false;
  const reconciled = inverters.map(inv => {
    // Only promote if:
    //  - current type is 'string' (our default topology), AND
    //  - inverterId is a hardcoded default (user never picked it explicitly)
    if (inv.type === 'string' && HARDCODED_DEFAULT_INVERTERS.has(inv.inverterId)) {
      console.log(`[INVERTER RECONCILE] Fence project detected — promoting inverter ${inv.inverterId} → ecoflow-power-ocean-10kw`);
      changed = true;
      return { ...inv, type: 'ecoflow' as InverterType, inverterId: 'ecoflow-power-ocean-10kw' };
    }
    return inv;
  });
  return changed ? reconciled : inverters;
}

// Fence auto-correction: if systemType is fence but a string is still carrying
// a roof-default panel, swap to the fence default. Returns a new inverters array
// if any change was made, or the original reference if not.
// Phase 11: kept as a library helper. No longer called from page.tsx runtime.
// eslint-disable-next-line no-unused-vars
function reconcileFencePanels(
  inverters: InverterConfig[],
  systemType: SystemType | undefined,
): InverterConfig[] {
  if (systemType !== 'fence') return inverters;
  let changed = false;
  const reconciled = inverters.map(inv => {
    const newStrings = inv.strings.map(s => {
      if (HARDCODED_DEFAULT_PANELS.has(s.panelId)) {
        changed = true;
        console.log(`[PANEL RECONCILE] Fence project detected — swapping string "${s.label}" panel ${s.panelId} → panel-fence-ps1`);
        return { ...s, panelId: 'panel-fence-ps1' };
      }
      return s;
    });
    return changed ? { ...inv, strings: newStrings } : inv;
  });
  return changed ? reconciled : inverters;
}

function newString(idx: number, sysType?: string): StringConfig {
  return { id: `str-${Date.now()}-${idx}`, label: `String ${idx + 1}`, panelCount: 10, panelId: defaultPanelForSystemType(sysType), tilt: 20, azimuth: 180, roofType: 'shingle', mountingSystem: 'ironridge-xr100', wireGauge: '#10 AWG', wireLength: 50 };
}

function newInverter(type: InverterType, sysType?: string): InverterConfig {
  // Use correct default inverterId per type — prevents cross-type ID mismatch.
  // v47.358: 'ecoflow' topology defaults to PowerOcean 10kW (middle tier).
  let defaultId: string;
  if (type === 'micro') {
    defaultId = MICROINVERTERS[0]?.id ?? 'enphase-iq8plus';
  } else if (type === 'ecoflow') {
    defaultId = 'ecoflow-power-ocean-10kw';
  } else {
    defaultId = STRING_INVERTERS[0]?.id ?? 'se-7600h';
  }
  return { id: `inv-${Date.now()}`, inverterId: defaultId, type, strings: [newString(0, sysType)] };
}

const defaultProject: ProjectConfig = {
  projectName: 'Solar Installation', clientName: '', address: '', state: '', city: '', county: '', designer: '',
  date: new Date().toISOString().split('T')[0], systemType: 'roof',
  inverters: [newInverter('string')],
  batteryBrand: '', batteryModel: '', batteryCount: 0, batteryKwh: 0,
  batteryId: '', generatorId: '', generatorWireLength: 50, atsId: '', backupInterfaceId: '',
  mainPanelAmps: 200, mainPanelBrand: 'Square D', utilityMeter: 'Bidirectional Net Meter',
  acDisconnect: true, dcDisconnect: true, productionMeter: true, rapidShutdown: true,
  roofType: 'shingle', mountingId: 'ironridge-xr100',
  wireGauge: '#10 AWG THWN-2', conduitType: 'EMT', wireLength: 50,
  windSpeed: 115, windExposure: 'C', groundSnowLoad: 20, roofPitch: 20,
  meanRoofHeight: 15,         // ft — ASCE 7-22 Kz (1-story≈15ft, 2-story≈25ft, 3-story≈35ft)
  rafterSpacing: 24, rafterSpan: 12, rafterSize: '2x6', rafterSpecies: 'Douglas Fir-Larch',
  framingType: 'unknown',  // V2 structural engine — auto-detected or user-specified
  attachmentSpacing: 48, railSpacing: 60, notes: '',
  interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200,
  utilityId: '', ahjId: '',
};

// ── Status Badge ───────────────────────────────────────────────────────────
function StatusBadge({ status, size = 'md' }: { status: 'PASS' | 'WARNING' | 'FAIL' | null; size?: 'sm' | 'md' | 'lg' }) {
  if (!status) return <span className="text-slate-500 text-xs">Not calculated</span>;
  const cfg = {
    PASS:    { bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400', icon: <CheckCircle size={size === 'lg' ? 18 : 13} />, label: 'PASS' },
    WARNING: { bg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',       icon: <AlertTriangle size={size === 'lg' ? 18 : 13} />, label: 'WARNING' },
    FAIL:    { bg: 'bg-red-500/15 border-red-500/30 text-red-400',             icon: <XCircle size={size === 'lg' ? 18 : 13} />, label: 'FAIL' },
  }[status];
  const sizeClass = size === 'lg' ? 'px-4 py-2 text-sm font-black' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-xs font-bold';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border ${cfg.bg} ${sizeClass}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// NEC code explanations lookup
const NEC_EXPLANATIONS: Record<string, { title: string; plain: string; fix: string; ref: string }> = {
  '690.7':  { title: 'Max DC Voltage', plain: 'The total string voltage at cold temperature exceeds the inverter or system maximum. NEC 690.7 requires the corrected open-circuit voltage (Voc) to stay within rated limits.', fix: 'Reduce panels per string, or choose an inverter with a higher max input voltage. Use the Auto String Config tool to find the correct count.', ref: 'NEC 690.7(A)' },
  '690.8':  { title: 'OCPD Sizing', plain: 'The overcurrent protection device (fuse/breaker) must be rated at 125% of the short-circuit current (Isc). An undersized OCPD can fail to protect wiring during a fault.', fix: 'Increase the OCPD rating to at least 125% × Isc. The system will auto-select the next standard breaker size.', ref: 'NEC 690.8(A)' },
  '690.12': { title: 'Rapid Shutdown', plain: 'NEC 690.12 requires rapid shutdown capability for all rooftop PV systems. Panels must de-energize within 30 seconds of initiating shutdown.', fix: 'Add a rapid shutdown device (RSD) such as SolarEdge P-Series, Tigo CCA, or Enphase IQ8. Module-level power electronics (MLPE) satisfy this requirement.', ref: 'NEC 690.12' },
  '705.12': { title: '120% Busbar Rule', plain: 'The solar breaker + main breaker cannot exceed 120% of the bus bar rating. Exceeding this risks overloading the panel bus bar.', fix: 'Use supply-side tap (NEC 705.11), derate the main breaker, upgrade the panel, or reduce the solar system size.', ref: 'NEC 705.12(B)(2)' },
  '310.15': { title: 'Wire Ampacity', plain: 'The conductor must be rated to carry the maximum current with temperature and conduit fill derating applied. Undersized wire can overheat.', fix: 'Increase wire gauge (lower AWG number). Check conduit fill — more conductors in conduit require larger wire.', ref: 'NEC 310.15' },
  '690.9':  { title: 'Overcurrent Protection', plain: 'Each ungrounded conductor must be protected by an OCPD rated for the circuit. Missing or incorrectly sized protection creates fire risk.', fix: 'Add properly rated fuses or breakers at each source. String combiner boxes typically include fusing.', ref: 'NEC 690.9' },
  '690.47': { title: 'Grounding', plain: 'PV systems require equipment grounding conductors (EGC) sized per NEC 690.47. Improper grounding creates shock and fire hazards.', fix: 'Verify EGC sizing per NEC Table 250.122. Use listed grounding hardware. Ensure all metal parts are bonded.', ref: 'NEC 690.47' },
};

function getNecExplanation(issue: any) {
  if (!issue.necReference && !issue.code) return null;
  const ref = issue.necReference || issue.code || '';
  for (const [key, val] of Object.entries(NEC_EXPLANATIONS)) {
    if (ref.includes(key)) return val;
  }
  return null;
}

function IssueRow({ issue, expanded: defaultExpanded = false }: { issue: any; expanded?: boolean }) {
  const [open, setOpen] = React.useState(defaultExpanded);
  const cfg = {
    error:   { icon: <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />, bg: 'bg-red-500/5 border-red-500/20' },
    warning: { icon: <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />, bg: 'bg-amber-500/5 border-amber-500/20' },
    info:    { icon: <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />, bg: 'bg-blue-500/5 border-blue-500/20' },
  }[issue.severity as string] || { icon: null, bg: '' };
  const explanation = getNecExplanation(issue);
  return (
    <div className={`rounded-lg border ${cfg.bg} overflow-hidden`}>
      <div
        className="flex gap-2 p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => explanation && setOpen(!open)}
      >
        {cfg.icon}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white">{issue.message}</div>
          {issue.necReference && <div className="text-xs text-slate-500 mt-0.5">{issue.necReference}</div>}
          {issue.suggestion && <div className="text-xs text-amber-400/80 mt-0.5">💡 {issue.suggestion}</div>}
        </div>
        {issue.code && <div className="text-xs text-slate-600 font-mono flex-shrink-0">{issue.code}</div>}
        {explanation && (
          <div className="text-xs text-slate-600 flex-shrink-0 ml-1">
            {open ? '▲' : '▼'}
          </div>
        )}
      </div>
      {open && explanation && (
        <div className="px-3 pb-3 border-t border-slate-700/50 bg-slate-900/40">
          <div className="pt-2 space-y-2">
            <div className="text-xs font-semibold text-white">{explanation.title} — {explanation.ref}</div>
            <div className="text-xs text-slate-400 leading-relaxed">{explanation.plain}</div>
            <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
              <span className="text-emerald-400 flex-shrink-0 mt-0.5">→</span>
              <div className="text-xs text-emerald-300"><span className="font-semibold">Suggested Fix:</span> {explanation.fix}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Main Component ─────────────────────────────────────────────────────────
function EngineeringPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [config, setConfig] = useState<ProjectConfig>(defaultProject);
  // CAD/layout from 3D design engine (panels[], roofPlanes[]) — AUTHORITATIVE
  // source of truth for panel count (see resolveSystemPanelCount).
  // Hoisted here from its original (~line 3130) location so the panel count
  // resolver can run during the same render pass as totalPanels.
  const [projectLayout, setProjectLayout] = useState<any>(null);
  const [projectAutoLoaded, setProjectAutoLoaded] = useState(false);
  const [autoLoadBanner, setAutoLoadBanner] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentClientId,  setCurrentClientId]  = useState<string | null>(null);

  // Project selector — shown when no projectId in URL
  const [selectorProjects, setSelectorProjects] = useState<{id:string;name:string;client?:{name:string};address?:string;systemSizeKw?:number;updatedAt:string}[]>([]);
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [selectorSearch, setSelectorSearch] = useState('');
  const [selectorOpen, setSelectorOpen] = useState(false);
  // Reverse hydration state
  const [fileHydrated, setFileHydrated]         = useState(false);
  const [fileHydrationBanner, setFileHydrationBanner] = useState<string | null>(null);
  const [restoredRunId, setRestoredRunId]        = useState<string | null>(null);

  // Auto-load project data when ?projectId= is in the URL
  // Full seed hydration: reads engineeringSeed.synthetic_eng_config to populate
  // the exact inverter/panel/string config the engineering engine needs.
  useEffect(() => {
    const projectId = searchParams?.get('projectId');
    if (!projectId || projectAutoLoaded) return;
    setProjectAutoLoaded(true);
    setCurrentProjectId(projectId);

    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success || !data.data) {
          console.warn('[EngineeringPage] Project fetch failed for projectId:', projectId);
          return;
        }
        const p = data.data;
        const seed = p.engineeringSeed;
        const layout = p.layout;
        // STEP 4 -- LOADED PROJECT LAYOUT LOGGING
        console.log('[LOADED PROJECT LAYOUT]', {
          hasLayout: !!layout,
          panelCount: layout?.panels?.length ?? 0,
          roofPlaneCount: layout?.roofPlanes?.length ?? 0,
          hasRoofPlanes: !!(layout?.roofPlanes && layout.roofPlanes.length > 0),
          totalPanels: layout?.totalPanels ?? 0,
          systemSizeKw: layout?.systemSizeKw ?? 0,
        });
        // Store layout in component state so permit buttons can access panel positions
        if (layout) setProjectLayout(layout);

        // SAFETY NET: if p.layout came back null (e.g. user-id mismatch in join),
        // fetch the layout directly from the dedicated endpoint.
        if (!layout) {
          fetch(`/api/projects/${projectId}/layout`)
            .then(r => r.json())
            .then(lr => {
              if (lr.success && lr.data?.panels?.length > 0) {
                console.log('[EngineeringPage] SAFETY NET layout fetch succeeded:', lr.data.panels.length, 'panels');
                setProjectLayout(lr.data);
              }
            })
            .catch(err => console.warn('[EngineeringPage] Safety net layout fetch failed:', err));
        }

        console.log('[EngineeringPage] Loaded project engineering_seed:', seed);

        // Build config patches
        const patches: Partial<ProjectConfig> = {};

        // Always apply project-level fields
        if (p.name)         patches.projectName = p.name;
        if (p.address)      patches.address = p.address;
        if (p.client?.name) patches.clientName = p.client.name;
        if (p.clientId)     setCurrentClientId(p.clientId);
        if (p.systemType)   patches.systemType = p.systemType as SystemType;

        // v47.395 — Parse address components for fallback city / zip / state.
        // Address format: "123 MAIN ST, CITY NAME, ST 12345" or "123 MAIN ST, CITY, ST"
        // Regex captures: city in group 1, state in group 2, optional zip in group 3.
        const addrStr = p.address || '';
        const addrParseMatch = addrStr.match(/,\s*([^,]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?/);
        const addrCity  = addrParseMatch ? addrParseMatch[1].trim() : '';
        const addrState = addrParseMatch ? addrParseMatch[2].trim() : '';
        const addrZip   = addrParseMatch ? (addrParseMatch[3] || '').trim() : '';

        // City: project data first, then client city, then parsed from address
        const resolvedCity = p.city || p.client?.city || addrCity || '';
        if (resolvedCity) patches.city = resolvedCity;

        // County: project data first, then look up via ahj-national city+state match
        if (p.county) {
          patches.county = p.county;
        } else {
          // Use searchAhj to find county from city+state (ahj-national has county field)
          const cityForCounty = resolvedCity || addrCity;
          const stateForCounty = p.stateCode || addrState;
          if (cityForCounty && stateForCounty) {
            const ahjMatches = searchAhj({ stateCode: stateForCounty, city: cityForCounty });
            if (ahjMatches.length > 0 && ahjMatches[0].county) {
              patches.county = ahjMatches[0].county;
              console.log('[EngineeringPage] County from ahj-national lookup:', ahjMatches[0].county);
            }
          }
        }

        // Zip: project data first, then client zip, then parsed from address
        const resolvedZip = p.zip || p.client?.zip || addrZip || '';
        if (resolvedZip) patches.zip = resolvedZip;

        // v47.395 — Utility matching: MUST use getUtilitiesByStateNational() so the
        // matched ID matches the dropdown options (which also use getUtilitiesByStateNational).
        // Previously used getUtilitiesByState() which returns id:'ameren' but the dropdown
        // expects id:'il-ameren-illinois' — they never matched, so dropdown stayed "Manual".
        const utilitySource = p.utilityName || p.client?.utilityProvider || '';
        const stateForUtil = p.stateCode || addrState || '';
        if (utilitySource) {
          const utilNorm = utilitySource.toLowerCase();
          // Primary: state-filtered national list (same source as dropdown options)
          const stateNatUtils = stateForUtil ? getUtilitiesByStateNational(stateForUtil) : [];
          const matchedNat = stateNatUtils.find((u: any) =>
            u.name.toLowerCase().includes(utilNorm) || utilNorm.includes(u.name.toLowerCase())
          );
          if (matchedNat) {
            patches.utilityId = matchedNat.id;
            console.log('[EngineeringPage] Matched utility (national state list):', matchedNat.id, matchedNat.name);
          } else {
            // Fallback: all-state national scan (for cross-state utilities or missing state)
            const allStates = Object.keys(STATE_UTILITY_FALLBACK);
            let found: any = null;
            for (const st of allStates) {
              found = getUtilitiesByStateNational(st).find((u: any) =>
                u.name.toLowerCase().includes(utilNorm) || utilNorm.includes(u.name.toLowerCase())
              );
              if (found) break;
            }
            if (found) {
              patches.utilityId = found.id;
              console.log('[EngineeringPage] Matched utility (national all-state fallback):', found.id, found.name);
            }
          }
        }

        // Parse state from address as fallback
        const stateCode = p.stateCode || addrState || '';
        if (stateCode) patches.state = stateCode;

        // v47.396 — AHJ auto-selection: pick the best match from the dropdown's AHJ list
        // (getAhjsByState from computed-plan). Prefer a state-specific entry over generic ones.
        // Dropdown renders: '' = Manual/Unknown, 'local-building-dept', then state entries.
        // Strategy: first state-specific entry wins; fall back to 'local-building-dept'.
        if (stateCode && !patches.ahjId) {
          const ahjOptions = getAhjsByState(stateCode); // from computed-plan (dropdown source)
          // ahjOptions includes both state='' (local-building-dept) and state=stateCode entries
          const stateSpecific = ahjOptions.filter((a: any) => a.state === stateCode);
          if (stateSpecific.length > 0) {
            patches.ahjId = stateSpecific[0].id;
            console.log('[EngineeringPage] AHJ auto-selected (state-specific):', stateSpecific[0].id, stateSpecific[0].name);
          } else if (ahjOptions.length > 0) {
            // No state-specific entry — use local-building-dept if present
            const localDept = ahjOptions.find((a: any) => a.id === 'local-building-dept');
            if (localDept) {
              patches.ahjId = 'local-building-dept';
              console.log('[EngineeringPage] AHJ auto-selected (local-building-dept fallback)');
            }
          }
        }

        if (seed) {
          // ── Location / address / system type ──────────────────────────────
          if (seed.state_code)      patches.state = seed.state_code;
          if (seed.service_address) patches.address = seed.service_address;
          if (seed.client_name)     patches.clientName = seed.client_name;
          // FIX v47.293: seed.system_type is only a fallback — p.systemType (from DB projects.system_type)
          // is authoritative. The preliminary route hardcodes system_type='roof' in the seed, so
          // if we let the seed overwrite p.systemType, fence/ground projects always get 'roof'.
          if (seed.system_type && !p.systemType) patches.systemType = seed.system_type as SystemType;

          // ── Utility match ─────────────────────────────────────────────────
          if (seed.utility && seed.state_code) {
            // v47.395: use getUtilitiesByStateNational() so IDs match the dropdown
            const utils = getUtilitiesByStateNational(seed.state_code);
            const seedUtilNorm = seed.utility.toLowerCase();
            const matched = utils.find((u: any) =>
              u.name.toLowerCase().includes(seedUtilNorm) ||
              seedUtilNorm.includes(u.name.toLowerCase())
            );
            if (matched) {
              patches.utilityId = matched.id;
              console.log('[EngineeringPage] Matched utility (seed):', matched.id, matched.name);
            }
          }

          // ── Inverter + panel config ───────────────────────────────────────
          // Priority: use synthetic_eng_config (exact specs from preliminary endpoint)
          // Fallback: reconstruct from seed summary fields
          const engCfg = seed.synthetic_eng_config;
          console.log('[EngineeringPage] Loaded synthetic eng config:', engCfg);

          const invType: InverterType = (engCfg?.inverterType ?? seed.inverter_type) as InverterType;
          // LAYOUT OVERRIDE: if the design studio layout has panels, it is the
          // ground truth — always prefer it over the seed's panel_count.
          const layoutPanelCount = layout?.panels?.length ?? 0;
          const seedPanelCount: number = engCfg?.panelCount ?? seed.panel_count;
          const panelCount: number = layoutPanelCount > 0 ? layoutPanelCount : seedPanelCount;
          console.log('[EngineeringPage] PANEL COUNT RESOLUTION:', {
            layoutPanelCount,
            seedPanelCount,
            finalPanelCount: panelCount,
            source: layoutPanelCount > 0 ? 'LAYOUT (design studio)' : 'SEED (bill upload)',
          });
          const tilt: number = seed.tilt ?? 20;
          const azimuth: number = seed.azimuth ?? 180;

          // Resolve inverterId
          let inverterId: string;
          if (engCfg?.inverterId) {
            inverterId = engCfg.inverterId;
          } else if (invType === 'micro') {
            inverterId = MICROINVERTERS[0]?.id ?? 'enphase-iq8plus';
          } else {
            inverterId = STRING_INVERTERS[0]?.id ?? 'se-7600h';
          }

          // Resolve panelId: use engCfg.panelId if present, else find best match by wattage
          let panelId: string;
          if (engCfg?.panelId) {
            const found = SOLAR_PANELS.find((p: any) => p.id === engCfg.panelId);
            panelId = found ? found.id : (SOLAR_PANELS.find((p: any) =>
              Math.abs(p.watts - (engCfg.panelWatts ?? seed.panel_watt)) ===
              Math.min(...SOLAR_PANELS.map((pp: any) => Math.abs(pp.watts - (engCfg.panelWatts ?? seed.panel_watt))))
            )?.id ?? SOLAR_PANELS[0]?.id ?? 'qcells-peak-duo-400');
          } else {
            const targetWatt = seed.panel_watt;
            panelId = SOLAR_PANELS.reduce((b: any, pp: any) =>
              Math.abs(pp.watts - targetWatt) < Math.abs(b.watts - targetWatt) ? pp : b,
              SOLAR_PANELS[0])?.id ?? 'qcells-peak-duo-400';
          }

          // v47.421 — Build strings using sizing engine for optimizer/string topology.
          // The old heuristic (Math.min(panelCount, 13)) produced wrong layouts for
          // SolarEdge: 36 panels → [13,13,10] which violates the MPPT current cap.
          // Instead, run sizeSystemFromBrand to get the correct string distribution.
          let strings: StringConfig[];
          if (invType === 'micro') {
            strings = [{
              id: 'str-seed-0',
              label: 'All Panels',
              panelCount,
              panelId,
              tilt,
              azimuth,
              roofType: 'shingle' as RoofType,
              mountingSystem: engCfg ? 'ironridge-xr100' : (p.selectedMounting?.id || 'ironridge-xr100'),
              wireGauge: engCfg?.wireGauge ?? '#10 AWG THWN-2',
              wireLength: engCfg?.wireLength ?? 50,
            }];
          } else {
            // Run sizing engine to get electrically-valid string layout.
            // Falls back to simple even split if brand is unknown.
            const seedBrand = seed.brand_id ?? (invType === 'optimizer' ? 'solaredge' : undefined);
            let sizingStrings: { panelCount: number; inverterIndex: number }[] | null = null;
            if (seedBrand) {
              try {
                const panel = SOLAR_PANELS.find((pp: any) => pp.id === panelId) as any;
                const sizingResult = sizeSystemFromBrand({
                  systemType: 'roof',
                  panelCount,
                  panelWattage: panel?.watts ?? engCfg?.panelWatts ?? seed.panel_watt ?? 400,
                  panelVoc: panel?.voc ?? engCfg?.panelVoc ?? 49.6,
                  panelTempCoeffVoc: panel?.tempCoeffVoc ?? engCfg?.panelTempCoeffVoc ?? -0.27,
                  designTempMin: -10,
                  selectedBrand: seedBrand,
                  optimizerMaxOutputCurrent: 15.0,
                });
                if (sizingResult.strings.length > 0) {
                  sizingStrings = sizingResult.strings;
                }
              } catch { /* fall through to heuristic */ }
            }
            if (sizingStrings && sizingStrings.length > 0) {
              strings = sizingStrings.map((s, i) => ({
                id: `str-seed-${i}`,
                label: `String ${i + 1}`,
                panelCount: s.panelCount,
                panelId,
                tilt,
                azimuth,
                roofType: 'shingle' as RoofType,
                mountingSystem: engCfg ? 'ironridge-xr100' : (p.selectedMounting?.id || 'ironridge-xr100'),
                wireGauge: engCfg?.wireGauge ?? '#10 AWG THWN-2',
                wireLength: engCfg?.wireLength ?? 50,
              }));
            } else {
              // v47.421: Even split fallback (engine already tried above)
              const panelsPerString = Math.min(panelCount, 14);
              const stringCount = Math.ceil(panelCount / panelsPerString);
              strings = Array.from({ length: stringCount }, (_, i) => ({
                id: `str-seed-${i}`,
                label: `String ${i + 1}`,
                panelCount: i === stringCount - 1
                  ? panelCount - panelsPerString * (stringCount - 1)
                  : panelsPerString,
                panelId,
                tilt,
                azimuth,
                roofType: 'shingle' as RoofType,
                mountingSystem: engCfg ? 'ironridge-xr100' : (p.selectedMounting?.id || 'ironridge-xr100'),
                wireGauge: engCfg?.wireGauge ?? '#10 AWG THWN-2',
                wireLength: engCfg?.wireLength ?? 50,
              }));
            }
          }


          patches.inverters = [{
            id: 'inv-seed-0',
            inverterId,
            type: invType,
            strings,
          }];

          // ── Electrical / structural defaults from engCfg ──────────────────
          if (engCfg) {
            patches.mainPanelAmps         = engCfg.mainPanelAmps;
            patches.wireGauge             = engCfg.wireGauge;
            patches.wireLength            = engCfg.wireLength;
            patches.conduitType           = engCfg.conduitType;
            patches.rapidShutdown         = engCfg.rapidShutdown;
            patches.acDisconnect          = engCfg.acDisconnect;
            patches.dcDisconnect          = engCfg.dcDisconnect;
            patches.interconnectionMethod = engCfg.interconnectionMethod as ProjectConfig['interconnectionMethod'];
            patches.panelBusRating        = engCfg.panelBusRating;
          }

          patches.roofPitch = tilt;

          console.log('[EngineeringPage] Loaded synthetic layout (panel count):', seed.panel_count);
          console.log('[EngineeringPage] Engineering state initialized from seed for project:', projectId);
          console.log('[EngineeringPage] Patches applied:', {
            invType, inverterId, panelId, panelCount, stringCount: strings.length, tilt, azimuth,
            state: patches.state, utilityId: patches.utilityId,
          });

          // Banner: only show after real engine state is initialized
          const utilityLabel = seed.utility ? ` · ${seed.utility}` : '';
          const priceLabel = seed.cost_low && seed.cost_high
            ? ` · $${Math.round(seed.cost_low / 1000)}k–$${Math.round(seed.cost_high / 1000)}k estimate`
            : '';
          const displayPanels = layoutPanelCount > 0 ? layoutPanelCount : seed.panel_count;
          const displayKw = layoutPanelCount > 0
            ? (layout!.systemSizeKw || (layoutPanelCount * 0.4)).toFixed(2)
            : seed.system_kw;
          const layoutNote = layoutPanelCount > 0 ? ` [layout: ${layoutPanelCount} panels]` : '';
          setAutoLoadBanner(
            `✅ System loaded: ${displayKw} kW · ${displayPanels} panels${utilityLabel}${priceLabel}${layoutNote}`
          );

          // Restore pre-rendered SLD from seed so plan-set E-1 uses the same
          // diagram the user reviewed in Design Studio, not the fallback renderer.
          if (seed.sldSvg) {
            setSldSvg(seed.sldSvg);
            console.log('[EngineeringPage] SLD restored from engineering_seed');
          }

        } else {
          // No seed — use layout data if available</old_str>
          console.log('[EngineeringPage] No engineering_seed found for project:', projectId, '— falling back to layout/selected equipment');
          const panelCount = layout?.totalPanels || 0;
          const systemKw = layout?.systemSizeKw || 0;
          const invType = p.selectedInverter?.type === 'micro' ? 'micro'
                        : p.selectedInverter?.type === 'optimizer' ? 'optimizer'
                        : 'string';
          const _nsPanel = p.selectedPanel as any;
            const _nsBrand = p.selectedInverter?.brand_id ?? (invType === 'optimizer' ? 'solaredge' : undefined);
            let _nsEngStrings: { panelCount: number }[] | null = null;
            if (invType !== 'micro' && _nsBrand) {
              try {
                const _nsResult = sizeSystemFromBrand({
                  systemType: 'roof', panelCount,
                  panelWattage: _nsPanel?.watts ?? 400,
                  panelVoc: _nsPanel?.voc ?? 49.6,
                  panelTempCoeffVoc: _nsPanel?.tempCoeffVoc ?? -0.27,
                  designTempMin: -10, selectedBrand: _nsBrand,
                  optimizerMaxOutputCurrent: 15.0,
                });
                if (_nsResult.strings.length > 0) _nsEngStrings = _nsResult.strings;
              } catch { /* fall through to even split */ }
            }
            if (!_nsEngStrings) {
              const _nsPps = invType === 'micro' ? 1 : Math.min(panelCount, 14);
              const _nsSc = invType === 'micro' ? panelCount : Math.max(1, Math.ceil(panelCount / _nsPps));
              _nsEngStrings = Array.from({ length: _nsSc }, (_, i) => ({
                panelCount: i === _nsSc - 1 ? panelCount - _nsPps * (_nsSc - 1) : _nsPps,
              }));
            }
            const strings = _nsEngStrings.map((s, i) => ({
              id: `str-auto-${i}`,
              label: `String ${i + 1}`,
              panelCount: s.panelCount,
              panelId: p.selectedPanel?.id || 'qcells-peak-duo-400',
              tilt: layout?.groundTilt || 20,
              azimuth: layout?.groundAzimuth || 180,
              roofType: 'shingle' as const,
              mountingSystem: p.selectedMounting?.id || 'ironridge-xr100',
              wireGauge: '#10 AWG',
              wireLength: 50,
            }));
            patches.inverters = [{
            id: 'inv-auto-0',
            inverterId: p.selectedInverter?.id || (MICROINVERTERS[0]?.id ?? 'enphase-iq8plus'),
            type: invType,
            strings,
          }];
          patches.mountingId = p.selectedMounting?.id || patches.mountingId;
          patches.utilityId = p.utilityId || patches.utilityId;
          if (panelCount > 0) {
            setAutoLoadBanner(`Loaded from project: ${p.name}${panelCount ? ` (${panelCount} panels, ${systemKw.toFixed(1)} kW)` : ''}`);
          }
        }

        if (Object.keys(patches).length > 0) {
          setConfig(prev => {
            const merged = { ...prev, ...patches };
            // Phase 11: silent brand/panel reconciliation removed from load path.
            // Users now see their configured equipment on load; mismatches are
            // surfaced via the SizingRecommendation panel (apply = explicit).
            return merged;
          });
          // Trigger compliance calculation after config is hydrated
          setTimeout(() => {
            console.log('[EngineeringPage] Auto-triggering compliance calc after seed hydration');
            runCalc();
          }, 300);
        }
      })
      .catch(err => console.warn('[engineering] auto-load failed:', err));
  }, [searchParams, projectAutoLoaded]);

  // ── Project selector: load projects list when no projectId in URL ──────────
  useEffect(() => {
    const projectId = searchParams?.get('projectId');
    if (projectId) return; // already have a project
    setSelectorLoading(true);
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          setSelectorProjects(data.data);
        }
      })
      .catch(() => {})
      .finally(() => setSelectorLoading(false));
  }, [searchParams]);

  // ── Reverse hydration: ?fileId= ──────────────────────────────────────────
  // When a user opens a generated engineering file, load the associated
  // engineering_run config and restore the full system configuration.
  useEffect(() => {
    const fileId = searchParams?.get('fileId');
    if (!fileId || fileHydrated) return;
    setFileHydrated(true);

    console.log('[EngineeringPage] Reverse hydration triggered for fileId:', fileId);

    fetch(`/api/engineering/run-from-file?fileId=${fileId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success || !data.run) {
          console.warn('[EngineeringPage] run-from-file failed:', data.error);
          setFileHydrationBanner(`⚠️ Could not restore engineering configuration: ${data.error || 'Unknown error'}`);
          return;
        }

        const run = data.run;
        console.log('[EngineeringPage] Reverse hydration run:', run);

        // Set project context
        if (data.projectId) {
          setCurrentProjectId(data.projectId);
          setProjectAutoLoaded(true); // prevent projectId useEffect from overwriting
        }
        setRestoredRunId(run.id);

        // Build patches from the stored config_snapshot + structured fields
        const snap = run.configSnapshot || {};
        const patches: Partial<ProjectConfig> = {};

        // Location / project fields
        if (run.address)    patches.address    = run.address;
        if (run.stateCode)  patches.state      = run.stateCode;
        if (run.systemType) patches.systemType = run.systemType as SystemType;
        if (run.utilityId)  patches.utilityId  = run.utilityId;
        if (run.roofPitch)  patches.roofPitch  = run.roofPitch;

        // Electrical fields
        if (run.mainPanelRating)       patches.mainPanelAmps         = run.mainPanelRating;
        if (run.wireGauge)             patches.wireGauge             = run.wireGauge;
        if (run.conduitType)           patches.conduitType           = run.conduitType;
        if (run.interconnectionMethod) patches.interconnectionMethod = run.interconnectionMethod as ProjectConfig['interconnectionMethod'];
        if (run.rapidShutdown  !== undefined) patches.rapidShutdown  = run.rapidShutdown;
        if (run.acDisconnect   !== undefined) patches.acDisconnect   = run.acDisconnect;
        if (run.dcDisconnect   !== undefined) patches.dcDisconnect   = run.dcDisconnect;
        if (run.mountingId)            patches.mountingId            = run.mountingId;

        // Restore from configSnapshot if available (more complete)
        if (snap.mainPanelAmps)         patches.mainPanelAmps         = snap.mainPanelAmps;
        if (snap.panelBusRating)        patches.panelBusRating        = snap.panelBusRating;
        if (snap.wireGauge)             patches.wireGauge             = snap.wireGauge;
        if (snap.wireLength)            patches.wireLength            = snap.wireLength;
        if (snap.conduitType)           patches.conduitType           = snap.conduitType;
        if (snap.interconnectionMethod) patches.interconnectionMethod = snap.interconnectionMethod as ProjectConfig['interconnectionMethod'];
        if (snap.rapidShutdown  !== undefined) patches.rapidShutdown  = snap.rapidShutdown;
        if (snap.acDisconnect   !== undefined) patches.acDisconnect   = snap.acDisconnect;
        if (snap.dcDisconnect   !== undefined) patches.dcDisconnect   = snap.dcDisconnect;
        // FIX v47.293: snap.systemType is only a fallback — p.systemType (DB) is authoritative.
        // Snapshots from previous roof-typed runs must not overwrite the project's actual system type.
        if (snap.systemType && !patches.systemType)  patches.systemType = snap.systemType as SystemType;
        if (snap.state)                 patches.state                 = snap.state;
        if (snap.utilityId)             patches.utilityId             = snap.utilityId;
        if (snap.mountingId)            patches.mountingId            = snap.mountingId;

        // Rebuild inverter/string config
        const invType: InverterType = (run.inverterType || snap.inverterType || 'string') as InverterType;
        const panelCount: number = run.panelCount || 0;
        const roofPitch: number = run.roofPitch || snap.roofPitch || 20;

        // Resolve inverterId: use stored id, fallback to first of type
        let inverterId: string = run.inverterId || '';
        if (!inverterId) {
          inverterId = invType === 'micro'
            ? (MICROINVERTERS[0]?.id ?? 'enphase-iq8plus')
            : (STRING_INVERTERS[0]?.id ?? 'se-7600h');
        }

        // Resolve panelId: use stored id, fallback to wattage match
        let panelId: string = run.panelId || '';
        if (!panelId && run.panelWattage) {
          const targetWatt = run.panelWattage;
          panelId = SOLAR_PANELS.reduce((b: any, pp: any) =>
            Math.abs(pp.watts - targetWatt) < Math.abs(b.watts - targetWatt) ? pp : b,
            SOLAR_PANELS[0])?.id ?? 'qcells-peak-duo-400';
        }
        // NON-DESTRUCTIVE DEFAULT: only if user has no panel selected, fall back by systemType
        if (!panelId) {
          const sysType = (run.systemType || patches.systemType || 'roof') as string;
          panelId = sysType === 'fence' ? 'panel-fence-ps1' : 'qcells-peak-duo-400';
        }

        // Rebuild strings from stored string_config if available
        let strings: StringConfig[];
        const storedStrings: any[] = run.stringConfig || [];

        if (storedStrings.length > 0) {
          // Restore from stored string config (most accurate)
          strings = storedStrings.map((s: any, i: number) => ({
            id:            s.id || `str-restored-${i}`,
            label:         s.label || `String ${i + 1}`,
            panelCount:    s.panelCount || s.panel_count || 1,
            panelId:       s.panelId || s.panel_id || panelId,
            tilt:          s.tilt ?? roofPitch,
            azimuth:       s.azimuth ?? 180,
            roofType:      (s.roofType || s.roof_type || 'shingle') as RoofType,
            mountingSystem: s.mountingSystem || s.mounting_system || run.mountingId || 'ironridge-xr100',
            wireGauge:     s.wireGauge || s.wire_gauge || run.wireGauge || '#10 AWG THWN-2',
            wireLength:    s.wireLength || s.wire_length || 50,
          }));
        } else {
          // Reconstruct from panel count — use sizing engine (single source of truth).
          // The old heuristic Math.min(panelCount, 13) has been removed; all string
          // distribution must come from sizeSystemFromBrand() using datasheet values.
          let _rfEngStrings: { panelCount: number }[] | null = null;
          if (invType !== 'micro') {
            try {
              const _rfPanel = SOLAR_PANELS.find((pp: any) => pp.id === panelId);
              const _rfResult = sizeSystemFromBrand({
                systemType: 'roof',
                panelCount,
                panelWattage: (_rfPanel as any)?.watts ?? run.panelWattage ?? 400,
                panelVoc: (_rfPanel as any)?.voc ?? 49.6,
                panelTempCoeffVoc: (_rfPanel as any)?.tempCoeffVoc ?? -0.27,
                designTempMin: -10,
                selectedInverterId: inverterId,
                optimizerMaxOutputCurrent: 15.0,
              });
              if (_rfResult.strings.length > 0) _rfEngStrings = _rfResult.strings;
            } catch { /* fall through to even-split fallback */ }
          }
          if (!_rfEngStrings) {
            // Fallback: even split capped at 14 (datasheet ceiling for 380V × 15A optimizers)
            const _rfPps = invType === 'micro' ? 1 : Math.min(panelCount, 14);
            const _rfSc  = invType === 'micro' ? panelCount : Math.max(1, Math.ceil(panelCount / _rfPps));
            _rfEngStrings = Array.from({ length: _rfSc }, (_, i) => ({
              panelCount: i === _rfSc - 1 ? panelCount - _rfPps * (_rfSc - 1) : _rfPps,
            }));
          }
          strings = _rfEngStrings.map((s, i) => ({
            id:            `str-restored-${i}`,
            label:         `String ${i + 1}`,
            panelCount:    s.panelCount,
            panelId,
            tilt:          roofPitch,
            azimuth:       180,
            roofType:      'shingle' as RoofType,
            mountingSystem: run.mountingId || 'ironridge-xr100',
            wireGauge:     run.wireGauge || '#10 AWG THWN-2',
            wireLength:    50,
          }));
        }

        patches.inverters = [{
          id:        'inv-restored-0',
          inverterId,
          type:      invType,
          strings,
        }];

        // Apply all patches
        if (Object.keys(patches).length > 0) {
          setConfig(prev => {
            const merged = { ...prev, ...patches };
            // Phase 11: reconciliation removed from hydration path.
            // Mismatches are surfaced via SizingRecommendation panel.
            return merged;
          });
        }

        // Set the restoration banner
        const genDate = run.generatedAt
          ? new Date(run.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'previously';
        setFileHydrationBanner(
          `🔄 Engineering configuration restored from "${data.fileName}" (generated ${genDate}). You can edit and re-run the engineering engine.`
        );

        // Auto-trigger calc after hydration
        setTimeout(() => {
          console.log('[EngineeringPage] Auto-triggering calc after reverse hydration');
          runCalc();
        }, 400);
      })
      .catch(err => {
        console.warn('[engineering] reverse hydration failed:', err);
        setFileHydrationBanner('⚠️ Could not restore engineering configuration from file.');
      });
  }, [searchParams, fileHydrated]);

  const [activeTab, setActiveTab] = useState<TabId>('config');
  const [expandedInv, setExpandedInv] = useState<string | null>(config.inverters[0]?.id || null);
  const [compliance, setCompliance] = useState<ComplianceResult>({ overallStatus: null });
  const [ahjInfo, setAhjInfo] = useState<any>(null);

  // Auto-lookup AHJ when state/city/county changes
  useEffect(() => {
    if (!config.state) { setAhjInfo(null); return; }
    const result = lookupAhj(config.state, config.county || '', config.city || '');
    if (result.success && result.ahj) {
      setAhjInfo(result.ahj);
    } else {
      setAhjInfo(null);
    }
  }, [config.state, config.city, config.county]);

  // NOTE: Fence watcher useEffect is defined later, AFTER projectLayout state exists,
  // so it can observe layout.type as a fence signal even when config.systemType is stale.
  const [rulesResult, setRulesResult] = useState<any>(null);
  // Phase 11 — brand sizing recommendation UI state
  const [sizingAutoApply, setSizingAutoApply] = useState<boolean>(false);
  const [sizingDismissed, setSizingDismissed] = useState<boolean>(false);
  // User-controlled battery intent (decoupled from batteryId presence).
  // Sizing engine ONLY emits battery when batteryEnabled === true.
  const [batteryEnabled, setBatteryEnabled] = useState<boolean>(false);
  const [genSectionOpen, setGenSectionOpen] = useState<boolean>(false);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [overrideForm, setOverrideForm] = useState<{ ruleId: string; field: string; value: string; justification: string } | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [engineeringMode, setEngineeringMode] = useState<'AUTO' | 'MANUAL'>('AUTO');
  const [sldSvg, setSldSvg] = useState<string | null>(null);
  const [sldLoading, setSldLoading] = useState(false);
  const [sldError, setSldError] = useState<string | null>(null);
  // BUG 4 FIX: SLD Zoom state
  const [sldZoom, setSldZoom] = useState(1);
  const [sldPan, setSldPan] = useState({ x: 0, y: 0 });
  const sldRef = useRef<HTMLDivElement>(null);
  const [bom, setBom] = useState<any[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomError, setBomError] = useState<string | null>(null);
  const [bomPricing, setBomPricing] = useState<{
    totalBomCost: number;
    catalogMatches: number;
    overrideMatches: number;
    fallbackMatches: number;
    unpriced: number;
    pricingApplied: boolean;
  } | null>(null);
  const [bomStages, setBomStages] = useState<Array<{
    id: string;
    label: string;
    order: number;
    itemCount: number;
    items: any[];
  }>>([]);

  // ── Client Files tab state ──────────────────────────────────────────────────
  const [projectFiles, setProjectFiles] = useState<any[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  // Pipeline Verification state (v47.56)
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<any | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineRawExpanded, setPipelineRawExpanded] = useState<Record<string, boolean>>({});
  // Auto-loaded workflow status from DB — populated on page load without needing to run pipeline
  const [autoWorkflowStatus, setAutoWorkflowStatus] = useState<{
    designComplete: boolean;
    engineeringComplete: boolean;
    permitReady: boolean;
    filesReady: boolean;
    layoutPanels: number;
    layoutKw: number;
    hasEngReport: boolean;
    fileCount: number;
    loadedAt: string;
  } | null>(null);

  const [structuralOptions, setStructuralOptions] = useState<any[]>([]);
  const [ecosystemLog, setEcosystemLog] = useState<any[]>([]);
  const [ecosystemComponents, setEcosystemComponents] = useState<any[]>([]);
  // PVWatts production estimate
  const [pvwattsData, setPvwattsData] = useState<{
    annualKwh?: number;
    monthlyKwh?: number[];
    capacityFactor?: number;
    stationCity?: string;
    stationState?: string;
    loading?: boolean;
    error?: string;
  }>({});
  const [topologyType, setTopologyType] = useState<'STRING' | 'STRING_OPTIMIZER' | 'MICRO' | 'HYBRID'>('STRING');
  const [topologySwitching, setTopologySwitching] = useState(false);
  // v57.5 — Topology change audit trail: record what changed and when
  const [topologyChangeLog, setTopologyChangeLog] = useState<Array<{from: string; to: string; at: string}>>([]);
  const [showTopologyBanner, setShowTopologyBanner] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const calcDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // ── Engineering Intelligence Panel state ──────────────────────────────────
  const [intelligencePanelOpen, setIntelligencePanelOpen] = useState(true);
  // ── Mounting Details Tab state (moved to top-level to fix React Rules of Hooks) ──
  const [mountingInstallType, setMountingInstallType] = useState<'residential' | 'commercial' | 'ground'>('residential');
  const [selectedMountingId, setSelectedMountingId] = useState<string>('ironridge-xr100');
  const [showAllSystems, setShowAllSystems] = useState(false);
  const [mountingRoofTypeFilter, setMountingRoofTypeFilter] = useState<string>('all');
  const [mountingSearchQuery, setMountingSearchQuery] = useState<string>('');
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [decisionLog, setDecisionLog] = useState<Array<{ ts: string; action: string; detail: string; type: 'auto' | 'manual' | 'info' }>>([]);
  const [showDecisionLog, setShowDecisionLog] = useState(false);

  // toSystemState: convert ProjectConfig to SystemState for API calls
  const toSystemState = useCallback(() => {
    // v47.358: 'ecoflow' maps to STRING topology for compliance engine
    // (EcoFlow is a string-based hybrid inverter — compatible with string logic)
    const invType0 = config.inverters[0]?.type;
    const topo = invType0 === 'micro' ? 'MICRO'
               : invType0 === 'optimizer' ? 'STRING_OPTIMIZER'
               : 'STRING';  // ecoflow + string both go here
    const firstInv = getInvById(config.inverters[0]?.inverterId || '', config.inverters[0]?.type || 'string') as any;
    return {
      projectName: config.projectName,
      clientName: config.clientName,
      address: config.address,
      designer: config.designer,
      date: config.date,
      topologyType: topo,
      inverterBrand: firstInv?.manufacturer || 'SolarEdge',
      inverters: config.inverters,
      modules: [],
      optimizers: [],
      ecosystemComponents,
      systemType: config.systemType,
      mainPanelAmps: config.mainPanelAmps,
      mainPanelBrand: config.mainPanelBrand,
      utilityMeter: config.utilityMeter,
      acDisconnect: config.acDisconnect,
      dcDisconnect: config.dcDisconnect,
      productionMeter: config.productionMeter,
      rapidShutdown: config.rapidShutdown,
      batteryBrand: config.batteryBrand,
      batteryModel: config.batteryModel,
      batteryCount: config.batteryCount,
      batteryKwh: config.batteryKwh,
      batteryBackfeedA: calcBatteryBackfeedAmps(config.batteryId, config.batteryCount),
      generatorBrand: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? ''; })() : undefined,
      generatorModel: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.model ?? ''; })() : undefined,
      generatorKw: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? 0; })() : undefined,
      atsBrand: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.manufacturer ?? ''; })() : undefined,
      atsModel: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.model ?? ''; })() : undefined,
      atsAmpRating: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? 0; })() : undefined,
      conductorSizing: {
        acWireGauge: config.wireGauge,
        acConductorCallout: '',
        acWireAmpacity: 0,
        acVoltageDrop: 0,
        groundingConductor: '#12 AWG',
        conduitSize: '3/4"',
        conduitType: config.conduitType,
        autoSized: engineeringMode === 'AUTO',
      },
      structuralData: {
        roofType: config.roofType,
        roofPitch: config.roofPitch,
        rafterSpacing: config.rafterSpacing,
        rafterSpan: config.rafterSpan,
        rafterSize: config.rafterSize,
        rafterSpecies: config.rafterSpecies,
        attachmentSpacing: config.attachmentSpacing,
        windSpeed: config.windSpeed,
        windExposure: config.windExposure,
        groundSnowLoad: config.groundSnowLoad,
      },
      mountingId: config.mountingId,
      complianceStatus: {
        overallStatus: compliance.overallStatus,
        electrical: compliance.electrical || null,
        structural: compliance.structural || null,
        jurisdiction: compliance.jurisdiction || null,
        autoDetected: compliance.autoDetected || null,
        lastCalculatedAt: null,
      },
      bom: [],
      bomGeneratedAt: null,
      engineeringMode,
      overrides: [],
      topologyChangeLog: [],
      autoResolutions: compliance.electrical?.autoResolutions || [],
      notes: config.notes,
    };
  }, [config, compliance, engineeringMode, ecosystemComponents]);

  const getPanelById = (id: string) => SOLAR_PANELS.find(p => p.id === id);
  const getInvById = (id: string, type: InverterType) => {
    if (type === 'micro') return MICROINVERTERS.find(i => i.id === id);
    return STRING_INVERTERS.find(i => i.id === id);
  };

  const totalPanels = config.inverters.reduce((sum, inv) =>
    sum + inv.strings.reduce((s2, str) => s2 + str.panelCount, 0), 0);

  // ─── MASTER TASK — SOURCE OF TRUTH for system panel count ─────────────
  // Priority (non-negotiable):
  //   1. projectLayout.panels.length     (CAD placed panels — authoritative)
  //   2. projectLayout.totalPanels       (CAD precomputed total)
  //   3. config.systemDefinition.layout.totalPanels (SystemDefinition)
  //   4. totalPanels (config fallback)   — only when no CAD/SD available
  //
  // Downstream consumers MUST use `systemPanelCount` instead of
  // `totalPanels` for:
  //   • sizing engine input
  //   • inverter card display
  //   • ComputedSystem input
  // This fixes the bug where CAD places 36 panels but the inverter card
  // still renders a stale 10-panel string config.
  const resolvedPanelCount = useMemo(() => {
    const sd = (config as unknown as { systemDefinition?: unknown })
      .systemDefinition as Parameters<typeof resolveSystemPanelCount>[0]['systemDefinition'];
    return resolveSystemPanelCount({
      cad: projectLayout,
      systemDefinition: sd ?? null,
      configFallback: totalPanels,
    });
  }, [projectLayout, totalPanels, config]);
  const systemPanelCount = resolvedPanelCount.value;
  const totalWatts = config.inverters.reduce((sum, inv) =>
    sum + inv.strings.reduce((s2, str) => {
      const panel = getPanelById(str.panelId);
      return s2 + str.panelCount * (panel?.watts || 400);
    }, 0), 0);
  const totalKw = (totalWatts / 1000).toFixed(2);
  const totalInverterKw = config.inverters.reduce((sum, inv) => {
    const invData = getInvById(inv.inverterId, inv.type) as any;
    if (inv.type === 'micro') {
      // For micro: each inverter entry represents deviceCount units
      // deviceCount = ceil(panelCount / modulesPerDevice)
      const panelCount = inv.strings.reduce((s, str) => s + str.panelCount, 0);
      const registryMpd: number = (invData as any)?.modulesPerDevice ?? 1;
      const mpd: number = inv.deviceRatioOverride ?? registryMpd;
      const deviceCount = Math.ceil(panelCount / mpd);
      const perDeviceKw = (invData as any)?.acOutputW / 1000 || (invData as any)?.acOutputKw || 0.295;
      return sum + deviceCount * perDeviceKw;
    }
    return sum + ((invData as any)?.acOutputKw || (invData as any)?.acOutputW / 1000 || 7.6);
  }, 0).toFixed(2);

  // ── ComputedSystem: centralized calculation engine ─────────────────────────
  // All modules (SLD, BoM, Electrical, Conduit, Permit) read from this object.
  // Recomputes whenever config changes.
  const computedSystem = useMemo<ComputedSystem>(() => {
    const firstInv = config.inverters[0];
    const firstStr = firstInv?.strings[0];
    const invData = firstInv ? getInvById(firstInv.inverterId, firstInv.type) as any : null;
    const panelData = firstStr ? getPanelById(firstStr.panelId) as any : null;

    // v47.360: 'ecoflow' maps to 'string' for ComputedSystemInput — the compliance
    // engine treats EcoFlow PowerOcean as a string-based hybrid inverter.
    // v47.418: 'hybrid' also maps to 'string' here because ComputedSystem uses
    // the same string-topology electrical math (Voc × N, panel-Isc × 1.25)
    // for hybrid inverters. Self-limiting current clamp is handled downstream
    // in the feasibility evaluator / MPPT allocator.
    const rawType = firstInv?.type ?? 'string';
    const topology: 'string' | 'optimizer' | 'micro' =
      rawType === 'ecoflow' || rawType === 'hybrid' ? 'string' : rawType;
    const registryMpd: number = invData?.modulesPerDevice ?? 1;
    const modulesPerDevice: number = firstInv?.deviceRatioOverride ?? registryMpd;
    const branchLimit: number = invData?.branchLimit ?? 16;

    // v47.410 — Optimizer rated max output current. Mirrors the wiring the
    // compliance route (app/api/engineering/calculate/route.ts) does: if the
    // config carries an explicit SKU cap, plumb it into ComputedSystemInput so
    // the SLD, permit PDF, and wire autosizer all compute topology-correct
    // conductor and OCPD sizes. When omitted, computeSystem() falls back to
    // 15.0 A (covers SolarEdge P-series + Tigo TS4-A-O). Has no effect when
    // topology !== 'optimizer'.
    const optimizerMaxOutputCurrent: number | undefined =
      typeof (firstInv as any)?.optimizerMaxOutputCurrent === 'number' &&
      (firstInv as any).optimizerMaxOutputCurrent > 0
        ? (firstInv as any).optimizerMaxOutputCurrent
        : undefined;

    const input: ComputedSystemInput = {
      topology,
      optimizerMaxOutputCurrent,
      // SOURCE OF TRUTH: prefer CAD / SystemDefinition panel count. Falls
      // back to the config-derived totalPanels only when no authoritative
      // source is available. This keeps ComputedSystem consistent with
      // the sizing engine and the UI card display.
      totalPanels: systemPanelCount > 0 ? systemPanelCount : totalPanels,
      panelWatts: panelData?.watts ?? 400,
      panelVoc: panelData?.voc ?? 41.6,
      panelIsc: panelData?.isc ?? 12.26,
      panelVmp: panelData?.vmp ?? 34.5,
      panelImp: panelData?.imp ?? 11.59,
      panelTempCoeffVoc: panelData?.tempCoeffVoc ?? -0.26,
      panelTempCoeffIsc: panelData?.tempCoeffIsc ?? 0.05,
      panelMaxSeriesFuse: panelData?.maxSeriesFuseRating ?? 20,
      panelModel: panelData?.model ?? 'Solar Panel',
      panelManufacturer: panelData?.manufacturer ?? '',
      inverterManufacturer: invData?.manufacturer ?? (topology === 'micro' ? 'Enphase' : 'SolarEdge'),
      inverterModel: invData?.model ?? (topology === 'micro' ? 'IQ8+' : 'SE7600H'),
      inverterAcKw: invData?.acOutputKw ?? (invData?.acOutputW ? invData.acOutputW / 1000 : topology === 'micro' ? 0.290 : 7.6), // v58.4: fallback 0.295->0.290 (IQ8+ datasheet max continuous = 290VA)
      inverterMaxDcV: invData?.maxDcVoltage ?? (topology === 'micro' ? 60 : 600),
      inverterMpptVmin: invData?.mpptVoltageMin ?? (topology === 'micro' ? 16 : 100),
      inverterMpptVmax: invData?.mpptVoltageMax ?? (topology === 'micro' ? 60 : 480),
      inverterMaxInputCurrentPerMppt: invData?.maxInputCurrentPerMppt ?? invData?.maxInputCurrent ?? 13.5,
      inverterMpptChannels: invData?.mpptChannels ?? (topology === 'micro' ? 1 : 2),
      inverterAcCurrentMax: invData?.acOutputCurrentMax ?? (topology === 'micro' ? 1.21 : 32),
      inverterModulesPerDevice: modulesPerDevice,
      inverterBranchLimit: branchLimit,
      manufacturerMaxPerBranch20A: (invData as any)?.maxPerBranch20A ?? undefined,
      manufacturerMaxPerBranch30A: (invData as any)?.maxPerBranch30A ?? undefined,
      designTempMin: (compliance.autoDetected as any)?.designTempMin ?? -10,
      // Cap ambientTempC at 40°C — NEC 310.15 standard design ambient.
      // compliance.autoDetected.designTempMax is the CONDUCTOR temp (air + rooftop adder),
      // NOT the air ambient. autoSizeWire() applies its own rooftopTempAdderC separately.
      // Using 95°C here causes massive over-derating (factor 0.41) → wrong wire gauges.
      ambientTempC: Math.min((compliance.autoDetected as any)?.designTempMax ?? 40, 40),
      // Rooftop temp adder: 30°C for roof (NEC 310.15), 0°C for fence/ground (no rooftop heat)
      rooftopTempAdderC: config.systemType === 'roof' ? 30 : 0,
      // System-type-aware run lengths — ESTIMATED from panel count + layout heuristics
      // derivedFrom: 'estimated-geometry' (not CAD model)
      // v47.432: CAD-based version historically lived in bom-unified.ts (deleted Stage 8.1)
      // Fence: linear layout → diagonal ≈ fence length (panels at fence level, inverter nearby)
      // Ground: array footprint → diagonal from array width × depth
      // Roof: standard defaults (attic/roof routing to inverter/MSP)
      runLengths: (() => {
        const isFence = config.systemType === 'fence';
        const isGround = config.systemType === 'ground';
        const userDcLen = firstStr?.wireLength ?? config.wireLength;

        if (isFence) {
          // Fence geometry - deriveWiring() pattern (legacy source bom-unified.ts deleted in v47.432 Stage 8.1).
          // Fence is a linear layout: panels side-by-side along fence line.
          // Key: BRANCH_RUN = per-branch trunk cable length (NOT total fence length).
          //
          // Source values:
          //   panelWidthFt: resolveDefaultFencePanelSpec() → 1.133m × 3.28084 = 3.72ft
          //   panelHeightFt: resolveDefaultFencePanelSpec() → 1.721m × 3.28084 = 5.65ft
          //   maxPerBranch: ~16 devices per branch (Enphase IQ8 @240V, from equipment-registry-v4.ts)
          //   Legacy deriveWiring() defaults: micro -> 2ft/panel DC, string -> 3ft/panel DC
          //   (source bom-unified.ts deleted in v47.432 Stage 8.1)
          const panelWidthFt = 3.72;    // resolveDefaultFencePanelSpec(): 1.133m
          const estFenceLenFt = totalPanels * panelWidthFt;
          const isMicroTopo = firstInv?.type === 'micro';
          // Per-branch trunk cable: fence length ÷ estimated branch count
          // Branch count estimate: ceil(panels / 16) for micro, ceil(panels/stringSize) for string
          const estBranches = isMicroTopo
            ? Math.max(1, Math.ceil(totalPanels / 16))   // ~16 micros per branch @240V
            : Math.max(1, config.inverters.reduce((s, inv) => s + inv.strings.length, 0) || 1);
          const branchRunFt = Math.ceil(estFenceLenFt / estBranches);
          return {
            DC_STRING_RUN:         userDcLen ?? 15,          // fence: short DC home run (panels at ground level)
            ROOF_RUN:              userDcLen ?? 3,           // micro DC: panel-to-micro ~3ft (legacy bom-unified.ts: 2ft/panel)
            BRANCH_RUN:            config.wireLength ?? Math.max(15, Math.min(branchRunFt, 80)),  // per-branch trunk along fence
            INV_TO_DISCO_RUN:      10,
            COMBINER_TO_DISCO_RUN: Math.max(10, Math.min(Math.ceil(estFenceLenFt / 8), 40)),  // combiner near midpoint
            DISCO_TO_METER_RUN:    20,
            METER_TO_MSP_RUN:      10,
            MSP_TO_UTILITY_RUN:    5,
            DC_DISCO_TO_INV_RUN:   10,
          };
        }

        if (isGround) {
          // Ground geometry - deriveWiring() pattern (legacy source bom-unified.ts deleted in v47.432 Stage 8.1).
          // Bounding box = array width × array depth (row spacing × rowCount).
          // BRANCH_RUN = per-branch trunk/string run, not total array diagonal.
          //
          // Source values:
          //   panelWidthIn: 41.7" from equipment-registry-v4.ts qcells dimensions
          //   rowDepthFt: ~12ft per row (panel height ~5.8ft + ~6ft row spacing)
          //   Legacy defaults: string -> 3ft/panel DC + 2x diagonal, micro -> 2ft/panel + 1.5x diagonal
          //   (source bom-unified.ts deleted in v47.432 Stage 8.1)
          const panelWidthIn = 41.7;
          const panelsPerRow = Math.ceil(totalPanels / Math.max(1, config.rowCount ?? 1));
          const arrayWidthFt = (panelsPerRow * panelWidthIn) / 12;
          const rowDepthFt = (config.rowCount ?? 1) * 12;
          const diagonalFt = Math.sqrt(arrayWidthFt * arrayWidthFt + rowDepthFt * rowDepthFt);
          const isMicroTopo = firstInv?.type === 'micro';
          // Per-branch run: diagonal ÷ branch count (each branch covers a section of the array)
          const estBranches = isMicroTopo
            ? Math.max(1, Math.ceil(totalPanels / 16))
            : Math.max(1, config.inverters.reduce((s, inv) => s + inv.strings.length, 0) || 1);
          const branchRunFt = Math.ceil(diagonalFt / estBranches);
          // DC string run: array width ÷ strings (for string inverter) or 5ft for micro
          const dcRunFt = isMicroTopo ? 5 : Math.max(15, Math.min(Math.ceil(arrayWidthFt / estBranches), 80));
          return {
            DC_STRING_RUN:         userDcLen ?? dcRunFt,
            ROOF_RUN:              userDcLen ?? (isMicroTopo ? 5 : 10),   // panel-to-device DC
            BRANCH_RUN:            config.wireLength ?? Math.max(15, Math.min(branchRunFt, 100)),
            INV_TO_DISCO_RUN:      15,
            COMBINER_TO_DISCO_RUN: Math.max(15, Math.min(Math.ceil(diagonalFt / 4), 50)),
            DISCO_TO_METER_RUN:    25,
            METER_TO_MSP_RUN:      10,
            MSP_TO_UTILITY_RUN:    5,
            DC_DISCO_TO_INV_RUN:   15,
          };
        }

        // Roof: standard defaults (unchanged)
        return {
          DC_STRING_RUN:         userDcLen ?? 50,
          ROOF_RUN:              userDcLen ?? 30,
          BRANCH_RUN:            config.wireLength ?? 50,
          INV_TO_DISCO_RUN:      20,
          COMBINER_TO_DISCO_RUN: 20,
          DISCO_TO_METER_RUN:    15,
          METER_TO_MSP_RUN:      10,
          MSP_TO_UTILITY_RUN:    5,
          DC_DISCO_TO_INV_RUN:   10,
        };
      })(),
      runLengthsBatteryGen: {
        generatorToAts: config.generatorWireLength ?? 50,
      },
      conduitType: config.conduitType ?? 'EMT',
      mainPanelAmps: config.mainPanelAmps ?? 200,
      mainPanelBrand: config.mainPanelBrand ?? 'Square D',
      panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200,
      interconnectionMethod: config.interconnectionMethod ?? 'LOAD_SIDE',
      branchCount: topology === 'micro' ? Math.ceil(totalPanels / (modulesPerDevice * branchLimit)) : undefined,
      maxACVoltageDropPct: 2,
      maxDCVoltageDropPct: 3,
      // Battery NEC 705.12(B) bus impact — AC-coupled batteries add backfeed breaker to bus loading
      batteryIds: config.batteryId ? [config.batteryId] : [],
      // BUILD v24: Battery/Generator/ATS NEC-sized segment inputs
      batteryBackfeedA: config.batteryId ? calcBatteryBackfeedAmps(config.batteryId, config.batteryCount) : undefined,
      batteryContinuousOutputA: config.batteryId
        ? (() => { const b = getBatteryById(config.batteryId); return b?.maxContinuousOutputA ?? 0; })()
        : undefined,
      generatorOutputBreakerA: config.generatorId
        ? (() => { const g = getGeneratorById(config.generatorId); return g?.outputBreakerA ?? undefined; })()
        : undefined,
      generatorKw: config.generatorId
        ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? undefined; })()
        : undefined,
      atsAmpRating: config.atsId
        ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? undefined; })()
        : undefined,
      backupInterfaceMaxA: (() => {
        const _atsId = config.atsId?.toLowerCase() ?? '';
        const _isIQSC3viaATS = _atsId.includes('enphase-iq-sc3') || _atsId.includes('enphase-iq-system-controller');
        const _resolvedBuiId = config.backupInterfaceId || (_isIQSC3viaATS ? 'enphase-iq-system-controller-3' : '');
        const _bi = _resolvedBuiId ? getBackupInterfaceById(_resolvedBuiId) : undefined;
        return _bi?.maxContinuousOutputA ?? undefined;
      })(),
      hasEnphaseIQSC3: (() => {
        const buiId = config.backupInterfaceId?.toLowerCase() ?? '';
        const atsId = config.atsId?.toLowerCase() ?? '';
        return buiId.includes('iq-system-controller-3') || buiId.includes('iq-sc3') || buiId.includes('iqsc3')
          || atsId.includes('enphase-iq-sc3') || atsId.includes('enphase-iq-system-controller');
      })(),
      // Equipment IDs — for equipment schedule display
      generatorId:    config.generatorId || undefined,
      atsId:          config.atsId || undefined,
      backupInterfaceId: (() => {
        const _atsId = config.atsId?.toLowerCase() ?? '';
        const _isIQSC3viaATS = _atsId.includes('enphase-iq-sc3') || _atsId.includes('enphase-iq-system-controller');
        return config.backupInterfaceId || (_isIQSC3viaATS ? 'enphase-iq-system-controller-3' : undefined);
      })(),
      // Derived labels for equipment schedule fallback
      generatorBrand: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? undefined; })() : undefined,
      generatorModel: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.model ?? undefined; })() : undefined,
      atsBrand:       config.atsId ? (() => { const a = getATSById(config.atsId); return a?.manufacturer ?? undefined; })() : undefined,
      atsModel:       config.atsId ? (() => { const a = getATSById(config.atsId); return a?.model ?? undefined; })() : undefined,
      backupInterfaceBrand: config.backupInterfaceId ? (() => { const b = getBackupInterfaceById(config.backupInterfaceId); return b?.manufacturer ?? undefined; })() : undefined,
      backupInterfaceModel: config.backupInterfaceId ? (() => { const b = getBackupInterfaceById(config.backupInterfaceId); return b?.model ?? undefined; })() : undefined,
      batteryCount:   config.batteryCount || undefined,
    };

    try {
      return computeSystem(input);
    } catch (e) {
      console.error('ComputedSystem error:', e);
      // Return a minimal safe object on error
      return computeSystem({ ...input, totalPanels: Math.max(1, systemPanelCount > 0 ? systemPanelCount : totalPanels) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, totalPanels, systemPanelCount, compliance.autoDetected]);

  // Shorthand aliases from ComputedSystem
  const cs = computedSystem;

  // ──────────────────────────────────────────────────────────────────
  // Phase 11 — Brand-driven sizing recommendation
  //
  // Runs the sizing engine against the CURRENT user config and the
  // CURRENT panel count. The UI then diffs current vs recommended and
  // offers a single-click "Apply" button. Nothing here mutates state.
  // ──────────────────────────────────────────────────────────────────
  const sizingRecommendation = useMemo<SystemSizingResult | null>(() => {
    const primary = config.inverters[0];
    if (systemPanelCount <= 0) return null;
    if (resolvedPanelCount.mismatchedWithConfig) {
      console.log('[SIZING PANEL SOURCE] Using ' + systemPanelCount + ' panels from ' + resolvedPanelCount.source + ' (config-derived totalPanels=' + totalPanels + ' is stale)');
    }
    // Phase 13.1 — DEBUG log for sizing engine call. The useMemo below is
    // DISPLAY-ONLY; it produces `sizingRecommendation` for the read-only
    // panel and does NOT mutate config. Mutations only happen via
    // applySizingRecommendation() (explicit Apply button OR auto-apply
    // watcher). The auto-apply watcher is locked by
    // config.userHasEditedInverters — see useEffect below.
    console.log('🚨 [SIZING ENGINE] computing recommendation (display only) — userHasEditedInverters:', config.userHasEditedInverters);
    try {
      const panelData = primary?.strings[0]
        ? (SOLAR_PANELS.find(p => p.id === primary.strings[0].panelId) as any)
        : null;
      const panelWattage = panelData?.watts ?? 400;

      // Phase 13.9 — Brand inference.
      // `config.selectedBrand` is stamped at project load / smart-defaults
      // time. When the user manually picks a different inverter brand (e.g.
      // switches from Enphase to SolarEdge) the config inverter changes but
      // selectedBrand is NOT automatically updated — it only gets written
      // during applySizingRecommendation or smart-defaults. If we pass the
      // stale selectedBrand the engine recommends the old brand, the diff
      // fires a mismatch, and the "Apply" button bounces the user back to
      // the old brand in an infinite loop.
      // Solution: look up the brand that actually owns the current inverter
      // model. If that brand differs from config.selectedBrand we use the
      // inferred brand for this recommendation call so the engine agrees
      // with what the user is already looking at.
      const inferredBrand =
        primary?.inverterId
          ? getBrandProfileByInverterId(primary.inverterId)?.id
          : undefined;
      // Phase 14.5 — Micro-topology safety net.
      // If the current inverter is typed as 'micro' but getBrandProfileByInverterId
      // returns undefined (e.g. APsystems/Hoymiles before their profiles were
      // registered, or any future micro brand), falling back to config.selectedBrand
      // (which may be stale from a previous string-inverter session) would return
      // topology:'string' → auto-apply fires topologyMismatch → Fronius overwrites
      // the user's micro config in an infinite loop.
      // Fix: when the UI type is 'micro' and no profile was found by inverter ID,
      // force selectedBrand to 'enphase' (the canonical micro brand with a profile)
      // so the engine always returns topology:'micro' and auto-apply stays quiet.
      const isMicroUiType = primary?.type === 'micro';
      const effectiveBrand = inferredBrand
        ?? (isMicroUiType ? 'enphase' : config.selectedBrand);

      // v47.411 — pass optimizer cap to feasibility evaluator so SolarEdge
      // (and any optimizer-topology brand) systems are evaluated with NEC
      // 690.8(A)(2) regulated-output current instead of panel Isc x 1.25.
      // Primary inverter's nameplate cap is used when present; evaluator
      // falls back to 15.0A (covers SolarEdge P-series + Tigo TS4-A-O).
      const primaryOptimizerCap: number | undefined =
        typeof (primary as any)?.optimizerMaxOutputCurrent === 'number' &&
        (primary as any).optimizerMaxOutputCurrent > 0
          ? (primary as any).optimizerMaxOutputCurrent
          : undefined;

      const result = sizeSystemFromBrand({
        systemType: config.systemType,
        // SOURCE OF TRUTH: CAD → SystemDefinition → config fallback.
        // NEVER read directly from inverter.strings[].panelCount here.
        panelCount: systemPanelCount,
        panelWattage,
        panelVoc:          panelData?.voc,
        panelVmp:          panelData?.vmp,
        // Phase 13.8 — pass electrical specs so voltage-aware string sizing
        // activates. Without panelIsc + panelTempCoeffVoc the voltage clamp
        // is skipped and the engine produces over-voltage string layouts.
        panelIsc:          panelData?.isc,
        panelTempCoeffVoc: panelData?.tempCoeffVoc,
        // v47.423 — pass the panel id so the Panel Compatibility Gate
        // runs. Enables brand-agnostic auto-swap when the loaded panel
        // is incompatible with the selected brand's per-MPPT current cap.
        panelId:           panelData?.id,
        optimizerMaxOutputCurrent: primaryOptimizerCap,   // v47.411
        selectedBrand:      effectiveBrand,
           // v58.2 — When the current config has DC/AC < 1.0 (AC > DC), do NOT
           // pass selectedInverterId. Passing a violating inverter ID biases the
           // engine back to that same model, producing a circular recommendation
           // that is itself broken. Without selectedInverterId, the auto-tier
           // path picks the correct model from scratch (e.g. se-11400h×1 at 1.26).
           selectedInverterId: (() => {
             if (!primary?.inverterId) return undefined;
             const _dcKw  = (systemPanelCount * panelWattage) / 1000;
             const _acKw  = Number(totalInverterKw);
             const _ratio = calcDcAcRatio(_dcKw, _acKw);
             if (_ratio > 0 && _ratio < 1.0) {
               console.log('🔓 [SIZING REC] ratio', _ratio.toFixed(3), '< 1.0 — drop selectedInverterId for clean auto-tier');
               return undefined;
             }
             return primary.inverterId;
           })(),
        batteryEnabled,
        batteryMode: 'auto',
        batteryGoal: 'backup',
        batteryTargetKwh: config.batteryKwh || undefined,
      });
      return result;
    } catch (err) {
      console.warn('[SIZING RECOMMENDATION] sizeSystemFromBrand failed:', err);
      return null;
    }
  }, [
    config.systemType,
    // Depend on the AUTHORITATIVE panel count — recompute when CAD or
    // SystemDefinition changes, not just the config-derived sum.
    systemPanelCount,
    resolvedPanelCount.source,
    resolvedPanelCount.mismatchedWithConfig,
    totalPanels,
    config.inverters,
    // Phase 13.9 — also recompute when selectedBrand changes (e.g. after
    // applySizingRecommendation syncs the brand back into config).
    config.selectedBrand,
    batteryEnabled,
    config.batteryKwh,
  ]);

  // Snapshot of current config for diffing.
    // v58.0 — Canonical AC output kW.
    // Always prefer sizingRecommendation (engine truth) over totalInverterKw
    // (which reads config.inverters and may reflect stale model/count).
    // Used by Electrical tab, Engineering Summary, and DC/AC ratio display.
    const _recInverterAcKw = sizingRecommendation
      ? sizingRecommendation.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0)
      : 0;
    const canonicalAcKw = _recInverterAcKw > 0
      ? _recInverterAcKw
      : Number(totalInverterKw);

  const sizingCurrentSnapshot = useMemo<CurrentConfigSnapshot>(() => {
    const primary = config.inverters[0];
    const totalStringCount = config.inverters.reduce(
      (sum, inv) => sum + inv.strings.length, 0,
    );
    const primaryStringPanelCount = primary?.strings[0]?.panelCount ?? 0;
    const rawTopology = primary?.type ?? 'string';
    // Map 'ecoflow' UI type → 'hybrid' sizing topology for comparison.
    const currentTopology = rawTopology === 'ecoflow' ? 'hybrid' : rawTopology;
    const micros = primary?.type === 'micro'
      ? config.inverters.reduce((s, inv) => s + inv.strings.reduce((ss, st) => ss + st.panelCount, 0), 0)
      : 0;
    // Per-string panel counts across all inverters. For micro this is not
    // used by the layout-mismatch detector (micro compares total counts).
    const stringPanelCounts = config.inverters.flatMap(
      inv => inv.strings.map(s => s.panelCount),
    );
    return {
      inverterCount: config.inverters.length,
      inverterId: primary?.inverterId ?? '',
      topology: currentTopology,
      stringCount: totalStringCount,
      panelsPerString: primaryStringPanelCount,
      stringPanelCounts,
      microDeviceCount: micros,
      batteryEnabled,
      batteryModuleCount: config.batteryCount ?? 0,
    };
  }, [config.inverters, batteryEnabled, config.batteryCount]);

  // Phase 12 — System-wide validation. Pure analysis of the current sizing
  // result + optional context (CAD count). Non-blocking: the UI surfaces
  // results but never mutates. Downstream exports consult result.isPassing.
  const validationResult = useMemo<ValidationResult | null>(() => {
    if (!sizingRecommendation) return null;
    try {
      return validateSystem({
        sizingResult: sizingRecommendation,
        cadModel: { totalPanels: systemPanelCount },
      });
    } catch (err) {
      console.warn('[VALIDATION] validateSystem failed:', err);
      return null;
    }
  }, [sizingRecommendation, systemPanelCount]);

  /**
   * Phase 11 — Apply recommended sizing. Overwrites inverters / strings
   * cleanly (no partial mutations). Never silently overrides — this only
   * runs from the "Apply" button or when sizingAutoApply === true.
   */
  const applySizingRecommendation = useCallback((rec: SystemSizingResult) => {
    console.log('[SIZING APPLY] Applying recommendation:', {
      brand: rec.brand.id,
      topology: rec.topology,
      inverterCount: rec.inverterCount,
      strings: rec.strings.length,
      micros: rec.microDeviceCount,
      battery: rec.battery?.installedKwh ?? null,
    });

    setConfig(prev => {
      const existingStr = prev.inverters[0]?.strings[0];
      // v47.424 — Honor the gate's panel swap. When the sizing engine
      // auto-switched panels for brand compatibility, the config MUST
      // adopt the swapped panel — otherwise the downstream compliance
      // engine (which reads from config.inverters) runs against the
      // original incompatible panel and re-emits MPPT_CURRENT_EXCEEDED.
      //
      // Brand-agnostic by construction: this simply trusts the gate's
      // verdict. The gate lives in lib/system/panelCompatibilityGate.ts
      // and works for every current and future brand.
      const gateEffectivePanelId = rec.panelCompatibility?.autoSwitched
        ? rec.panelCompatibility.effectivePanelId
        : undefined;
      const existingPanelId =
        gateEffectivePanelId
        ?? existingStr?.panelId
        ?? defaultPanelForSystemType(prev.systemType);
      if (gateEffectivePanelId) {
        console.log('🔄 [v47.424 PANEL SWAP] applySizingRecommendation honoring gate swap:',
          { from: existingStr?.panelId, to: gateEffectivePanelId, reason: rec.panelCompatibility?.reason });
      }

      // v47.418 — Resolve the UI "type" from topology. Hybrid topology now
      // maps to the new first-class 'hybrid' InverterType (previously all
      // hybrids were aliased to the legacy 'ecoflow' label which broke
      // Sol-Ark end-to-end: server route → feasibility evaluator →
      // electrical-calc never received 'hybrid' and applied string-topology
      // rules even though the inverter self-limits current at the MPPT).
      //
      // EcoFlow PowerOcean products (brandId === 'ecoflow') get the legacy
      // 'ecoflow' label for back-compat with BOM/ecosystem pipelines that
      // still key off it. Every OTHER hybrid brand (Sol-Ark, future hybrids)
      // emits 'hybrid'.
      const uiType: InverterType =
        rec.topology === 'hybrid'
          ? (rec.brand.id === 'ecoflow' ? 'ecoflow' : 'hybrid')
          : rec.topology === 'micro' ? 'micro'
          : rec.topology === 'optimizer' ? 'optimizer'
          : 'string';

      const primaryModel = rec.inverterModels[0];
      if (!primaryModel) return prev;

      // Helper: build a fresh string using the canonical newString() then
      // overlay panelId + panelCount. Preserves tilt/azimuth/mountingSystem
      // defaults and any roof-type-aware defaults inside newString().
      const buildString = (idx: number, panelCount: number, reuseLabel?: string) => {
        const base = newString(idx, prev.systemType);
        return {
          ...base,
          id: `str-applied-${Date.now()}-${idx}`,
          label: reuseLabel ?? base.label,
          panelId: existingPanelId,
          panelCount,
          // Preserve user-configured wire length / gauge where possible.
          wireGauge: existingStr?.wireGauge ?? base.wireGauge,
          wireLength: existingStr?.wireLength ?? base.wireLength,
          tilt: existingStr?.tilt ?? base.tilt,
          azimuth: existingStr?.azimuth ?? base.azimuth,
          roofType: existingStr?.roofType ?? base.roofType,
          mountingSystem: existingStr?.mountingSystem ?? base.mountingSystem,
        };
      };

      const newInverters: InverterConfig[] = [];

      if (uiType === 'micro') {
        // Single inverter entry; one "string" holding the ACTUAL panel count,
        // NOT the device count. For dual-module micros (e.g. APsystems DS3-L,
        // modulesPerDevice=2), rec.microDeviceCount = ceil(panels / mpd) which
        // is half the actual panel count. Storing device count as panelCount
        // caused totalKw = deviceCount × panelWatts instead of panels × panelWatts.
        // Fix: use rec.input.panelCount (the authoritative panel count fed to the engine).
        // rec.input is always populated (SizingInput is required), so the fallback
        // to microDeviceCount is a last-resort guard only.
        const actualPanelCount = rec.input.panelCount > 0
          ? rec.input.panelCount
          : rec.microDeviceCount;
        newInverters.push({
          id: `inv-applied-${Date.now()}`,
          inverterId: primaryModel.equipmentDbId,
          type: 'micro',
          strings: [buildString(0, actualPanelCount, 'All Panels')],
        });
      } else {
        // string / optimizer / hybrid: group strings by inverterIndex.
        const stringsByInverter = new Map<number, typeof rec.strings>();
        for (const s of rec.strings) {
          if (!stringsByInverter.has(s.inverterIndex)) stringsByInverter.set(s.inverterIndex, []);
          stringsByInverter.get(s.inverterIndex)!.push(s);
        }
        const totalInverterUnits = rec.inverterCount;
        for (let idx = 0; idx < totalInverterUnits; idx++) {
          const assigned = stringsByInverter.get(idx) ?? [];
          const invStrings = assigned.length > 0
            ? assigned.map((s, i) => buildString(i, s.panelCount, `String ${i + 1}`))
            // Fallback: one empty string (engine didn't assign — unlikely)
            : [buildString(0, 0, 'String 1')];
          newInverters.push({
            id: `inv-applied-${Date.now()}-${idx}`,
            inverterId: primaryModel.equipmentDbId,
            type: uiType,
            strings: invStrings,
          });
        }
      }

      // Battery fields — follow the sizing engine verdict.
      // Phase 13.1 — USER INTENT LOCK: an EXPLICIT "Apply Recommendation"
      // means the user has adopted the sizing engine's plan as-is, so we
      // clear the lock back to `false`. From this point on, auto-apply
      // will see matching config and stay quiet, while any subsequent
      // user edit re-engages the lock.
      // Phase 13.9 — also sync selectedBrand to the recommendation's brand.
      // Without this, selectedBrand stays stale (e.g. "enphase") after
      // applying a SolarEdge recommendation, causing the mismatch banner
      // to re-fire on the next render.
      const patch: Partial<ProjectConfig> = {
        inverters: newInverters,
        userHasEditedInverters: false,
        selectedBrand: rec.brand.id,
      };
      if (rec.battery && rec.battery.equipmentDbId) {
        patch.batteryId = rec.battery.equipmentDbId;
        patch.batteryCount = rec.battery.moduleCount;
        patch.batteryKwh = rec.battery.installedKwh;
        patch.batteryBrand = rec.brand.manufacturer;
        patch.batteryModel = rec.battery.equipmentDbId;
      } else {
        // No battery in recommendation — clear battery fields cleanly.
        patch.batteryId = '';
        patch.batteryCount = 0;
        patch.batteryKwh = 0;
      }

      return { ...prev, ...patch };
    });

    // Surface the dismissal reset so the panel stays visible but shows "matches".
    setSizingDismissed(false);
  }, []);

  // ─── Phase 13 — Smart Defaults (once-only bootstrap) ────────────────
  //
  // Fires EXACTLY ONCE per project load when:
  //   1. CAD has produced a real panel count (systemPanelCount > 0), AND
  //   2. The project is factory-fresh (no user edits detected), AND
  //   3. The `defaultsApplied` sentinel is not yet set.
  //
  // After the sentinel flips to true, this effect is a permanent no-op
  // until the user explicitly resets the system (clearDefaultsAppliedFlag).
  // The module never touches site metadata / contractor / utility / etc. —
  // it only writes `inverters`, `defaultsApplied`, and (optionally) the
  // seed `selectedBrand`. All downstream hooks (sizing recommendation,
  // validation, auto-apply) continue to run normally over the patched
  // config, because we stay on the existing pipeline.
  useEffect(() => {
    if (config.defaultsApplied) return;
    if (systemPanelCount <= 0) return;
    // Phase 13.1 — USER INTENT LOCK. Belt-and-suspenders: even if the
    // `defaultsApplied` sentinel somehow got cleared, never reapply
    // defaults over a config the user has already touched.
    if (config.userHasEditedInverters) {
      console.log('🔒 [SMART DEFAULTS] blocked — userHasEditedInverters=true');
      return;
    }

    const primary = config.inverters[0];
    const panelData = primary?.strings[0]
      ? (SOLAR_PANELS.find(p => p.id === primary.strings[0].panelId) as any)
      : null;
    const panelWattage = panelData?.watts ?? 400;

    console.log('🚨 [SMART DEFAULTS] calling applySmartDefaultsOnce — systemPanelCount=', systemPanelCount, ', defaultsApplied=', config.defaultsApplied);
    const result = applySmartDefaultsOnce({
      config: {
        systemType: config.systemType,
        inverters: config.inverters,
        defaultsApplied: config.defaultsApplied,
        selectedBrand: config.selectedBrand,
      },
      systemPanelCount,
      panelWattage,
    });

    if (!result.applied) {
      console.log('🔒 [SMART DEFAULTS] no-op —', result.reason);
      return;
    }
    console.log('✅ [SMART DEFAULTS] applied — seedBrand=', result.seedBrand);

    // Merge the (minimal) patch onto config. We preserve every other
    // field untouched — the patch only carries `inverters`,
    // `defaultsApplied`, and optionally `selectedBrand`. To build
    // page-compatible StringConfig objects, we start from newString()
    // (which carries label/roofType/mountingSystem/wire defaults) and
    // then override only the structural fields the sizing engine
    // decided (id, panelCount, panelId).
    setConfig(prev => {
      const hydratedInverters: InverterConfig[] = result.patch.inverters!.map((inv, idx) => ({
        id: inv.id,
        inverterId: inv.inverterId,
        type: inv.type as InverterType,
        strings: inv.strings.map((s, sIdx) => {
          const base = newString(sIdx, prev.systemType);
          return {
            ...base,
            id: s.id,
            label: `String ${String.fromCharCode(65 + idx)}${sIdx + 1}`,
            panelCount: s.panelCount,
            panelId: s.panelId || base.panelId,
          };
        }),
      }));

      return {
        ...prev,
        inverters: hydratedInverters,
        defaultsApplied: true,
        // Only stamp selectedBrand when defaults picked one (user hadn't).
        ...(result.patch.selectedBrand ? { selectedBrand: result.patch.selectedBrand } : {}),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemPanelCount, config.defaultsApplied, config.userHasEditedInverters]);

  // Auto-apply watcher (opt-in). Fires only when:
  //   1. sizingAutoApply === true
  //   2. sizingRecommendation exists
  //   3. current config does NOT match the recommendation
  // Never flips sizingAutoApply off automatically.
  //
  // v47.370 (Phase 12.5): inverter-count mismatch check goes through the
  // normalizer so a fresh-applied micro config (1 UI card / 36 panels) is
  // NOT treated as drifted vs a sizing result reporting 36 microinverters.
  // Before this fix, auto-apply for Enphase ran every render in a loop.
  useEffect(() => {
    if (!sizingAutoApply) return;
    if (!sizingRecommendation) return;
    // Phase 13.1 — USER INTENT LOCK. If the user has edited the inverter
    // config, auto-apply is a HARD STOP. The recommendation stays visible
    // (read-only), but we never mutate the user's config silently. The
    // user can still click "Apply Recommendation" explicitly.
    if (config.userHasEditedInverters) {
      console.log('🔒 [AUTO-APPLY] blocked — userHasEditedInverters=true (user config is source of truth)');
      return;
    }
    // Quick structural check: any mismatch triggers apply.
    const rec = sizingRecommendation;
    const snap = sizingCurrentSnapshot;
    const topologyMismatch = snap.topology !== rec.topology;
    // Route inverter-count comparison through the normalizer to avoid
    // the UI-card-count-vs-physical-count false positive (notably for
    // micro topology). When topologies disagree, skip the physical check
    // — it would be comparing apples to oranges.
    const normDiff = !topologyMismatch
      ? diffNormalizedInverterState(
          {
            cardCount: snap.inverterCount,
            panelCount: snap.topology === 'micro'
              ? snap.microDeviceCount
              : snap.stringPanelCounts.reduce((s, n) => s + n, 0),
            topology: snap.topology,
          },
          rec,
        )
      : null;
    const countMismatch = normDiff ? normDiff.physicalMismatch : false;
    const modelMismatch =
      rec.inverterModels[0]?.equipmentDbId && snap.inverterId !== rec.inverterModels[0].equipmentDbId;
    // String-layout mismatch catches cases where inverter/topology match
    // but the per-string panel distribution is wrong (AUTO STRING REBUILD).
    const stringLayoutMismatch = detectStringLayoutMismatch(snap, rec);
    if (topologyMismatch || countMismatch || modelMismatch || stringLayoutMismatch) {
      console.log('🚨 [AUTO-APPLY] firing applySizingRecommendation (no user lock, mismatch detected)');
      applySizingRecommendation(rec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizingAutoApply, sizingRecommendation, config.userHasEditedInverters]);

     // ─── Phase 14.2 — HARD DC/AC ERROR AUTO-HEAL ─────────────────────────────────
     // When validationResult contains DC_AC_RATIO_AC_EXCEEDS_DC (ratio < 1.0) AND
     // the sizing engine has a recommendation, we override the userHasEditedInverters
     // lock and auto-apply. This is not a silent override of user preference — it
     // corrects a hard electrical constraint violation. The system cannot permit export
     // while DC/AC < 1.0; auto-healing prevents the "screaming errors, no solution" UX.
     useEffect(() => {
       if (!validationResult) return;
       if (!sizingRecommendation) return;
       const hasHardDcAcError = validationResult.errors.some(
         e => e.code === 'DC_AC_RATIO_AC_EXCEEDS_DC',
       );
       if (!hasHardDcAcError) return;
       if (!config.userHasEditedInverters) return;
       // Safety: do not override if the recommendation itself also violates.
       const totalAcKw = sizingRecommendation.inverterModels.reduce(
         (s, m) => s + m.acKw * m.qty, 0,
       );
       const dcKw = (sizingRecommendation.input.panelCount * (sizingRecommendation.input.panelWattage ?? 400)) / 1000;
       const recRatio = calcDcAcRatio(dcKw, totalAcKw);
       if (recRatio < 1.0) {
         console.warn('[HARD DC/AC AUTO-HEAL] recommendation also has ratio < 1.0 — skipping', { recRatio });
         return;
       }
       console.log('⚡ [HARD DC/AC AUTO-HEAL] overriding user lock — applying correct config', {
         recRatio: recRatio.toFixed(3),
         inverters: sizingRecommendation.inverterModels.map(m => `${m.qty}×${m.equipmentDbId}`).join(' + '),
       });
       applySizingRecommendation(sizingRecommendation);
       // eslint-disable-next-line react-hooks/exhaustive-deps
     }, [validationResult, sizingRecommendation, config.userHasEditedInverters]);


  // ═══════════════════════════════════════════════════════════════════════
  // v47.424 — PANEL COMPATIBILITY AUTO-HEAL (brand-agnostic, unbypassable)
  //
  // When sizeSystemFromBrand() determines the loaded panel is incompatible
  // with the selected brand's per-MPPT current cap, it auto-swaps to a
  // catalog-compatible panel. That swap is advisory until the config is
  // actually updated. This effect CLOSES THE LOOP by writing the swap
  // directly into config.inverters[].strings[].panelId — which is what
  // every downstream consumer (compliance engine, string generator, BOM,
  // plan set) reads from.
  //
  // Why this must run unconditionally (including when the user has
  // edited the config): a panel/brand mismatch is NOT a user preference
  // — it is a NEC 690.8(A)(1) compliance failure that will fail permit.
  // The user selected a brand ecosystem, and within that ecosystem the
  // loaded panel cannot legally work. We correct it silently and
  // surface the reason via the blue banner.
  //
  // BRAND-AGNOSTIC BY CONSTRUCTION: this watcher reads ONLY from the
  // gate's verdict (sizingRecommendation.panelCompatibility). Every
  // current and future brand inherits this protection automatically
  // the moment they are registered in BRAND_PROFILES — zero new code.
  // ═══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const compat = sizingRecommendation?.panelCompatibility;
    if (!compat) return;
    if (!compat.autoSwitched) return;               // gate said no swap needed
    const target = compat.effectivePanelId;
    if (!target) return;

    // Does the current config already reflect the swap? If every string
    // on every inverter is already on the target panel, we are done.
    const allAligned = config.inverters.every(inv =>
      inv.strings.every(s => s.panelId === target),
    );
    if (allAligned) return;

    console.log(
      '🔄🔧 [v47.424 AUTO-HEAL] Panel compatibility mismatch — writing gate\'s effective panel into config.',
      {
        brand: compat.brand?.id,
        original: compat.originalPanelId,
        effective: target,
        reason: compat.reason,
      },
    );

    setConfig(prev => ({
      ...prev,
      inverters: prev.inverters.map(inv => ({
        ...inv,
        strings: inv.strings.map(s =>
          s.panelId === target ? s : { ...s, panelId: target }
        ),
      })),
      // We intentionally do NOT engage the user-lock here. This is a
      // compliance correction, not a user edit. Leave userHasEditedInverters
      // untouched so Smart Defaults / auto-apply behaviour is preserved.
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sizingRecommendation?.panelCompatibility?.autoSwitched,
    sizingRecommendation?.panelCompatibility?.effectivePanelId,
    // Re-check when inverter set changes (new strings added etc.)
    config.inverters,
  ]);

  const updateConfig = (patch: Partial<ProjectConfig>) => setConfig(prev => ({ ...prev, ...patch }));

  // Phase 13.1 — USER INTENT LOCK helper.
  // Stamps `userHasEditedInverters: true` on every inverter / string
  // mutation. Once set, this lock blocks Smart Defaults re-entry AND
  // blocks auto-apply of the sizing recommendation. The user's config
  // becomes the source of truth; the recommendation stays visible but
  // read-only.
  const LOCK = { userHasEditedInverters: true as const };

  const addInverter = (type: InverterType) => {
    console.log('🔒 [USER EDIT] addInverter(', type, ') — engaging user lock');
    if (type === 'micro') {
      // MICRO: replace ALL existing inverters with a single micro entry
      // Collect total panel count from all existing inverters
      setConfig(prev => {
        const totalPanels = prev.inverters.reduce(
          (sum, i) => sum + i.strings.reduce((s, str) => s + str.panelCount, 0), 0
        ) || 20;
        const microId = MICROINVERTERS[0]?.id || 'enphase-iq8plus';
        // Preserve existing panelId if user had one (non-destructive); otherwise use system-type default
        const existingPanelId = prev.inverters[0]?.strings[0]?.panelId;
        const inv: InverterConfig = {
          id: `inv-${Date.now()}`,
          inverterId: microId,
          type: 'micro',
          strings: [{ ...newString(0, prev.systemType), panelId: existingPanelId || defaultPanelForSystemType(prev.systemType), panelCount: totalPanels }],
        };
        setExpandedInv(inv.id);
        return { ...prev, inverters: [inv], ...LOCK };
      });
    } else {
      const inv = newInverter(type);
      setConfig(prev => ({ ...prev, inverters: [...prev.inverters, inv], ...LOCK }));
      setExpandedInv(inv.id);
    }
  };
  const removeInverter = (id: string) => {
    console.log('🔒 [USER EDIT] removeInverter — engaging user lock');
    setConfig(prev => ({ ...prev, inverters: prev.inverters.filter(i => i.id !== id), ...LOCK }));
  };
  const updateInverter = (id: string, patch: Partial<InverterConfig>) => {
    console.log('🔒 [USER EDIT] updateInverter — engaging user lock');
    setConfig(prev => ({ ...prev, inverters: prev.inverters.map(i => i.id === id ? { ...i, ...patch } : i), ...LOCK }));
  };
  const addString = (invId: string) => {
    console.log('🔒 [USER EDIT] addString — engaging user lock');
    setConfig(prev => ({ ...prev, inverters: prev.inverters.map(i => i.id === invId ? { ...i, strings: [...i.strings, newString(i.strings.length, prev.systemType)] } : i), ...LOCK }));
  };
  const removeString = (invId: string, strId: string) => {
    console.log('🔒 [USER EDIT] removeString — engaging user lock');
    setConfig(prev => ({ ...prev, inverters: prev.inverters.map(i => i.id === invId ? { ...i, strings: i.strings.filter(s => s.id !== strId) } : i), ...LOCK }));
  };
  const updateString = (invId: string, strId: string, patch: Partial<StringConfig>) => {
    console.log('🔒 [USER EDIT] updateString — engaging user lock');
    setConfig(prev => ({ ...prev, inverters: prev.inverters.map(i => i.id === invId ? { ...i, strings: i.strings.map(s => s.id === strId ? { ...s, ...patch } : s) } : i), ...LOCK }));
  };

  // Topology switch: calls API to propagate ecosystem when inverter type changes
  const handleTopologySwitch = useCallback(async (invId: string, newType: InverterType, newInverterId: string) => {
    // DIAGNOSTIC LOG 1
    const newTopo = newType === 'micro' ? 'MICRO' : newType === 'optimizer' ? 'STRING_OPTIMIZER' : 'STRING';
    console.log('Topology switched:', newTopo, '| inverter:', newInverterId, '| type:', newType);

    // USER INTENT LOCK — a topology switch is an explicit user edit, so
    // engage the lock for both branches (micro + non-micro).
    console.log('🔒 [USER EDIT] handleTopologySwitch — engaging user lock');

    // When switching to micro: REPLACE ALL inverters with a single micro entry
    // Collect total panels from ALL inverters — micro is always a single unified system
    if (newType === 'micro') {
      setConfig(prev => {
        const totalPanels = prev.inverters.reduce(
          (sum, i) => sum + i.strings.reduce((s, str) => s + str.panelCount, 0), 0
        ) || 20;
        console.log('Micro topology: collapsing ALL inverters into single entry, totalPanels=', totalPanels);
        const firstStr = prev.inverters[0]?.strings[0] ?? newString(0, prev.systemType);
        const singleMicroInv: InverterConfig = {
          id: invId,
          inverterId: newInverterId,
          type: 'micro',
          strings: [{ ...firstStr, panelCount: totalPanels }],
        };
        return { ...prev, inverters: [singleMicroInv], userHasEditedInverters: true };
      });
    } else {
      // Update local config immediately for string/optimizer. updateInverter
      // already engages the lock internally.
      updateInverter(invId, { type: newType, inverterId: newInverterId });
    }
    // v57.5 — Record topology change for audit banner
    setTopologyChangeLog(prev => [
      ...prev.slice(-9),
      { from: topologyType, to: newTopo, at: new Date().toLocaleTimeString() }
    ]);
    setShowTopologyBanner(true);
    setTopologyType(newTopo as any);

    if (engineeringMode !== 'AUTO') return;
    setTopologySwitching(true);
    try {
      const state = toSystemState();
      // Update the inverter in the state we're sending
      state.inverters = state.inverters.map((inv: any) =>
        inv.id === invId ? { ...inv, type: newType, inverterId: newInverterId } : inv
      );
      const res = await fetch('/api/engineering/topology', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemState: state,
          newInverterId,
          newInverterType: newType,
          targetInverterConfigId: invId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const result = data.data;
          // DIAGNOSTIC: confirm ecosystem is cleared before rebuild
          const incoming = result.updatedState?.ecosystemComponents || [];
          console.log('Ecosystem cleared before rebuild. Incoming components:', incoming.length, incoming.map((c: any) => c.category));
          setEcosystemComponents(incoming);
          setEcosystemLog(result.propagationLog || []);
          setTopologyType(result.newTopology);
        }
      }
    } catch (e) {
      console.error('Topology switch error:', e);
    } finally {
      setTopologySwitching(false);
    }
  }, [engineeringMode, toSystemState, updateInverter]);

  const buildCalcPayload = useCallback(() => {
    const electricalInverters = config.inverters.map(inv => {
      const invData = getInvById(inv.inverterId, inv.type) as any;
      // modulesPerDevice: use user override if set, else registry default
      const registryModulesPerDevice: number = inv.type === 'micro' ? (invData?.modulesPerDevice ?? 1) : 1;
      const modulesPerDevice: number = inv.deviceRatioOverride ?? registryModulesPerDevice;
      console.log('Using modulesPerDevice:', modulesPerDevice, '| override:', inv.deviceRatioOverride, '| registry:', registryModulesPerDevice, '| inverter:', inv.inverterId, '| type:', inv.type);

      if (inv.type === 'micro') {
        const panelCount = inv.strings.reduce((s, str) => s + str.panelCount, 0);
        const deviceCount = Math.ceil(panelCount / modulesPerDevice);
        console.log('Creating micro devices:', deviceCount, '(panels:', panelCount, '/ modulesPerDevice:', modulesPerDevice, ')');
        // Get panel data from first string for DC size calculation
        const firstStr = inv.strings[0];
        const firstPanel = firstStr ? getPanelById(firstStr.panelId) as any : null;
        const microPanelWatts = firstPanel?.watts || 400;
        const microPanelVoc = firstPanel?.voc || 41.6;
        const microPanelIsc = firstPanel?.isc || 12.26;
        const microTempCoeffVoc = firstPanel?.tempCoeffVoc || -0.26;
        const microTempCoeffIsc = firstPanel?.tempCoeffIsc || 0.05;
        return {
          type: inv.type,
          modulesPerDevice,
          deviceCount,
          acOutputKw: (invData?.acOutputW ?? 290) / 1000, // v58.4: fallback 295->290 (IQ8+ datasheet max continuous = 290VA)
          acOutputCurrentMax: invData?.acOutputCurrentMax ?? 1.21,
          // MPPT specs for string generator
          maxDcVoltage: invData?.maxDcVoltage || 60,
          mpptVoltageMin: invData?.mpptVoltageMin || 16,
          mpptVoltageMax: invData?.mpptVoltageMax || 60,
          mpptChannels: deviceCount,  // each micro is its own MPPT
          // Pass panel specs so electrical-calc can compute DC size
          strings: [{
            panelCount: panelCount,
            panelVoc: microPanelVoc,
            panelIsc: microPanelIsc,
            panelImp: firstPanel?.imp || 11.59,
            panelVmp: firstPanel?.vmp || 34.5,
            panelWatts: microPanelWatts,
            tempCoeffVoc: microTempCoeffVoc,
            tempCoeffIsc: microTempCoeffIsc,
            maxSeriesFuseRating: firstPanel?.maxSeriesFuseRating || 20,
            wireGauge: firstStr?.wireGauge || config.wireGauge,
            wireLength: firstStr?.wireLength || config.wireLength,
            conduitType: config.conduitType,
          }],
        };
      }

      if (inv.type === 'optimizer') {
        // optimizer: deviceRatioOverride = optimizers per module (default 1)
        const optimizersPerModule = inv.deviceRatioOverride ?? 1;
        console.log('Creating optimizer string object | optimizersPerModule:', optimizersPerModule);
      }

      // DIAGNOSTIC LOG 3: string object creation path
      console.log('Creating string object for inverter:', inv.inverterId, '| strings:', inv.strings.length);
      return {
        type: inv.type,
        acOutputKw: invData?.acOutputKw || (invData?.acOutputW / 1000) || 7.6,
        maxDcVoltage: invData?.maxDcVoltage || 600,
        mpptVoltageMin: invData?.mpptVoltageMin || 100,
        mpptVoltageMax: invData?.mpptVoltageMax || 600,
        mpptChannels: invData?.mpptChannels || 2,
        maxInputCurrentPerMppt: invData?.maxInputCurrentPerMppt || invData?.maxInputCurrent || 13.5,
        maxShortCircuitCurrent: invData?.maxShortCircuitCurrent || undefined,
        acOutputCurrentMax: invData?.acOutputCurrentMax || 32,
        // v47.416 — Parallel-strings-per-MPPT cap. Previously omitted from the
        // compliance payload, causing the MPPT allocator to default to 1 in
        // string-generator.ts (line ~372 `?? 1`), which falsely rejects the
        // datasheet-correct SE7600H topology of 2 parallel strings per MPPT.
        // Source of truth: lib/equipment-db.ts per-model `maxParallelStringsPerMppt`,
        // each value reconciled against the official SolarEdge HD-Wave NA
        // datasheet (SE3000/3800/5000/6000/7600: "1-2 strings"; SE10000/11400: "1-3 strings").
        maxParallelStringsPerMppt: invData?.maxParallelStringsPerMppt,
        // v47.415 — Nominal DC bus voltage (e.g. SolarEdge HD-Wave 400V).
        // Forwarded to the compliance API so the MPPT allocator can compute
        // per-string OPERATING current (stringPowerW / nominalDcV) instead
        // of the optimizer nameplate cap. See lib/system/feasibilityEvaluator.ts
        // and lib/string-generator.ts (v47.415 blocks) for details.
        nominalDcVoltage: invData?.nominalDcVoltage || undefined,
        // v47.417 — Factory-integrated DC disconnect switch.
        // When true, lib/electrical-calc.ts suppresses E-DC-DISCONNECT because
        // NEC 690.15 is already satisfied by the inverter's built-in DC safety
        // switch. All modern UL-1741-listed residential string / optimizer /
        // hybrid inverters ship with this switch as part of the unit. Source
        // of truth: lib/equipment-db.ts per-model `integratedDcDisconnect`.
        integratedDcDisconnect: invData?.integratedDcDisconnect,
        strings: inv.strings.map(str => {
          const panel = getPanelById(str.panelId) as any;
          return {
            panelCount: str.panelCount,
            panelVoc: panel?.voc || 41.6,
            panelIsc: panel?.isc || 12.26,
            panelImp: panel?.imp || 11.59,
            panelVmp: panel?.vmp || 34.5,
            panelWatts: panel?.watts || 400,
            tempCoeffVoc: panel?.tempCoeffVoc || -0.26,
            tempCoeffIsc: panel?.tempCoeffIsc || 0.05,
            maxSeriesFuseRating: panel?.maxSeriesFuseRating || 20,
            ...(engineeringMode === 'MANUAL' && str.ocpdOverride ? {
              manualOCPDOverride: str.ocpdOverride,
              engineeringMode: 'MANUAL',
            } : {}),
            wireGauge: str.wireGauge,
            wireLength: str.wireLength,
            conduitType: config.conduitType,
          };
        }),
      };
    });
    // v47.409 — Forward the current Sizing Recommendation's string layout to
    // the compliance API so it can surface an optimizer-specific merge hint
    // when the current (user) layout is infeasible but the recommended layout
    // would fit the same hardware. No auto-apply; pure advisory.
    const recommendedLayoutForApi = sizingRecommendation
      ? {
          topology: sizingRecommendation.topology,
          stringPanelCounts: sizingRecommendation.strings.map(s => s.panelCount),
        }
      : null;

    // v57.5 — topology type forwarded to calculate API so topology guard can fix inv.type
    const invType0 = config.inverters[0]?.type;
    const calcPayloadTopologyType = invType0 === 'micro' ? 'MICRO'
      : invType0 === 'optimizer' ? 'STRING_OPTIMIZER'
      : 'STRING';

    return {
      address: config.address,
      state: config.state || undefined,   // Explicit state code — overrides address parsing in API
      utilityId: config.utilityId || undefined,  // Utility provider ID — used by interconnection engine
      ahjId: config.ahjId || undefined,          // AHJ ID — used by compliance engine
      topologyType: calcPayloadTopologyType,      // v57.5 — topology guard for NEC 690.7 optimizer bypass
      recommendedLayout: recommendedLayoutForApi,  // v47.409 — optimizer merge hint source
      electrical: {
        inverters: electricalInverters,
        mainPanelAmps: config.mainPanelAmps,
        systemVoltage: 240,
        wireGauge: config.wireGauge,
        wireLength: config.wireLength,
        conduitType: config.conduitType,
        rapidShutdown: config.rapidShutdown,
        acDisconnect: config.acDisconnect,
        dcDisconnect: config.dcDisconnect,
        engineeringMode,
        interconnection: {
          method: config.interconnectionMethod ?? 'LOAD_SIDE',
          busRating: config.panelBusRating ?? 200,
          mainBreaker: config.mainPanelAmps ?? 200,
        },
        // Battery NEC 705.12(B) — bus loading impact
        batteryBackfeedA: calcBatteryBackfeedAmps(config.batteryId, config.batteryCount),
        batteryCount: config.batteryCount || 0,
        batteryContinuousOutputA: config.batteryId
          ? (() => { const b = getBatteryById(config.batteryId); return b?.maxContinuousOutputA ?? 0; })()
          : 0,
        batteryModel: config.batteryModel || undefined,
        batteryManufacturer: config.batteryBrand || undefined,
        // Generator NEC 702
        generatorKw: config.generatorId
          ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? undefined; })()
          : undefined,
        generatorOutputBreakerA: config.generatorId
          ? (() => { const g = getGeneratorById(config.generatorId); return g?.outputBreakerA ?? undefined; })()
          : undefined,
        generatorModel: config.generatorId
          ? (() => { const g = getGeneratorById(config.generatorId); return g?.model ?? undefined; })()
          : undefined,
        generatorManufacturer: config.generatorId
          ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? undefined; })()
          : undefined,
        // ATS NEC 702.5
        atsAmpRating: config.atsId
          ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? undefined; })()
          : undefined,
        atsModel: config.atsId
          ? (() => { const a = getATSById(config.atsId); return a?.model ?? undefined; })()
          : undefined,
        // BUI NEC 706
        backupInterfaceMaxA: config.backupInterfaceId
          ? (() => { const b = getBackupInterfaceById(config.backupInterfaceId); return b?.maxContinuousOutputA ?? undefined; })()
          : undefined,
        backupInterfaceModel: config.backupInterfaceId
          ? (() => { const b = getBackupInterfaceById(config.backupInterfaceId); return b?.model ?? undefined; })()
          : undefined,
        hasEnphaseIQSC3: (() => {
          const buiId = config.backupInterfaceId?.toLowerCase() ?? '';
          const atsId = config.atsId?.toLowerCase() ?? '';
          return buiId.includes('iq-system-controller-3') || buiId.includes('iq-sc3')
            || atsId.includes('enphase-iq-sc3') || atsId.includes('enphase-iq-system-controller');
        })(),
      },
      structural: (() => {
        // Use mounting-hardware-db (42 systems) for structural calc specs
        const mountingSystem = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
        const mountSpecs = mountingSystem ? {
          fastenersPerAttachment: mountingSystem.mount?.fastenersPerMount ?? 2,
          upliftCapacity: mountingSystem.mount?.upliftCapacityLbs ?? 984,  // 984 lbs = NDS 2018 Table 12.2A: 5/16" lag × 2.5" embed × Cd=1.6
          attachmentSpacingMax: mountingSystem.mount?.maxSpacingIn,
        } : undefined;
        return {
          windSpeed: config.windSpeed,
          windExposure: config.windExposure,
          groundSnowLoad: config.groundSnowLoad,
          roofType: config.roofType,
          roofPitch: config.roofPitch,
          rafterSpacing: config.rafterSpacing,
          rafterSpan: config.rafterSpan,
          rafterSize: config.rafterSize,
          rafterSpecies: config.rafterSpecies,
          // ── Dynamic panel dims from actual panel data in equipment-db ──────
          ...((() => {
            const _fp = config.inverters[0]?.strings[0];
            const _pd = _fp?.panelId ? (SOLAR_PANELS as any[]).find((p: any) => p.id === _fp.panelId) : null;
            const _pLen = _pd?.length ?? 73.0;
            const _pWid = _pd?.width  ?? 41.0;
            const _pWgt = _pd?.weight ?? 45.0;
            // Racking weight: from rail lb/ft if available, else 4.0 lbs/panel (ASCE standard est.)
            const _msys = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
            const _rkWgt = _msys?.rail?.weightLbsPerFt
              ? Math.round(_msys.rail.weightLbsPerFt * (_pLen / 12) * 2 * 10) / 10
              : 4.0;
            return { panelLength: _pLen, panelWidth: _pWid, panelWeight: _pWgt, rackingWeight: _rkWgt };
          })()),
          panelCount: totalPanels,
          attachmentSpacing: config.attachmentSpacing,
          railSpan: config.railSpacing,
          rowSpacing: 12, arrayTilt: config.roofPitch,
          systemType: config.systemType,
          mountSpecs,
        };
      })(),
    };
  }, [config, totalPanels, sizingRecommendation]);

  // ── saveEngineeringOutputs: persist live engine state to project_files ──────
  const saveEngineeringOutputs = useCallback(async (calcData: any) => {
    if (!currentProjectId) return;
    try {
      const firstInv    = config.inverters[0];
      const firstStr    = firstInv?.strings[0];
      const panelData   = firstStr?.panelId
        ? (SOLAR_PANELS as any[]).find((p: any) => p.id === firstStr.panelId)
        : null;
      const invData     = firstInv?.inverterId
        ? getInvById(firstInv.inverterId, firstInv.type) as any
        : null;

      const elec = calcData?.electrical || calcData?.acSizing
        ? {
            dcSystemKw:      Number(totalKw),
            acSystemKw:      calcData?.summary?.totalAcKw ?? Number(totalInverterKw),
            stringCount:     calcData?.stringConfig?.stringCount ?? computedSystem.strings?.length ?? 1,
            panelsPerString: calcData?.stringConfig?.panelsPerString ?? (firstStr?.panelCount ?? 0),
            stringVoc:       calcData?.stringConfig?.stringVoc ?? null,
            stringIsc:       calcData?.stringConfig?.stringIsc ?? null,
            dcWireGauge:     computedSystem.runs?.find((r: any) => r.id === 'DC_STRING_RUN')?.wireGauge ?? '#10 AWG',
            dcConduitSize:   computedSystem.runs?.find((r: any) => r.id === 'DC_STRING_RUN')?.conduitSize ?? '3/4" EMT',
            dcDisconnect:    `${calcData?.acSizing?.ocpdAmps ?? 15}A, 600VDC`,
            acWireGauge:     computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.wireGauge ?? '#8 AWG',
            acConduitSize:   computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.conduitSize ?? '1" EMT',
            acBreaker:       calcData?.acSizing?.ocpdAmps ?? null,
            mainPanelBus:    config.panelBusRating ?? 200,
            backfeedBreaker: calcData?.interconnection?.backfeedAmps ?? calcData?.acSizing?.ocpdAmps ?? null,
            interconnection: config.interconnectionMethod ?? 'SUPPLY_SIDE_TAP',
          }
        : {};

      const payload = {
        projectId:           currentProjectId,
        clientId:            currentClientId,
        clientName:          config.clientName || config.projectName || 'Client',
        systemKw:            Number(totalKw),
        panelCount:          totalPanels,
        panelModel:          panelData ? `${panelData.manufacturer ?? ''} ${panelData.model ?? ''} ${panelData.watts ?? ''}W`.trim() : 'Generic 400W Monocrystalline',
        inverterType:        firstInv?.type ?? 'string',
        inverterModel:       invData ? `${invData.manufacturer ?? ''} ${invData.model ?? ''}`.trim() : 'TBD',
        annualProductionKwh: pvwattsData?.annualKwh ?? calcData?.summary?.annualProductionKwh ?? null,
        mountType:           config.systemType === 'ground' ? 'Ground Mount' : config.systemType === 'fence' ? 'Fence Mount' : 'Roof Mount',
        stateCode:           config.state ?? null,
        electrical:          elec,
        structural:          calcData?.structural ?? null,
        compliance: {
          necVersion:        calcData?.jurisdiction?.necVersion ?? 'NEC 2020',
          electricalStatus:  calcData?.electrical?.status ?? null,
          structuralStatus:  calcData?.structural?.status ?? null,
          rapidShutdown:     config.rapidShutdown ? 'Required — NEC 690.12' : 'Not Required',
        },
        bomItems:            bom,
        sldSvg:              sldSvg,
        permit: {
          ahj:               calcData?.jurisdiction?.ahj ?? null,
          utility:           config.utilityId ?? null,
          estimatedFee:      calcData?.jurisdiction?.estimatedPermitFee ?? null,
        },
        runs:                computedSystem.runs ?? [],
        // ── Reverse hydration fields ──────────────────────────────────────────
        address:             config.address ?? null,
        utilityId:           config.utilityId ?? null,
        conduitType:         config.conduitType ?? null,
        strings:             config.inverters.flatMap(inv => inv.strings.map(s => ({
          panelId:       s.panelId,
          panelCount:    s.panelCount,
          tilt:          s.tilt,
          azimuth:       s.azimuth,
          roofType:      s.roofType,
          mountingSystem:s.mountingSystem,
          wireGauge:     s.wireGauge,
          wireLength:    s.wireLength,
        }))),
        configSnapshot: {
          inverters:            config.inverters,
          mainPanelAmps:        config.mainPanelAmps,
          panelBusRating:       config.panelBusRating,
          interconnectionMethod:config.interconnectionMethod,
          rapidShutdown:        config.rapidShutdown,
          acDisconnect:         config.acDisconnect,
          dcDisconnect:         config.dcDisconnect,
          wireGauge:            config.wireGauge,
          wireLength:           config.wireLength,
          conduitType:          config.conduitType,
          systemType:           config.systemType,
          roofPitch:            config.roofPitch,
          state:                config.state,
          utilityId:            config.utilityId,
          mountingId:           config.mountingId,
        },
      };

      const res = await fetch('/api/engineering/save-outputs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        console.log('[Engineering] Saved', data.saved?.length, 'workspace files:', data.saved?.join(', '));
        // Track the newly created run ID so files show "Active config" badge
        if (data.engineeringRunId) {
          setRestoredRunId(data.engineeringRunId);
        }
        // Refresh files list if user is on the files tab (inline fetch to avoid forward-ref)
        if (activeTab === 'files' && currentProjectId) {
          fetch(`/api/project-files?projectId=${currentProjectId}`)
            .then(r => r.json())
            .then(d => { if (d.success) setProjectFiles(d.data || []); })
            .catch(() => {});
        }
      } else {
        console.warn('[Engineering] save-outputs failed:', data.error);
      }
    } catch (e: unknown) {
      console.warn('[Engineering] saveEngineeringOutputs error:', (e as Error).message);
    }
  }, [currentProjectId, currentClientId, config, totalKw, totalInverterKw, totalPanels, computedSystem, bom, sldSvg, activeTab, pvwattsData]);


  // Auto-recalculate 800ms after config changes

  const runCalc = useCallback(async () => {
    setCalculating(true);
    setCalcError(null);
    setConfigDirty(false);
    try {
      const payload = buildCalcPayload();

      // Get panel data for V2 structural calc
      const firstStrV2 = config.inverters[0]?.strings[0];
      const panelDataV2 = firstStrV2?.panelId ? (SOLAR_PANELS as any[]).find((p: any) => p.id === firstStrV2.panelId) : null;

      // Run legacy calculate + new rules engine + V2 structural in parallel
      const [calcRes, rulesRes, structV2Res] = await Promise.all([
        fetch('/api/engineering/calculate', {
          method: 'POST',
        cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch('/api/engineering/rules', {
          method: 'POST',
        cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            electrical: { ...payload.electrical, designTempMin: -10, designTempMax: 40, rooftopTempAdder: 30, necVersion: '2023',
              topologyType: payload.topologyType },  // v57.5 — topology guard for NEC 690.7 optimizer bypass in rules engine
            structural: payload.structural,
            engineeringMode,
            overrides,
          }),
        }),
        fetch('/api/engineering/structural-v2', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Site
            windSpeed:        config.windSpeed,
            windExposure:     config.windExposure,
            groundSnowLoad:   config.groundSnowLoad,
            roofPitch:        config.roofPitch,
            meanRoofHeight:   config.meanRoofHeight ?? 15,  // ft — ASCE 7 Kz (1-story≈15, 2-story≈25)
            // Framing
            framingType:      config.framingType,
            rafterSpacing:    config.rafterSpacing,
            rafterSpan:       config.rafterSpan,
            rafterSize:       config.rafterSize,
            rafterSpecies:    config.rafterSpecies,
            // Array geometry — derived from panel specs
            panelCount:       totalPanels,
            panelLength:      panelDataV2?.length ?? 73.0,
            panelWidth:       panelDataV2?.width  ?? 41.0,
            panelWeight:      panelDataV2?.weight ?? 45.0,
            panelOrientation: (config.panelOrientation ?? 'portrait') as 'portrait' | 'landscape',
            rowCount:         config.rowCount ?? undefined,
            // Racking
            mountingSystem:   config.systemType === 'roof' ? (config.mountingId ?? 'ironridge-xr100') : undefined,
            rackingWeight:    4.0,
          }),
        }).catch(() => null),  // V3 structural is best-effort
      ]);
      const calcData = await calcRes.json();
      if (calcData.success) {
        // Merge V3 structural results into compliance data
        try {
          if (structV2Res && structV2Res.ok) {
            const structV2Data = await structV2Res.json();
            // V3 API returns status directly (no .success wrapper)
            if (structV2Data?.status) {
              const ra = structV2Data.rafterAnalysis;
              const ml = structV2Data.mountLayout;
              const wind = structV2Data.wind;
              const snow = structV2Data.snow;
              calcData.structural = {
                // V3 fields
                status:          structV2Data.status,
                framing:         structV2Data.framing,
                arrayGeometry:   structV2Data.arrayGeometry,
                mountLayout:     ml,
                railAnalysis:    structV2Data.railAnalysis,
                rackingBOM:      structV2Data.rackingBOM,
                rafterAnalysis:  ra,
                wind:            {
                  velocityPressure:    wind?.velocityPressurePsf,
                  netUpliftPressure:   wind?.netUpliftPressurePsf,
                  upliftPerAttachment: ml?.upliftPerMountLbs,
                  designWindSpeed:     config.windSpeed,
                  exposureCategory:    config.windExposure,
                  Kz:                  wind?.exposureCoeff,
                  Kzt: 1.0, Kd: 0.85,
                  GCp:                 wind?.gcpUplift,
                  GCpi:                0.18,
                  tributaryArea:       ml?.tributaryAreaPerMountFt2,
                  totalAttachments:    ml?.mountCount,
                },
                snow:            {
                  groundSnowLoad:        snow?.groundSnowLoadPsf,
                  roofSnowLoad:          snow?.roofSnowLoadPsf,
                  snowLoadPerAttachment: ml?.downwardPerMountLbs,
                },
                // V1 compatibility shims
                rafter: {
                  rafterSize:             ra?.size,
                  rafterSpacing:          ra?.spacingIn,
                  rafterSpan:             ra?.spanFt,
                  bendingMoment:          ra?.bendingMomentDemandFtLbs,
                  allowableBendingMoment: ra?.bendingMomentCapacityFtLbs,
                  utilizationRatio:       ra?.overallUtilization,
                  deflection:             ra?.deflectionIn,
                  allowableDeflection:    ra?.allowableDeflectionIn,
                  Fb_base:                1150,
                  Cd: 1.15, Cr: 1.15,
                  Fb_prime:               1150 * 1.15 * 1.15,
                  totalLoadPsf:           ra?.totalLoadPsf,
                  lineLoad:               ra ? ra.totalLoadPsf * (ra.spacingIn / 12) : 0,
                },
                attachment: {
                  safetyFactor:             ml?.safetyFactor,
                  lagBoltCapacity:          ml?.mountCapacityLbs,
                  totalUpliftPerAttachment: ml?.upliftPerMountLbs,
                  upliftPerAttachment:      ml?.upliftPerMountLbs,
                  attachmentSpacing:        ml?.mountSpacingIn,
                  railSpacing:              structV2Data.arrayGeometry?.railSpacingIn,
                  tributaryArea:            ml?.tributaryAreaPerMountFt2,
                  maxAllowedSpacing:        ml?.mountSpacingIn,
                  spacingMarginPct:         100,
                },
                deadLoad: {
                  panelWeightPsf:        structV2Data.addedDeadLoadPsf,
                  rackingWeightPsf:      1.5,
                  totalDeadLoadPsf:      structV2Data.addedDeadLoadPsf,
                  deadLoadPerAttachment: ml?.downwardPerMountLbs,
                  existingRoofDeadLoad:  15,
                  totalRoofDeadLoad:     (structV2Data.addedDeadLoadPsf ?? 0) + 15,
                },
                errors:          structV2Data.errors,
                warnings:        structV2Data.warnings,
                recommendations: structV2Data.recommendations,
              };
              // Auto-update framing type if detected
              if (structV2Data.framing?.type && config.framingType === 'unknown') {
                updateConfig({ framingType: structV2Data.framing.type });
              }
            }
          }
        } catch (_) { /* V3 structural merge is best-effort */ }

        // v47.417 — Recompute overallStatus AFTER V3 structural merge.
        // Bug: /api/engineering/calculate computes overallStatus from the V1/V4
        // structural engine BEFORE the client replaces calcData.structural with
        // V3 results. V4 and V3 can disagree on what counts as an error (e.g.
        // V4 flags MOUNT_INSUFFICIENT_CAPACITY as error, V3 auto-reduces spacing
        // and demotes it to a MOUNT_SPACING_REDUCED warning). The result was
        // Overall=FAIL despite Electrical=PASS and Structural=WARNING, with no
        // errors visible in the compliance UI. Fix: after the V3 merge lands
        // on calcData.structural, recompute overallStatus from the final
        // electrical + structural status the user actually sees.
        try {
          const elecErrors = (calcData.electrical?.errors ?? []).filter((e: any) => !e.autoFixed && e.severity !== 'info');
          const structErrors = (calcData.structural?.errors ?? []).filter((e: any) => e?.severity === 'error');
          const elecStatus = calcData.electrical?.status ?? 'PASS';
          const structStatus = calcData.structural?.status ?? 'PASS';
          if (elecErrors.length > 0 || structErrors.length > 0) {
            calcData.overallStatus = 'FAIL';
          } else if (elecStatus === 'WARNING' || structStatus === 'WARNING') {
            calcData.overallStatus = 'WARNING';
          } else {
            calcData.overallStatus = 'PASS';
          }
        } catch (_) { /* defensive: keep server-computed overallStatus */ }

        setCompliance(calcData);
        // Inject NEC step-by-step calculation entries into decision log
        const ac = calcData?.acSizing;
        if (ac) {
          const sysV = calcData?.summary?.systemVoltage ?? 240;
          const totalAcKw = calcData?.summary?.totalAcKw ?? 0;
          logDecision('NEC Step 1', `Inverter Output: (${totalAcKw.toFixed(2)}kW × 1000) ÷ ${sysV}V = ${ac.acCurrentAmps}A`, 'info');
          logDecision('NEC Step 2', `Continuous Load (NEC 705.60): ${ac.acCurrentAmps}A × 1.25 = ${ac.continuousCurrentAmps}A`, 'info');
          logDecision('NEC Step 3', `OCPD (NEC 240.6): next standard ≥ ${ac.continuousCurrentAmps}A → ${ac.ocpdAmps}A breaker`, 'auto');
          logDecision('NEC Step 4', `AC Disconnect (NEC 690.14): rated ≥ OCPD → ${ac.disconnectLabel}`, 'auto');
          logDecision('NEC Step 5', `Fuse: ${ac.fuseLabel}`, ac.disconnectType === 'fused' ? 'auto' : 'info');
          logDecision('NEC Step 6', `Conductor (NEC 310.16 75°C): ampacity ≥ ${ac.ocpdAmps}A OCPD → ${ac.conductorLabel}`, 'auto');
          logDecision('NEC Step 7', `Conduit (NEC Ch.9): 3 CC + 1 EGC → ${ac.conduitLabel}`, 'auto');
          if (calcData?.interconnection) {
            const ic = calcData.interconnection;
            logDecision('Interconnection', `${ic.methodLabel}: ${ic.passes ? 'PASS' : 'FAIL'} — ${ic.message}`, ic.passes ? 'auto' : 'manual');
          }
        }
      } else {
        setCalcError(calcData.error || 'Calculation failed');
      }

      const rulesData = await rulesRes.json();
      if (rulesData.success) setRulesResult(rulesData.data);

      // ── Auto-save outputs to project_files after successful calc ──
      if (calcData.success && currentProjectId) {
        // Fire-and-forget via ref to avoid forward-reference TS error
        setTimeout(() => saveEngineeringOutputs(calcData), 500);
      }

    } catch (e: unknown) {
      setCalcError((e as Error).message);
    } finally {
      setCalculating(false);
    }
  }, [buildCalcPayload, engineeringMode, overrides, config, totalPanels, updateConfig]);


  useEffect(() => {
    setConfigDirty(true);
    const timer = setTimeout(() => {
      if (compliance.overallStatus !== null || rulesResult !== null) {
        runCalc();
      }
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, engineeringMode]);

  // Override management
  const addOverride = (ruleId: string, field: string, value: string, justification: string) => {
    const newOverride = {
      id: `ovr-${Date.now()}`,
      field,
      originalValue: '',
      overrideValue: value,
      justification,
      engineer: config.designer || 'Engineer',
      timestamp: new Date().toISOString(),
      ruleId,
    };
    setOverrides(prev => [...prev.filter(o => o.field !== field), newOverride]);
    setOverrideForm(null);
    // Re-run calc with new override
    setTimeout(() => runCalc(), 100);
  };

  const removeOverride = (field: string) => {
    setOverrides(prev => prev.filter(o => o.field !== field));
    setTimeout(() => runCalc(), 100);
  };

  // ── V4 SLD fetch (uses /api/engineering/sld — professional renderer) ──────────
  // ── Core SLD fetch helper — returns SVG string or null, no state side-effects ──
  const fetchSLDSvg = async (): Promise<string | null> => {
    try {
      const firstInv = config.inverters[0];
      const firstStr = firstInv?.strings[0];
      const invData = firstInv ? getInvById(firstInv.inverterId, firstInv.type) as any : null;
      const panelData = firstStr ? getPanelById(firstStr.panelId) as any : null;

      // Determine V4 topology type
      // v47.358: ecoflow → HYBRID_INVERTER (always has battery capability)
      const topoType = firstInv?.type === 'micro' ? 'MICROINVERTER'
        : firstInv?.type === 'optimizer' ? 'STRING_WITH_OPTIMIZER'
        : firstInv?.type === 'ecoflow' ? 'HYBRID_INVERTER'
        : config.batteryBrand ? 'HYBRID_INVERTER'
        : 'STRING_INVERTER';

      // Use ComputedSystem for all engineering values — single source of truth
      const sc = compliance.stringConfig;
      const designTempMin = cs.designTempMin;
      const acOutputKw = cs.totalAcKw || invData?.acOutputKw || (invData?.acOutputW / 1000) || 7.6;
      // Get wire gauges from ComputedSystem runs
      const csAcRun = cs.runs.find(r => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
      const csDcRun = cs.runs.find(r => r.id === (cs.isMicro ? 'ROOF_RUN' : 'DC_STRING_RUN'));
      // For micro: ALWAYS use cs.runs — never fall back to config.wireGauge (which is string-inverter only)
      const csAcWireGauge = csAcRun?.wireGauge
        || (cs.isMicro ? '#6 AWG' : ((compliance.electrical as any)?.acSizing?.conductorGauge || config.wireGauge));
      const csDcWireGauge = csDcRun?.wireGauge || firstStr?.wireGauge || '#10 AWG';
      const csConduitSize = csAcRun?.conduitSize || (compliance.electrical as any)?.acSizing?.conduitSize || '3/4"';
      const csAcOcpd = cs.acOcpdAmps || (compliance.electrical as any)?.backfeedBreaker || Math.ceil(acOutputKw * 1000 / 240 * 1.25 / 5) * 5;

      const res = await fetch('/api/engineering/sld', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName:    config.projectName,
          clientName:     config.clientName,
          address:        config.address,
          designer:       config.designer,
          drawingDate:    config.date,
          drawingNumber:  'SLD-001',
          revision:       'A',
          topologyType:   topoType,
          totalModules:   totalPanels,
          // Use ComputedSystem string count (NEC 690.7 auto-calculated)
          totalStrings:   cs.isString ? cs.stringCount : (sc?.totalStrings ?? config.inverters.reduce((s, inv) => s + inv.strings.length, 0)),
          // For micro topology: pass device count (number of microinverters)
          deviceCount:    firstInv?.type === 'micro'
            ? config.inverters.reduce((sum, inv) => {
                const invD = getInvById(inv.inverterId, inv.type) as any;
                const mpd = inv.deviceRatioOverride ?? invD?.modulesPerDevice ?? 1;
                const panels = inv.strings.reduce((s: number, str: any) => s + (str.panelCount || 0), 0);
                return sum + Math.ceil(panels / mpd);
              }, 0)
            : undefined,
          panelModel:     panelData ? `${panelData.manufacturer} ${panelData.model}` : 'Solar Panel',
          panelWatts:     panelData?.watts || 400,
          panelVoc:       panelData?.voc || 41.6,
          panelIsc:       panelData?.isc || 12.26,
          dcWireGauge:    csDcWireGauge,
          dcConduitType:  config.conduitType,
          // Use ComputedSystem OCPD per string
          dcOCPD:         cs.isString ? (cs.strings[0]?.ocpdAmps ?? sc?.ocpdPerString ?? 20) : 20,
          inverterModel:  invData ? `${invData.manufacturer} ${invData.model}` : 'String Inverter',
          inverterManufacturer: invData?.manufacturer || '',
          acOutputKw,
          inverterMaxDcV: invData?.maxDcVoltage || 600,
          // Inverter MPPT specs for string generation (used by SLD API's own string gen)
          maxDcVoltage:   invData?.maxDcVoltage || 600,
          mpptVoltageMin: invData?.mpptVoltageMin || 100,
          mpptVoltageMax: invData?.mpptVoltageMax || 600,
          mpptChannels:   invData?.mpptChannels || 2,
          maxInputCurrentPerMppt: invData?.maxInputCurrentPerMppt || invData?.maxInputCurrent,
          // Phase 13.4 — forward parallel-strings cap to the MPPT allocator.
          maxParallelStringsPerMppt: invData?.maxParallelStringsPerMppt,
          // Panel specs for string generation
          panelVmp:       panelData?.vmp || 41.8,
          panelImp:       panelData?.imp || 9.57,
          tempCoeffVoc:   panelData?.tempCoeffVoc || -0.27,
          tempCoeffVmp:   panelData?.tempCoeffVmp,
          maxSeriesFuse:  panelData?.maxSeriesFuseRating || 20,
          // Design temperature (from jurisdiction auto-detect)
          designTempMin,
          acWireGauge:    csAcWireGauge,
          acConduitType:  config.conduitType,
          acOCPD:         csAcOcpd,
          mainPanelAmps:  config.mainPanelAmps,
          mainPanelBrand: config.mainPanelBrand,
          utilityMeter:   config.utilityMeter,
          systemVoltage:  240,
          acDisconnect:   config.acDisconnect,
          dcDisconnect:   config.dcDisconnect,
          productionMeter: config.productionMeter,
          rapidShutdown:  config.rapidShutdown,
          batteryModel:   config.batteryBrand ? `${config.batteryBrand} ${config.batteryModel}` : undefined,
          batteryKwh:     config.batteryKwh * config.batteryCount || undefined,
          // Battery backfeed breaker (NEC 705.12(B)) — from equipment-db
          batteryBackfeedA: config.batteryId ? calcBatteryBackfeedAmps(config.batteryId, config.batteryCount) : undefined,
          // Generator fields
          generatorBrand: config.generatorId
            ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? undefined; })()
            : undefined,
          generatorModel: config.generatorId
            ? (() => { const g = getGeneratorById(config.generatorId); return g?.model ?? undefined; })()
            : undefined,
          generatorKw: config.generatorId
            ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? undefined; })()
            : undefined,
          // ATS fields
          atsBrand: config.atsId
            ? (() => { const a = getATSById(config.atsId); return a?.manufacturer ?? undefined; })()
            : undefined,
          atsModel: config.atsId
            ? (() => { const a = getATSById(config.atsId); return a?.model ?? undefined; })()
            : undefined,
          atsAmpRating: config.atsId
            ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? undefined; })()
            : undefined,
          // Backup interface (Enphase IQ SC3, Tesla Gateway, etc.)
          // If atsId is IQ SC3, resolve backupInterfaceId from BACKUP_INTERFACES
          // IQ SC3 in ATS_UNITS (id: enphase-iq-sc3-ats) maps to BACKUP_INTERFACES (id: enphase-iq-system-controller-3)
          ...(() => {
            const _atsId = config.atsId?.toLowerCase() ?? '';
            const _isIQSC3viaATS = _atsId.includes('enphase-iq-sc3') || _atsId.includes('enphase-iq-system-controller');
            const _resolvedBuiId = config.backupInterfaceId || (_isIQSC3viaATS ? 'enphase-iq-system-controller-3' : '');
            const _bi = _resolvedBuiId ? getBackupInterfaceById(_resolvedBuiId) : undefined;
            return {
              backupInterfaceId:    _resolvedBuiId || undefined,
              backupInterfaceBrand: _bi?.manufacturer ?? undefined,
              backupInterfaceModel: _bi?.model ?? undefined,
              backupInterfaceIsATS: _bi?.islandingCapable ?? false,
              hasBackupPanel:       !!_resolvedBuiId,
              backupPanelAmps:      100,
              backupPanelBrand:     _bi?.manufacturer ?? undefined,
            };
          })(),
          necVersion:     `NEC ${compliance.jurisdiction?.necVersion || '2023'}`,
          jurisdiction:   compliance.jurisdiction?.state || '',
          notes:          config.notes,
          format:         'svg',
          // Interconnection method — drives SLD rendering (load-side tap vs backfed breaker)
          interconnection: config.interconnectionMethod ?? 'LOAD_SIDE',
          panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200,
          // BUILD v24: Pass equipment IDs so route.ts can look up specs for NEC-sized segments
          // batteryId → getBatteryById → backfeedBreakerA, maxContinuousOutputA
          // generatorId → getGeneratorById → outputBreakerA (was hardcoded #6 AWG — wrong for 100A)
          // backupInterfaceId already sent above
          batteryId:      config.batteryId || undefined,
          generatorId:    config.generatorId || undefined,
          // Also send generatorOutputBreakerA directly as fallback
          generatorOutputBreakerA: config.generatorId
            ? (() => { const g = getGeneratorById(config.generatorId); return g?.outputBreakerA ?? undefined; })()
            : undefined,
          // Pass ComputedSystem.runs as single source of truth for conduit schedule
          runs:           cs.runs,
          // Microinverter branch data — for per-branch SLD drawing
          microBranches:     cs.isMicro ? cs.microBranches : undefined,
          branchWireGauge:   cs.isMicro ? cs.runs.find(r => r.id === 'BRANCH_RUN')?.wireGauge : undefined,
          branchConduitSize: cs.isMicro ? cs.runs.find(r => r.id === 'BRANCH_RUN')?.conduitSize : undefined,
          branchOcpdAmps:    cs.isMicro ? cs.runs.find(r => r.id === 'BRANCH_RUN')?.ocpdAmps : undefined,
          // AP Systems / manufacturer branch limits
          inverterModulesPerDevice: invData?.modulesPerDevice ?? 1,
          inverterBranchLimit:      invData?.branchLimit ?? 16,
          manufacturerMaxPerBranch20A: (invData as any)?.maxPerBranch20A ?? undefined,
          manufacturerMaxPerBranch30A: (invData as any)?.maxPerBranch30A ?? undefined,
          // String details for string topology
          stringDetails: cs.isString ? cs.strings?.map((s: any, i: number) => ({
            stringIndex: i,
            panelCount:  s.panelCount ?? cs.panelsPerString ?? 0,
            ocpdAmps:    s.ocpdAmps ?? cs.acOcpdAmps,
            wireGauge:   csDcWireGauge,
            voc:         s.voc ?? 0,
            isc:         s.isc ?? 0,
          })) : undefined,
        }),
      });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('svg') || ct.includes('xml')) {
          const svgText = await res.text();
          return svgText;
        } else {
          const data = await res.json();
          return (data.svg || data.data?.svg || null);
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        return null;
      }
      return null;
    } catch (e: unknown) {
      return null;
    }
  };

  // ── V4 SLD fetch (uses /api/engineering/sld — professional renderer) ──────────
  const fetchSLD = async () => {
    setSldLoading(true);
    setSldError(null);
    try {
      const svgResult = await fetchSLDSvg();
      if (svgResult) {
        setSldSvg(svgResult);
        logDecision('Generate SLD', `Professional SLD rendered`, 'auto');
      } else {
        setSldError('No SVG returned from SLD engine');
      }
    } catch (e: unknown) {
      setSldError((e as Error).message);
    } finally {
      setSldLoading(false);
    }
  };

  // ── V4 BOM fetch (uses /api/engineering/bom — registry-driven engine) ─────────
  // ── Client Files: fetch, upload, delete ────────────────────────────────────
  const fetchProjectFiles = useCallback(async () => {
    if (!currentProjectId) return;
    setFilesLoading(true);
    setFilesError(null);
    try {
      const res = await fetch(`/api/project-files?projectId=${currentProjectId}`);
      const data = await res.json();
      if (data.success) {
        setProjectFiles(data.data || []);
      } else {
        setFilesError(data.error || 'Failed to load files');
      }
    } catch (err: unknown) {
      setFilesError((err as Error).message || 'Failed to load files');
    } finally {
      setFilesLoading(false);
    }
  }, [currentProjectId]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!currentProjectId) return;
    setFileUploading(true);
    setFileUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', currentProjectId);
      const res = await fetch('/api/project-files', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        await fetchProjectFiles();
      } else {
        setFileUploadError(data.error || 'Upload failed');
      }
    } catch (err: unknown) {
      setFileUploadError((err as Error).message || 'Upload failed');
    } finally {
      setFileUploading(false);
    }
  }, [currentProjectId, fetchProjectFiles]);

  const handleFileDelete = useCallback(async (fileId: string) => {
    if (!confirm('Delete this file?')) return;
    try {
      const res = await fetch(`/api/project-files?id=${fileId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setProjectFiles(prev => prev.filter(f => f.id !== fileId));
      }
    } catch { /* ignore */ }
  }, []);

  // Load files when switching to files tab
  useEffect(() => {
    if (activeTab === 'files' && currentProjectId) {
      fetchProjectFiles();
    }
  }, [activeTab, currentProjectId, fetchProjectFiles]);

  // v47.56: Run full project pipeline
  const runPipeline = useCallback(async () => {
    if (!currentProjectId) return;
    setPipelineRunning(true);
    setPipelineError(null);
    setPipelineResult(null);
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProjectId }),
      });
      const data = await res.json();
      setPipelineResult(data);
      // Refresh files list after pipeline run
      if (currentProjectId) {
        fetch(`/api/project-files?projectId=${currentProjectId}`)
          .then(r => r.json())
          .then(d => { if (d.success) setProjectFiles(d.data || []); })
          .catch(() => {});
      }
    } catch (e: unknown) {
      setPipelineError((e as Error).message || 'Pipeline run failed');
    } finally {
      setPipelineRunning(false);
    }
  }, [currentProjectId]);

  const fetchBOM = useCallback(async () => {
    setBomLoading(true);
    setBomError(null);
    try {
      const firstInv = config.inverters[0];
      const firstStr = firstInv?.strings[0];

      // Determine V4 topology type
      // v47.358: ecoflow → HYBRID_INVERTER
      const topoType = firstInv?.type === 'micro' ? 'MICROINVERTER'
        : firstInv?.type === 'optimizer' ? 'STRING_WITH_OPTIMIZER'
        : firstInv?.type === 'ecoflow' ? 'HYBRID_INVERTER'
        : config.batteryBrand ? 'HYBRID_INVERTER'
        : 'STRING_INVERTER';

      // ISSUE 1 FIX: compute deviceCount from ALL micro inverters (not just firstInv)
      // deviceCount = sum of ceil(panelCount_i / modulesPerDevice_i) across all micro inverters
      // Single source of truth: modulesPerDevice = userOverride ?? registry ?? 1
      let bomDeviceCount: number | undefined;
      if (firstInv?.type === 'micro') {
        bomDeviceCount = config.inverters
          .filter(inv => inv.type === 'micro')
          .reduce((total, inv) => {
            const invData = getInvById(inv.inverterId, 'micro') as any;
            const registryMpd: number = invData?.modulesPerDevice ?? 1;
            const effectiveMpd: number = inv.deviceRatioOverride ?? registryMpd;
            const panelCount = inv.strings.reduce((s: number, str: any) => s + str.panelCount, 0);
            return total + Math.ceil(panelCount / effectiveMpd);
          }, 0);
      }

      // Map config.mountingId to a V4 racking ID (auto-includes all mounting-hardware-db IDs)
      const rackingIdMap: Record<string, string> = {
        // mounting-hardware-db IDs pass through as-is (equipment-registry-v4 now uses same IDs)
        ...Object.fromEntries(ALL_MOUNTING_SYSTEMS.map(s => [s.id, s.id])),
        // Legacy stale IDs in old project configs -> canonical IDs (override spread above)
        'rooftech-rt-mini':    'rooftech-mini',
        'unirac-sunframe':     'unirac-solarmount',
        'unirac-rm-ballast':   'unirac-rm10-evo',
        'snapnrack-series-100': 'snapnrack-100',
        'quickmount-tile-hook': 'quickmount-tile',
        's5-pvkit-2':          's5-pvkit',
        'ecofasten-rock-it':   'ecofasten-rockit',
        'plp-power-peak':      'ironridge-xr100',
      };
      // Only send rackingId for roof systems — fence/ground don't use roof racking
      const isRoofSystem = config.systemType === 'roof';
      const rackingId = isRoofSystem
        ? (rackingIdMap[config.mountingId] || config.mountingId || 'ironridge-xr100')
        : undefined;

        // FIX: csAcOcpd was only defined in the SLD callback - define it here too
        // Derive AC OCPD: prefer ComputedSystem runs → compliance acSizing → formula fallback
        const csAcOcpdBom: number = (() => {
          const acRun = cs.runs?.find((r: any) => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
          if (acRun?.ocpdAmps) return acRun.ocpdAmps;
          const compOcpd = (compliance.electrical as any)?.acSizing?.ocpd
            || (compliance.electrical as any)?.acSizing?.ocpdAmps;
          if (compOcpd) return compOcpd;
          // Formula fallback: total AC kW -> continuous current -> OCPD
          const acKw = cs.totalAcKw || parseFloat(totalInverterKw) || parseFloat(totalKw) || 8;
          return Math.ceil(acKw * 1000 / 240 * 1.25 / 5) * 5;
        })();

      const _bomPayload = {
          // REGRESSION FIX: for micro topology, ensure we send a valid micro inverterId
          // firstInv.inverterId may be stale (e.g. 'se-7600h') if topology switch didn't update it
          inverterId: firstInv?.type === 'micro'
            ? (MICROINVERTERS.find(m => m.id === firstInv.inverterId)?.id ?? MICROINVERTERS[0]?.id ?? 'enphase-iq8plus')
            : (firstInv?.inverterId || 'fronius-primo-8.2'),
            // v58.6: Use optimizerPeripheralId (e.g. 'se-p505') for BOM Stage 1 optimizer line.
            // inverterId now holds the central string inverter (e.g. 'se-11400h') for sizing/brand.
            // Fallback to firstInv.inverterId only if optimizerPeripheralId is not set (legacy configs).
            optimizerId:      firstInv?.type === 'optimizer'
              ? ((firstInv as any).optimizerPeripheralId || firstInv.inverterId)
              : undefined,
          rackingId,
          batteryId:        config.batteryId || undefined,
          // NON-DESTRUCTIVE DEFAULT + FENCE SAFETY NET:
          //   1. If user set a real panel, use it (non-destructive).
          //   2. If panel is a known hardcoded default (qcells-peak-duo-400) AND system is fence,
          //      treat it as "no real selection" and use the fence default.
          //   3. Otherwise fall back to system-type default.
          // MASTER TASK: BOM never overrides REAL user selections, only corrects stale defaults.
          panelId:          (firstStr?.panelId && !(config.systemType === 'fence' && HARDCODED_DEFAULT_PANELS.has(firstStr.panelId)))
                              ? firstStr.panelId
                              : defaultPanelForSystemType(config.systemType),
          // v58.5 FIX: Use authoritative systemPanelCount (CAD/SystemDefinition/config fallback)
          // rather than totalPanels (config-derived sum only). When CAD has placed 36 panels
          // but config strings are stale, totalPanels may differ. systemPanelCount is the
          // single source of truth shared by the sizing engine, compliance engine, and BOM.
          moduleCount:      systemPanelCount > 0 ? systemPanelCount : totalPanels,
          deviceCount:      bomDeviceCount,   // micro qty = deviceCount not moduleCount
          stringCount:      firstInv?.type === 'micro' ? 0 : (sizingRecommendation?.strings?.length ?? config.inverters.reduce((s, inv) => s + inv.strings.length, 0)),
          // v58.3 FIX: Compute inverterCount from sizingRecommendation when available.
          // When sizingRecommendation is null (e.g. CAD not yet loaded, systemPanelCount=0),
          // DO NOT fall back to config.inverters.length: for optimizer/string topology
          // config.inverters.length == string count (1 entry per string), NOT inverter count.
          // This causes qty=36 for a 36-panel 1-inverter SE11400H system.
          // Safe fallback: detect stale config by comparing raw count vs physical max.
          inverterCount:    (() => {
            if (firstInv?.type === 'micro') return 1;
            // Primary source: sizing engine (always prefer this)
            if (sizingRecommendation?.inverterCount) return sizingRecommendation.inverterCount;
            // Fallback: detect stale string-count-as-inverter-count
            const _rawCount = config.inverters.length;
            // v58.5: use systemPanelCount (authoritative) if available, else totalPanels
            const _modules = (systemPanelCount > 0 ? systemPanelCount : totalPanels) || 1;
            // For optimizer: SolarEdge maxPPS=25, physical max units = ceil(modules/25)
            // For string: conservative max = ceil(modules/8) (8 panels minimum per string)
            const _isOpt = firstInv?.type === 'optimizer';
            const _physMax = _isOpt
              ? Math.max(1, Math.ceil(_modules / 25))
              : Math.max(1, Math.ceil(_modules / 8));
            // If raw count exceeds physical max, it's a stale string count -- use 1
            if (_rawCount > _physMax) return 1;
            return _rawCount;
          })(),
          systemKw:         parseFloat(totalKw),
          dcWireGauge:      (() => {
            const dcRun = cs.runs.find(r => r.id === (cs.isMicro ? 'ROOF_RUN' : 'DC_STRING_RUN'));
            return dcRun?.wireGauge || firstStr?.wireGauge || '#10 AWG';
          })(),
          // Use ComputedSystem wire gauges — single source of truth
          // For micro: ALWAYS use cs.runs — never fall back to config.wireGauge
          acWireGauge:      (() => {
            const acRun = cs.runs.find(r => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
            return acRun?.wireGauge
              || (cs.isMicro ? '#6 AWG' : ((compliance.electrical as any)?.acSizing?.conductorGauge || config.wireGauge));
          })(),
          dcWireLength:     firstStr?.wireLength || cs.runs.find(r => r.id === 'DC_STRING_RUN')?.onewayLengthFt || 50,
          acWireLength:     config.wireLength || cs.runs.find(r => r.id === 'DISCO_TO_METER_RUN')?.onewayLengthFt || 50,
          conduitType:      config.conduitType,
          // Use ComputedSystem conduit size
          conduitSizeInch:  (() => {
            const acRun = cs.runs.find(r => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
            return (acRun?.conduitSize || (compliance.electrical as any)?.acSizing?.conduitSize || '3/4"').replace('"','');
          })(),
          roofType:         isRoofSystem ? config.roofType : 'none',
          // FIX: Use actual structural engine results for mount/rail counts (was hardcoded estimation)
          // Falls back to panel-count estimation only if structural hasn't run yet
          attachmentCount:  isRoofSystem
            ? (compliance.structural?.mountLayout?.mountCount ?? Math.ceil(totalPanels / 2))
            : 0,
          railSections:     isRoofSystem
            ? (compliance.structural?.arrayGeometry?.railCount ?? compliance.structural?.railAnalysis?.railCount ?? Math.ceil(totalPanels / 4))
            : 0,
          // FIX: Pass acOCPD so BOM disconnect uses correct 60A rating (not the 40A API default fallback)
          acOCPD:           csAcOcpdBom,
          backfeedAmps:     csAcOcpdBom,
          mainPanelAmps:    config.mainPanelAmps,
          acDisconnect:     config.acDisconnect,
          // DC Disconnect: never for microinverter systems
          dcDisconnect:     firstInv?.type === 'micro' ? false : config.dcDisconnect,
          productionMeter:  config.productionMeter,
          rapidShutdown:    config.rapidShutdown,
          batteryCount:     config.batteryCount,
          topologyType:     topoType,
          jurisdiction:     compliance.jurisdiction?.state || '',
          // Phase 3 - Layout fields
          rowCount:         config.rowCount,
          columnCount:      config.columnCount,
          layoutOrientation: config.layoutOrientation,
          // Interconnection method — controls whether backfed breaker appears in BOM
          interconnectionMethod: config.interconnectionMethod ?? 'LOAD_SIDE',
          panelBusRating:   config.panelBusRating ?? config.mainPanelAmps ?? 200,
          // Pass ComputedSystem.runs as single source of truth for wire/conduit quantities
          runs:             cs.runs,
          // Pass ComputedSystem.bomQuantities for EXACT match with summary card quantities
          bomQuantities:    cs.bomQuantities,
          // Generator / ATS / BUI — for BOM line items
          generatorId:      config.generatorId || undefined,
          atsId:            config.atsId || undefined,
          backupInterfaceId: config.backupInterfaceId || undefined,
          generatorKw:      config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? undefined; })() : undefined,
          atsAmpRating:     config.atsId ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? undefined; })() : undefined,
          backupInterfaceMaxA: config.backupInterfaceId ? (() => { const b = getBackupInterfaceById(config.backupInterfaceId); return b?.maxContinuousOutputA ?? undefined; })() : undefined,
          format:           'json',

          // ── System-type structural supplement (fence/ground BOM) ──────────
          systemType:       config.systemType,

          // Fence structural data — ESTIMATED from fenceCAD.ts defaults + panel count
          // MASTER TASK NOTE: This is best-effort estimation. When CAD geometry is
          // available server-side, use extractStructuralInputFromCAD() instead.
          // derivedFrom: 'estimated-ui-defaults' (not CAD geometry)
          fenceData: config.systemType === 'fence' ? (() => {
            // fenceCAD.ts defaults: 8ft post spacing, 3ft embed, 2 rails
            const panelWidthFt = 3.28;    // ~1m panel width (fenceCAD DEFAULT_PANEL_WIDTH_FT)
            const panelHeightFt = 5.5;    // ~1.676m panel height
            const postSpacingFt = 8;      // DEFAULT_POST_SPACING_FT from fenceCAD.ts
            const postEmbedFt = 3;        // DEFAULT_POST_EMBED_FT from fenceCAD.ts
            const railCount = 2;          // DEFAULT_RAIL_COUNT from fenceCAD.ts
            // Estimate fence length from panel count: each panel ~3.28ft wide
            const totalFenceLengthFt = totalPanels * panelWidthFt;
            // Posts: ceil(length / spacing) + 1 per segment (assume 1 segment for simple calc)
            const totalPosts = Math.ceil(totalFenceLengthFt / postSpacingFt) + 1;
            // Fence segments from projectLayout if available
            const fenceSegments = (projectLayout?.fenceLine?.length ?? 0) > 1
              ? projectLayout.fenceLine.length - 1 : 1;
            return {
              totalPosts,
              postSpacingFt,
              postEmbedFt,
              postHeightFt: panelHeightFt + 1,  // panel + clearance above grade
              railCount,
              totalFenceLengthFt,
              segmentCount: fenceSegments,
              gateCount: 0,                     // gate data from CAD if available
              gateWidthsFt: [] as number[],
              solarSectionCount: totalPanels,
              vinylSectionCount: 0,
              panelWidthFt,
              panelHeightFt,
            };
          })() : undefined,

          // Ground structural data — from compliance.structural + selectedSystem
          // MASTER TASK NOTE: Reads compliance.structural when available (best source),
          // falls back to mounting system defaults. When CAD geometry is available
          // server-side, use extractStructuralInputFromCAD() instead.
          // derivedFrom: 'compliance-structural + mounting-system-defaults'
          groundData: config.systemType === 'ground' ? (() => {
            const gma = (compliance.structural as any)?.groundMountAnalysis;
            const mountSys = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
            const gm = mountSys?.groundMount as any;
            const pileSpacingFt = gma?.pileSpacingFt ?? gm?.pileSpacingFt ?? 10;
            const pileEmbedFt = gma?.pileEmbedmentFt ?? gm?.pileEmbedmentFt ?? 4;
            const rowCount = config.rowCount ?? 1;
            const panelsPerRow = Math.ceil(totalPanels / rowCount);
            const panelWidthIn = 41.7;  // default panel width in inches
            const arrayWidthFt = (panelsPerRow * panelWidthIn) / 12;
            const pilesPerRow = Math.ceil(arrayWidthFt / pileSpacingFt) + 1;
            return {
              pileCount: gma?.pileCount ?? pilesPerRow * 2,
              pileSpacingFt,
              pileEmbedmentFt: pileEmbedFt,
              structureType: gm?.pileType ?? 'driven_pile',
              rowCount,
              panelsPerRow,
              arrayWidthFt,
              railsPerRow: 2,           // standard from array-geometry.ts
              groundClearanceFt: 2,     // 0.6096m default from CAD types
            };
          })() : undefined,

          // ── EcoFlow system fields (v47.358) ─────────────────────────
          // These fields only take effect if inverterId starts with 'ecoflow-'.
          // Route handler uses them to derive battery modules + accessories.
          batteryEnabled:   batteryEnabled && Boolean((config.batteryId && config.batteryId.length > 0) || config.batteryKwh),
          targetBatteryKwh: (config.batteryKwh && config.batteryKwh > 0) ? Number(config.batteryKwh) : undefined,
          batteryUsePro:    false,  // Pro stack (80 kWh) — future UI toggle
      };
      console.log('[FRONTEND BOM PAYLOAD]', { systemType: config.systemType, isRoofSystem, ..._bomPayload });
      const res = await fetch('/api/engineering/bom', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_bomPayload),
      });
      const data = await res.json();
      if (data.success) {
        // PHASE 2 FIX: V4 BOM API returns { success, bom: { stages, items } }
        // data.bom.stages is the correct path (not data.data.stages)
        const bomResult = data.bom || data.data || {};
        const stages = bomResult.stages || [];
        const items = stages.flatMap((stage: any) =>
          (stage.items || []).map((item: any) => ({
            ...item,
            category: stage.stageId || item.category || 'general',
          }))
        );
        setBom(items.length > 0 ? items : (bomResult.items || []));
        setBomStages(stages);
        setBomPricing(data.pricing ?? null);
        logDecision('Generate BOM', `${items.length} line items across ${stages.length} stages${data.pricing?.totalBomCost ? ' · $' + data.pricing.totalBomCost.toLocaleString('en-US', {maximumFractionDigits:0}) + ' est. hardware cost' : ''}`, 'auto');

        // ── Auto-populate Enphase ecosystem from BOM result ──
        const firstInvBom = config.inverters[0];
        if (firstInvBom?.type === 'micro') {
          try {
            const invDataBom = getInvById(firstInvBom.inverterId, 'micro') as any;
            const registryMpdBom: number = invDataBom?.modulesPerDevice ?? 1;
            const mpdBom: number = firstInvBom.deviceRatioOverride ?? registryMpdBom;
            const panelCountBom = config.inverters.reduce((s, inv) => s + inv.strings.reduce((s2, str) => s2 + str.panelCount, 0), 0);
            const deviceCountBom = Math.ceil(panelCountBom / mpdBom);

            const enphaseRes = await fetch('/api/engineering/enphase', {
              method: 'POST',
        cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inverterId: firstInvBom.inverterId,
                deviceCount: deviceCountBom,
                moduleCount: panelCountBom,
                includeGateway: true,
                includeCombiner: true,
                includeRSD: true,
                includeACDisconnect: true,
              }),
            });
            if (enphaseRes.ok) {
              const enphaseData = await enphaseRes.json();
              if (enphaseData.success && enphaseData.accessories?.length > 0) {
                const enphaseComponents = enphaseData.accessories
                  .filter((a: any) => a.quantity > 0)
                  .map((a: any) => ({
                    manufacturer: a.manufacturer,
                    model: a.model,
                    partNumber: a.partNumber,
                    quantity: a.quantity,
                    reason: a.notes || a.description,
                  }));
                setEcosystemComponents(enphaseComponents);
                logDecision('Enphase API', `${enphaseComponents.length} accessories — AC: ${enphaseData.systemSummary?.totalAcOutputKw}kW`, 'auto');
              }
            }
          } catch (_) { /* best-effort */ }
        }
      } else {
        setBomError(data.error || 'BOM generation failed');
      }
    } catch (e: unknown) {
      setBomError((e as Error).message);
    } finally {
      setBomLoading(false);
    }
  }, [config, totalPanels, totalKw, compliance, sizingRecommendation]);

  // ── PVWatts production estimate ──────────────────────────────
  const fetchPVWatts = useCallback(async () => {
    if (!config.address && !(config as any).lat) return;
    setPvwattsData(prev => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch('/api/engineering/pvwatts', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemCapacityKw: parseFloat(totalKw) || 8.0,
          address: config.address || undefined,
          lat: (config as any).lat || undefined,
          lon: (config as any).lon || undefined,
          moduleType: 1,   // Premium
          arrayType: 1,    // Fixed roof mount
          tilt: config.roofPitch ? Math.round(Math.atan(config.roofPitch / 12) * 180 / Math.PI) : 20,
          azimuth: 180,    // South-facing default
          losses: 14.08,
          timeframe: 'monthly',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setPvwattsData({
            annualKwh: data.annualProduction,
            monthlyKwh: data.monthlyProduction,
            capacityFactor: data.capacityFactor,
            stationCity: data.stationInfo?.city,
            stationState: data.stationInfo?.state,
            loading: false,
          });
        } else {
          setPvwattsData({ error: data.error || 'PVWatts unavailable', loading: false });
        }
      }
    } catch (_) {
      setPvwattsData({ error: 'PVWatts API unavailable', loading: false });
    }
  }, [config.address, totalKw, config.roofPitch]);

  useEffect(() => {
    if (calcDebounceRef.current) clearTimeout(calcDebounceRef.current);
    calcDebounceRef.current = setTimeout(() => {
      if (config.inverters.length > 0) runCalc();
    }, 1500);
    return () => { if (calcDebounceRef.current) clearTimeout(calcDebounceRef.current); };
  }, [config]);

  // Auto-refresh SLD whenever compliance data updates AND an SLD was already generated
  // This ensures string config changes flow through to the diagram automatically
  const sldAutoRefDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!sldSvg) return; // Only auto-refresh if SLD was already generated once
    if (sldAutoRefDebounce.current) clearTimeout(sldAutoRefDebounce.current);
    sldAutoRefDebounce.current = setTimeout(() => {
      fetchSLD();
    }, 1200);
    return () => { if (sldAutoRefDebounce.current) clearTimeout(sldAutoRefDebounce.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compliance]);

  const handlePrint = () => window.print();

  // ── Sync selectedMountingId with config.mountingId when config changes ──────────
  useEffect(() => {
    if (config.mountingId && config.mountingId !== selectedMountingId) {
      setSelectedMountingId(config.mountingId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.mountingId]);

  // ── DB load verification (console log on mount) ──────────────────────────────────
  useEffect(() => {
    const systems = getAllMountingSystems();
    console.log('[MountingDB] Startup: mounting-hardware-db loaded with', systems.length, 'systems');
    console.log('[MountingDB] Available system IDs:', systems.map(s => s.id).join(', '));
  }, []);

  // ── Intelligence Panel helpers ────────────────────────────────────────────
  const logDecision = (action: string, detail: string, type: 'auto' | 'manual' | 'info' = 'info') => {
    setDecisionLog(prev => [
      { ts: new Date().toLocaleTimeString(), action, detail, type },
      ...prev.slice(0, 49),
    ]);
  };

  // ── V4 Auto-Fill: calls topology API to resolve accessories + smart defaults ──
  const handleAutoFill = async () => {
    const firstInv = config.inverters[0];
    const firstStr = firstInv?.strings[0];
    const invData = firstInv ? getInvById(firstInv.inverterId, firstInv.type) as any : null;
    const patches: Partial<ProjectConfig> = {};
    let filled = 0;

    // Smart defaults
    if (!config.projectName || config.projectName === 'Solar Installation') {
      patches.projectName = `${invData?.manufacturer || 'Solar'} ${(totalWatts / 1000).toFixed(1)}kW System`;
      filled++;
    }
    if (!config.designer) { patches.designer = 'SolarPro Engineer'; filled++; }
    if (!config.date) { patches.date = new Date().toISOString().split('T')[0]; filled++; }
    // NOTE: Do NOT patch wireGauge for micro systems — wire gauge comes from
    // ComputedSystem.runs (cs.runs), not config.wireGauge.
    // For string inverters only, upgrade if system is large:
    if (firstInv?.type !== 'micro' && config.wireGauge === '#10 AWG THWN-2' && parseFloat(totalKw) > 7.5) {
      patches.wireGauge = '#8 AWG THWN-2'; filled++;
    }

    // Call V4 topology API to resolve ecosystem
    try {
      const topoRes = await fetch('/api/engineering/topology', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inverterId:    firstInv?.inverterId,
          rackingId:     config.mountingId,
          moduleCount:   totalPanels,
          stringCount:   config.inverters.reduce((s, inv) => s + inv.strings.length, 0),
          // v58.3: safe inverterCount -- don't send string count as inverter count
          inverterCount: (() => {
            const _inv0 = config.inverters[0];
            if (_inv0?.type === 'micro') return 1;
            if (sizingRecommendation?.inverterCount) return sizingRecommendation.inverterCount;
            const _raw = config.inverters.length;
            const _mods = totalPanels || 1;
            const _physMax = _inv0?.type === 'optimizer'
              ? Math.max(1, Math.ceil(_mods / 25))
              : Math.max(1, Math.ceil(_mods / 8));
            return _raw > _physMax ? 1 : _raw;
          })(),
          roofType:      config.roofType,
          systemType:    config.systemType,
        }),
      });
      if (topoRes.ok) {
        const topoData = await topoRes.json();
        if (topoData.success && topoData.resolvedAccessories?.length > 0) {
          setEcosystemComponents(topoData.resolvedAccessories.map((a: any) => ({
            manufacturer: a.manufacturer || 'Enphase',
            model: a.model || a.label || a.category,
            partNumber: a.partNumber || '',
            quantity: a.quantity || 1,
            reason: a.label || `Required by ${topoData.topologyLabel} topology`,
          })));
          logDecision('Auto Fill', `Topology resolved: ${topoData.topologyLabel} — ${topoData.resolvedAccessories.length} accessories`, 'auto');
        }
      }
    } catch (_) { /* topology fill is best-effort */ }

    // ── Enphase API: resolve real accessories for micro topology ──
    if (firstInv?.type === 'micro') {
      try {
        const invDataMicro = getInvById(firstInv.inverterId, 'micro') as any;
        const registryMpdFill: number = invDataMicro?.modulesPerDevice ?? 1;
        const mpdFill: number = firstInv.deviceRatioOverride ?? registryMpdFill;
        const panelCountFill = config.inverters.reduce((s, inv) => s + inv.strings.reduce((s2, str) => s2 + str.panelCount, 0), 0);
        const deviceCountFill = Math.ceil(panelCountFill / mpdFill);

        const enphaseRes = await fetch('/api/engineering/enphase', {
          method: 'POST',
        cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inverterId: firstInv.inverterId,
            deviceCount: deviceCountFill,
            moduleCount: panelCountFill,
            includeGateway: true,
            includeCombiner: true,
            includeRSD: true,
            includeACDisconnect: true,
          }),
        });
        if (enphaseRes.ok) {
          const enphaseData = await enphaseRes.json();
          if (enphaseData.success && enphaseData.accessories?.length > 0) {
            const enphaseComponents = enphaseData.accessories
              .filter((a: any) => a.quantity > 0)
              .map((a: any) => ({
                manufacturer: a.manufacturer,
                model: a.model,
                partNumber: a.partNumber,
                quantity: a.quantity,
                reason: a.notes || a.description,
              }));
            setEcosystemComponents(enphaseComponents);
            logDecision('Enphase API', `Resolved ${enphaseComponents.length} accessories for ${enphaseData.inverterModel} x${deviceCountFill} — AC: ${enphaseData.systemSummary?.totalAcOutputKw}kW`, 'auto');
          }
        }
      } catch (_) { /* Enphase API is best-effort */ }
    }

    if (Object.keys(patches).length > 0) updateConfig(patches);
    logDecision('Auto Fill', `Filled ${filled} field(s) with smart defaults`, 'auto');
  };

  // ── V4 Auto-Fix All: structural API + feasibility-driven electrical fix ───────
  // Phase 13.7: electrical string fix now driven by applyFeasibleFix() instead
  // of the old heuristic. If no valid configuration exists, we surface a
  // "no solution" state instead of silently applying a bad config.
  const [fixNoSolution, setFixNoSolution] = useState<string | null>(null);

  const handleAutoFixAll = async () => {
    setFixNoSolution(null);

    if (!compliance.electrical && !compliance.structural) {
      await runCalc();
    }

    // Call V2 structural API with truss/rafter distinction
    try {
      const structRes = await fetch('/api/engineering/structural-v2', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          windSpeed:         config.windSpeed,
          windExposure:      config.windExposure,
          groundSnowLoad:    config.groundSnowLoad,
          roofType:          config.roofType,
          roofPitch:         config.roofPitch,
          rafterSpacing:     config.rafterSpacing,
          rafterSpan:        config.rafterSpan,
          rafterSize:        config.rafterSize,
          rafterSpecies:     config.rafterSpecies,
          framingType:       config.framingType,
          panelCount:        totalPanels,
          mountingId:        config.mountingId,
          systemType:        config.systemType,
        }),
      });
      if (structRes.ok) {
        const structData = await structRes.json();
        if (structData.success) {
          // Update framing type if auto-detected
          if (structData.framing?.type && config.framingType === 'unknown') {
            updateConfig({ framingType: structData.framing.type });
          }
          // Log mount spacing recommendation
          if (structData.mountLayout?.mountSpacing) {
            logDecision('Structural V2',
              `${structData.framing?.type ?? config.framingType} — ` +
              `mount spacing: ${structData.mountLayout.mountSpacing}", ` +
              `${structData.mountLayout.mountCount} mounts, ` +
              `SF=${structData.summary?.safetyFactor?.toFixed(2)} ` +
              `${structData.status === 'PASS' ? '✓' : '⚠'}`,
              structData.status === 'PASS' ? 'info' : 'auto'
            );
          }
          if (structData.status === 'FAIL') {
            // V2 calculates optimal spacing automatically — no need to reduce
            logDecision('Auto Fix', `Structural FAIL — check recommendations: ${structData.recommendations?.join('; ')}`, 'auto');
          }
        }
      }
    } catch (_) { /* structural fix is best-effort */ }

    // ── IronRidge API: structural calculations for IronRidge racking ──
    if (config.mountingId?.includes('ironridge')) {
      try {
        const firstStr = config.inverters[0]?.strings[0];
        const panelData = firstStr?.panelId ? (SOLAR_PANELS as any[]).find((p: any) => p.id === firstStr.panelId) : null;
        const ironridgeRes = await fetch('/api/engineering/ironridge', {
          method: 'POST',
        cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rackingId:       config.mountingId,
            moduleCount:     totalPanels,
            moduleWidthIn:   panelData?.width ?? 40.0,
            moduleLengthIn:  panelData?.length ?? 66.0,
            moduleWeightLbs: panelData?.weight ?? 42.0,
            rafterSpacingIn: config.rafterSpacing ?? 24,
            windPressurePsf: config.windSpeed ? Math.round(0.00256 * config.windSpeed * config.windSpeed * 0.85) : 20,
            snowLoadPsf:     config.groundSnowLoad ?? 20,
            loadZone:        (config.windSpeed ?? 0) > 130 ? 'highWind' : (config.groundSnowLoad ?? 0) > 40 ? 'highSnow' : 'residential',
          }),
        });
        if (ironridgeRes.ok) {
          const ironridgeData = await ironridgeRes.json();
          if (ironridgeData.success) {
            logDecision('IronRidge API',
              `${ironridgeData.railModel} — span: ${ironridgeData.recommendedSpanIn}", ` +
              `${ironridgeData.totalAttachments} attachments, SF=${ironridgeData.safetyFactorAchieved} ` +
              `${ironridgeData.passesUplift ? '✓' : '⚠ FAIL'}`,
              ironridgeData.passesUplift ? 'info' : 'auto'
            );
            if (!ironridgeData.passesUplift) {
              updateConfig({ attachmentSpacing: Math.min(config.attachmentSpacing ?? 48, ironridgeData.recommendedSpanIn - 6) });
            }
          }
        }
      } catch (_) { /* IronRidge API is best-effort */ }
    }

    // Upgrade wire if voltage drop high — string inverter only
    // For micro systems, wire gauge is auto-sized by ComputedSystem.runs
    if (!cs.isMicro && (compliance.electrical as any)?.acVoltageDrop > 3) {
      const gauges = ['#10 AWG THWN-2', '#8 AWG THWN-2', '#6 AWG THWN-2', '#4 AWG THWN-2'];
      const idx = gauges.indexOf(config.wireGauge);
      if (idx >= 0 && idx < gauges.length - 1) {
        updateConfig({ wireGauge: gauges[idx + 1] });
        logDecision('Auto Fix', `Upgraded AC wire ${config.wireGauge} → ${gauges[idx + 1]} (V-drop > 3%)`, 'auto');
      }
    }

    // Fix rapid shutdown if missing
    if (!config.rapidShutdown) {
      updateConfig({ rapidShutdown: true });
      logDecision('Auto Fix', 'Enabled Rapid Shutdown (NEC 690.12 required for rooftop arrays)', 'auto');
    }

    // ── Phase 13.7: Feasibility-driven electrical string fix ─────────────────
    // Only attempt for non-micro topologies. Micro systems do not have
    // string configurations to fix via the feasibility engine.
    if (!cs.isMicro) {
      // Gather panel electrical specs from the current configuration.
      const fixFirstStr = config.inverters[0]?.strings[0];
      const fixPanelData = fixFirstStr?.panelId
        ? (getPanelById(fixFirstStr.panelId) as any)
        : null;

      const fixPanelIsc: number | undefined          = fixPanelData?.isc;
      const fixPanelTempCoeffVoc: number | undefined = fixPanelData?.tempCoeffVoc;

      if (fixPanelIsc != null && fixPanelTempCoeffVoc != null) {
        // We have enough electrical data — run the feasibility engine.
        const fix = applyFeasibleFix({
          totalPanels,
          panelIsc:         fixPanelIsc,
          panelTempCoeffVoc: fixPanelTempCoeffVoc,
          panelVoc:         fixPanelData?.voc   ?? 41.6,
          panelVmp:         fixPanelData?.vmp   ?? 34.5,
          panelWattage:     fixPanelData?.watts ?? 400,
          selectedBrand:      config.selectedBrand,
          selectedInverterId: config.inverters[0]?.inverterId,
        });

        if (fix.success && fix.appliedConfig) {
          // CASE A — valid configuration found: apply it.
          const { inverterModel, strings: fixStrings } = fix.appliedConfig;

          // Rebuild inverter config from the fix engine output.
          // Each physical unit gets its own InverterConfig entry.
          const newInverters: typeof config.inverters = [];
          for (let unitIdx = 0; unitIdx < inverterModel.qty; unitIdx++) {
            const unitStrings = fixStrings.filter(s => s.inverterIndex === unitIdx);
            const existingInv = config.inverters[unitIdx];

            newInverters.push({
              id:         existingInv?.id ?? `inv-fix-${unitIdx}`,
              inverterId: inverterModel.equipmentDbId,
              type:       (config.inverters[0]?.type ?? 'string') as typeof config.inverters[0]['type'],
              strings:    unitStrings.map((s, si) => {
                const baseStr = existingInv?.strings[si] ?? config.inverters[0]?.strings[0];
                return {
                  id:             baseStr?.id             ?? `str-fix-${unitIdx}-${si}`,
                  label:          `String ${s.index + 1}`,
                  panelCount:     s.panelCount,
                  panelId:        baseStr?.panelId        ?? fixFirstStr?.panelId ?? '',
                  tilt:           baseStr?.tilt           ?? 20,
                  azimuth:        baseStr?.azimuth        ?? 180,
                  roofType:       baseStr?.roofType       ?? config.roofType,
                  mountingSystem: baseStr?.mountingSystem ?? config.mountingId,
                  wireGauge:      baseStr?.wireGauge      ?? config.wireGauge,
                  wireLength:     baseStr?.wireLength     ?? 50,
                };
              }),
            });
          }

          updateConfig({ inverters: newInverters, userHasEditedInverters: false });
          logDecision(
            'Fix Engine',
            `Applied feasible config: ${inverterModel.equipmentDbId} ×${inverterModel.qty}, ` +
            `${fixStrings.length} strings, DC/AC=${inverterModel.dcAcRatio.toFixed(2)}, ` +
            `score=${fix.recommended?.score.toFixed(1) ?? '—'}`,
            'auto',
          );
        } else if (!fix.success && fix.reason !== 'micro-topology') {
          // CASE B — no valid configuration: surface to user.
          setFixNoSolution(
            fix.reason ?? 'No valid string configuration found for this panel and inverter combination.'
          );
          logDecision('Fix Engine', `No valid config: ${fix.reason ?? 'all models rejected'}`, 'auto');
        }
      } else {
        // Panel electrical specs not available — fall through to runCalc() only.
        logDecision('Fix Engine', 'Panel Isc/tempCoeffVoc not available — skipping feasibility fix', 'auto');
      }
    }

    setTimeout(() => runCalc(), 300);
  };

  // ── Explain Logic: calls topology API and explains the decision ───────────────
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainResult, setExplainResult] = useState<string | null>(null);

  const handleExplainLogic = async () => {
    setExplainLoading(true);
    setExplainResult(null);
    try {
      const firstInv = config.inverters[0];
      const topoRes = await fetch('/api/engineering/topology', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inverterId:    firstInv?.inverterId,
          rackingId:     config.mountingId,
          moduleCount:   totalPanels,
          stringCount:   config.inverters.reduce((s, inv) => s + inv.strings.length, 0),
          // v58.3: safe inverterCount -- don't send string count as inverter count
          inverterCount: (() => {
            const _inv0 = config.inverters[0];
            if (_inv0?.type === 'micro') return 1;
            if (sizingRecommendation?.inverterCount) return sizingRecommendation.inverterCount;
            const _raw = config.inverters.length;
            const _mods = totalPanels || 1;
            const _physMax = _inv0?.type === 'optimizer'
              ? Math.max(1, Math.ceil(_mods / 25))
              : Math.max(1, Math.ceil(_mods / 8));
            return _raw > _physMax ? 1 : _raw;
          })(),
          roofType:      config.roofType,
          systemType:    config.systemType,
        }),
      });
      if (topoRes.ok) {
        const d = await topoRes.json();
        const lines: string[] = [
          `**Topology: ${d.topologyLabel}** (confidence: ${Math.round((d.confidence || 0.9) * 100)}%)`,
          `Reason: ${d.reason || 'Resolved from equipment registry'}`,
          '',
          `**Required Accessories (${d.resolvedAccessories?.length || 0}):**`,
          ...(d.resolvedAccessories || []).slice(0, 6).map((a: any) =>
            `• ${a.manufacturer || ''} ${a.model || a.label || a.category}: qty ${a.quantity} — ${a.label || a.category || ''}`
          ),
          '',
          `**SLD Stages:** ${(d.sldStages || []).join(' → ')}`,
          `**BOM Stages:** ${(d.bomStages || []).join(', ')}`,
          '',
          `**Compliance Flags:** ${Object.entries(d.complianceFlags || {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
          '',
          `**Rule Set:** ${d.ruleSet?.label || d.topologyLabel}`,
          d.ruleSet?.description ? `${d.ruleSet.description}` : '',
        ];
        setExplainResult(lines.join('\n'));
        logDecision('Explain Logic', `Topology: ${d.topologyLabel} — ${d.resolvedAccessories?.length || 0} accessories resolved`, 'info');
      }
    } catch (e: unknown) {
      setExplainResult(`Error: ${(e as Error).message}`);
    } finally {
      setExplainLoading(false);
    }
  };

  // ── Generate Full Permit Package ──────────────────────────────────────────────
  const [permitLoading, setPermitLoading] = useState(false);
  const [planSetLoading, setPlanSetLoading] = useState(false);
  // projectLayout moved to top of component (near config state) so the
  // panel-count source of truth resolver can read it from totalPanels
  // computation time. See declaration near `config`.
  const [layoutFetchedDirect, setLayoutFetchedDirect] = useState(false);

  // ─────────────────────────────────────────────────────────────────────
  // v47.360: Fence-systemType watcher — AUTO-HEAL + PROMOTION
  //
  // Two jobs:
  //   1. AUTO-HEAL: If projectLayout.type is 'solar_fence'/'fence' but
  //      config.systemType is still 'roof' (stale DB), patch config.systemType
  //      to 'fence' so the rest of the app treats it correctly.
  //   2. PROMOTION: If config.systemType is 'fence', auto-promote hardcoded
  //      default inverter/panels → EcoFlow + Philadelphia Solar.
  //
  // NON-DESTRUCTIVE: only operates on hardcoded defaults; preserves real
  // user selections. Only runs on SolFence — roof/ground untouched.
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const layoutType = (projectLayout?.type ?? projectLayout?.systemType ?? '').toString().toLowerCase();
    const layoutIsFence = layoutType === 'solar_fence' || layoutType === 'fence';
    const configIsFence = config.systemType === 'fence';

    // Job 1 (kept): auto-heal systemType when layout says fence but config says roof.
    // This is a DATA-INTEGRITY fix (stale DB bug), NOT a config mutation — the
    // user's intent (system is a fence) is already expressed by the layout.
    if (layoutIsFence && !configIsFence) {
      console.log(`[FENCE WATCHER] Auto-healing systemType: layout says '${layoutType}' but config.systemType='${config.systemType}' → promoting to 'fence'`);
      setConfig(prev => ({ ...prev, systemType: 'fence' }));
    }
    // Job 2 REMOVED (Phase 11): auto-promotion of hardcoded defaults to
    // EcoFlow + Philadelphia Solar is now handled by the SizingRecommendation
    // panel, which SUGGESTS the change but requires explicit user consent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config.systemType,
    projectLayout?.type,
    projectLayout?.systemType,
  ]);
  const [planSetResult, setPlanSetResult] = useState<{ fileName: string; fileId?: string; sheets: number; structuralStatus: string; message: string } | null>(null);
  const [planSetError, setPlanSetError] = useState<string | null>(null);
  const [planSetPreviewSheet, setPlanSetPreviewSheet] = useState<string | null>(null); // sheet id being previewed

  // ── SYNC PIPELINE ──────────────────────────────────────────────────────────
  // Calls /api/engineering/sync-pipeline which:
  //   1. Reads layout from DB (canonical panel count)
  //   2. Rebuilds engineering report from layout if stale
  //   3. Returns panelCount/systemSizeKw/models from LAYOUT (not seed)
  // This runs once per page load when currentProjectId becomes known.
  // It is the authoritative integration point between design and engineering.
  useEffect(() => {
    if (!currentProjectId || layoutFetchedDirect) return;
    setLayoutFetchedDirect(true);
    console.log('[LAYOUT_LOADED] Calling sync-pipeline for projectId:', currentProjectId);

    fetch(`/api/engineering/sync-pipeline?projectId=${currentProjectId}`)
      .then(r => r.json())
      .then(sr => {
        if (!sr.success) {
          if (sr.error === 'NO_LAYOUT') {
            console.warn('[EngineeringPage] No layout in DB yet — user must use Design Studio first');
            return;
          }
          console.warn('[EngineeringPage] sync-pipeline failed:', sr.error);
          // Fallback: try direct layout fetch
          return fetch(`/api/projects/${currentProjectId}/layout`)
            .then(r => r.json())
            .then(lr => {
              if (lr.success && lr.data?.panels?.length > 0) {
                setProjectLayout(lr.data);
                console.log('[EngineeringPage] FALLBACK layout set:', lr.data.panels.length, 'panels');
              }
            });
        }

        const { layout, engineering } = sr.data;
        console.log('[LAYOUT_LOADED]', {
          panelCount:     layout.panelCount,
          roofPlaneCount: layout.roofPlaneCount,
          systemSizeKw:   layout.systemSizeKw,
          updatedAt:      layout.updatedAt,
        });
        console.log('[ENGINEERING_REBUILD_COMPLETED]', {
          panelCount:   engineering.panelCount,
          systemSizeKw: engineering.systemSizeKw,
          panelModel:   engineering.panelModel,
          inverterModel: engineering.inverterModel,
          wasRebuilt:   sr.data.wasRebuilt,
        });

        // Set projectLayout from sync result (uses DB layout directly)
        if (layout.panelCount > 0) {
          // Fetch the full layout object for panel positions
          fetch(`/api/projects/${currentProjectId}/layout`)
            .then(r => r.json())
            .then(lr => {
              if (lr.success && lr.data) {
                setProjectLayout(lr.data);
                console.log('[EngineeringPage] projectLayout SET:', lr.data.panels?.length, 'panels,', lr.data.roofPlanes?.length ?? 0, 'roof planes');
              }
            })
            .catch(() => {});
        }

        // ── CRITICAL: update config panel count from layout ────────────────
        // Only update if current config has wrong panel count
        const currentTotal = config.inverters.reduce((s, inv) =>
          s + inv.strings.reduce((s2, str) => s2 + str.panelCount, 0), 0);
        if (layout.panelCount > 0 && currentTotal !== layout.panelCount) {
            console.log('[EngineeringPage] PANEL COUNT FIX:', currentTotal, '→', layout.panelCount);
            // Pre-compute string layout using the sizing engine BEFORE entering setConfig.
            // This ensures datasheet-derived string counts replace the old Math.min(pc, 13) heuristic.
            const _pcInv0 = config.inverters[0];
            const _pcInvType = _pcInv0?.type ?? 'string';
            const _pcInverterId = _pcInv0?.inverterId ?? '';
            const _pcPanelId = _pcInv0?.strings?.[0]?.panelId ?? 'qcells-peak-duo-400';
            const _pcPanel = SOLAR_PANELS.find((pp: any) => pp.id === _pcPanelId) as any;
            const _pcPc = layout.panelCount;
            let _pcEngStrings: { panelCount: number }[] | null = null;
            if (_pcInvType !== 'micro') {
              try {
                const _pcResult = sizeSystemFromBrand({
                  systemType: 'roof',
                  panelCount: _pcPc,
                  panelWattage: _pcPanel?.watts ?? 400,
                  panelVoc: _pcPanel?.voc ?? 49.6,
                  panelTempCoeffVoc: _pcPanel?.tempCoeffVoc ?? -0.27,
                  designTempMin: -10,
                  selectedInverterId: _pcInverterId,
                  optimizerMaxOutputCurrent: 15.0,
                });
                if (_pcResult.strings.length > 0) _pcEngStrings = _pcResult.strings;
              } catch { /* fall through to fallback */ }
            }
            if (!_pcEngStrings) {
              // Fallback: even split capped at 14 (datasheet ceiling for 380V × 15A optimizers)
              const _pcPps = _pcInvType === 'micro' ? 1 : Math.min(_pcPc, 14);
              const _pcSc  = _pcInvType === 'micro' ? _pcPc : Math.max(1, Math.ceil(_pcPc / _pcPps));
              _pcEngStrings = Array.from({ length: _pcSc }, (_, i) => ({
                panelCount: i === _pcSc - 1 ? _pcPc - _pcPps * (_pcSc - 1) : _pcPps,
              }));
            }
            const _pcFinalStrings = _pcEngStrings;
            setConfig(prev => {
              const newInverters = prev.inverters.map((inv, ii) => {
                if (ii === 0) {
                  // Use pre-computed engine string layout (datasheet-accurate)
                  const newStrings = _pcFinalStrings.map((s, si) => {
                    const existing = inv.strings[si] || inv.strings[0];
                    return { ...existing, id: existing?.id || `str-sync-${si}`, panelCount: s.panelCount };
                  });
                  return { ...inv, strings: newStrings };
                }
                return inv;
              });
              return { ...prev, inverters: newInverters };
            });
            // Trigger recalculation with correct panel count
          setTimeout(() => {
            console.log('[EngineeringPage] Auto-recalculating after panel count sync');
            runCalc();
          }, 400);
        }

        // Log pipeline diagnostics
        if (sr.data.errors?.length > 0) {
          console.error('[PIPELINE_MISMATCH]', sr.data.errors);
        }
      })
      .catch(err => {
        console.warn('[EngineeringPage] sync-pipeline error:', err);
        // Last resort fallback
        fetch(`/api/projects/${currentProjectId}/layout`)
          .then(r => r.json())
          .then(lr => {
            if (lr.success && lr.data?.panels?.length > 0) {
              setProjectLayout(lr.data);
            }
          })
          .catch(() => {});
      });
  }, [currentProjectId, layoutFetchedDirect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load workflow status from DB on page load (Task 6: status from actual data, not UI flags)
  // Uses /api/debug/project which derives workflow state from layouts, engineering_reports, project_files
  useEffect(() => {
    if (!currentProjectId) return;
    fetch(`/api/debug/project?projectId=${currentProjectId}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        const ws = d.workflow ?? {};         // { designComplete, engineeringComplete, permitReady, filesReady }
        const layout = d.layout ?? {};       // { exists, panels, systemSizeKw, ... }
        const eng = d.engineering ?? {};     // { exists, panelCount, systemSizeKw, ... }
        const artifacts = d.artifacts ?? {}; // { totalFiles, files, hasBom, hasSld, ... }
        setAutoWorkflowStatus({
          designComplete:      !!ws.designComplete,
          engineeringComplete: !!ws.engineeringComplete,
          permitReady:         !!ws.permitReady,
          filesReady:          !!ws.filesReady,
          layoutPanels:        layout.panels ?? 0,
          layoutKw:            layout.systemSizeKw ?? 0,
          hasEngReport:        !!eng.exists,
          fileCount:           artifacts.totalFiles ?? 0,
          loadedAt:            new Date().toISOString(),
        });
        console.log('[WorkflowStatus] Auto-loaded from DB:', ws);
      })
      .catch(() => {}); // non-critical — silently ignore
  }, [currentProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGeneratePermitPackage = async () => {
    // GUARD: if layout is missing entirely, block and warn
    if (!projectLayout || !projectLayout.panels || projectLayout.panels.length === 0) {
      alert('No layout found. Please open Design Studio, place panels, and save your layout before generating a permit.');
      return;
    }
    setPermitLoading(true);
    logDecision('Permit Package', 'Generating full permit package (SLD + BOM + Structural + Cover Sheet)', 'auto');
    console.log('[PERMIT PREFLIGHT]', {
      layoutPanels: projectLayout.panels.length,
      layoutRoofPlanes: projectLayout.roofPlanes?.length ?? 0,
      layoutSystemSizeKw: projectLayout.systemSizeKw,
      configTotalPanels: totalPanels,
      configTotalKw: totalKw,
      projectName: config.projectName,
      address: config.address,
      buildVersion: BUILD_VERSION,
      note: projectLayout.panels.length !== totalPanels
        ? `WARNING: layout(${projectLayout.panels.length}) != config(${totalPanels}) panel counts differ`
        : 'OK: layout and config panel counts match',
    });
    try {
      const _mountSys = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
      const permitInput = {
        projectId: currentProjectId || undefined,
        project: {
          projectName: config.projectName, clientName: config.clientName,
          address: config.address, designer: config.designer, date: config.date,
          notes: config.notes, systemType: config.systemType,
          lat: (config as any).lat || undefined,
          lng: (config as any).lng || (config as any).lon || undefined,
          mainPanelAmps: config.mainPanelAmps, mainPanelBrand: config.mainPanelBrand,
          utilityMeter: config.utilityMeter, acDisconnect: config.acDisconnect,
          dcDisconnect: config.dcDisconnect, productionMeter: config.productionMeter,
          rapidShutdown: config.rapidShutdown, conduitType: config.conduitType,
          wireGauge: config.wireGauge, wireLength: config.wireLength,
          utilityName: compliance?.utilityName || config.utilityId || 'Local Utility',
          roofType: config.roofType,
          mountingSystem: _mountSys ? `${_mountSys.manufacturer} ${_mountSys.model}` : config.mountingId || 'IronRidge XR100',
          mountingSystemId: config.mountingId,
          roofPitch: config.roofPitch,
          rafterSize: config.rafterSize,
          rafterSpacing: config.rafterSpacing,
          attachmentSpacing: config.attachmentSpacing,
          interconnectionMethod: config.interconnectionMethod ?? 'LOAD_SIDE',
          panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200,
          batteryBrand: config.batteryBrand, batteryModel: config.batteryModel,
          batteryCount: config.batteryCount, batteryKwh: config.batteryKwh,
          batteryBackfeedA: calcBatteryBackfeedAmps(config.batteryId, config.batteryCount),
          generatorBrand: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? ''; })() : undefined,
          generatorKw: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? 0; })() : undefined,
          atsBrand: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.manufacturer ?? ''; })() : undefined,
          atsAmpRating: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? 0; })() : undefined,
          city: config.city || '',
          state: config.state || '',
          zip: config.zip || '',
          county: config.county || '',
          panelVoc: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.voc : undefined; })(),
          panelIsc: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.isc : undefined; })(),
          panelWeightLbs: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.weightLbs : undefined; })(),
          panelLengthIn: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.lengthIn : undefined; })(),
          panelWidthIn: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.widthIn : undefined; })(),
          // FIX v47.79: panelPositions + roofPlanes inside project:{}
          // Previously spread at top-level — project.panelPositions was always undefined
          ...(projectLayout?.panels && projectLayout.panels.length > 0 ? {
            panelPositions: projectLayout.panels.map((p: any) => ({
              id: p.id, lat: p.lat, lng: p.lng, x: p.x, y: p.y,
              tilt: p.tilt, azimuth: p.azimuth, wattage: p.wattage,
              row: p.row, col: p.col, systemType: p.systemType, orientation: p.orientation,
              arrayId: (p as any).arrayId,
            })),
            roofPlanes: (projectLayout?.roofPlanes || []).map((rp: any) => ({
              id: rp.id, vertices: rp.vertices || [],
              pitch: rp.pitch, azimuth: rp.azimuth, area: rp.area,
            })),
          } : {}),
        },
        system: {
          totalDcKw: parseFloat(projectLayout?.panels?.length > 0 ? (projectLayout.panels.length * (() => { const _pw0 = config.inverters?.[0]?.strings?.[0]; return _pw0 ? ((getPanelById(_pw0.panelId) as any)?.watts ?? 400) / 1000 : 0.4; })()).toFixed(2) : totalKw),
          totalAcKw: parseFloat(totalInverterKw),
          totalPanels: projectLayout?.panels?.length > 0 ? projectLayout.panels.length : totalPanels,
          dcAcRatio: calcDcAcRatio(parseFloat(projectLayout?.panels?.length > 0 ? (projectLayout.panels.length * (() => { const _pw0 = config.inverters?.[0]?.strings?.[0]; return _pw0 ? ((getPanelById(_pw0.panelId) as any)?.watts ?? 400) / 1000 : 0.4; })()).toFixed(2) : totalKw), parseFloat(totalInverterKw) || 0),
          topology: topologyType,
          inverters: config.inverters.map(inv => {
            const invData = getInvById(inv.inverterId, inv.type) as any;
            return {
              manufacturer: invData?.manufacturer || '', model: invData?.model || '',
              type: inv.type, acOutputKw: invData?.acOutputKw || (invData?.acOutputW/1000) || 0,
              maxDcVoltage: invData?.maxDcVoltage || 480, efficiency: invData?.efficiency || 97,
              ulListing: invData?.ulListing || 'UL 1741',
              strings: inv.strings.map(str => {
                const panel = getPanelById(str.panelId) as any;
                return { label: str.label, panelCount: str.panelCount,
                  panelManufacturer: panel?.manufacturer || '', panelModel: panel?.model || '',
                  panelWatts: panel?.watts || 400, panelVoc: panel?.voc || 41.6,
                  panelIsc: panel?.isc || 12.26, wireGauge: str.wireGauge, wireLength: str.wireLength };
              }),
            };
          }),
        },
        compliance, rulesResult, bom, overrides,
        // v47.314: Send layout.type (canonical) + systemType (legacy) + fence geometry
        // buildCanonical() on server reads layout.type as single source of truth
        // FIX v47.319: resolve effective system type — projectLayout.systemType may be 'roof' due to
        // DB system_type=NULL causing rowToLayout() to default to 'roof'. Use config.systemType
        // (from projects.system_type) as authoritative override when projectLayout gives 'roof'.
        layout: projectLayout ? (() => {
          const layoutSys = (projectLayout.systemType || '') as string;
          const configSys = (config.systemType as string) || '';
          // config.systemType wins over a bare 'roof' default from rowToLayout
          const effectiveSys = (layoutSys === 'fence' || layoutSys === 'solar_fence' || layoutSys === 'ground' || layoutSys === 'ground_mount')
            ? layoutSys
            : (configSys === 'fence' || configSys === 'solar_fence' || configSys === 'ground' || configSys === 'ground_mount')
              ? configSys
              : layoutSys || configSys || 'roof';
          const resolvedType = (effectiveSys === 'fence' || effectiveSys === 'solar_fence') ? 'solar_fence'
            : (effectiveSys === 'ground' || effectiveSys === 'ground_mount') ? 'ground_mount'
            : 'roof';
          return {
          type: resolvedType,
          systemType:   effectiveSys,
          fenceLine:    projectLayout.fenceLine    || undefined,
          fenceSegments: projectLayout.fenceLine?.length > 1
            ? projectLayout.fenceLine.slice(0, -1).map((pt: any, i: number) => {
                const ep = projectLayout.fenceLine[i + 1];
                // v47.303: compute actual GPS distance & azimuth instead of hardcoded 0
                const DEG2RAD = Math.PI / 180;
                const EARTH_R = 6_371_000;
                const cosLat  = Math.cos(pt.lat * DEG2RAD);
                const dx = (ep.lng - pt.lng) * DEG2RAD * cosLat * EARTH_R;
                const dy = (ep.lat - pt.lat) * DEG2RAD * EARTH_R;
                const lenM   = Math.sqrt(dx * dx + dy * dy);
                const lenFt  = Math.round(lenM * 3.28084 * 10) / 10;
                const az     = Math.round(((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360);
                return { id: `seg-${i}`, startPoint: pt, endPoint: ep, lengthFt: lenFt, azimuth: az, panelCount: 0 };
              })
            : undefined,
          groundArrays: (effectiveSys === 'ground' || effectiveSys === 'ground_mount') ? [{ id: 'ground-1' }] : undefined,
          panels: (projectLayout.panels || []).map((p: any) => ({
            id:  p.id,
            lat: p.lat,
            lng: p.lng,
            x:   p.x,
            y:   p.y,
            systemType: p.systemType || p.placementType || undefined,
          })),
          }; })() : undefined,
      };

      const res = await fetch('/api/engineering/permit?format=pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permitInput),
      });

      if (res.ok) {
        const contentType = res.headers.get('Content-Type') || '';
        const isHtmlFallback = contentType.includes('text/html');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = isHtmlFallback
          ? `PermitPackage-${config.projectName || 'project'}.html`
          : `PermitPackage-${config.projectName || 'project'}.pdf`;
        a.click(); URL.revokeObjectURL(url);
        logDecision('Permit Package', `Downloaded as ${isHtmlFallback ? 'HTML' : 'PDF'}`, 'auto');
      } else if (res.status === 422) {
        const errData = await res.json().catch(() => ({}));
        if (errData.code === 'ENGINEERING_MODEL_STALE') {
          alert(`⚠️ Permit Blocked — Stale Engineering Model\n\n${errData.message ?? 'Panel count is 0. Please open the Engineering page, wait for the pipeline sync to complete, then try again.'}`);
        } else {
          alert(`Permit generation failed (422): ${errData.message ?? 'Unknown error'}`);
        }
      } else {
        const errText = await res.text().catch(() => '');
        alert(`Permit generation failed (${res.status}). Please check the console for details.\n\n${errText.slice(0, 200)}`);
      }
    } catch (e: unknown) {
      logDecision('Permit Package', `Error: ${(e as Error).message}`, 'manual');
      alert(`Permit generation error: ${(e as Error).message}`);
    } finally {
      setPermitLoading(false);
    }
  };

  // ── Generate Permit-Grade Plan Set (v43.0) ─────────────────────────────────
  const handleGeneratePlanSet = async () => {
    console.log('[PLANSET V43 ENTRY]', {
      timestamp: Date.now(),
      systemType: config.systemType,
      totalPanels: projectLayout?.panels?.length ?? totalPanels,
      hasLayout: !!(projectLayout?.panels && projectLayout.panels.length > 0),
    });
    setPlanSetLoading(true);
    setPlanSetError(null);
    setPlanSetResult(null);
    try {
      // Ensure we have the accurate SLD before building the plan set.
      // If sldSvg is null (user hasn't clicked Generate SLD this session),
      // fetch it now so E-1 always uses renderSLDProfessional(), never the fallback.
      let activeSldSvg = sldSvg;
      if (!activeSldSvg) {
        console.log('[handleGeneratePlanSet] sldSvg is null — auto-fetching SLD before plan-set...');
        activeSldSvg = await fetchSLDSvg();
        if (activeSldSvg) {
          setSldSvg(activeSldSvg);
          console.log('[handleGeneratePlanSet] SLD auto-fetched successfully for plan-set');
        } else {
          console.warn('[handleGeneratePlanSet] SLD auto-fetch returned null — E-1 will use fallback renderer');
        }
      }

      // Gather all system data
      const firstInv = config.inverters[0];
      const firstStr = firstInv?.strings[0];
      const invData  = getInvById(firstInv?.inverterId || '', firstInv?.type || 'string') as any;
      const panelData= getPanelById(firstStr?.panelId || '') as any;

      // Build strings array for plan set — use computedSystem.strings (engine output) when available
      const csStrings = cs.strings ?? [];
      const csDcRun   = cs.runMap?.['DC_STRING_RUN'] ?? cs.runs?.find((r: any) => r.id === 'DC_STRING_RUN');
      const planStrings = csStrings.length > 0
        ? csStrings.map((s: any, i: number) => ({
            id:          `S${i + 1}`,
            label:       `S${i + 1}`,
            panelCount:  s.panelCount,
            panelWatts:  s.panelWatts ?? (panelData as any)?.watts ?? 400,
            wireGauge:   s.wireGauge  ?? (csDcRun as any)?.wireGauge ?? '#10 AWG',
            conduitType: s.conduitType ?? config.conduitType ?? '3/4" EMT',
            wireLength:  config.inverters[0]?.strings[i]?.wireLength ?? config.wireLength ?? 50,
            ocpdAmps:    s.ocpdAmps   ?? cs.acOcpdAmps ?? 15,
            stringVoc:   s.stringVoc  ?? ((panelData as any)?.voc ?? 41.6) * s.panelCount,
            stringVmp:   s.stringVmp  ?? ((panelData as any)?.vmp ?? 34.5) * s.panelCount,
            stringIsc:   s.stringIsc  ?? (panelData as any)?.isc ?? 12.26,
            stringImp:   s.stringImp  ?? (panelData as any)?.imp ?? 11.5,
          }))
        : config.inverters.flatMap(inv =>
            inv.strings.map(str => {
              const pd = getPanelById(str.panelId) as any;
              return {
                id: str.id, label: str.label,
                panelCount:  str.panelCount,
                panelWatts:  pd?.watts || 400,
                wireGauge:   str.wireGauge || (csDcRun as any)?.wireGauge || config.wireGauge || '#10 AWG',
                conduitType: config.conduitType || '3/4" EMT',
                wireLength:  str.wireLength || config.wireLength || 50,
                ocpdAmps:    (csStrings[0] as any)?.ocpdAmps ?? compliance.stringConfig?.ocpdPerString ?? 15,
                stringVoc:   (csStrings[0] as any)?.stringVoc ?? (pd?.voc || 41.6) * str.panelCount,
                stringVmp:   (csStrings[0] as any)?.stringVmp ?? (pd?.vmp || 34.5) * str.panelCount,
                stringIsc:   (csStrings[0] as any)?.stringIsc ?? pd?.isc ?? 12.26,
                stringImp:   pd?.imp || 11.5,
              };
            })
          );

      const payload = {
        projectId: searchParams.get('projectId') || '',
        clientId: null,
        // Project
        projectName: config.projectName,
        clientName: config.clientName,
        address: config.address,
        city: config.city,
        state: config.state,
        zip: '',
        county: config.county,
        // System
        systemKw: parseFloat(totalKw),
        panelCount: totalPanels,
        panelModel: panelData?.model || 'Solar Panel',
        panelWatts: panelData?.watts || 400,
        panelWeightLbs: panelData?.weightLbs || 40,
        panelLengthIn: panelData?.lengthIn || 65,
        panelWidthIn: panelData?.widthIn || 39,
        inverterType: firstInv?.type || 'string',
        inverterModel: invData?.model || 'Inverter',
        inverterManufacturer: invData?.manufacturer || '',
        // v58.3: safe inverterCount for permit data
        inverterCount: (() => {
          const _inv0 = config.inverters[0];
          if (_inv0?.type === 'micro') return 1;
          if (sizingRecommendation?.inverterCount) return sizingRecommendation.inverterCount;
          const _raw = config.inverters.length;
          const _mods = totalPanels || 1;
          const _physMax = _inv0?.type === 'optimizer'
            ? Math.max(1, Math.ceil(_mods / 25))
            : Math.max(1, Math.ceil(_mods / 8));
          return _raw > _physMax ? 1 : _raw;
        })(),
        inverterKw: parseFloat(totalInverterKw),
        inverterVacOut: invData?.acVoltage || 240,
        inverterMaxDcV: invData?.maxDcVoltage || 600,
        inverterMaxAcA: invData?.maxAcOutputA || (parseFloat(totalInverterKw) * 1000 / 240),
        mountType: config.mountingId || 'Roof Mount',
        roofType: config.roofType,
        roofPitchDeg: config.roofPitch,
        roofPitchRatio: `${Math.round(config.roofPitch * 12 / 90 * 12)}:12`,
        rafterSize: config.rafterSize,
        rafterSpacingIn: config.rafterSpacing,
        rafterSpanFt: config.rafterSpan,
        // ── Electrical ── Single Source of Truth: computedSystem (cs) ──────────
        // cs = computedSystem from useMemo above — already called computeSystem()
        // Use cs.runMap / cs.runs for wire gauges; cs.acOcpdAmps / cs.backfeedBreakerAmps for OCPDs.
        strings: planStrings,
        dcWireGauge:          (cs.runMap?.['DC_STRING_RUN'] as any)?.wireGauge
                                ?? (cs.runs?.find((r: any) => r.id === 'DC_STRING_RUN') as any)?.wireGauge
                                ?? config.wireGauge
                                ?? '#10 AWG',
        dcConduitType:        (cs.runMap?.['DC_STRING_RUN'] as any)?.conduitSize
                                ?? (cs.runs?.find((r: any) => r.id === 'DC_STRING_RUN') as any)?.conduitSize
                                ?? config.conduitType
                                ?? '3/4" EMT',
        acWireGauge:          (cs.runMap?.['DISCO_TO_METER_RUN'] as any)?.wireGauge
                                ?? (cs.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN') as any)?.wireGauge
                                ?? compliance.electrical?.acWireGauge
                                ?? '#8 AWG',
        acConduitType:        (cs.runMap?.['DISCO_TO_METER_RUN'] as any)?.conduitSize
                                ?? (cs.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN') as any)?.conduitSize
                                ?? config.conduitType
                                ?? '1" EMT',
        dcDisconnectAmps:     (csStrings[0] as any)?.ocpdAmps
                                ?? compliance.stringConfig?.ocpdPerString
                                ?? 15,
        dcDisconnectVoltage:  (invData as any)?.maxDcVoltage || 600,
        acDisconnectAmps:     cs.acOcpdAmps
                                || compliance.electrical?.busbar?.backfeedBreakerAmps
                                || Math.ceil((parseFloat(totalInverterKw) * 1000 / 240) * 1.25 / 5) * 5
                                || 30,
        acBreakerAmps:        cs.acOcpdAmps
                                || compliance.electrical?.busbar?.backfeedBreakerAmps
                                || Math.ceil((parseFloat(totalInverterKw) * 1000 / 240) * 1.25 / 5) * 5
                                || 20,
        backfeedBreakerAmps:  cs.backfeedBreakerAmps
                                || compliance.electrical?.busbar?.backfeedBreakerAmps
                                || 20,
        mainPanelBusAmps:     config.panelBusRating || config.mainPanelAmps || 200,
        mainPanelBreakerAmps: config.mainPanelAmps || 200,
        interconnectionType:  config.interconnectionMethod === 'SUPPLY_SIDE_TAP' ? 'supply-side' : 'load-side',
        interconnectionMethod: config.interconnectionMethod === 'SUPPLY_SIDE_TAP' ? 'Supply-Side Tap' : 'Backfeed Breaker',
        rapidShutdownRequired: config.rapidShutdown,
        rapidShutdownDevice:  config.inverters[0]?.type === 'micro' ? 'Enphase IQ RSD (integrated)' : 'Tigo RSS / SolarEdge SafeDC',
        groundWireGauge:      (cs.runMap?.['DC_STRING_RUN'] as any)?.egcGauge
                                ?? (cs.runs?.find((r: any) => r.id === 'DC_STRING_RUN') as any)?.egcGauge
                                ?? (cs.runMap?.['DISCO_TO_METER_RUN'] as any)?.egcGauge
                                ?? '#10 AWG',
        // Battery
        hasBattery: config.batteryCount > 0 && !!config.batteryId,
        batteryModel: config.batteryModel || undefined,
        batteryManufacturer: config.batteryBrand || undefined,
        batteryCount: config.batteryCount || undefined,
        batteryKwh: config.batteryKwh || undefined,
        batteryBreakerAmps: calcBatteryBackfeedAmps(config.batteryId, config.batteryCount) || undefined,
        // Module electrical specs (v44.0 — NEC 690.7 temp correction)
        moduleVoc: panelData?.voc || undefined,
        moduleIsc: panelData?.isc || undefined,
        moduleVmp: panelData?.vmp || undefined,
        moduleImp: panelData?.imp || undefined,
        moduleTempCoeffVoc: panelData?.tempCoeffVoc || undefined,
        panelsPerString: firstStr?.panelCount || undefined,
        // Inverter MPPT / max DC (v44.0)
        inverterMpptMin: invData?.mpptMin || undefined,
        inverterMpptMax: invData?.mpptMax || undefined,
        inverterMaxDcA: invData?.maxDcInputA || undefined,
        // Temperature inputs (v44.0 — NEC 310.15 rooftop derating)
        minAmbientTempC: compliance.electrical?.minAmbientTempC || -10,
        maxRooftopTempC: compliance.electrical?.maxRooftopTempC || 60,
        // Site geometry (v44.0 — for A-1 site layout)
        roofWidthFt: config.roofWidth || 30,
        roofLengthFt: config.roofLength || 20,
        // Equipment locations (v44.0 — for A-1)
        inverterLocation: config.inverterLocation || 'Garage wall — see site plan',
        disconnectLocation: config.disconnectLocation || 'Adjacent to inverter',
        meterLocation: config.meterLocation || 'Exterior wall — utility meter',
        mainPanelLocation: config.mainPanelLocation || 'Main panel — see site plan',
        // Mounting hardware (v44.0 — for M-1)
        mountingSystem: config.mountingId || 'Roof Mount Racking',
        railType: config.railType || 'IronRidge XR-100',
        flashingType: config.flashingType || 'Flashed L-Foot',
        lagBoltSize: config.lagBoltSize || '5/16" × 3"',
        lagBoltSpacingFt: config.attachmentSpacing ? config.attachmentSpacing / 12 : 4,
        panelThicknessIn: panelData?.thicknessIn || 1.5,
        panelFrameHeight: panelData?.frameHeightMm || 35,
        sheathingType: config.sheathingType || '7/16" OSB',
        bondingHardware: 'WEEB Clips (UL 2703 Listed)',
        // Contractor (v44.0)
        contractorLicense: config.contractorLicense || undefined,
        electricalLicense: config.electricalLicense || undefined,
        ownerContact: config.ownerPhone || config.ownerEmail || undefined,
        stringCount: planStrings.length,
        // Pass pre-rendered SLD SVG so E-1 uses the same diagram already reviewed
        // in Design Studio — avoids generating a different SLD from scratch.
        // activeSldSvg is either the existing state value OR a freshly-fetched SVG
        // (auto-fetched above if sldSvg was null when plan-set was triggered).
        sldSvg: activeSldSvg || undefined,
        // Structural
        windSpeedMph: config.windSpeed || 90,
        groundSnowPsf: config.groundSnowLoad || 0,
        seismicCategory: compliance.structural?.seismicCategory || 'C',
        // AHJ
        ahj: compliance.jurisdiction?.ahjName || `${config.city}, ${config.state} Building Dept.`,
        utilityName: compliance.jurisdiction?.utility || config.utilityId || 'Local Utility',
        necVersion: compliance.jurisdiction?.necVersion || 'NEC 2020',
        // Contractor
        contractorName: config.projectName || 'SolarPro Contractor',
        designerName: config.designer || 'SolarPro',
        annualKwh: compliance.electrical?.annualKwh || undefined,
      };

      console.log('[PLANSET V43] Calling /api/engineering/plan-set', {
        payloadKeys: Object.keys(payload),
        systemKw: payload.systemKw,
        panelCount: payload.panelCount,
      });
      const res = await fetch('/api/engineering/plan-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log('[ENGINE EXECUTED]', { status: res.status, ok: res.ok });

      // ── Binary response (no projectId) → trigger browser download ──
      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('application/pdf') || contentType.includes('text/html')) {
        if (!res.ok) throw new Error('Plan set generation failed');
        const blob = await res.blob();
        const sheets    = parseInt(res.headers.get('X-Plan-Set-Sheets') || '5', 10);
        const strStatus = res.headers.get('X-Structural-Status') || 'UNKNOWN';
        const pdfMethod = res.headers.get('X-Pdf-Method') || 'pdf';
        const ext       = contentType.includes('text/html') ? 'html' : 'pdf';
        const fileName  = `SolarPro_PlanSet_${(config.address || 'Project').replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setPlanSetResult({
          fileName,
          fileId: undefined,
          sheets,
          structuralStatus: strStatus,
          message: pdfMethod === 'html'
            ? `Downloaded as HTML (open in browser → Print → Save as PDF). ${sheets} sheets ready.`
            : `Downloaded ${sheets}-sheet permit plan set PDF.`,
        });
        logDecision('Plan Set', `Downloaded ${sheets}-sheet plan set: ${fileName}`, 'auto');
        return;
      }

      // ── JSON response (projectId present) → saved to project files ──
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Plan set generation failed');

      setPlanSetResult({
        fileName: data.fileName,
        fileId: data.fileId,
        sheets: data.sheets,
        structuralStatus: data.structuralStatus,
        message: data.message,
      });

      // ── Trigger browser download from the saved file ──
      // The file was saved to project files (DB). Fetch it back and download.
      if (data.fileId) {
        try {
          console.log('[handleGeneratePlanSet] Fetching saved file for download:', data.fileId);
          const dlRes = await fetch(`/api/project-files/download?id=${data.fileId}`);
          if (dlRes.ok) {
            const dlBlob = await dlRes.blob();
            const ext = (data.fileName || '').endsWith('.html') ? 'html' : 'pdf';
            const dlUrl = URL.createObjectURL(dlBlob);
            const dlA   = document.createElement('a');
            dlA.href     = dlUrl;
            dlA.download = data.fileName || `SolarPro_PlanSet.${ext}`;
            document.body.appendChild(dlA);
            dlA.click();
            document.body.removeChild(dlA);
            URL.revokeObjectURL(dlUrl);
            console.log('[handleGeneratePlanSet] Download triggered for:', data.fileName);
          } else {
            console.warn('[handleGeneratePlanSet] Download fetch failed:', dlRes.status, '— file still saved in Files tab');
          }
        } catch (dlErr: unknown) {
          console.warn('[handleGeneratePlanSet] Download error (non-fatal):', (dlErr as Error).message, '— file still saved in Files tab');
        }
      }

      logDecision('Plan Set', `Generated ${data.sheets}-sheet plan set: ${data.fileName}`, 'auto');
    } catch (e: unknown) {
      setPlanSetError((e as Error).message);
      logDecision('Plan Set', `Error: ${(e as Error).message}`, 'manual');
    } finally {
      setPlanSetLoading(false);
    }
  };

  const handleAiQuery = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiResponse(null);
    const q = aiQuery.trim();
    setAiQuery('');
    // Build context-aware response from system state
    const topo = config.inverters[0]?.type === 'micro' ? 'Microinverter' : config.inverters[0]?.type === 'optimizer' ? 'String + Optimizer' : 'String Inverter';
    const firstInv = getInvById(config.inverters[0]?.inverterId || '', config.inverters[0]?.type || 'string') as any;
    const firstPanel = getPanelById(config.inverters[0]?.strings[0]?.panelId || '') as any;
    const context = `System: ${totalKw} kW DC / ${totalInverterKw} kW AC, ${totalPanels} panels, ${topo} topology. Inverter: ${firstInv?.manufacturer} ${firstInv?.model}. Panel: ${firstPanel?.manufacturer} ${firstPanel?.model} ${firstPanel?.watts}W. Compliance: ${compliance.overallStatus || 'not run'}. Address: ${config.address || 'not set'}.`;
    // Simulate intelligent response based on query keywords
    await new Promise(r => setTimeout(r, 600));
    let response = '';
    const ql = q.toLowerCase();
    if (ql.includes('wire') || ql.includes('gauge') || ql.includes('conductor')) {
      response = `**Wire Sizing (NEC 310.15)**\n\nFor your ${totalInverterKw} kW AC system, the current AC wire is ${config.wireGauge}. ${compliance.electrical?.acVoltageDrop ? `Voltage drop is ${compliance.electrical.acVoltageDrop.toFixed(2)}% (limit: 3%).` : ''} NEC 690.8 requires conductors sized at 125% of max current. For a ${config.wireLength}ft run at 240V, verify ampacity with conduit fill derating per NEC Table 310.15(B)(3)(a).`;
    } else if (ql.includes('busbar') || ql.includes('backfeed') || ql.includes('120%')) {
      response = `**120% Busbar Rule (NEC 705.12)**\n\nWith a ${config.mainPanelAmps}A panel, max backfeed = ${Math.floor(config.mainPanelAmps * 0.2)}A. Your system AC output is ${totalInverterKw} kW ÷ 240V = ${(parseFloat(totalInverterKw) * 1000 / 240).toFixed(1)}A. Backfeed breaker = ${Math.ceil(parseFloat(totalInverterKw) * 1000 / 240 * 1.25 / 5) * 5}A. ${compliance.electrical?.busbar?.passes ? '✅ PASSES 120% rule.' : '⚠️ Check busbar compliance.'}`;
    } else if (ql.includes('rapid shutdown') || ql.includes('rsd') || ql.includes('690.12')) {
      response = `**Rapid Shutdown (NEC 690.12)**\n\nRapid shutdown is ${config.rapidShutdown ? 'ENABLED' : 'DISABLED'} for this system. NEC 690.12 requires module-level shutdown within 30 seconds for rooftop arrays. ${config.inverters[0]?.type === 'micro' ? 'Microinverters (Enphase IQ series) have integrated RSD compliance.' : 'Ensure your inverter has RSD-compliant firmware or add a dedicated RSD device.'} Required for all rooftop PV systems per NEC 2017+.`;
    } else if (ql.includes('structural') || ql.includes('wind') || ql.includes('attachment') || ql.includes('rafter')) {
      response = `**Structural Analysis (ASCE 7-22)**\n\nDesign wind: ${config.windSpeed} mph, Exposure ${config.windExposure}. Rafter: ${config.rafterSize} @ ${config.rafterSpacing}" O.C., ${config.rafterSpan}ft span. Attachment spacing: ${config.attachmentSpacing}". ${compliance.structural ? `Safety factor: ${compliance.structural.attachment?.safetyFactor?.toFixed(2)}. Status: ${compliance.structural.status}.` : 'Run compliance check for full structural analysis.'}`;
    } else if (ql.includes('topology') || ql.includes('microinverter') || ql.includes('optimizer')) {
      response = `**Topology: ${topo}**\n\nCurrent topology: ${topo}. ${config.inverters[0]?.type === 'micro' ? 'Microinverter systems eliminate string mismatch, ideal for shaded/complex roofs. Each module operates independently. Requires IQ Gateway for monitoring.' : config.inverters[0]?.type === 'optimizer' ? 'Optimizer topology adds per-module MPPT while keeping string inverter simplicity. Requires optimizer-compatible inverter.' : 'String inverter topology is most cost-effective for unshaded, simple roofs. Strings must be matched in panel count and orientation.'}`;
    } else if (ql.includes('nec') || ql.includes('code') || ql.includes('compliance')) {
      response = `**NEC Compliance Summary**\n\nJurisdiction: ${compliance.jurisdiction?.state || 'Not detected'} — NEC ${compliance.jurisdiction?.necVersion || '2020'}. Overall status: ${compliance.overallStatus || 'Not calculated'}. Key checks: 690.7 (string voltage), 690.8 (OCPD sizing), 690.12 (RSD), 705.12 (120% busbar), 310.15 (ampacity). ${compliance.electrical?.errors?.length ? `${compliance.electrical.errors.length} error(s) found.` : 'No electrical errors.'}`;
    } else {
      response = `**Engineering Analysis**\n\nSystem context: ${context}\n\nFor "${q}": Based on your ${totalKw} kW DC / ${totalInverterKw} kW AC ${topo} system, I recommend running the full compliance check first (Run Compliance Check button). Key NEC references for this system: 690.7 (Voc correction), 690.8 (OCPD), 705.12 (busbar), 310.15 (conductors). ${compliance.overallStatus ? `Current status: ${compliance.overallStatus}.` : 'No compliance data yet — click Run Compliance Check.'}`;
    }
    setAiResponse(response);
    logDecision('AI Query', q, 'info');
    setAiLoading(false);
  };

  // Derived topology label for display
  const topologyLabel = config.inverters[0]?.type === 'micro' ? 'MICROINVERTER'
    : config.inverters[0]?.type === 'optimizer' ? 'STRING + OPTIMIZER'
    : 'STRING INVERTER';
  const topologyColor = config.inverters[0]?.type === 'micro' ? 'text-purple-400 border-purple-500/40 bg-purple-500/10'
    : config.inverters[0]?.type === 'optimizer' ? 'text-blue-400 border-blue-500/40 bg-blue-500/10'
    : 'text-amber-400 border-amber-500/40 bg-amber-500/10';

  // ── Permit Readiness — derived from live engineering state ────────────
  const _firstInvCfg  = config.inverters[0];
  const _firstStrCfg  = _firstInvCfg?.strings[0];
  const _invDataPR    = getInvById(_firstInvCfg?.inverterId || '', _firstInvCfg?.type || 'string') as any;
  const _panelDataPR  = getPanelById(_firstStrCfg?.panelId || '') as any;

  interface PermitReadinessItem {
    key: string;
    label: string;
    ok: boolean;
    value?: string;
    fix?: string;
    tab?: string;
  }
  const permitReadiness: PermitReadinessItem[] = [
    {
      key: 'address',
      label: 'Project Address',
      ok: !!(config.address && config.city && config.state),
      value: config.address ? `${config.address}, ${config.city}, ${config.state}` : undefined,
      fix: 'Enter project address in System Config → Project Info',
      tab: 'config',
    },
    {
      key: 'systemSize',
      label: 'System Size (kW)',
      ok: parseFloat(totalKw) > 0,
      value: parseFloat(totalKw) > 0 ? `${totalKw} kW DC / ${totalInverterKw} kW AC` : undefined,
      fix: 'Add panels and inverters in System Config',
      tab: 'config',
    },
    {
      key: 'panelCount',
      label: 'Panel Count',
      ok: totalPanels > 0,
      value: totalPanels > 0 ? `${totalPanels} panels` : undefined,
      fix: 'Configure strings with panel count in System Config',
      tab: 'config',
    },
    {
      key: 'panelModel',
      label: 'Panel Model',
      ok: !!(_panelDataPR?.model),
      value: _panelDataPR?.model ? `${_panelDataPR.manufacturer} ${_panelDataPR.model} ${_panelDataPR.watts}W` : undefined,
      fix: 'Select a panel model in System Config → Strings',
      tab: 'config',
    },
    {
      key: 'inverterModel',
      label: 'Inverter Model',
      ok: !!(_invDataPR?.model),
      value: _invDataPR?.model ? `${_invDataPR.manufacturer} ${_invDataPR.model}` : undefined,
      fix: 'Select an inverter model in System Config → Inverters',
      tab: 'config',
    },
    {
      key: 'roofPitch',
      label: 'Roof Pitch',
      ok: !!(config.roofPitch && config.roofPitch > 0),
      value: config.roofPitch ? `${Math.round(config.roofPitch * 12 / 90 * 12)}:12 (${config.roofPitch}°)` : undefined,
      fix: 'Set roof pitch in System Config → Structural',
      tab: 'config',
    },
    {
      key: 'rafterSize',
      label: 'Rafter Size',
      ok: !!(config.rafterSize),
      value: config.rafterSize || undefined,
      fix: 'Set rafter size in System Config → Structural',
      tab: 'config',
    },
    {
      key: 'windSpeed',
      label: 'Design Wind Speed',
      ok: !!(config.windSpeed && config.windSpeed > 0),
      value: config.windSpeed ? `${config.windSpeed} mph` : undefined,
      fix: 'Set wind speed in System Config → Structural',
      tab: 'config',
    },
    {
      key: 'mainPanel',
      label: 'Main Panel Rating',
      ok: !!(config.mainPanelAmps && config.mainPanelAmps > 0),
      value: config.mainPanelAmps ? `${config.mainPanelAmps}A` : undefined,
      fix: 'Set main panel amperage in System Config → Electrical',
      tab: 'config',
    },
    {
      key: 'compliance',
      label: 'Compliance Check Run',
      ok: !!(compliance.overallStatus),
      value: compliance.overallStatus || undefined,
      fix: 'Run compliance check in the Compliance tab',
      tab: 'compliance',
    },
  ];
  const permitReadyCount  = permitReadiness.filter(r => r.ok).length;
  const permitTotalCount  = permitReadiness.length;
  const permitIsReady     = permitReadyCount === permitTotalCount;
  const permitPct         = Math.round((permitReadyCount / permitTotalCount) * 100);

  // Per-tab feature gating
  const { can, loading: subLoading } = useSubscription();
  // While loading, grant access to avoid flash-of-locked-content for paid/free-pass users
  const canSLD    = subLoading ? true : can('engineering');
  const canPermit = subLoading ? true : can('permitPackets');
  const canBOM    = subLoading ? true : can('bom');

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'config',     label: 'System Config',      icon: <Settings size={14} /> },
    { id: 'compliance', label: 'Compliance',          icon: <ClipboardCheck size={14} /> },
    { id: 'electrical', label: 'Electrical Sizing',   icon: <Activity size={14} /> },
    { id: 'diagram',    label: 'Single-Line Diagram', icon: <Zap size={14} /> },
    { id: 'schedule',   label: 'Equipment Schedule',  icon: <FileText size={14} /> },
    { id: 'structural', label: 'Structural',          icon: <Wrench size={14} /> },
    { id: 'mounting',   label: 'Mounting Details',    icon: <Home size={14} /> },
    { id: 'permit',     label: 'Permit Package',      icon: <Stamp size={14} /> },
    { id: 'bom',        label: 'Bill of Materials',    icon: <Grid size={14} /> },
    { id: 'files',      label: 'Client Files',          icon: <FolderOpen size={14} /> },
  ];

    const ComplianceSummaryBar = () => {
      const overallStatus = (() => {
        const a = compliance.overallStatus;
        const b = rulesResult?.overallStatus;
        if (!a && !b) return null;
        if (a === 'FAIL' || b === 'FAIL') return 'FAIL';
        if (a === 'WARNING' || b === 'WARNING') return 'WARNING';
        return a || b || 'PASS';
      })();
      const segCls = (s: string | null | undefined) => {
        if (s === 'FAIL') return 'fail';
        if (s === 'WARNING') return 'warn';
        if (s === 'PASS') return 'pass';
        return '';
      };
      return (
        <div className="compliance-rail">
          {/* Overall segment */}
          <div className={`compliance-segment ${segCls(overallStatus)}`}>
            <span className="compliance-segment-label">Overall</span>
            <span className="compliance-segment-value">
              {overallStatus ?? <span style={{color:'rgba(148,163,184,0.4)'}}>—</span>}
            </span>
            {overallStatus === 'FAIL' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
            {overallStatus === 'WARNING' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />}
          </div>

          {/* Electrical segment */}
          <div className={`compliance-segment ${segCls(compliance.electrical?.status)}`}>
            <span className="compliance-segment-label">Elec</span>
            <span className="compliance-segment-value">
              {compliance.electrical?.status ?? <span style={{color:'rgba(148,163,184,0.4)'}}>—</span>}
            </span>
          </div>

          {/* Structural segment */}
          <div className={`compliance-segment ${segCls(compliance.structural?.status)}`}>
            <span className="compliance-segment-label">Struct</span>
            <span className="compliance-segment-value">
              {compliance.structural?.status ?? <span style={{color:'rgba(148,163,184,0.4)'}}>—</span>}
            </span>
          </div>

          {/* Rules engine counts */}
          {rulesResult && (
            <div className="compliance-segment">
              {rulesResult.errorCount > 0 && (
                <span className="text-[11px] font-bold text-red-400 tabular-nums">
                  {rulesResult.errorCount}E
                </span>
              )}
              {rulesResult.warningCount > 0 && (
                <span className="text-[11px] font-bold text-amber-400 tabular-nums ml-1">
                  {rulesResult.warningCount}W
                </span>
              )}
              {rulesResult.autoFixCount > 0 && (
                <span className="text-[11px] text-emerald-400 tabular-nums ml-1">
                  {rulesResult.autoFixCount} fixed
                </span>
              )}
              {overrides.length > 0 && (
                <span className="text-[11px] text-blue-400 ml-1">
                  {overrides.length} ovr
                </span>
              )}
              {rulesResult.errorCount === 0 && rulesResult.warningCount === 0 && (
                <span className="compliance-segment-value pass">✓ Clean</span>
              )}
            </div>
          )}

          {/* Jurisdiction segment */}
          {compliance.jurisdiction && (
            <div className="compliance-segment">
              <MapPin size={10} className="text-amber-400/70 flex-shrink-0" />
              <span className="compliance-segment-label">{compliance.jurisdiction.state}</span>
              <span className="text-[11px] text-slate-400 font-mono">NEC {compliance.jurisdiction.necVersion}</span>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Config dirty indicator */}
          {configDirty && !calculating && (
            <div className="compliance-segment">
              <AlertCircle size={10} className="text-amber-400/70" />
              <span className="text-[11px] text-amber-400/70 font-semibold">Unsaved</span>
            </div>
          )}

          {/* Calculating / Recalculate */}
          {calculating ? (
            <div className="compliance-segment">
              <RefreshCw size={10} className="animate-spin text-blue-400" />
              <span className="text-[11px] text-blue-400">Running…</span>
            </div>
          ) : (
            <button
              onClick={runCalc}
              className="compliance-segment hover:bg-white/5 transition-colors cursor-pointer"
            >
              <RefreshCw size={10} className="text-slate-500" />
              <span className="text-[11px] text-slate-400 hover:text-white transition-colors">Recalc</span>
            </button>
          )}
        </div>
      );
    };


  return (
    <AppShell>
      <PlanGate feature="engineering">
      <div className="flex flex-col h-full">
        {/* ═══════════════════════════════════════════════════════════════
           ENGINEERING COMMAND BAR — sticky glassy header v50.0
      ═══════════════════════════════════════════════════════════════ */}
      <div className="flex-shrink-0 sticky top-0 z-30">

        {/* ── Top bar: project identity + live KPIs + action buttons ── */}
        <div className="relative flex items-center gap-4 px-6 py-3 bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/60 shadow-lg shadow-black/30">
          {/* Accent stripe */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />

          {/* Left: project name + kW badge */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex-shrink-0">
              <Zap size={16} className="text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white truncate max-w-[220px]">
                  {config.projectName || 'Engineering Schematics'}
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 whitespace-nowrap">
                  {totalKw} kW DC
                </span>
                {totalInverterKw && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/80 text-slate-300 border border-slate-600/50 whitespace-nowrap">
                    {totalInverterKw} kW AC
                  </span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 font-mono border border-slate-700/50">
                  {BUILD_VERSION}
                </span>
              </div>
              {config.address && (
                <div className="flex items-center gap-1 mt-0.5">
                  <MapPin size={10} className="text-slate-500 flex-shrink-0" />
                  <span className="text-xs text-slate-500 truncate max-w-[280px]">{config.address}</span>
                </div>
              )}
            </div>
          </div>

          {/* Center: live status chips */}
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            {/* Compliance chip */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all ${
              (() => {
                const s = compliance.overallStatus || rulesResult?.overallStatus;
                if (s === 'FAIL') return 'bg-red-500/15 border-red-500/40 text-red-400';
                if (s === 'WARNING') return 'bg-amber-500/15 border-amber-500/40 text-amber-400';
                if (s === 'PASS') return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400';
                return 'bg-slate-800/80 border-slate-700/50 text-slate-500';
              })()
            }`}>
              <ClipboardCheck size={12} />
              {(() => {
                const s = compliance.overallStatus || rulesResult?.overallStatus;
                if (s === 'FAIL') return <><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> FAIL</>;
                if (s === 'WARNING') return <><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> WARN</>;
                if (s === 'PASS') return <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> PASS</>;
                return 'Compliance';
              })()}
            </div>

            {/* BOM cost chip */}
            {bomPricing && bomPricing.pricingApplied && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-semibold text-emerald-400">
                <DollarSign size={12} />
                ${bomPricing.totalBomCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            )}

            {/* NEC version chip */}
            {compliance.jurisdiction && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-600/50 bg-slate-800/60 text-xs text-slate-400">
                <FileText size={11} />
                NEC {compliance.jurisdiction.necVersion}
              </div>
            )}

            {/* Rules engine summary */}
            {rulesResult && (rulesResult.errorCount > 0 || rulesResult.warningCount > 0) && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-xs">
                {rulesResult.errorCount > 0 && <span className="text-red-400 font-bold">{rulesResult.errorCount}E</span>}
                {rulesResult.warningCount > 0 && <span className="text-amber-400 font-bold">{rulesResult.warningCount}W</span>}
                {rulesResult.autoFixCount > 0 && <span className="text-emerald-400">{rulesResult.autoFixCount} fixed</span>}
              </div>
            )}

            {/* Dirty / calculating indicator */}
            {calculating && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-blue-500/30 bg-blue-500/10 text-xs text-blue-400">
                <RefreshCw size={11} className="animate-spin" /> Running…
              </div>
            )}
            {configDirty && !calculating && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-400">
                <AlertCircle size={11} /> Unsaved
              </div>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* AUTO / MANUAL toggle */}
            <div className="flex items-center gap-0.5 bg-slate-800/80 border border-slate-700/60 rounded-lg p-0.5">
              <button
                onClick={() => setEngineeringMode('AUTO')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${engineeringMode === 'AUTO' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-400 hover:text-white'}`}
                title="Auto-resolve violations"
              >AUTO</button>
              <button
                onClick={() => setEngineeringMode('MANUAL')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${engineeringMode === 'MANUAL' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:text-white'}`}
                title="Manual override mode"
              >MAN</button>
            </div>

            <button
              onClick={runCalc}
              disabled={calculating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs font-semibold text-slate-300 hover:text-white hover:border-amber-500/50 hover:bg-amber-500/10 transition-all disabled:opacity-50"
              title="Run compliance check"
            >
              <RefreshCw size={13} className={calculating ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{calculating ? 'Running…' : 'Check'}</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs font-semibold text-slate-300 hover:text-white hover:border-blue-500/50 hover:bg-blue-500/10 transition-all"
              title="Print / Export PDF"
            >
              <Printer size={13} />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>

        {/* ── Compliance summary sub-bar ── */}
        <ComplianceSummaryBar />
      </div>

      {/* ── Reverse hydration banner ── */}
      {fileHydrationBanner && (
        <div className={`flex items-start gap-3 px-6 py-3 text-sm flex-shrink-0 border-b ${
          fileHydrationBanner.startsWith('⚠️')
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        }`}>
          <span className="flex-1">{fileHydrationBanner}</span>
          <button
            onClick={() => setFileHydrationBanner(null)}
            className="text-slate-400 hover:text-white ml-2 flex-shrink-0"
            title="Dismiss"
          >
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* ── Project Selector: shown when no projectId in URL ── */}
      {!currentProjectId && (
        <div className="bg-slate-900/80 border-b border-slate-700/50 px-6 py-4 flex-shrink-0">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-3">
              <FolderOpen size={18} className="text-amber-400" />
              <h2 className="text-sm font-semibold text-white">Select a Project to Open in Engineering</h2>
            </div>
            {selectorLoading ? (
              <div className="text-slate-400 text-sm">Loading projects...</div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search projects or clients..."
                  value={selectorSearch}
                  onChange={e => { setSelectorSearch(e.target.value); setSelectorOpen(true); }}
                  onFocus={() => setSelectorOpen(true)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl pl-3 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                />
                {selectorOpen && selectorProjects.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900/95 border border-amber-500/20 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden max-h-72 overflow-y-auto backdrop-blur-xl">
                    {selectorProjects
                      .filter(p => {
                        if (!selectorSearch) return true;
                        const q = selectorSearch.toLowerCase();
                        return (
                          p.name.toLowerCase().includes(q) ||
                          (p.client?.name || '').toLowerCase().includes(q) ||
                          (p.address || '').toLowerCase().includes(q)
                        );
                      })
                      .slice(0, 20)
                      .map(p => (
                        <button
                          key={p.id}
                          className="w-full text-left px-4 py-3 hover:bg-slate-700/60 transition-colors border-b border-slate-700/40 last:border-0 flex items-center justify-between gap-3"
                          onMouseDown={e => {
                            e.preventDefault();
                            setSelectorOpen(false);
                            router.push(`/engineering?projectId=${p.id}`);
                          }}
                        >
                          <div>
                            <div className="text-sm font-medium text-white">{p.name}</div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {p.client?.name && <span className="mr-2">👤 {p.client.name}</span>}
                              {p.address && <span>{p.address}</span>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            {p.systemSizeKw ? (
                              <span className="text-xs text-amber-400 font-bold">{p.systemSizeKw} kW</span>
                            ) : null}
                          </div>
                        </button>
                      ))}
                    {selectorProjects.filter(p => {
                      if (!selectorSearch) return true;
                      const q = selectorSearch.toLowerCase();
                      return p.name.toLowerCase().includes(q) || (p.client?.name || '').toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q);
                    }).length === 0 && (
                      <div className="px-4 py-3 text-slate-500 text-sm">No projects match your search.</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {!selectorLoading && selectorProjects.length === 0 && (
              <p className="text-slate-500 text-sm mt-1">No projects found. <a href="/projects/new" className="text-amber-400 hover:text-amber-300">Create one →</a></p>
            )}
          </div>
        </div>
      )}

      {/* ── Topology change banner (v57.5) ── */}
      {showTopologyBanner && topologyChangeLog.length > 0 && (
        <div className="flex items-start gap-3 px-6 py-3 text-sm bg-amber-500/10 border-b border-amber-500/30 text-amber-300 flex-shrink-0">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold">Topology changed: </span>
            {(() => {
              const last = topologyChangeLog[topologyChangeLog.length - 1];
              const topoLabel = (t: string) => t === 'STRING_OPTIMIZER' ? 'String + Optimizer' : t === 'MICRO' ? 'Microinverter' : 'String';
              return (
                <span>
                  {topoLabel(last.from)} → <span className="font-bold text-amber-200">{topoLabel(last.to)}</span>
                  <span className="text-amber-500 text-xs ml-2">at {last.at}</span>
                  <span className="text-amber-600 text-xs ml-2">— re-run compliance to update results</span>
                </span>
              );
            })()}
          </div>
          <button onClick={() => setShowTopologyBanner(false)} className="text-slate-400 hover:text-white ml-2 flex-shrink-0" title="Dismiss">
            <XCircle size={16} />
          </button>
        </div>
      )}

     {/* ── Auto-load banner ── */}
      {autoLoadBanner && !fileHydrationBanner && (
        <div className="flex items-start gap-3 px-6 py-3 text-sm bg-blue-500/10 border-b border-blue-500/30 text-blue-300 flex-shrink-0">
          <span className="flex-1">{autoLoadBanner}</span>
          <button
            onClick={() => setAutoLoadBanner(null)}
            className="text-slate-400 hover:text-white ml-2 flex-shrink-0"
            title="Dismiss"
          >
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="flex gap-0 px-4 bg-slate-900/70 backdrop-blur-md border-b border-slate-700/50 flex-shrink-0 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700">
        {tabs.map((tab, idx) => {
          const isLocked =
            (tab.id === 'diagram' && !canSLD) ||
            (tab.id === 'permit'  && !canPermit) ||
            (tab.id === 'bom'     && !canBOM);
          const isActive = activeTab === tab.id;
          const complianceStatus = compliance.overallStatus || rulesResult?.overallStatus;
          return (
            <button
              key={tab.id}
              onClick={() => !isLocked && setActiveTab(tab.id)}
              title={isLocked ? 'Upgrade to unlock' : `${tab.label} (${idx + 1})`}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-all whitespace-nowrap group select-none ${
                isActive
                  ? 'text-amber-400'
                  : isLocked
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {/* Active glow underline */}
              {isActive && (
                <span className="absolute bottom-0 inset-x-2 h-0.5 bg-amber-400 rounded-full shadow-[0_0_8px_2px_rgba(251,191,36,0.5)]" />
              )}
              {/* Hover underline */}
              {!isActive && !isLocked && (
                <span className="absolute bottom-0 inset-x-2 h-0.5 bg-slate-600 rounded-full scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
              )}

              <span className={`transition-colors ${isActive ? 'text-amber-400' : 'text-current'}`}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>

              {/* Keyboard hint */}
              <span className={`ml-0.5 text-[9px] font-mono opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'text-amber-400/60' : 'text-slate-600'}`}>
                {idx < 9 ? idx + 1 : '0'}
              </span>

              {/* Lock badge */}
              {isLocked && <Lock size={9} className="text-slate-600 ml-0.5" />}

              {/* Compliance dot */}
              {tab.id === 'compliance' && complianceStatus === 'FAIL' && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_4px_1px_rgba(239,68,68,0.7)] animate-pulse ml-0.5" />
              )}
              {tab.id === 'compliance' && complianceStatus === 'WARNING' && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_4px_1px_rgba(245,158,11,0.7)] animate-pulse ml-0.5" />
              )}
              {tab.id === 'compliance' && configDirty && !calculating && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 ml-0.5 animate-pulse" />
              )}

              {/* BOM cost dot when priced */}
              {tab.id === 'bom' && bomPricing?.pricingApplied && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_1px_rgba(16,185,129,0.5)] ml-0.5" />
              )}
            </button>
          );
        })}
      </div>

        {/* Content + Intelligence Panel */}
        <div className="flex flex-1 overflow-hidden">

        {/* Main Tab Content */}
        <div className="flex-1 overflow-y-auto p-6" ref={printRef}>

          {/* ── CONFIG TAB ── */}
          {activeTab === 'config' && (() => {
            /* ═══════════════════════════════════════════════════════════
               CONFIG V2 UI  —  v55.0
               Feature flag: ENABLE_CONFIG_V2_UI
               All state hooks / handlers unchanged. Layout only.
            ═══════════════════════════════════════════════════════════ */
            const ENABLE_CONFIG_V2_UI = true;

            /* ── Derived UI-only values (no backend effect) ── */
            const _inv0       = config.inverters[0];
            const _invData0   = getInvById(_inv0?.inverterId ?? '', _inv0?.type ?? 'string') as any;
            const _panel0     = getPanelById(_inv0?.strings[0]?.panelId ?? '') as any;
            const _totalKwNum = parseFloat(totalKw) || 0;
            // v58.0: use canonicalAcKw (component-scope, prefers sizingRecommendation)
            const _acKwNum = canonicalAcKw;
            const _dcAcRatio  = _acKwNum > 0 ? calcDcAcRatio(_totalKwNum, _acKwNum).toFixed(2) : '—';
            // String/branch count: prefer sizing recommendation strings when available.
            const _recStringCount = sizingRecommendation && !cs.isMicro
              ? sizingRecommendation.strings.length
              : 0;
            const _branchCount = cs.isMicro ? cs.acBranchCount
              : _recStringCount > 0 ? _recStringCount
              : config.inverters.reduce((s, i) => s + i.strings.length, 0);
            const _genData    = config.generatorId ? getGeneratorById(config.generatorId) : null;
            const _atsData    = config.atsId ? getATSById(config.atsId) : null;
            const _batData    = config.batteryId ? getBatteryById(config.batteryId) : null;
            const _batTotalKwh = config.batteryCount * config.batteryKwh;
            /* Backup % estimate: battery kWh / (system kW * 4h avg load) — UI only */
            const _backupPct  = _batTotalKwh > 0 && _totalKwNum > 0
              ? Math.min(100, Math.round((_batTotalKwh / Math.max(1, _totalKwNum * 0.3)) * 100))
              : 0;
            const _compStatus = compliance.overallStatus || rulesResult?.overallStatus;
            const _elecStatus = compliance.electrical?.status;
            const _structStatus = compliance.structural?.status;

            /* ── Color helpers ── */
            const statusGlow = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'border-red-500/50 bg-red-500/10 text-red-400';
              if (s === 'WARNING') return 'border-amber-500/50 bg-amber-500/10 text-amber-400';
              if (s === 'PASS')    return 'border-emerald-500/40 bg-emerald-500/8 text-emerald-400';
              return 'border-slate-700/50 bg-slate-800/40 text-slate-500';
            };
            const statusDot = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.5)]';
              if (s === 'WARNING') return 'bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)]';
              if (s === 'PASS')    return 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]';
              return 'bg-slate-600';
            };
            const statusText = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'text-red-400';
              if (s === 'WARNING') return 'text-amber-400';
              if (s === 'PASS')    return 'text-emerald-400';
              return 'text-slate-500';
            };

            if (!ENABLE_CONFIG_V2_UI) {
              /* ── LEGACY FALLBACK ── */
              return (
                <div className="space-y-6 max-w-5xl">
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs">
                    Config V2 UI disabled via ENABLE_CONFIG_V2_UI flag. Re-enable in build_config_v2.py.
                  </div>
                </div>
              );
            }

            return (
              <div className="space-y-5 max-w-none">

                {/* ══ SYSTEM FLOW BAR ══════════════════════════════════════════ */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

                  {/* Header */}
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <Zap size={16} className="text-amber-400" />
                        System Overview
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">{config.address || 'No address set'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold">
                        V3 · Permit-Grade
                      </span>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                        engineeringMode === 'AUTO'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}>
                        {engineeringMode}
                      </span>
                    </div>
                  </div>

                  {/* KPI row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-4 py-3 text-center">
                      <div className="text-2xl font-black text-amber-400 tabular-nums">{totalKw}</div>
                      <div className="text-xs text-slate-500 mt-0.5">kW DC</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-4 py-3 text-center">
                      <div className="text-2xl font-black text-blue-400 tabular-nums">{totalInverterKw || '—'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">kW AC</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-4 py-3 text-center">
                      <div className="text-2xl font-black text-emerald-400 tabular-nums">{totalPanels}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Panels</div>
                    </div>
                    <div className={`rounded-xl border px-4 py-3 text-center ${
                      bomPricing?.pricingApplied
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-slate-900/60 border-slate-700/50'
                    }`}>
                      <div className={`text-2xl font-black tabular-nums ${bomPricing?.pricingApplied ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {bomPricing?.pricingApplied
                          ? `$${(bomPricing.totalBomCost / 1000).toFixed(1)}k`
                          : '—'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">BOM Cost</div>
                    </div>
                  </div>

                  {/* ── SYSTEM FLOW DIAGRAM ── */}
                  <div className="overflow-x-auto pb-1">
                    <div className="flex items-center gap-0 min-w-max">
                      {/* Node: Array */}
                      <div className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer hover:brightness-110 transition-all min-w-[90px] ${statusGlow(_structStatus)}`}
                        title="Solar Array — click to go to Inverter config">
                        <Sun size={18} className="text-amber-400" />
                        <div className="text-xs font-bold text-white">{totalPanels} Panels</div>
                        <div className="text-[10px] text-slate-400">{totalKw} kW DC</div>
                        <div className={`text-[9px] font-bold uppercase tracking-wide ${statusText(_structStatus)}`}>
                          {_structStatus || 'Struct'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center px-1">
                        <div className="flex items-center gap-0.5">
                          <div className="w-6 h-0.5 bg-amber-500/40" />
                          <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-amber-500/60" />
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">DC</div>
                      </div>

                      {/* Node: Inverter */}
                      <div className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer hover:brightness-110 transition-all min-w-[90px] ${
                        _inv0?.type === 'micro' ? 'border-purple-500/40 bg-purple-500/10 text-purple-300' :
                        _inv0?.type === 'optimizer' ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' :
                        'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      }`}
                        title="Inverter — click to expand Inverter config">
                        <Cpu size={18} className={
                          _inv0?.type === 'micro' ? 'text-purple-400' :
                          _inv0?.type === 'optimizer' ? 'text-blue-400' : 'text-amber-400'
                        } />
                        <div className="text-xs font-bold text-white truncate max-w-[80px] text-center">
                          {_invData0?.manufacturer || 'Inverter'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {_inv0?.type === 'micro' ? 'Micro' : _inv0?.type === 'optimizer' ? 'Optimizer' : 'String'}{' '}
                          {_acKwNum > 0 ? `${_acKwNum}kW` : ''}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                          {_branchCount} {cs.isMicro ? 'branches' : 'strings'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center px-1">
                        <div className="flex items-center gap-0.5">
                          <div className="w-6 h-0.5 bg-blue-500/40" />
                          <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-blue-500/60" />
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">AC</div>
                      </div>

                      {/* Node: AC Run */}
                      <div className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer hover:brightness-110 transition-all min-w-[90px] ${statusGlow(_elecStatus)}`}
                        title="AC Wiring Run — click to expand Electrical Service">
                        <Activity size={18} className={_elecStatus === 'FAIL' ? 'text-red-400' : _elecStatus === 'WARNING' ? 'text-amber-400' : 'text-blue-400'} />
                        <div className="text-xs font-bold text-white">AC Run</div>
                        <div className="text-[10px] text-slate-400">
                          {(() => {
                            const acRun = cs.runs.find((r: any) => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
                            return acRun?.wireGauge || config.wireGauge || '—';
                          })()}
                          {' · '}{config.wireLength}ft
                        </div>
                        <div className={`text-[9px] font-bold uppercase tracking-wide ${statusText(_elecStatus)}`}>
                          {_elecStatus || 'Elec'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center px-1">
                        <div className="flex items-center gap-0.5">
                          <div className="w-6 h-0.5 bg-blue-500/40" />
                          <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-blue-500/60" />
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">AC</div>
                      </div>

                      {/* Node: Disconnect */}
                      <div className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer hover:brightness-110 transition-all min-w-[90px] ${
                        config.acDisconnect ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-300' : 'border-slate-700/50 bg-slate-800/40 text-slate-500'
                      }`}
                        title="AC Disconnect (NEC 690.14)">
                        <Power size={18} className={config.acDisconnect ? 'text-emerald-400' : 'text-slate-600'} />
                        <div className="text-xs font-bold text-white">Disconnect</div>
                        <div className="text-[10px] text-slate-400">NEC 690.14</div>
                        <div className={`text-[9px] font-bold uppercase tracking-wide ${config.acDisconnect ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {config.acDisconnect ? 'Installed' : 'Not Set'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center px-1">
                        <div className="flex items-center gap-0.5">
                          <div className="w-6 h-0.5 bg-blue-500/40" />
                          <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-blue-500/60" />
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">AC</div>
                      </div>

                      {/* Node: Main Panel */}
                      <div className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border border-blue-500/40 bg-blue-500/10 cursor-pointer hover:brightness-110 transition-all min-w-[90px]"
                        title="Main Service Panel — click to expand Electrical Service">
                        <Home size={18} className="text-blue-400" />
                        <div className="text-xs font-bold text-white">Main Panel</div>
                        <div className="text-[10px] text-slate-400">{config.mainPanelAmps}A · {config.mainPanelBrand || '—'}</div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-blue-400">
                          {(() => {
                            const backfeed = cs.backfeedBreakerAmps || 0;
                            const busRating = config.mainPanelAmps * 1.2;
                            const load = backfeed;
                            if (load > busRating) return 'OVERLOADED';
                            if (backfeed > 0) return `${backfeed}A BF`;
                            return 'Service';
                          })()}
                        </div>
                      </div>

                      {/* Battery (if enabled) */}
                      {config.batteryCount > 0 && _batTotalKwh > 0 && (
                        <>
                          <div className="flex flex-col items-center px-1">
                            <div className="flex items-center gap-0.5">
                              <div className="w-4 h-0.5 bg-emerald-500/40" />
                              <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-emerald-500/60" />
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/8 min-w-[90px]">
                            <Battery size={18} className="text-emerald-400" />
                            <div className="text-xs font-bold text-white">Battery</div>
                            <div className="text-[10px] text-slate-400">{_batTotalKwh.toFixed(1)} kWh</div>
                            <div className="text-[9px] font-bold text-emerald-400">{_backupPct}% est.</div>
                          </div>
                        </>
                      )}

                      {/* Generator (if set) */}
                      {_genData && (
                        <>
                          <div className="flex flex-col items-center px-1">
                            <div className="flex items-center gap-0.5">
                              <div className="w-4 h-0.5 bg-orange-500/40" />
                              <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-orange-500/60" />
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border border-orange-500/40 bg-orange-500/8 min-w-[90px]">
                            <Wrench size={18} className="text-orange-400" />
                            <div className="text-xs font-bold text-white">Generator</div>
                            <div className="text-[10px] text-slate-400">{_genData.ratedOutputKw}kW</div>
                            <div className="text-[9px] font-bold text-orange-400 uppercase">{_genData.fuelType?.replace('_', ' ')}</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status chips row */}
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-700/30">
                    <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium ${statusGlow(_compStatus)}`}>
                      <ClipboardCheck size={11} />
                      {_compStatus || 'Not checked'}
                    </div>
                    {compliance.jurisdiction && (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                        <MapPin size={11} className="text-amber-400" />
                        {compliance.jurisdiction.state} · NEC {compliance.jurisdiction.necVersion}
                      </div>
                    )}
                    {config.systemType && (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                        <Cpu size={11} className="text-blue-400" />
                        {config.systemType}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                      <Activity size={11} />
                      DC/AC: {_dcAcRatio}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                      <GitBranch size={11} />
                      {_branchCount} {cs.isMicro ? 'AC Branches' : 'Strings'}
                    </div>
                    {rulesResult && rulesResult.errorCount === 0 && rulesResult.warningCount === 0 && (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                        <CheckCircle size={11} /> All rules passed
                      </div>
                    )}
                    {rulesResult && rulesResult.errorCount > 0 && (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
                        <AlertTriangle size={11} /> {rulesResult.errorCount} error{rulesResult.errorCount > 1 ? 's' : ''}
                      </div>
                    )}
                    {engineeringMode === 'AUTO' ? (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                        <Activity size={11} /> ⚡ Auto-resolves violations
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                        <Lock size={11} /> ✏️ Manual override mode
                      </div>
                    )}
                  </div>
                </div>

                {/* ══ 3-COLUMN RESPONSIVE GRID ═══════════════════════════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">

                  {/* ─────────────────────────────────────────────────────────
                      LEFT COLUMN: Project Info + Electrical
                  ──────────────────────────────────────────────────────────── */}
                  <div className="space-y-5">

                    {/* Project Information */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight">
                        <FileText size={14} className="text-amber-400" /> Project Information
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { label: 'Project Name', key: 'projectName' },
                          { label: 'Client Name', key: 'clientName' },
                          { label: 'Address', key: 'address', placeholder: 'e.g. 123 Main St, Austin, TX 78701' },
                          { label: 'Designer', key: 'designer' },
                          { label: 'Date', key: 'date', type: 'date' },
                        ] as any[]).map(f => (
                          <div key={f.key} className={f.key === 'address' ? 'col-span-2' : ''}>
                            <label className="eng-label">{f.label}</label>
                            <input type={f.type || 'text'} value={(config as any)[f.key]} placeholder={f.placeholder || ''}
                              onChange={e => updateConfig({ [f.key]: e.target.value } as any)}
                              onBlur={f.key === 'address' ? (e) => {
                                const addr = e.target.value;
                                if (!addr) return;
                                const detectedState = parseStateFromAddress(addr);
                                const detectedCity = parseCityFromAddress(addr);
                                if (detectedState && !config.state) {
                                  const updates: any = { state: detectedState };
                                  if (detectedCity && !config.city) updates.city = detectedCity;
                                  const utils = getUtilitiesByStateNational(detectedState);
                                  if (utils.length > 0 && !config.utilityId) {
                                    updates.utilityId = utils[0].id;
                                  }
                                  updateConfig(updates);
                                }
                              } : undefined}
                              className="eng-input" />
                          </div>
                        ))}

                        {/* State selector */}
                        <div>
                          <label className="eng-label flex items-center gap-2">
                            State
                            {config.state && config.address && parseStateFromAddress(config.address) === config.state && (
                              <span className="text-emerald-400 text-xs font-normal">✓ auto-detected</span>
                            )}
                          </label>
                          <select value={config.state} onChange={e => {
                            const newState = e.target.value;
                            const updates: any = { state: newState, utilityId: '' };
                            const utils = getUtilitiesByStateNational(newState);
                            if (utils.length > 0) updates.utilityId = utils[0].id;
                            updateConfig(updates);
                          }} className="eng-select">
                            <option value="">— Select State —</option>
                            {[
                              ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],
                              ['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],
                              ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],
                              ['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],
                              ['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
                              ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],
                              ['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
                              ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
                              ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],
                              ['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
                              ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
                              ['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],
                              ['WI','Wisconsin'],['WY','Wyoming'],['DC','District of Columbia'],
                            ].map(([code, name]) => (
                              <option key={code} value={code}>{name} ({code})</option>
                            ))}
                          </select>
                        </div>

                        {/* Roof Type */}
                        <div>
                          <label className="eng-label">Roof Type</label>
                          <select value={config.roofType} onChange={e => updateConfig({ roofType: e.target.value as RoofType })}
                            className="eng-select">
                            {Object.entries(ROOF_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        </div>

                        {/* City + County */}
                        <div>
                          <label className="eng-label">City</label>
                          <input type="text" value={config.city || ''} onChange={e => updateConfig({ city: e.target.value })}
                            placeholder="e.g. Austin" className="eng-input" />
                        </div>
                        <div>
                          <label className="eng-label">County</label>
                          <input type="text" value={config.county || ''} onChange={e => updateConfig({ county: e.target.value })}
                            placeholder="e.g. Travis" className="eng-input" />
                        </div>
                      </div>

                      {/* AHJ Auto-detect banner */}
                      {ahjInfo && (
                        <div className="mt-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <MapPin size={12} className="text-amber-400" />
                            <span className="text-xs font-bold text-amber-400">{ahjInfo.ahjName}</span>
                            <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">{ahjInfo.necVersion}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-slate-500">Permit Fee:</span><span className="text-slate-300 ml-1">{ahjInfo.typicalPermitFee}</span></div>
                            <div><span className="text-slate-500">Days:</span><span className="text-slate-300 ml-1">{ahjInfo.typicalPermitDays}d</span></div>
                            <div><span className="text-slate-500">Rapid Shutdown:</span><span className={`ml-1 ${ahjInfo.rapidShutdownRequired ? 'text-amber-400' : 'text-emerald-400'}`}>{ahjInfo.rapidShutdownRequired ? 'Required' : 'Not Req.'}</span></div>
                            <div><span className="text-slate-500">Roof Setback:</span><span className="text-slate-300 ml-1">{ahjInfo.roofSetbackInches}"</span></div>
                          </div>
                        </div>
                      )}

                      {/* Utility + AHJ selectors */}
                      <div className="grid grid-cols-1 gap-3 mt-3">
                        <div>
                          <label className="eng-label">Utility Provider</label>
                          <select value={config.utilityId} onChange={e => updateConfig({ utilityId: e.target.value })} className="eng-select">
                            <option value="">— Manual / Unknown —</option>
                            {config.state && getUtilitiesByStateNational(config.state).map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                            {!config.state && getUtilitiesByState('').map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                          {config.utilityId && config.state && (() => {
                            const stateData = STATE_UTILITY_FALLBACK[config.state];
                            if (!stateData) return null;
                            return (
                              <div className="text-xs text-slate-400 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                                <span><span className="text-slate-500">Rate:</span> <span className="text-amber-400 font-medium">${stateData.avgRate.toFixed(3)}/kWh</span></span>
                                <span><span className="text-slate-500">NEM:</span> <span className={stateData.netMetering ? 'text-emerald-400' : 'text-red-400'}>{stateData.netMetering ? '✓ Eligible' : '✗ N/A'}</span></span>
                                <span className="text-slate-500">Max: {stateData.interconnectionMaxKw}kW</span>
                              </div>
                            );
                          })()}
                        </div>
                        <div>
                          <label className="eng-label">Authority Having Jurisdiction (AHJ)</label>
                          <select value={config.ahjId} onChange={e => updateConfig({ ahjId: e.target.value })} className="eng-select">
                            <option value="">— Manual / Unknown —</option>
                            {getAhjsByState(config.state || '').map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                          {config.ahjId && (
                            <div className="text-xs text-slate-500 mt-1">
                              {(() => {
                                const ahjs = getAhjsByState(config.state || '');
                                const a = ahjs.find(x => x.id === config.ahjId);
                                return a ? a.notes : '';
                              })()}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Jurisdiction strip */}
                      {compliance.jurisdiction && (
                        <div className="mt-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-start gap-3">
                          <MapPin size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-bold text-amber-400">{compliance.jurisdiction.state} — NEC {compliance.jurisdiction.necVersion} ({compliance.jurisdiction.necAdoptionYear})</div>
                            <div className="text-xs text-slate-400 mt-0.5">{compliance.jurisdiction.ahj}</div>
                            {compliance.jurisdiction.specialRequirements?.slice(0, 2).map((r: string, i: number) => (
                              <div key={i} className="text-xs text-slate-500 mt-0.5">• {r}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Section 1: Main Service Panel ───────────────────────────── */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-3 flex items-center gap-2 tracking-tight">
                        <Shield size={14} className="text-amber-400" /> Main Service Panel
                        <span className="ml-1 text-[10px] font-normal text-slate-500 normal-case tracking-normal">NEC 705.12(B) load-side interconnection</span>
                      </h3>

                      {/* MSP summary strip */}
                      <div className="flex flex-wrap gap-2 mb-3 p-2.5 rounded-lg bg-slate-900/50 border border-slate-700/40">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Main:</span>
                          <span className="text-amber-400 font-bold">{config.mainPanelAmps}A</span>
                          <span className="text-slate-500">{config.mainPanelBrand}</span>
                        </div>
                        <span className="text-slate-700">·</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Bus:</span>
                          <span className="text-blue-400 font-bold">{config.panelBusRating ?? config.mainPanelAmps}A</span>
                        </div>
                        <span className="text-slate-700">·</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Method:</span>
                          <span className="text-emerald-400 font-bold text-[10px]">
                            {(() => {
                              const m = config.interconnectionMethod ?? 'LOAD_SIDE';
                              if (m === 'LOAD_SIDE') return 'Load-Side Tap';
                              if (m === 'SUPPLY_SIDE_TAP') return 'Supply-Side Tap';
                              if (m === 'MAIN_BREAKER_DERATE') return 'Main Derate';
                              if (m === 'PANEL_UPGRADE') return 'Panel Upgrade';
                              return m;
                            })()}
                          </span>
                        </div>
                        {/* 120% rule indicator */}
                        {(() => {
                          const busRating = config.panelBusRating ?? config.mainPanelAmps ?? 200;
                          const mainAmps = config.mainPanelAmps ?? 200;
                          const maxPV = Math.floor(busRating * 1.2 - mainAmps);
                          return maxPV > 0 ? (
                            <>
                              <span className="text-slate-700">·</span>
                              <div className="flex items-center gap-1.5 text-xs" title="NEC 705.12(B): Max PV breaker = (bus × 120%) − main">
                                <span className="text-slate-500">Max PV:</span>
                                <span className="text-amber-400 font-bold">{maxPV}A</span>
                                <span className="text-[10px] text-slate-600">(120% rule)</span>
                              </div>
                            </>
                          ) : null;
                        })()}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="eng-label">Main Panel (Amps)</label>
                          <select value={config.mainPanelAmps} onChange={e => updateConfig({ mainPanelAmps: +e.target.value })} className="eng-select">
                            {[100, 150, 200, 225, 320, 400].map(a => <option key={a} value={a}>{a}A</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="eng-label">Panel Brand</label>
                          <select value={config.mainPanelBrand} onChange={e => updateConfig({ mainPanelBrand: e.target.value })} className="eng-select">
                            {['Square D', 'Eaton', 'Siemens', 'Leviton', 'GE', 'Cutler-Hammer', 'Murray'].map(b => <option key={b}>{b}</option>)}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="eng-label flex items-center gap-1">
                            Bus Rating (Amps)
                            <span className="text-slate-600 text-[10px] ml-1 font-normal">used for 120% rule</span>
                          </label>
                          <select
                            value={config.panelBusRating ?? config.mainPanelAmps ?? 200}
                            onChange={e => updateConfig({ panelBusRating: +e.target.value })}
                            className="eng-select"
                          >
                            {[100, 150, 200, 225, 320, 400].map(a => (
                              <option key={a} value={a}>{a}A bus{a === (config.mainPanelAmps ?? 200) ? ' (same as main)' : ''}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* ── Section 2: PV AC Output Circuit ──────────────────────────── */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-1 flex items-center gap-2 tracking-tight">
                        <Zap size={14} className="text-amber-400" /> PV AC Output Circuit
                        {_elecStatus && (
                          <span className={`ml-auto flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${statusGlow(_elecStatus)}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(_elecStatus)}`} />
                            {_elecStatus}
                          </span>
                        )}
                      </h3>

                      {/* PV AC summary strip */}
                      <div className="flex flex-wrap gap-2 mb-3 p-2.5 rounded-lg bg-slate-900/50 border border-slate-700/40">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">AC:</span>
                          <span className="text-emerald-400 font-bold">{totalInverterKw} kW</span>
                        </div>
                        <span className="text-slate-700">·</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Wire:</span>
                          <span className="text-blue-400 font-bold">
                            {(() => {
                              const acRun = cs.runs.find((r: any) => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
                              return acRun?.wireGauge || config.wireGauge || '—';
                            })()}
                          </span>
                        </div>
                        <span className="text-slate-700">·</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Run:</span>
                          <span className="text-slate-300 font-bold">{config.wireLength}ft</span>
                        </div>
                        <span className="text-slate-700">·</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Conduit:</span>
                          <span className="text-slate-300">{config.conduitType?.split(' ')[0]}</span>
                        </div>
                        {cs.backfeedBreakerAmps > 0 && (
                          <>
                            <span className="text-slate-700">·</span>
                            <div className="flex items-center gap-1.5 text-xs" title="NEC 705.12(B): min(required, 120% cap)">
                              <span className="text-slate-500">Backfeed:</span>
                              <span className={`font-bold ${cs.backfeedBreakerAmps > (config.mainPanelAmps ?? 200) * 0.2 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {cs.backfeedBreakerAmps}A
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Inline electrical violation */}
                      {compliance.electrical?.status === 'FAIL' && (compliance.electrical?.errors?.length > 0 || compliance.electrical?.warnings?.length > 0) && (
                        <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                          <div className="font-bold flex items-center gap-1.5 mb-1"><AlertTriangle size={11} /> Electrical Violations</div>
                          {[...(compliance.electrical.errors?.slice(0,2) ?? []), ...(compliance.electrical.warnings?.slice(0,1) ?? [])].map((v: any, i: number) => (
                            <div key={i} className="text-red-300/80 ml-4">• {v.message || v}</div>
                          ))}
                        </div>
                      )}
                      {compliance.electrical?.status === 'WARNING' && compliance.electrical?.warnings?.length > 0 && (
                        <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400">
                          <div className="font-bold flex items-center gap-1.5 mb-1"><AlertCircle size={11} /> Electrical Warnings</div>
                          {compliance.electrical.warnings.slice(0, 2).map((w: any, i: number) => (
                            <div key={i} className="text-amber-300/80 ml-4">• {w.message || w}</div>
                          ))}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="eng-label flex items-center gap-1">
                            AC Wire Gauge
                            <span className="text-amber-400 text-xs font-bold ml-1" title="Auto-calculated per NEC 310.16">⚡ Auto</span>
                          </label>
                          <div className="eng-auto-field" title="Auto-calculated from ComputedSystem (NEC 310.16 / NEC 690.8). Not user-editable.">
                            {(() => {
                              const acRun = cs.runs.find((r: any) => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
                              const gauge = acRun?.wireGauge
                                || (cs.isMicro ? '#6 AWG' : ((compliance.electrical as any)?.acSizing?.conductorGauge || config.wireGauge));
                              return `${gauge} THWN-2`;
                            })()}
                            <span className="text-slate-500 text-xs ml-2 font-sans">NEC 310.16</span>
                          </div>
                        </div>
                        <div>
                          <label className="eng-label">Conduit Type</label>
                          <select value={config.conduitType} onChange={e => updateConfig({ conduitType: e.target.value })} className="eng-select">
                            {['EMT', 'PVC Schedule 40', 'PVC Schedule 80', 'Rigid Metal (RMC)', 'Flexible Metal (FMC)'].map(c => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="eng-label">AC Wire Run (ft)</label>
                          <input type="number" min={1} value={config.wireLength} onChange={e => updateConfig({ wireLength: +e.target.value })}
                            className="eng-input" />
                        </div>
                      </div>

                      {/* Disconnects & toggles */}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {([
                          { key: 'acDisconnect', label: 'AC Disconnect', sub: 'NEC 690.14' },
                          ...(config.inverters[0]?.type !== 'micro' ? [{ key: 'dcDisconnect', label: 'DC Disconnect', sub: 'NEC 690.15' }] : []),
                          { key: 'productionMeter', label: 'Production Meter', sub: '' },
                          { key: 'rapidShutdown', label: 'Rapid Shutdown', sub: 'NEC 690.12' },
                        ] as any[]).map(item => (
                          <label key={item.key} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-slate-800/40 transition-colors"
                            onClick={() => updateConfig({ [item.key]: !(config as any)[item.key] } as any)}>
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${(config as any)[item.key] ? 'bg-amber-500 border-amber-500' : 'border-slate-600'}`}>
                              {(config as any)[item.key] && <CheckCircle size={12} className="text-slate-900" />}
                            </div>
                            <div>
                              <span className="text-xs text-slate-300 block">{item.label}</span>
                              {item.sub && <span className="text-[10px] text-slate-500">{item.sub}</span>}
                            </div>
                          </label>
                        ))}
                        {config.inverters[0]?.type === 'micro' && (
                          <div className="flex items-center gap-2 opacity-40 cursor-not-allowed p-2">
                            <div className="w-5 h-5 rounded border-2 border-slate-700 flex items-center justify-center bg-slate-800">
                              <span className="text-slate-600 text-xs">—</span>
                            </div>
                            <div>
                              <span className="text-xs text-slate-500 line-through block">DC Disconnect</span>
                              <span className="text-[10px] text-purple-400">(N/A — micro)</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Info size={14} className="text-amber-400" /> Engineering Notes</h3>
                      <textarea value={config.notes} onChange={e => updateConfig({ notes: e.target.value })} rows={4}
                        placeholder="Add engineering notes, special conditions, AHJ requirements, utility interconnection notes..."
                        className="eng-input resize-none" />
                    </div>

                  </div>{/* end left col */}


                  {/* ─────────────────────────────────────────────────────────
                      CENTER COLUMN: Ecosystem Picker + Inverter/Strings
                  ──────────────────────────────────────────────────────────── */}
                  <div className="space-y-5">

                    {/* Ecosystem Picker — v57.5: collapsed to summary chip after selection */}
                    {(config as any).ecosystemBrand ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
                        <Package size={12} className="text-amber-400 flex-shrink-0" />
                        <span className="text-xs text-slate-300">
                          <span className="font-bold text-amber-300">{String((config as any).ecosystemBrand).toUpperCase()}</span> ecosystem applied
                          {ecosystemComponents.length > 0 && <span className="text-slate-500 ml-1">({ecosystemComponents.length} components)</span>}
                        </span>
                        <button
                          className="ml-auto text-[10px] text-slate-500 hover:text-amber-400 transition-colors"
                          onClick={() => updateConfig({ ecosystemBrand: undefined } as any)}
                          title="Clear ecosystem to re-select"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                    <EcosystemPicker
                      appliedBrand={(config as any).ecosystemBrand}
                      onApply={(payload: EcosystemApplyPayload) => {
                        const updates: any = { ecosystemBrand: payload.brand };
                        if (payload.selections.inverterId) {
                          const invId = payload.selections.inverterId;
                          const isMicro = payload.kit.microinverters.some((m: any) => m.id === invId);
                          const isOptimizer = payload.kit.optimizers.some((o: any) => o.id === invId);
                          const invType: any = isMicro ? 'micro' : isOptimizer ? 'optimizer' : 'string';
                          const existingInverters = config.inverters || [];
                          const firstInv = existingInverters[0];
                          if (firstInv) {
                            const updatedInverters = [...existingInverters];
                            // v58.5 FIX: For optimizer peripheral IDs (e.g. se-p505), resolve the
                            // central string inverter from the brand profile instead.
                            // Storing a peripheral as inverterId breaks brand inference:
                            //   getBrandProfileByInverterId('se-p505') → undefined
                            //   → sizingRecommendation uses stale selectedBrand (e.g. 'enphase')
                            //   → returns 36 micros instead of 1 SE11400H!
                            const centralInvId = (() => {
                              if (!isOptimizer) return invId;
                              const brandProf = getBrandProfileByInverterId(invId)
                                ?? (payload.brand ? getBrandProfile(payload.brand) : undefined);
                              const models = brandProf?.supportedInverterModels ?? [];
                              // Highest-tier model = last entry (matches sizingTiers ordering)
                              const central = models.length > 0 ? models[models.length - 1].equipmentDbId : null;
                              if (central) {
                                console.log('[ECOSYSTEM APPLY] optimizer peripheral', invId, '→ central inverter', central);
                                return central;
                              }
                              console.warn('[ECOSYSTEM APPLY] no central inverter found for optimizer', invId);
                              return invId; // fallback: keep peripheral (will be caught by sizing engine)
                            })();
                            // v58.6: Store BOTH central inverter (for sizing/brand inference)
                            // AND peripheral optimizer ID (for BOM Stage 1 optimizer line items).
                            updatedInverters[0] = {
                              ...firstInv,
                              type: invType,
                              inverterId: centralInvId,
                              // If we resolved a different central inverter, preserve the original
                              // peripheral ID so BOM can emit the correct optimizer SKU in Stage 1.
                              ...(isOptimizer && centralInvId !== invId
                                ? { optimizerPeripheralId: invId }
                                : {}),
                            };
                            updates.inverters = updatedInverters;
                          }
                        }
                        if (payload.selections.batteryId) {
                          updates.batteryId = payload.selections.batteryId;
                          if (!config.batteryCount || config.batteryCount < 1) updates.batteryCount = 1;
                        }
                        const wouldClobber: string[] = [];
                        if (payload.selections.inverterId && config.inverters?.[0]?.inverterId &&
                            config.inverters[0].inverterId !== payload.selections.inverterId) {
                          wouldClobber.push(`inverter (currently: ${config.inverters[0].inverterId})`);
                        }
                        if (payload.selections.batteryId && config.batteryId &&
                            config.batteryId !== payload.selections.batteryId) {
                          wouldClobber.push(`battery (currently: ${config.batteryId})`);
                        }
                        if (wouldClobber.length > 0) {
                          const ok = window.confirm(
                            `Apply ${payload.brand.toUpperCase()} ecosystem?\n\n` +
                            `This will replace:\n\u2022 ${wouldClobber.join('\n\u2022 ')}\n\n` +
                            `Click OK to apply, Cancel to keep existing selections.`
                          );
                          if (!ok) return;
                        }
                        updateConfig(updates);
                        const appliedCount = Object.values(payload.selections).filter(Boolean).length;
                        setAutoLoadBanner(
                          `\u2713 Applied ${payload.brand.toUpperCase()} ecosystem \u2014 ` +
                          `${appliedCount} component${appliedCount !== 1 ? 's' : ''} configured. ` +
                          `Manual dropdowns remain editable below.`
                        );
                        setTimeout(() => setAutoLoadBanner(null), 6000);
                      }}
                    />
                    )}

                    {/* Auto-configured indicator */}
                    {config.defaultsApplied && config.inverters.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs w-fit">
                        <span aria-hidden>⚡</span>
                        <span>Auto-configured system — edit any field to customize.</span>
                      </div>
                    )}

                    {/* Panel Compatibility Banner */}
                    {sizingRecommendation?.panelCompatibility && (
                      <PanelCompatibilityBanner
                        verdict={sizingRecommendation.panelCompatibility}
                        onChangePanel={(newPanelId) => {
                          setConfig(prev => ({
                            ...prev,
                            inverters: prev.inverters.map(inv => ({
                              ...inv,
                              strings: inv.strings.map(s => ({ ...s, panelId: newPanelId })),
                            })),
                            ...LOCK,
                          }));
                        }}
                      />
                    )}

                    {/* Sizing Recommendation */}
                    {sizingRecommendation && !sizingDismissed && (
                      <SizingRecommendation
                        sizing={sizingRecommendation}
                        current={sizingCurrentSnapshot}
                        autoApply={sizingAutoApply}
                        onAutoApplyChange={setSizingAutoApply}
                        onApply={() => {
                          applySizingRecommendation(sizingRecommendation);
                        }}
                        hidden={config.inverters.length === 0}
                        panelCountSource={{
                          value: resolvedPanelCount.value,
                          source: resolvedPanelCount.source,
                          mismatchedWithConfig: resolvedPanelCount.mismatchedWithConfig,
                          configValue: totalPanels,
                        }}
                      />
                    )}

                    {/* Validation Panel */}
                    {validationResult && config.inverters.length > 0 && (
                      <ValidationPanel
                        result={validationResult}
                        complianceStatus={compliance.overallStatus ?? rulesResult?.overallStatus ?? null}
                        sizingRecommendation={sizingRecommendation}
                        onApplySizingFix={(rec) => {
                          applySizingRecommendation(rec);
                        }}
                        selectedLayoutCandidate={sizingRecommendation?.selectedLayoutCandidate ?? null}
                      />
                    )}

                    {/* Inverters & Strings Card */}
                    <div className="eng-panel">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Zap size={14} className="text-amber-400" /> Inverters & Strings
                          <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">+14 Models</span>
                        </h3>
                        <div className="flex gap-2">
                          {(['string', 'micro', 'optimizer'] as InverterType[]).map(t => {
                            const hasMicro = config.inverters.some(i => i.type === 'micro');
                            if (t === 'micro' && hasMicro) return null;
                            return (
                              <button key={t} onClick={() => addInverter(t)} className="btn-secondary btn-sm text-xs">
                                <Plus size={11} /> {t === 'string' ? 'String Inv.' : t === 'micro' ? 'Microinverter' : 'Optimizer'}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Branch Visualization */}
                      {config.inverters.length > 0 && (
                        <div className="mb-4 p-3 rounded-xl bg-slate-900/60 border border-slate-700/40">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                            {cs.isMicro ? 'AC Branch Layout' : 'String Layout'}
                          </div>
                          <div className="space-y-1.5">
                            {cs.isMicro ? (
                              /* Micro branch bars */
                              Array.from({ length: Math.min(cs.acBranchCount, 8) }, (_, bi) => {
                                const devPerBranch = cs.microDeviceCount > 0 ? Math.ceil(cs.microDeviceCount / cs.acBranchCount) : 0;
                                const isLast = bi === Math.min(cs.acBranchCount, 8) - 1;
                                const lastCount = cs.microDeviceCount - (Math.min(cs.acBranchCount, 8) - 1) * devPerBranch;
                                const count = isLast ? Math.max(0, lastCount) : devPerBranch;
                                const maxCount = devPerBranch || 1;
                                return (
                                  <div key={bi} className="flex items-center gap-2">
                                    <span className="text-[10px] text-purple-400 font-mono w-14 shrink-0">Branch {bi + 1}</span>
                                    <div className="flex gap-0.5 flex-1">
                                      {Array.from({ length: Math.min(count, 20) }, (_, pi) => (
                                        <div key={pi} className="h-3 flex-1 rounded-sm bg-purple-500/50 border border-purple-500/30 min-w-[4px] max-w-[12px]" />
                                      ))}
                                      {count > 20 && <span className="text-[9px] text-purple-400 ml-1">+{count - 20}</span>}
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-mono w-8 text-right shrink-0">{count}</span>
                                  </div>
                                );
                              })
                            ) : (
                              /* String inverter bars — prefer sizingRecommendation (engine truth) over stale config */
                              (() => {
                                // Single source of truth: use engine-computed strings when available.
                                // config.inverters strings may be stale (e.g. 36x1-panel from old seed).
                                const recStrings = sizingRecommendation?.strings;
                                const _panelWatts = config.inverters[0]?.strings?.[0]
                                  ? (getPanelById(config.inverters[0].strings[0].panelId)?.watts || 400)
                                  : 400;
                                const _maxPanels = 25;
                                if (recStrings && recStrings.length > 0) {
                                  return recStrings.map((str: any, si: number) => {
                                    const kw = (str.panelCount * _panelWatts / 1000);
                                    return (
                                      <div key={`rec-str-${si}`} className="flex items-center gap-2">
                                        <span className="text-[10px] text-amber-400 font-mono w-14 shrink-0">String {si + 1}</span>
                                        <div className="flex gap-0.5 flex-1">
                                          {Array.from({ length: Math.min(str.panelCount, _maxPanels) }, (_, pi) => (
                                            <div key={pi} className="h-3 flex-1 rounded-sm bg-amber-500/40 border border-amber-500/20 min-w-[4px] max-w-[14px]" />
                                          ))}
                                          {str.panelCount > _maxPanels && <span className="text-[9px] text-amber-400 ml-1">+{str.panelCount - _maxPanels}</span>}
                                        </div>
                                        <span className="text-[10px] text-slate-400 font-mono w-16 text-right shrink-0">{str.panelCount}p · {kw.toFixed(1)}kW</span>
                                      </div>
                                    );
                                  });
                                }
                                // Fallback: config.inverters (only if no recommendation yet)
                                return config.inverters.flatMap(inv =>
                                  inv.strings.map((str, si) => {
                                    const panel = getPanelById(str.panelId);
                                    const kw = (str.panelCount * (panel?.watts || 400) / 1000);
                                    return (
                                      <div key={str.id} className="flex items-center gap-2">
                                        <span className="text-[10px] text-amber-400 font-mono w-14 shrink-0">{str.label}</span>
                                        <div className="flex gap-0.5 flex-1">
                                          {Array.from({ length: Math.min(str.panelCount, _maxPanels) }, (_, pi) => (
                                            <div key={pi} className="h-3 flex-1 rounded-sm bg-amber-500/40 border border-amber-500/20 min-w-[4px] max-w-[14px]" />
                                          ))}
                                          {str.panelCount > _maxPanels && <span className="text-[9px] text-amber-400 ml-1">+{str.panelCount - _maxPanels}</span>}
                                        </div>
                                        <span className="text-[10px] text-slate-400 font-mono w-16 text-right shrink-0">{str.panelCount}p · {kw.toFixed(1)}kW</span>
                                      </div>
                                    );
                                  })
                                );
                              })()
                            )}
                            {cs.isMicro && cs.acBranchCount > 8 && (
                              <div className="text-[10px] text-slate-500 text-center">+ {cs.acBranchCount - 8} more branches</div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        {config.inverters.map((inv, invIdx) => {
                          const invData = getInvById(inv.inverterId, inv.type) as any;
                          const invList = inv.type === 'micro'
                            ? MICROINVERTERS
                            : inv.type === 'ecoflow'
                              ? STRING_INVERTERS.filter(i => i.id.startsWith('ecoflow-'))
                              : inv.type === 'hybrid'
                                ? STRING_INVERTERS.filter(i => !i.id.startsWith('ecoflow-'))
                                : STRING_INVERTERS.filter(i => !i.id.startsWith('ecoflow-'));
                          return (
                            <div key={inv.id} className="border border-slate-700/50 rounded-xl overflow-hidden">
                              <div className="flex items-center gap-3 p-4 bg-slate-800/40 cursor-pointer hover:bg-slate-800/60 transition-colors"
                                onClick={() => setExpandedInv(expandedInv === inv.id ? null : inv.id)}>
                                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-xs flex-shrink-0">{invIdx + 1}</div>
                                <div className="flex-1">
                                  <div className="text-sm font-bold text-white">{invData?.manufacturer} {invData?.model}</div>
                                  <div className="text-xs text-slate-400">
                                    {inv.type === 'micro' ? 'Microinverter' : inv.type === 'hybrid' ? 'Hybrid Inverter' : inv.type === 'optimizer' ? 'String + Optimizer' : 'String Inverter'} ·
                                    {config.inverters.length === 1 && systemPanelCount > 0
                                      ? systemPanelCount
                                      : inv.strings.reduce((s, str) => s + str.panelCount, 0)} panels ·
                                    {(inv.strings.reduce((s, str) => s + str.panelCount * (getPanelById(str.panelId)?.watts || 400), 0) / 1000).toFixed(2)} kW DC
                                    {(inv.type === 'string' || inv.type === 'hybrid' || inv.type === 'ecoflow') && (() => {
                                      const perInvStringCount = inv.strings.length;
                                      const perInvPanelCounts = inv.strings.map(s => s.panelCount);
                                      const allEqual = perInvPanelCounts.every(c => c === perInvPanelCounts[0]);
                                      const pps = allEqual && perInvPanelCounts.length > 0
                                        ? `${perInvPanelCounts[0]}/str`
                                        : perInvPanelCounts.join('/') + ' panels';
                                      return (
                                        <span className="ml-1 text-amber-400 font-semibold">
                                          · {perInvStringCount} string{perInvStringCount === 1 ? '' : 's'} ({pps})
                                        </span>
                                      );
                                    })()}
                                    {inv.type === 'micro' && (
                                      <span className="ml-1 text-purple-400 font-semibold">
                                        · {cs.microDeviceCount} microinverters · {cs.acBranchCount} AC branch{cs.acBranchCount > 1 ? 'es' : ''}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={e => { e.stopPropagation(); removeInverter(inv.id); }} className="text-slate-600 hover:text-red-400 transition-colors p-1"><Trash2 size={13} /></button>
                                  {expandedInv === inv.id ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                                </div>
                              </div>
                              {expandedInv === inv.id && (
                                <div className="p-4 space-y-4 bg-slate-900/30">
                                  {/* Topology selector — segmented control */}
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Topology</span>
                                    {topologySwitching && <span className="text-xs text-amber-400 animate-pulse">Propagating ecosystem…</span>}
                                  </div>
                                  <div className="flex rounded-xl overflow-hidden border border-slate-700/60 mb-3">
                                    {([
                                      { type: 'string' as InverterType, label: 'String', desc: 'String inverter, no optimizers' },
                                      { type: 'optimizer' as InverterType, label: 'Optimizer', desc: 'String + per-module optimizers' },
                                      { type: 'micro' as InverterType, label: 'Micro', desc: 'Microinverter per module' },
                                      { type: 'ecoflow' as InverterType, label: 'EcoFlow', desc: 'EcoFlow PowerOcean hybrid + LFP battery' },
                                    ]).map(({ type: t, label, desc }, ti) => (
                                      <button
                                        key={t}
                                        onClick={() => {
                                          if (inv.type !== t) {
                                            let defaultId: string;
                                            if (t === 'micro') defaultId = MICROINVERTERS[0]?.id || inv.inverterId;
                                            else if (t === 'ecoflow') defaultId = 'ecoflow-power-ocean-10kw';
                                            else defaultId = STRING_INVERTERS[0]?.id || inv.inverterId;
                                            handleTopologySwitch(inv.id, t, defaultId);
                                          }
                                        }}
                                        title={desc}
                                        className={`flex-1 py-2 px-1 text-xs font-bold transition-all border-r last:border-r-0 border-slate-700/60 ${
                                          inv.type === t
                                            ? (t === 'ecoflow'
                                                ? 'bg-emerald-500/25 text-emerald-300'
                                                : 'bg-amber-500/25 text-amber-300')
                                            : 'bg-slate-800/60 text-slate-500 hover:text-slate-200 hover:bg-slate-700/40'
                                        }`}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <div className="md:col-span-2">
                                      <label className="eng-label">Inverter Model</label>
                                      <select value={inv.inverterId} onChange={e => updateInverter(inv.id, { inverterId: e.target.value })}
                                        className="eng-select text-xs px-2 py-1.5">
                                        {invList.map(i => <option key={i.id} value={i.id}>{(i as any).isNew ? '🆕 ' : ''}{i.manufacturer} {i.model}{(inv.type === 'string' || inv.type === 'ecoflow' || inv.type === 'hybrid' || inv.type === 'optimizer') ? ` (${(i as any).acOutputKw}kW)` : ` (${(i as any).acOutputW}W)`}</option>)}
                                      </select>
                                    </div>
                                    {invData && (
                                      <div className="bg-slate-800/60 rounded-lg p-2 text-xs space-y-0.5">
                                        <div className="text-slate-400">Max DC: <span className="text-white">{invData.maxDcVoltage}V</span></div>
                                        <div className="text-slate-400">MPPT: <span className="text-white">{invData.mpptVoltageMin}–{invData.mpptVoltageMax}V</span></div>
                                        <div className="text-slate-400">Eff: <span className="text-white">{invData.efficiency}%</span></div>
                                        {(() => {
                                          if (inv.type === 'micro') return null;
                                          const firstStrPanel = getPanelById(inv.strings[0]?.panelId) as any;
                                          if (!firstStrPanel || !invData.maxDcVoltage) return null;
                                          const designTemp = compliance.autoDetected?.designTempMin ?? cs.designTempMin ?? -10;
                                          const tCoeff = firstStrPanel.tempCoeffVoc ?? -0.27;
                                          const vocCorr = firstStrPanel.voc * (1 + (tCoeff / 100) * (designTemp - 25));
                                          const vmpCorr = firstStrPanel.vmp * (1 + (tCoeff / 100) * (designTemp - 25));
                                          const maxPPS = Math.floor((invData.maxDcVoltage || 600) / vocCorr);
                                          const minPPS = Math.ceil((invData.mpptVoltageMin || 100) / vmpCorr);
                                          const recPPS = Math.round(((invData.mpptVoltageMin || 100) + (invData.mpptVoltageMax || 600)) / 2 / (firstStrPanel.vmp || 41.8));
                                          const clampedRec = Math.max(minPPS, Math.min(maxPPS, recPPS));
                                          return (
                                            <div className="mt-1 pt-1 border-t border-slate-700/50">
                                              <div className="text-green-400 font-semibold mb-0.5">String Sizing (NEC 690.7 @ {designTemp}°C)</div>
                                              <div className="text-slate-400">Max/string: <span className="text-white font-bold">{maxPPS}</span></div>
                                              <div className="text-slate-400">Min/string: <span className="text-white font-bold">{minPPS}</span></div>
                                              <div className="text-slate-400">Rec: <span className="text-amber-400 font-bold">{clampedRec}</span></div>
                                              {(() => {
                                                const totalPanelsForInv = inv.strings.reduce((s, str) => s + str.panelCount, 0);
                                                const autoStrings = Math.max(1, Math.round(totalPanelsForInv / clampedRec));
                                                const autoPerStr = Math.ceil(totalPanelsForInv / autoStrings);
                                                const autoLastStr = totalPanelsForInv - (autoStrings - 1) * autoPerStr;
                                                return (
                                                  <div className="mt-1.5 pt-1 border-t border-slate-700/30">
                                                    <div className="text-slate-400 mb-1">
                                                      Auto: <span className="text-amber-300 font-bold">{autoStrings}×{autoPerStr}</span>
                                                      {autoLastStr !== autoPerStr && autoStrings > 1 && <span className="text-slate-500"> (last: {autoLastStr})</span>}
                                                    </div>
                                                    <button
                                                      onClick={() => {
                                                        const newStrings = Array.from({ length: autoStrings }, (_, i) => ({
                                                          ...newString(i, config.systemType),
                                                          panelCount: i === autoStrings - 1 ? autoLastStr : autoPerStr,
                                                          panelId: inv.strings[0]?.panelId ?? defaultPanelForSystemType(config.systemType),
                                                          wireGauge: inv.strings[0]?.wireGauge ?? '#10 AWG',
                                                          wireLength: inv.strings[0]?.wireLength ?? 50,
                                                        }));
                                                        updateInverter(inv.id, { strings: newStrings } as any);
                                                        logDecision('Auto-String Applied', `${autoStrings} strings × ${autoPerStr} panels (NEC 690.7 @ ${designTemp}°C)`, 'auto');
                                                      }}
                                                      className="w-full mt-1 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded text-xs text-green-300 hover:bg-green-500/30 transition-colors font-semibold"
                                                    >
                                                      ⚡ Auto-Apply: {autoStrings}×{autoPerStr}
                                                    </button>
                                                  </div>
                                                );
                                              })()}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  {/* Device Ratio Override */}
                                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2 mt-1">
                                    {inv.type === 'micro' && (() => {
                                      const regMpd = (getInvById(inv.inverterId, 'micro') as any)?.modulesPerDevice ?? 1;
                                      return (
                                        <div className="flex items-center gap-3">
                                          <div className="flex-1">
                                            <label className="eng-label">Modules per microinverter</label>
                                            <select value={inv.deviceRatioOverride ?? regMpd} onChange={e => updateInverter(inv.id, { deviceRatioOverride: +e.target.value })}
                                              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                              {[1, 2, 3, 4].map(n => (
                                                <option key={n} value={n}>{n} module{n > 1 ? 's' : ''} per device{n === regMpd ? ' (registry default)' : ''}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="text-xs text-slate-500 italic pt-4">Changing this will recalculate engineering values.</div>
                                        </div>
                                      );
                                    })()}
                                    {inv.type === 'optimizer' && (
                                      <div className="flex items-center gap-3">
                                        <div className="flex-1">
                                          <label className="eng-label">Optimizers per module</label>
                                          <select value={inv.deviceRatioOverride ?? 1} onChange={e => updateInverter(inv.id, { deviceRatioOverride: +e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                            {[1, 2].map(n => (
                                              <option key={n} value={n}>{n} optimizer{n > 1 ? 's' : ''} per module{n === 1 ? ' (default)' : ''}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="text-xs text-slate-500 italic pt-4">Changing this will recalculate engineering values.</div>
                                      </div>
                                    )}
                                    {(inv.type === 'string' || inv.type === 'hybrid' || inv.type === 'ecoflow') && (
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="eng-label">Modules per string</label>
                                          <select value={inv.modulesPerString ?? inv.strings[0]?.panelCount ?? 10} onChange={e => updateInverter(inv.id, { modulesPerString: +e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                            {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(n => (
                                              <option key={n} value={n}>{n} modules</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="eng-label">Strings per inverter</label>
                                          <select value={inv.stringsPerInverter ?? inv.strings.length} onChange={e => updateInverter(inv.id, { stringsPerInverter: +e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                            {[1,2,3,4,5,6].map(n => (
                                              <option key={n} value={n}>{n} string{n > 1 ? 's' : ''}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="col-span-2 text-xs text-slate-500 italic">Changing this will recalculate engineering values.</div>
                                      </div>
                                    )}
                                  </div>
                                  {/* MICRO: panel count only */}
                                  {inv.type === 'micro' ? (
                                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                                      <div className="text-xs font-bold text-purple-300 mb-2 uppercase tracking-wide">Microinverter Array</div>
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="eng-label">Total Panel Count</label>
                                          <input type="number" min={1} max={200} value={inv.strings[0]?.panelCount ?? 10}
                                            onChange={e => updateString(inv.id, inv.strings[0]?.id ?? '', { panelCount: +e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none" />
                                        </div>
                                        <div>
                                          <label className="eng-label">Panel Model</label>
                                          <select value={inv.strings[0]?.panelId ?? 'qcells-peak-duo-400'}
                                            onChange={e => updateString(inv.id, inv.strings[0]?.id ?? '', { panelId: e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none">
                                            {SOLAR_PANELS.map(p => <option key={p.id} value={p.id}>{p.manufacturer} {p.model}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                      {(() => {
                                        const microInvData = getInvById(inv.inverterId, 'micro') as any;
                                        const mpd = microInvData?.modulesPerDevice ?? 1;
                                        const panels = inv.strings[0]?.panelCount ?? 10;
                                        const devices = Math.ceil(panels / mpd);
                                        return (
                                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                                            <span>Modules/device: <span className="text-purple-300 font-bold">{mpd}</span></span>
                                            <span>Device count: <span className="text-purple-300 font-bold">{devices}</span></span>
                                            <span className="text-purple-400/60 italic">No DC strings · AC output only</span>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  ) : (
                                    /* STRING/OPTIMIZER: full DC string UI */
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Strings / Arrays</span>
                                        <button onClick={() => addString(inv.id)} className="btn-ghost text-xs flex items-center gap-1 text-amber-400 hover:text-amber-300">
                                          <Plus size={11} /> Add String
                                        </button>
                                      </div>
                                      <div className="space-y-2">
                                        {inv.strings.map((str) => {
                                          const panel = getPanelById(str.panelId);
                                          return (
                                            <div key={str.id} className="bg-slate-800/60 border border-slate-700/40 rounded-lg p-3">
                                              <div className="flex items-center gap-2 mb-2">
                                                <span className="text-xs font-bold text-amber-400">{str.label}</span>
                                                <span className="text-xs text-slate-500">{str.panelCount} × {panel?.watts || 400}W = {(str.panelCount * (panel?.watts || 400) / 1000).toFixed(2)} kW</span>
                                                <button onClick={() => removeString(inv.id, str.id)} className="ml-auto text-slate-600 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
                                              </div>
                                              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                                <div className="md:col-span-2">
                                                  <label className="text-xs text-slate-500 mb-0.5 block">Panel Model</label>
                                                  <select value={str.panelId} onChange={e => updateString(inv.id, str.id, { panelId: e.target.value })}
                                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none">
                                                    {SOLAR_PANELS.map(p => <option key={p.id} value={p.id}>{p.manufacturer} {p.model}</option>)}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="text-xs text-slate-500 mb-0.5 block">Count</label>
                                                  <input type="number" min={1} max={50} value={str.panelCount}
                                                    onChange={e => updateString(inv.id, str.id, { panelCount: +e.target.value })}
                                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                                                </div>
                                                <div>
                                                  <label className="text-xs text-slate-500 mb-0.5 block">DC Wire</label>
                                                  <select value={str.wireGauge} onChange={e => updateString(inv.id, str.id, { wireGauge: e.target.value })}
                                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none">
                                                    {['#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG'].map(g => <option key={g}>{g}</option>)}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="text-xs text-slate-500 mb-0.5 block">Run (ft)</label>
                                                  <input type="number" min={1} value={str.wireLength}
                                                    onChange={e => updateString(inv.id, str.id, { wireLength: +e.target.value })}
                                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                                                </div>
                                              </div>
                                              {/* MANUAL OCPD override */}
                                              {engineeringMode === 'MANUAL' && (
                                                <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                                  <div className="flex items-center gap-2 mb-1">
                                                    <Lock size={10} className="text-amber-400" />
                                                    <span className="text-xs font-bold text-amber-400">MANUAL OCPD Override</span>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <input type="number" min={1} max={100} placeholder="Auto"
                                                      value={str.ocpdOverride ?? ''}
                                                      onChange={e => updateString(inv.id, str.id, { ocpdOverride: e.target.value ? +e.target.value : undefined, ocpdOverrideAcknowledged: false })}
                                                      className="w-20 bg-slate-700 border border-amber-500/40 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                                                    <span className="text-xs text-slate-400">A breaker</span>
                                                    {str.ocpdOverride && panel && str.ocpdOverride > panel.maxSeriesFuseRating && (
                                                      <span className="text-xs text-red-400 font-bold flex items-center gap-1">
                                                        <AlertTriangle size={10} /> Exceeds maxSeriesFuse ({panel.maxSeriesFuseRating}A) — NEC 690.8(B) VIOLATION
                                                      </span>
                                                    )}
                                                    {str.ocpdOverride && panel && str.ocpdOverride <= panel.maxSeriesFuseRating && (
                                                      <span className="text-xs text-amber-400">Override active — verify compliance</span>
                                                    )}
                                                  </div>
                                                </div>
                                              )}
                                              {panel && (
                                                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                                                  <span>Voc: <span className="text-slate-300">{panel.voc}V</span></span>
                                                  <span>Isc: <span className="text-slate-300">{panel.isc}A</span></span>
                                                  <span>Vmp: <span className="text-slate-300">{panel.vmp}V</span></span>
                                                  <span>Temp Coeff: <span className="text-slate-300">{panel.tempCoeffVoc}%/°C</span></span>
                                                  <span>Max Fuse: <span className="text-slate-300">{panel.maxSeriesFuseRating}A</span></span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Ecosystem Propagation Panel */}
                    {ecosystemComponents.length > 0 && (
                      <div className="card p-5 border border-emerald-500/20 bg-emerald-500/5">
                        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                          <Package size={14} className="text-emerald-400" />
                          Auto-Added Ecosystem Components
                          <span className="ml-auto text-xs text-emerald-400 font-normal">{ecosystemComponents.length} component{ecosystemComponents.length !== 1 ? 's' : ''}</span>
                        </h3>
                        <div className="space-y-2">
                          {ecosystemComponents.map((comp: any, i: number) => (
                            <div key={i} className="flex items-start gap-3 p-2.5 bg-slate-800/40 rounded-lg border border-emerald-500/10">
                              <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <CheckCircle size={12} className="text-emerald-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-white">{comp.manufacturer} {comp.model}</div>
                                {comp.partNumber && <div className="text-xs text-emerald-400/70 font-mono">{comp.partNumber}</div>}
                                <div className="text-xs text-slate-400 truncate">{comp.reason}</div>
                              </div>
                              <div className="text-xs text-emerald-400 font-bold flex-shrink-0">×{comp.quantity}</div>
                            </div>
                          ))}
                        </div>
                        {ecosystemLog.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-emerald-500/10">
                            <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Propagation Log</div>
                            {ecosystemLog.map((entry: any, i: number) => (
                              <div key={i} className="text-xs text-slate-400 py-0.5">
                                <span className="text-emerald-400 font-mono">{entry.action}</span>: {entry.component} — {entry.reason}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                  </div>{/* end center col */}


                  {/* ─────────────────────────────────────────────────────────────
                      RIGHT COLUMN: Engineering Summary + System Config (v2)
                  ──────────────────────────────────────────────────────────────── */}
                  <div className="space-y-4 lg:col-span-2 xl:col-span-1">

                    {/* ── Engineering Summary Panel ── */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-3 flex items-center gap-2 tracking-tight">
                        <Cpu size={14} className="text-amber-400" /> Engineering Summary
                      </h3>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { label: 'Panels', value: totalPanels, color: 'text-amber-400', icon: <Sun size={11} /> },
                          { label: 'kW DC', value: totalKw, color: 'text-amber-400', icon: <Zap size={11} /> },
                          { label: 'kW AC', value: _acKwNum > 0 ? _acKwNum.toFixed(2) : '—', color: 'text-blue-400', icon: <Cpu size={11} /> },
                          { label: 'DC/AC', value: _dcAcRatio, color: parseFloat(_dcAcRatio) < 1.0 ? 'text-red-400' : parseFloat(_dcAcRatio) > DC_AC_TARGET.hardMax ? 'text-red-400' : parseFloat(_dcAcRatio) > DC_AC_TARGET.max ? 'text-amber-400' : parseFloat(_dcAcRatio) < DC_AC_TARGET.min ? 'text-amber-400' : 'text-emerald-400', icon: <Activity size={11} /> },
                          { label: cs.isMicro ? 'Branches' : 'Strings', value: _branchCount, color: 'text-purple-400', icon: <GitBranch size={11} /> },
                          { label: 'BOM Cost', value: bomPricing?.pricingApplied ? `$${(bomPricing.totalBomCost / 1000).toFixed(1)}k` : '—', color: 'text-emerald-400', icon: <Package size={11} /> },
                        ].map(item => (
                          <div key={item.label} className="rounded-lg bg-slate-900/70 border border-slate-700/50 px-2.5 py-2">
                            <div className="flex items-center gap-1 mb-0.5">
                              <span className={item.color}>{item.icon}</span>
                              <span className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold">{item.label}</span>
                            </div>
                            <div className={`text-base font-black tabular-nums ${item.color}`}>{item.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* System health rows */}
                      <div className="rounded-xl bg-slate-900/40 border border-slate-700/30 divide-y divide-slate-700/30">
                        {[
                          { label: 'Electrical', status: _elecStatus },
                          { label: 'Structural', status: _structStatus },
                          { label: 'NEC Rules', status: rulesResult?.overallStatus },
                          { label: 'Jurisdiction', status: compliance.jurisdiction ? 'PASS' : null },
                        ].map(item => (
                          <div key={item.label} className="flex items-center justify-between px-3 py-1.5">
                            <span className="text-xs text-slate-400">{item.label}</span>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${statusDot(item.status)}`} />
                              <span className={`text-[11px] font-bold ${statusText(item.status)}`}>
                                {item.status || '—'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {rulesResult && (rulesResult.errorCount > 0 || rulesResult.warningCount > 0) && (
                        <div className="mt-2 flex gap-3 text-xs">
                          {rulesResult.errorCount > 0 && (
                            <span className="flex items-center gap-1 text-red-400">
                              <AlertTriangle size={10} /> {rulesResult.errorCount} error{rulesResult.errorCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {rulesResult.warningCount > 0 && (
                            <span className="flex items-center gap-1 text-amber-400">
                              <AlertCircle size={10} /> {rulesResult.warningCount} warning{rulesResult.warningCount > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Battery Card — Toggleable Module */}
                    <div className="eng-panel">
                      {/* Battery header with ON/OFF toggle */}
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-extrabold text-slate-100 flex items-center gap-2 tracking-tight">
                          <Battery size={14} className="text-emerald-400" /> Battery Storage
                          <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">+5 Models</span>
                        </h3>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={batteryEnabled} onChange={e => setBatteryEnabled(e.target.checked)}
                            className="sr-only peer" data-testid="battery-enabled-toggle" />
                          <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                        </label>
                      </div>

                        {!batteryEnabled ? (
                          /* OFF state — single compact row, no dead space */
                          <div className="flex items-center gap-2 py-0.5">
                            <Battery size={11} className="text-slate-700 shrink-0" />
                            <span className="text-xs text-slate-600">No battery · toggle above to add</span>
                          </div>
                        ) : (
                        /* ON state — expanded */
                        <div className="space-y-3">
                          {/* kWh summary strip */}
                          {_batTotalKwh > 0 && (
                            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                              <div className="text-center">
                                <div className="text-lg font-black text-emerald-400 tabular-nums">{_batTotalKwh.toFixed(1)}</div>
                                <div className="text-[10px] text-slate-500">Total kWh</div>
                              </div>
                              <div className="text-center">
                                <div className="text-lg font-black text-emerald-400 tabular-nums">~{_backupPct}%</div>
                                <div className="text-[10px] text-slate-500">Est. Backup</div>
                              </div>
                              <div className="text-center">
                                <div className="text-lg font-black text-emerald-400 tabular-nums">
                                  {_batTotalKwh > 0 ? `~${(_batTotalKwh / Math.max(0.5, _totalKwNum * 0.15)).toFixed(1)}h` : '—'}
                                </div>
                                <div className="text-[10px] text-slate-500">Est. Runtime</div>
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="eng-label">Battery Model</label>
                              <select value={config.batteryId} onChange={e => {
                                const bat = getBatteryById(e.target.value);
                                updateConfig({ batteryId: e.target.value, batteryBrand: bat?.manufacturer ?? '', batteryModel: bat?.model ?? '', batteryKwh: bat?.usableCapacityKwh ?? 0 });
                              }} className="eng-select">
                                <option value="">None</option>
                                {BATTERIES.map(b => (
                                  <option key={b.id} value={b.id}>{b.isNew ? '🆕 ' : ''}{b.manufacturer} {b.model} ({b.usableCapacityKwh} kWh){b.subcategory === 'ac_coupled' ? ` · AC` : ` · DC`}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="eng-label">Units</label>
                              <input type="number" min={0} max={10} value={config.batteryCount} onChange={e => updateConfig({ batteryCount: +e.target.value })} className="eng-input" />
                            </div>
                            <div>
                              <label className="eng-label">kWh / Unit</label>
                              <input type="number" min={0} step={0.1} value={config.batteryKwh} onChange={e => updateConfig({ batteryKwh: +e.target.value })} className="eng-input" />
                            </div>
                          </div>
                          {config.batteryId && (() => {
                            const bat = getBatteryById(config.batteryId);
                            return bat?.backfeedBreakerA ? (
                              <div className="text-xs text-orange-400 text-center">
                                +{bat.backfeedBreakerA}A bus load (NEC 705.12B)
                              </div>
                            ) : null;
                          })()}
                        </div>
                      )}

                      {/* Generator & ATS — v57.5: collapsed to chip when no generator selected */}
                      <div className="mt-4 pt-4 border-t border-slate-700/30">
                        <div className="flex items-center gap-2 mb-3">
                          <Wrench size={12} className="text-orange-400" />
                          <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Generator & Transfer Switch</span>
                          {!config.generatorId && <span className="px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">+4 Models</span>}
                          {config.generatorId && _genData && (
                            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/30">
                              {_genData.ratedOutputKw}kW {_genData.manufacturer}
                            </span>
                          )}
                        </div>

                          {/* Generator OFF state */}
                          {!config.generatorId && !config.atsId ? (
                            /* Compact single row — no dead space */
                            <div className="flex items-center justify-between gap-2 py-0.5">
                              <div className="flex items-center gap-2">
                                <Wrench size={11} className="text-slate-700 shrink-0" />
                                <span className="text-xs text-slate-600">No generator</span>
                              </div>
                              <button onClick={() => setGenSectionOpen(v => !v)}
                                className="text-xs px-2 py-0.5 rounded bg-orange-500/15 border border-orange-500/30 text-orange-400 hover:bg-orange-500/25 transition-colors font-semibold leading-none">
                                {genSectionOpen ? '✕' : '+ Add'}
                              </button>
                            </div>
                          ) : (
                          /* Generator ON state */
                          _genData && _atsData && (
                            <div className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/20 mb-3">
                              <div className="flex items-center gap-2">
                                <CheckCircle size={12} className="text-emerald-400" />
                                <span className="text-xs font-bold text-emerald-400">{_genData.ratedOutputKw}kW gen + {_atsData.ampRating}A ATS</span>
                                {_atsData.neutralSwitched ? <span className="text-xs text-emerald-400"> · Neutral switched ✓</span> : <span className="text-xs text-amber-400"> · ⚠ Check neutral bonding</span>}
                              </div>
                            </div>
                          )
                        )}

                        {(config.generatorId || config.atsId || genSectionOpen) && (
                        <div className="grid grid-cols-1 gap-3 mt-3">
                          <div>
                            <label className="eng-label">Generator</label>
                            <select value={config.generatorId} onChange={e => { updateConfig({ generatorId: e.target.value }); if (e.target.value) setGenSectionOpen(false); }} className="eng-select">
                              <option value="">None</option>
                              {GENERATORS.map(g => (
                                <option key={g.id} value={g.id}>{g.isNew ? '🆕 ' : ''}{g.manufacturer} {g.model} ({g.ratedOutputKw} kW · {g.fuelType.replace('_', ' ')})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="eng-label">Transfer Switch (ATS)</label>
                            <select value={config.atsId} onChange={e => updateConfig({ atsId: e.target.value })} className="eng-select">
                              <option value="">None</option>
                              {ATS_UNITS.map(a => (
                                <option key={a.id} value={a.id}>{a.isNew ? '🆕 ' : ''}{a.manufacturer} {a.model} ({a.ampRating}A · {a.transferType}{a.serviceEntranceRated ? ' · SE-rated' : ''})</option>
                              ))}
                            </select>
                          </div>
                          {config.generatorId && (
                            <div>
                              <label className="eng-label flex items-center gap-1">Generator → ATS Wire Length <span className="text-slate-500">(ft)</span></label>
                              <input type="number" min={5} max={500} step={5}
                                value={config.generatorWireLength ?? 50}
                                onChange={e => updateConfig({ generatorWireLength: Math.max(5, +e.target.value) })}
                                className="eng-input" />
                              {config.generatorWireLength && (() => {
                                const genRun = cs.runs?.find((r: any) => r.id === 'GENERATOR_TO_ATS_RUN');
                                if (!genRun) return null;
                                return (
                                  <div className="mt-1.5 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 flex flex-wrap gap-3">
                                    <span className="font-bold text-amber-400">{genRun.wireGauge}</span>
                                    <span>{genRun.conduitSize} {genRun.conduitType}</span>
                                    <span className="text-slate-500">{config.generatorWireLength}ft · {genRun.ocpdAmps}A OCPD</span>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                        )}
                      </div>
                    </div>

                    {/* ── System Configuration ── */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-3 flex items-center gap-2 tracking-tight">
                        <Settings size={14} className="text-amber-400" /> System Configuration
                      </h3>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="eng-label">System Type</label>
                          <select value={config.systemType} onChange={e => updateConfig({ systemType: e.target.value as any })} className="eng-select">
                            <option value="roof">Roof Mount</option>
                            <option value="ground">Ground Mount</option>
                            <option value="fence">Solar Fence</option>
                          </select>
                        </div>
                        <div>
                          <label className="eng-label">Utility Meter</label>
                          <select value={config.utilityMeter} onChange={e => updateConfig({ utilityMeter: e.target.value })} className="eng-select">
                            {['Bidirectional Net Meter', 'Smart Meter', 'Net Meter', 'Analog Meter', 'Production Meter'].map(m => <option key={m}>{m}</option>)}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="eng-label">Mounting System</label>
                          <select value={config.mountingId} onChange={e => updateConfig({ mountingId: e.target.value })} className="eng-select">
                            {ALL_MOUNTING_SYSTEMS.map(m => <option key={m.id} value={m.id}>{m.manufacturer} {m.model}</option>)}
                          </select>
                        </div>
                          <div className="col-span-2">
                            <label className="eng-label flex items-center gap-1.5">
                              Interconnection Method
                              {(() => {
                                const _busbarFail = (compliance as any)?.electrical?.errors?.some((e: any) => e.code === 'E-BUSBAR-120');
                                return _busbarFail && config.interconnectionMethod === 'LOAD_SIDE'
                                  ? <span className="text-[9px] font-bold text-red-400 bg-red-500/15 border border-red-500/30 rounded px-1 py-0.5 leading-none">120% VIOLATION</span>
                                  : null;
                              })()}
                            </label>
                            {(() => {
                              const _busbarFail = (compliance as any)?.electrical?.errors?.some((e: any) => e.code === 'E-BUSBAR-120');
                              const _icOptions: Array<{ value: 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MAIN_BREAKER_DERATE' | 'PANEL_UPGRADE'; label: string; nec: string; desc: string; recommended?: boolean }> = [
                                { value: 'LOAD_SIDE',          label: 'Load-Side Backfeed', nec: 'NEC 705.12(B)', desc: '120% rule applies — backfeed breaker on bus' },
                                { value: 'SUPPLY_SIDE_TAP',    label: 'Supply-Side Tap',    nec: 'NEC 705.11',    desc: 'Line-side tap — bypasses 120% bus limit', recommended: !!(  _busbarFail && config.interconnectionMethod === 'LOAD_SIDE') },
                                { value: 'MAIN_BREAKER_DERATE',label: 'Main Breaker Derate',nec: 'NEC 705.12(B)', desc: 'Derate main to satisfy 120% rule' },
                                { value: 'PANEL_UPGRADE',      label: 'Panel Upgrade',      nec: 'NEC 705.12(B)', desc: 'Upgrade panel to larger busbar rating' },
                              ];
                              return (
                                <div className="grid grid-cols-2 gap-1 mt-0.5">
                                  {_icOptions.map(opt => {
                                    const isActive = config.interconnectionMethod === opt.value;
                                    const isRecommended = opt.recommended;
                                    return (
                                      <button
                                        key={opt.value}
                                        onClick={() => updateConfig({ interconnectionMethod: opt.value })}
                                        title={`${opt.desc} (${opt.nec})`}
                                        className={[
                                          'flex flex-col items-start text-left px-2 py-1.5 rounded-lg border transition-all',
                                          isActive
                                            ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                                            : isRecommended
                                              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40 animate-pulse'
                                              : 'border-slate-700/50 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-200',
                                        ].join(' ')}
                                      >
                                        <span className="flex items-center gap-1 w-full">
                                          <span className={`text-[11px] font-bold leading-tight truncate ${isActive ? 'text-amber-200' : isRecommended ? 'text-emerald-200' : ''}`}>
                                            {opt.label}
                                          </span>
                                          {isRecommended && <span className="ml-auto text-[8px] font-bold text-emerald-400 bg-emerald-500/20 border border-emerald-500/30 rounded px-1 shrink-0">FIX</span>}
                                          {isActive && !isRecommended && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                                        </span>
                                        <span className={`text-[9px] font-mono mt-0.5 ${isActive ? 'text-amber-400/80' : isRecommended ? 'text-emerald-400/80' : 'text-slate-600'}`}>{opt.nec}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>

                      </div>

                      {/* Engineering Mode toggle — inline pill */}
                      <div className="mt-3 pt-3 border-t border-slate-700/30">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                            <Cpu size={10} /> Engineering Mode
                          </label>
                          <div className="flex rounded-lg overflow-hidden border border-slate-700/60 text-[11px]">
                            {(['AUTO', 'MANUAL'] as const).map((mode) => (
                              <button key={mode}
                                onClick={() => setEngineeringMode(mode)}
                                className={`px-3 py-1 font-bold transition-all border-r last:border-r-0 border-slate-700/60 ${
                                  engineeringMode === mode
                                    ? mode === 'AUTO' ? 'bg-emerald-500/25 text-emerald-300' : 'bg-amber-500/25 text-amber-300'
                                    : 'bg-slate-800/60 text-slate-500 hover:text-slate-200 hover:bg-slate-700/40'
                                }`}>
                                {mode === 'AUTO' ? '⚡ AUTO' : '✏️ MANUAL'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-600">
                          {engineeringMode === 'AUTO' ? 'Auto-resolves NEC violations and sizes conductors.' : 'Manual override — all values are user-controlled.'}
                        </p>
                      </div>
                    </div>

                    {/* ── Quick Design Notes ── */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-3 flex items-center gap-2 tracking-tight">
                        <FileText size={14} className="text-amber-400" /> Design Notes
                      </h3>
                      <textarea
                        value={(config as any).designNotes || ''}
                        onChange={e => updateConfig({ designNotes: e.target.value } as any)}
                        placeholder="Add design assumptions, site notes, AHJ requirements, special conditions..."
                        rows={4}
                        className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2.5 text-xs text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20"
                      />
                      <div className="mt-2.5 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-slate-900/50 border border-slate-700/40 px-3 py-2">
                          <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1 font-semibold">Est. Install Days</div>
                          <input
                            type="number" min="1" max="30"
                            value={(config as any).installDays || ''}
                            onChange={e => updateConfig({ installDays: Number(e.target.value) } as any)}
                            placeholder="—"
                            className="w-full bg-transparent text-sm font-bold text-amber-300 outline-none placeholder-slate-600"
                          />
                        </div>
                        <div className="rounded-lg bg-slate-900/50 border border-slate-700/40 px-3 py-2">
                          <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1 font-semibold">Permit Status</div>
                          <select
                            value={(config as any).permitStatus || 'Not Started'}
                            onChange={e => updateConfig({ permitStatus: e.target.value } as any)}
                            className="w-full bg-transparent text-xs font-bold text-slate-300 outline-none"
                          >
                            {['Not Started', 'In Progress', 'Submitted', 'Approved', 'Issued'].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                  </div>{/* end right col */}


                </div>{/* end 3-col grid */}

              </div>
            );
          })()}

          {/* ── COMPLIANCE TAB ── */}
          {activeTab === 'compliance' && (() => {
            const _ov   = compliance.overallStatus;
            const _el   = compliance.electrical?.status;
            const _st   = compliance.structural?.status;
            const _errC = rulesResult?.errorCount   ?? 0;
            const _wrnC = rulesResult?.warningCount ?? 0;
            const _pasC = (rulesResult?.rules?.filter((r: any) => r.severity === 'pass')?.length) ?? 0;
            const _totalRules = (_errC + _wrnC + _pasC) || 1;
            const _passRate   = Math.round((_pasC / _totalRules) * 100);

            const _sGlow = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'border-red-500/50 bg-red-500/10 text-red-400';
              if (s === 'WARNING') return 'border-amber-500/50 bg-amber-500/10 text-amber-400';
              if (s === 'PASS')    return 'border-emerald-500/40 bg-emerald-500/8 text-emerald-400';
              return 'border-slate-700/50 bg-slate-800/40 text-slate-500';
            };
            const _sDot = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.5)]';
              if (s === 'WARNING') return 'bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)]';
              if (s === 'PASS')    return 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]';
              return 'bg-slate-600';
            };
            const _sTxt = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'text-red-400';
              if (s === 'WARNING') return 'text-amber-400';
              if (s === 'PASS')    return 'text-emerald-400';
              return 'text-slate-500';
            };

            return (
              <div className="space-y-5 max-w-none">

                {/* ══ COMPLIANCE HERO ══════════════════════════════════════════ */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />

                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <ClipboardCheck size={16} className="text-emerald-400" />
                        NEC Compliance Engine
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {compliance.jurisdiction ? `NEC ${compliance.jurisdiction.necVersion} · ${compliance.jurisdiction.state}` : 'Jurisdiction not set'}
                        {compliance.jurisdiction?.ahjName ? ` · ${compliance.jurisdiction.ahjName}` : ''}
                      </p>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-black ${_sGlow(_ov)}`}>
                      <span className={`w-2 h-2 rounded-full ${_sDot(_ov)}`} />
                      {_ov || '—'}
                    </div>
                  </div>

                  {/* KPI strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                    <div className={`rounded-xl border px-3 py-2.5 text-center ${_sGlow(_ov)}`}>
                      <div className="text-2xl font-black tabular-nums">{_passRate}%</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Pass Rate</div>
                    </div>
                    <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-3 py-2.5 text-center">
                      <div className="text-2xl font-black text-red-400 tabular-nums">{_errC}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Errors</div>
                    </div>
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2.5 text-center">
                      <div className="text-2xl font-black text-amber-400 tabular-nums">{_wrnC}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Warnings</div>
                    </div>
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3 py-2.5 text-center">
                      <div className="text-2xl font-black text-emerald-400 tabular-nums">{_pasC}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Passing</div>
                    </div>
                    <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-2.5 text-center">
                      <div className="text-2xl font-black text-white tabular-nums">{_totalRules}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Total Rules</div>
                    </div>
                  </div>

                  {/* Subsystem status row */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Electrical', status: _el },
                      { label: 'Structural', status: _st },
                      { label: 'Overall',    status: _ov },
                    ].map(({ label, status }) => (
                      <div key={label} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-semibold ${_sGlow(status)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${_sDot(status)}`} />
                        {label}: {status || '—'}
                      </div>
                    ))}
                    {compliance.jurisdiction?.necVersion && (
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-400">
                        <Book size={10} /> NEC {compliance.jurisdiction.necVersion}
                      </div>
                    )}
                  </div>
                </div>

                {/* ══ 2-COL LAYOUT ══════════════════════════════════════════════ */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

                  {/* LEFT: Rule Results Accordion */}
                  <div className="xl:col-span-2 space-y-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Shield size={12} className="text-emerald-400" /> Rule Results
                      {rulesResult?.rules?.length > 0 && (
                        <span className="text-slate-600 font-normal">({rulesResult.rules.length} rules evaluated)</span>
                      )}
                    </h3>

                    {/* Error rules first */}
                    {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'error').length > 0 && (
                      <div className="rounded-xl border border-red-500/30 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
                          <AlertCircle size={13} className="text-red-400" />
                          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
                            Errors — {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'error').length} violations
                          </span>
                        </div>
                        <div className="divide-y divide-red-500/10">
                          {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'error').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-3 bg-red-500/5 hover:bg-red-500/8 transition-colors">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-red-300">{rule.ruleId || `Rule ${i+1}`}</span>
                                    {rule.necReference && <span className="text-[10px] font-mono text-red-500/70 bg-red-500/10 px-1.5 py-0.5 rounded">{rule.necReference}</span>}
                                  </div>
                                  <p className="text-xs text-red-200/80 leading-relaxed">{rule.message || rule.description}</p>
                                  {rule.detail && <p className="text-xs text-red-400/60 mt-1">{rule.detail}</p>}
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">FAIL</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Warning rules */}
                    {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'warning').length > 0 && (
                      <div className="rounded-xl border border-amber-500/30 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                          <AlertTriangle size={13} className="text-amber-400" />
                          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                            Warnings — {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'warning').length} items
                          </span>
                        </div>
                        <div className="divide-y divide-amber-500/10">
                          {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'warning').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-3 bg-amber-500/5 hover:bg-amber-500/8 transition-colors">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-amber-300">{rule.ruleId || `Rule ${i+1}`}</span>
                                    {rule.necReference && <span className="text-[10px] font-mono text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded">{rule.necReference}</span>}
                                  </div>
                                  <p className="text-xs text-amber-200/80 leading-relaxed">{rule.message || rule.description}</p>
                                  {rule.detail && <p className="text-xs text-amber-400/60 mt-1">{rule.detail}</p>}
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">WARN</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Passing rules */}
                    {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'pass').length > 0 && (
                      <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/8 border-b border-emerald-500/15">
                          <CheckCircle size={13} className="text-emerald-400" />
                          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                            Passing — {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'pass').length} rules
                          </span>
                        </div>
                        <div className="divide-y divide-emerald-500/8">
                          {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'pass').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-2.5 bg-emerald-500/3 hover:bg-emerald-500/6 transition-colors">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-emerald-300/80">{rule.ruleId || `Rule ${i+1}`}</span>
                                  {rule.necReference && <span className="text-[10px] font-mono text-emerald-600 bg-emerald-500/8 px-1.5 py-0.5 rounded">{rule.necReference}</span>}
                                  <span className="text-xs text-slate-500">{rule.message || rule.description}</span>
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">PASS</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty state */}
                    {(!rulesResult?.rules  || rulesResult.rules.length === 0) && (
                      <div className="card p-10 text-center border-dashed border-slate-700">
                        <ClipboardCheck size={36} className="mx-auto mb-3 text-slate-600" />
                        <div className="text-sm font-bold text-slate-400 mb-1">No Rules Evaluated</div>
                        <div className="text-xs text-slate-600">Complete system configuration to run NEC compliance checks.</div>
                      </div>
                    )}
                  </div>

                  {/* RIGHT: Summary + Auto-resolutions + Jurisdiction */}
                  <div className="space-y-4">

                    {/* Rule heat map */}
                    <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Activity size={12} className="text-amber-400" /> Compliance Heat Map
                      </h4>
                      {/* Progress bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-slate-500">Pass rate</span>
                          <span className={`font-bold ${_sTxt(_ov)}`}>{_passRate}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700/60 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              _passRate >= 80 ? 'bg-emerald-500' : _passRate >= 50 ? 'bg-amber-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${_passRate}%` }}
                          />
                        </div>
                      </div>
                      {/* Severity bars */}
                      <div className="space-y-1.5">
                        {[
                          { label: 'Errors', count: _errC, color: 'bg-red-500/70', textColor: 'text-red-400' },
                          { label: 'Warnings', count: _wrnC, color: 'bg-amber-500/70', textColor: 'text-amber-400' },
                          { label: 'Passing', count: _pasC, color: 'bg-emerald-500/70', textColor: 'text-emerald-400' },
                        ].map(({ label, count, color, textColor }) => (
                          <div key={label} className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 w-16 text-right">{label}</span>
                            <div className="flex-1 h-3 bg-slate-700/40 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${color}`}
                                style={{ width: `${_totalRules > 0 ? (count / _totalRules) * 100 : 0}%` }}
                              />
                            </div>
                            <span className={`text-xs font-bold w-5 tabular-nums ${textColor}`}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Auto-resolutions */}
                    {(compliance.electrical as any)?.autoResolutions?.length > 0 && (
                      <div className="rounded-xl border border-blue-500/25 bg-blue-500/8 p-4">
                        <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Zap size={12} /> Auto-Resolutions Applied
                        </h4>
                        <div className="space-y-1.5">
                          {(compliance.electrical as any).autoResolutions.map((r: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <CheckCircle size={11} className="text-blue-400 mt-0.5 flex-shrink-0" />
                              <span className="text-blue-200/80">
                                {typeof r === 'string' ? r : `${r.field}: ${r.originalValue} → ${r.resolvedValue}${r.necReference ? ` [${r.necReference}]` : ''}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Jurisdiction panel */}
                    {compliance.jurisdiction && (
                      <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <MapPin size={12} className="text-amber-400" /> Jurisdiction
                        </h4>
                        <div className="space-y-2">
                          {[
                            { label: 'State', value: compliance.jurisdiction.state },
                            { label: 'NEC Version', value: `NEC ${compliance.jurisdiction.necVersion}` },
                            { label: 'AHJ', value: compliance.jurisdiction.ahjName || '—' },
                            { label: 'Utility', value: compliance.jurisdiction.utilityName || compliance.utilityName || '—' },
                          ].map(({ label, value }) => (
                            <div key={label} className="flex items-center justify-between text-xs">
                              <span className="text-slate-500">{label}</span>
                              <span className="text-white font-semibold">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Electrical compliance detail */}
                    {compliance.electrical && (
                      <div className={`rounded-xl border p-4 ${_sGlow(_el)}`}>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Zap size={12} /> Electrical Compliance
                        </h4>
                        <div className="space-y-1.5 text-xs">
                          {(() => {
                            const elec = compliance.electrical as any;
                            const ic = elec?.interconnection;
                            const icMethod = String(ic?.method ?? config.interconnectionMethod ?? 'LOAD_SIDE').toUpperCase();
                            const isSupplySide = icMethod === 'SUPPLY_SIDE_TAP' || icMethod.includes('SUPPLY') || icMethod.includes('LINE_SIDE');
                            const isMainDerate = icMethod === 'MAIN_BREAKER_DERATE';
                            const isPanelUpgrade = icMethod === 'PANEL_UPGRADE';
                            // NEC 705.12(B): backfed breaker = min(solarBreakerRequired, maxAllowedSolarBreaker)
                            const solarRequired = ic?.solarBreakerRequired ?? elec?.acSizing?.ocpdAmps ?? 0;
                            const maxAllowed = (ic?.maxAllowedSolarBreaker != null && ic.maxAllowedSolarBreaker < 9999) ? ic.maxAllowedSolarBreaker : solarRequired;
                            const backfedBreakerAmps = Math.min(solarRequired, maxAllowed);
                            const isCapped = backfedBreakerAmps < solarRequired;
                            const showBackfedBreaker = !isSupplySide && !isMainDerate && !isPanelUpgrade && backfedBreakerAmps > 0;
                            return (
                              <>
                                {showBackfedBreaker && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Backfeed Breaker</span>
                                    <span className={`font-bold ${isCapped ? 'text-amber-400' : 'text-emerald-400'}`}>
                                      {backfedBreakerAmps}A{isCapped ? ' (120% cap)' : ''}
                                    </span>
                                  </div>
                                )}
                                {isSupplySide && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Interconnection</span>
                                    <span className="font-bold text-emerald-400">Supply-Side Tap (NEC 705.11)</span>
                                  </div>
                                )}
                                {elec?.acSizing?.ocpdAmps != null && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">OCPD</span>
                                    <span className="font-bold">{elec.acSizing.ocpdAmps}A</span>
                                  </div>
                                )}
                                {elec?.acSizing?.conductorGauge && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Conductor</span>
                                    <span className="font-bold">{elec.acSizing.conductorGauge}</span>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          {((compliance.electrical as any).errors?.length > 0 || (compliance.electrical as any).warnings?.length > 0) && (
                            <div className="mt-2 pt-2 border-t border-current/20">
                              <div className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70">Issues</div>
                              {[...((compliance.electrical as any).errors ?? []), ...((compliance.electrical as any).warnings ?? [])].map((v: any, i: number) => (
                                <div key={i} className="flex items-start gap-1.5 mb-1">
                                  <AlertCircle size={10} className="mt-0.5 flex-shrink-0" />
                                  <span className="opacity-80">{typeof v === 'string' ? v : v.message || v.description || v.reason || String(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Structural compliance detail */}
                    {compliance.structural && (() => {
                      const _str = compliance.structural as any;
                      return (
                        <div className={`rounded-xl border p-4 ${_sGlow(_st)}`}>
                          <h4 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Wrench size={12} /> Structural Compliance
                          </h4>
                          <div className="space-y-1.5 text-xs">
                            {/* Wind uplift */}
                            {_str.wind?.netUpliftPressurePsf != null && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Net Uplift</span>
                                <span className="font-bold">{_str.wind?.netUpliftPressurePsf?.toFixed(1)} psf</span>
                              </div>
                            )}
                            {/* Snow load */}
                            {_str.snow?.roofSnowLoadPsf != null && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Roof Snow Load</span>
                                <span className="font-bold">{_str.snow?.roofSnowLoadPsf?.toFixed(1)} psf</span>
                              </div>
                            )}
                            {/* Dead load */}
                            {_str.addedDeadLoadPsf != null && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Added Dead Load</span>
                                <span className="font-bold">{_str.addedDeadLoadPsf?.toFixed(2)} psf</span>
                              </div>
                            )}
                            {/* System weight */}
                            {_str.totalSystemWeightLbs != null && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">System Weight</span>
                                <span className="font-bold">{_str.totalSystemWeightLbs?.toFixed(0)} lbs</span>
                              </div>
                            )}
                            {/* Mount layout */}
                            {_str.mountLayout?.mountSpacingIn != null && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Attachment Spacing</span>
                                <span className="font-bold">{(_str.mountLayout?.mountSpacingIn / 12).toFixed(1)} ft</span>
                              </div>
                            )}
                            {_str.mountLayout?.mountCount != null && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Mount Count</span>
                                <span className="font-bold">{_str.mountLayout?.mountCount}</span>
                              </div>
                            )}
                            {_str.mountLayout?.safetyFactor != null && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Safety Factor</span>
                                <span className={`font-bold ${_str.mountLayout?.safetyFactor >= 1.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                  {_str.mountLayout?.safetyFactor?.toFixed(2)}×
                                </span>
                              </div>
                            )}
                            {_str.mountLayout?.upliftPerMountLbs != null && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Uplift / Mount</span>
                                <span className="font-bold">{_str.mountLayout?.upliftPerMountLbs?.toFixed(0)} lbs</span>
                              </div>
                            )}
                            {/* Rafter analysis */}
                            {_str.rafterAnalysis && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Framing</span>
                                  <span className="font-bold capitalize">{_str.rafterAnalysis?.framingType} {_str.rafterAnalysis?.size}</span>
                                </div>
                                {_str.rafterAnalysis?.overallUtilization != null && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Rafter Utilization</span>
                                    <span className={`font-bold ${_str.rafterAnalysis?.overallUtilization > 0.9 ? 'text-red-400' : _str.rafterAnalysis?.overallUtilization > 0.75 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                      {(_str.rafterAnalysis?.overallUtilization * 100)?.toFixed(0)}%
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                            {/* Structural errors + warnings */}
                            {((_str.errors?.length ?? 0) + (_str.warnings?.length ?? 0)) > 0 && (
                              <div className="mt-2 pt-2 border-t border-current/20">
                                <div className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70">Structural Issues</div>
                                {[...(_str.errors ?? []), ...(_str.warnings ?? [])].map((issue: any, i: number) => (
                                  <div key={i} className="flex items-start gap-1.5 mb-1">
                                    <AlertCircle size={10} className="mt-0.5 flex-shrink-0" />
                                    <span className="opacity-80">{issue.message}{issue.suggestion ? ` — ${issue.suggestion}` : ''}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Recommendations */}
                            {_str.recommendations?.length > 0 && (
                              <div className="mt-1.5 pt-1.5 border-t border-current/10 space-y-0.5">
                                {_str.recommendations.map((rec: string, i: number) => (
                                  <div key={i} className="flex items-start gap-1 text-[10px] opacity-60">
                                    <span>→</span><span>{rec}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                  </div>
                </div>

                {/* ValidationPanel (existing component — preserved) */}
                {validationResult && (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Shield size={12} className="text-amber-400" /> System Validation
                    </h3>
                    <ValidationPanel
                      result={validationResult}
                      complianceStatus={compliance.overallStatus ?? rulesResult?.overallStatus ?? null}
                      sizingRecommendation={sizingRecommendation}
                      onApplySizingFix={(rec) => {
                        applySizingRecommendation(rec);
                      }}
                      selectedLayoutCandidate={sizingRecommendation?.selectedLayoutCandidate ?? null}
                    />
                  </div>
                )}

              </div>
            );
          })()}

          {/* ── ELECTRICAL SIZING TAB ── */}
          {activeTab === 'electrical' && (() => {
            const elec     = compliance.electrical as any;
            const acSizing = elec?.acSizing;
            const _st      = elec?.status;
            const _sGlow = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'border-red-500/50 bg-red-500/10 text-red-400';
              if (s === 'WARNING') return 'border-amber-500/50 bg-amber-500/10 text-amber-400';
              if (s === 'PASS')    return 'border-emerald-500/40 bg-emerald-500/8 text-emerald-400';
              return 'border-slate-700/50 bg-slate-800/40 text-slate-500';
            };
            const _sDot = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.5)]';
              if (s === 'WARNING') return 'bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)]';
              if (s === 'PASS')    return 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]';
              return 'bg-slate-600';
            };
            const _sTxt = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'text-red-400';
              if (s === 'WARNING') return 'text-amber-400';
              if (s === 'PASS')    return 'text-emerald-400';
              return 'text-slate-500';
            };

            const acAmps   = Math.round(canonicalAcKw * 1000 / 240); // v58.0: use canonical AC kW
            const ocpdAmps = acSizing?.ocpdAmps ?? Math.ceil(acAmps * 1.25 / 5) * 5;

            return (
              <div className="space-y-5 max-w-none">

                {/* ══ ELECTRICAL HERO ══════════════════════════════════════════ */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <Zap size={16} className="text-blue-400" />
                        Electrical Sizing
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        NEC 705.60 · 310.16 · Ch.9 · {cs.isMicro ? 'Microinverter topology' : 'String inverter topology'}
                      </p>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-black ${_sGlow(_st)}`}>
                      <span className={`w-2 h-2 rounded-full ${_sDot(_st)}`} />
                      {_st || '—'}
                    </div>
                  </div>

                  {/* KPI grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-blue-400 tabular-nums">{canonicalAcKw.toFixed(2)}kW</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">AC Output</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-amber-400 tabular-nums">{acAmps}A</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">AC Current</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-white tabular-nums">{ocpdAmps}A</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">OCPD</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-emerald-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-emerald-400 tabular-nums">{config.mainPanelAmps || 200}A</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Main Panel</div>
                    </div>
                  </div>

                  {/* Backfeed / 120% rule strip */}
                  {acSizing && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300">
                        <Activity size={10} className="text-blue-400" />
                        Backfeed: {cs.backfeedBreakerAmps ?? ocpdAmps}A
                      </div>
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300">
                        <Zap size={10} className="text-amber-400" />
                        Interconnection: {config.interconnectionMethod || '—'}
                      </div>
                      {(elec?.errors?.length > 0 || elec?.warnings?.length > 0) && (
                        <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 font-semibold">
                          <AlertCircle size={10} /> {(elec?.errors?.length ?? 0) + (elec?.warnings?.length ?? 0)} issue{((elec?.errors?.length ?? 0) + (elec?.warnings?.length ?? 0)) !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ══ 2-COL LAYOUT ══════════════════════════════════════════════ */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

                  {/* LEFT: Conductor & Equipment Cards */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Activity size={12} className="text-blue-400" /> Equipment Sizing
                    </h3>

                    {acSizing ? (
                      <div className="space-y-3">
                        {/* AC Conductor card */}
                        <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-blue-400 flex items-center gap-2">
                              <GitBranch size={12} /> System AC Output Conductor
                            </h4>
                            <span className="text-[10px] font-mono text-blue-500/70 bg-blue-500/10 px-2 py-0.5 rounded">NEC 310.16</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                           {/* v58.0: clarify branch vs aggregate */}
                           {!cs.isMicro && config.inverters.length > 1 && (
                             <div className="mb-2 px-2 py-1.5 rounded bg-blue-500/8 border border-blue-500/20 text-[10px] text-blue-300">
                               <span className="font-semibold">Per-inverter branch:</span>
                               {' '}{canonicalAcKw > 0 ? (canonicalAcKw / config.inverters.length).toFixed(2) : '—'} kW
                               {' '}({acAmps > 0 ? Math.round(acAmps / config.inverters.length) : '—'}A) per unit.
                               {' '}Aggregate system: {canonicalAcKw.toFixed(2)} kW total.
                             </div>
                           )}
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-white">{acSizing.conductorLabel || acSizing.conductorGauge}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Conductor</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-white">{acSizing.conductorAmpacity || acSizing.ocpdAmps}A</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Ampacity</div>
                            </div>
                          </div>
                        </div>

                        {/* Conduit card */}
                        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-slate-300 flex items-center gap-2">
                              <Wrench size={12} /> Conduit
                            </h4>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-700/40 px-2 py-0.5 rounded">NEC Ch.9</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-slate-900/50 rounded-lg p-2 text-center">
                              <div className="text-sm font-black text-white">{acSizing.conduitSize}"</div>
                              <div className="text-[10px] text-slate-500">Size</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2 text-center">
                              <div className="text-sm font-black text-white">{acSizing.conduitType || config.conduitType || 'EMT'}</div>
                              <div className="text-[10px] text-slate-500">Type</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2 text-center">
                              <div className={`text-sm font-black ${(acSizing.conduitFillPct ?? 0) > 40 ? 'text-red-400' : 'text-emerald-400'}`}>
                                {acSizing.conduitFillPct?.toFixed(1) ?? '—'}%
                              </div>
                              <div className="text-[10px] text-slate-500">Fill</div>
                            </div>
                          </div>
                        </div>

                        {/* Disconnect card */}
                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-amber-400 flex items-center gap-2">
                              <Power size={12} /> Disconnect & OCPD
                            </h4>
                            <span className="text-[10px] font-mono text-amber-500/70 bg-amber-500/10 px-2 py-0.5 rounded">NEC 690.14</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-amber-400">{acSizing.disconnectAmps}A</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{acSizing.disconnectType === 'fused' ? 'Fusible Disconnect' : 'Non-Fused Disconnect'}</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-amber-400">{acSizing.ocpdAmps}A</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Backfeed OCPD</div>
                            </div>
                          </div>
                          {acSizing.disconnectType === 'fused' && acSizing.fuseAmps && (
                            <div className="mt-2 p-2 bg-amber-500/8 rounded-lg text-xs text-amber-300 flex items-center gap-2">
                              <AlertTriangle size={10} />
                              Fused: {acSizing.fuseAmps}A × 2 Class R (NEC 690.9)
                            </div>
                          )}
                        </div>

                        {/* Grounding card */}
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                              <Shield size={12} /> Grounding
                            </h4>
                            <span className="text-[10px] font-mono text-emerald-600 bg-emerald-500/8 px-2 py-0.5 rounded">NEC 250.66</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-emerald-400">{acSizing.groundingConductor}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">EGC</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-white">Bare Copper</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Material</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="card p-10 text-center border-dashed border-slate-700">
                        <Zap size={36} className="mx-auto mb-3 text-slate-600" />
                        <div className="text-sm font-bold text-slate-400 mb-1">Electrical sizing not computed</div>
                        <div className="text-xs text-slate-600">Complete system configuration to generate conductor sizing.</div>
                      </div>
                    )}
                  </div>

                  {/* RIGHT: Conduit Schedule + Violations */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <FileText size={12} className="text-blue-400" /> Conduit & Conductor Schedule
                      <span className="text-slate-600 font-normal text-[10px]">Auto-calculated · NEC Ch.9</span>
                    </h3>

                    {/* Issues inline */}
                    {(elec?.errors?.length > 0 || elec?.warnings?.length > 0) && (
                      <div className="space-y-2">
                        <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-4 space-y-2">
                          <h4 className="text-xs font-bold text-red-400 flex items-center gap-2">
                            <AlertCircle size={12} /> {(elec?.errors?.length ?? 0) + (elec?.warnings?.length ?? 0)} Electrical Issue{((elec?.errors?.length ?? 0) + (elec?.warnings?.length ?? 0)) !== 1 ? 's' : ''}
                          </h4>
                          {[...(elec?.errors ?? []), ...(elec?.warnings ?? [])].map((v: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-red-300/80">
                              <span className="text-red-500 mt-0.5">•</span>
                              <span>
                                {v.code && <span className="font-mono text-red-400 font-bold mr-1">[{v.code}]</span>}
                                {typeof v === 'string' ? v : v.message || v.description || v.reason || String(v)}
                                {v.suggestion && <span className="text-amber-400/70 ml-1"> → {v.suggestion}</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                        {/* Busbar 120% violation: show alternatives panel */}
                        {elec?.errors?.some((e: any) => e.code === 'E-BUSBAR-120') && elec?.interconnection?.alternatives?.length > 0 && (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
                            <h4 className="text-xs font-bold text-amber-400 flex items-center gap-2 mb-3">
                              <Zap size={12} /> 120% Busbar Violation — Resolution Options (NEC 705)
                            </h4>
                            <div className="space-y-2">
                              {elec.interconnection.alternatives.map((alt: any, i: number) => (
                                <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg border text-xs ${alt.passes ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-slate-700/50 bg-slate-800/40'}`}>
                                  <div className={`w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center text-[10px] font-bold ${alt.passes ? 'bg-emerald-500 text-white' : 'bg-slate-600 text-slate-400'}`}>
                                    {alt.passes ? '✓' : '✗'}
                                  </div>
                                  <div className="flex-1">
                                    <div className={`font-bold ${alt.passes ? 'text-emerald-400' : 'text-slate-400'}`}>{alt.label}</div>
                                    <div className="text-slate-500 mt-0.5">{alt.description}</div>
                                    {alt.method === 'SUPPLY_SIDE_TAP' && alt.passes && (
                                      <button
                                        onClick={() => updateConfig({ interconnectionMethod: 'SUPPLY_SIDE_TAP' })}
                                        className="mt-1.5 text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 transition-colors font-semibold"
                                      >
                                        Apply Supply-Side Tap →
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Auto-resolutions log */}
                        {elec?.autoResolutions?.length > 0 && (
                          <details className="group">
                            <summary className="text-xs text-amber-400/70 cursor-pointer hover:text-amber-400 flex items-center gap-1.5 px-1">
                              <span className="group-open:rotate-90 transition-transform inline-block">›</span>
                              {elec.autoResolutions.length} auto-resolution{elec.autoResolutions.length !== 1 ? 's' : ''} applied
                            </summary>
                            <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
                              {elec.autoResolutions.map((r: any, i: number) => (
                                <div key={i} className="text-xs text-amber-300/70">
                                  <span className="font-mono text-amber-400">{r.field}</span>: {r.originalValue} → <span className="font-bold text-amber-300">{r.resolvedValue}</span>
                                  <span className="text-slate-500 ml-1">({r.necReference})</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}

                    {/* Conduit schedule table */}
                    {cs.conduitSchedule?.length > 0 ? (
                      <div className="rounded-xl border border-slate-700/60 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-800/80 border-b border-slate-700/50">
                                {['Raceway','From','To','Type','Size','Conductors','EGC','OCPD','V-Drop','✓'].map(h => (
                                  <th key={h} className="text-left text-slate-500 px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/30">
                              {cs.conduitSchedule.map((row: any, idx: number) => (
                                <tr key={row.raceway || idx} className="hover:bg-slate-800/30 transition-colors">
                                  <td className="px-3 py-2 font-semibold text-white whitespace-nowrap">{row.raceway}</td>
                                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{row.from}</td>
                                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{row.to}</td>
                                  <td className="px-3 py-2 text-slate-300">{row.conduitType}</td>
                                  <td className="px-3 py-2 font-bold text-amber-400">{row.conduitSize}"</td>
                                  <td className="px-3 py-2 font-mono text-slate-300">{row.conductors}</td>
                                  <td className="px-3 py-2 text-slate-400">{row.egc}</td>
                                  <td className="px-3 py-2 font-bold text-slate-300">{row.ocpd ?? '—'}</td>
                                  <td className={`px-3 py-2 font-bold ${parseFloat(row.voltageDrop ?? '0') > 3 ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {row.voltageDrop ?? '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    {row.pass
                                      ? <CheckCircle size={12} className="text-emerald-400" />
                                      : <AlertCircle size={12} className="text-red-400" />
                                    }
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="card p-8 text-center border-dashed border-slate-700">
                        <Activity size={28} className="mx-auto mb-2 text-slate-600" />
                        <div className="text-xs text-slate-500">No conduit schedule computed yet.</div>
                      </div>
                    )}

                    {/* Wire runs detail */}
                    {cs.runs?.length > 0 && (
                      <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <GitBranch size={12} className="text-blue-400" /> Wire Runs
                        </h4>
                        <div className="space-y-2">
                          {cs.runs.map((run: any, i: number) => (
                            <div key={run.id || i} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-700/30 last:border-0">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${run.overallPass ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                <span className="text-slate-300 font-medium">{run.id || run.label}</span>
                              </div>
                              <div className="flex items-center gap-3 text-slate-500">
                                {run.wireGauge && <span className="text-white font-bold">{run.wireGauge}</span>}
                                {run.ocpdAmps  && <span>{run.ocpdAmps}A OCPD</span>}
                                {run.conduitSize && <span>{run.conduitSize}" {run.conduitType}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            );
          })()}

          {/* ── STRUCTURAL TAB ── */}
          {activeTab === 'structural' && (
            <div className="max-w-none space-y-5">
              {/* ══════════ STRUCTURAL INTEGRITY HERO ══════════ */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl mb-5">
                <div className="absolute -top-8 -right-8 w-36 h-36 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
                <div className="flex items-center gap-2 mb-4">
                  <Wind size={14} className="text-amber-400" />
                  <span className="text-sm font-bold text-white">Structural Analysis</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-mono ml-auto">
                    ASCE 7 · IBC
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                    <div className="text-xl font-black text-amber-400 tabular-nums">{config.windSpeed || 115}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">mph Wind</div>
                  </div>
                  <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 text-center">
                    <div className="text-xl font-black text-blue-400 tabular-nums">{config.groundSnowLoad ?? 0}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">psf Snow</div>
                  </div>
                  <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 text-center">
                    <div className="text-xl font-black text-white tabular-nums">{totalPanels}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Panels</div>
                  </div>
                  <div className="rounded-xl bg-slate-900/60 border border-emerald-500/20 px-3 py-2.5 text-center">
                    <div className="text-xl font-black text-emerald-400 tabular-nums">{config.roofPitch ?? 'N/A'}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Pitch</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                    Racking · Lag Pattern · Load Path · Attachment
                  </div>
                  {config.roofType && (
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 font-semibold">
                      <CheckCircle size={10} /> {config.roofType}
                    </div>
                  )}
                </div>
              </div>
              <div className="eng-panel">
                <h3 className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight"><Wind size={14} className="text-amber-400" /> Site & Wind Parameters</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="eng-label">Design Wind Speed (mph)</label>
                    <input type="number" value={config.windSpeed} onChange={e => updateConfig({ windSpeed: +e.target.value })}
                      className="eng-input" />
                  </div>
                  <div>
                    <label className="eng-label">Wind Exposure Category</label>
                    <select value={config.windExposure} onChange={e => updateConfig({ windExposure: e.target.value as 'B' | 'C' | 'D' })}
                      className="eng-select">
                      <option value="B">B — Suburban/Wooded</option>
                      <option value="C">C — Open Terrain</option>
                      <option value="D">D — Coastal/Water</option>
                    </select>
                  </div>
                  <div>
                    <label className="eng-label">Ground Snow Load (psf)</label>
                    <input type="number" value={config.groundSnowLoad} onChange={e => updateConfig({ groundSnowLoad: +e.target.value })}
                      className="eng-input" />
                  </div>
                  <div>
                    <label className="eng-label">Roof Pitch (degrees)</label>
                    <input type="number" min={0} max={60} value={config.roofPitch} onChange={e => updateConfig({ roofPitch: +e.target.value })}
                      className="eng-input" />
                  </div>
                  <div>
                    <label className="eng-label">Mean Roof Height (ft)</label>
                    <div className="flex gap-1 items-center">
                      <input type="number" min={8} max={60} step={1}
                        value={config.meanRoofHeight ?? 15}
                        onChange={e => updateConfig({ meanRoofHeight: +e.target.value })}
                        className="eng-input flex-1" />
                      <select
                        onChange={e => { if (e.target.value) updateConfig({ meanRoofHeight: +e.target.value }); }}
                        className="eng-select w-auto text-xs px-1"
                        title="Quick select by story count"
                        defaultValue=""
                      >
                        <option value="">Story</option>
                        <option value={15}>1-Story (~15 ft)</option>
                        <option value={25}>2-Story (~25 ft)</option>
                        <option value={35}>3-Story (~35 ft)</option>
                      </select>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">ASCE 7-22 Kz &mdash; eave-to-ridge midpoint</div>
                  </div>
                  <div>
                    <label className="eng-label">Panel Orientation</label>
                    <select value={config.panelOrientation ?? 'portrait'} onChange={e => updateConfig({ panelOrientation: e.target.value as 'portrait' | 'landscape' })}
                      className="eng-select">
                      <option value="portrait">Portrait (vertical)</option>
                      <option value="landscape">Landscape (horizontal)</option>
                    </select>
                    <div className="text-xs text-slate-500 mt-0.5">Affects array geometry & structural calc</div>
                  </div>
                </div>
              </div>
              <div className="eng-panel">
                <h3 className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight"><Ruler size={14} className="text-amber-400" /> Roof Framing</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="eng-label">Framing Type</label>
                    <select value={config.framingType} onChange={e => updateConfig({ framingType: e.target.value as 'truss' | 'rafter' | 'unknown' })}
                      className="eng-select">
                      <option value="unknown">Auto-Detect (24" OC = Truss)</option>
                      <option value="truss">Truss (Pre-Engineered)</option>
                      <option value="rafter">Rafter (Stick-Built)</option>
                    </select>
                  </div>
                  <div>
                    <label className="eng-label">Rafter Size</label>
                    <select value={config.rafterSize} onChange={e => updateConfig({ rafterSize: e.target.value })}
                      className="eng-select">
                      {['2x4', '2x6', '2x8', '2x10', '2x12'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="eng-label">Rafter Spacing (in O.C.)</label>
                    <select value={config.rafterSpacing} onChange={e => updateConfig({ rafterSpacing: +e.target.value })}
                      className="eng-select">
                      {[12, 16, 19.2, 24].map(s => <option key={s} value={s}>{s}"</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="eng-label">Rafter Span (ft)</label>
                    <input type="number" min={4} max={30} value={config.rafterSpan} onChange={e => updateConfig({ rafterSpan: +e.target.value })}
                      className="eng-input" />
                  </div>
                  <div>
                    <label className="eng-label">Wood Species</label>
                    <select value={config.rafterSpecies} onChange={e => updateConfig({ rafterSpecies: e.target.value })}
                      className="eng-select">
                      {['Douglas Fir-Larch', 'Southern Pine', 'Hem-Fir', 'Spruce-Pine-Fir'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="eng-panel">
                <h3 className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight"><Weight size={14} className="text-amber-400" /> Racking System</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="eng-label">Mount Brand</label>
                    <select
                      value={ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.manufacturer ?? MOUNTING_BRANDS[0]}
                      onChange={e => {
                        const first = ALL_MOUNTING_SYSTEMS.find(s => s.manufacturer === e.target.value);
                        if (first) updateConfig({ mountingId: first.id });
                      }}
                      className="eng-select"
                    >
                      {MOUNTING_BRANDS.map(brand => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="eng-label">Mount Type / Model</label>
                    <select value={config.mountingId} onChange={e => updateConfig({ mountingId: e.target.value })}
                      className="eng-select">
                      {ALL_MOUNTING_SYSTEMS
                        .filter(s => s.manufacturer === (ALL_MOUNTING_SYSTEMS.find(x => x.id === config.mountingId)?.manufacturer ?? MOUNTING_BRANDS[0]))
                        .map(s => <option key={s.id} value={s.id}>{s.model}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="eng-label">Panel Orientation</label>
                    <select value={config.panelOrientation ?? 'portrait'} onChange={e => updateConfig({ panelOrientation: e.target.value as 'portrait' | 'landscape' })}
                      className="eng-select">
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                </div>
                {/* Calculated mount spacing display */}
                {compliance.structural?.mountLayout ? (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">Calc. Mount Spacing</div>
                      <div className="text-lg font-bold text-amber-400">{compliance.structural.mountLayout.mountSpacingIn ?? compliance.structural.mountLayout.finalSpacingIn ?? '—'}"</div>
                      <div className="text-xs text-slate-500">O.C. (from loads)</div>
                    </div>
                    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">Total Mounts</div>
                      <div className="text-lg font-bold text-white">{compliance.structural.mountLayout.mountCount ?? '—'}</div>
                      <div className="text-xs text-slate-500">attachments</div>
                    </div>
                    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">Uplift / Mount</div>
                      <div className="text-lg font-bold text-amber-400">{compliance.structural.mountLayout.upliftPerMountLbs?.toFixed(0) ?? compliance.structural.mountLayout.upliftPerMount?.toFixed(0) ?? '—'} lbs</div>
                      <div className="text-xs text-slate-500">demand</div>
                    </div>
                    <div className="bg-slate-800/40 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">Safety Factor</div>
                      <div className={`text-lg font-bold ${(compliance.structural.mountLayout.safetyFactor ?? 0) >= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {compliance.structural.mountLayout.safetyFactor?.toFixed(2) ?? '—'}
                      </div>
                      <div className="text-xs text-slate-500">capacity/demand</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-slate-500 italic">Run calculation to see computed mount spacing and loads.</div>
                )}
                {/* Selected mount structural specs */}
                {(() => {
                  const sel = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
                  if (!sel) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2">
                      <span>System: <span className="text-white font-bold">{sel.productLine} {sel.model}</span></span>
                      <span>Type: <span className="text-amber-300 font-bold">{sel.systemType.replace(/_/g, ' ')}</span></span>
                      {sel.mount?.fastenersPerMount && <span>Fasteners/mount: <span className="text-amber-300 font-bold">{sel.mount.fastenersPerMount}</span></span>}
                      {sel.mount?.upliftCapacityLbs && <span>Uplift capacity: <span className="text-amber-300 font-bold">{sel.mount.upliftCapacityLbs} lbf</span></span>}
                      {sel.mount?.maxSpacingIn && <span>Max spacing: <span className="text-slate-300 font-bold">{sel.mount.maxSpacingIn}&quot;</span></span>}
                      {sel.maxWindSpeedMph && <span>Max wind: <span className="text-slate-300 font-bold">{sel.maxWindSpeedMph} mph</span></span>}
                      {sel.maxSnowLoadPsf && <span>Max snow: <span className="text-slate-300 font-bold">{sel.maxSnowLoadPsf} psf</span></span>}
                      {sel.ul2703Listed && <span className="text-emerald-400 font-bold">✓ UL 2703</span>}
                      <span className="text-slate-500 italic ml-auto">Mount spacing is calculated from wind/snow loads.</span>
                    </div>
                  );
                })()}
              </div>
              {compliance.structural && (
                <div className="eng-panel">
                  <h3 className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight">
                    <BarChart2 size={14} className="text-amber-400" /> Structural Analysis Results
                    <StatusBadge status={compliance.structural.status} size="sm" />
                  </h3>
                  {/* Array Geometry Summary */}
                  {compliance.structural.arrayGeometry && (
                    <div className="mb-4 bg-slate-800/40 rounded-xl p-4">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1"><Grid size={11} /> Array Geometry</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div className="flex justify-between"><span className="text-slate-400">Array Size</span><span className="text-white">{compliance.structural.arrayGeometry.colCount} × {compliance.structural.arrayGeometry.rowCount}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Array Width</span><span className="text-white">{(compliance.structural.arrayGeometry.arrayWidthIn / 12).toFixed(1)} ft</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Array Height</span><span className="text-white">{(compliance.structural.arrayGeometry.arrayHeightIn / 12).toFixed(1)} ft</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Rail Length</span><span className="text-white">{compliance.structural.arrayGeometry.railLengthFt?.toFixed(1)} ft</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Rail Count</span><span className="text-white">{compliance.structural.arrayGeometry.railCount}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">System Weight</span><span className="text-white">{compliance.structural.totalSystemWeightLbs?.toFixed(0)} lbs</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Added Dead Load</span><span className="text-white">{compliance.structural.addedDeadLoadPsf?.toFixed(1)} psf</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Mid Clamps</span><span className="text-white">{compliance.structural.arrayGeometry.totalMidClamps}</span></div>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Wind Analysis */}
                    <div className="bg-slate-800/40 rounded-xl p-4">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1"><Wind size={11} /> Wind Analysis</div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-slate-400">Velocity Pressure (qz)</span><span className="text-white">{(compliance.structural.wind?.velocityPressurePsf ?? compliance.structural.wind?.velocityPressure)?.toFixed(2)} psf</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Net Uplift Pressure</span><span className="text-amber-400 font-bold">{(compliance.structural.wind?.netUpliftPressurePsf ?? compliance.structural.wind?.netUpliftPressure)?.toFixed(2)} psf</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Uplift per Mount</span><span className="text-amber-400 font-bold">{(compliance.structural.mountLayout?.upliftPerMountLbs ?? compliance.structural.wind?.upliftPerAttachment)?.toFixed(0)} lbs</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Roof Zone</span><span className="text-white capitalize">{compliance.structural.wind?.roofZone ?? 'interior'}</span></div>
                      </div>
                    </div>
                    {/* Snow Analysis */}
                    <div className="bg-slate-800/40 rounded-xl p-4">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1"><Snowflake size={11} /> Snow Analysis</div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-slate-400">Ground Snow Load</span><span className="text-white">{compliance.structural.snow?.groundSnowLoadPsf ?? compliance.structural.snow?.groundSnowLoad} psf</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Roof Snow Load</span><span className="text-white">{(compliance.structural.snow?.roofSnowLoadPsf ?? compliance.structural.snow?.roofSnowLoad)?.toFixed(1)} psf</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Slope Factor (Cs)</span><span className="text-white">{compliance.structural.snow?.slopeFactor?.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Snow per Mount</span><span className="text-white">{compliance.structural.mountLayout?.downwardPerMountLbs?.toFixed(0)} lbs</span></div>
                      </div>
                    </div>
                    {/* Rafter / Framing Analysis */}
                    <div className="bg-slate-800/40 rounded-xl p-4">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1"><Ruler size={11} /> {compliance.structural.rafterAnalysis?.framingType === 'truss' ? 'Truss Analysis' : 'Rafter Analysis (NDS 2018)'}</div>
                      <div className="space-y-1.5 text-xs">
                        {compliance.structural.rafterAnalysis?.framingType === 'truss' ? (
                          <>
                            <div className="flex justify-between"><span className="text-slate-400">Framing Type</span><span className="text-white">Pre-Engineered Truss</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">Total Load</span><span className="text-white">{compliance.structural.rafterAnalysis?.totalLoadPsf?.toFixed(1)} psf</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">Utilization</span>
                              <span className={(compliance.structural.rafterAnalysis?.overallUtilization ?? 0) > 1 ? 'text-red-400 font-bold' : (compliance.structural.rafterAnalysis?.overallUtilization ?? 0) > 0.85 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                                {((compliance.structural.rafterAnalysis?.overallUtilization ?? compliance.structural.rafter?.utilizationRatio ?? 0) * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex justify-between"><span className="text-slate-400">Status</span><span className={compliance.structural.rafterAnalysis?.passes ? 'text-emerald-400' : 'text-red-400'}>{compliance.structural.rafterAnalysis?.passes ? 'PASS' : 'FAIL'}</span></div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between"><span className="text-slate-400">Bending Moment</span><span className="text-white">{(compliance.structural.rafterAnalysis?.bendingMomentDemandFtLbs ?? compliance.structural.rafter?.bendingMoment)?.toFixed(0)} ft-lbs</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">Allowable Moment</span><span className="text-white">{(compliance.structural.rafterAnalysis?.bendingMomentCapacityFtLbs ?? compliance.structural.rafter?.allowableBendingMoment)?.toFixed(0)} ft-lbs</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">Utilization Ratio</span>
                              <span className={(compliance.structural.rafterAnalysis?.overallUtilization ?? compliance.structural.rafter?.utilizationRatio ?? 0) > 1 ? 'text-red-400 font-bold' : (compliance.structural.rafterAnalysis?.overallUtilization ?? compliance.structural.rafter?.utilizationRatio ?? 0) > 0.85 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                                {((compliance.structural.rafterAnalysis?.overallUtilization ?? compliance.structural.rafter?.utilizationRatio ?? 0) * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex justify-between"><span className="text-slate-400">Deflection / Allow.</span><span className="text-white">{(compliance.structural.rafterAnalysis?.deflectionIn ?? compliance.structural.rafter?.deflection)?.toFixed(3)}" / {(compliance.structural.rafterAnalysis?.allowableDeflectionIn ?? compliance.structural.rafter?.allowableDeflection)?.toFixed(3)}"</span></div>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Mount / Attachment Analysis */}
                    <div className="bg-slate-800/40 rounded-xl p-4">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1"><Weight size={11} /> Mount Analysis</div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-slate-400">Mount Capacity</span><span className="text-white">{(compliance.structural.mountLayout?.mountCapacityLbs ?? compliance.structural.attachment?.lagBoltCapacity)?.toFixed(0)} lbs</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Uplift per Mount</span><span className="text-amber-400">{(compliance.structural.mountLayout?.upliftPerMountLbs ?? compliance.structural.attachment?.upliftPerAttachment)?.toFixed(0)} lbs</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Safety Factor</span>
                          <span className={(compliance.structural.mountLayout?.safetyFactor ?? compliance.structural.attachment?.safetyFactor ?? 0) < 1.5 ? 'text-red-400 font-bold' : (compliance.structural.mountLayout?.safetyFactor ?? compliance.structural.attachment?.safetyFactor ?? 0) < 2.5 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                            {(compliance.structural.mountLayout?.safetyFactor ?? compliance.structural.attachment?.safetyFactor)?.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between"><span className="text-slate-400">Calc. Spacing</span><span className="text-white">{compliance.structural.mountLayout?.mountSpacingIn ?? compliance.structural.mountLayout?.finalSpacingIn ?? compliance.structural.attachment?.maxAllowedSpacing}"</span></div>
                        {compliance.structural.mountLayout?.spacingWasReduced && (
                          <div className="text-amber-400 text-xs mt-1">⚠ Spacing auto-reduced for safety</div>
                        )}
                      </div>
                    </div>
                    {/* Rail Analysis (if applicable) */}
                    {compliance.structural.railAnalysis && (
                      <div className="bg-slate-800/40 rounded-xl p-4 md:col-span-2">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1"><Ruler size={11} /> Rail Analysis</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div className="flex justify-between"><span className="text-slate-400">Rail Count</span><span className="text-white">{compliance.structural.railAnalysis.railCount}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Rail Length</span><span className="text-white">{compliance.structural.railAnalysis.railLengthFt?.toFixed(1)} ft</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Rail Span</span><span className="text-white">{compliance.structural.railAnalysis.railSpanIn}" (max {compliance.structural.railAnalysis.maxAllowedSpanIn}")</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Cantilever</span><span className="text-white">{compliance.structural.railAnalysis.cantileverIn}" (max {compliance.structural.railAnalysis.maxAllowedCantileverIn}")</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Moment Demand</span><span className="text-white">{compliance.structural.railAnalysis.momentDemandInLbs?.toFixed(0)} in·lbs</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Moment Capacity</span><span className="text-white">{compliance.structural.railAnalysis.momentCapacityInLbs?.toFixed(0)} in·lbs</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Utilization</span>
                            <span className={(compliance.structural.railAnalysis.utilizationRatio ?? 0) > 1 ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                              {((compliance.structural.railAnalysis.utilizationRatio ?? 0) * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex justify-between"><span className="text-slate-400">Status</span><span className={compliance.structural.railAnalysis.passes ? 'text-emerald-400' : 'text-red-400'}>{compliance.structural.railAnalysis.passes ? 'PASS' : 'FAIL'}</span></div>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Racking BOM Summary */}
                  {compliance.structural.rackingBOM && (
                    <div className="mt-4 bg-slate-800/40 rounded-xl p-4">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1"><Package size={11} /> Racking Materials (Calculated)</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        {compliance.structural.rackingBOM.rails?.qty > 0 && (
                          <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                            <span className="text-slate-400">Rails</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.rails.qty} × {compliance.structural.rackingBOM.rails.lengthFt?.toFixed(1)}ft</span>
                          </div>
                        )}
                        {compliance.structural.rackingBOM.railSplices?.qty > 0 && (
                          <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                            <span className="text-slate-400">Rail Splices</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.railSplices.qty} ea</span>
                          </div>
                        )}
                        <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                          <span className="text-slate-400">Mounts</span>
                          <span className="text-white font-bold">{compliance.structural.rackingBOM.mounts?.qty} ea</span>
                        </div>
                        {compliance.structural.rackingBOM.lFeet?.qty > 0 && (
                          <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                            <span className="text-slate-400">L-Feet</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.lFeet.qty} ea</span>
                          </div>
                        )}
                        <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                          <span className="text-slate-400">Mid Clamps</span>
                          <span className="text-white font-bold">{compliance.structural.rackingBOM.midClamps?.qty} ea</span>
                        </div>
                        <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                          <span className="text-slate-400">End Clamps</span>
                          <span className="text-white font-bold">{compliance.structural.rackingBOM.endClamps?.qty} ea</span>
                        </div>
                        <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                          <span className="text-slate-400">Ground Lugs</span>
                          <span className="text-white font-bold">{compliance.structural.rackingBOM.groundLugs?.qty} ea</span>
                        </div>
                        <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                          <span className="text-slate-400">Lag Bolts</span>
                          <span className="text-white font-bold">{compliance.structural.rackingBOM.lagBolts?.qty} ea</span>
                        </div>
                        {compliance.structural.rackingBOM.flashingKits?.qty > 0 && (
                          <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                            <span className="text-slate-400">Flashing Kits</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.flashingKits.qty} ea</span>
                          </div>
                        )}
                        <div className="flex justify-between bg-slate-900/40 rounded px-2 py-1.5">
                          <span className="text-slate-400">Bonding Clips</span>
                          <span className="text-white font-bold">{compliance.structural.rackingBOM.bondingClips?.qty} ea</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Recommendations */}
                  {compliance.structural.recommendations?.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {compliance.structural.recommendations.map((rec: string, i: number) => (
                        <div key={i} className="text-xs text-amber-300/80 flex items-start gap-1.5">
                          <span className="text-amber-400 mt-0.5">→</span>{rec}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── STRUCTURAL DEBUG PANEL ── */}
              {compliance.structural && (
                <div className="card p-5 border border-slate-700/50">
                  <details>
                    <summary className="text-xs font-bold text-slate-400 uppercase tracking-wide cursor-pointer flex items-center gap-2 select-none hover:text-amber-400 transition-colors">
                      <span className="text-amber-400">⚙</span> Structural Debug Panel
                      <span className="text-xs font-normal text-slate-600 ml-1">(click to expand raw computed values)</span>
                    </summary>
                    <div className="mt-4 space-y-3 font-mono text-xs">
                      {/* Wind Calc */}
                      <div className="bg-slate-900/60 rounded-lg p-3">
                        <div className="text-amber-400 font-bold mb-2">── Wind Load (ASCE 7-22 C&amp;C) ──</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-slate-300">
                          <div>windSpeed = <span className="text-white">{compliance.structural.wind?.designWindSpeed} mph</span></div>
                          <div>exposure = <span className="text-white">{compliance.structural.wind?.exposureCategory}</span></div>
                          <div>Kz = <span className="text-amber-300 font-bold">{compliance.structural.wind?.Kz?.toFixed(2)}</span></div>
                          <div>Kzt = <span className="text-white">{compliance.structural.wind?.Kzt?.toFixed(2)}</span></div>
                          <div>Kd = <span className="text-white">{compliance.structural.wind?.Kd?.toFixed(2)}</span></div>
                          <div>qz = 0.00256×Kz×Kzt×Kd×V² = <span className="text-amber-300 font-bold">{compliance.structural.wind?.velocityPressure?.toFixed(2)} psf</span></div>
                          <div>GCp (uplift) = <span className="text-amber-300 font-bold">{compliance.structural.wind?.GCp?.toFixed(2)}</span></div>
                          <div>GCpi (enclosed) = <span className="text-white">{compliance.structural.wind?.GCpi?.toFixed(2)}</span></div>
                          <div>netUpliftPressure = qz×(|GCp|+GCpi) = <span className="text-amber-300 font-bold">{compliance.structural.wind?.netUpliftPressure?.toFixed(2)} psf</span></div>
                          <div>tributaryArea = attachSp×railSp = <span className="text-white">{compliance.structural.wind?.tributaryArea?.toFixed(2)} ft²</span></div>
                          <div>upliftPerAttachment = <span className="text-amber-300 font-bold">{compliance.structural.wind?.upliftPerAttachment?.toFixed(1)} lbs</span></div>
                          <div>totalAttachments = <span className="text-white">{compliance.structural.wind?.totalAttachments}</span></div>
                          <div>arrayArea = <span className="text-white">{compliance.structural.wind?.arrayArea?.toFixed(1)} ft²</span></div>
                          <div>totalUpliftForce = <span className="text-white">{compliance.structural.wind?.totalUpliftForce?.toFixed(0)} lbs</span></div>
                        </div>
                      </div>
                      {/* Snow Calc */}
                      <div className="bg-slate-900/60 rounded-lg p-3">
                        <div className="text-blue-400 font-bold mb-2">── Snow Load (ASCE 7-22 Ch.7) ──</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-slate-300">
                          <div>groundSnow (Pg) = <span className="text-white">{compliance.structural.snow?.groundSnowLoad} psf</span></div>
                          <div>roofSnow (Cs×Pg) = <span className="text-white">{compliance.structural.snow?.roofSnowLoad?.toFixed(1)} psf</span></div>
                          <div>snowPerAttachment = <span className="text-white">{compliance.structural.snow?.snowLoadPerAttachment?.toFixed(1)} lbs</span></div>
                        </div>
                      </div>
                      {/* Dead Load */}
                      <div className="bg-slate-900/60 rounded-lg p-3">
                        <div className="text-slate-400 font-bold mb-2">── Dead Load ──</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-slate-300">
                          <div>panelWeight = <span className="text-white">{compliance.structural.deadLoad?.panelWeightPsf?.toFixed(1)} psf</span></div>
                          <div>rackingWeight = <span className="text-white">{compliance.structural.deadLoad?.rackingWeightPsf?.toFixed(1)} psf</span></div>
                          <div>totalDeadLoad = <span className="text-white">{compliance.structural.deadLoad?.totalDeadLoadPsf?.toFixed(1)} psf</span></div>
                          <div>deadPerAttachment = <span className="text-white">{compliance.structural.deadLoad?.deadLoadPerAttachment?.toFixed(1)} lbs</span></div>
                          <div>existingRoofDL = <span className="text-white">{compliance.structural.deadLoad?.existingRoofDeadLoad} psf</span></div>
                          <div>totalRoofDL = <span className="text-white">{compliance.structural.deadLoad?.totalRoofDeadLoad?.toFixed(1)} psf</span></div>
                        </div>
                      </div>
                      {/* Rafter */}
                      <div className="bg-slate-900/60 rounded-lg p-3">
                        <div className="text-emerald-400 font-bold mb-2">── Rafter Analysis (NDS 2018) ──</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-slate-300">
                          <div>rafterSize = <span className="text-white">{compliance.structural.rafter?.rafterSize}</span></div>
                          <div>rafterSpacing = <span className="text-white">{compliance.structural.rafter?.rafterSpacing}"</span></div>
                          <div>rafterSpan = <span className="text-white">{compliance.structural.rafter?.rafterSpan} ft</span></div>
                          <div>Fb_base (NDS Table 4A) = <span className="text-white">{compliance.structural.rafter?.Fb_base} psi</span></div>
                          <div>Cd (load duration) = <span className="text-amber-300 font-bold">{compliance.structural.rafter?.Cd?.toFixed(2)}</span></div>
                          <div>Cr (repetitive mbr) = <span className="text-amber-300 font-bold">{compliance.structural.rafter?.Cr?.toFixed(2)}</span></div>
                          <div>Fb' = Fb×Cd×Cr = <span className="text-emerald-300 font-bold">{compliance.structural.rafter?.Fb_prime?.toFixed(0)} psi</span></div>
                          <div>totalLoadPsf = <span className="text-white">{compliance.structural.rafter?.totalLoadPsf?.toFixed(1)} psf</span></div>
                          <div>lineLoad = psf×tribWidth = <span className="text-white">{compliance.structural.rafter?.lineLoad?.toFixed(1)} plf</span></div>
                          <div>bendingMoment = <span className="text-white">{compliance.structural.rafter?.bendingMoment?.toFixed(0)} ft-lbs</span></div>
                          <div>allowableMoment = <span className="text-white">{compliance.structural.rafter?.allowableBendingMoment?.toFixed(0)} ft-lbs</span></div>
                          <div>utilization = <span className={compliance.structural.rafter?.utilizationRatio > 1 ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>{(compliance.structural.rafter?.utilizationRatio * 100)?.toFixed(1)}%</span></div>
                          <div>deflection = <span className="text-white">{compliance.structural.rafter?.deflection?.toFixed(4)}"</span></div>
                          <div>allowDeflection = <span className="text-white">{compliance.structural.rafter?.allowableDeflection?.toFixed(4)}" (L/240)</span></div>
                        </div>
                      </div>
                      {/* Attachment */}
                      <div className="bg-slate-900/60 rounded-lg p-3">
                        <div className="text-purple-400 font-bold mb-2">── Attachment / Lag Bolt (C&amp;C Method) ──</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-slate-300">
                          <div>attachmentSpacing = <span className="text-white">{compliance.structural.attachment?.attachmentSpacing}"</span></div>
                          <div>railSpacing (row-to-row) = <span className="text-white">{compliance.structural.attachment?.railSpacing}"</span></div>
                          <div>tributaryArea = attachSp×railSp = <span className="text-amber-300 font-bold">{compliance.structural.attachment?.tributaryArea?.toFixed(2)} ft²</span></div>
                          <div>upliftPerAttachment = <span className="text-amber-300 font-bold">{compliance.structural.attachment?.upliftPerAttachment?.toFixed(1)} lbs</span></div>
                          <div>lagBoltCapacity = <span className="text-white">{compliance.structural.attachment?.lagBoltCapacity?.toFixed(0)} lbs</span></div>
                          <div>safetyFactor = <span className={compliance.structural.attachment?.safetyFactor < 2 ? 'text-red-400 font-bold' : compliance.structural.attachment?.safetyFactor < 3 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{compliance.structural.attachment?.safetyFactor?.toFixed(2)}</span></div>
                          <div>maxAllowedSpacing = <span className="text-white">{compliance.structural.attachment?.maxAllowedSpacing}"</span></div>
                          <div>spacingMargin = <span className="text-white">{compliance.structural.attachment?.spacingMarginPct?.toFixed(0)}%</span></div>
                        </div>
                      </div>
                      {/* Status */}
                      <div className={`rounded-lg px-3 py-2 text-xs font-bold ${compliance.structural.status === 'PASS' ? 'bg-emerald-500/10 text-emerald-400' : compliance.structural.status === 'WARNING' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
                        STRUCTURAL STATUS: {compliance.structural.status}
                        {compliance.structural.errors?.length > 0 && <span className="ml-3 font-normal text-red-300">{compliance.structural.errors.map((e: any) => (e as Error).message).join(' | ')}</span>}
                        {compliance.structural.warnings?.length > 0 && <span className="ml-3 font-normal text-amber-300">{compliance.structural.warnings.map((w: any) => w.message).join(' | ')}</span>}
                      </div>
                    </div>
                  </details>
                </div>
              )}

            {/* ── STATUS AGGREGATION DEBUG INSPECTOR ── */}
            {(compliance.overallStatus || rulesResult) && (
              <div className="card p-5 border border-slate-700/50">
                <details>
                  <summary className="text-xs font-bold text-slate-400 uppercase tracking-wide cursor-pointer flex items-center gap-2 select-none hover:text-amber-400 transition-colors">
                    <span className="text-blue-400">⚙</span> Status Aggregation Inspector
                    <span className="text-xs font-normal text-slate-600 ml-1">(click to expand — shows how Overall status is computed)</span>
                  </summary>
                  <div className="mt-4 space-y-3 font-mono text-xs">
                    <div className="bg-slate-900/60 rounded-lg p-3">
                      <div className="text-blue-400 font-bold mb-2">── Final Status Computation ──</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-slate-300">
                        <div>electricalStatus = <span className={compliance.electrical?.status === 'FAIL' ? 'text-red-400 font-bold' : compliance.electrical?.status === 'WARNING' ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{compliance.electrical?.status ?? 'NOT RUN'}</span></div>
                        <div>structuralStatus = <span className={compliance.structural?.status === 'FAIL' ? 'text-red-400 font-bold' : compliance.structural?.status === 'WARNING' ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{compliance.structural?.status ?? 'NOT RUN'}</span></div>
                        <div>rulesEngineStatus = <span className={rulesResult?.overallStatus === 'FAIL' ? 'text-red-400 font-bold' : rulesResult?.overallStatus === 'WARNING' ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{rulesResult?.overallStatus ?? 'NOT RUN'}</span></div>
                        <div>overallStatus = <span className={compliance.overallStatus === 'FAIL' ? 'text-red-400 font-bold' : compliance.overallStatus === 'WARNING' ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{compliance.overallStatus ?? 'NOT RUN'}</span></div>
                      </div>
                    </div>
                    <div className="bg-slate-900/60 rounded-lg p-3">
                      <div className="text-amber-400 font-bold mb-2">── Unresolved Errors (cause FAIL) ──</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-slate-300">
                        <div>electricalErrors (not autoFixed) = <span className="text-white font-bold">{compliance.electrical?.errors?.filter((e: any) => !e.autoFixed)?.length ?? 0}</span></div>
                        <div>structuralErrors (severity=error) = <span className="text-white font-bold">{compliance.structural?.errors?.filter((e: any) => e.severity === 'error')?.length ?? 0}</span></div>
                        <div>autoFixedElectrical = <span className="text-emerald-400 font-bold">{compliance.electrical?.errors?.filter((e: any) => e.autoFixed)?.length ?? 0}</span></div>
                        <div>structuralWarnings = <span className="text-amber-400 font-bold">{compliance.structural?.warnings?.length ?? 0}</span></div>
                      </div>
                    </div>
                    <div className="bg-slate-900/60 rounded-lg p-3">
                      <div className="text-slate-400 font-bold mb-2">── Aggregation Logic ──</div>
                      <div className="text-slate-400 space-y-0.5">
                        <div>if (electricalErrors &gt; 0 || structuralErrors &gt; 0) → <span className="text-red-400 font-bold">FAIL</span></div>
                        <div>else if (electricalStatus=WARNING || structuralStatus=WARNING) → <span className="text-amber-400 font-bold">WARNING</span></div>
                        <div>else → <span className="text-emerald-400 font-bold">PASS</span></div>
                        <div className="mt-2 text-blue-300">Result: <span className={`font-bold ${compliance.overallStatus === 'FAIL' ? 'text-red-400' : compliance.overallStatus === 'WARNING' ? 'text-amber-400' : 'text-emerald-400'}`}>{compliance.overallStatus ?? '—'}</span></div>
                      </div>
                    </div>
                    {compliance.electrical?.errors?.length > 0 && (
                      <div className="bg-slate-900/60 rounded-lg p-3">
                        <div className="text-red-400 font-bold mb-2">── Electrical Errors ──</div>
                        {compliance.electrical.errors.map((e: any, i: number) => (
                          <div key={i} className={`text-xs mb-1 ${e.autoFixed ? 'text-emerald-400' : 'text-red-300'}`}>
                            [{e.autoFixed ? 'AUTO-FIXED' : 'ERROR'}] {(e as any).code}: {(e as Error).message}
                          </div>
                        ))}
                      </div>
                    )}
                    {compliance.structural?.errors?.length > 0 && (
                      <div className="bg-slate-900/60 rounded-lg p-3">
                        <div className="text-red-400 font-bold mb-2">── Structural Errors ──</div>
                        {compliance.structural.errors.map((e: any, i: number) => (
                          <div key={i} className={`text-xs mb-1 ${e.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
                            [{e.severity?.toUpperCase() ?? 'ERROR'}] {(e as any).code}: {(e as Error).message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              </div>
            )}

            {/* ── RULES ENGINE RESULTS ── */}
            {rulesResult && (
              <div className="space-y-3">
                {/* Rules Summary Header */}
                <div className="eng-panel">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Shield size={14} className="text-amber-400" /> NEC/ASCE Rules Engine
                      <span className="text-xs font-normal bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full">V3 · Deterministic</span>
                    </h3>
                    <StatusBadge status={rulesResult.overallStatus} size="lg" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: 'Rules Checked', value: rulesResult.rules?.length ?? 0, color: 'text-white' },
                      { label: 'Errors', value: rulesResult.errorCount, color: rulesResult.errorCount > 0 ? 'text-red-400' : 'text-emerald-400' },
                      { label: 'Warnings', value: rulesResult.warningCount, color: rulesResult.warningCount > 0 ? 'text-amber-400' : 'text-emerald-400' },
                      { label: 'Auto-Fixed', value: rulesResult.autoFixCount, color: 'text-emerald-400' },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                        <div className={`text-lg font-black ${item.color}`}>{item.value}</div>
                        <div className="text-xs text-slate-500">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Dependency Chain */}
                  {rulesResult.dependencyChain?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs text-slate-500 mr-1">Rules fired:</span>
                      {rulesResult.dependencyChain.map((r: string) => (
                        <span key={r} className="text-xs font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">{r}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Per-Rule Cards */}
                <div className="space-y-2">
                  {rulesResult.rules?.map((rule: any, i: number) => {
                    const isError = rule.severity === 'error';
                    const isWarn = rule.severity === 'warning';
                    const isPass = rule.severity === 'pass';
                    const hasOverride = overrides.find(o => o.field === rule.overrideField);
                    const isOverrideOpen = overrideForm?.ruleId === rule.ruleId;
                    return (
                      <div key={i} className={`card p-4 border-l-4 ${isError ? 'border-l-red-500' : isWarn ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="flex-shrink-0 mt-0.5">
                              {isError && <XCircle size={15} className="text-red-400" />}
                              {isWarn && <AlertTriangle size={15} className="text-amber-400" />}
                              {isPass && <CheckCircle size={15} className="text-emerald-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-white">{rule.title}</span>
                                {rule.autoFixed && (
                                  <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">Auto-Fixed</span>
                                )}
                                {hasOverride && (
                                  <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded">Overridden</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-400 mt-1">{rule.message}</div>
                              {rule.autoFixDescription && (
                                <div className="text-xs text-emerald-400/80 mt-1">↳ {rule.autoFixDescription}</div>
                              )}
                              <div className="flex items-center gap-3 mt-2 flex-wrap">
                                {(rule.necReference || rule.asceReference) && (
                                  <span className="text-xs font-mono text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                                    {rule.necReference || rule.asceReference}
                                  </span>
                                )}
                                {rule.value !== undefined && (
                                  <span className="text-xs text-slate-400">
                                    Value: <span className="text-white font-mono">{rule.value}</span>
                                    {rule.limit !== undefined && <> · Limit: <span className="text-white font-mono">{rule.limit}</span></>}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {rule.overridable && !isPass && !hasOverride && (
                              <button
                                onClick={() => setOverrideForm(isOverrideOpen ? null : { ruleId: rule.ruleId, field: rule.overrideField, value: '', justification: '' })}
                                className="text-xs text-slate-400 hover:text-amber-400 border border-slate-700 hover:border-amber-500/50 px-2 py-1 rounded transition-colors"
                              >
                                Override
                              </button>
                            )}
                            {hasOverride && (
                              <button
                                onClick={() => removeOverride(rule.overrideField)}
                                className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 px-2 py-1 rounded transition-colors"
                              >
                                Remove Override
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Override Form */}
                        {isOverrideOpen && (
                          <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2">
                            <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                              <Lock size={11} /> Engineering Override — {rule.overrideField}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-slate-500 block mb-1">Override Value</label>
                                <input
                                  type="text"
                                  value={overrideForm?.value || ''}
                                  onChange={e => setOverrideForm(f => f ? { ...f, value: e.target.value } : null)}
                                  placeholder="e.g. 30"
                                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:border-amber-500 outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-500 block mb-1">Justification</label>
                                <input
                                  type="text"
                                  value={overrideForm?.justification || ''}
                                  onChange={e => setOverrideForm(f => f ? { ...f, justification: e.target.value } : null)}
                                  placeholder="Engineering basis..."
                                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:border-amber-500 outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => overrideForm && addOverride(overrideForm.ruleId, overrideForm.field, overrideForm.value, overrideForm.justification)}
                                disabled={!overrideForm?.value || !overrideForm?.justification}
                                className="btn-primary btn-sm text-xs disabled:opacity-40"
                              >
                                <Lock size={11} /> Apply Override
                              </button>
                              <button onClick={() => setOverrideForm(null)} className="btn-secondary btn-sm text-xs">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Active Overrides Log */}
                {overrides.length > 0 && (
                  <div className="card p-4">
                    <h4 className="text-xs font-bold text-blue-400 mb-3 flex items-center gap-2">
                      <Lock size={12} /> Active Engineering Overrides ({overrides.length})
                    </h4>
                    <div className="space-y-2">
                      {overrides.map((o, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 p-2 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs">
                          <div>
                            <span className="text-white font-mono">{o.field}</span>
                            <span className="text-slate-500 mx-2">→</span>
                            <span className="text-blue-400 font-bold">{o.overrideValue}</span>
                            <span className="text-slate-500 ml-2">· {o.justification}</span>
                          </div>
                          <button onClick={() => removeOverride(o.field)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Structural Auto-Resolutions */}
                {rulesResult.structuralAutoResolutions?.length > 0 && (
                  <div className="card p-4">
                    <h4 className="text-xs font-bold text-emerald-400 mb-3 flex items-center gap-2">
                      <CheckCircle size={12} /> Structural Auto-Resolutions ({rulesResult.structuralAutoResolutions.length})
                    </h4>
                    <div className="space-y-2">
                      {rulesResult.structuralAutoResolutions.map((r: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 text-xs p-2 bg-slate-800/40 rounded-lg">
                          <span className="text-emerald-400 font-mono flex-shrink-0 mt-0.5">✓</span>
                          <div className="flex-1">
                            <span className="text-white font-medium">{r.field}</span>
                            <span className="text-slate-500 mx-1">·</span>
                            <span className="text-slate-400">{r.originalValue} → </span>
                            <span className="text-emerald-400 font-bold">{r.resolvedValue}</span>
                            <span className="text-slate-500 ml-2 font-mono">[{r.necReference}]</span>
                          </div>
                          <span className="text-slate-600 text-xs flex-shrink-0">{r.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            </div>
          )}

          {/* ── SINGLE-LINE DIAGRAM TAB ── */}
          {activeTab === 'diagram' && (!canSLD ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
                  <Lock size={28} className="text-amber-400" />
                </div>
                <h3 className="text-white font-bold text-lg mb-1">Single-Line Diagram</h3>
                <p className="text-slate-400 text-sm mb-4 max-w-sm">
                  Professional permit-grade SLD generation requires Professional plan or above.
                </p>
                <a href="/account/billing" className="btn-primary inline-flex gap-2">
                  Upgrade to Professional
                </a>
              </div>
            ) : (
              <div className="max-w-none space-y-4">
                {/* ══ SLD HERO ══════════════════════════════════════════════════ */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-8 -right-8 w-36 h-36 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <Zap size={16} className="text-blue-400" />
                        Single-Line Diagram
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">ANSI C (18×24") · IEEE 315 symbols · Permit-grade</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 font-mono">
                        ANSI C · IEEE 315
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-blue-400 tabular-nums">{totalKw}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">kW DC</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-amber-400 tabular-nums">{totalPanels}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Panels</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-white tabular-nums">{config.inverters.length}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Inverter{config.inverters.length !== 1 ? 's' : ''}</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-emerald-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-emerald-400 tabular-nums">{config.mainPanelAmps || 200}A</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Main Panel</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                      PV Array · Combiner · Inverter · OCPD · Meter · Utility
                    </div>
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 font-semibold">
                      <CheckCircle size={10} /> Permit-grade SLD
                    </div>
                    {sldSvg && (
                      <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-semibold">
                        <CheckCircle size={10} /> Rendered · {engineeringMode} mode
                      </div>
                    )}
                  </div>
                </div>

                {/* Controls bar */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Zap size={14} className="text-amber-400" /> Permit-Grade Single-Line Diagram
                      <span className="text-xs font-normal bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">ANSI C · IEEE Symbols</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">Vector SVG · 18×24 inch sheet · Engineering title block · Conductor callouts</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={fetchSLD}
                      disabled={sldLoading}
                      className="btn-primary btn-sm"
                    >
                      <RefreshCw size={14} className={sldLoading ? 'animate-spin' : ''} />
                      {sldLoading ? 'Generating...' : sldSvg ? 'Regenerate SLD' : 'Generate SLD'}
                    </button>
                    {sldSvg && (
                      <a
                        href={`/api/engineering/sld/pdf`}
                        onClick={async (e) => {
                          e.preventDefault();
                          const res = await fetch('/api/engineering/sld/pdf', {
                            method: 'POST',
            cache: 'no-store',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              buildInput: {
                                projectName: config.projectName,
                                clientName: config.clientName,
                                address: config.address,
                                designer: config.designer,
                                date: config.date,
                                necVersion: `NEC ${compliance.jurisdiction?.necVersion || '2023'}`,
                                systemVoltage: 240,
                                mainPanelAmps: config.mainPanelAmps,
                                mainPanelBrand: config.mainPanelBrand,
                                utilityMeter: config.utilityMeter,
                                utilityName: config.utilityId || 'Local Utility',
                                acDisconnect: config.acDisconnect,
                                dcDisconnect: config.dcDisconnect,
                                productionMeter: config.productionMeter,
                                rapidShutdown: config.rapidShutdown,
                                conduitType: config.conduitType,
                                notes: config.notes,
                                interconnection: config.interconnectionMethod ?? 'LOAD_SIDE',
                                interconnectionType: config.interconnectionMethod ?? 'LOAD_SIDE',
                                panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200,
                                topologyType: computedSystem.isMicro ? 'MICROINVERTER' : 'STRING_INVERTER',
                                totalModules: totalPanels,
                                totalStrings: computedSystem.isMicro ? 0 : (computedSystem.strings?.length ?? 1),
                                inverterManufacturer: (() => { const inv = config.inverters[0]; const d = getInvById(inv?.inverterId, inv?.type) as any; return d?.manufacturer || (computedSystem.isMicro ? 'Enphase' : 'SolarEdge'); })(),
                                inverterModel: (() => { const inv = config.inverters[0]; const d = getInvById(inv?.inverterId, inv?.type) as any; return d?.model || (computedSystem.isMicro ? 'IQ8+' : 'SE7600H'); })(),
                                acOutputKw: Number(totalInverterKw),
                                acOutputAmps: Math.round(Number(totalInverterKw) * 1000 / 240),
                                acOCPD: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.ocpdAmps ?? Math.ceil(Math.round(Number(totalInverterKw) * 1000 / 240) * 1.25 / 5) * 5,
                                backfeedAmps: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.ocpdAmps ?? Math.ceil(Math.round(Number(totalInverterKw) * 1000 / 240) * 1.25 / 5) * 5,
                                panelModel: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.model || 'Solar Panel'; })(),
                                panelWatts: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.watts || 400; })(),
                                panelVoc: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.voc || 41.6; })(),
                                panelIsc: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.isc || 12.26; })(),
                                dcWireGauge: computedSystem.runs?.find((r: any) => r.id === 'DC_STRING_RUN')?.wireGauge ?? '#10 AWG',
                                acWireGauge: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.wireGauge ?? '#8 AWG',
                                acConduitType: config.conduitType ?? 'EMT',
                                dcConduitType: config.conduitType ?? 'EMT',
                                acWireLength: config.wireLength ?? 60,
                                deviceCount: computedSystem.isMicro ? totalPanels : undefined,
                                microBranches: computedSystem.isMicro ? computedSystem.microBranches : undefined,
                                branchWireGauge: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.wireGauge : undefined,
                                branchConduitSize: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.conduitSize : undefined,
                                branchOcpdAmps: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.ocpdAmps : undefined,
                                runs: computedSystem.runs,
                                calcResult: compliance.electrical || null,
                                inverterSpecs: config.inverters.map(inv => {
                                  const invData = getInvById(inv.inverterId, inv.type) as any;
                                  return { inverterId: inv.inverterId, manufacturer: invData?.manufacturer || '', model: invData?.model || '', acOutputKw: invData?.acOutputKw || 0, maxDcVoltage: invData?.maxDcVoltage || 480, efficiency: invData?.efficiency || 97, ulListing: invData?.ulListing || 'UL 1741', rapidShutdownCompliant: invData?.rapidShutdownCompliant || false };
                                }),
                                panelSpecs: config.inverters.flatMap(inv => inv.strings.map(str => {
                                  const panel = getPanelById(str.panelId) as any;
                                  return { panelId: str.panelId, manufacturer: panel?.manufacturer || '', model: panel?.model || '', watts: panel?.watts || 400, voc: panel?.voc || 41.6, isc: panel?.isc || 12.26, ulListing: panel?.ulListing || 'UL 61730' };
                                })),
                              },
                              format: 'pdf',
                            }),
                          });
                          if (res.ok) {
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `SLD-${config.projectName || 'project'}.pdf`;
                            a.click();
                            URL.revokeObjectURL(url);
                          } else {
                            let errMsg = `PDF export failed (HTTP ${res.status})`;
                            try {
                              const errData = await res.json();
                              errMsg = errData.error || errData.message || errMsg;
                            } catch {
                              try { errMsg = await res.text() || errMsg; } catch { /* ignore */ }
                            }
                            setSldError(`Export PDF: ${errMsg}`);
                          }
                        }}
                        className="btn-secondary btn-sm cursor-pointer"
                      >
                        <Download size={14} /> Export PDF
                      </a>
                    )}
                  </div>
                </div>

                {/* Error state */}
                {sldError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                    <XCircle size={14} /> {sldError}
                  </div>
                )}

                {/* Empty state */}
                {!sldSvg && !sldLoading && !sldError && (
                  <div className="card p-12 text-center">
                    <Zap size={40} className="mx-auto mb-4 text-slate-600" />
                    <div className="text-sm font-bold text-white mb-1">Permit-Grade SLD Ready</div>
                    <div className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                      Click "Generate SLD" to render a professional IEEE-symbol single-line diagram on an ANSI C (18×24") engineering sheet with full title block, conductor callouts, and grounding system.
                    </div>
                    <button onClick={fetchSLD} className="btn-primary btn-sm mx-auto">
                      <Zap size={14} /> Generate SLD
                    </button>
                  </div>
                )}

                {/* Loading state */}
                {sldLoading && (
                  <div className="card p-12 text-center">
                    <RefreshCw size={32} className="mx-auto mb-3 text-amber-400 animate-spin" />
                    <div className="text-sm text-slate-400">Rendering permit-grade SLD...</div>
                    <div className="text-xs text-slate-600 mt-1">Applying IEEE symbols · ANSI C sheet · Conductor callouts</div>
                  </div>
                )}

                {/* SVG Diagram */}
                {sldSvg && !sldLoading && (
                  <div className="card overflow-hidden">
                    <div className="bg-slate-800/50 border-b border-slate-700/50 px-4 py-2 flex items-center justify-between">
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <CheckCircle size={12} className="text-emerald-400" />
                        SLD rendered · ANSI C (18×24") · IEEE electrical symbols · {engineeringMode} mode
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <button
                            onClick={() => setSldZoom(z => Math.max(0.25, z - 0.25))}
                            className="p-1 hover:bg-slate-700 rounded"
                            title="Zoom Out"
                          >−</button>
                          <span className="w-12 text-center">{Math.round(sldZoom * 100)}%</span>
                          <button
                            onClick={() => setSldZoom(z => Math.min(4, z + 0.25))}
                            className="p-1 hover:bg-slate-700 rounded"
                            title="Zoom In"
                          >+</button>
                          <button
                            onClick={() => { setSldZoom(1); setSldPan({ x: 0, y: 0 }); }}
                            className="p-1 hover:bg-slate-700 rounded ml-1"
                            title="Fit to Screen"
                          >↺</button>
                        </div>
                        {compliance.electrical?.autoResolutions?.length > 0 && (
                          <span className="text-emerald-400">{compliance.electrical.autoResolutions.length} auto-resolution{compliance.electrical.autoResolutions.length !== 1 ? 's' : ''} applied</span>
                        )}
                      </div>
                    </div>
                    <div
                      ref={sldRef}
                      className="w-full overflow-hidden bg-white cursor-move"
                      style={{ maxHeight: '90vh', minHeight: '400px' }}
                      onWheel={(e) => {
                        e.preventDefault();
                        const delta = e.deltaY > 0 ? -0.1 : 0.1;
                        setSldZoom(z => Math.max(0.25, Math.min(4, z + delta)));
                      }}
                      onMouseDown={(e) => {
                        const startX = e.clientX - sldPan.x;
                        const startY = e.clientY - sldPan.y;
                        const handleMove = (moveEvent: MouseEvent) => {
                          setSldPan({
                            x: moveEvent.clientX - startX,
                            y: moveEvent.clientY - startY
                          });
                        };
                        const handleUp = () => {
                          document.removeEventListener('mousemove', handleMove);
                          document.removeEventListener('mouseup', handleUp);
                        };
                        document.addEventListener('mousemove', handleMove);
                        document.addEventListener('mouseup', handleUp);
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${sldZoom}) translate(${sldPan.x / sldZoom}px, ${sldPan.y / sldZoom}px)`,
                          transformOrigin: 'center center',
                          transition: 'transform 0.1s ease-out'
                        }}
                        dangerouslySetInnerHTML={{ __html: sldSvg?.replace('<svg ', '<svg style="width:100%;height:auto;display:block;" ') }}
                      />
                    </div>
                  </div>
                )}

                {/* Electrical Sizing Callout Panel on SLD */}
                {(compliance.electrical as any)?.acSizing && (
                  <div className="card p-4">
                    <h4 className="text-xs font-bold text-amber-400 mb-3 flex items-center gap-2">
                      <Activity size={12} /> Conductor & Disconnect Callouts — NEC 705.60 · 310.16 · Ch.9
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { label: 'AC Conductor', value: (compliance.electrical as any).acSizing.conductorLabel, nec: 'NEC 310.16' },
                        { label: 'Conduit', value: (compliance.electrical as any).acSizing.conduitLabel, nec: 'NEC Ch. 9' },
                        { label: 'AC Disconnect', value: (compliance.electrical as any).acSizing.disconnectLabel, nec: 'NEC 690.14' },
                        { label: 'OCPD', value: (compliance.electrical as any).acSizing.ocpdLabel, nec: 'NEC 240.6' },
                        { label: 'Fuses', value: (compliance.electrical as any).acSizing.fuseLabel, nec: (compliance.electrical as any).acSizing.disconnectType === 'fused' ? 'NEC 690.9' : 'NEC 690.14' },
                        { label: 'Grounding', value: `${(compliance.electrical as any).acSizing.groundingConductor} Copper`, nec: 'NEC 250.66' },
                      ].map(item => (
                        <div key={item.label} className="bg-slate-800/50 rounded-lg p-2.5">
                          <div className="text-xs text-slate-500 mb-0.5">{item.label}</div>
                          <div className="text-xs font-bold text-white">{item.value}</div>
                          <div className="text-xs text-slate-600 font-mono mt-0.5">{item.nec}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            ))}

          {/* ── EQUIPMENT SCHEDULE TAB ── */}
          {activeTab === 'schedule' && (
            <div className="max-w-none">
              {/* ═══════════ EQUIPMENT SCHEDULE HERO ═══════════ */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl mb-5">
                <div className="absolute -top-8 -right-8 w-36 h-36 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

                <div className="flex items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-emerald-400" />
                    <span className="text-sm font-bold text-white">Equipment Schedule</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/80 text-slate-400 border border-slate-600/50 font-mono">
                      Permit-Grade
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">{config.projectName} · {config.address}</div>
                </div>

                {/* Component summary grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {/* Panels */}
                  <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                      <Sun size={13} className="text-amber-400" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-amber-400 tabular-nums">{totalPanels}</div>
                      <div className="text-[10px] text-slate-500">Panels</div>
                    </div>
                  </div>

                  {/* Inverters */}
                  <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
                      <Zap size={13} className="text-blue-400" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-blue-400 tabular-nums">{config.inverters.length}</div>
                      <div className="text-[10px] text-slate-500">Inverter{config.inverters.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>

                  {/* DC kW */}
                  <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-700/60 border border-slate-600/50 flex items-center justify-center flex-shrink-0">
                      <Activity size={13} className="text-slate-400" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-white tabular-nums">{totalKw}</div>
                      <div className="text-[10px] text-slate-500">kW DC</div>
                    </div>
                  </div>

                  {/* BOM items */}
                  <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-700/60 border border-slate-600/50 flex items-center justify-center flex-shrink-0">
                      <Grid size={13} className="text-slate-400" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-white tabular-nums">{bom.length}</div>
                      <div className="text-[10px] text-slate-500">BOM Items</div>
                    </div>
                  </div>
                </div>

                {/* Status chips */}
                <div className="flex flex-wrap gap-1.5">
                  {config.systemType && (
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                      <Cpu size={10} className="text-blue-400" /> {config.systemType}
                    </div>
                  )}
                  {(compliance.electrical?.status || compliance.structural?.status) && (
                    <div className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border font-semibold ${
                      compliance.overallStatus === 'FAIL' ? 'border-red-500/40 bg-red-500/10 text-red-400' :
                      compliance.overallStatus === 'WARNING' ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' :
                      compliance.overallStatus === 'PASS' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
                      'border-slate-700/50 bg-slate-800 text-slate-500'
                    }`}>
                      <ClipboardCheck size={10} /> Compliance: {compliance.overallStatus || '—'}
                    </div>
                  )}
                  {bomPricing?.pricingApplied && (
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-semibold">
                      <DollarSign size={10} /> ${bomPricing.totalBomCost.toLocaleString('en-US', { maximumFractionDigits: 0 })} BOM
                    </div>
                  )}
                  <div className="text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-500">
                    Print-ready schedule below ↓
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-8 shadow-2xl text-slate-900 overflow-x-auto">
                <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-slate-200">
                  <div><div className="text-xl font-black">EQUIPMENT SCHEDULE</div><div className="text-sm text-slate-500">{config.projectName} · {config.address}</div></div>
                  <div className="text-right text-xs text-slate-500"><div>Date: {config.date}</div><div>Designer: {config.designer || '—'}</div><div>NEC: {compliance.jurisdiction?.necVersion || '2020'}</div></div>
                </div>
                <div className="grid grid-cols-4 gap-3 mb-6">
                  {[
                    { label: 'DC System Size', value: `${totalKw} kW` },
                    { label: 'AC Inverter Capacity', value: `${totalInverterKw} kW` },
                    { label: 'Total Panels', value: `${totalPanels}` },
                    { label: 'Battery Storage', value: config.batteryId ? (() => { const b = getBatteryById(config.batteryId); return b ? `${config.batteryCount}× ${b.manufacturer} ${b.model} (${(config.batteryCount * b.usableCapacityKwh).toFixed(1)} kWh)` : `${(config.batteryCount * config.batteryKwh).toFixed(1)} kWh`; })() : 'None' },
                    ...(config.generatorId ? [{ label: 'Standby Generator', value: (() => { const g = getGeneratorById(config.generatorId); return g ? `${g.manufacturer} ${g.model} (${g.ratedOutputKw}kW)` : 'Generator'; })() }] : []),
                    ...(config.atsId ? [{ label: 'Transfer Switch', value: (() => { const a = getATSById(config.atsId); return a ? `${a.manufacturer} ${a.model} (${a.ampRating}A)` : 'ATS'; })() }] : []),
                    ...(config.backupInterfaceId ? [{ label: 'Backup Interface', value: (() => { const b = getBackupInterfaceById(config.backupInterfaceId); return b ? `${b.manufacturer} ${b.model}` : 'BUI'; })() }] : []),
                  ].map(item => (
                    <div key={item.label} className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                      <div className="text-lg font-black text-amber-700">{item.value}</div>
                      <div className="text-xs text-slate-500">{item.label}</div>
                    </div>
                  ))}
                </div>

                {/* PVWatts Production Estimate */}
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-black text-blue-800 uppercase tracking-wide">☀ NREL PVWatts Production Estimate</div>
                    <button
                      onClick={fetchPVWatts}
                      disabled={pvwattsData.loading}
                      className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {pvwattsData.loading ? 'Loading…' : pvwattsData.annualKwh ? 'Refresh' : 'Fetch Estimate'}
                    </button>
                  </div>
                  {pvwattsData.error && (
                    <div className="text-xs text-red-600">{pvwattsData.error}</div>
                  )}
                  {pvwattsData.annualKwh ? (
                    <div>
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        <div className="text-center">
                          <div className="text-xl font-black text-blue-700">{Math.round(pvwattsData.annualKwh).toLocaleString()}</div>
                          <div className="text-xs text-slate-500">kWh/year</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-black text-blue-700">{pvwattsData.capacityFactor?.toFixed(1)}%</div>
                          <div className="text-xs text-slate-500">Capacity Factor</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-black text-blue-700">{pvwattsData.annualKwh && totalKw ? (pvwattsData.annualKwh / parseFloat(totalKw)).toFixed(0) : '—'}</div>
                          <div className="text-xs text-slate-500">kWh/kWp/yr</div>
                        </div>
                      </div>
                      {pvwattsData.stationCity && (
                        <div className="text-xs text-slate-500 mb-2">📍 TMY Station: {pvwattsData.stationCity}, {pvwattsData.stationState}</div>
                      )}
                      {pvwattsData.monthlyKwh && (
                        <div>
                          <div className="text-xs text-slate-500 mb-1 font-semibold">Monthly Production (kWh)</div>
                          <div className="grid grid-cols-12 gap-0.5">
                            {['J','F','M','A','M','J','J','A','S','O','N','D'].map((m, i) => {
                              const val = pvwattsData.monthlyKwh![i] ?? 0;
                              const maxVal = Math.max(...(pvwattsData.monthlyKwh ?? [1]));
                              const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                              return (
                                <div key={m} className="flex flex-col items-center">
                                  <div className="text-xs text-blue-700 font-bold">{Math.round(val)}</div>
                                  <div className="w-full bg-blue-100 rounded-sm" style={{ height: '32px', position: 'relative' }}>
                                    <div className="absolute bottom-0 w-full bg-blue-500 rounded-sm" style={{ height: `${pct}%` }} />
                                  </div>
                                  <div className="text-xs text-slate-400">{m}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : !pvwattsData.loading && !pvwattsData.error && (
                    <div className="text-xs text-slate-500">
                      Enter project address and click "Fetch Estimate" to get NREL PVWatts production data.
                    </div>
                  )}
                </div>

                <div className="mb-6">
                  <div className="text-sm font-black text-slate-700 mb-2 uppercase tracking-wide">Solar Panels</div>
                  {/* ISSUE 2 FIX: micro topology shows panel summary + device count, NOT string rows */}
                  {config.inverters[0]?.type === 'micro' ? (() => {
                    const inv = config.inverters[0];
                    const invData = getInvById(inv.inverterId, 'micro') as any;
                    const registryMpd = invData?.modulesPerDevice ?? 1;
                    const effectiveMpd = inv.deviceRatioOverride ?? registryMpd;
                    const panelCount = inv.strings.reduce((s: number, str: any) => s + str.panelCount, 0);
                    const deviceCount = Math.ceil(panelCount / effectiveMpd);
                    const firstStr = inv.strings[0];
                    const panel = getPanelById(firstStr?.panelId);
                    return (
                      <table className="w-full text-xs border-collapse">
                        <thead><tr className="bg-slate-100">
                          {['#', 'Manufacturer', 'Model', 'Panels', 'Watts', 'Microinverters', 'Total kW', 'UL Listing'].map(h => (
                            <th key={h} className={`border border-slate-300 px-3 py-2 font-bold ${['Panels', 'Watts', 'Microinverters', 'Total kW'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          <tr className="bg-white">
                            <td className="border border-slate-200 px-3 py-2 font-semibold">1</td>
                            <td className="border border-slate-200 px-3 py-2">{panel?.manufacturer ?? 'TBD'}</td>
                            <td className="border border-slate-200 px-3 py-2">{panel?.model ?? 'TBD'}</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{panelCount}</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{panel?.watts ?? 400}W</td>
                            <td className="border border-slate-200 px-3 py-2 text-right font-bold text-purple-700">×{deviceCount}</td>
                            <td className="border border-slate-200 px-3 py-2 text-right font-bold">{(panelCount * (panel?.watts ?? 400) / 1000).toFixed(2)}</td>
                            <td className="border border-slate-200 px-3 py-2">{panel?.ulListing ?? '—'}</td>
                          </tr>
                          <tr className="bg-amber-50 font-black">
                            <td colSpan={3} className="border border-slate-300 px-3 py-2">TOTAL</td>
                            <td className="border border-slate-300 px-3 py-2 text-right">{panelCount}</td>
                            <td className="border border-slate-300 px-3 py-2"></td>
                            <td className="border border-slate-300 px-3 py-2 text-right">×{deviceCount}</td>
                            <td className="border border-slate-300 px-3 py-2 text-right">{totalKw}</td>
                            <td className="border border-slate-300 px-3 py-2"></td>
                          </tr>
                        </tbody>
                      </table>
                    );
                  })() : (
                  <table className="w-full text-xs border-collapse">
                    <thead><tr className="bg-slate-100">
                      {['String', 'Manufacturer', 'Model', 'Qty', 'Watts', 'Voc', 'Isc', 'Total kW', 'UL Listing'].map(h => (
                        <th key={h} className={`border border-slate-300 px-3 py-2 font-bold ${['Qty', 'Watts', 'Voc', 'Isc', 'Total kW'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {config.inverters.map((inv, invIdx) => inv.strings.map((str, strIdx) => {
                        const panel = getPanelById(str.panelId);
                        return (
                          <tr key={str.id} className={strIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            <td className="border border-slate-200 px-3 py-2 font-semibold">{invIdx + 1}-{strIdx + 1}</td>
                            <td className="border border-slate-200 px-3 py-2">{panel?.manufacturer}</td>
                            <td className="border border-slate-200 px-3 py-2">{panel?.model}</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{str.panelCount}</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{panel?.watts}W</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{panel?.voc}V</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{panel?.isc}A</td>
                            <td className="border border-slate-200 px-3 py-2 text-right font-bold">{(str.panelCount * (panel?.watts || 400) / 1000).toFixed(2)}</td>
                            <td className="border border-slate-200 px-3 py-2">{panel?.ulListing}</td>
                          </tr>
                        );
                      }))}
                      <tr className="bg-amber-50 font-black">
                        <td colSpan={3} className="border border-slate-300 px-3 py-2">TOTAL</td>
                        <td className="border border-slate-300 px-3 py-2 text-right">{totalPanels}</td>
                        <td colSpan={3} className="border border-slate-300 px-3 py-2"></td>
                        <td className="border border-slate-300 px-3 py-2 text-right">{totalKw}</td>
                        <td className="border border-slate-300 px-3 py-2"></td>
                      </tr>
                    </tbody>
                  </table>
                  )}
                </div>
                <div className="mb-6">
                  <div className="text-sm font-black text-slate-700 mb-2 uppercase tracking-wide">Inverters</div>
                  <table className="w-full text-xs border-collapse">
                    <thead><tr className="bg-slate-100">
                      {['#', 'Type', 'Manufacturer', 'Model', 'AC kW', 'Max DC V', 'Efficiency', 'UL Listing'].map(h => (
                        <th key={h} className={`border border-slate-300 px-3 py-2 font-bold ${['AC kW', 'Max DC V', 'Efficiency'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {config.inverters.map((inv, idx) => {
                        const invData = getInvById(inv.inverterId, inv.type) as any;
                        // Skip rows where invData is missing (invalid inverterId for type)
                        if (!invData) return null;
                        // For micro: compute deviceCount from panelCount / modulesPerDevice
                        const registryMpd = inv.type === 'micro' ? (invData?.modulesPerDevice ?? 1) : 1;
                        const effectiveMpd = inv.deviceRatioOverride ?? registryMpd;
                        const panelCountForInv = inv.strings.reduce((s, str) => s + str.panelCount, 0);
                        const deviceCount = inv.type === 'micro' ? Math.ceil(panelCountForInv / effectiveMpd) : null;
                        const acKw = invData?.acOutputKw ?? ((invData?.acOutputW ?? 0) / 1000);
                        return (
                          <tr key={inv.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            <td className="border border-slate-200 px-3 py-2 font-semibold">
                              {deviceCount !== null ? `×${deviceCount}` : idx + 1}
                            </td>
                            <td className="border border-slate-200 px-3 py-2">{inv.type === 'micro' ? 'Microinverter' : 'String'}</td>
                            <td className="border border-slate-200 px-3 py-2">{invData?.manufacturer}</td>
                            <td className="border border-slate-200 px-3 py-2">{invData?.model}</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{acKw > 0 ? acKw.toFixed(3) : '—'}</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{invData?.maxDcVoltage ? `${invData.maxDcVoltage}V` : '—'}</td>
                            <td className="border border-slate-200 px-3 py-2 text-right">{invData?.efficiency ? `${invData.efficiency}%` : '—'}</td>
                            <td className="border border-slate-200 px-3 py-2">{invData?.ulListing ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Electrical Equipment Section — sourced from compliance.electrical.acSizing */}
                {(compliance.electrical as any)?.acSizing && (() => {
                  const ac = (compliance.electrical as any).acSizing;
                  const interconnectLabels: Record<string, string> = {
                    LOAD_SIDE: 'Load-Side Breaker (NEC 705.12(B) — 120% Rule)',
                    SUPPLY_SIDE_TAP: 'Supply-Side Tap (NEC 705.11 — Line-Side)',
                    MAIN_BREAKER_DERATE: 'Main Breaker Derate',
                    PANEL_UPGRADE: 'Panel Upgrade',
                  };
                  return (
                    <div className="mb-6">
                      <div className="text-sm font-black text-slate-700 mb-2 uppercase tracking-wide">Electrical Equipment</div>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100">
                            {['Item', 'Description', 'Rating / Size', 'NEC Reference'].map(h => (
                              <th key={h} className="border border-slate-300 px-3 py-2 font-bold text-left">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="bg-white">
                            <td className="border border-slate-200 px-3 py-2 font-semibold">AC OCPD / Backfeed Breaker</td>
                            <td className="border border-slate-200 px-3 py-2">{ac.ocpdLabel || `${ac.ocpdAmps}A, 240V, 2-Pole Breaker`}</td>
                            <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">{ac.ocpdAmps}A</td>
                            <td className="border border-slate-200 px-3 py-2 text-slate-500">NEC 705.60 · NEC 240.6</td>
                          </tr>
                          <tr className="bg-slate-50">
                            <td className="border border-slate-200 px-3 py-2 font-semibold">AC Disconnect Switch</td>
                            <td className="border border-slate-200 px-3 py-2">{ac.disconnectAmps}A, 240V, {ac.disconnectType === 'fused' ? 'Fusible' : 'Non-Fusible'} AC Disconnect</td>
                            <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">{ac.disconnectAmps}A</td>
                            <td className="border border-slate-200 px-3 py-2 text-slate-500">NEC 690.14</td>
                          </tr>
                          {ac.disconnectType === 'fused' && ac.fuseAmps && (
                            <tr className="bg-white">
                              <td className="border border-slate-200 px-3 py-2 font-semibold">AC Fuses (L1 / L2)</td>
                              <td className="border border-slate-200 px-3 py-2">{ac.fuseAmps}A, 250V, Class R Fuse × 2</td>
                              <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">{ac.fuseAmps}A × 2</td>
                              <td className="border border-slate-200 px-3 py-2 text-slate-500">NEC 690.9</td>
                            </tr>
                          )}
                          <tr className={ac.disconnectType === 'fused' ? 'bg-slate-50' : 'bg-white'}>
                            <td className="border border-slate-200 px-3 py-2 font-semibold">AC Conductors</td>
                            <td className="border border-slate-200 px-3 py-2">{ac.conductorGauge} THWN-2 Copper, 600V (3 conductors)</td>
                            <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">{ac.conductorGauge}</td>
                            <td className="border border-slate-200 px-3 py-2 text-slate-500">NEC 310.16</td>
                          </tr>
                          <tr className="bg-slate-50">
                            <td className="border border-slate-200 px-3 py-2 font-semibold">Conduit</td>
                            <td className="border border-slate-200 px-3 py-2">{ac.conduitSize}" {ac.conduitType} Conduit, {ac.conduitFillPct?.toFixed(1)}% fill</td>
                            <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">{ac.conduitSize}"</td>
                            <td className="border border-slate-200 px-3 py-2 text-slate-500">NEC Ch. 9 Table 5</td>
                          </tr>
                          <tr className="bg-white">
                            <td className="border border-slate-200 px-3 py-2 font-semibold">Equipment Grounding Conductor</td>
                            <td className="border border-slate-200 px-3 py-2">{ac.groundingConductor} Bare Copper EGC</td>
                            <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">{ac.groundingConductor}</td>
                            <td className="border border-slate-200 px-3 py-2 text-slate-500">NEC 250.66</td>
                          </tr>
                          <tr className="bg-slate-50">
                            <td className="border border-slate-200 px-3 py-2 font-semibold">Interconnection Method</td>
                            <td className="border border-slate-200 px-3 py-2">{interconnectLabels[config.interconnectionMethod] || config.interconnectionMethod}</td>
                            <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">{config.mainPanelAmps}A Panel</td>
                            <td className="border border-slate-200 px-3 py-2 text-slate-500">{config.interconnectionMethod === 'SUPPLY_SIDE_TAP' ? 'NEC 705.11' : 'NEC 705.12(B)'}</td>
                          </tr>
                          {config.utilityId && (
                            <tr className="bg-white">
                              <td className="border border-slate-200 px-3 py-2 font-semibold">Utility Provider</td>
                              <td className="border border-slate-200 px-3 py-2">{config.utilityId}</td>
                              <td className="border border-slate-200 px-3 py-2 text-slate-500">—</td>
                              <td className="border border-slate-200 px-3 py-2 text-slate-500">Utility Tariff</td>
                            </tr>
                          )}
                          {config.ahjId && (
                            <tr className="bg-slate-50">
                              <td className="border border-slate-200 px-3 py-2 font-semibold">AHJ</td>
                              <td className="border border-slate-200 px-3 py-2">{getAhjsByState(config.state || '').find(a => a.id === config.ahjId)?.name || config.ahjId}</td>
                              <td className="border border-slate-200 px-3 py-2 text-slate-500">—</td>
                              <td className="border border-slate-200 px-3 py-2 text-slate-500">Local Jurisdiction</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                {/* ComputedSystem Conduit Schedule — auto-populated from cs.conduitSchedule */}
                <div className="mb-6">
                  <div className="text-sm font-black text-slate-700 mb-2 uppercase tracking-wide flex items-center gap-2">
                    ⚡ Conduit &amp; Conductor Schedule
                    <span className="text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">Auto-calculated · NEC Ch.9</span>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100">
                        {['Raceway', 'From', 'To', 'Conduit', 'Size', 'Conductors', 'EGC', 'Length', 'Fill%', 'OCPD', 'V-Drop', 'Pass'].map(h => (
                          <th key={h} className="border border-slate-300 px-2 py-1.5 font-bold text-left text-xs">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cs.conduitSchedule.map((row, idx) => (
                        <tr key={row.raceway} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold">{row.raceway}</td>
                          <td className="border border-slate-200 px-2 py-1.5">{row.from}</td>
                          <td className="border border-slate-200 px-2 py-1.5">{row.to}</td>
                          <td className="border border-slate-200 px-2 py-1.5">{row.conduitType}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-bold text-amber-700">{row.conduitSize}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-mono text-xs">{row.conductors}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-mono text-xs">{row.egc}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right">{row.lengthFt}ft</td>
                          <td className={`border border-slate-200 px-2 py-1.5 text-right font-bold ${row.fillPct > 40 ? 'text-red-600' : 'text-emerald-700'}`}>{row.fillPct}%</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right">{row.ocpd}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right">{row.voltageDrop}</td>
                          <td className={`border border-slate-200 px-2 py-1.5 text-center font-bold ${row.pass ? 'text-emerald-600' : 'text-red-600'}`}>{row.pass ? '✓' : '✗'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ComputedSystem Equipment Schedule — auto-populated from cs.equipmentSchedule */}
                <div className="mb-6">
                  <div className="text-sm font-black text-slate-700 mb-2 uppercase tracking-wide flex items-center gap-2">
                    🔧 Equipment Schedule
                    <span className="text-xs font-normal text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">Auto-populated · ComputedSystem</span>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100">
                        {['Tag', 'Description', 'Manufacturer', 'Model', 'Qty', 'Rating', 'NEC Ref'].map(h => (
                          <th key={h} className="border border-slate-300 px-2 py-1.5 font-bold text-left text-xs">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cs.equipmentSchedule.map((row, idx) => (
                        <tr key={row.tag} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold font-mono">{row.tag}</td>
                          <td className="border border-slate-200 px-2 py-1.5">{row.description}</td>
                          <td className="border border-slate-200 px-2 py-1.5">{row.manufacturer}</td>
                          <td className="border border-slate-200 px-2 py-1.5">{row.model}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right font-bold">{row.qty}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-bold text-amber-700">{row.rating}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-500 text-xs">{row.necReference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="text-xs text-slate-400 text-center pt-4 border-t border-slate-200">
                  SolarPro Design Platform V2 · All equipment must be UL-listed and installed per manufacturer specifications and NEC {compliance.jurisdiction?.necVersion || '2020'}
                </div>
              </div>
            </div>
          )}

          {/* ── MOUNTING DETAILS TAB ── */}
          {activeTab === 'mounting' && (() => {
            // ── Mounting Details Tab ── Full Redesign ──────────────────────────────
            const allSystems = getAllMountingSystems();

            // Filter systems by install type
            const categoryMap: Record<string, MountingCategory[]> = {
              residential: ['roof_residential'],
              commercial: ['roof_commercial'],
              ground: ['ground_mount', 'tracker'],
            };
            const baseFiltered = allSystems.filter(s => categoryMap[mountingInstallType].includes(s.category));
            // Apply roof type filter
            const roofTypeFiltered = mountingRoofTypeFilter === 'all'
              ? baseFiltered
              : baseFiltered.filter(s =>
                  s.compatibleRoofTypes.includes(mountingRoofTypeFilter as any) ||
                  s.compatibleRoofTypes.includes('any') ||
                  (s.mount?.compatibleRoofTypes?.includes(mountingRoofTypeFilter as any))
                );
            // Apply search filter
            const filteredSystems = mountingSearchQuery.trim()
              ? roofTypeFiltered.filter(s =>
                  s.manufacturer.toLowerCase().includes(mountingSearchQuery.toLowerCase()) ||
                  s.model.toLowerCase().includes(mountingSearchQuery.toLowerCase()) ||
                  s.productLine.toLowerCase().includes(mountingSearchQuery.toLowerCase()) ||
                  s.systemType.toLowerCase().includes(mountingSearchQuery.toLowerCase())
                )
              : roofTypeFiltered;
            const selectedSystem = allSystems.find(s => s.id === selectedMountingId) || filteredSystems[0];

            // Roof type options for filter chips (residential/commercial only)
            const roofTypeOptions: { value: string; label: string }[] = mountingInstallType === 'residential'
              ? [
                  { value: 'all', label: 'All Roofs' },
                  { value: 'asphalt_shingle', label: '🏠 Shingle' },
                  { value: 'tile_concrete', label: '🏛 Concrete Tile' },
                  { value: 'tile_clay', label: '🏺 Clay Tile' },
                  { value: 'metal_standing_seam', label: '🔩 Standing Seam' },
                  { value: 'metal_corrugated', label: '〰 Corrugated' },
                  { value: 'slate', label: '🪨 Slate' },
                ]
              : mountingInstallType === 'commercial'
              ? [
                  { value: 'all', label: 'All Roofs' },
                  { value: 'flat_tpo', label: '⬜ TPO' },
                  { value: 'flat_epdm', label: '⬛ EPDM' },
                  { value: 'flat_pvc', label: '🔲 PVC' },
                  { value: 'flat_gravel', label: '🪨 Gravel' },
                  { value: 'metal_standing_seam', label: '🔩 Standing Seam' },
                ]
              : [];

            // Compute layout from structural result or config
            const mountCount = compliance.structural?.mountLayout?.mountCount ?? compliance.structural?.rackingBOM?.mounts?.qty ?? Math.ceil(totalPanels * 2.5);
            const mountSpacing = compliance.structural?.mountLayout?.mountSpacing ?? config.attachmentSpacing ?? 48;
            const upliftPerMount = compliance.structural?.wind?.upliftPerAttachment ?? compliance.structural?.mountLayout?.upliftPerMount ?? 0;
            const downwardPerMount = compliance.structural?.deadLoad?.deadLoadPerAttachment ?? compliance.structural?.mountLayout?.downwardPerMount ?? 0;
            const railCount = compliance.structural?.rackingBOM?.rails?.qty ?? Math.ceil(totalPanels / 4) * 2;
            const safetyFactor = compliance.structural?.attachment?.safetyFactor ?? compliance.structural?.mountLayout?.safetyFactor ?? 0;

            // SVG mount spacing diagram
            const MountSpacingDiagram = () => {
              const [diagramView, setDiagramView] = React.useState<'layout'|'section'|'iso'>('layout');
              const attachSpIn  = compliance.structural?.attachment?.attachmentSpacing ?? compliance.structural?.mountLayout?.mountSpacingIn ?? mountSpacing;
              const railSpIn    = compliance.structural?.attachment?.railSpacing ?? 64;
              const upliftLbs   = compliance.structural?.wind?.upliftPerAttachment ?? upliftPerMount;
              const deadLbs     = compliance.structural?.deadLoad?.deadLoadPerAttachment ?? downwardPerMount;
              const sfactor     = compliance.structural?.attachment?.safetyFactor ?? safetyFactor;
              const lagSpec     = selectedSystem?.mount?.fastenerDiameterIn
                ? `${selectedSystem.mount.fastenerDiameterIn}" \u2300 \u00d7 ${selectedSystem.mount.fastenerEmbedmentIn}" embed`
                : '5/16" \u2300 \u00d7 2.5" embed';
              const mountModel  = selectedSystem?.mount?.model ?? 'L-Foot';
              const railModel   = selectedSystem?.rail?.model ?? 'XR Rail';
              const sfColor     = sfactor >= 2 ? '#10b981' : sfactor >= 1.5 ? '#f59e0b' : '#ef4444';

              const TopDownLayout = () => {
                const SCALE = 0.85;
                const panelLenPx = (compliance.structural?.arrayGeometry?.panelLengthIn ?? 73) * SCALE;
                const panelWidPx = (compliance.structural?.arrayGeometry?.panelWidthIn  ?? 41) * SCALE;
                const attachSpPx = Math.max(30, attachSpIn * SCALE);
                const gapPx = 4;
                const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(totalPanels))));
                const rows = Math.min(3, Math.max(1, Math.ceil(totalPanels / cols)));
                const marginL = 56; const marginT = 28;
                const svgW = marginL + cols * (panelLenPx + gapPx) + 60;
                const svgH = marginT + rows * (panelWidPx + 22) + 72;
                const isRtMini = selectedSystem?.id === 'rooftech-mini';
                const railY = (r: number) => [
                  marginT + r*(panelWidPx+22) + panelWidPx*0.22,
                  marginT + r*(panelWidPx+22) + panelWidPx*0.78,
                ];
                const rowW = cols*(panelLenPx+gapPx)-gapPx;
                // RT-MINI staggered foot placement per field practice:
                //   Rail A (top): start at x=0, then every attachSpPx (48" = 4ft)
                //   Rail B (bottom): offset by attachSpPx/2 (24" = 2ft), then every attachSpPx
                //   Result: no two feet share the same rafter — distributes load across more rafters
                const mountPts: {x:number;y:number;rail:number;staggered:boolean}[] = [];
                for (let r=0;r<rows;r++) {
                  const [y1,y2]=railY(r);
                  if (isRtMini) {
                    let xA = marginL;
                    while (xA <= marginL + rowW + 1) { mountPts.push({x:xA,y:y1,rail:0,staggered:true}); xA+=attachSpPx; }
                    let xB = marginL + attachSpPx * 0.5;
                    while (xB <= marginL + rowW + 1) { mountPts.push({x:xB,y:y2,rail:1,staggered:true}); xB+=attachSpPx; }
                  } else {
                    const nM = Math.max(2, Math.round(rowW/attachSpPx)+1);
                    const step = rowW/Math.max(1,nM-1);
                    for (let m=0;m<nM;m++) {
                      mountPts.push({x:marginL+m*step,y:y1,rail:0,staggered:false});
                      mountPts.push({x:marginL+m*step,y:y2,rail:1,staggered:false});
                    }
                  }
                }
                const rafterSpPx = (config.rafterSpacing ?? 24) * SCALE;
                const rafterXs: number[] = [];
                for (let rx = marginL; rx <= marginL + rowW + rafterSpPx; rx += rafterSpPx) rafterXs.push(rx);
                return (
                  <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{maxHeight:300}}>
                    <defs>
                      <marker id="da-r" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L0,5 L5,2.5 z" fill="#64748b"/></marker>
                      <marker id="da-l" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto"><path d="M5,0 L5,5 L0,2.5 z" fill="#64748b"/></marker>
                      <pattern id="pnl-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="#1e40af" strokeWidth="1" opacity="0.25"/>
                      </pattern>
                    </defs>
                    <text x={svgW/2} y={11} textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="bold" fontFamily="monospace">
                      TOP-DOWN ARRAY LAYOUT — {cols}×{rows} ({totalPanels} MODULES){isRtMini ? ' · STAGGERED FEET' : ''}
                    </text>
                    {rafterXs.map((rx,i)=>(
                      <line key={`rf-${i}`} x1={rx} y1={marginT-8} x2={rx} y2={svgH-42}
                        stroke="#334155" strokeWidth="0.8" strokeDasharray="3,4" opacity="0.6"/>
                    ))}
                    {Array.from({length:rows}).map((_,r)=>{
                      const [y1,y2]=railY(r);
                      const x1=marginL-14; const x2=marginL+cols*(panelLenPx+gapPx)+10;
                      return (<g key={`rl-${r}`}>
                        <line x1={x1} y1={y1} x2={x2} y2={y1} stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"/>
                        <line x1={x1} y1={y2} x2={x2} y2={y2} stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"/>
                        <text x={x1-3} y={y1+3} textAnchor="end" fill="#f59e0b" fontSize="7" fontFamily="monospace">R{r*2+1}{isRtMini?' (A)':''}</text>
                        <text x={x1-3} y={y2+3} textAnchor="end" fill="#f59e0b" fontSize="7" fontFamily="monospace">R{r*2+2}{isRtMini?' (B)':''}</text>
                      </g>);
                    })}
                    {Array.from({length:rows}).map((_,r)=>Array.from({length:cols}).map((_,c)=>{
                      const px=marginL+c*(panelLenPx+gapPx); const py=marginT+r*(panelWidPx+22);
                      return (<g key={`pnl-${r}-${c}`}>
                        <rect x={px} y={py} width={panelLenPx} height={panelWidPx} fill="#0f172a" stroke="#334155" strokeWidth="1" rx="1"/>
                        <rect x={px+2} y={py+2} width={panelLenPx-4} height={panelWidPx-4} fill="url(#pnl-hatch)" rx="1"/>
                        {[1,2,3].map(cl=>(
                          <line key={cl} x1={px+(panelLenPx/4)*cl} y1={py+2} x2={px+(panelLenPx/4)*cl} y2={py+panelWidPx-2} stroke="#1e3a5f" strokeWidth="0.5"/>
                        ))}
                      </g>);
                    }))}
                    {mountPts.map((m,i)=>{
                      const fc = m.staggered ? (m.rail===0 ? '#ef4444' : '#f97316') : '#ef4444';
                      const sc = m.staggered ? (m.rail===0 ? '#fca5a5' : '#fdba74') : '#fca5a5';
                      return (<g key={`mpt-${i}`}>
                        <circle cx={m.x} cy={m.y} r={4.5} fill={fc} stroke={sc} strokeWidth="1.5"/>
                        <circle cx={m.x} cy={m.y} r={1.5} fill="white"/>
                      </g>);
                    })}
                    {isRtMini && (()=>{
                      const rA=mountPts.find(m=>m.rail===0&&m.staggered);
                      const rB=mountPts.find(m=>m.rail===1&&m.staggered);
                      if(!rA||!rB)return null;
                      const dy=svgH-44; const midX=(rA.x+rB.x)/2;
                      return (<g>
                        <line x1={rA.x} y1={dy} x2={rB.x} y2={dy} stroke="#a855f7" strokeWidth="1.2" strokeDasharray="3,2" markerStart="url(#da-l)" markerEnd="url(#da-r)"/>
                        <line x1={rA.x} y1={dy-4} x2={rA.x} y2={dy+4} stroke="#a855f7" strokeWidth="0.8"/>
                        <line x1={rB.x} y1={dy-4} x2={rB.x} y2={dy+4} stroke="#a855f7" strokeWidth="0.8"/>
                        <rect x={midX-24} y={dy-9} width={48} height={10} fill="#0f172a"/>
                        <text x={midX} y={dy-0.5} textAnchor="middle" fill="#a855f7" fontSize="7" fontFamily="monospace">{Math.round(attachSpIn/2)}" stagger</text>
                      </g>);
                    })()}
                    {(()=>{
                      const p0=mountPts.filter(m=>m.rail===0);
                      if(p0.length<2)return null;
                      const dy=svgH-27;
                      return (<g>
                        <line x1={p0[0].x} y1={dy} x2={p0[1].x} y2={dy} stroke="#64748b" strokeWidth="1" markerStart="url(#da-l)" markerEnd="url(#da-r)"/>
                        <line x1={p0[0].x} y1={dy-5} x2={p0[0].x} y2={dy+5} stroke="#64748b" strokeWidth="0.8"/>
                        <line x1={p0[1].x} y1={dy-5} x2={p0[1].x} y2={dy+5} stroke="#64748b" strokeWidth="0.8"/>
                        <rect x={(p0[0].x+p0[1].x)/2-24} y={dy-9} width={48} height={10} fill="#0f172a"/>
                        <text x={(p0[0].x+p0[1].x)/2} y={dy} textAnchor="middle" fill="#94a3b8" fontSize="7.5" fontFamily="monospace">{attachSpIn}" O.C.</text>
                      </g>);
                    })()}
                    {rows>=1&&(()=>{
                      const [y1,y2]=railY(0); const dx=svgW-14;
                      return (<g>
                        <line x1={dx} y1={y1} x2={dx} y2={y2} stroke="#f59e0b" strokeWidth="1" markerStart="url(#da-l)" markerEnd="url(#da-r)"/>
                        <text x={dx+5} y={(y1+y2)/2+3} textAnchor="start" fill="#f59e0b" fontSize="7" fontFamily="monospace">{railSpIn}"</text>
                      </g>);
                    })()}
                    <g transform={`translate(${marginL},${svgH-12})`}>
                      <rect x={0} y={0} width={9} height={7} fill="#0f172a" stroke="#334155" rx="1"/>
                      <text x={13} y={7} fill="#64748b" fontSize="7" fontFamily="monospace">Panel</text>
                      <line x1={52} y1={3} x2={64} y2={3} stroke="#f59e0b" strokeWidth="2.5"/>
                      <text x={68} y={7} fill="#64748b" fontSize="7" fontFamily="monospace">Rail</text>
                      <circle cx={106} cy={3} r={4} fill="#ef4444" stroke="#fca5a5" strokeWidth="1"/>
                      <text x={114} y={7} fill="#64748b" fontSize="7" fontFamily="monospace">{isRtMini?'Rail A Pad':'L-Foot'}</text>
                      {isRtMini && (<>
                        <circle cx={184} cy={3} r={4} fill="#f97316" stroke="#fdba74" strokeWidth="1"/>
                        <text x={192} y={7} fill="#64748b" fontSize="7" fontFamily="monospace">Rail B Pad</text>
                        <line x1={256} y1={3} x2={268} y2={3} stroke="#334155" strokeWidth="1.5" strokeDasharray="3,2"/>
                        <text x={272} y={7} fill="#64748b" fontSize="7" fontFamily="monospace">Rafter</text>
                      </>)}
                    </g>
                  </svg>
                );
              };

              const CrossSectionView = () => {
                const W=480; const H=285;
                const groundY=H-16; const rafterH=128; const rafterTop=groundY-rafterH;
                const sheathT=rafterTop-13; const underT=sheathT-4; const shingleT=underT-11;
                const lFBase=shingleT-2; const lFTop=lFBase-28;
                const railBase=lFTop-2; const railTop=railBase-15;
                const pBase=railTop; const pTop=pBase-26;
                const RW=38; const RG=90;
                const rafters=[38,38+RG,38+RG*2,38+RG*3];
                const arrayW=rafters[rafters.length-1]+RW-rafters[0];
                return (
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{maxHeight:285}}>
                    <defs>
                      <linearGradient id="pnlG" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#1e40af" stopOpacity="0.95"/><stop offset="100%" stopColor="#0f172a"/>
                      </linearGradient>
                      <linearGradient id="rfG" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#92400e"/><stop offset="100%" stopColor="#78350f"/>
                      </linearGradient>
                      <pattern id="shn" patternUnits="userSpaceOnUse" width="18" height="11">
                        <rect width="18" height="11" fill="#374151"/>
                        <line x1="0" y1="5" x2="18" y2="5" stroke="#4b5563" strokeWidth="0.5"/>
                        <line x1="9" y1="0" x2="9" y2="5" stroke="#4b5563" strokeWidth="0.5"/>
                      </pattern>
                      <marker id="sa-r" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L0,5 L5,2.5 z" fill="#64748b"/></marker>
                      <marker id="sa-l" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto"><path d="M5,0 L5,5 L0,2.5 z" fill="#64748b"/></marker>
                      <marker id="up-a" markerWidth="7" markerHeight="7" refX="3.5" refY="6" orient="auto"><path d="M0,7 L3.5,0 L7,7 z" fill="#ef4444"/></marker>
                      <marker id="dn-a" markerWidth="7" markerHeight="7" refX="3.5" refY="1" orient="auto"><path d="M0,0 L3.5,7 L7,0 z" fill="#3b82f6"/></marker>
                    </defs>
                    <text x={W/2} y={10} textAnchor="middle" fill="#94a3b8" fontSize="7.5" fontWeight="bold" fontFamily="monospace">
                      CROSS-SECTION DETAIL — ROOF ATTACHMENT (NDS 2018 / ICC-ES AC428)
                    </text>
                    {rafters.map((rx,i)=>(
                      <g key={`rf-${i}`}>
                        <rect x={rx} y={rafterTop} width={RW} height={rafterH} fill="url(#rfG)" stroke="#92400e" strokeWidth="1"/>
                        {i===1&&<text x={rx+RW/2} y={rafterTop+55} textAnchor="middle" fill="#fbbf24" fontSize="6.5" fontFamily="monospace" transform={`rotate(-90,${rx+RW/2},${rafterTop+55})`}>{config.rafterSize??'2x6'} RAFTER</text>}
                      </g>
                    ))}
                    <line x1={rafters[0]+RW/2} y1={groundY+5} x2={rafters[1]+RW/2} y2={groundY+5} stroke="#64748b" strokeWidth="0.8" markerStart="url(#sa-l)" markerEnd="url(#sa-r)"/>
                    <rect x={(rafters[0]+rafters[1]+RW)/2-16} y={groundY+1} width={32} height={9} fill="#0f172a"/>
                    <text x={(rafters[0]+rafters[1]+RW)/2} y={groundY+8} textAnchor="middle" fill="#94a3b8" fontSize="7" fontFamily="monospace">{config.rafterSpacing??24}"OC</text>
                    <rect x={rafters[0]} y={sheathT} width={arrayW} height={rafterTop-sheathT} fill="#44403c" stroke="#57534e" strokeWidth="0.5"/>
                    <text x={rafters[0]-4} y={sheathT+9} textAnchor="end" fill="#78716c" fontSize="6.5" fontFamily="monospace">7/16"OSB</text>
                    <rect x={rafters[0]} y={underT} width={arrayW} height={sheathT-underT} fill="#1c1917" stroke="#292524" strokeWidth="0.5"/>
                    <rect x={rafters[0]} y={shingleT} width={arrayW} height={underT-shingleT} fill="url(#shn)" stroke="#4b5563" strokeWidth="0.5"/>
                    <text x={rafters[0]-4} y={shingleT+7} textAnchor="end" fill="#94a3b8" fontSize="6.5" fontFamily="monospace">SHINGLES</text>
                    {(()=>{
                      const lx=rafters[1]+RW/2-7;
                      return (<g>
                        <rect x={lx} y={lFTop} width={14} height={lFBase-lFTop} fill="#6b7280" stroke="#9ca3af" strokeWidth="1"/>
                        <rect x={lx-6} y={lFBase-8} width={26} height={10} fill="#6b7280" stroke="#9ca3af" strokeWidth="1"/>
                        <line x1={lx+7} y1={lFBase} x2={lx+7} y2={lFBase+52} stroke="#fbbf24" strokeWidth="3" strokeDasharray="5,3"/>
                        <circle cx={lx+7} cy={lFBase-4} r={4} fill="#fbbf24"/>
                        <rect x={lx-10} y={shingleT-3} width={34} height={5} fill="#9ca3af" opacity="0.7"/>
                        <line x1={lx+18} y1={lFTop+8} x2={lx+46} y2={lFTop+1} stroke="#94a3b8" strokeWidth="0.8"/>
                        <text x={lx+48} y={lFTop+2} fill="#e2e8f0" fontSize="7" fontFamily="monospace">{mountModel}</text>
                        <line x1={lx+16} y1={lFBase+32} x2={lx+40} y2={lFBase+24} stroke="#fbbf24" strokeWidth="0.8"/>
                        <text x={lx+42} y={lFBase+25} fill="#fbbf24" fontSize="6.5" fontFamily="monospace">{lagSpec}</text>
                      </g>);
                    })()}
                    <rect x={rafters[0]+8} y={railTop} width={arrayW-16} height={railBase-railTop} fill="#78716c" stroke="#a8a29e" strokeWidth="1" rx="2"/>
                    <text x={rafters[0]+8} y={railTop-3} fill="#f59e0b" fontSize="7" fontFamily="monospace">{railModel} RAIL</text>
                    <rect x={rafters[0]+16} y={pTop} width={arrayW-32} height={pBase-pTop} fill="url(#pnlG)" stroke="#3b82f6" strokeWidth="1.5" rx="2"/>
                    <text x={rafters[0]+arrayW/2} y={pTop+(pBase-pTop)/2+3} textAnchor="middle" fill="#93c5fd" fontSize="7.5" fontFamily="monospace" fontWeight="bold">PV MODULE</text>
                    {upliftLbs>0&&(<g>
                      <line x1={rafters[0]+55} y1={pTop+14} x2={rafters[0]+55} y2={pTop-8} stroke="#ef4444" strokeWidth="2.5" markerEnd="url(#up-a)"/>
                      <rect x={rafters[0]+36} y={pTop-22} width={38} height={12} fill="#7f1d1d" rx="2"/>
                      <text x={rafters[0]+55} y={pTop-12} textAnchor="middle" fill="#fca5a5" fontSize="6.5" fontFamily="monospace">UP {upliftLbs.toFixed(0)}lbs</text>
                    </g>)}
                    {deadLbs>0&&(<g>
                      <line x1={rafters[0]+100} y1={pTop-8} x2={rafters[0]+100} y2={pTop+14} stroke="#3b82f6" strokeWidth="2.5" markerEnd="url(#dn-a)"/>
                      <rect x={rafters[0]+80} y={pTop-22} width={38} height={12} fill="#1e3a8a" rx="2"/>
                      <text x={rafters[0]+99} y={pTop-12} textAnchor="middle" fill="#93c5fd" fontSize="6.5" fontFamily="monospace">DL {deadLbs.toFixed(0)}lbs</text>
                    </g>)}
                    <rect x={W-84} y={18} width={76} height={38} rx="4" fill="#0f172a" stroke={sfColor} strokeWidth="1.5"/>
                    <text x={W-46} y={36} textAnchor="middle" fill={sfColor} fontSize="16" fontWeight="bold" fontFamily="monospace">{sfactor>0?sfactor.toFixed(2):'—'}</text>
                    <text x={W-46} y={48} textAnchor="middle" fill="#64748b" fontSize="7" fontFamily="monospace">SAFETY FACTOR</text>
                    <text x={6} y={pTop+(pBase-pTop)/2+3} fill="#3b82f6" fontSize="6.5" fontFamily="monospace">MODULE</text>
                    <text x={6} y={railTop+(railBase-railTop)/2+3} fill="#f59e0b" fontSize="6.5" fontFamily="monospace">RAIL</text>
                    <text x={6} y={shingleT+7} fill="#94a3b8" fontSize="6.5" fontFamily="monospace">SHINGLE</text>
                    <text x={6} y={sheathT+9} fill="#a87f60" fontSize="6.5" fontFamily="monospace">SHEATH</text>
                    <text x={6} y={rafterTop+16} fill="#d97706" fontSize="6.5" fontFamily="monospace">RAFTER</text>
                  </svg>
                );
              };

              const IsoView = () => {
                const W=480; const H=255;
                const iso=(x:number,y:number,z:number):[number,number]=>[
                  W/2+(x-y)*0.866*0.82, H/2+(x+y)*0.5*0.82-z*0.82
                ];
                const panelW=95; const panelH=55; const gap2=6;
                const cols2=Math.min(3,Math.max(1,Math.ceil(Math.sqrt(totalPanels/2))));
                const rows2=Math.min(2,Math.max(1,Math.ceil(totalPanels/cols2/2)));
                const tR=(config.roofPitch??20)*Math.PI/180;
                const sinT=Math.sin(tR)*0.55;
                return (
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{maxHeight:255}}>
                    <defs>
                      <linearGradient id="isoP" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#1e40af" stopOpacity="0.95"/><stop offset="100%" stopColor="#0f172a"/>
                      </linearGradient>
                      <linearGradient id="isoR" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#374151"/><stop offset="100%" stopColor="#1f2937"/>
                      </linearGradient>
                    </defs>
                    <text x={W/2} y={11} textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="bold" fontFamily="monospace">
                      ISOMETRIC VIEW — {config.roofPitch??20}deg PITCH
                    </text>
                    {(()=>{
                      const p=[iso(-22,-22,0),iso(cols2*(panelW+gap2)+32,-22,0),
                        iso(cols2*(panelW+gap2)+32,rows2*(panelH+gap2)+22,sinT*(rows2*(panelH+gap2)+22)),
                        iso(-22,rows2*(panelH+gap2)+22,sinT*(rows2*(panelH+gap2)+22))];
                      return <polygon points={p.map(q=>q.join(',')).join(' ')} fill="url(#isoR)" stroke="#4b5563" strokeWidth="1" opacity="0.85"/>;
                    })()}
                    {Array.from({length:rows2+1}).map((_,r)=>{
                      const ry=r*(panelH+gap2)+panelH*0.28;
                      const p1=iso(-10,ry,sinT*ry+9); const p2=iso(cols2*(panelW+gap2)+10,ry,sinT*ry+9);
                      return <line key={r} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"/>;
                    })}
                    {Array.from({length:rows2}).map((_,r)=>Array.from({length:cols2}).map((_,c)=>{
                      const px=c*(panelW+gap2); const py=r*(panelH+gap2); const pz=sinT*py+8;
                      const pts=[iso(px,py,pz),iso(px+panelW,py,pz),iso(px+panelW,py+panelH,pz+sinT*panelH),iso(px,py+panelH,pz+sinT*panelH)];
                      return (<g key={`ip-${r}-${c}`}>
                        <polygon points={pts.map(q=>q.join(',')).join(' ')} fill="url(#isoP)" stroke="#3b82f6" strokeWidth="1.2"/>
                        {[1,2,3].map(cl=>{
                          const l1=iso(px+panelW*cl/4,py,pz); const l2=iso(px+panelW*cl/4,py+panelH,pz+sinT*panelH);
                          return <line key={cl} x1={l1[0]} y1={l1[1]} x2={l2[0]} y2={l2[1]} stroke="#1e3a8a" strokeWidth="0.6"/>;
                        })}
                      </g>);
                    }))}
                    {Array.from({length:rows2+1}).map((_,r)=>Array.from({length:Math.max(2,cols2)}).map((_,m)=>{
                      const ry=r*(panelH+gap2)+panelH*0.28; const mx=m*(panelW+gap2);
                      const [cx,cy]=iso(mx,ry,sinT*ry+11);
                      return <circle key={`im-${r}-${m}`} cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fca5a5" strokeWidth="1.5"/>;
                    }))}
                    <rect x={W-88} y={H-44} width={80} height={36} rx="4" fill="#0f172a" stroke="#334155" strokeWidth="1"/>
                    <text x={W-48} y={H-26} textAnchor="middle" fill="#f59e0b" fontSize="14" fontWeight="bold" fontFamily="monospace">{config.roofPitch??20}deg</text>
                    <text x={W-48} y={H-13} textAnchor="middle" fill="#64748b" fontSize="7" fontFamily="monospace">ROOF PITCH</text>
                  </svg>
                );
              };

              return (
                <div>
                  <div className="flex gap-1 mb-2">
                    {([{id:'layout' as const,label:'\u229e Array Layout'},{id:'section' as const,label:'\u22a5 Cross-Section'},{id:'iso' as const,label:'\u2B21 Isometric'}] as const).map(v=>(
                      <button key={v.id} onClick={()=>setDiagramView(v.id)}
                        className={`text-xs px-2.5 py-1 rounded-md font-bold transition-all border ${diagramView===v.id?'bg-amber-500/20 border-amber-500/60 text-amber-300':'border-slate-700/50 text-slate-400 hover:text-slate-300 hover:border-slate-600'}`}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                  <div className="bg-slate-950 rounded-xl p-2 border border-slate-800">
                    {diagramView==='layout'  && <TopDownLayout />}
                    {diagramView==='section' && <CrossSectionView />}
                    {diagramView==='iso'     && <IsoView />}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
                    <div className="bg-slate-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-slate-500">Attach Spacing</div>
                      <div className="text-amber-300 font-bold font-mono">{attachSpIn}" O.C.</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-slate-500">Lag Bolt Spec</div>
                      <div className="text-white font-bold font-mono text-xs">{lagSpec}</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-lg px-2 py-1.5">
                      <div className="text-slate-500">Safety Factor</div>
                      <div className="font-bold font-mono" style={{color:sfColor}}>{sfactor>0?sfactor.toFixed(2):'—'}</div>
                    </div>
                  </div>
                </div>
              );
            };

            // Ballast layout SVG (commercial)            // Ballast layout SVG (commercial)
            const BallastLayoutDiagram = () => {
              const cols = Math.min(8, Math.ceil(Math.sqrt(totalPanels)));
              const rows = Math.min(4, Math.ceil(totalPanels / cols));
              const pW = 50; const pH = 30; const gap = 4;
              const svgW = cols * (pW + gap) + 20;
              const svgH = rows * (pH + gap) + 30;
              const ballastBlocks = (compliance.structural as any)?.ballastAnalysis?.blocksPerModule ?? selectedSystem?.ballast?.minBlocksPerModule ?? 2;
              return (
                <svg width={svgW} height={svgH} className="w-full" viewBox={`0 0 ${svgW} ${svgH}`}>
                  {Array.from({length: rows}).map((_, r) =>
                    Array.from({length: cols}).map((_, c) => (
                      <g key={`bp-${r}-${c}`}>
                        <rect x={10 + c*(pW+gap)} y={10 + r*(pH+gap)} width={pW} height={pH} rx={2} fill="#1e293b" stroke="#334155" strokeWidth="1"/>
                        {/* Ballast blocks at corners */}
                        {Array.from({length: Math.min(ballastBlocks, 4)}).map((_, b) => {
                          const bx = b % 2 === 0 ? 10 + c*(pW+gap) + 3 : 10 + c*(pW+gap) + pW - 9;
                          const by = b < 2 ? 10 + r*(pH+gap) + 3 : 10 + r*(pH+gap) + pH - 9;
                          return <rect key={`bb-${b}`} x={bx} y={by} width={6} height={6} rx={1} fill="#6366f1" opacity="0.8"/>;
                        })}
                      </g>
                    ))
                  )}
                  <g transform={`translate(10, ${svgH - 16})`}>
                    <rect x={0} y={0} width={8} height={8} fill="#1e293b" stroke="#334155"/>
                    <text x={12} y={8} fill="#94a3b8" fontSize="8">Panel</text>
                    <rect x={50} y={0} width={8} height={8} fill="#6366f1" rx={1}/>
                    <text x={62} y={8} fill="#94a3b8" fontSize="8">Ballast Block</text>
                  </g>
                </svg>
              );
            };

            // Ground mount pile diagram
            const GroundMountDiagram = () => {
              const cols = Math.min(6, Math.ceil(Math.sqrt(totalPanels)));
              const rows = Math.min(3, Math.ceil(totalPanels / cols));
              const pW = 52; const pH = 32; const gap = 8;
              const svgW = cols * (pW + gap) + 60;
              const svgH = rows * (pH + gap) + 60;
              const pileSpacing = (compliance.structural as any)?.groundMountAnalysis?.pileSpacingFt ?? 10;
              return (
                <svg width={svgW} height={svgH} className="w-full" viewBox={`0 0 ${svgW} ${svgH}`}>
                  {/* Ground line */}
                  <line x1={0} y1={svgH - 20} x2={svgW} y2={svgH - 20} stroke="#78716c" strokeWidth="2"/>
                  {/* Posts */}
                  {Array.from({length: cols + 1}).map((_, c) => (
                    <g key={`post-${c}`}>
                      <rect x={30 + c*(pW+gap) - 3} y={svgH - 40} width={6} height={20} fill="#78716c"/>
                      <polygon points={`${30 + c*(pW+gap) - 5},${svgH - 20} ${30 + c*(pW+gap) + 5},${svgH - 20} ${30 + c*(pW+gap)},${svgH - 8}`} fill="#57534e"/>
                    </g>
                  ))}
                  {/* Panels */}
                  {Array.from({length: rows}).map((_, r) =>
                    Array.from({length: cols}).map((_, c) => (
                      <rect key={`gp-${r}-${c}`} x={10 + c*(pW+gap)} y={10 + r*(pH+gap)} width={pW} height={pH} rx={2} fill="#1e293b" stroke="#334155" strokeWidth="1" transform={`rotate(-10, ${10 + c*(pW+gap) + pW/2}, ${10 + r*(pH+gap) + pH/2})`}/>
                    ))
                  )}
                  {/* Pile spacing annotation */}
                  <line x1={30} y1={svgH - 10} x2={30 + (pW+gap)} y2={svgH - 10} stroke="#64748b" strokeWidth="1"/>
                  <text x={30 + (pW+gap)/2} y={svgH - 2} textAnchor="middle" fill="#94a3b8" fontSize="9">{pileSpacing}ft</text>
                  <g transform={`translate(10, ${svgH - 16})`}>
                    <rect x={0} y={0} width={8} height={8} fill="#78716c"/>
                    <text x={12} y={8} fill="#94a3b8" fontSize="8">Post/Pile</text>
                  </g>
                </svg>
              );
            };

            return (
              <div className="max-w-5xl space-y-5">
                {/* ── Header + Install Type Toggle ── */}
                <div className="eng-panel">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-black text-white">Mounting Details</h3>
                      <p className="text-slate-400 text-xs mt-0.5">Full engineering specifications · ASCE 7-22 · ICC-ES rated hardware</p>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
                      {(['residential', 'commercial', 'ground'] as const).map(t => (
                        <button key={t} onClick={() => { setMountingInstallType(t); setShowAllSystems(false); setMountingSearchQuery(''); }}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all capitalize ${mountingInstallType === t ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>
                          {t === 'residential' ? '🏠 Residential' : t === 'commercial' ? '🏢 Commercial' : '🌿 Ground Mount'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Search bar + roof type indicator */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        placeholder="Search by brand, model, or system type..."
                        value={mountingSearchQuery}
                        onChange={e => setMountingSearchQuery(e.target.value)}
                        className="eng-input text-xs"
                      />
                      {mountingSearchQuery && (
                        <button onClick={() => setMountingSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs">✕</button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Roof:</span>
                      <span className="bg-slate-700 text-amber-300 font-bold px-2 py-1 rounded-lg capitalize">{config.roofType?.replace(/_/g,' ') ?? 'any'}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{filteredSystems.length} systems</span>
                    </div>
                  </div>
                  {/* Active system indicator */}
                  {config.mountingId && (
                    <div className="mb-3 flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      <span className="text-amber-400 font-bold">⚡ Active in project:</span>
                      <span className="text-white font-bold">{ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.manufacturer} {ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.model}</span>
                      {config.mountingId !== selectedMountingId && (
                        <button onClick={() => setSelectedMountingId(config.mountingId)} className="ml-auto text-amber-400 hover:text-amber-300 font-bold">View →</button>
                      )}
                    </div>
                  )}

                  {/* Roof Type Filter Chips (residential/commercial only) */}
                  {roofTypeOptions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {roofTypeOptions.map(opt => (
                        <button key={opt.value} onClick={() => { setMountingRoofTypeFilter(opt.value); setShowAllSystems(false); }}
                          className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all border ${mountingRoofTypeFilter === opt.value ? 'bg-amber-500/20 border-amber-500/60 text-amber-300' : 'border-slate-700/50 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* System Selector Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(showAllSystems ? filteredSystems : filteredSystems.slice(0, 9)).map(sys => (
                      <button key={sys.id} onClick={() => setSelectedMountingId(sys.id)}
                        className={`text-left p-3 rounded-xl border transition-all ${selectedMountingId === sys.id ? 'border-amber-500/60 bg-amber-500/10' : config.mountingId === sys.id ? 'border-blue-500/40 bg-blue-500/5' : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600'}`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-xs font-bold text-white leading-tight">{sys.manufacturer}</div>
                          <div className="flex gap-1 flex-shrink-0">
                            {sys.iccEsReport && <span className="text-xs text-emerald-400 font-bold">ICC-ES</span>}
                            {config.mountingId === sys.id && <span className="text-xs text-blue-400 font-bold">⚡</span>}
                          </div>
                        </div>
                        <div className="text-xs text-amber-300 font-bold mb-0.5">{sys.model}</div>
                        <div className="text-xs text-slate-500 capitalize mb-1">{sys.systemType.replace(/_/g,' ')}</div>
                        {selectedMountingId === sys.id && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="text-xs text-amber-400 font-bold">✓ Viewing</span>
                            {config.mountingId !== sys.id && (
                              <button
                                onClick={e => { e.stopPropagation(); updateConfig({ mountingId: sys.id }); }}
                                className="text-xs bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-2 py-0.5 rounded-full transition-colors"
                              >Use This</button>
                            )}
                            {config.mountingId === sys.id && <span className="text-xs text-blue-400 font-bold">⚡ Active</span>}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                  {filteredSystems.length === 0 && (
                    <div className="text-center py-6 text-slate-500 text-xs">
                      No systems match your filters. <button onClick={() => { setMountingRoofTypeFilter('all'); setMountingSearchQuery(''); }} className="text-amber-400 hover:text-amber-300 font-bold">Clear filters</button>
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-slate-500">{filteredSystems.length} system{filteredSystems.length !== 1 ? 's' : ''} shown</span>
                    {filteredSystems.length > 9 && (
                      <button onClick={() => setShowAllSystems(!showAllSystems)} className="text-xs text-amber-400 hover:text-amber-300 font-bold">
                        {showAllSystems ? '▲ Show Less' : `▼ Show All ${filteredSystems.length} Systems`}
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Selected System Spec Panel ── */}
                {selectedSystem && (
                  <div className="eng-panel">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold bg-amber-500 text-slate-900 px-2 py-0.5 rounded-full">SELECTED SYSTEM</span>
                          {selectedSystem.iccEsReport && <span className="text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">{selectedSystem.iccEsReport}</span>}
                          {selectedSystem.ul2703Listed && <span className="text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">UL 2703</span>}
                        </div>
                        <h4 className="text-xl font-black text-white">{selectedSystem.manufacturer} {selectedSystem.model}</h4>
                        <p className="text-slate-400 text-xs mt-0.5">{selectedSystem.description}</p>
                      </div>
                      <div className="text-right flex flex-col items-end gap-2">
                        <div className="text-xs text-slate-500 capitalize">{selectedSystem.category.replace(/_/g,' ')}</div>
                        <div className="text-xs text-amber-400 font-bold capitalize">{selectedSystem.systemType.replace(/_/g,' ')}</div>
                        {config.mountingId === selectedSystem.id ? (
                          <span className="text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-1 rounded-lg">⚡ Active in Structural</span>
                        ) : (
                          <button
                            onClick={() => { updateConfig({ mountingId: selectedSystem.id }); }}
                            className="text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 px-3 py-1.5 rounded-lg transition-all"
                          >
                            ✓ Use This System
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Rail Specs */}
                    {selectedSystem.rail && (
                      <div className="mb-4">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                          <Ruler size={12} className="text-amber-400"/> Rail Specifications
                        </div>
                        <div className="bg-slate-900/60 rounded-xl p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div><div className="text-slate-500 mb-0.5">Model</div><div className="text-white font-bold">{selectedSystem.rail.model}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Material</div><div className="text-white">{selectedSystem.rail.materialAlloy}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Max Span</div><div className="text-amber-300 font-bold">{selectedSystem.rail.maxSpanIn}"</div></div>
                            <div><div className="text-slate-500 mb-0.5">Max Cantilever</div><div className="text-white">{selectedSystem.rail.maxCantileverIn}"</div></div>
                            <div><div className="text-slate-500 mb-0.5">Moment Capacity</div><div className="text-white">{selectedSystem.rail.momentCapacityInLbs.toLocaleString()} in·lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Shear Capacity</div><div className="text-white">{selectedSystem.rail.shearCapacityLbs.toLocaleString()} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Section Length</div><div className="text-white">{selectedSystem.rail.spliceIntervalIn}"</div></div>
                            <div><div className="text-slate-500 mb-0.5">Weight</div><div className="text-white">{selectedSystem.rail.weightLbsPerFt} lbs/ft</div></div>
                          </div>
                          {selectedSystem.rail.iccEsReport && (
                            <div className="mt-2 text-xs text-emerald-400">Source: {selectedSystem.rail.iccEsReport}</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Mount Specs */}
                    {selectedSystem.mount && (
                      <div className="mb-4">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                          <MapPin size={12} className="text-red-400"/> Mount / Attachment Specifications
                        </div>
                        <div className="bg-slate-900/60 rounded-xl p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div><div className="text-slate-500 mb-0.5">Model</div><div className="text-white font-bold">{selectedSystem.mount.model}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Method</div><div className="text-white capitalize">{selectedSystem.mount.attachmentMethod.replace(/_/g,' ')}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Uplift Capacity</div><div className="text-red-300 font-bold">{selectedSystem.mount.upliftCapacityLbs.toLocaleString()} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Downward Capacity</div><div className="text-white">{selectedSystem.mount.downwardCapacityLbs.toLocaleString()} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Shear Capacity</div><div className="text-white">{selectedSystem.mount.shearCapacityLbs.toLocaleString()} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Max Spacing</div><div className="text-amber-300 font-bold">{selectedSystem.mount.maxSpacingIn}"</div></div>
                            <div><div className="text-slate-500 mb-0.5">Fasteners/Mount</div><div className="text-white">{selectedSystem.mount.fastenersPerMount} × {selectedSystem.mount.fastenerDiameterIn}" dia</div></div>
                            <div><div className="text-slate-500 mb-0.5">Embedment</div><div className="text-white">{selectedSystem.mount.fastenerEmbedmentIn}" min</div></div>
                            <div><div className="text-slate-500 mb-0.5">Pullout/Fastener</div><div className="text-white">{selectedSystem.mount.fastenerPulloutLbs} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Min Rafter Depth</div><div className="text-white">{selectedSystem.mount.minRafterDepthIn}"</div></div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {selectedSystem.mount.compatibleRoofTypes.map(rt => (
                              <span key={rt} className="text-xs bg-slate-700/60 text-slate-300 px-2 py-0.5 rounded-full capitalize">{rt.replace(/_/g,' ')}</span>
                            ))}
                          </div>
                          {selectedSystem.mount.iccEsReport && (
                            <div className="mt-2 text-xs text-emerald-400">Source: {selectedSystem.mount.iccEsReport}</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Ballast Specs (commercial) */}
                    {selectedSystem.ballast && (
                      <div className="mb-4">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                          <Weight size={12} className="text-purple-400"/> Ballast Specifications
                        </div>
                        <div className="bg-slate-900/60 rounded-xl p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div><div className="text-slate-500 mb-0.5">Block Weight</div><div className="text-purple-300 font-bold">{selectedSystem.ballast.blockWeightLbs} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Dimensions</div><div className="text-white">{selectedSystem.ballast.blockDimensionsIn.join('×')}"</div></div>
                            <div><div className="text-slate-500 mb-0.5">Blocks/Module</div><div className="text-white">{selectedSystem.ballast.minBlocksPerModule}–{selectedSystem.ballast.maxBlocksPerModule}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Tilt Angle</div><div className="text-white">{selectedSystem.ballast.tiltAngleDeg}°</div></div>
                            <div><div className="text-slate-500 mb-0.5">Max Wind Speed</div><div className="text-amber-300 font-bold">{selectedSystem.ballast.maxWindSpeedMph} mph</div></div>
                            <div><div className="text-slate-500 mb-0.5">Uplift Resistance</div><div className="text-white">{selectedSystem.ballast.windUpliftResistanceLbs} lbs/block</div></div>
                            <div><div className="text-slate-500 mb-0.5">Exposure Categories</div><div className="text-white">{selectedSystem.ballast.exposureCategories.join(', ')}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Total Ballast</div><div className="text-purple-300 font-bold">{(totalPanels * ((selectedSystem.ballast.minBlocksPerModule + selectedSystem.ballast.maxBlocksPerModule) / 2) * selectedSystem.ballast.blockWeightLbs).toFixed(0)} lbs est.</div></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Ground Mount Specs */}
                    {selectedSystem.groundMount && (
                      <div className="mb-4">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                          <MapPin size={12} className="text-green-400"/> Ground Mount Specifications
                        </div>
                        <div className="bg-slate-900/60 rounded-xl p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div><div className="text-slate-500 mb-0.5">Pile Type</div><div className="text-white capitalize">{selectedSystem.groundMount.pileType}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Pile Spacing</div><div className="text-white">{selectedSystem.groundMount.pileSpacingFt}ft</div></div>
                            <div><div className="text-slate-500 mb-0.5">Embedment Depth</div><div className="text-green-300 font-bold">{selectedSystem.groundMount.pileEmbedmentFt}ft</div></div>
                            <div><div className="text-slate-500 mb-0.5">Max Pile Span</div><div className="text-white">{selectedSystem.groundMount.maxPileSpanFt}ft</div></div>
                            <div><div className="text-slate-500 mb-0.5">Uplift Capacity</div><div className="text-red-300 font-bold">{selectedSystem.groundMount.pileCapacityUpliftLbs.toLocaleString()} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Downward Capacity</div><div className="text-white">{selectedSystem.groundMount.pileCapacityDownwardLbs.toLocaleString()} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Lateral Capacity</div><div className="text-white">{selectedSystem.groundMount.pileCapacityLateralLbs.toLocaleString()} lbs</div></div>
                            <div><div className="text-slate-500 mb-0.5">Tilt Angle</div><div className="text-white">{selectedSystem.groundMount.tiltAngleDeg}°</div></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tracker Specs */}
                    {selectedSystem.tracker && (
                      <div className="mb-4">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                          <Sun size={12} className="text-yellow-400"/> Tracker Specifications
                        </div>
                        <div className="bg-slate-900/60 rounded-xl p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div><div className="text-slate-500 mb-0.5">Type</div><div className="text-white capitalize">{selectedSystem.tracker.trackerType.replace(/_/g,' ')}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Rotation Range</div><div className="text-yellow-300 font-bold">±{selectedSystem.tracker.rotationRangeDeg}°</div></div>
                            <div><div className="text-slate-500 mb-0.5">Stow Angle</div><div className="text-white">{selectedSystem.tracker.stowAngleDeg}°</div></div>
                            <div><div className="text-slate-500 mb-0.5">Max Wind Speed</div><div className="text-amber-300 font-bold">{selectedSystem.tracker.windSpeedMaxMph} mph</div></div>
                            <div><div className="text-slate-500 mb-0.5">Row Spacing</div><div className="text-white">{selectedSystem.tracker.rowSpacingFt}ft</div></div>
                            <div><div className="text-slate-500 mb-0.5">GCR</div><div className="text-white">{(selectedSystem.tracker.gcoverageRatio * 100).toFixed(0)}%</div></div>
                            <div><div className="text-slate-500 mb-0.5">Modules/Row</div><div className="text-white">{selectedSystem.tracker.moduleRowsPerTracker}</div></div>
                            <div><div className="text-slate-500 mb-0.5">Actuator</div><div className="text-white capitalize">{selectedSystem.tracker.actuatorType.replace(/_/g,' ')}</div></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Hardware Kit */}
                    {selectedSystem.hardware && (
                      <div className="mb-4">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                          <Package size={12} className="text-blue-400"/> Hardware Kit Components
                        </div>
                        <div className="bg-slate-900/60 rounded-xl p-4">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                            {selectedSystem.hardware.midClamp && <div><div className="text-slate-500 mb-0.5">Mid Clamp</div><div className="text-white">{selectedSystem.hardware.midClamp}</div></div>}
                            {selectedSystem.hardware.endClamp && <div><div className="text-slate-500 mb-0.5">End Clamp</div><div className="text-white">{selectedSystem.hardware.endClamp}</div></div>}
                            {selectedSystem.hardware.railSplice && <div><div className="text-slate-500 mb-0.5">Rail Splice</div><div className="text-white">{selectedSystem.hardware.railSplice}</div></div>}
                            {selectedSystem.hardware.groundLug && <div><div className="text-slate-500 mb-0.5">Ground Lug</div><div className="text-white">{selectedSystem.hardware.groundLug}</div></div>}
                            {selectedSystem.hardware.lagBolt && <div><div className="text-slate-500 mb-0.5">Lag Bolt</div><div className="text-white">{selectedSystem.hardware.lagBolt}</div></div>}
                            {selectedSystem.hardware.bondingHardware && <div><div className="text-slate-500 mb-0.5">Bonding</div><div className="text-white">{selectedSystem.hardware.bondingHardware}</div></div>}
                            {selectedSystem.hardware.flashingKit && <div><div className="text-slate-500 mb-0.5">Flashing Kit</div><div className="text-white">{selectedSystem.hardware.flashingKit}</div></div>}
                            {selectedSystem.hardware.tileHook && <div><div className="text-slate-500 mb-0.5">Tile Hook</div><div className="text-white">{selectedSystem.hardware.tileHook}</div></div>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Real-Time Layout Visualization ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Mount Spacing Diagram */}
                  <div className="eng-panel">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Grid size={14} className="text-amber-400"/>
                      {mountingInstallType === 'ground' ? 'Ground Mount Layout' : mountingInstallType === 'commercial' ? 'Ballast Layout' : 'Mount Spacing Diagram'}
                    </h4>
                    <div className="bg-slate-900/60 rounded-xl p-3 mb-3">
                      {mountingInstallType === 'residential' && <MountSpacingDiagram />}
                      {mountingInstallType === 'commercial' && <BallastLayoutDiagram />}
                      {mountingInstallType === 'ground' && <GroundMountDiagram />}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {mountingInstallType === 'residential' && <>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Mount Count</div><div className="text-white font-bold">{mountCount}</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Mount Spacing</div><div className="text-amber-300 font-bold">{mountSpacing}"</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Rail Count</div><div className="text-white font-bold">{railCount}</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Safety Factor</div><div className={`font-bold ${safetyFactor >= 2 ? 'text-emerald-400' : safetyFactor >= 1.5 ? 'text-amber-400' : 'text-red-400'}`}>{safetyFactor > 0 ? safetyFactor.toFixed(2) : '—'}</div></div>
                      </>}
                      {mountingInstallType === 'commercial' && <>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Blocks/Module</div><div className="text-purple-300 font-bold">{(compliance.structural as any)?.ballastAnalysis?.blocksPerModule ?? selectedSystem?.ballast?.minBlocksPerModule ?? '—'}</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Total Blocks</div><div className="text-white font-bold">{(compliance.structural as any)?.ballastAnalysis?.totalBallastBlocks ?? (totalPanels * (selectedSystem?.ballast?.minBlocksPerModule ?? 2))}</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Total Ballast</div><div className="text-purple-300 font-bold">{(compliance.structural as any)?.ballastAnalysis?.ballastWeightLbs ? `${(compliance.structural as any).ballastAnalysis.ballastWeightLbs.toLocaleString()} lbs` : '—'}</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Roof Load</div><div className="text-white font-bold">{(compliance.structural as any)?.ballastAnalysis?.roofLoadPsf ? `${(compliance.structural as any).ballastAnalysis.roofLoadPsf.toFixed(1)} psf` : '—'}</div></div>
                      </>}
                      {mountingInstallType === 'ground' && <>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Pile Count</div><div className="text-green-300 font-bold">{(compliance.structural as any)?.groundMountAnalysis?.pileCount ?? Math.ceil(totalPanels / 4)}</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Pile Spacing</div><div className="text-white font-bold">{(compliance.structural as any)?.groundMountAnalysis?.pileSpacingFt ?? selectedSystem?.groundMount?.pileSpacingFt ?? '—'}ft</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Uplift/Pile</div><div className="text-red-300 font-bold">{(compliance.structural as any)?.groundMountAnalysis?.upliftPerPileLbs ? `${(compliance.structural as any).groundMountAnalysis.upliftPerPileLbs.toFixed(0)} lbs` : '—'}</div></div>
                        <div className="bg-slate-800/50 rounded-lg p-2"><div className="text-slate-500">Safety Factor</div><div className={`font-bold ${((compliance.structural as any)?.groundMountAnalysis?.safetyFactorUplift ?? 0) >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>{(compliance.structural as any)?.groundMountAnalysis?.safetyFactorUplift?.toFixed(2) ?? '—'}</div></div>
                      </>}
                    </div>
                  </div>

                  {/* Load Visualization */}
                  <div className="eng-panel">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Weight size={14} className="text-blue-400"/> Mount Load Analysis
                    </h4>
                    {compliance.structural ? (
                      <div className="space-y-3">
                        {/* Uplift bar */}
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400">Wind Uplift / Mount</span>
                            <span className="text-red-300 font-bold">{upliftPerMount.toFixed(0)} lbs</span>
                          </div>
                          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-red-500 rounded-full transition-all" style={{width: `${Math.min(100, (upliftPerMount / (selectedSystem?.mount?.upliftCapacityLbs ?? 800)) * 100)}%`}}/>
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">Capacity: {selectedSystem?.mount?.upliftCapacityLbs ?? '—'} lbs</div>
                        </div>
                        {/* Downward bar */}
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400">Dead Load / Mount</span>
                            <span className="text-blue-300 font-bold">{downwardPerMount.toFixed(0)} lbs</span>
                          </div>
                          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{width: `${Math.min(100, (downwardPerMount / (selectedSystem?.mount?.downwardCapacityLbs ?? 1200)) * 100)}%`}}/>
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">Capacity: {selectedSystem?.mount?.downwardCapacityLbs ?? '—'} lbs</div>
                        </div>
                        {/* Safety factor gauge */}
                        <div className="bg-slate-900/60 rounded-xl p-3 mt-2">
                          <div className="text-xs text-slate-400 mb-2">Attachment Safety Factor</div>
                          <div className="flex items-center gap-3">
                            <div className={`text-3xl font-black ${safetyFactor >= 2 ? 'text-emerald-400' : safetyFactor >= 1.5 ? 'text-amber-400' : 'text-red-400'}`}>
                              {safetyFactor > 0 ? safetyFactor.toFixed(2) : '—'}
                            </div>
                            <div className="flex-1">
                              <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${safetyFactor >= 2 ? 'bg-emerald-500' : safetyFactor >= 1.5 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{width: `${Math.min(100, (safetyFactor / 3) * 100)}%`}}/>
                              </div>
                              <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                                <span>0</span><span>1.5 min</span><span>3.0</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-xs mt-2">
                            {safetyFactor >= 2 ? <span className="text-emerald-400">✓ Adequate safety factor (≥ 2.0)</span>
                              : safetyFactor >= 1.5 ? <span className="text-amber-400">⚠ Marginal — consider reducing spacing</span>
                              : safetyFactor > 0 ? <span className="text-red-400">✗ Insufficient — reduce attachment spacing</span>
                              : <span className="text-slate-500">Run compliance check for load analysis</span>}
                          </div>
                        </div>
                        {/* Wind/Snow summary */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-slate-800/50 rounded-lg p-2">
                            <div className="text-slate-500 flex items-center gap-1"><Wind size={10}/> Wind Speed</div>
                            <div className="text-white font-bold">{compliance.structural.wind?.designWindSpeed ?? config.windSpeed ?? '—'} mph</div>
                          </div>
                          <div className="bg-slate-800/50 rounded-lg p-2">
                            <div className="text-slate-500 flex items-center gap-1"><Snowflake size={10}/> Snow Load</div>
                            <div className="text-white font-bold">{compliance.structural.snow?.groundSnowLoad ?? config.groundSnowLoad ?? '—'} psf</div>
                          </div>
                          <div className="bg-slate-800/50 rounded-lg p-2">
                            <div className="text-slate-500">Exposure Cat.</div>
                            <div className="text-white font-bold">{compliance.structural.wind?.exposureCategory ?? config.windExposure ?? '—'}</div>
                          </div>
                          <div className="bg-slate-800/50 rounded-lg p-2">
                            <div className="text-slate-500">Net Uplift Pressure</div>
                            <div className="text-red-300 font-bold">{compliance.structural.wind?.netUpliftPressure?.toFixed(1) ?? '—'} psf</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-500">
                        <Activity size={28} className="mx-auto mb-2 opacity-30"/>
                        <div className="text-xs">Run compliance check to see live load analysis</div>
                        <button onClick={runCalc} className="btn-primary btn-sm mt-3 text-xs">Run Compliance Check</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── BOM Preview Panel ── */}
                <div className="eng-panel">
                  <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <Package size={14} className="text-amber-400"/> Racking BOM Preview
                    <span className="text-xs text-slate-500 font-normal ml-1">— derived from array geometry</span>
                  </h4>
                  {compliance.structural?.rackingBOM ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {compliance.structural.rackingBOM.mounts && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">Mounts / L-Feet</div>
                          <div className="text-lg font-black text-white">{compliance.structural.rackingBOM.mounts.qty}</div>
                          <div className="text-xs text-slate-400">{compliance.structural.rackingBOM.mounts.description}</div>
                        </div>
                      )}
                      {compliance.structural.rackingBOM.rails && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">Rails</div>
                          <div className="text-lg font-black text-white">{compliance.structural.rackingBOM.rails.qty} <span className="text-sm font-normal text-slate-400">{compliance.structural.rackingBOM.rails.unit}</span></div>
                          <div className="text-xs text-slate-400">{compliance.structural.rackingBOM.rails.description}</div>
                        </div>
                      )}
                      {compliance.structural.rackingBOM.lFeet && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">L-Feet</div>
                          <div className="text-lg font-black text-white">{compliance.structural.rackingBOM.lFeet.qty}</div>
                          <div className="text-xs text-slate-400">{compliance.structural.rackingBOM.lFeet.description}</div>
                        </div>
                      )}
                      {compliance.structural.rackingBOM.railSplices && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">Rail Splices</div>
                          <div className="text-lg font-black text-white">{compliance.structural.rackingBOM.railSplices.qty}</div>
                          <div className="text-xs text-slate-400">{compliance.structural.rackingBOM.railSplices.description}</div>
                        </div>
                      )}
                      {compliance.structural.rackingBOM.midClamps && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">Mid Clamps</div>
                          <div className="text-lg font-black text-white">{compliance.structural.rackingBOM.midClamps.qty}</div>
                          <div className="text-xs text-slate-400">{compliance.structural.rackingBOM.midClamps.description}</div>
                        </div>
                      )}
                      {compliance.structural.rackingBOM.endClamps && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">End Clamps</div>
                          <div className="text-lg font-black text-white">{compliance.structural.rackingBOM.endClamps.qty}</div>
                          <div className="text-xs text-slate-400">{compliance.structural.rackingBOM.endClamps.description}</div>
                        </div>
                      )}
                      {compliance.structural.rackingBOM.groundLugs && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">Ground Lugs</div>
                          <div className="text-lg font-black text-white">{compliance.structural.rackingBOM.groundLugs.qty}</div>
                          <div className="text-xs text-slate-400">{compliance.structural.rackingBOM.groundLugs.description}</div>
                        </div>
                      )}
                      {(compliance.structural as any)?.rackingBOM?.ballastBlocks && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">Ballast Blocks</div>
                          <div className="text-lg font-black text-purple-300">{(compliance.structural as any).rackingBOM.ballastBlocks.qty}</div>
                          <div className="text-xs text-slate-400">{(compliance.structural as any).rackingBOM.ballastBlocks.description}</div>
                        </div>
                      )}
                      {(compliance.structural as any)?.rackingBOM?.piles && (
                        <div className="bg-slate-800/50 rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">Ground Piles</div>
                          <div className="text-lg font-black text-green-300">{(compliance.structural as any).rackingBOM.piles.qty}</div>
                          <div className="text-xs text-slate-400">{(compliance.structural as any).rackingBOM.piles.description}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-slate-500">
                      <Package size={24} className="mx-auto mb-2 opacity-30"/>
                      <div className="text-xs">Run compliance check to generate racking BOM from array geometry</div>
                    </div>
                  )}
                  {/* Estimated BOM from system specs when no compliance data */}
                  {!compliance.structural?.rackingBOM && totalPanels > 0 && selectedSystem && (
                    <div className="mt-3 border-t border-slate-700/50 pt-3">
                      <div className="text-xs text-slate-500 mb-2">Estimated quantities (from system specs, {totalPanels} panels):</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        {selectedSystem.mount && <div className="bg-slate-800/30 rounded-lg p-2"><div className="text-slate-500">Mounts (est.)</div><div className="text-white font-bold">{Math.ceil(totalPanels * 2.5)}</div></div>}
                        {selectedSystem.rail && <div className="bg-slate-800/30 rounded-lg p-2"><div className="text-slate-500">Rail (est.)</div><div className="text-white font-bold">{Math.ceil(totalPanels * 0.8 * 2)} ft</div></div>}
                        {selectedSystem.hardware?.midClamp && <div className="bg-slate-800/30 rounded-lg p-2"><div className="text-slate-500">Mid Clamps</div><div className="text-white font-bold">{totalPanels * 2} est.</div></div>}
                        {selectedSystem.hardware?.endClamp && <div className="bg-slate-800/30 rounded-lg p-2"><div className="text-slate-500">End Clamps</div><div className="text-white font-bold">{Math.ceil(totalPanels * 0.5)} est.</div></div>}
                        {selectedSystem.ballast && <div className="bg-slate-800/30 rounded-lg p-2"><div className="text-slate-500">Ballast Blocks</div><div className="text-purple-300 font-bold">{totalPanels * selectedSystem.ballast.minBlocksPerModule}–{totalPanels * selectedSystem.ballast.maxBlocksPerModule}</div></div>}
                        {selectedSystem.groundMount && <div className="bg-slate-800/30 rounded-lg p-2"><div className="text-slate-500">Piles (est.)</div><div className="text-green-300 font-bold">{Math.ceil(totalPanels / 4)}</div></div>}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Code References ── */}
                <div className="eng-panel">
                  <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Book size={14} className="text-amber-400"/> Structural Code References</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      { code: 'ASCE 7-22', title: 'Minimum Design Loads', desc: 'Wind (Ch.26-30), Snow (Ch.7), Dead/Live loads for PV arrays' },
                      { code: 'IBC 2021', title: 'International Building Code', desc: 'Structural requirements, load combinations, seismic provisions' },
                      { code: 'NDS 2018', title: 'National Design Spec (Wood)', desc: 'Rafter bending (Fb\'), shear (Fv\'), withdrawal (W\') for lag bolts' },
                      { code: 'ICC-ES AC428', title: 'PV Mounting Systems', desc: 'Acceptance criteria for roof-mounted PV racking systems' },
                      { code: 'UL 2703', title: 'Racking & Mounting Systems', desc: 'Grounding/bonding, fire classification for PV mounting' },
                      { code: 'BCSI 2015', title: 'Truss Bracing', desc: 'Pre-engineered truss capacity tables for PV dead load' },
                      { code: 'IFC 2021', title: 'Fire Code', desc: 'Setback requirements: 3ft ridge, 18" eave, 3ft hip/valley' },
                      { code: 'NEC 690.12', title: 'Rapid Shutdown', desc: 'Module-level shutdown within 30 seconds for rooftop PV' },
                    ].map(item => (
                      <div key={item.code} className="flex gap-3 bg-slate-800/30 rounded-lg p-3">
                        <div className="text-xs font-black text-amber-400 w-24 flex-shrink-0">{item.code}</div>
                        <div><div className="text-xs font-bold text-white">{item.title}</div><div className="text-xs text-slate-400">{item.desc}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── PERMIT PACKAGE TAB ── */}
          {activeTab === 'permit' && (!canPermit ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
                  <Lock size={28} className="text-blue-400" />
                </div>
                <h3 className="text-white font-bold text-lg mb-1">Permit Package</h3>
                <p className="text-slate-400 text-sm mb-4 max-w-sm">
                  Permit-ready documentation packages require Professional plan or above.
                </p>
                <a href="/account/billing" className="btn-primary inline-flex gap-2">
                  Upgrade to Professional
                </a>
              </div>
            ) : (() => {
              const _sheets = [
                { label: 'PV-0  Cover Sheet',                         done: true },
                { label: 'PV-1  Site Plan',                           done: !!config.address },
                { label: 'PV-2  Roof Plan — Module Layout & Fire Setbacks', done: !!(projectLayout?.panels?.length > 0) },
                { label: 'PV-2B  Array Geometry & String Layout',     done: !!(projectLayout?.panels?.length > 0) },
                { label: 'PV-3  Attachment Detail — Mounting & Cross-Section', done: true },
                { label: 'PV-4A  NEC Compliance Sheet',               done: !!compliance.electrical },
                { label: 'PV-4B  Conductor & Conduit Schedule',       done: true },
                { label: 'PV-4C  Structural Calculation Sheet',       done: !!compliance.structural },
                { label: 'PV-5  Warning Labels & Required Placards',  done: true },
                { label: 'SCHED  Equipment Schedule',                 done: totalPanels > 0 },
                { label: 'APP-A  Equipment Specification Reference',  done: true },
                { label: 'CERT  Engineer Certification',              done: !!config.designer },
                { label: 'PE-1  PE Structural Letter of Compliance',  done: true },
                { label: 'E-1  Single-Line Electrical Diagram',       done: true },
              ];
              const _doneCount  = _sheets.filter(s => s.done).length;
              const _readyPct   = Math.round((_doneCount / _sheets.length) * 100);
              const _compStatus = compliance.overallStatus;

              return (
                <div className="max-w-none space-y-5">

                  {/* ══ PERMIT HERO ══════════════════════════════════════════════ */}
                  <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                    <div className="absolute -top-8 -right-8 w-36 h-36 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />

                    <div className="flex items-center justify-between gap-4 mb-4">
                      <div>
                        <h2 className="text-base font-black text-white flex items-center gap-2">
                          <Stamp size={16} className="text-purple-400" />
                          Permit Package
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {compliance.jurisdiction ? `${compliance.jurisdiction.state} · NEC ${compliance.jurisdiction.necVersion}` : 'Jurisdiction not set'}
                          {' · '}{_doneCount}/{_sheets.length} sheets ready
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Readiness ring */}
                        <div className="relative w-14 h-14 flex-shrink-0">
                          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                            <circle cx="28" cy="28" r="22" fill="none" stroke="rgb(51,65,85)" strokeWidth="5" />
                            <circle cx="28" cy="28" r="22" fill="none"
                              stroke={_readyPct >= 90 ? 'rgb(52,211,153)' : _readyPct >= 70 ? 'rgb(251,191,36)' : 'rgb(148,163,184)'}
                              strokeWidth="5"
                              strokeDasharray={`${_readyPct * 1.382} 138.2`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-xs font-black ${_readyPct >= 90 ? 'text-emerald-400' : _readyPct >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>
                              {_readyPct}%
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Readiness</div>
                          <div className={`text-sm font-black ${_readyPct >= 90 ? 'text-emerald-400' : _readyPct >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>
                            {_readyPct >= 90 ? 'Ready to Submit' : _readyPct >= 70 ? 'Nearly Ready' : 'In Progress'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      <div className="rounded-xl bg-slate-900/60 border border-purple-500/20 px-3 py-2.5 text-center">
                        <div className="text-xl font-black text-purple-400 tabular-nums">{_doneCount}/{_sheets.length}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Sheets Ready</div>
                      </div>
                      <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                        <div className="text-xl font-black text-amber-400 tabular-nums">{totalKw}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">kW DC</div>
                      </div>
                      <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 text-center">
                        <div className="text-xl font-black text-blue-400 tabular-nums">{totalPanels}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Panels</div>
                      </div>
                      <div className={`rounded-xl border px-3 py-2.5 text-center ${
                        _compStatus === 'PASS' ? 'border-emerald-500/30 bg-emerald-500/8' :
                        _compStatus === 'FAIL' ? 'border-red-500/30 bg-red-500/8' :
                        'border-slate-700/50 bg-slate-900/60'
                      }`}>
                        <div className={`text-xl font-black tabular-nums ${
                          _compStatus === 'PASS' ? 'text-emerald-400' :
                          _compStatus === 'FAIL' ? 'text-red-400' : 'text-slate-500'
                        }`}>{_compStatus || '—'}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Compliance</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {compliance.jurisdiction && (
                        <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                          <MapPin size={10} className="text-amber-400" /> {compliance.jurisdiction.state}
                        </div>
                      )}
                      {compliance.jurisdiction && (
                        <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                          <Book size={10} className="text-blue-400" /> NEC {compliance.jurisdiction.necVersion}
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                        CAD · SLD · NEC · Structural · Title Block
                      </div>
                    </div>
                  </div>

                  {/* ══ 2-COL: Sheet Grid + Generator ════════════════════════════ */}
                  <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">

                    {/* LEFT: Sheet status grid */}
                    <div className="xl:col-span-3 space-y-3">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <FileText size={12} className="text-purple-400" /> Sheet Status
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {_sheets.map((sheet, i) => (
                          <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                            sheet.done
                              ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/8'
                              : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/60'
                          }`}>
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              sheet.done ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-slate-700/50 border border-slate-600/50'
                            }`}>
                              {sheet.done
                                ? <CheckCircle size={12} className="text-emerald-400" />
                                : <div className="w-2 h-2 rounded-full border-2 border-slate-600" />
                              }
                            </div>
                            <span className={`text-xs font-mono leading-tight ${sheet.done ? 'text-white' : 'text-slate-500'}`}>
                              {sheet.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* RIGHT: Permit generator */}
                    <div className="xl:col-span-2 space-y-3">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <Stamp size={12} className="text-purple-400" /> Generate Package
                      </h3>
                      <div className="eng-panel space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                            <Stamp size={14} className="text-amber-400" /> Permit Package Generator
                            <span className="text-xs font-normal bg-slate-700/60 text-slate-400 border border-slate-600/50 px-2 py-0.5 rounded-full">14 Sheets</span>
                          </h4>
                          <p className="text-slate-400 text-xs">Full permit-ready documentation — CAD, NEC compliance, structural calcs, SLD, equipment schedule, PE letter, warning labels.</p>
                        </div>

                        {/* Readiness summary */}
                        <div className="rounded-lg bg-slate-800/60 border border-slate-700/40 p-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs text-slate-500">Package readiness</span>
                            <span className={`text-xs font-bold ${_readyPct >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>{_doneCount}/{_sheets.length} sheets</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${_readyPct >= 90 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                              style={{ width: `${_readyPct}%` }}
                            />
                          </div>
                        </div>

                        <button
                          onClick={handleGeneratePermitPackage}
                          disabled={permitLoading || calculating || sldLoading || bomLoading}
                          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {permitLoading ? (
                            <><RefreshCw size={16} className="animate-spin" /> Building Permit Package…</>
                          ) : (
                            <><Printer size={16} /> Generate & Download (PDF)</>
                          )}
                        </button>
                        <button
                          onClick={async () => {
                            const _mountSys2 = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
                            const permitInput = {
                              projectId: currentProjectId || undefined,
                              project: {
                                projectName: config.projectName, clientName: config.clientName,
                                address: config.address, designer: config.designer, date: config.date,
                                notes: config.notes, systemType: config.systemType,
                                lat: (config as any).lat || undefined,
                                lng: (config as any).lng || (config as any).lon || undefined,
                                mainPanelAmps: config.mainPanelAmps, mainPanelBrand: config.mainPanelBrand,
                                utilityMeter: config.utilityMeter, acDisconnect: config.acDisconnect,
                                dcDisconnect: config.dcDisconnect, productionMeter: config.productionMeter,
                                rapidShutdown: config.rapidShutdown, conduitType: config.conduitType,
                                wireGauge: config.wireGauge, wireLength: config.wireLength,
                                utilityName: compliance?.utilityName || config.utilityId || 'Local Utility',
                                roofType: config.roofType,
                                mountingSystem: _mountSys2 ? `${_mountSys2.manufacturer} ${_mountSys2.model}` : config.mountingId || 'IronRidge XR100',
                                mountingSystemId: config.mountingId,
                                roofPitch: config.roofPitch,
                                rafterSize: config.rafterSize,
                                rafterSpacing: config.rafterSpacing,
                                attachmentSpacing: config.attachmentSpacing,
                                interconnectionMethod: config.interconnectionMethod ?? 'LOAD_SIDE',
                                panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200,
                                batteryBrand: config.batteryBrand, batteryModel: config.batteryModel,
                                batteryCount: config.batteryCount, batteryKwh: config.batteryKwh,
                                batteryBackfeedA: calcBatteryBackfeedAmps(config.batteryId, config.batteryCount),
                                generatorBrand: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? ''; })() : undefined,
                                generatorKw: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? 0; })() : undefined,
                                atsBrand: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.manufacturer ?? ''; })() : undefined,
                                atsAmpRating: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? 0; })() : undefined,
                                city: config.city || '', state: config.state || '', zip: config.zip || '', county: config.county || '',
                                panelVoc: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.voc : undefined; })(),
                                panelIsc: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.isc : undefined; })(),
                                panelWeightLbs: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.weightLbs : undefined; })(),
                                panelLengthIn: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.lengthIn : undefined; })(),
                                panelWidthIn: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.widthIn : undefined; })(),
                                ...(projectLayout?.panels && projectLayout.panels.length > 0 ? {
                                  panelPositions: projectLayout.panels.map((p: any) => ({
                                    id: p.id, lat: p.lat, lng: p.lng, x: p.x, y: p.y,
                                    tilt: p.tilt, azimuth: p.azimuth, wattage: p.wattage,
                                    row: p.row, col: p.col, systemType: p.systemType, orientation: p.orientation,
                                    arrayId: (p as any).arrayId,
                                  })),
                                  roofPlanes: (projectLayout?.roofPlanes || []).map((rp: any) => ({
                                    id: rp.id, vertices: rp.vertices || [],
                                    pitch: rp.pitch, azimuth: rp.azimuth, area: rp.area,
                                  })),
                                } : {}),
                              },
                              system: {
                                totalDcKw: parseFloat(projectLayout?.panels?.length > 0 ? (projectLayout.panels.length * (() => { const _pw0 = config.inverters?.[0]?.strings?.[0]; return _pw0 ? ((getPanelById(_pw0.panelId) as any)?.watts ?? 400) / 1000 : 0.4; })()).toFixed(2) : totalKw),
                                totalAcKw: parseFloat(totalInverterKw),
                                totalPanels: projectLayout?.panels?.length > 0 ? projectLayout.panels.length : totalPanels,
                                dcAcRatio: calcDcAcRatio(parseFloat(projectLayout?.panels?.length > 0 ? (projectLayout.panels.length * (() => { const _pw0 = config.inverters?.[0]?.strings?.[0]; return _pw0 ? ((getPanelById(_pw0.panelId) as any)?.watts ?? 400) / 1000 : 0.4; })()).toFixed(2) : totalKw), parseFloat(totalInverterKw) || 0),
                                topology: topologyType,
                                inverters: config.inverters.map(inv => {
                                  const invData = getInvById(inv.inverterId, inv.type) as any;
                                  return { manufacturer: invData?.manufacturer || '', model: invData?.model || '', type: inv.type, acOutputKw: invData?.acOutputKw || (invData?.acOutputW/1000) || 0, maxDcVoltage: invData?.maxDcVoltage || 480, efficiency: invData?.efficiency || 97, ulListing: invData?.ulListing || 'UL 1741', strings: inv.strings.map(str => { const panel = getPanelById(str.panelId) as any; return { label: str.label, panelCount: str.panelCount, panelManufacturer: panel?.manufacturer || '', panelModel: panel?.model || '', panelWatts: panel?.watts || 400, panelVoc: panel?.voc || 41.6, panelIsc: panel?.isc || 12.26, wireGauge: str.wireGauge, wireLength: str.wireLength }; }) };
                                }),
                              },
                              compliance, rulesResult, bom, overrides,
                              layout: projectLayout ? (() => {
                                const layoutSys2 = (projectLayout.systemType || '') as string;
                                const configSys2 = (config.systemType as string) || '';
                                const effectiveSys2 = (layoutSys2 === 'fence' || layoutSys2 === 'solar_fence' || layoutSys2 === 'ground' || layoutSys2 === 'ground_mount')
                                  ? layoutSys2
                                  : (configSys2 === 'fence' || configSys2 === 'solar_fence' || configSys2 === 'ground' || configSys2 === 'ground_mount')
                                    ? configSys2
                                    : layoutSys2 || configSys2 || 'roof';
                                const resolvedType2 = (effectiveSys2 === 'fence' || effectiveSys2 === 'solar_fence') ? 'solar_fence'
                                  : (effectiveSys2 === 'ground' || effectiveSys2 === 'ground_mount') ? 'ground_mount'
                                  : 'roof';
                                return {
                                  type: resolvedType2,
                                  systemType: effectiveSys2,
                                  fenceLine: projectLayout.fenceLine || undefined,
                                  fenceSegments: projectLayout.fenceLine?.length > 1
                                    ? projectLayout.fenceLine.slice(0, -1).map((pt: any, i: number) => {
                                        const ep = projectLayout.fenceLine[i + 1];
                                        const DEG2RAD = Math.PI / 180;
                                        const EARTH_R = 6_371_000;
                                        const cosLat  = Math.cos(pt.lat * DEG2RAD);
                                        const dx = (ep.lng - pt.lng) * DEG2RAD * cosLat * EARTH_R;
                                        const dy = (ep.lat - pt.lat) * DEG2RAD * EARTH_R;
                                        const lenM   = Math.sqrt(dx * dx + dy * dy);
                                        const lenFt  = Math.round(lenM * 3.28084 * 10) / 10;
                                        const az     = Math.round(((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360);
                                        return { id: `seg-${i}`, startPoint: pt, endPoint: ep, lengthFt: lenFt, azimuth: az, panelCount: 0 };
                                      })
                                    : undefined,
                                  groundArrays: (effectiveSys2 === 'ground' || effectiveSys2 === 'ground_mount') ? [{ id: 'ground-1' }] : undefined,
                                  panels: (projectLayout.panels || []).map((p: any) => ({
                                    id: p.id, lat: p.lat, lng: p.lng, x: p.x, y: p.y,
                                    systemType: p.systemType || p.placementType || undefined,
                                  })),
                                }; })() : undefined,
                            };
                            const res = await fetch('/api/engineering/permit?format=html', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(permitInput),
                            });
                            if (res.ok) {
                              const html = await res.text();
                              const win = window.open('', '_blank');
                              if (win) { win.document.write(html); win.document.close(); }
                            } else if (res.status === 422) {
                              const errData = await res.json().catch(() => ({}));
                              if (errData.code === 'ENGINEERING_MODEL_STALE') {
                                alert(`⚠️ Permit Blocked — Stale Engineering Model\n\n${errData.message ?? 'Panel count is 0. Please open the Engineering page, wait for the pipeline sync to complete, then try again.'}`);
                              } else {
                                alert(`Permit preview failed (422): ${errData.message ?? 'Unknown error'}`);
                              }
                            } else {
                              const errText = await res.text().catch(() => '');
                              alert(`Permit preview failed (${res.status}). Please check the console for details.\n\n${errText.slice(0, 200)}`);
                            }
                          }}
                          className="btn-secondary w-full flex items-center justify-center gap-2 mt-2"
                        >
                          <Eye size={16} /> Preview in Browser
                        </button>
                      </div>
                    </div>

                  </div>

                </div>
              );
            })())}

          {/* ── BOM TAB ── */}
          {activeTab === 'bom' && (!canBOM ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
                  <Lock size={28} className="text-violet-400" />
                </div>
                <h3 className="text-white font-bold text-lg mb-1">Bill of Materials</h3>
                <p className="text-slate-400 text-sm mb-4 max-w-sm">BOM export and detailed material lists require Professional plan or above.</p>
                <a href="/account/billing" className="btn-primary inline-flex gap-2">Upgrade to Professional</a>
              </div>
            ) : (
              <div className="space-y-5">

                {/* ── HEADER BAR ── */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Grid size={14} className="text-violet-400" />
                      Bill of Materials
                      <span className="text-xs font-normal bg-violet-500/15 text-violet-300 border border-violet-500/25 px-2 py-0.5 rounded-full">Auto-Sourced · Distributor Priced</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Derived from inverter ecosystem · mounting system · conduit type · jurisdiction · CED/Soligent/KWh pricing
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {bom.length > 0 && (
                      <>
                        <button
                          onClick={() => {
                            const csvHeader = 'Stage,Manufacturer,Model,Part Number,Qty,Unit,Unit Cost,Total Cost,Category,NEC Ref,Derived From';
                            const csvRows = bom.map((i: any) => [
                              i.stageLabel || i.stageId || '',
                              i.manufacturer, i.model, i.partNumber,
                              i.quantity, i.unit,
                              i.unitCost != null ? i.unitCost.toFixed(2) : '',
                              i.totalCost != null ? i.totalCost.toFixed(2) : '',
                              i.category, i.necReference || '', i.derivedFrom
                            ].map((v: any) => JSON.stringify(String(v ?? ''))).join(',')).join('\r\n');
                            const blob = new Blob([csvHeader + '\r\n' + csvRows], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `BOM-${config.projectName || 'project'}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="btn-secondary btn-sm"
                        >
                          <Download size={13} /> Export CSV
                        </button>
                      </>
                    )}
                    <button onClick={fetchBOM} disabled={bomLoading} className="btn-primary btn-sm">
                      <RefreshCw size={13} className={bomLoading ? 'animate-spin' : ''} />
                      {bomLoading ? 'Generating…' : bom.length > 0 ? 'Regenerate' : 'Generate BOM'}
                    </button>
                  </div>
                </div>

                {bomError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                    <XCircle size={14} /> {bomError}
                  </div>
                )}

                {/* ── EMPTY STATE ── */}
                {!bom.length && !bomLoading && !bomError && (
                  <div className="card p-14 text-center border-dashed border-slate-700">
                    <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
                      <Grid size={26} className="text-violet-400" />
                    </div>
                    <div className="text-sm font-bold text-white mb-1">Auto-Sourced BOM Ready</div>
                    <div className="text-xs text-slate-500 mb-5 max-w-xs mx-auto">
                      Click Generate to auto-derive all materials from your system — mounting hardware, wire, conduit, disconnects, monitoring, grounding, labels — all priced from CED/Soligent/KWh distributor catalog.
                    </div>
                    <button onClick={fetchBOM} className="btn-primary btn-sm mx-auto">
                      <Grid size={13} /> Generate BOM
                    </button>
                  </div>
                )}

                {bomLoading && (
                  <div className="card p-12 text-center">
                    <RefreshCw size={28} className="mx-auto mb-3 text-violet-400 animate-spin" />
                    <div className="text-sm text-slate-400">Deriving materials · resolving distributor pricing…</div>
                  </div>
                )}

                {bom.length > 0 && !bomLoading && (() => {
                  // ── cost helpers ──
                  const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  const fmtK = (n: number) => n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : fmt$(n);
                  const pricedItems  = bom.filter((i: any) => i.totalCost != null && i.totalCost > 0);
                  const unpricedCount = bom.filter((i: any) => !i.totalCost).length;
                  const totalCost = bomPricing?.totalBomCost ?? pricedItems.reduce((s: number, i: any) => s + (i.totalCost ?? 0), 0);

                  // ── stage grouping ──
                  const stageOrder = ['array', 'dc', 'inverter', 'ac', 'structural', 'monitoring', 'labels'];
                  const stageLabels: Record<string, string> = {
                    array:      'Stage 1 — Array',
                    dc:         'Stage 2 — DC Wiring',
                    inverter:   'Stage 3 — Inverter',
                    ac:         'Stage 4 — AC Wiring',
                    structural: 'Stage 5 — Structural',
                    monitoring: 'Stage 6 — Monitoring',
                    labels:     'Stage 7 — Labels',
                  };
                  const stageColors: Record<string, string> = {
                    array:      'text-amber-400  bg-amber-500/10  border-amber-500/25',
                    dc:         'text-blue-400   bg-blue-500/10   border-blue-500/25',
                    inverter:   'text-violet-400 bg-violet-500/10 border-violet-500/25',
                    ac:         'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
                    structural: 'text-orange-400 bg-orange-500/10 border-orange-500/25',
                    monitoring: 'text-sky-400    bg-sky-500/10    border-sky-500/25',
                    labels:     'text-slate-400  bg-slate-500/10  border-slate-500/25',
                  };
                  const stageIconColors: Record<string, string> = {
                    array:      'bg-amber-500/15 text-amber-400',
                    dc:         'bg-blue-500/15 text-blue-400',
                    inverter:   'bg-violet-500/15 text-violet-400',
                    ac:         'bg-emerald-500/15 text-emerald-400',
                    structural: 'bg-orange-500/15 text-orange-400',
                    monitoring: 'bg-sky-500/15 text-sky-400',
                    labels:     'bg-slate-500/15 text-slate-400',
                  };

                  // Build stage groups from bom array
                  const groupMap: Record<string, any[]> = {};
                  for (const item of bom) {
                    const sid = item.stageId || 'array';
                    if (!groupMap[sid]) groupMap[sid] = [];
                    groupMap[sid].push(item);
                  }
                  const stages = stageOrder
                    .filter(sid => groupMap[sid]?.length > 0)
                    .concat(Object.keys(groupMap).filter(k => !stageOrder.includes(k)));

                  const stageCosts: Record<string, number> = {};
                  for (const sid of stages) {
                    stageCosts[sid] = (groupMap[sid] || []).reduce((s: number, i: any) => s + (i.totalCost ?? 0), 0);
                  }
                  const maxStageCost = Math.max(...Object.values(stageCosts).filter(v => v > 0), 1);

                  return (
                    <>
                      {/* ── COST HERO BAR ── */}
                      <div className="rounded-xl border border-slate-700/60 bg-gradient-to-br from-slate-900 via-slate-900/95 to-violet-950/20 p-5">
                        <div className="flex flex-wrap items-start gap-6">
                          {/* Total cost */}
                          <div className="flex-1 min-w-[160px]">
                            <div className="text-xs text-slate-500 mb-0.5 uppercase tracking-widest font-semibold">Est. Hardware Cost</div>
                            <div className="text-3xl font-black text-white tabular-nums tracking-tight">{fmtK(totalCost)}</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {bomPricing?.pricingApplied ? 'CED · Soligent · KWh Q1 2025' : 'Category estimates'}
                              {unpricedCount > 0 && <span className="text-amber-400 ml-2">· {unpricedCount} unpriced</span>}
                            </div>
                          </div>

                          {/* Stats chips */}
                          <div className="flex flex-wrap gap-2 items-center">
                            <div className="flex flex-col items-center bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 min-w-[72px]">
                              <span className="text-xs text-slate-500">Lines</span>
                              <span className="text-lg font-bold text-white tabular-nums">{bom.length}</span>
                            </div>
                            <div className="flex flex-col items-center bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 min-w-[72px]">
                              <span className="text-xs text-slate-500">Stages</span>
                              <span className="text-lg font-bold text-white tabular-nums">{stages.length}</span>
                            </div>
                            {bomPricing && (
                              <>
                                <div className="flex flex-col items-center bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 min-w-[72px]">
                                  <span className="text-xs text-emerald-500">Catalog</span>
                                  <span className="text-lg font-bold text-emerald-400 tabular-nums">{bomPricing.catalogMatches}</span>
                                </div>
                                {bomPricing.overrideMatches > 0 && (
                                  <div className="flex flex-col items-center bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 min-w-[72px]">
                                    <span className="text-xs text-blue-400">Override</span>
                                    <span className="text-lg font-bold text-blue-400 tabular-nums">{bomPricing.overrideMatches}</span>
                                  </div>
                                )}
                                {bomPricing.fallbackMatches > 0 && (
                                  <div className="flex flex-col items-center bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 min-w-[72px]">
                                    <span className="text-xs text-amber-400">Fallback</span>
                                    <span className="text-lg font-bold text-amber-400 tabular-nums">{bomPricing.fallbackMatches}</span>
                                  </div>
                                )}
                                {bomPricing.unpriced > 0 && (
                                  <div className="flex flex-col items-center bg-slate-700/50 border border-slate-600/40 rounded-lg px-3 py-2 min-w-[72px]">
                                    <span className="text-xs text-slate-500">Unpriced</span>
                                    <span className="text-lg font-bold text-slate-400 tabular-nums">{bomPricing.unpriced}</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Stage cost breakdown bars */}
                        <div className="mt-4 pt-4 border-t border-slate-700/40">
                          <div className="text-xs text-slate-500 mb-3 font-semibold uppercase tracking-widest">Cost by Stage</div>
                          <div className="space-y-1.5">
                            {stages.filter(sid => stageCosts[sid] > 0).map(sid => {
                              const pct = Math.round((stageCosts[sid] / totalCost) * 100);
                              const barPct = Math.round((stageCosts[sid] / maxStageCost) * 100);
                              const label = stageLabels[sid] || sid;
                              const colCls = stageColors[sid] || 'text-slate-400 bg-slate-500/10 border-slate-500/25';
                              const [textCol] = colCls.split(' ');
                              return (
                                <div key={sid} className="flex items-center gap-3 group">
                                  <div className="w-36 text-xs text-slate-400 truncate text-right shrink-0">{label}</div>
                                  <div className="flex-1 h-5 bg-slate-800/60 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-700 ${
                                        sid === 'array'      ? 'bg-amber-500/70' :
                                        sid === 'dc'         ? 'bg-blue-500/70' :
                                        sid === 'inverter'   ? 'bg-violet-500/70' :
                                        sid === 'ac'         ? 'bg-emerald-500/70' :
                                        sid === 'structural' ? 'bg-orange-500/70' :
                                        sid === 'monitoring' ? 'bg-sky-500/70' :
                                        'bg-slate-500/70'
                                      }`}
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                  <div className="w-24 text-xs tabular-nums text-right shrink-0">
                                    <span className={`font-bold ${textCol}`}>{fmtK(stageCosts[sid])}</span>
                                    <span className="text-slate-600 ml-1">({pct}%)</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* ── Cost Category Roll-Up ── */}
                        {(() => {
                          // Map BOM items to 5 high-level cost buckets
                          const _catMeta: Record<string, { label: string; color: string; barCls: string }> = {
                            'PV Equipment':     { label: 'PV Equipment',     color: 'text-amber-400',  barCls: 'bg-amber-500/80'  },
                            'Electrical BOS':   { label: 'Electrical BOS',   color: 'text-blue-400',   barCls: 'bg-blue-500/80'   },
                            'Inverter/Storage': { label: 'Inverter/Storage', color: 'text-violet-400', barCls: 'bg-violet-500/80' },
                            'Structural':       { label: 'Structural',       color: 'text-orange-400', barCls: 'bg-orange-500/80' },
                            'Controls/Other':   { label: 'Controls/Other',   color: 'text-sky-400',    barCls: 'bg-sky-500/80'    },
                          };
                          const _itemToCat = (item: any): string => {
                            const _c = item.category ?? '';
                            const _s = item.stageId ?? '';
                            if (['solar_panel','optimizer','microinverter','trunk_cable','terminator','rapid_shutdown'].includes(_c)) return 'PV Equipment';
                            if (['string_inverter','inverter','battery','generator','ats','backup_interface'].includes(_c)) return 'Inverter/Storage';
                            if (['wire','dc_disconnect','ac_disconnect','breaker','junction_box','conduit','conduit_fitting','wire_lug','ground_wire'].includes(_c)) return 'Electrical BOS';
                            if (['racking','rail','mount','flashing','splice','mid_clamp','end_clamp','grounding_lug','bonding'].includes(_c) || _s === 'structural') return 'Structural';
                            return 'Controls/Other';
                          };
                          const _catTotals: Record<string, number> = {};
                          for (const _item of bom) { const _b = _itemToCat(_item); _catTotals[_b] = (_catTotals[_b] ?? 0) + (_item.totalCost ?? 0); }
                          const _grandTotal = Object.values(_catTotals).reduce((s, v) => s + v, 0) || 1;
                          const _catKeys = Object.keys(_catMeta).filter(k => (_catTotals[k] ?? 0) > 0);
                          if (_catKeys.length === 0) return null;
                          return (
                            <div className="mt-4 pt-4 border-t border-slate-700/40">
                              <div className="text-xs text-slate-500 mb-3 font-semibold uppercase tracking-widest">Cost Category Breakdown</div>
                              {/* Stacked proportional bar */}
                              <div className="flex h-4 rounded-full overflow-hidden mb-3 gap-px">
                                {_catKeys.map(k => {
                                  const _pct = (_catTotals[k] / _grandTotal) * 100;
                                  if (_pct < 0.5) return null;
                                  return (
                                    <div key={k}
                                      className={`h-full transition-all duration-700 first:rounded-l-full last:rounded-r-full ${_catMeta[k].barCls}`}
                                      style={{ width: `${_pct}%` }}
                                      title={`${k}: $${_catTotals[k].toLocaleString('en-US', { maximumFractionDigits: 0 })} (${Math.round(_pct)}%)`}
                                    />
                                  );
                                })}
                              </div>
                              {/* Legend */}
                              <div className="space-y-1">
                                {_catKeys.map(k => {
                                  const _cost = _catTotals[k] ?? 0;
                                  const _pct  = Math.round((_cost / _grandTotal) * 100);
                                  return (
                                    <div key={k} className="flex items-center gap-2">
                                      <div className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${_catMeta[k].barCls}`} />
                                      <span className="text-xs text-slate-400 flex-1 truncate">{_catMeta[k].label}</span>
                                      <span className={`text-xs font-bold tabular-nums ${_catMeta[k].color}`}>{fmtK(_cost)}</span>
                                      <span className="text-xs text-slate-600 w-10 text-right tabular-nums">({_pct}%)</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* ── BOM SELF-CHECK BANNER ── */}
                      {(() => {
                        const totalPanelsBom = config.inverters.reduce((s: number, inv: any) => s + inv.strings.reduce((ss: number, st: any) => ss + st.panelCount, 0), 0);
                        const firstInvBom = config.inverters[0];
                        const isMicroBom = firstInvBom?.type === 'micro';
                        const bomPanelItem = bom.find((i: any) => i.category === 'panels' || i.category === 'solar_panel');
                        const bomPanelQty = bomPanelItem?.quantity ?? 0;
                        const panelCheck = bomPanelQty === totalPanelsBom;
                        let microCheck = true, expectedMicro = 0, bomMicroQty = 0;
                        if (isMicroBom) {
                          const invDataBomCheck = MICROINVERTERS.find((m: any) => m.id === firstInvBom.inverterId);
                          const mpdBomCheck = firstInvBom.deviceRatioOverride ?? invDataBomCheck?.modulesPerDevice ?? 1;
                          expectedMicro = Math.ceil(totalPanelsBom / mpdBomCheck);
                          bomMicroQty = bom.find((i: any) => i.category === 'microinverter')?.quantity ?? 0;
                          microCheck = bomMicroQty === expectedMicro;
                        }
                        let stringInvCheck = true, expectedStringInv = 0, bomStringInvQty = 0;
                        if (!isMicroBom) {
                          // v58.3 FIX: Use sizingRecommendation as source of truth for expected inverter count.
                          // config.inverters.length is the STRING count (1 entry per string), NOT physical
                          // inverter count. For a 36-panel SE11400H, config.inverters.length=36 (one per string),
                          // causing false-positive PASS when BOM also had qty=36 from the stale fallback.
                          const _rawInvCount = config.inverters.length;
                          const _isOpt = firstInvBom?.type === 'optimizer';
                          const _physMaxCheck = _isOpt
                            ? Math.max(1, Math.ceil(totalPanelsBom / 25))
                            : Math.max(1, Math.ceil(totalPanelsBom / 8));
                          expectedStringInv = sizingRecommendation?.inverterCount
                            ?? (_rawInvCount > _physMaxCheck ? 1 : _rawInvCount);
                          bomStringInvQty = bom.find((i: any) => i.category === 'string_inverter' || i.category === 'inverter')?.quantity ?? 0;
                          stringInvCheck = bomStringInvQty === expectedStringInv;
                        }
                        const allPass = panelCheck && microCheck && stringInvCheck;
                        if (allPass) return (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-xs text-emerald-400">
                            <CheckCircle size={13} /> BOM self-check passed — panel count, inverter count all match config
                          </div>
                        );
                        return (
                          <div className="px-3 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/25 space-y-1">
                            <div className="flex items-center gap-2 text-xs text-amber-400 font-semibold"><AlertCircle size={13} /> BOM self-check warnings</div>
                            {!panelCheck && <div className="text-xs text-amber-300/80 pl-5">Panels: BOM={bomPanelQty} · Config={totalPanelsBom}</div>}
                            {!microCheck && isMicroBom && <div className="text-xs text-amber-300/80 pl-5">Microinverters: BOM={bomMicroQty} · Expected={expectedMicro}</div>}
                            {!stringInvCheck && !isMicroBom && <div className="text-xs text-amber-300/80 pl-5">String inverters: BOM={bomStringInvQty} · Config={expectedStringInv}</div>}
                          </div>
                        );
                      })()}

                      {/* ── STAGE ACCORDION TABLES ── */}
                      <div className="space-y-3">
                        {stages.map((sid, stageIdx) => {
                          const items = groupMap[sid] || [];
                          if (!items.length) return null;
                          const label = stageLabels[sid] || sid;
                          const colCls = stageColors[sid] || 'text-slate-400 bg-slate-500/10 border-slate-500/25';
                          const [textCol, bgCol, borderCol] = colCls.split(/\s+/);
                          const stageTotalCost = items.reduce((s: number, i: any) => s + (i.totalCost ?? 0), 0);
                          const hasPrice = stageTotalCost > 0;

                          return (
                            <div key={sid} className={`rounded-xl border overflow-hidden ${borderCol}`}>
                              {/* Stage header */}
                              <div className={`px-4 py-2.5 flex items-center justify-between ${bgCol}`}>
                                <div className="flex items-center gap-2.5">
                                  <span className={`text-xs font-bold uppercase tracking-wider ${textCol}`}>{label}</span>
                                  <span className="text-xs text-slate-500 tabular-nums">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  {hasPrice && (
                                    <span className={`text-sm font-bold tabular-nums ${textCol}`}>{fmtK(stageTotalCost)}</span>
                                  )}
                                </div>
                              </div>

                              {/* Stage table */}
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-700/40 bg-slate-900/60">
                                      <th className="text-left text-slate-500 px-4 py-2 font-semibold w-28">Mfr</th>
                                      <th className="text-left text-slate-500 px-4 py-2 font-semibold">Model</th>
                                      <th className="text-left text-slate-500 px-4 py-2 font-semibold w-32 font-mono">Part #</th>
                                      <th className="text-right text-slate-500 px-3 py-2 font-semibold w-14">Qty</th>
                                      <th className="text-left text-slate-500 px-2 py-2 font-semibold w-10">Unit</th>
                                      <th className="text-right text-slate-500 px-3 py-2 font-semibold w-24">Unit Cost</th>
                                      <th className="text-right text-slate-500 px-4 py-2 font-semibold w-24">Total</th>
                                      <th className="text-left text-slate-500 px-4 py-2 font-semibold w-24 hidden xl:table-cell">NEC Ref</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/50">
                                    {items.map((item: any, idx: number) => (
                                      <tr key={item.id || idx} className="hover:bg-slate-800/30 transition-colors group">
                                        <td className="px-4 py-2 text-slate-400 truncate max-w-[112px]">{item.manufacturer}</td>
                                        <td className="px-4 py-2 text-white font-medium">{item.model}</td>
                                        <td className="px-4 py-2 text-slate-500 font-mono text-[11px] truncate max-w-[128px]">{item.partNumber}</td>
                                        <td className="px-3 py-2 text-right">
                                          <span className={`font-bold tabular-nums ${textCol}`}>{item.quantity}</span>
                                        </td>
                                        <td className="px-2 py-2 text-slate-500">{item.unit}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                          {item.unitCost != null
                                            ? <span className="text-slate-300">{fmt$(item.unitCost)}</span>
                                            : <span className="text-slate-700">—</span>}
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums">
                                          {item.totalCost != null
                                            ? <span className="text-white font-semibold">{fmt$(item.totalCost)}</span>
                                            : <span className="text-slate-700">—</span>}
                                        </td>
                                        <td className="px-4 py-2 text-slate-600 font-mono text-[11px] hidden xl:table-cell">
                                          {item.necReference || '—'}
                                        </td>
                                      </tr>
                                    ))}
                                    {/* Stage subtotal row */}
                                    {hasPrice && (
                                      <tr className={`${bgCol} border-t border-slate-700/40`}>
                                        <td colSpan={6} className={`px-4 py-2 text-xs font-bold text-right ${textCol} uppercase tracking-wide`}>Stage Subtotal</td>
                                        <td className={`px-4 py-2 text-right text-sm font-black tabular-nums ${textCol}`}>{fmtK(stageTotalCost)}</td>
                                        <td className="hidden xl:table-cell" />
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* ── TOTAL FOOTER ── */}
                      <div className="flex items-center justify-between px-5 py-3.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
                        <div className="text-xs text-slate-500 space-x-4">
                          <span>{bom.length} line items</span>
                          <span>·</span>
                          <span>{stages.length} stages</span>
                          {unpricedCount > 0 && <><span>·</span><span className="text-amber-400">{unpricedCount} items without pricing</span></>}
                          {bomPricing?.pricingApplied && <><span>·</span><span className="text-slate-600">Prices: CED · Soligent · KWh Q1 2025</span></>}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Total Est. Hardware Cost</span>
                          <span className="text-xl font-black text-white tabular-nums">{fmtK(totalCost)}</span>
                        </div>
                      </div>

                    </>
                  );
                })()}

              </div>
            ))}

        {/* ── CLIENT FILES TAB ── */}
          {activeTab === 'files' && (
            <div className="max-w-none space-y-4">
              {/* ══════════ CLIENT FILES HERO ══════════ */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl mb-4">
                <div className="absolute -top-8 -right-8 w-36 h-36 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-teal-500/20 to-transparent" />
                <div className="flex items-center gap-2 mb-4">
                  <FolderOpen size={14} className="text-teal-400" />
                  <span className="text-sm font-bold text-white">Client Engineering Workspace</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/30 font-mono ml-auto">
                    Auto-generated
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="rounded-xl bg-slate-900/60 border border-teal-500/20 px-3 py-2.5 text-center">
                    <div className="text-xl font-black text-teal-400 tabular-nums">{projectFiles.length}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Files</div>
                  </div>
                  <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                    <div className="text-xl font-black text-amber-400 tabular-nums">{totalKw}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">kW DC</div>
                  </div>
                  <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 text-center">
                    <div className="text-xl font-black text-white tabular-nums">{totalPanels}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Panels</div>
                  </div>
                  <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 text-center">
                    <div className="text-xl font-black text-white tabular-nums">{config.inverters.length}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Inverters</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                    Bill Data · Estimate · Engineering · SLD · BOM
                  </div>
                  {currentProjectId && (
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-teal-500/30 bg-teal-500/10 text-teal-400 font-semibold">
                      <CheckCircle size={10} /> Project loaded
                    </div>
                  )}
                  {!currentProjectId && (
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                      <AlertCircle size={10} /> No project selected
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <FolderOpen size={14} className="text-amber-400" /> Client Engineering Workspace
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Auto-generated from bill upload · Bill Data · System Estimate · Engineering Packet · SLD · BOM
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!currentProjectId) return;
                      setFilesLoading(true);
                      try {
                        await saveEngineeringOutputs(computedSystem);
                        const res = await fetch(`/api/project-files?projectId=${currentProjectId}`);
                        const d = await res.json();
                        if (d.success) setProjectFiles(d.data || []);
                      } finally {
                        setFilesLoading(false);
                      }
                    }}
                    disabled={filesLoading || !currentProjectId}
                    className="btn-primary btn-sm"
                    title="Re-generate all engineering files from current calc state"
                  >
                    <Zap size={13} />
                    Generate Files
                  </button>
                  <button
                    onClick={fetchProjectFiles}
                    disabled={filesLoading}
                    className="btn-secondary btn-sm"
                  >
                    <RefreshCw size={13} className={filesLoading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>
              </div>

              {fileUploadError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                  <XCircle size={13} /> {fileUploadError}
                </div>
              )}

              {filesError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                  <XCircle size={13} /> {filesError}
                </div>
              )}

              {/* ── Pipeline Verification Panel (v47.56) ── */}
              <div className="border border-slate-700/60 rounded-xl bg-slate-800/40 overflow-hidden">
                {/* Panel header with RUN button */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-800/60">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Activity size={14} className="text-amber-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Pipeline Status</span>
                    {/* Auto-engineering status badge */}
                    {totalPanels > 0 ? (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                        <CheckCircle size={10} /> Auto-engineering active
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-700/50 text-slate-400 border border-slate-600/50">
                        Waiting for layout
                      </span>
                    )}
                    {pipelineResult && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        pipelineResult.success
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                          : 'bg-red-500/15 text-red-400 border border-red-500/25'
                      }`}>
                        Sync: {pipelineResult.success ? 'PASS' : 'FAIL'}
                      </span>
                    )}
                    {pipelineResult?.runAt && (
                      <span className="text-xs text-slate-500">
                        {new Date(pipelineResult.runAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {totalPanels > 0 && (
                      <span className="text-xs text-slate-400 hidden lg:flex items-center gap-1">
                        <Zap size={10} className="text-amber-400" />
                        Engineering auto-runs on every layout save
                      </span>
                    )}
                    <button
                      onClick={runPipeline}
                      disabled={pipelineRunning || !currentProjectId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Manually sync pipeline — engineering auto-runs on every layout save"
                    >
                      {pipelineRunning
                        ? <><RefreshCw size={12} className="animate-spin" /> Syncing&hellip;</>
                        : <><RefreshCw size={12} /> Sync Now</>
                      }
                    </button>
                  </div>
                </div>

                {/* Pipeline error banner */}
                {pipelineError && (
                  <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                    <XCircle size={12} /> {pipelineError}
                  </div>
                )}

                {/* Mismatch banners */}
                {(pipelineResult?.mismatches?.length ?? 0) > 0 && (
                  <div className="px-4 py-2 border-b border-slate-700/40 space-y-1.5">
                    {pipelineResult.mismatches.map((m: any, i: number) => (
                      <div key={i} className={`flex items-start gap-2 text-xs p-2 rounded-lg ${
                        m.severity === 'ERROR'
                          ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                          : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                      }`}>
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <div>
                          <span className="font-bold">{m.code}</span>
                          <span className="text-slate-400 ml-1">&mdash; {m.message}</span>
                          <span className="ml-2 text-slate-500">
                            (layout: {m.layoutValue} / engineering: {m.engineeringValue})
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Subsystem status rows */}
                {pipelineResult ? (
                  <div className="divide-y divide-slate-700/30">

                    {/* Layout row */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${pipelineResult.layout?.exists ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span className="text-xs font-semibold text-slate-300">Layout</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          {pipelineResult.layout?.exists ? (
                            <>
                              <span>{pipelineResult.layout.panels} panels</span>
                              <span>{pipelineResult.layout.roofPlanes} planes</span>
                              <span>{pipelineResult.layout.systemSizeKw?.toFixed(2)} kW</span>
                              <span className="text-slate-600">|</span>
                              {pipelineResult.layout.layoutSaved
                                ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={11} /> Saved</span>
                                : <span className="text-amber-400 flex items-center gap-1"><AlertTriangle size={11} /> Not saved</span>
                              }
                            </>
                          ) : (
                            <span className="text-red-400">No layout found</span>
                          )}
                          <button
                            onClick={() => setPipelineRawExpanded(s => ({ ...s, layout: !s.layout }))}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            {pipelineRawExpanded.layout ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>
                      </div>
                      {pipelineRawExpanded.layout && (
                        <pre className="mt-2 text-xs bg-slate-900/60 rounded-lg p-3 text-slate-400 overflow-x-auto max-h-48 font-mono">
                          {JSON.stringify(pipelineResult.layout, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Engineering row */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${pipelineResult.engineering?.exists ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span className="text-xs font-semibold text-slate-300">Engineering</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          {pipelineResult.engineering?.exists ? (
                            <>
                              <span>{pipelineResult.engineering.moduleCount} modules</span>
                              <span>{pipelineResult.engineering.systemSizeKw?.toFixed(2)} kW</span>
                              <span className="truncate max-w-[120px]" title={pipelineResult.engineering.panelModel}>
                                {pipelineResult.engineering.panelModel || '—'}
                              </span>
                              <span className="text-slate-600">|</span>
                              {pipelineResult.engineering.wasRebuilt
                                ? <span className="text-amber-400 flex items-center gap-1"><RefreshCw size={11} /> Rebuilt</span>
                                : <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={11} /> Current</span>
                              }
                            </>
                          ) : (
                            <span className="text-red-400">No engineering model</span>
                          )}
                          <button
                            onClick={() => setPipelineRawExpanded(s => ({ ...s, engineering: !s.engineering }))}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            {pipelineRawExpanded.engineering ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>
                      </div>
                      {pipelineRawExpanded.engineering && (
                        <pre className="mt-2 text-xs bg-slate-900/60 rounded-lg p-3 text-slate-400 overflow-x-auto max-h-48 font-mono">
                          {JSON.stringify(pipelineResult.engineering, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Artifacts row */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            Object.values(pipelineResult.artifacts ?? {}).every(Boolean) ? 'bg-emerald-400'
                            : Object.values(pipelineResult.artifacts ?? {}).some(Boolean) ? 'bg-amber-400'
                            : 'bg-red-400'
                          }`} />
                          <span className="text-xs font-semibold text-slate-300">Artifacts</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          {[
                            { key: 'bomGenerated',     label: 'BOM'     },
                            { key: 'sldGenerated',     label: 'SLD'     },
                            { key: 'structuralCalcs',  label: 'Struct'  },
                            { key: 'permitPacket',     label: 'Permit'  },
                            { key: 'engineeringReport',label: 'Eng Rpt' },
                          ].map(a => (
                            <span key={a.key} className={`flex items-center gap-0.5 ${
                              pipelineResult.artifacts?.[a.key] ? 'text-emerald-400' : 'text-slate-600'
                            }`}>
                              {pipelineResult.artifacts?.[a.key]
                                ? <CheckCircle size={10} />
                                : <XCircle size={10} />
                              }
                              {a.label}
                            </span>
                          ))}
                          <button
                            onClick={() => setPipelineRawExpanded(s => ({ ...s, artifacts: !s.artifacts }))}
                            className="text-slate-500 hover:text-slate-300 transition-colors ml-1"
                          >
                            {pipelineRawExpanded.artifacts ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>
                      </div>
                      {pipelineRawExpanded.artifacts && (
                        <pre className="mt-2 text-xs bg-slate-900/60 rounded-lg p-3 text-slate-400 overflow-x-auto max-h-48 font-mono">
                          {JSON.stringify(pipelineResult.artifacts, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Permit row */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            pipelineResult.permit?.ready ? 'bg-emerald-400' : 'bg-amber-400'
                          }`} />
                          <span className="text-xs font-semibold text-slate-300">Permit Sheets</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span className={
                            (pipelineResult.permit?.sheetsGenerated ?? 0) >= (pipelineResult.permit?.sheetsExpected ?? 13)
                              ? 'text-emerald-400' : 'text-amber-400'
                          }>
                            {pipelineResult.permit?.sheetsGenerated ?? 0} / {pipelineResult.permit?.sheetsExpected ?? 13} sheets
                          </span>
                          <span>{pipelineResult.permit?.totalPanels} panels</span>
                          <span>{pipelineResult.permit?.systemKw?.toFixed(2)} kW</span>
                          <span className="text-slate-600">|</span>
                          {pipelineResult.permit?.ready
                            ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={11} /> Ready</span>
                            : <span className="text-amber-400 flex items-center gap-1"><AlertTriangle size={11} /> Incomplete</span>
                          }
                          <button
                            onClick={() => setPipelineRawExpanded(s => ({ ...s, permit: !s.permit }))}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            {pipelineRawExpanded.permit ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>
                      </div>
                      {pipelineRawExpanded.permit && (
                        <pre className="mt-2 text-xs bg-slate-900/60 rounded-lg p-3 text-slate-400 overflow-x-auto max-h-48 font-mono">
                          {JSON.stringify(pipelineResult.permit, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Client Files row */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            (pipelineResult.clientFiles?.visibleWorkspaceFiles ?? 0) > 0 ? 'bg-emerald-400' : 'bg-amber-400'
                          }`} />
                          <span className="text-xs font-semibold text-slate-300">Client Files</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span>{pipelineResult.clientFiles?.artifactRegistryEntries ?? 0} registry entries</span>
                          <span className="text-slate-600">|</span>
                          <span>{pipelineResult.clientFiles?.visibleWorkspaceFiles ?? 0} workspace files</span>
                          <button
                            onClick={() => setPipelineRawExpanded(s => ({ ...s, clientFiles: !s.clientFiles }))}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            {pipelineRawExpanded.clientFiles ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>
                      </div>
                      {pipelineRawExpanded.clientFiles && (
                        <pre className="mt-2 text-xs bg-slate-900/60 rounded-lg p-3 text-slate-400 overflow-x-auto max-h-48 font-mono">
                          {JSON.stringify(pipelineResult.clientFiles, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Workflow row */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            pipelineResult.workflow?.filesReady ? 'bg-emerald-400' : 'bg-slate-500'
                          }`} />
                          <span className="text-xs font-semibold text-slate-300">Workflow</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          {[
                            { key: 'designComplete',      label: 'Design'      },
                            { key: 'engineeringComplete', label: 'Engineering' },
                            { key: 'permitReady',         label: 'Permit'      },
                            { key: 'filesReady',          label: 'Files'       },
                          ].map(w => (
                            <span key={w.key} className={`flex items-center gap-0.5 ${
                              pipelineResult.workflow?.[w.key] ? 'text-emerald-400' : 'text-slate-600'
                            }`}>
                              {pipelineResult.workflow?.[w.key]
                                ? <CheckCircle size={10} />
                                : <XCircle size={10} />
                              }
                              {w.label}
                            </span>
                          ))}
                          <button
                            onClick={() => setPipelineRawExpanded(s => ({ ...s, workflow: !s.workflow }))}
                            className="text-slate-500 hover:text-slate-300 transition-colors ml-1"
                          >
                            {pipelineRawExpanded.workflow ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>
                      </div>
                      {pipelineRawExpanded.workflow && (
                        <pre className="mt-2 text-xs bg-slate-900/60 rounded-lg p-3 text-slate-400 overflow-x-auto max-h-48 font-mono">
                          {JSON.stringify(pipelineResult.workflow, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Pipeline Steps row */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-300">
                            Pipeline Steps ({pipelineResult.steps?.length ?? 0})
                          </span>
                          <span className="text-xs text-slate-500">
                            {pipelineResult.durationMs}ms
                          </span>
                        </div>
                        <button
                          onClick={() => setPipelineRawExpanded(s => ({ ...s, steps: !s.steps }))}
                          className="text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 text-xs"
                        >
                          {pipelineRawExpanded.steps ? 'Hide' : 'Show'} steps
                          {pipelineRawExpanded.steps ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </div>
                      {pipelineRawExpanded.steps && (
                        <div className="mt-2 space-y-1">
                          {(pipelineResult.steps ?? []).map((st: any, i: number) => (
                            <div key={i} className={`flex items-start gap-2 text-xs px-2 py-1.5 rounded-lg ${
                              st.status === 'ok'      ? 'bg-emerald-500/5 text-emerald-300'  :
                              st.status === 'warning' ? 'bg-amber-500/5   text-amber-300'    :
                              st.status === 'error'   ? 'bg-red-500/5     text-red-300'      :
                                                        'bg-slate-700/20  text-slate-500'
                            }`}>
                              <span className="shrink-0 w-14 font-mono text-slate-500">Step {st.step}</span>
                              <span className="font-medium w-40 shrink-0">{st.name}</span>
                              <span className={`shrink-0 px-1.5 rounded font-bold text-[10px] uppercase ${
                                st.status === 'ok'      ? 'bg-emerald-500/20 text-emerald-400' :
                                st.status === 'warning' ? 'bg-amber-500/20   text-amber-400'   :
                                st.status === 'error'   ? 'bg-red-500/20     text-red-400'     :
                                                          'bg-slate-600/30   text-slate-400'
                              }`}>{st.status}</span>
                              <span className="text-slate-400 flex-1">{st.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                ) : autoWorkflowStatus ? (
                  // Task 6: Show workflow status derived from actual DB data (layouts, engineering_reports, project_files)
                  <div className="divide-y divide-slate-700/30">
                    <div className="px-4 py-2.5 bg-slate-800/30">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Live Status — from DB</span>
                    </div>
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${autoWorkflowStatus.designComplete ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span className="text-xs font-semibold text-slate-300">Layout</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          {autoWorkflowStatus.designComplete ? (
                            <>
                              <span>{autoWorkflowStatus.layoutPanels} panels</span>
                              <span>{autoWorkflowStatus.layoutKw?.toFixed(2)} kW</span>
                              <span className="text-emerald-400">✓ Found in DB</span>
                            </>
                          ) : (
                            <span className="text-red-400">No layout saved</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${autoWorkflowStatus.engineeringComplete ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                          <span className="text-xs font-semibold text-slate-300">Engineering</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          {autoWorkflowStatus.engineeringComplete
                            ? <span className="text-emerald-400">✓ Report in DB</span>
                            : <span className="text-amber-400">No engineering report yet</span>
                          }
                        </div>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${autoWorkflowStatus.filesReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                          <span className="text-xs font-semibold text-slate-300">Artifacts</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          {autoWorkflowStatus.filesReady
                            ? <span className="text-emerald-400">✓ {autoWorkflowStatus.fileCount} file{autoWorkflowStatus.fileCount !== 1 ? 's' : ''} in workspace</span>
                            : <span className="text-amber-400">No artifact files yet</span>
                          }
                        </div>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-4 flex-wrap">
                        {[
                          { key: 'designComplete',      label: 'Design'      },
                          { key: 'engineeringComplete', label: 'Engineering' },
                          { key: 'permitReady',         label: 'Permit'      },
                          { key: 'filesReady',          label: 'Files'       },
                        ].map(w => (
                          <span key={w.key} className={`flex items-center gap-0.5 text-xs ${
                            (autoWorkflowStatus as any)[w.key] ? 'text-emerald-400' : 'text-slate-600'
                          }`}>
                            {(autoWorkflowStatus as any)[w.key]
                              ? <CheckCircle size={10} />
                              : <XCircle size={10} />
                            }
                            {w.label}
                          </span>
                        ))}
                        <span className="text-[10px] text-slate-600 ml-auto">
                          Click Sync Now for full pipeline report
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-6 text-center text-xs text-slate-500">
                    Click <span className="text-amber-400 font-semibold">Sync Now</span> to verify all subsystems
                  </div>
                )}
              </div>
              {/* ── End Pipeline Verification Panel ── */}

              {/* File type legend */}
              <div className="flex flex-wrap gap-2">
                {[
                  { type: 'utility_bill',  label: 'Utility Bill',    color: 'text-amber-400  bg-amber-500/10  border-amber-500/20'  },
                  { type: 'engineering',   label: 'Engineering',     color: 'text-blue-400   bg-blue-500/10   border-blue-500/20'   },
                  { type: 'proposal',      label: 'Proposal',        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
                  { type: 'permit',        label: 'Permit',          color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
                  { type: 'site_photo',    label: 'Site Photo',      color: 'text-sky-400    bg-sky-500/10    border-sky-500/20'    },
                  { type: 'document',      label: 'Document',        color: 'text-slate-400  bg-slate-700/40  border-slate-600/40'  },
                ].map(ft => (
                  <span key={ft.type} className={`text-xs px-2 py-0.5 rounded-full border ${ft.color}`}>
                    {ft.label}
                  </span>
                ))}
              </div>

              {/* Files list */}
              {filesLoading ? (
                <div className="card p-12 text-center">
                  <RefreshCw size={28} className="mx-auto mb-3 text-amber-400 animate-spin" />
                  <div className="text-sm text-slate-400">Loading files…</div>
                </div>
              ) : projectFiles.length === 0 ? (
                <div className="card p-12 text-center">
                  <FolderOpen size={40} className="mx-auto mb-4 text-slate-600" />
                  <div className="text-sm font-bold text-white mb-1">No workspace files yet</div>
                  <div className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                    Files are auto-generated after running calculations. Click below to generate them now, or run a calculation first.
                  </div>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button
                      onClick={async () => {
                        if (!currentProjectId) return;
                        setFilesLoading(true);
                        try {
                          await saveEngineeringOutputs(computedSystem);
                          const res = await fetch(`/api/project-files?projectId=${currentProjectId}`);
                          const d = await res.json();
                          if (d.success) setProjectFiles(d.data || []);
                        } finally {
                          setFilesLoading(false);
                        }
                      }}
                      disabled={filesLoading || !currentProjectId}
                      className="btn-primary btn-sm"
                    >
                      <Zap size={13} />
                      Generate Files Now
                    </button>
                    <button
                      onClick={fetchProjectFiles}
                      disabled={filesLoading}
                      className="btn-secondary btn-sm"
                    >
                      <RefreshCw size={13} className={filesLoading ? 'animate-spin' : ''} />
                      Refresh
                    </button>
                  </div>
                  <p className="text-xs text-amber-400/70 mt-4">
                    Bill Data · System Estimate · Engineering Packet · SLD · BOM
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Workspace folder structure */}
                  {[
                    { label: 'Bill Data',          icon: <File size={13} />,     color: 'text-blue-300',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   match: (f: any) => f.file_type === 'utility_bill' && f.file_name.startsWith('Bill_Data_') },
                    { label: 'System Estimate',     icon: <FileText size={13} />, color: 'text-green-300',  bg: 'bg-green-500/10',  border: 'border-green-500/20',  match: (f: any) => f.file_name.includes('Estimate') },
                    { label: 'Engineering Packet',  icon: <FileBadge size={13}/>, color: 'text-amber-300',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20',  match: (f: any) => f.file_name.includes('Engineering_Packet') || f.file_name.includes('Engineering_Report_') },
                    { label: 'Permit Packet',        icon: <FileBadge size={13}/>, color: 'text-orange-300', bg: 'bg-orange-500/10', border: 'border-orange-500/20', match: (f: any) => f.file_name.includes('Permit_Packet') },
                    { label: 'Single-Line Diagram', icon: <FileBadge size={13}/>, color: 'text-purple-300', bg: 'bg-purple-500/10', border: 'border-purple-500/20', match: (f: any) => f.file_name.includes('SLD') },
                    { label: 'Bill of Materials',   icon: <FileText size={13} />, color: 'text-cyan-300',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20',   match: (f: any) => f.file_name.includes('BOM') },
                    { label: 'Original Utility Bill',icon: <File size={13} />,    color: 'text-slate-300',  bg: 'bg-slate-700/40',  border: 'border-slate-600/40',  match: (f: any) => f.file_type === 'utility_bill' && !f.file_name.startsWith('Bill_Data_') },
                    { label: 'Other Files',         icon: <File size={13} />,     color: 'text-slate-400',  bg: 'bg-slate-700/30',  border: 'border-slate-600/30',  match: (f: any) => f.file_type !== 'utility_bill' && !f.file_name.includes('Estimate') && !f.file_name.includes('Engineering_Packet') && !f.file_name.includes('Engineering_Report_') && !f.file_name.includes('Permit_Packet') && !f.file_name.includes('SLD') && !f.file_name.includes('BOM') },
                  ].map(folder => {
                    const files = projectFiles.filter(folder.match);
                    if (files.length === 0) return null;
                    return (
                      <div key={folder.label} className={`rounded-xl border ${folder.border} overflow-hidden`}>
                        <div className={`flex items-center gap-2 px-4 py-2.5 ${folder.bg} border-b ${folder.border}`}>
                          <FolderOpen size={13} className={folder.color} />
                          <span className={`text-xs font-semibold ${folder.color}`}>{folder.label}</span>
                          <span className="text-xs text-slate-500 ml-auto">{files.length} file{files.length > 1 ? 's' : ''}</span>
                        </div>
                        <div className="divide-y divide-slate-700/30">
                          {files.map((file: any) => {
                            const fileSizeKb = file.file_size ? (file.file_size < 1024 ? `${file.file_size}B` : `${(file.file_size / 1024).toFixed(1)}KB`) : '';
                            const uploadDate = file.upload_date ? new Date(file.upload_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                            // Show "Open in Engineering" for engineering files that have a run attached
                            const hasRun = !!file.engineering_run_id;
                            const isCurrentRun = file.engineering_run_id === restoredRunId;
                            return (
                              <div key={file.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-700/20 transition-colors">
                                <span className={`flex-shrink-0 ${folder.color}`}>{folder.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm text-white truncate block">{file.file_name}</span>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-slate-500">{[fileSizeKb, uploadDate].filter(Boolean).join(' · ')}</span>
                                    {hasRun && (
                                      <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
                                        isCurrentRun
                                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                          : 'bg-amber-500/10 text-amber-400/70 border-amber-500/20'
                                      }`}>
                                        {isCurrentRun ? '✓ Active config' : '⚙ Has config'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {/* Open in Engineering — restore config from this file */}
                                  {hasRun && !isCurrentRun && (
                                    <button
                                      onClick={() => {
                                        const url = `/engineering?projectId=${currentProjectId}&fileId=${file.id}`;
                                        window.location.href = url;
                                      }}
                                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                                      title="Restore engineering configuration from this file"
                                    >
                                      <RefreshCw size={11} />
                                      Restore Config
                                    </button>
                                  )}
                                  {file.file_name === 'permit_planset.html' ? (
                                    // permit_planset.html — force regeneration via the permit button
                                    // instead of downloading the potentially-stale cached copy
                                    <button
                                      onClick={() => {
                                        alert('⚠️ Permit Package\n\nTo get the latest permit package, click "Generate & Download Permit Package (PDF)" on the Permit tab.\n\nDownloading permit_planset.html directly may give you an outdated version.');
                                      }}
                                      className={`p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors`}
                                      title="Use Generate & Download button for latest version"
                                    >
                                      <ExternalLink size={13} />
                                    </button>
                                  ) : (
                                    <a
                                      href={`/api/project-files/download?id=${file.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`p-1.5 rounded-lg ${folder.color} hover:bg-slate-700/60 transition-colors`}
                                      title="View / Download"
                                    >
                                      <ExternalLink size={13} />
                                    </a>
                                  )}
                                  <button
                                    onClick={() => handleFileDelete(file.id)}
                                    className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>{/* end main tab content */}

        {/* ── Engineering Intelligence Panel ── */}
        <div className={`flex-shrink-0 border-l border-slate-700/50 bg-slate-900/70 flex flex-col transition-all duration-200 ${intelligencePanelOpen ? 'w-80' : 'w-10'}`}>
          {/* Panel toggle header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700/50 bg-slate-800/50 flex-shrink-0">
            {intelligencePanelOpen && (
              <div className="flex items-center gap-2">
                <Cpu size={13} className="text-amber-400" />
                <span className="text-xs font-bold text-white">Engineering Intelligence</span>
                <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">V4</span>
              </div>
            )}
            <button
              onClick={() => setIntelligencePanelOpen(p => !p)}
              className="ml-auto text-slate-400 hover:text-white transition-colors p-1 rounded"
              title={intelligencePanelOpen ? 'Collapse panel' : 'Open Engineering Intelligence'}
            >
              {intelligencePanelOpen ? <ChevronRight size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>

          {intelligencePanelOpen && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">

              {/* Topology Badge */}
              <div className={`rounded-xl border px-3 py-2.5 ${topologyColor}`}>
                <div className="text-xs font-black tracking-wide">{topologyLabel}</div>
                <div className="text-xs opacity-70 mt-0.5">
                  {cs.isMicro
                    ? `${cs.microDeviceCount} microinverter${cs.microDeviceCount !== 1 ? 's' : ''} · ${cs.acBranchCount} AC branch${cs.acBranchCount !== 1 ? 'es' : ''} · ${totalPanels} modules · ${totalKw} kW DC`
                    : `${config.inverters.length} inverter${config.inverters.length !== 1 ? 's' : ''} · ${totalPanels} modules · ${totalKw} kW DC`
                  }
                </div>
                {topologySwitching && (
                  <div className="text-xs mt-1 animate-pulse">⚡ Propagating ecosystem…</div>
                )}
              </div>

              {/* System Health */}
              <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-3">
                <div className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                  <Activity size={11} className="text-amber-400" /> System Health
                </div>
                <div className="space-y-1.5">
                  {[
                    { label: 'Electrical', status: compliance.electrical?.status || null },
                    { label: 'Structural', status: compliance.structural?.status || null },
                    { label: 'Jurisdiction', status: compliance.jurisdiction ? 'PASS' : null },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{item.label}</span>
                      <StatusBadge status={item.status as any} size="sm" />
                    </div>
                  ))}
                  {compliance.jurisdiction && (
                    <div className="text-xs text-slate-500 pt-1 border-t border-slate-700/50 mt-1">
                      <MapPin size={9} className="inline mr-1 text-amber-400" />
                      {compliance.jurisdiction.state} · NEC {compliance.jurisdiction.necVersion}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Action Buttons ── */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Zap size={10} className="text-amber-400" /> Engineering Actions
                </div>

                {/* Row 1: Auto Fill */}
                <button
                  onClick={handleAutoFill}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 rounded-lg text-xs font-bold transition-all"
                >
                  <Zap size={12} />
                  <span className="flex-1 text-left">Auto-Fill Fields</span>
                  <span className="text-emerald-600 text-xs font-normal">V4</span>
                </button>

                {/* Row 2: Auto Fix All */}
                <button
                  onClick={handleAutoFixAll}
                  disabled={calculating}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                >
                  <Wrench size={12} />
                  <span className="flex-1 text-left">Auto-Fix All Issues</span>
                  {calculating && <RefreshCw size={10} className="animate-spin" />}
                </button>

                {/* Row 2b: Fix Engine — no solution banner */}
                {fixNoSolution && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <XCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-red-400 mb-0.5">No Valid Configuration</div>
                      <div className="text-xs text-red-300/80 leading-relaxed break-words">{fixNoSolution}</div>
                    </div>
                    <button
                      onClick={() => setFixNoSolution(null)}
                      className="text-red-400/60 hover:text-red-400 transition-colors shrink-0"
                      title="Dismiss"
                    >
                      <XCircle size={11} />
                    </button>
                  </div>
                )}

                {/* Row 3: Explain Logic */}
                <button
                  onClick={handleExplainLogic}
                  disabled={explainLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                >
                  <Info size={12} />
                  <span className="flex-1 text-left">Explain Logic</span>
                  {explainLoading && <RefreshCw size={10} className="animate-spin" />}
                </button>

                {/* Explain Logic result */}
                {explainResult && (
                  <div className="bg-slate-900/60 rounded-lg p-2.5 border border-blue-500/20 max-h-40 overflow-y-auto">
                    {explainResult.split('\n').map((line, i) => (
                      <div key={i} className={`text-xs leading-relaxed ${line.startsWith('**') ? 'font-bold text-blue-300 mt-1' : 'text-slate-400'}`}>
                        {line.replace(/\*\*/g, '')}
                      </div>
                    ))}
                  </div>
                )}

                {/* Row 4: Show Decision Log */}
                <button
                  onClick={() => setShowDecisionLog(p => !p)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-slate-700/60 border border-slate-600/50 text-slate-300 hover:bg-slate-700 rounded-lg text-xs font-bold transition-all"
                >
                  <Book size={12} />
                  <span className="flex-1 text-left">Show Decision Log</span>
                  {decisionLog.length > 0 && (
                    <span className="bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full text-xs">{decisionLog.length}</span>
                  )}
                  {showDecisionLog ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </button>

                {/* Decision Log inline */}
                {showDecisionLog && (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {decisionLog.length === 0 ? (
                      <div className="text-xs text-slate-500 px-2">No decisions logged yet.</div>
                    ) : (
                      decisionLog.map((entry, i) => (
                        <div key={i} className={`text-xs p-2 rounded-lg border ${
                          entry.type === 'auto' ? 'bg-emerald-500/5 border-emerald-500/20' :
                          entry.type === 'manual' ? 'bg-amber-500/5 border-amber-500/20' :
                          'bg-slate-700/40 border-slate-600/40'
                        }`}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className={`font-bold text-xs ${entry.type === 'auto' ? 'text-emerald-400' : entry.type === 'manual' ? 'text-amber-400' : 'text-blue-400'}`}>
                              {entry.action}
                            </span>
                            <span className="text-slate-600 font-mono text-xs">{entry.ts}</span>
                          </div>
                          <div className="text-slate-400 text-xs">{entry.detail}</div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                <div className="border-t border-slate-700/50 pt-1.5 mt-1">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Generate Outputs</div>
                </div>

                {/* Row 5: Generate BOM */}
                <button
                  onClick={fetchBOM}
                  disabled={bomLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-teal-500/10 border border-teal-500/30 text-teal-400 hover:bg-teal-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                >
                  <Grid size={12} className={bomLoading ? 'animate-spin' : ''} />
                  <span className="flex-1 text-left">{bomLoading ? 'Generating BOM…' : 'Generate BOM'}</span>
                  {bom.length > 0 && !bomLoading && <span className="text-teal-600 text-xs">{bom.length} items</span>}
                </button>

                {/* Row 6: Generate SLD */}
                <button
                  onClick={fetchSLD}
                  disabled={sldLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                >
                  <FileText size={12} className={sldLoading ? 'animate-spin' : ''} />
                  <span className="flex-1 text-left">{sldLoading ? 'Rendering SLD…' : 'Generate SLD'}</span>
                  {sldSvg && !sldLoading && <span className="text-purple-600 text-xs">✓</span>}
                </button>

                {/* Row 7: Generate Plan Set (v43.1) */}
                <button
                  onClick={handleGeneratePlanSet}
                  disabled={planSetLoading || calculating || sldLoading || bomLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-amber-500/15 to-orange-500/15 border border-amber-500/40 text-amber-300 hover:from-amber-500/25 hover:to-orange-500/25 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                >
                  <Stamp size={12} className={planSetLoading ? 'animate-spin' : ''} />
                  <span className="flex-1 text-left">{planSetLoading ? 'Generating Plan Set…' : 'Generate Plan Set (v43.1)'}</span>
                </button>
              </div>

              {/* Issues Summary */}
              {(rulesResult || compliance.electrical || compliance.structural) && (
                <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-3">
                  <div className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    <Shield size={11} className="text-amber-400" /> Issues
                  </div>
                  <div className="space-y-1">
                    {(rulesResult?.errorCount > 0 || compliance.electrical?.errors?.length > 0) && (
                      <div className="flex items-center gap-2 text-xs text-red-400">
                        <XCircle size={10} />
                        {(rulesResult?.errorCount || compliance.electrical?.errors?.length || 0)} error{(rulesResult?.errorCount || compliance.electrical?.errors?.length || 0) !== 1 ? 's' : ''}
                      </div>
                    )}
                    {(rulesResult?.warningCount > 0 || compliance.electrical?.warnings?.length > 0) && (
                      <div className="flex items-center gap-2 text-xs text-amber-400">
                        <AlertTriangle size={10} />
                        {(rulesResult?.warningCount || compliance.electrical?.warnings?.length || 0)} warning{(rulesResult?.warningCount || compliance.electrical?.warnings?.length || 0) !== 1 ? 's' : ''}
                      </div>
                    )}
                    {rulesResult?.autoFixCount > 0 && (
                      <div className="flex items-center gap-2 text-xs text-emerald-400">
                        <CheckCircle size={10} />
                        {rulesResult.autoFixCount} auto-fixed
                      </div>
                    )}
                    {!rulesResult?.errorCount && !compliance.electrical?.errors?.length && compliance.overallStatus === 'PASS' && (
                      <div className="flex items-center gap-2 text-xs text-emerald-400">
                        <CheckCircle size={10} /> All checks passing
                      </div>
                    )}
                    {!compliance.overallStatus && (
                      <div className="text-xs text-slate-500">Run compliance check to see issues</div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Engineering Assistant (NEC Query) ── */}
              <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-3">
                <div className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                  <Cpu size={11} className="text-amber-400" /> NEC / Engineering Query
                </div>
                <div className="flex gap-1.5 mb-2">
                  <input
                    type="text"
                    value={aiQuery}
                    onChange={e => setAiQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAiQuery()}
                    placeholder="Ask about NEC, wiring, topology…"
                    className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
                  />
                  <button
                    onClick={handleAiQuery}
                    disabled={aiLoading || !aiQuery.trim()}
                    className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                  >
                    {aiLoading ? <RefreshCw size={11} className="animate-spin" /> : '→'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {['Wire sizing', 'Busbar rule', 'Rapid shutdown', 'Topology'].map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => setAiQuery(prompt)}
                      className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded border border-slate-600 transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                {aiLoading && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <RefreshCw size={11} className="animate-spin text-amber-400" /> Analyzing system…
                  </div>
                )}
                {aiResponse && !aiLoading && (
                  <div className="bg-slate-900/60 rounded-lg p-2.5 text-xs text-slate-300 leading-relaxed border border-slate-700/50 max-h-40 overflow-y-auto">
                    {aiResponse.split('\n').map((line, i) => (
                      <div key={i} className={line.startsWith('**') ? 'font-bold text-amber-400 mb-1' : 'mb-0.5'}>
                        {line.replace(/\*\*/g, '')}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Ecosystem Components ── */}
              {ecosystemComponents.length > 0 && (
                <div className="bg-slate-800/60 rounded-xl border border-emerald-500/20 p-3">
                  <div className="text-xs font-bold text-emerald-400 mb-2 flex items-center gap-1.5">
                    <Package size={11} /> Auto-Resolved Ecosystem ({ecosystemComponents.length})
                  </div>
                  <div className="space-y-1">
                    {ecosystemComponents.slice(0, 6).map((comp: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 truncate flex-1 mr-2">{comp.manufacturer} {comp.model}</span>
                        <span className="text-emerald-400 font-bold flex-shrink-0">×{comp.quantity}</span>
                      </div>
                    ))}
                    {ecosystemComponents.length > 6 && (
                      <div className="text-xs text-slate-500">+{ecosystemComponents.length - 6} more…</div>
                    )}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>{/* end Intelligence Panel */}

        </div>{/* end content + panel row */}
      </div>
      </PlanGate>
    </AppShell>
  );
}

// Wrap with Suspense to satisfy Next.js useSearchParams() requirement
export default function EngineeringPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Loading…</div>}>
      <EngineeringPageInner />
    </React.Suspense>
  );
}