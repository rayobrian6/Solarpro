'use client';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
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
  ChevronUp, Eye, EyeOff, Lock, Stamp, Package, Cpu as CpuIcon
} from 'lucide-react';
import { SOLAR_PANELS, STRING_INVERTERS, MICROINVERTERS, RACKING_SYSTEMS, OPTIMIZERS, BATTERIES, GENERATORS, ATS_UNITS, getBatteryById, getGeneratorById, getATSById, getBackupInterfaceById } from '@/lib/equipment-db';
import { getAllMountingSystems, getMountingSystemsByCategory, getMountingSystemsByRoofType, type MountingSystemSpec, type SystemCategory as MountingCategory } from '@/lib/mounting-hardware-db';

// ── Mounting systems from the canonical mounting-hardware-db (38 systems, 24 manufacturers) ──
const ALL_MOUNTING_SYSTEMS: MountingSystemSpec[] = getAllMountingSystems();
const MOUNTING_BRANDS: string[] = Array.from(new Set(ALL_MOUNTING_SYSTEMS.map(s => s.manufacturer))).sort();
import { BUILD_VERSION, BUILD_DATE, BUILD_FEATURES } from '@/lib/version';
import { getUtilitiesByState } from '@/lib/utility-rules';
import { getUtilitiesByStateNational, STATE_UTILITY_FALLBACK } from '@/lib/utilityDetector';
import { lookupAhj } from '@/lib/jurisdictions/ahj';
import { getAhjsByState } from '@/lib/computed-plan';

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
type InverterType = 'string' | 'micro' | 'optimizer';
type RoofType = 'shingle' | 'tile' | 'metal_standing_seam' | 'metal_corrugated' | 'flat_tpo' | 'flat_epdm' | 'flat_gravel';
type SystemType = 'roof' | 'ground' | 'fence';
type TabId = 'config' | 'compliance' | 'electrical' | 'diagram' | 'schedule' | 'structural' | 'mounting' | 'permit' | 'bom';

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
}

interface ComplianceResult {
  overallStatus: 'PASS' | 'WARNING' | 'FAIL' | null;
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

function newString(idx: number): StringConfig {
  return { id: `str-${Date.now()}-${idx}`, label: `String ${idx + 1}`, panelCount: 10, panelId: 'qcells-peak-duo-400', tilt: 20, azimuth: 180, roofType: 'shingle', mountingSystem: 'ironridge-xr100', wireGauge: '#10 AWG', wireLength: 50 };
}

function newInverter(type: InverterType): InverterConfig {
  // Use correct default inverterId per type — prevents cross-type ID mismatch
  const defaultId = type === 'micro'
    ? (MICROINVERTERS[0]?.id ?? 'enphase-iq8plus')
    : (STRING_INVERTERS[0]?.id ?? 'se-7600h');
  return { id: `inv-${Date.now()}`, inverterId: defaultId, type, strings: [newString(0)] };
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
  const [config, setConfig] = useState<ProjectConfig>(defaultProject);
  const [projectAutoLoaded, setProjectAutoLoaded] = useState(false);
  const [autoLoadBanner, setAutoLoadBanner] = useState<string | null>(null);

  // Auto-load project data when ?projectId= is in the URL
  useEffect(() => {
    const projectId = searchParams?.get('projectId');
    if (!projectId || projectAutoLoaded) return;
    setProjectAutoLoaded(true);

    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success || !data.project) return;
        const p = data.project;
        const layout = p.layout;

        // Build panel count and system size from layout
        const panelCount = layout?.totalPanels || 0;
        const systemKw = layout?.systemSizeKw || 0;

        // Determine inverter type from selected inverter
        const invType = p.selectedInverter?.type === 'micro' ? 'micro'
                      : p.selectedInverter?.type === 'optimizer' ? 'optimizer'
                      : 'string';

        // Build string configs from panel count
        const panelsPerString = invType === 'micro' ? 1 : Math.min(panelCount, 12);
        const stringCount = invType === 'micro' ? panelCount : Math.max(1, Math.ceil(panelCount / panelsPerString));
        const strings = Array.from({ length: stringCount }, (_, i) => ({
          id: `str-auto-${i}`,
          label: `String ${i + 1}`,
          panelCount: i === stringCount - 1 ? panelCount - (panelsPerString * (stringCount - 1)) || panelsPerString : panelsPerString,
          panelId: p.selectedPanel?.id || 'qcells-peak-duo-400',
          tilt: layout?.groundTilt || 20,
          azimuth: layout?.groundAzimuth || 180,
          roofType: 'shingle' as const,
          mountingSystem: p.selectedMounting?.id || 'ironridge-xr100',
          wireGauge: '#10 AWG',
          wireLength: 50,
        }));

        // Parse state from address
        const stateMatch = (p.address || '').match(/,\s*([A-Z]{2})(?:\s+\d{5})?(?:\s*,|\s*$)/);
        const stateCode = p.stateCode || (stateMatch ? stateMatch[1] : '');
        const cityParts = (p.address || '').split(',');
        const city = p.city || (cityParts.length >= 2 ? cityParts[cityParts.length - 2].trim() : '');

        setConfig(prev => ({
          ...prev,
          projectName: p.name || prev.projectName,
          clientName: p.client?.name || prev.clientName,
          address: p.address || prev.address,
          state: stateCode || prev.state,
          city: city || prev.city,
          county: p.county || prev.county || '',
          systemType: p.systemType || prev.systemType,
          inverters: [{
            id: `inv-auto-0`,
            inverterId: p.selectedInverter?.id || prev.inverters[0]?.inverterId || '',
            type: invType,
            strings,
          }],
          batteryId: p.selectedBatteries?.[0]?.id || prev.batteryId,
          batteryCount: p.batteryCount || prev.batteryCount,
          mountingId: p.selectedMounting?.id || prev.mountingId,
          utilityId: p.utilityId || prev.utilityId,
        }));

        setAutoLoadBanner(`Loaded from project: ${p.name}${panelCount ? ` (${panelCount} panels, ${systemKw.toFixed(1)} kW)` : ''}`);
      })
      .catch(err => console.warn('[engineering] auto-load failed:', err));
  }, [searchParams, projectAutoLoaded]);
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
  const [rulesResult, setRulesResult] = useState<any>(null);
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
    const topo = config.inverters[0]?.type === 'micro' ? 'MICRO'
               : config.inverters[0]?.type === 'optimizer' ? 'STRING_OPTIMIZER'
               : 'STRING';
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

    const topology = firstInv?.type ?? 'string';
    const registryMpd: number = invData?.modulesPerDevice ?? 1;
    const modulesPerDevice: number = firstInv?.deviceRatioOverride ?? registryMpd;
    const branchLimit: number = invData?.branchLimit ?? 16;

    const input: ComputedSystemInput = {
      topology,
      totalPanels,
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
      inverterAcKw: invData?.acOutputKw ?? (invData?.acOutputW ? invData.acOutputW / 1000 : topology === 'micro' ? 0.295 : 7.6),
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
      rooftopTempAdderC: 30,
      runLengths: {
        DC_STRING_RUN: firstStr?.wireLength ?? config.wireLength ?? 50,
        ROOF_RUN: firstStr?.wireLength ?? config.wireLength ?? 30,
        BRANCH_RUN: config.wireLength ?? 50,
        INV_TO_DISCO_RUN: 20,
        COMBINER_TO_DISCO_RUN: 20,
        DISCO_TO_METER_RUN: 15,
        METER_TO_MSP_RUN: 10,
        MSP_TO_UTILITY_RUN: 5,
        DC_DISCO_TO_INV_RUN: 10,
      },
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
      return computeSystem({ ...input, totalPanels: Math.max(1, totalPanels) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, totalPanels, compliance.autoDetected]);

  // Shorthand aliases from ComputedSystem
  const cs = computedSystem;

  const updateConfig = (patch: Partial<ProjectConfig>) => setConfig(prev => ({ ...prev, ...patch }));

  const addInverter = (type: InverterType) => {
    if (type === 'micro') {
      // MICRO: replace ALL existing inverters with a single micro entry
      // Collect total panel count from all existing inverters
      setConfig(prev => {
        const totalPanels = prev.inverters.reduce(
          (sum, i) => sum + i.strings.reduce((s, str) => s + str.panelCount, 0), 0
        ) || 20;
        const microId = MICROINVERTERS[0]?.id || 'enphase-iq8plus';
        const inv: InverterConfig = {
          id: `inv-${Date.now()}`,
          inverterId: microId,
          type: 'micro',
          strings: [{ ...newString(0), panelCount: totalPanels }],
        };
        setExpandedInv(inv.id);
        return { ...prev, inverters: [inv] };
      });
    } else {
      const inv = newInverter(type);
      setConfig(prev => ({ ...prev, inverters: [...prev.inverters, inv] }));
      setExpandedInv(inv.id);
    }
  };
  const removeInverter = (id: string) => setConfig(prev => ({ ...prev, inverters: prev.inverters.filter(i => i.id !== id) }));
  const updateInverter = (id: string, patch: Partial<InverterConfig>) =>
    setConfig(prev => ({ ...prev, inverters: prev.inverters.map(i => i.id === id ? { ...i, ...patch } : i) }));
  const addString = (invId: string) =>
    setConfig(prev => ({ ...prev, inverters: prev.inverters.map(i => i.id === invId ? { ...i, strings: [...i.strings, newString(i.strings.length)] } : i) }));
  const removeString = (invId: string, strId: string) =>
    setConfig(prev => ({ ...prev, inverters: prev.inverters.map(i => i.id === invId ? { ...i, strings: i.strings.filter(s => s.id !== strId) } : i) }));
  const updateString = (invId: string, strId: string, patch: Partial<StringConfig>) =>
    setConfig(prev => ({ ...prev, inverters: prev.inverters.map(i => i.id === invId ? { ...i, strings: i.strings.map(s => s.id === strId ? { ...s, ...patch } : s) } : i) }));

  // Topology switch: calls API to propagate ecosystem when inverter type changes
  const handleTopologySwitch = useCallback(async (invId: string, newType: InverterType, newInverterId: string) => {
    // DIAGNOSTIC LOG 1
    const newTopo = newType === 'micro' ? 'MICRO' : newType === 'optimizer' ? 'STRING_OPTIMIZER' : 'STRING';
    console.log('Topology switched:', newTopo, '| inverter:', newInverterId, '| type:', newType);

    // When switching to micro: REPLACE ALL inverters with a single micro entry
    // Collect total panels from ALL inverters — micro is always a single unified system
    if (newType === 'micro') {
      setConfig(prev => {
        const totalPanels = prev.inverters.reduce(
          (sum, i) => sum + i.strings.reduce((s, str) => s + str.panelCount, 0), 0
        ) || 20;
        console.log('Micro topology: collapsing ALL inverters into single entry, totalPanels=', totalPanels);
        const firstStr = prev.inverters[0]?.strings[0] ?? newString(0);
        const singleMicroInv: InverterConfig = {
          id: invId,
          inverterId: newInverterId,
          type: 'micro',
          strings: [{ ...firstStr, panelCount: totalPanels }],
        };
        return { ...prev, inverters: [singleMicroInv] };
      });
    } else {
      // Update local config immediately for string/optimizer
      updateInverter(invId, { type: newType, inverterId: newInverterId });
    }
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
          acOutputKw: (invData?.acOutputW ?? 295) / 1000,
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
    return {
      address: config.address,
      state: config.state || undefined,   // Explicit state code — overrides address parsing in API
      utilityId: config.utilityId || undefined,  // Utility provider ID — used by interconnection engine
      ahjId: config.ahjId || undefined,          // AHJ ID — used by compliance engine
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
          panelLength: 70.9, panelWidth: 41.7, panelWeight: 44,
          panelCount: totalPanels, rackingWeight: 8,
          attachmentSpacing: config.attachmentSpacing,
          railSpan: config.railSpacing,
          rowSpacing: 12, arrayTilt: config.roofPitch,
          systemType: config.systemType,
          mountSpecs,
        };
      })(),
    };
  }, [config, totalPanels]);

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
            electrical: { ...payload.electrical, designTempMin: -10, designTempMax: 40, rooftopTempAdder: 30, necVersion: '2023' },
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
            meanRoofHeight:   15,
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
            panelOrientation: 'portrait',
            rowCount:         config.rowCount ?? undefined,
            // Racking
            mountingSystem:   config.mountingId ?? 'ironridge-xr100',
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

    } catch (e: any) {
      setCalcError(e.message);
    } finally {
      setCalculating(false);
    }
  }, [buildCalcPayload, engineeringMode, overrides, config, totalPanels, updateConfig]);

  // Auto-recalculate 800ms after config changes
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
  const fetchSLD = async () => {
    setSldLoading(true);
    setSldError(null);
    try {
      const firstInv = config.inverters[0];
      const firstStr = firstInv?.strings[0];
      const invData = firstInv ? getInvById(firstInv.inverterId, firstInv.type) as any : null;
      const panelData = firstStr ? getPanelById(firstStr.panelId) as any : null;

      // Determine V4 topology type
      const topoType = firstInv?.type === 'micro' ? 'MICROINVERTER'
        : firstInv?.type === 'optimizer' ? 'STRING_WITH_OPTIMIZER'
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
          setSldSvg(svgText);
        } else {
          const data = await res.json();
          setSldSvg(data.svg || data.data?.svg || null);
          if (!data.svg && !data.data?.svg) setSldError('No SVG returned from SLD engine');
        }
        logDecision('Generate SLD', `Professional SLD rendered — ${topoType} topology`, 'auto');
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        setSldError(err.error || 'Failed to generate SLD');
      }
    } catch (e: any) {
      setSldError(e.message);
    } finally {
      setSldLoading(false);
    }
  };

  // ── V4 BOM fetch (uses /api/engineering/bom — registry-driven engine) ─────────
  const fetchBOM = useCallback(async () => {
    setBomLoading(true);
    setBomError(null);
    try {
      const firstInv = config.inverters[0];
      const firstStr = firstInv?.strings[0];

      // Determine V4 topology type
      const topoType = firstInv?.type === 'micro' ? 'MICROINVERTER'
        : firstInv?.type === 'optimizer' ? 'STRING_WITH_OPTIMIZER'
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
        // Legacy ID mappings (old IDs → new IDs)
        'rooftech-rt-mini':   'rooftech-mini',
        'unirac-sunframe':    'unirac-solarmount',
        'unirac-rm-ballast':  'unirac-rm10-evo',
        'snapnrack-series-100': 'snapnrack-100',
        'quickmount-tile-hook': 'quickmount-tile',
        's5-pvkit-2':         's5-pvkit',
        'ecofasten-rock-it':  'ecofasten-rockit',
        'plp-power-peak':     'ironridge-xr100',
        // Current IDs pass through (all 42 systems in mounting-hardware-db)
        ...Object.fromEntries(ALL_MOUNTING_SYSTEMS.map(s => [s.id, s.id])),
      };
      const rackingId = rackingIdMap[config.mountingId] || config.mountingId || 'ironridge-xr100';

      const res = await fetch('/api/engineering/bom', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // REGRESSION FIX: for micro topology, ensure we send a valid micro inverterId
          // firstInv.inverterId may be stale (e.g. 'se-7600h') if topology switch didn't update it
          inverterId: firstInv?.type === 'micro'
            ? (MICROINVERTERS.find(m => m.id === firstInv.inverterId)?.id ?? MICROINVERTERS[0]?.id ?? 'enphase-iq8plus')
            : (firstInv?.inverterId || 'fronius-primo-8.2'),
          optimizerId:      firstInv?.type === 'optimizer' ? firstInv.inverterId : undefined,
          rackingId,
          batteryId:        config.batteryId || undefined,
          panelId:          firstStr?.panelId || 'qcells-peak-duo-400',
          moduleCount:      totalPanels,
          deviceCount:      bomDeviceCount,   // micro qty = deviceCount not moduleCount
          stringCount:      firstInv?.type === 'micro' ? 0 : config.inverters.reduce((s, inv) => s + inv.strings.length, 0),
          inverterCount:    firstInv?.type === 'micro' ? 1 : config.inverters.length,  // micro = 1 system
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
          roofType:         config.roofType,
          attachmentCount:  Math.ceil(totalPanels / 2),
          railSections:     Math.ceil(totalPanels / 4),
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
        }),
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
        logDecision('Generate BOM', `${items.length} line items across ${stages.length} stages`, 'auto');

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
    } catch (e: any) {
      setBomError(e.message);
    } finally {
      setBomLoading(false);
    }
  }, [config, totalPanels, totalKw, compliance]);

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
          inverterCount: config.inverters.length,
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

  // ── V4 Auto-Fix All: calls structural API + electrical fixes ─────────────────
  const handleAutoFixAll = async () => {
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
          inverterCount: config.inverters.length,
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
    } catch (e: any) {
      setExplainResult(`Error: ${e.message}`);
    } finally {
      setExplainLoading(false);
    }
  };

  // ── Generate Full Permit Package ──────────────────────────────────────────────
  const [permitLoading, setPermitLoading] = useState(false);

  const handleGeneratePermitPackage = async () => {
    setPermitLoading(true);
    logDecision('Permit Package', 'Generating full permit package (SLD + BOM + Structural + Cover Sheet)', 'auto');
    try {
      // Run all three in parallel
      await Promise.all([
        fetchSLD(),
        fetchBOM(),
        runCalc(),
      ]);
      setActiveTab('permit');
      logDecision('Permit Package', 'Complete — navigate to Permit Package tab', 'auto');
    } catch (e: any) {
      logDecision('Permit Package', `Error: ${e.message}`, 'manual');
    } finally {
      setPermitLoading(false);
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

  // Per-tab feature gating
  const { can } = useSubscription();
  const canSLD    = can('engineering');      // Professional+
  const canPermit = can('permitPackets');    // Professional+
  const canBOM    = can('bom');              // Professional+

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
  ];

  const ComplianceSummaryBar = () => (
    <div className="flex items-center gap-3 px-6 py-2.5 bg-slate-800/60 border-b border-slate-700/50 flex-shrink-0 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Overall:</span>
        <StatusBadge status={rulesResult?.overallStatus || compliance.overallStatus} />
      </div>
      <div className="w-px h-4 bg-slate-700" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Electrical:</span>
        <StatusBadge status={compliance.electrical?.status || null} size="sm" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Structural:</span>
        <StatusBadge status={compliance.structural?.status || null} size="sm" />
      </div>
      {rulesResult && (
        <>
          <div className="w-px h-4 bg-slate-700" />
          <div className="flex items-center gap-2 text-xs">
            {rulesResult.errorCount > 0 && <span className="text-red-400 font-bold">{rulesResult.errorCount} error{rulesResult.errorCount !== 1 ? 's' : ''}</span>}
            {rulesResult.warningCount > 0 && <span className="text-amber-400 font-bold">{rulesResult.warningCount} warning{rulesResult.warningCount !== 1 ? 's' : ''}</span>}
            {rulesResult.autoFixCount > 0 && <span className="text-emerald-400">{rulesResult.autoFixCount} auto-fixed</span>}
            {overrides.length > 0 && <span className="text-blue-400">{overrides.length} override{overrides.length !== 1 ? 's' : ''}</span>}
          </div>
        </>
      )}
      {compliance.jurisdiction && (
        <>
          <div className="w-px h-4 bg-slate-700" />
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin size={11} className="text-amber-400" />
            {compliance.jurisdiction.state} · NEC {compliance.jurisdiction.necVersion}
          </div>
        </>
      )}
      {configDirty && !calculating && (
        <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-400/70">
          <AlertCircle size={11} /> Config changed
        </div>
      )}
      {calculating ? (
        <div className={`${configDirty ? '' : 'ml-auto'} flex items-center gap-1.5 text-xs text-slate-500`}>
          <RefreshCw size={11} className="animate-spin" /> Calculating...
        </div>
      ) : (
        <button onClick={runCalc} className={`${configDirty ? '' : 'ml-auto'} flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors`}>
          <RefreshCw size={11} /> Recalculate
        </button>
      )}
    </div>
  );

  return (
    <AppShell>
      <PlanGate feature="engineering">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 bg-slate-900/50 flex-shrink-0">
          <div>
            <h1 className="text-xl font-black text-white flex items-center gap-2">
              <Zap size={20} className="text-amber-400" /> Engineering Schematics
              <span className="text-xs font-normal bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full ml-1">V3 · Permit-Grade</span>
              <span className="text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full ml-1">
                BUILD {BUILD_VERSION}
              </span>
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">
              {config.projectName} · {totalPanels} panels · {totalKw} kW DC · {totalInverterKw} kW AC
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {/* AUTO / MANUAL mode toggle */}
            <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-0.5">
              <button
                onClick={() => setEngineeringMode('AUTO')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${engineeringMode === 'AUTO' ? 'bg-emerald-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                AUTO
              </button>
              <button
                onClick={() => setEngineeringMode('MANUAL')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${engineeringMode === 'MANUAL' ? 'bg-amber-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                MANUAL
              </button>
            </div>
            <div className="text-xs text-slate-500 hidden md:block">
              {engineeringMode === 'AUTO' ? '⚡ Auto-resolves violations' : '✏️ Manual override mode'}
            </div>
            <button onClick={runCalc} disabled={calculating} className="btn-secondary btn-sm">
              <RefreshCw size={14} className={calculating ? 'animate-spin' : ''} />
              {calculating ? 'Calculating...' : 'Run Compliance Check'}
            </button>
            <button onClick={handlePrint} className="btn-secondary btn-sm">
              <Printer size={14} /> Print / PDF
            </button>
          </div>
        </div>

        <ComplianceSummaryBar />

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-slate-700/50 flex-shrink-0 overflow-x-auto">
          {tabs.map(tab => {
            const isLocked =
              (tab.id === 'diagram' && !canSLD) ||
              (tab.id === 'permit'  && !canPermit) ||
              (tab.id === 'bom'     && !canBOM);
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                  activeTab === tab.id ? 'text-amber-400 border-amber-400 bg-amber-500/5' : 'text-slate-400 border-transparent hover:text-white'
                } ${isLocked ? 'opacity-60' : ''}`}>
                {tab.icon} {tab.label}
                {isLocked && <Lock size={10} className="text-slate-500 ml-0.5" />}
                {tab.id === 'compliance' && (rulesResult?.overallStatus || compliance.overallStatus) === 'FAIL' && <span className="w-2 h-2 rounded-full bg-red-500 ml-0.5" />}
                {tab.id === 'compliance' && (rulesResult?.overallStatus || compliance.overallStatus) === 'WARNING' && <span className="w-2 h-2 rounded-full bg-amber-500 ml-0.5" />}
                {tab.id === 'compliance' && configDirty && !calculating && <span className="w-2 h-2 rounded-full bg-amber-400/50 ml-0.5 animate-pulse" />}
              </button>
            );
          })}
        </div>

        {/* Content + Intelligence Panel */}
        <div className="flex flex-1 overflow-hidden">

        {/* Main Tab Content */}
        <div className="flex-1 overflow-y-auto p-6" ref={printRef}>

          {/* ── CONFIG TAB ── */}
          {activeTab === 'config' && (
            <div className="space-y-6 max-w-5xl">
              {/* Project Info */}
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><FileText size={14} className="text-amber-400" /> Project Information</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {([
                    { label: 'Project Name', key: 'projectName' },
                    { label: 'Client Name', key: 'clientName' },
                    { label: 'Address', key: 'address', placeholder: 'e.g. 123 Main St, Austin, TX 78701' },
                    { label: 'Designer', key: 'designer' },
                    { label: 'Date', key: 'date', type: 'date' },
                  ] as any[]).map(f => (
                    <div key={f.key}>
                      <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
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
                            // Auto-select first utility for detected state
                            const utils = getUtilitiesByStateNational(detectedState);
                            if (utils.length > 0 && !config.utilityId) {
                              updates.utilityId = utils[0].id;
                            }
                            updateConfig(updates);
                          }
                        } : undefined}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                    </div>
                  ))}
                  {/* State / Jurisdiction Selector — fixes Utility/AHJ "Unknown" issue */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block flex items-center gap-2">
                      State / Jurisdiction
                      {config.state && config.address && parseStateFromAddress(config.address) === config.state && (
                        <span className="text-emerald-400 text-xs font-normal">✓ auto-detected</span>
                      )}
                    </label>
                    <select value={config.state} onChange={e => {
                      const newState = e.target.value;
                      const updates: any = { state: newState, utilityId: '' };
                      // Auto-select first utility when state changes
                      const utils = getUtilitiesByStateNational(newState);
                      if (utils.length > 0) updates.utilityId = utils[0].id;
                      updateConfig(updates);
                    }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
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
                  {/* City + County for AHJ override */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">City</label>
                      <input
                        type="text"
                        value={config.city || ''}
                        onChange={e => updateConfig({ city: e.target.value })}
                        placeholder="e.g. Austin"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">County</label>
                      <input
                        type="text"
                        value={config.county || ''}
                        onChange={e => updateConfig({ county: e.target.value })}
                        placeholder="e.g. Travis"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                      />
                    </div>
                  </div>

                  {/* AHJ Auto-Detected Info */}
                  {ahjInfo && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin size={12} className="text-amber-400" />
                        <span className="text-xs font-bold text-amber-400">{ahjInfo.ahjName}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">{ahjInfo.necVersion}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-slate-500">Permit Fee:</span>
                          <span className="text-slate-300 ml-1">{ahjInfo.typicalPermitFee}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Permit Days:</span>
                          <span className="text-slate-300 ml-1">{ahjInfo.typicalPermitDays}d</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Rapid Shutdown:</span>
                          <span className={`ml-1 ${ahjInfo.rapidShutdownRequired ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {ahjInfo.rapidShutdownRequired ? 'Required' : 'Not Required'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Roof Setback:</span>
                          <span className="text-slate-300 ml-1">{ahjInfo.roofSetbackInches}"</span>
                        </div>
                      </div>
                      {ahjInfo.localAmendments?.length > 0 && (
                        <div className="mt-2 text-xs text-slate-400">
                          <span className="font-semibold text-slate-300">Local Amendments: </span>
                          {ahjInfo.localAmendments.slice(0, 2).join(' · ')}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Utility Selector — national data from utilityDetector.ts (all 50 states) */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Utility Provider</label>
                    <select
                      value={config.utilityId}
                      onChange={e => updateConfig({ utilityId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                    >
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
                        <div className="text-xs text-slate-400 mt-1.5 space-y-0.5">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500">Avg Rate:</span>
                            <span className="text-amber-400 font-medium">${stateData.avgRate.toFixed(3)}/kWh</span>
                            <span className="text-slate-500">Net Metering:</span>
                            <span className={stateData.netMetering ? 'text-emerald-400' : 'text-red-400'}>
                              {stateData.netMetering ? '✓ Eligible' : '✗ Not Available'}
                            </span>
                          </div>
                          <div className="text-slate-500 text-xs">{stateData.netMeteringPolicy}</div>
                          <div className="text-slate-500 text-xs">Max system: {stateData.interconnectionMaxKw} kW · Export rate: ${stateData.exportRate.toFixed(3)}/kWh</div>
                        </div>
                      );
                    })()}
                  </div>
                  {/* AHJ Selector — filtered by state, persisted to project */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Authority Having Jurisdiction (AHJ)</label>
                    <select
                      value={config.ahjId}
                      onChange={e => updateConfig({ ahjId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                    >
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
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Roof Type</label>
                    <select value={config.roofType} onChange={e => updateConfig({ roofType: e.target.value as RoofType })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {Object.entries(ROOF_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                </div>
                {compliance.jurisdiction && (
                  <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-start gap-3">
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

              {/* Electrical Service */}
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Zap size={14} className="text-amber-400" /> Electrical Service</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Main Panel (Amps)</label>
                    <select value={config.mainPanelAmps} onChange={e => updateConfig({ mainPanelAmps: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {[100, 150, 200, 225, 320, 400].map(a => <option key={a} value={a}>{a}A</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Panel Brand</label>
                    <select value={config.mainPanelBrand} onChange={e => updateConfig({ mainPanelBrand: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {['Square D', 'Eaton', 'Siemens', 'Leviton', 'GE', 'Cutler-Hammer', 'Murray'].map(b => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block flex items-center gap-1">
                      AC Wire Gauge
                      <span className="text-amber-400 text-xs font-bold ml-1" title="Auto-calculated per NEC 310.16 — not user-editable">⚡ Auto</span>
                    </label>
                    <div className="w-full bg-slate-800/50 border border-amber-500/30 rounded-lg px-3 py-2 text-sm text-amber-300 font-mono cursor-not-allowed"
                      title="Auto-calculated from ComputedSystem (NEC 310.16 / NEC 690.8). Not user-editable.">
                      {(() => {
                        const acRun = cs.runs.find(r => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
                        // For micro: ALWAYS use cs.runs — never fall back to config.wireGauge
                        // For string: cs.runs → compliance → config fallback
                        const gauge = acRun?.wireGauge
                          || (cs.isMicro ? '#6 AWG' : ((compliance.electrical as any)?.acSizing?.conductorGauge || config.wireGauge));
                        return `${gauge} THWN-2`;
                      })()}
                      <span className="text-slate-500 text-xs ml-2 font-sans">NEC 310.16</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">Auto-sized by ComputedSystem engine — updates with config changes</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Conduit Type</label>
                    <select value={config.conduitType} onChange={e => updateConfig({ conduitType: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {['EMT', 'PVC Schedule 40', 'PVC Schedule 80', 'Rigid Metal (RMC)', 'Flexible Metal (FMC)'].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">AC Wire Run (ft)</label>
                    <input type="number" min={1} value={config.wireLength} onChange={e => updateConfig({ wireLength: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  {([
                    { key: 'acDisconnect', label: 'AC Disconnect (NEC 690.14)' },
                    // DC Disconnect: not applicable for microinverter systems (no DC strings)
                    ...(config.inverters[0]?.type !== 'micro' ? [{ key: 'dcDisconnect', label: 'DC Disconnect (NEC 690.15)' }] : []),
                    { key: 'productionMeter', label: 'Production Meter' },
                    { key: 'rapidShutdown', label: 'Rapid Shutdown (NEC 690.12)' },
                  ] as any[]).map(item => (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer" onClick={() => updateConfig({ [item.key]: !(config as any)[item.key] } as any)}>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${(config as any)[item.key] ? 'bg-amber-500 border-amber-500' : 'border-slate-600'}`}>
                        {(config as any)[item.key] && <CheckCircle size={12} className="text-slate-900" />}
                      </div>
                      <span className="text-sm text-slate-300">{item.label}</span>
                    </label>
                  ))}
                  {config.inverters[0]?.type === 'micro' && (
                    <div className="flex items-center gap-2 opacity-40 cursor-not-allowed" title="DC Disconnect not required for microinverter systems — DC→AC at each panel">
                      <div className="w-5 h-5 rounded border-2 border-slate-700 flex items-center justify-center bg-slate-800">
                        <span className="text-slate-600 text-xs">—</span>
                      </div>
                      <span className="text-sm text-slate-500 line-through">DC Disconnect</span>
                      <span className="text-xs text-purple-400">(N/A — micro)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Battery Storage */}
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <Shield size={14} className="text-amber-400" /> Battery Storage (Optional)
                  <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">+5 New Models</span>
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Battery Model</label>
                    <select value={config.batteryId} onChange={e => {
                      const bat = getBatteryById(e.target.value);
                      updateConfig({
                        batteryId: e.target.value,
                        batteryBrand: bat?.manufacturer ?? '',
                        batteryModel: bat?.model ?? '',
                        batteryKwh: bat?.usableCapacityKwh ?? 0,
                      });
                    }} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      <option value="">None</option>
                      {BATTERIES.map(b => (
                        <option key={b.id} value={b.id}>{b.isNew ? '🆕 ' : ''}{b.manufacturer} {b.model} ({b.usableCapacityKwh} kWh){b.subcategory === 'ac_coupled' ? ` · AC-coupled` : ` · DC-coupled`}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Units</label>
                    <input type="number" min={0} max={10} value={config.batteryCount} onChange={e => updateConfig({ batteryCount: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Capacity per Unit (kWh)</label>
                    <input type="number" min={0} step={0.1} value={config.batteryKwh} onChange={e => updateConfig({ batteryKwh: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                  </div>
                  <div className="flex items-end flex-col gap-1">
                    <div className="bg-slate-700/50 rounded-lg px-3 py-2 text-sm text-amber-400 font-bold w-full text-center">
                      Total: {(config.batteryCount * config.batteryKwh).toFixed(1)} kWh
                    </div>
                    {config.batteryId && (() => {
                      const bat = getBatteryById(config.batteryId);
                      return bat?.backfeedBreakerA ? (
                        <div className="text-xs text-orange-400 text-center w-full">
                          +{bat.backfeedBreakerA}A bus load (NEC 705.12B)
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
                {/* Generator & ATS */}
                <div className="mt-4 mb-2 flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Generator &amp; Transfer Switch</span>
                  <span className="px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">+4 New Models</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Generator</label>
                    <select value={config.generatorId} onChange={e => updateConfig({ generatorId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      <option value="">None</option>
                      {GENERATORS.map(g => (
                        <option key={g.id} value={g.id}>{g.isNew ? '🆕 ' : ''}{g.manufacturer} {g.model} ({g.ratedOutputKw} kW · {g.fuelType.replace('_', ' ')})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Transfer Switch (ATS)</label>
                    <select value={config.atsId} onChange={e => updateConfig({ atsId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      <option value="">None</option>
                      {ATS_UNITS.map(a => (
                        <option key={a.id} value={a.id}>{a.isNew ? '🆕 ' : ''}{a.manufacturer} {a.model} ({a.ampRating}A · {a.transferType}{a.serviceEntranceRated ? ' · SE-rated' : ''})</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    {config.generatorId && config.atsId && (() => {
                      const gen = getGeneratorById(config.generatorId);
                      const ats = getATSById(config.atsId);
                      return (
                        <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-lg px-3 py-2 text-xs text-emerald-400 w-full">
                          ✓ {gen?.ratedOutputKw}kW gen + {ats?.ampRating}A ATS
                          {ats?.neutralSwitched ? ' · Neutral switched ✓' : ' · ⚠ Check neutral bonding'}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {/* Generator Wire Length — only shown when generator is selected */}
                {config.generatorId && (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block flex items-center gap-1">
                        <span>Generator → ATS Wire Length</span>
                        <span className="text-slate-500">(ft)</span>
                      </label>
                      <input
                        type="number" min={5} max={500} step={5}
                        value={config.generatorWireLength ?? 50}
                        onChange={e => updateConfig({ generatorWireLength: Math.max(5, +e.target.value) })}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Distance from generator to ATS. ATS is placed close to meter/MSP.
                      </p>
                    </div>
                    <div className="flex items-end">
                      {config.generatorWireLength && (() => {
                        const genRun = cs.runs?.find((r: any) => r.id === 'GENERATOR_TO_ATS_RUN');
                        if (!genRun) return null;
                        return (
                          <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 w-full">
                            <div className="font-bold text-amber-400">{genRun.wireGauge}</div>
                            <div className="text-slate-400">{genRun.conduitSize} {genRun.conduitType} conduit</div>
                            <div className="text-slate-500">{config.generatorWireLength}ft run · {genRun.ocpdAmps}A OCPD</div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Inverters & Strings */}
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Zap size={14} className="text-amber-400" /> Inverters &amp; Strings
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">+14 New Models</span>
                  </h3>
                  <div className="flex gap-2">
                    {(['string', 'micro', 'optimizer'] as InverterType[]).map(t => {
                      // ISSUE 3 FIX: hide "Add Microinverter" when a micro inverter already exists
                      // Micro topology = single inverter entry only — no multi-group
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
                <div className="space-y-3">
                  {config.inverters.map((inv, invIdx) => {
                    const invData = getInvById(inv.inverterId, inv.type) as any;
                    const invList = inv.type === 'micro' ? MICROINVERTERS : STRING_INVERTERS;
                    return (
                      <div key={inv.id} className="border border-slate-700/50 rounded-xl overflow-hidden">
                        <div className="flex items-center gap-3 p-4 bg-slate-800/40 cursor-pointer hover:bg-slate-800/60 transition-colors"
                          onClick={() => setExpandedInv(expandedInv === inv.id ? null : inv.id)}>
                          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-xs flex-shrink-0">{invIdx + 1}</div>
                          <div className="flex-1">
                            <div className="text-sm font-bold text-white">{invData?.manufacturer} {invData?.model}</div>
                            <div className="text-xs text-slate-400">
                              {inv.type === 'micro' ? 'Microinverter' : 'String Inverter'} ·
                              {inv.strings.reduce((s, str) => s + str.panelCount, 0)} panels ·
                              {(inv.strings.reduce((s, str) => s + str.panelCount * (getPanelById(str.panelId)?.watts || 400), 0) / 1000).toFixed(2)} kW DC
                              {inv.type === 'string' && (
                                // String summary: reads from ComputedSystem (NEC 690.7)
                                <span className="ml-1 text-amber-400 font-semibold">
                                  · {cs.stringCount} string{cs.stringCount > 1 ? 's' : ''} ({cs.panelsPerString}/str recommended)
                                </span>
                              )}
                              {inv.type === 'micro' && (
                                // Micro summary: reads from ComputedSystem
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
                            {/* Topology Type Selector */}
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Topology</span>
                              {topologySwitching && <span className="text-xs text-amber-400 animate-pulse">Propagating ecosystem…</span>}
                            </div>
                            <div className="flex gap-2 mb-3">
                              {([
                                { type: 'string' as InverterType, label: 'String', desc: 'String inverter, no optimizers' },
                                { type: 'optimizer' as InverterType, label: 'Optimizer', desc: 'String + per-module optimizers' },
                                { type: 'micro' as InverterType, label: 'Micro', desc: 'Microinverter per module' },
                              ]).map(({ type: t, label, desc }) => (
                                <button
                                  key={t}
                                  onClick={() => {
                                    if (inv.type !== t) {
                                      const defaultId = t === 'micro'
                                        ? (MICROINVERTERS[0]?.id || inv.inverterId)
                                        : (STRING_INVERTERS[0]?.id || inv.inverterId);
                                      handleTopologySwitch(inv.id, t, defaultId);
                                    }
                                  }}
                                  title={desc}
                                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold border transition-all ${
                                    inv.type === t
                                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-amber-500/40 hover:text-slate-200'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <div className="md:col-span-2">
                                <label className="text-xs text-slate-400 mb-1 block">Inverter Model</label>
                                <select value={inv.inverterId} onChange={e => updateInverter(inv.id, { inverterId: e.target.value })}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                  {invList.map(i => <option key={i.id} value={i.id}>{(i as any).isNew ? '🆕 ' : ''}{i.manufacturer} {i.model}{inv.type === 'string' ? ` (${(i as any).acOutputKw}kW)` : ` (${(i as any).acOutputW}W)`}</option>)}
                                </select>
                              </div>
                              {invData && (
                                <div className="bg-slate-800/60 rounded-lg p-2 text-xs space-y-0.5">
                                  <div className="text-slate-400">Max DC: <span className="text-white">{invData.maxDcVoltage}V</span></div>
                                  <div className="text-slate-400">MPPT: <span className="text-white">{invData.mpptVoltageMin}–{invData.mpptVoltageMax}V</span></div>
                                  <div className="text-slate-400">Eff: <span className="text-white">{invData.efficiency}%</span></div>
                                  {(() => {
                                    // String Sizing (NEC 690.7) — NOT applicable for microinverters
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
                                        <div className="text-slate-400">Max panels/string: <span className="text-white font-bold">{maxPPS}</span></div>
                                        <div className="text-slate-400">Min panels/string: <span className="text-white font-bold">{minPPS}</span></div>
                                        <div className="text-slate-400">Recommended: <span className="text-amber-400 font-bold">{clampedRec}</span></div>
                                        <div className="text-slate-400">Voc corrected: <span className="text-white">{vocCorr.toFixed(2)}V</span></div>
                                        {(() => {
                                          // Auto-string: calculate optimal string count from total panels
                                          const totalPanelsForInv = inv.strings.reduce((s, str) => s + str.panelCount, 0);
                                          const autoStrings = Math.max(1, Math.round(totalPanelsForInv / clampedRec));
                                          const autoPerStr = Math.ceil(totalPanelsForInv / autoStrings);
                                          const autoLastStr = totalPanelsForInv - (autoStrings - 1) * autoPerStr;
                                          return (
                                            <div className="mt-1.5 pt-1 border-t border-slate-700/30">
                                              <div className="text-slate-400 mb-1">
                                                Auto: <span className="text-amber-300 font-bold">{autoStrings} string{autoStrings > 1 ? 's' : ''} × {autoPerStr} panels</span>
                                                {autoLastStr !== autoPerStr && autoStrings > 1 && <span className="text-slate-500"> (last: {autoLastStr})</span>}
                                              </div>
                                              <button
                                                onClick={() => {
                                                  // Apply auto-calculated string config
                                                  const newStrings = Array.from({ length: autoStrings }, (_, i) => ({
                                                    ...newString(i),
                                                    panelCount: i === autoStrings - 1 ? autoLastStr : autoPerStr,
                                                    panelId: inv.strings[0]?.panelId ?? 'qcells-peak-duo-400',
                                                    wireGauge: inv.strings[0]?.wireGauge ?? '#10 AWG',
                                                    wireLength: inv.strings[0]?.wireLength ?? 50,
                                                  }));
                                                  updateInverter(inv.id, { strings: newStrings } as any);
                                                  logDecision('Auto-String Applied', `${autoStrings} strings × ${autoPerStr} panels (NEC 690.7 @ ${designTemp}°C)`, 'auto');
                                                }}
                                                className="w-full mt-1 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded text-xs text-green-300 hover:bg-green-500/30 transition-colors font-semibold"
                                              >
                                                ⚡ Auto-Apply: {autoStrings} string{autoStrings > 1 ? 's' : ''} × {autoPerStr} panels
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
                            {/* Device Ratio Override — compact dropdown below inverter model */}
                            <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2 mt-1">
                              {inv.type === 'micro' && (() => {
                                const regMpd = (getInvById(inv.inverterId, 'micro') as any)?.modulesPerDevice ?? 1;
                                return (
                                  <div className="flex items-center gap-3">
                                    <div className="flex-1">
                                      <label className="text-xs text-slate-400 mb-1 block">Modules per microinverter</label>
                                      <select
                                        value={inv.deviceRatioOverride ?? regMpd}
                                        onChange={e => updateInverter(inv.id, { deviceRatioOverride: +e.target.value })}
                                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60"
                                      >
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
                                    <label className="text-xs text-slate-400 mb-1 block">Optimizers per module</label>
                                    <select
                                      value={inv.deviceRatioOverride ?? 1}
                                      onChange={e => updateInverter(inv.id, { deviceRatioOverride: +e.target.value })}
                                      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60"
                                    >
                                      {[1, 2].map(n => (
                                        <option key={n} value={n}>{n} optimizer{n > 1 ? 's' : ''} per module{n === 1 ? ' (default)' : ''}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="text-xs text-slate-500 italic pt-4">Changing this will recalculate engineering values.</div>
                                </div>
                              )}
                              {inv.type === 'string' && (
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-xs text-slate-400 mb-1 block">Modules per string</label>
                                    <select
                                      value={inv.modulesPerString ?? inv.strings[0]?.panelCount ?? 10}
                                      onChange={e => updateInverter(inv.id, { modulesPerString: +e.target.value })}
                                      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60"
                                    >
                                      {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(n => (
                                        <option key={n} value={n}>{n} modules</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs text-slate-400 mb-1 block">Strings per inverter</label>
                                    <select
                                      value={inv.stringsPerInverter ?? inv.strings.length}
                                      onChange={e => updateInverter(inv.id, { stringsPerInverter: +e.target.value })}
                                      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60"
                                    >
                                      {[1,2,3,4,5,6].map(n => (
                                        <option key={n} value={n}>{n} string{n > 1 ? 's' : ''}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="col-span-2 text-xs text-slate-500 italic">Changing this will recalculate engineering values.</div>
                                </div>
                              )}
                            </div>

                            {/* MICRO topology: show simple panel count only — NO DC string UI */}
                            {inv.type === 'micro' ? (
                              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                                <div className="text-xs font-bold text-purple-300 mb-2 uppercase tracking-wide">Microinverter Array</div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-xs text-slate-400 mb-1 block">Total Panel Count</label>
                                    <input
                                      type="number" min={1} max={200}
                                      value={inv.strings[0]?.panelCount ?? 10}
                                      onChange={e => updateString(inv.id, inv.strings[0]?.id ?? '', { panelCount: +e.target.value })}
                                      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-slate-400 mb-1 block">Panel Model</label>
                                    <select
                                      value={inv.strings[0]?.panelId ?? 'qcells-peak-duo-400'}
                                      onChange={e => updateString(inv.id, inv.strings[0]?.id ?? '', { panelId: e.target.value })}
                                      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
                                    >
                                      {SOLAR_PANELS.map(p => <option key={p.id} value={p.id}>{p.manufacturer} {p.model}</option>)}
                                    </select>
                                  </div>
                                </div>
                                {(() => {
                                  const microInvData = getInvById(inv.inverterId, 'micro') as any;
                                  const mpd = microInvData?.modulesPerDevice ?? 1;
                                  const panels = inv.strings[0]?.panelCount ?? 10;
                                  const devices = Math.ceil(panels / mpd);
                                  console.log('Micro UI: modulesPerDevice =', mpd, '| panels =', panels, '| deviceCount =', devices);
                                  return (
                                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                                      <span>Modules/device: <span className="text-purple-300 font-bold">{mpd}</span></span>
                                      <span>Device count: <span className="text-purple-300 font-bold">{devices}</span></span>
                                      <span className="text-purple-400/60 italic">No DC strings · No Voc/Isc · AC output only</span>
                                    </div>
                                  );
                                })()}
                              </div>
                            ) : (
                              /* STRING / OPTIMIZER topology: full DC string UI */
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
                                        {/* MANUAL mode: OCPD override */}
                                        {engineeringMode === 'MANUAL' && (
                                          <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                            <div className="flex items-center gap-2 mb-1">
                                              <Lock size={10} className="text-amber-400" />
                                              <span className="text-xs font-bold text-amber-400">MANUAL OCPD Override</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <input
                                                type="number"
                                                min={1}
                                                max={100}
                                                placeholder="Auto"
                                                value={str.ocpdOverride ?? ''}
                                                onChange={e => updateString(inv.id, str.id, {
                                                  ocpdOverride: e.target.value ? +e.target.value : undefined,
                                                  ocpdOverrideAcknowledged: false,
                                                })}
                                                className="w-20 bg-slate-700 border border-amber-500/40 rounded px-2 py-1 text-xs text-white focus:outline-none"
                                              />
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
                          {comp.partNumber && (
                            <div className="text-xs text-emerald-400/70 font-mono">{comp.partNumber}</div>
                          )}
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

              {/* Notes */}
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Info size={14} className="text-amber-400" /> Engineering Notes</h3>
                <textarea value={config.notes} onChange={e => updateConfig({ notes: e.target.value })} rows={4}
                  placeholder="Add engineering notes, special conditions, AHJ requirements, utility interconnection notes..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 resize-none" />
              </div>
            </div>
          )}

          {/* ── COMPLIANCE TAB ── */}
          {activeTab === 'compliance' && (
            <div className="max-w-4xl space-y-5">
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2"><ClipboardCheck size={14} className="text-amber-400" /> Compliance Report</h3>
                  <StatusBadge status={compliance.overallStatus} size="lg" />
                </div>
                {compliance.autoDetected && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: 'State', value: compliance.jurisdiction?.state || '—' },
                      { label: 'NEC Version', value: `NEC ${compliance.jurisdiction?.necVersion || '—'}` },
                      { label: 'Min Design Temp', value: `${compliance.autoDetected.designTempMin}°C` },
                      { label: 'Design Wind Speed', value: `${compliance.autoDetected.windSpeed} mph` },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                        <div className="text-sm font-bold text-white">{item.value}</div>
                        <div className="text-xs text-slate-500">{item.label}</div>
                      </div>
                    ))}
                  </div>
                )}
                {calcError && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 mb-4">Calculation error: {calcError}</div>}
                {!compliance.overallStatus && !calculating && (
                  <div className="text-center py-8 text-slate-500">
                    <Activity size={32} className="mx-auto mb-2 opacity-30" />
                    <div className="text-sm">Enter project details and address to run compliance check</div>
                    <button onClick={runCalc} className="btn-primary btn-sm mt-3">Run Compliance Check</button>
                  </div>
                )}
              </div>

              {/* ── AHJ Auto-Detection Status Banner ── */}
              {compliance.jurisdiction && (
                <div className="card p-4 border-l-4 border-amber-500">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <MapPin size={14} className="text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-white">AHJ Auto-Detected</span>
                        <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full">
                          {compliance.jurisdiction.state}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">
                          NEC {compliance.jurisdiction.necVersion}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mb-2">
                        <span className="font-medium text-slate-300">{compliance.jurisdiction.ahj}</span>
                        {compliance.jurisdiction.necAdoptionYear && (
                          <span className="ml-2 text-slate-500">Adopted {compliance.jurisdiction.necAdoptionYear}</span>
                        )}
                      </div>
                      {compliance.jurisdiction.specialRequirements?.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Special Requirements</div>
                          {compliance.jurisdiction.specialRequirements.map((req: string, i: number) => (
                            <div key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
                              <span className="text-amber-400 flex-shrink-0 mt-0.5">•</span>
                              {req}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 flex-shrink-0">
                      {config.address ? 'From address' : 'From state'}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Compliance Action Center ── */}
              {compliance.overallStatus && (compliance.electrical?.errors?.length > 0 || compliance.electrical?.warnings?.length > 0) && (
                <div className="card p-5 border-l-4 border-red-500/60">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                      <AlertTriangle size={14} className="text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Compliance Action Center</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {compliance.electrical?.errors?.length ?? 0} error{(compliance.electrical?.errors?.length ?? 0) !== 1 ? 's' : ''} ·{' '}
                        {compliance.electrical?.warnings?.length ?? 0} warning{(compliance.electrical?.warnings?.length ?? 0) !== 1 ? 's' : ''} — click any issue for NEC explanation + fix
                      </p>
                    </div>
                    <div className="ml-auto">
                      <StatusBadge status={compliance.overallStatus} size="lg" />
                    </div>
                  </div>

                  {/* Priority fixes */}
                  {compliance.electrical?.errors?.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-bold text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <XCircle size={11} /> Must Fix ({compliance.electrical.errors.length})
                      </div>
                      <div className="space-y-2">
                        {compliance.electrical.errors.map((e: any, i: number) => (
                          <IssueRow key={i} issue={e} expanded={i === 0} />
                        ))}
                      </div>
                    </div>
                  )}

                  {compliance.electrical?.warnings?.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-amber-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <AlertTriangle size={11} /> Review ({compliance.electrical.warnings.length})
                      </div>
                      <div className="space-y-2">
                        {compliance.electrical.warnings.map((w: any, i: number) => (
                          <IssueRow key={i} issue={w} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick fix actions */}
                  {compliance.electrical?.autoResolutions?.length === 0 && compliance.electrical?.errors?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-700/50">
                      <div className="text-xs text-slate-400 mb-2">Quick Actions</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => { setEngineeringMode('AUTO'); setTimeout(runCalc, 100); }}
                          className="btn-primary btn-sm text-xs"
                        >
                          ⚡ Auto-Fix All Issues
                        </button>
                        <button
                          onClick={() => setActiveTab('config')}
                          className="btn-secondary btn-sm text-xs"
                        >
                          ⚙️ Adjust Config
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── All Clear Banner ── */}
              {compliance.overallStatus === 'PASS' && (
                <div className="card p-4 border-l-4 border-emerald-500 bg-emerald-500/5">
                  <div className="flex items-center gap-3">
                    <CheckCircle size={20} className="text-emerald-400 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-bold text-emerald-400">All Compliance Checks Passed</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        System meets NEC {compliance.jurisdiction?.necVersion ?? '2023'} requirements for {compliance.jurisdiction?.state ?? 'this jurisdiction'}.
                        Ready for permit submission.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Microinverter AC System Summary ── */}
              {config.inverters[0]?.type === 'micro' && compliance.overallStatus && (() => {
                const firstMicroInv = config.inverters[0];
                const microInvData = getInvById(firstMicroInv.inverterId, 'micro') as any;
                const mpd = firstMicroInv.deviceRatioOverride ?? microInvData?.modulesPerDevice ?? 1;
                const totalPanelsMicro = config.inverters.reduce((s, inv) => s + inv.strings.reduce((ss: number, str: any) => ss + (str.panelCount || 0), 0), 0);
                const microDevCount = Math.ceil(totalPanelsMicro / mpd);
                const acBranches = Math.ceil(microDevCount / 16);
                const perMicroW = microInvData?.acOutputW || microInvData?.acOutputKw * 1000 || 300;
                const totalAcKw = (microDevCount * perMicroW / 1000).toFixed(2);
                const acBranchAmps = Math.ceil((microDevCount * perMicroW / 240 / acBranches) * 1.25 / 5) * 5;
                return (
                  <div className="card p-4 mb-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <Zap size={12} className="text-blue-400" /> Microinverter AC System — NEC 690.8
                      <span className="ml-auto text-xs text-blue-400 font-bold">DC→AC AT PANEL</span>
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      {[
                        { label: 'Topology', value: 'MICROINVERTER' },
                        { label: 'Microinverters', value: `${microDevCount} units` },
                        { label: 'Panels per Micro', value: `${mpd}` },
                        { label: 'Total Panels', value: `${totalPanelsMicro}` },
                        { label: 'Per Micro Output', value: `${perMicroW}W` },
                        { label: 'Total AC Output', value: `${totalAcKw} kW` },
                        { label: 'AC Branch Circuits', value: `${acBranches}` },
                        { label: 'Max Micros/Branch', value: '16 (NEC 690.8)' },
                        { label: 'AC Branch OCPD', value: `${acBranchAmps}A` },
                        { label: 'No DC Strings', value: 'N/A — AC output only' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between bg-slate-800/40 rounded px-2 py-1">
                          <span className="text-slate-400">{label}</span>
                          <span className="font-mono font-bold text-white">{value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-blue-300/70 bg-blue-900/20 rounded px-3 py-2 border border-blue-500/20">
                      ℹ️ Microinverters convert DC→AC at each panel. No DC strings, no string voltage calculations. AC trunk cable runs from array to combiner/panel.
                    </div>
                  </div>
                );
              })()}

              {/* ── Auto String Configuration (NEC 690.7) -- string/optimizer only ── */}
              {compliance.stringConfig && config.inverters[0]?.type !== 'micro' && (
                <div className="card p-4 mb-3">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <Zap size={12} className="text-green-400" /> Auto String Configuration — NEC 690.7
                    {compliance.stringConfig.isValid
                      ? <span className="ml-auto text-xs text-green-400 font-bold">✓ VALID</span>
                      : <span className="ml-auto text-xs text-red-400 font-bold">⚠ ERRORS</span>}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    {[
                      { label: 'Total Strings', value: `${compliance.stringConfig.totalStrings}` },
                      { label: 'Panels / String', value: compliance.stringConfig.panelsPerString === compliance.stringConfig.lastStringPanels
                          ? `${compliance.stringConfig.panelsPerString}`
                          : `${compliance.stringConfig.panelsPerString} (last: ${compliance.stringConfig.lastStringPanels})` },
                      { label: 'Max / String', value: `${compliance.stringConfig.maxPanelsPerString}` },
                      { label: 'Min / String', value: `${compliance.stringConfig.minPanelsPerString}` },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                        <div className="text-sm font-bold text-white">{item.value}</div>
                        <div className="text-xs text-slate-500">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    {[
                      { label: 'Design Temp', value: `${compliance.stringConfig.designTempMin}°C` },
                      { label: 'Voc Corrected', value: `${compliance.stringConfig.vocCorrected.toFixed(2)} V` },
                      { label: 'String Voc', value: `${compliance.stringConfig.stringVoc.toFixed(1)} V` },
                      { label: 'DC/AC Ratio', value: `${compliance.stringConfig.dcAcRatio.toFixed(2)}` },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                        <div className="text-sm font-bold text-white">{item.value}</div>
                        <div className="text-xs text-slate-500">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    {[
                      { label: 'OCPD / String', value: `${compliance.stringConfig.ocpdPerString} A` },
                      { label: 'DC Wire Ampacity', value: `${compliance.stringConfig.dcWireAmpacity.toFixed(1)} A` },
                      { label: 'Combiner', value: compliance.stringConfig.combinerType },
                      { label: 'MPPT Channels', value: `${compliance.stringConfig.mpptChannels.length}` },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                        <div className="text-sm font-bold text-white">{item.value}</div>
                        <div className="text-xs text-slate-500">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  {compliance.stringConfig.mpptChannels.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-slate-400 mb-1 font-semibold">MPPT Channel Allocation</div>
                      <div className="flex flex-wrap gap-2">
                        {compliance.stringConfig.mpptChannels.map(ch => (
                          <div key={ch.channelIndex} className="bg-slate-700/60 rounded px-3 py-1 text-xs text-slate-300">
                            CH{ch.channelIndex + 1}: <span className="font-bold text-white">{ch.stringCount} string{ch.stringCount !== 1 ? 's' : ''}</span>
                            <span className="text-slate-500 ml-1">({(ch.totalPower / 1000).toFixed(2)} kW)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-slate-400 mb-2">
                    <span className="font-semibold text-slate-300">Combiner: </span>{compliance.stringConfig.combinerLabel}
                  </div>
                  {compliance.stringConfig.warnings.length > 0 && (
                    <div className="space-y-1">
                      {compliance.stringConfig.warnings.map((w, i) => (
                        <div key={i} className="text-xs text-amber-400 bg-amber-500/10 rounded px-2 py-1">⚠ {w}</div>
                      ))}
                    </div>
                  )}
                  {compliance.stringConfig.errors.length > 0 && (
                    <div className="space-y-1 mt-1">
                      {compliance.stringConfig.errors.map((e, i) => (
                        <div key={i} className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">✗ {e}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Interconnection Method Selector ─────────────────────────── */}
              <div className="card p-4 mb-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Zap size={12} className="text-amber-400" /> Interconnection Method
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Method</label>
                    <select
                      className="select text-sm w-full"
                      value={config.interconnectionMethod ?? 'LOAD_SIDE'}
                      onChange={e => { updateConfig({ interconnectionMethod: e.target.value as any }); setTimeout(runCalc, 100); }}
                    >
                      <option value="LOAD_SIDE">Load-Side Breaker (120% Rule)</option>
                      <option value="SUPPLY_SIDE_TAP">Supply-Side Tap (Line-Side Connection)</option>
                      <option value="MAIN_BREAKER_DERATE">Main Breaker Derate</option>
                      <option value="PANEL_UPGRADE">Panel Upgrade</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Bus Bar Rating (A)</label>
                    <input
                      type="number"
                      className="input text-sm w-full"
                      value={config.panelBusRating ?? 200}
                      onChange={e => { updateConfig({ panelBusRating: parseInt(e.target.value) || 200 }); setTimeout(runCalc, 100); }}
                      min={100} max={600} step={25}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Main Breaker (A)</label>
                    <input
                      type="number"
                      className="input text-sm w-full"
                      value={config.mainPanelAmps ?? 200}
                      onChange={e => { updateConfig({ mainPanelAmps: parseInt(e.target.value) || 200 }); setTimeout(runCalc, 100); }}
                      min={60} max={600} step={5}
                    />
                  </div>
                </div>
                {config.interconnectionMethod === 'SUPPLY_SIDE_TAP' && (
                  <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-300">
                    Supply-side tap connects before the main breaker. 120% busbar rule does not apply (NEC 705.11).
                    Common hardware: Polaris connectors, tap blocks, meter collar adapters.
                  </div>
                )}
                {config.interconnectionMethod === 'MAIN_BREAKER_DERATE' && (
                  <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-300">
                    Main breaker will be derated to satisfy 120% rule. See compliance results for required breaker size.
                  </div>
                )}
              </div>

              {compliance.electrical && (
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2"><Zap size={14} className="text-amber-400" /> Electrical Compliance — NEC {compliance.electrical.necVersion}</h3>
                    <StatusBadge status={compliance.electrical.status} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: 'DC System Size', value: `${compliance.electrical.summary?.totalDcKw?.toFixed(2)} kW` },
                      { label: 'AC Capacity', value: `${compliance.electrical.summary?.totalAcKw?.toFixed(2)} kW` },
                      { label: 'DC/AC Ratio', value: compliance.electrical.summary?.dcAcRatio?.toFixed(2) },
                      { label: 'Grounding Conductor', value: compliance.electrical.groundingConductor },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                        <div className="text-sm font-bold text-white">{item.value}</div>
                        <div className="text-xs text-slate-500">{item.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* ── Interconnection Result Card ──────────────────────────────── */}
                  {compliance.electrical.interconnection && (
                    <div className={`p-3 rounded-lg border mb-3 ${compliance.electrical.interconnection.passes ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white">
                          Interconnection: {compliance.electrical.interconnection.methodLabel}
                        </span>
                        <StatusBadge status={compliance.electrical.interconnection.passes ? 'PASS' : 'FAIL'} size="sm" />
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {compliance.electrical.interconnection.message}
                      </div>
                      <div className="flex gap-4 mt-2 text-xs">
                        <span className="text-slate-500">Solar Breaker: <span className="text-white">{compliance.electrical.interconnection.solarBreakerRequired}A</span></span>
                        {compliance.electrical.interconnection.maxAllowedSolarBreaker < 9999 && (
                          <span className="text-slate-500">Max Allowed: <span className="text-white">{compliance.electrical.interconnection.maxAllowedSolarBreaker}A</span></span>
                        )}
                        {compliance.electrical.interconnection.recommendedMainBreaker && (
                          <span className="text-slate-500">Recommended Main: <span className="text-amber-400">{compliance.electrical.interconnection.recommendedMainBreaker}A</span></span>
                        )}
                        <span className="text-slate-500">NEC: <span className="text-slate-300">{compliance.electrical.interconnection.necReference}</span></span>
                      </div>
                      {/* Alternatives when LOAD_SIDE fails */}
                      {compliance.electrical.interconnection.alternatives?.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-slate-700">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-semibold text-amber-400">Recommended Interconnection Methods:</div>
                            <button
                              onClick={() => {
                                const alts = compliance.electrical.interconnection.alternatives;
                                const best = alts?.find((a: any) => a.passes);
                                if (best) {
                                  updateConfig({ interconnectionMethod: best.method as any });
                                  setTimeout(runCalc, 100);
                                }
                              }}
                              className="flex items-center gap-1 px-2 py-1 bg-emerald-500/15 border border-emerald-500/30 rounded text-xs text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                            >
                              <CheckCircle size={10} />
                              Auto-select compliant method
                            </button>
                          </div>
                          {compliance.electrical.interconnection.alternatives.map((alt: any, i: number) => (
                            <div
                              key={i}
                              onClick={() => {
                                updateConfig({ interconnectionMethod: alt.method as any });
                                setTimeout(runCalc, 100);
                              }}
                              className="flex items-center justify-between gap-2 text-xs text-slate-400 mt-1 p-2 rounded cursor-pointer hover:bg-slate-700/50 transition-colors group"
                            >
                              <div className="flex items-start gap-2">
                                <span className={`flex-shrink-0 mt-0.5 ${alt.passes ? 'text-emerald-400' : 'text-amber-400'}`}>
                                  {alt.passes ? '✓' : '○'}
                                </span>
                                <div>
                                  <span className="text-white font-medium">{alt.label}</span>
                                  <span className="text-slate-500"> — {alt.description}</span>
                                </div>
                              </div>
                              <span className="text-slate-600 group-hover:text-slate-400 flex-shrink-0 text-xs">Apply →</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {compliance.electrical.conduitFill && (
                    <div className={`p-3 rounded-lg border mb-3 ${compliance.electrical.conduitFill.passes ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Conduit Fill (NEC Ch. 9)</span>
                        <StatusBadge status={compliance.electrical.conduitFill.passes ? 'PASS' : 'FAIL'} size="sm" />
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Fill: {compliance.electrical.conduitFill.fillPercent?.toFixed(1)}% · {compliance.electrical.conduitFill.conduitType} {compliance.electrical.conduitFill.conduitSize} · Max: 40%
                      </div>
                    </div>
                  )}
                  {compliance.electrical.inverters?.map((inv: any, i: number) => (
                    <div key={i} className="mb-3">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Inverter {inv.inverterId}</div>
                      {inv.strings?.map((str: any, j: number) => (
                        <div key={j} className="bg-slate-800/40 rounded-lg p-3 mb-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-white">String {inv.inverterId}-{str.stringId}</span>
                            <StatusBadge status={str.issues?.some((i: any) => i.severity === 'error') ? 'FAIL' : str.issues?.some((i: any) => i.severity === 'warning') ? 'WARNING' : 'PASS'} size="sm" />
                          </div>
                          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs mb-2">
                            <div><span className="text-slate-500">Voc STC:</span> <span className="text-white">{str.vocSTC?.toFixed(1)}V</span></div>
                            <div><span className="text-slate-500">Voc Corr:</span> <span className="text-amber-400 font-bold">{str.vocCorrected?.toFixed(1)}V</span></div>
                            <div><span className="text-slate-500">Isc:</span> <span className="text-white">{str.iscSTC?.toFixed(2)}A</span></div>
                            <div><span className="text-slate-500">Max I:</span> <span className="text-white">{str.maxCurrentNEC?.toFixed(2)}A</span></div>
                            <div><span className="text-slate-500">OCPD:</span> <span className="text-white">{str.ocpdRating}A</span></div>
                            <div><span className="text-slate-500">V-Drop:</span> <span className={str.voltageDrop > 3 ? 'text-amber-400' : 'text-white'}>{str.voltageDrop?.toFixed(2)}%</span></div>
                          </div>
                          {str.issues?.map((issue: any, k: number) => <IssueRow key={k} issue={issue} />)}
                        </div>
                      ))}
                    </div>
                  ))}
                  {compliance.electrical.errors?.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-bold text-red-400 mb-2 flex items-center gap-1"><XCircle size={12} /> Errors ({compliance.electrical.errors.length})</div>
                      <div className="space-y-1">{compliance.electrical.errors.map((e: any, i: number) => <IssueRow key={i} issue={e} />)}</div>
                    </div>
                  )}
                  {compliance.electrical.warnings?.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1"><AlertTriangle size={12} /> Warnings ({compliance.electrical.warnings.length})</div>
                      <div className="space-y-1">{compliance.electrical.warnings.map((w: any, i: number) => <IssueRow key={i} issue={w} />)}</div>
                    </div>
                  )}
                  {compliance.electrical.recommendations?.length > 0 && (
                    <div className="mt-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                      <div className="text-xs font-bold text-blue-400 mb-2">Recommendations</div>
                      {compliance.electrical.recommendations.map((r: string, i: number) => <div key={i} className="text-xs text-slate-400">• {r}</div>)}
                    </div>
                  )}

                  {/* Auto-Resolution Log */}
                  {compliance.electrical.autoResolutions?.length > 0 && (
                    <div className="mt-4 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                      <div className="text-xs font-bold text-emerald-400 mb-3 flex items-center gap-2">
                        <CheckCircle size={12} />
                        Auto-Resolution Log — {engineeringMode} Mode ({compliance.electrical.autoResolutions.length} correction{compliance.electrical.autoResolutions.length !== 1 ? 's' : ''} applied)
                      </div>
                      <div className="space-y-1.5">
                        {compliance.electrical.autoResolutions.map((res: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-xs p-2 bg-slate-800/40 rounded">
                            <span className="text-emerald-400 flex-shrink-0">✓</span>
                            <div className="flex-1 min-w-0">
                              <span className="text-white font-medium">{res.field}</span>
                              <span className="text-slate-500 mx-1">·</span>
                              <span className="text-slate-400">{String(res.originalValue)}</span>
                              <span className="text-slate-500 mx-1">→</span>
                              <span className="text-emerald-400 font-bold">{String(res.resolvedValue)}</span>
                              <span className="text-slate-600 font-mono ml-2 text-xs">[{res.necReference}]</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Engineering Mode indicator */}
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <div className={`w-2 h-2 rounded-full ${engineeringMode === 'AUTO' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    Engineering Mode: <span className={`font-bold ${engineeringMode === 'AUTO' ? 'text-emerald-400' : 'text-amber-400'}`}>{engineeringMode}</span>
                    {engineeringMode === 'AUTO' ? ' — violations auto-resolved per NEC' : ' — manual override active, verify all values'}
                  </div>
                </div>
              )}

              {compliance.structural && (
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2"><Wrench size={14} className="text-amber-400" /> Structural Compliance — ASCE 7-22 / V2 Engine</h3>
                    <StatusBadge status={compliance.structural.status} />
                  </div>

                  {/* Framing Analysis (V2) */}
                  {compliance.structural.framing && (
                    <div className="mb-4 p-3 bg-slate-800/30 rounded-lg border border-slate-700/50">
                      <div className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-2">
                        <Grid size={12} /> Framing Analysis
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="text-center">
                          <div className="text-sm font-bold text-white capitalize">{compliance.structural.framing.type || config.framingType}</div>
                          <div className="text-xs text-slate-500">Framing Type</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-white">{config.rafterSize} @ {config.rafterSpacing}" OC</div>
                          <div className="text-xs text-slate-500">Rafter/Truss Spacing</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-white">{config.rafterSpan}' span</div>
                          <div className="text-xs text-slate-500">Span Length</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-white">{compliance.structural.framing.capacityPsf?.toFixed(0) ?? '—'} psf</div>
                          <div className="text-xs text-slate-500">Capacity</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Load Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: 'Wind Uplift/Attach.', value: `${compliance.structural.wind?.upliftPerAttachment?.toFixed(0) ?? compliance.structural.mountLayout?.upliftPerMount?.toFixed(0) ?? '—'} lbs` },
                      { label: 'Snow Load/Attach.', value: `${compliance.structural.snow?.snowLoadPerAttachment?.toFixed(0) ?? compliance.structural.mountLayout?.snowLoadPerMount?.toFixed(0) ?? '—'} lbs` },
                      { label: 'Framing Utilization', value: `${((compliance.structural.rafter?.utilizationRatio ?? compliance.structural.framing?.utilization ?? 0) * 100).toFixed(0)}%` },
                      { label: 'Safety Factor', value: (compliance.structural.attachment?.safetyFactor ?? compliance.structural.mountLayout?.safetyFactor ?? 0).toFixed(2) },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                        <div className="text-sm font-bold text-white">{item.value}</div>
                        <div className="text-xs text-slate-500">{item.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Mount Layout (V2) */}
                  {compliance.structural.mountLayout && (
                    <div className="mb-4 p-3 bg-slate-800/30 rounded-lg border border-slate-700/50">
                      <div className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-2">
                        <MapPin size={12} /> Mount Layout — {config.mountingId?.includes('rt-mini') ? 'Roof Tech RT-MINI' : config.mountingId || 'Standard'}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="text-center">
                          <div className="text-sm font-bold text-white">{compliance.structural.mountLayout.mountCount ?? '—'}</div>
                          <div className="text-xs text-slate-500">Total Mounts</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-white">{compliance.structural.mountLayout.mountSpacing ?? config.attachmentSpacing}"</div>
                          <div className="text-xs text-slate-500">Mount Spacing</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-white">{compliance.structural.mountLayout.upliftPerMount?.toFixed(0) ?? '—'} lbs</div>
                          <div className="text-xs text-slate-500">Uplift/Mount</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-white">{compliance.structural.mountLayout.downwardPerMount?.toFixed(0) ?? '—'} lbs</div>
                          <div className="text-xs text-slate-500">Downward/Mount</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Racking BOM (V2) */}
                  {compliance.structural.rackingBOM && (
                    <div className="mb-4 p-3 bg-slate-800/30 rounded-lg border border-slate-700/50">
                      <div className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-2">
                        <Package size={12} /> Racking Bill of Materials
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        {compliance.structural.rackingBOM.mounts && (
                          <div className="flex justify-between p-2 bg-slate-800/40 rounded">
                            <span className="text-slate-400">Roof Mounts</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.mounts.qty}</span>
                          </div>
                        )}
                        {compliance.structural.rackingBOM.rails && (
                          <div className="flex justify-between p-2 bg-slate-800/40 rounded">
                            <span className="text-slate-400">{compliance.structural.rackingBOM.rails.description}</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.rails.qty} {compliance.structural.rackingBOM.rails.unit}</span>
                          </div>
                        )}
                        {compliance.structural.rackingBOM.lFeet && (
                          <div className="flex justify-between p-2 bg-slate-800/40 rounded">
                            <span className="text-slate-400">L-Feet</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.lFeet.qty}</span>
                          </div>
                        )}
                        {compliance.structural.rackingBOM.railSplices && (
                          <div className="flex justify-between p-2 bg-slate-800/40 rounded">
                            <span className="text-slate-400">Rail Splices</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.railSplices.qty}</span>
                          </div>
                        )}
                        {compliance.structural.rackingBOM.midClamps && (
                          <div className="flex justify-between p-2 bg-slate-800/40 rounded">
                            <span className="text-slate-400">Mid Clamps</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.midClamps.qty}</span>
                          </div>
                        )}
                        {compliance.structural.rackingBOM.endClamps && (
                          <div className="flex justify-between p-2 bg-slate-800/40 rounded">
                            <span className="text-slate-400">End Clamps</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.endClamps.qty}</span>
                          </div>
                        )}
                        {compliance.structural.rackingBOM.groundLugs && (
                          <div className="flex justify-between p-2 bg-slate-800/40 rounded">
                            <span className="text-slate-400">Grounding Lugs</span>
                            <span className="text-white font-bold">{compliance.structural.rackingBOM.groundLugs.qty}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Issues */}
                  {[...(compliance.structural.errors || []), ...(compliance.structural.warnings || [])].map((issue: any, i: number) => (
                    <div key={i} className="mb-2"><IssueRow issue={issue} /></div>
                  ))}
                  {compliance.structural.recommendations?.length > 0 && (
                    <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg mt-2">
                      <div className="text-xs font-bold text-blue-400 mb-2">Recommendations</div>
                      {compliance.structural.recommendations.map((r: string, i: number) => <div key={i} className="text-xs text-slate-400">• {r}</div>)}
                    </div>
                  )}

                  {/* Structural Resolution Options (MANUAL mode or FAIL) */}
                  {compliance.structural?.status === 'FAIL' && (
                    <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                      <div className="text-xs font-bold text-amber-400 mb-3 flex items-center gap-2">
                        <Wrench size={12} />
                        {engineeringMode === 'AUTO' ? 'Auto-Resolution Applied' : 'Resolution Options — Select to Apply'}
                      </div>
                      {engineeringMode === 'AUTO' ? (
                        <div className="text-xs text-slate-400">
                          In AUTO mode, the system automatically applies the optimal structural fix.
                          Switch to MANUAL mode to select a specific resolution option.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {[
                            { id: 'spacing', step: 1, action: 'Reduce attachment spacing', from: `${config.attachmentSpacing}"`, to: `${Math.max(24, config.attachmentSpacing - 12)}"`, field: 'attachmentSpacing', value: Math.max(24, config.attachmentSpacing - 12), ref: 'ASCE 7-22' },
                            { id: 'rafter', step: 2, action: 'Upgrade rafter size', from: config.rafterSize, to: config.rafterSize === '2x6' ? '2x8' : config.rafterSize === '2x8' ? '2x10' : '2x12', field: 'rafterSize', value: config.rafterSize === '2x6' ? '2x8' : config.rafterSize === '2x8' ? '2x10' : '2x12', ref: 'NDS 2018' },
                            { id: 'lag', step: 3, action: 'Upgrade lag bolt to 3/8"', from: '5/16"', to: '3/8"', field: null, value: null, ref: 'NDS 2018 Table 12.2A' },
                            { id: 'engineer', step: 4, action: 'Engage structural engineer', from: 'Current design', to: 'Engineer-stamped', field: null, value: null, ref: 'IBC 2021 §1604' },
                          ].map(opt => (
                            <div key={opt.id} className="flex items-center justify-between p-2 bg-slate-800/40 rounded-lg">
                              <div className="flex-1">
                                <div className="text-xs font-medium text-white">Step {opt.step}: {opt.action}</div>
                                <div className="text-xs text-slate-500">{opt.from} → <span className="text-amber-400">{opt.to}</span> · {opt.ref}</div>
                              </div>
                              {opt.field && opt.value !== null && (
                                <button
                                  onClick={() => {
                                    updateConfig({ [opt.field as string]: opt.value } as any);
                                    setTimeout(runCalc, 500);
                                  }}
                                  className="btn-secondary btn-sm ml-3 text-xs"
                                >
                                  Apply
                                </button>
                              )}
                              {!opt.field && (
                                <span className="text-xs text-slate-600 ml-3">Manual action</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {compliance.jurisdiction && (
                <div className="card p-5">
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><MapPin size={14} className="text-amber-400" /> Jurisdiction — {compliance.jurisdiction.state}</h3>
                  {compliance.jurisdiction.specialRequirements?.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Special Requirements</div>
                      <div className="space-y-1">
                        {compliance.jurisdiction.specialRequirements.map((r: string, i: number) => (
                          <div key={i} className="flex gap-2 text-xs text-slate-300 p-2 bg-slate-800/40 rounded-lg">
                            <CheckCircle size={11} className="text-amber-400 flex-shrink-0 mt-0.5" /> {r}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {compliance.jurisdiction.localAmendments?.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Local Amendments</div>
                      <div className="space-y-1">
                        {compliance.jurisdiction.localAmendments.map((a: any, i: number) => (
                          <div key={i} className="flex gap-2 text-xs p-2 bg-slate-800/40 rounded-lg">
                            <span className="text-amber-400 font-mono flex-shrink-0">{a.code}</span>
                            <span className="text-slate-300">{a.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="p-3 bg-slate-800/40 rounded-lg text-xs text-slate-400">
                    <span className="font-bold text-white">Permit Notes: </span>{compliance.jurisdiction.permitNotes}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── ELECTRICAL SIZING TAB ── */}
          {activeTab === 'electrical' && (
            <div className="max-w-4xl space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity size={14} className="text-amber-400" /> Electrical Conductor &amp; Disconnect Sizing
                    <span className="text-xs font-normal bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">NEC 705.60 · 240.6 · 310.16</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Auto-calculated from system AC output · Permit-grade sizing · Steps 1–7</p>
                </div>
              </div>

              {/* ── ComputedSystem Summary Panel ── */}
              <div className="bg-slate-800/60 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={13} className="text-amber-400" />
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">ComputedSystem Engine</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${cs.isValid ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border-red-500/30 text-red-400'}`}>
                    {cs.isValid ? '✓ VALID' : `${cs.errorCount} ERROR${cs.errorCount !== 1 ? 'S' : ''}`}
                  </span>
                  {cs.autoFixCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full border bg-blue-500/15 border-blue-500/30 text-blue-400">{cs.autoFixCount} auto-fixed</span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div className="bg-slate-900/50 rounded-lg p-2.5">
                    <div className="text-xs text-slate-500 mb-0.5">Topology</div>
                    <div className={`text-sm font-bold ${cs.isMicro ? 'text-purple-400' : 'text-amber-400'}`}>{cs.topology.replace('_', ' ')}</div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2.5">
                    <div className="text-xs text-slate-500 mb-0.5">{cs.isMicro ? 'Microinverters' : 'String Count'}</div>
                    <div className="text-sm font-bold text-white">
                      {cs.isMicro ? `${cs.microDeviceCount} devices · ${cs.acBranchCount} branch${cs.acBranchCount !== 1 ? 'es' : ''}` : `${cs.stringCount} strings × ${cs.panelsPerString} panels`}
                    </div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2.5">
                    <div className="text-xs text-slate-500 mb-0.5">AC Output</div>
                    <div className="text-sm font-bold text-white">{cs.acOutputCurrentA.toFixed(1)}A · {cs.acOcpdAmps}A OCPD</div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2.5">
                    <div className="text-xs text-slate-500 mb-0.5">DC/AC Ratio</div>
                    <div className={`text-sm font-bold ${cs.dcAcRatio > 1.5 ? 'text-amber-400' : 'text-emerald-400'}`}>{cs.dcAcRatio.toFixed(2)}</div>
                  </div>
                </div>
                {/* Wire runs summary from ComputedSystem */}
                <div className="space-y-1.5">
                  {cs.runs.map(run => (
                    <div key={run.id} className="flex items-center gap-2 text-xs">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${run.color === 'dc' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                      <span className="text-slate-400 w-48 flex-shrink-0">{run.label}</span>
                      <span className="font-mono text-white">{run.conductorCallout}</span>
                      <span className={`ml-auto flex-shrink-0 ${run.conduitFillPass ? 'text-emerald-400' : 'text-red-400'}`}>{run.conduitFillPct.toFixed(0)}% fill</span>
                      <span className={`flex-shrink-0 ${run.voltageDropPass ? 'text-emerald-400' : 'text-amber-400'}`}>{run.voltageDropPct.toFixed(1)}% VD</span>
                    </div>
                  ))}
                </div>
                {/* Validation issues from ComputedSystem */}
                {cs.issues.filter(i => i.severity === 'error' || i.severity === 'warning').length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1.5">
                    {cs.issues.filter(i => i.severity !== 'info').map((issue, idx) => (
                      <div key={idx} className={`flex gap-2 p-2 rounded text-xs ${issue.severity === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-300' : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'}`}>
                        <span className="flex-shrink-0">{issue.severity === 'error' ? '✗' : '⚠'}</span>
                        <span>{issue.message}</span>
                        <span className="ml-auto text-slate-500 flex-shrink-0">{issue.necReference}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(() => {
                const elec = compliance.electrical as any;
                const ac = elec?.acSizing;
                // Use computedSystem as primary source of truth for AC sizing values
                // It uses the same NEC 310.15(B)(2) logic and 240V 2-pole breaker sizing
                const cs = computedSystem;
                const csFeederRun = cs?.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN');
                const csBranchRun = cs?.runs?.find((r: any) => r.id === 'BRANCH_RUN');
                // Prefer computedSystem values; fall back to electrical-calc acSizing
                const totalAcKw = cs?.totalAcKw ?? elec?.summary?.totalAcKw ?? 0;
                const sysV = 240;
                // Feeder OCPD from computedSystem (correct 240V 2-pole sizing)
                const feederOcpdAmps = cs?.acOcpdAmps ?? ac?.ocpdAmps ?? 60;
                // Feeder conductor from computedSystem segment schedule
                const feederGauge = csFeederRun?.wireGauge ?? ac?.conductorGauge ?? '#6 AWG';
                const feederConduit = csFeederRun ? `${csFeederRun.conduitSize} ${csFeederRun.conduitType} (${csFeederRun.conduitFillPct?.toFixed(1)}% fill)` : ac?.conduitLabel ?? '';
                const feederAmpacity = csFeederRun?.effectiveAmpacity ?? ac?.conductorAmpacity ?? 65;
                // Branch OCPD from computedSystem (correct 240V 2-pole sizing)
                const branchOcpdAmps = csBranchRun?.ocpdAmps ?? cs?.microBranches?.[0]?.ocpdAmps ?? feederOcpdAmps;
                // AC output current from computedSystem
                const acCurrentAmps = cs?.acOutputCurrentA ?? ac?.acCurrentAmps ?? 0;
                const continuousCurrentAmps = +(acCurrentAmps * 1.25).toFixed(2);

                if (!elec || !ac) {
                  return (
                    <div className="card p-12 text-center">
                      <Activity size={40} className="mx-auto mb-4 text-slate-600" />
                      <div className="text-sm font-bold text-white mb-1">Run Compliance to Calculate</div>
                      <div className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                        Configure your system and run the compliance check to auto-calculate all electrical sizing values.
                      </div>
                      <button onClick={() => setActiveTab('compliance')} className="btn-primary btn-sm mx-auto">
                        <ClipboardCheck size={14} /> Go to Compliance
                      </button>
                    </div>
                  );
                }

                const steps = [
                  {
                    num: 1,
                    title: 'Inverter Output Current',
                    nec: 'NEC 705.60',
                    formula: `(${totalAcKw.toFixed(2)} kW × 1000) ÷ ${sysV}V`,
                    result: `${acCurrentAmps.toFixed(2)}A`,
                    detail: 'AC output current at system voltage',
                    color: 'blue',
                  },
                  {
                    num: 2,
                    title: 'Continuous Load Rule',
                    nec: 'NEC 705.60',
                    formula: `${acCurrentAmps.toFixed(2)}A × 1.25`,
                    result: `${continuousCurrentAmps}A`,
                    detail: 'PV output is continuous — 125% multiplier required',
                    color: 'purple',
                  },
                  {
                    num: 3,
                    title: 'Feeder OCPD Size',
                    nec: 'NEC 240.6',
                    formula: `Next 240V 2-pole breaker ≥ ${continuousCurrentAmps}A`,
                    result: `${feederOcpdAmps}A Circuit Breaker`,
                    detail: 'Real 240V double-pole breaker sizes: 20, 40, 60, 100, 125, 150, 200A',
                    color: 'amber',
                  },
                  {
                    num: 4,
                    title: 'AC Disconnect Rating',
                    nec: 'NEC 690.14',
                    formula: `Disconnect ≥ OCPD (${feederOcpdAmps}A)`,
                    result: `${feederOcpdAmps}A Non-Fused AC Disconnect`,
                    detail: 'Utility-accessible disconnect required at point of interconnection',
                    color: 'amber',
                  },
                  {
                    num: 5,
                    title: 'Branch Circuit OCPD',
                    nec: 'NEC 690.8(B)',
                    formula: cs?.isMicro
                      ? `${cs?.microBranches?.[0]?.deviceCount ?? '?'} micros × ${(acCurrentAmps / Math.max(cs?.microDeviceCount ?? 1, 1)).toFixed(2)}A × 1.25 → 240V 2-pole breaker`
                      : 'N/A — string inverter topology',
                    result: cs?.isMicro ? `${branchOcpdAmps}A Branch Breaker` : 'N/A',
                    detail: cs?.isMicro
                      ? `${cs?.microBranches?.length ?? 0} branches × ${branchOcpdAmps}A 240V 2-pole breakers — real panel hardware sizes only`
                      : 'Branch OCPD applies to microinverter AC trunk circuits only',
                    color: 'orange',
                  },
                  {
                    num: 6,
                    title: 'Feeder Conductor Size',
                    nec: 'NEC 310.15(B)(2)',
                    formula: `90°C derated, capped at 75°C termination ≥ ${feederOcpdAmps}A OCPD`,
                    result: `${feederGauge} THWN-2 (${feederAmpacity}A)`,
                    detail: 'NEC 310.15(B)(2): derate from 90°C column, cap at 75°C for terminations per NEC 110.14(C)',
                    color: 'emerald',
                  },
                  {
                    num: 7,
                    title: 'Conduit Size',
                    nec: 'NEC Ch. 9',
                    formula: `L1 + L2 + N + EGC × ${feederGauge} THWN-2 → ≤40% fill`,
                    result: feederConduit || ac.conduitLabel,
                    detail: 'NEC Chapter 9 Table 4 (conduit area) & Table 5 (conductor area)',
                    color: 'teal',
                  },
                ];

                // Battery NEC 705.12(B) step — add if battery is configured
                const batteryBackfeedADisplay = calcBatteryBackfeedAmps(config.batteryId, config.batteryCount);
                if (batteryBackfeedADisplay > 0) {
                  const batModel = config.batteryModel || 'Battery Storage';
                  const batMfr   = config.batteryBrand || '';
                  const busRating = config.panelBusRating ?? config.mainPanelAmps ?? 200;
                  const mainBreaker = config.mainPanelAmps ?? 200;
                  const totalBackfeedA = feederOcpdAmps + batteryBackfeedADisplay;
                  const busMax = (busRating * 1.2) - mainBreaker;
                  // If supply-side tap is selected, NEC 705.12(B) 120% rule does NOT apply
                  // Supply-side tap (NEC 705.11) connects before the main breaker — no busbar loading concern
                  const isSupplySide = config.interconnectionMethod === 'SUPPLY_SIDE_TAP';
                  const busPass = isSupplySide || totalBackfeedA <= busMax;
                  steps.push({
                    num: steps.length + 1,
                    title: 'Battery Backfeed — NEC 705.12(B) Bus Loading',
                    nec: 'NEC 705.12(B)',
                    formula: isSupplySide
                      ? `Supply-Side Tap (NEC 705.11) — 120% busbar rule does not apply. Solar ${feederOcpdAmps}A + Battery ${batteryBackfeedADisplay}A connect line-side of main breaker.`
                      : `NEC 705.12(B)(3)(2): Solar ${feederOcpdAmps}A + Battery ${batteryBackfeedADisplay}A + Main ${mainBreaker}A = ${totalBackfeedA + mainBreaker}A vs ${busRating}A bus × 120% = ${busRating * 1.2}A max`,
                    result: isSupplySide
                      ? `PASS — Supply-side tap bypasses 120% rule (NEC 705.11)`
                      : busPass ? `PASS — ${totalBackfeedA}A backfeed ≤ ${busMax}A allowed` : `FAIL — ${totalBackfeedA}A backfeed > ${busMax}A allowed`,
                    detail: (() => {
                      const batSpec = getBatteryById(config.batteryId);
                      const isGateway = batSpec?.requiresGateway ?? false;
                      const qty = config.batteryCount && config.batteryCount > 0 ? config.batteryCount : 1;
                      const perUnit = batSpec?.backfeedBreakerA ?? batteryBackfeedADisplay;
                      const breakerDesc = isGateway
                        ? `${qty > 1 ? `${qty}× units share ` : ''}${batteryBackfeedADisplay}A single backfeed breaker via ${batSpec?.gatewayModel ?? 'gateway'}`
                        : `${qty > 1 ? `${qty} units × ${perUnit}A = ${batteryBackfeedADisplay}A total` : `${batteryBackfeedADisplay}A dedicated breaker`}`;
                      if (isSupplySide) {
                        return `${qty > 1 ? `${qty}× ` : ''}${batMfr} ${batModel} — ${breakerDesc}. Supply-side tap (NEC 705.11): connection is made line-side of the main breaker. The 120% busbar rule (NEC 705.12(B)) does not apply — there is no busbar loading concern. This is the recommended interconnection method for solar+battery systems on standard 200A panels.`;
                      }
                      const remediation = busPass ? '' : ` ⚠️ LOAD-SIDE FAILS — Fix options: (1) Switch to Supply-Side Tap (NEC 705.11) in the Interconnection Method dropdown — no busbar limit applies. (2) Derate main breaker to ${Math.floor((busRating * 1.2 - totalBackfeedA) / 5) * 5}A. (3) Upgrade panel bus to ${Math.ceil((totalBackfeedA + mainBreaker) / 1.2 / 25) * 25}A.`;
                      return `${qty > 1 ? `${qty}× ` : ''}${batMfr} ${batModel} — ${breakerDesc}. NEC 705.12(B)(3)(2): Solar + Battery + Main must not exceed Bus × 120% (${busRating * 1.2}A). This is a real NEC constraint.${remediation}`;
                    })(),
                    color: busPass ? 'emerald' : 'red',
                  } as any);
                }

                // Generator NEC 702 step — add if generator is configured
                const genKwDisplay = config.generatorId
                  ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? 0; })()
                  : 0;
                const genBkrDisplay = config.generatorId
                  ? (() => { const g = getGeneratorById(config.generatorId); return g?.outputBreakerA ?? 0; })()
                  : 0;
                if (genKwDisplay > 0) {
                  const genModel = config.generatorId
                    ? (() => { const g = getGeneratorById(config.generatorId); return `${g?.manufacturer ?? ''} ${g?.model ?? ''}`; })()
                    : 'Standby Generator';
                  steps.push({
                    num: steps.length + 1,
                    title: 'Standby Generator — NEC 702 Transfer Equipment',
                    nec: 'NEC 702 / NEC 702.5',
                    formula: `${genKwDisplay}kW generator → ${genBkrDisplay}A output breaker → ATS/BUI transfer switch`,
                    result: `${genBkrDisplay}A Output Breaker`,
                    detail: `${genModel} — NEC 702.5: Transfer equipment required between generator and load. NEC 250.30: Floating neutral required at ATS (generator has bonded neutral).`,
                    color: 'orange',
                  } as any);
                }

                // ATS/BUI NEC 702.5 step — add if ATS or BUI is configured
                const atsAmpDisplay = config.atsId
                  ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? 0; })()
                  : 0;
                const buiMaxADisplay = config.backupInterfaceId
                  ? (() => { const b = getBackupInterfaceById(config.backupInterfaceId); return b?.maxContinuousOutputA ?? 0; })()
                  : 0;
                if (atsAmpDisplay > 0 || buiMaxADisplay > 0) {
                  const isIQSC3 = config.backupInterfaceId?.toLowerCase().includes('sc3') || config.atsId?.toLowerCase().includes('enphase-iq-sc3');
                  const atsModel = config.atsId
                    ? (() => { const a = getATSById(config.atsId); return `${a?.manufacturer ?? ''} ${a?.model ?? ''}`; })()
                    : '';
                  const buiModel = config.backupInterfaceId
                    ? (() => { const b = getBackupInterfaceById(config.backupInterfaceId); return `${b?.manufacturer ?? ''} ${b?.model ?? ''}`; })()
                    : '';
                  const displayAmp = buiMaxADisplay > 0 ? buiMaxADisplay : atsAmpDisplay;
                  const displayModel = buiModel || atsModel;
                  steps.push({
                    num: steps.length + 1,
                    title: isIQSC3 ? 'Backup Interface / ATS (IQ SC3) — NEC 706 / NEC 230.82' : 'Transfer Switch / Backup Interface — NEC 702.5',
                    nec: isIQSC3 ? 'NEC 706 / NEC 230.82' : 'NEC 702.5 / NEC 706',
                    formula: isIQSC3
                      ? `IQ SC3 = ATS + BUI combined — ${displayAmp}A service entrance rated`
                      : `ATS ${atsAmpDisplay}A${buiMaxADisplay > 0 ? ` + BUI ${buiMaxADisplay}A` : ''} — transfer equipment per NEC 702.5`,
                    result: `${displayAmp}A / 240V`,
                    detail: `${displayModel}${isIQSC3 ? ' — Service Entrance Rated. Replaces standalone ATS. Manages solar + battery + generator transfer.' : ' — NEC 702.5: Automatic transfer switch required for standby generator systems.'}`,
                    color: 'teal',
                  } as any);
                }

                const colorMap: Record<string, string> = {
                  blue:    'bg-blue-500/10 border-blue-500/30 text-blue-400',
                  purple:  'bg-purple-500/10 border-purple-500/30 text-purple-400',
                  amber:   'bg-amber-500/10 border-amber-500/30 text-amber-400',
                  orange:  'bg-orange-500/10 border-orange-500/30 text-orange-400',
                  emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
                  teal:    'bg-teal-500/10 border-teal-500/30 text-teal-400',
                  red:     'bg-red-500/10 border-red-500/30 text-red-400',
                };

                return (
                  <>
                    {/* Calculation Steps */}
                    <div className="card overflow-hidden">
                      <div className="bg-slate-800/60 px-4 py-2 border-b border-slate-700/50">
                        <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wide">NEC Calculation Steps</h4>
                      </div>
                      <div className="divide-y divide-slate-700/40">
                        {steps.map(step => (
                          <div key={step.num} className="px-4 py-3 flex items-start gap-4">
                            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${colorMap[step.color]}`}>
                              {step.num}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-bold text-white">{step.title}</span>
                                <span className="text-xs font-mono text-slate-500">{step.nec}</span>
                              </div>
                              <div className="text-xs text-slate-400 font-mono mb-1">{step.formula}</div>
                              <div className="text-xs text-slate-500">{step.detail}</div>
                              {/* Quick-fix button: switch to supply-side tap when battery backfeed fails */}
                              {step.color === 'red' && step.title?.includes('Battery Backfeed') && config.interconnectionMethod !== 'SUPPLY_SIDE_TAP' && (
                                <button
                                  onClick={() => { updateConfig({ interconnectionMethod: 'SUPPLY_SIDE_TAP' }); setTimeout(runCalc, 100); }}
                                  className="mt-2 px-3 py-1.5 text-xs font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded-lg transition-colors"
                                >
                                  ⚡ Switch to Supply-Side Tap (NEC 705.11) — Fixes This
                                </button>
                              )}
                            </div>
                            <div className={`flex-shrink-0 text-sm font-bold px-3 py-1 rounded-lg border ${colorMap[step.color]}`}>
                              {step.result}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Component Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { label: 'OCPD', value: ac.ocpdLabel, sub: 'NEC 240.6', icon: <Shield size={16} className="text-amber-400" /> },
                        { label: 'AC Disconnect', value: ac.disconnectLabel, sub: 'NEC 690.14', icon: <Zap size={16} className="text-amber-400" /> },
                        {
                          label: 'Fuses',
                          value: ac.fuseLabel,
                          sub: ac.disconnectType === 'fused' ? 'NEC 690.9' : 'Non-Fused',
                          icon: ac.disconnectType === 'fused'
                            ? <AlertTriangle size={16} className="text-orange-400" />
                            : <CheckCircle size={16} className="text-slate-500" />,
                        },
                        { label: 'Conductor', value: ac.conductorLabel, sub: 'NEC 310.16', icon: <Activity size={16} className="text-emerald-400" /> },
                        { label: 'Conduit', value: ac.conduitLabel, sub: 'NEC Ch. 9', icon: <Layers size={16} className="text-teal-400" /> },
                        { label: 'Grounding', value: `${ac.groundingConductor} Copper`, sub: 'NEC 250.66', icon: <CheckCircle size={16} className="text-blue-400" /> },
                      ].map(card => (
                        <div key={card.label} className="card p-3">
                          <div className="flex items-center gap-2 mb-2">
                            {card.icon}
                            <span className="text-xs font-bold text-white">{card.label}</span>
                          </div>
                          <div className="text-sm font-bold text-white mb-0.5">{card.value}</div>
                          <div className="text-xs text-slate-500 font-mono">{card.sub}</div>
                        </div>
                      ))}
                    </div>

                    {/* BOM Preview */}
                    <div className="card overflow-hidden">
                      <div className="bg-slate-800/60 px-4 py-2 border-b border-slate-700/50">
                        <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-2">
                          <Package size={12} /> Electrical BOM — Auto-Generated
                        </h4>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-700/50">
                            <th className="text-left text-slate-400 px-4 py-2 font-semibold">Component</th>
                            <th className="text-left text-slate-400 px-4 py-2 font-semibold">Specification</th>
                            <th className="text-left text-slate-400 px-4 py-2 font-semibold">Qty</th>
                            <th className="text-left text-slate-400 px-4 py-2 font-semibold">NEC Ref</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/30">
                          <tr>
                            <td className="px-4 py-2 text-white font-medium">AC Disconnect Switch</td>
                            <td className="px-4 py-2 text-slate-300">{ac.disconnectAmps}A, 240V, {ac.disconnectType === 'fused' ? 'Fusible' : 'Non-Fusible'}</td>
                            <td className="px-4 py-2 text-white font-bold">1 ea</td>
                            <td className="px-4 py-2 text-slate-500 font-mono">NEC 690.14</td>
                          </tr>
                          {ac.disconnectType === 'fused' && (
                          <tr>
                            <td className="px-4 py-2 text-white font-medium">AC Fuse</td>
                            <td className="px-4 py-2 text-slate-300">{ac.fuseAmps}A, 250V, Class R</td>
                            <td className="px-4 py-2 text-white font-bold">{ac.fuseCount} ea</td>
                            <td className="px-4 py-2 text-slate-500 font-mono">NEC 690.9</td>
                          </tr>
                          )}
                          <tr>
                            <td className="px-4 py-2 text-white font-medium">AC Conductor</td>
                            <td className="px-4 py-2 text-slate-300">{ac.conductorGauge} THWN-2 Copper, 600V</td>
                            <td className="px-4 py-2 text-white font-bold">3 cond.</td>
                            <td className="px-4 py-2 text-slate-500 font-mono">NEC 310.16</td>
                          </tr>
                          <tr>
                            <td className="px-4 py-2 text-white font-medium">{ac.conduitType} Conduit</td>
                            <td className="px-4 py-2 text-slate-300">{ac.conduitSize}" {ac.conduitType}, {ac.conduitFillPct.toFixed(1)}% fill</td>
                            <td className="px-4 py-2 text-white font-bold">per plan</td>
                            <td className="px-4 py-2 text-slate-500 font-mono">NEC Ch. 9</td>
                          </tr>
                          <tr>
                            <td className="px-4 py-2 text-white font-medium">Grounding Conductor</td>
                            <td className="px-4 py-2 text-slate-300">{ac.groundingConductor} Bare Copper</td>
                            <td className="px-4 py-2 text-white font-bold">per plan</td>
                            <td className="px-4 py-2 text-slate-500 font-mono">NEC 250.66</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* DC String Configuration (NEC 690.7) -- hidden for microinverter topology */}
                    {compliance.stringConfig && config.inverters[0]?.type !== 'micro' && (
                      <div className="card overflow-hidden">
                        <div className="bg-slate-800/60 px-4 py-2 border-b border-slate-700/50">
                          <h4 className="text-xs font-bold text-green-400 uppercase tracking-wide flex items-center gap-2">
                            <Zap size={12} /> DC String Configuration — NEC 690.7
                            <span className={`ml-auto text-xs font-bold ${compliance.stringConfig.isValid ? 'text-green-400' : 'text-red-400'}`}>
                              {compliance.stringConfig.isValid ? '✓ VALID' : '⚠ ERRORS'}
                            </span>
                          </h4>
                        </div>
                        <div className="p-4 space-y-3">
                          {/* String sizing steps */}
                          <div className="space-y-2">
                            {[
                              { num: 1, title: 'Temperature Correction (NEC 690.7)', nec: 'NEC 690.7',
                                formula: `Voc × [1 + (${compliance.stringConfig.vocCorrected > 0 ? '-' : ''}tempCoeff/100 × (${compliance.stringConfig.designTempMin}°C − 25°C)]`,
                                result: `${compliance.stringConfig.vocCorrected.toFixed(2)} V/module`, color: 'blue' },
                              { num: 2, title: 'Max Panels per String', nec: 'NEC 690.7',
                                formula: `floor(${(compliance.electrical as any)?.inverters?.[0]?.maxDcVoltage || 600}V ÷ ${compliance.stringConfig.vocCorrected.toFixed(2)}V)`,
                                result: `${compliance.stringConfig.maxPanelsPerString} panels max`, color: 'purple' },
                              { num: 3, title: 'Min Panels per String', nec: 'NEC 690.7',
                                formula: `ceil(MPPT_min ÷ Vmp_corrected)`,
                                result: `${compliance.stringConfig.minPanelsPerString} panels min`, color: 'amber' },
                              { num: 4, title: 'String OCPD (NEC 690.8)', nec: 'NEC 690.8',
                                formula: `Isc × 1.25 × 1.25 = ${compliance.stringConfig.stringIsc.toFixed(2)}A × 1.5625 → next standard`,
                                result: `${compliance.stringConfig.ocpdPerString}A`, color: 'orange' },
                              { num: 5, title: 'DC Wire Ampacity', nec: 'NEC 690.8',
                                formula: `Isc × 1.25 = ${compliance.stringConfig.stringIsc.toFixed(2)}A × 1.25`,
                                result: `${compliance.stringConfig.dcWireAmpacity.toFixed(1)}A min`, color: 'emerald' },
                            ].map(step => {
                              const colorMap: Record<string, string> = {
                                blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                                purple: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
                                amber: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                                orange: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
                                emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
                              };
                              return (
                                <div key={step.num} className="flex items-start gap-3 py-2 border-b border-slate-700/30 last:border-0">
                                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${colorMap[step.color]}`}>
                                    {step.num}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-xs font-bold text-white">{step.title}</span>
                                      <span className="text-xs font-mono text-slate-500">{step.nec}</span>
                                    </div>
                                    <div className="text-xs text-slate-400 font-mono">{step.formula}</div>
                                  </div>
                                  <div className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded border ${colorMap[step.color]}`}>
                                    {step.result}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* String summary grid */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
                            {[
                              { label: 'Total Strings', value: `${compliance.stringConfig.totalStrings}` },
                              { label: 'Panels/String', value: `${compliance.stringConfig.panelsPerString}` },
                              { label: 'String Voc', value: `${compliance.stringConfig.stringVoc.toFixed(1)} V` },
                              { label: 'DC/AC Ratio', value: `${compliance.stringConfig.dcAcRatio.toFixed(2)}` },
                              { label: 'Combiner', value: compliance.stringConfig.combinerType },
                              { label: 'MPPT Channels', value: `${compliance.stringConfig.mpptChannels.length}` },
                              { label: 'OCPD/String', value: `${compliance.stringConfig.ocpdPerString}A` },
                              { label: 'DC Wire Min', value: `${compliance.stringConfig.dcWireAmpacity.toFixed(1)}A` },
                            ].map(item => (
                              <div key={item.label} className="bg-slate-800/50 rounded p-2 text-center">
                                <div className="text-xs font-bold text-white">{item.value}</div>
                                <div className="text-xs text-slate-500">{item.label}</div>
                              </div>
                            ))}
                          </div>
                          {/* DC BOM */}
                          <div className="pt-2 border-t border-slate-700/40">
                            <div className="text-xs font-bold text-slate-400 mb-2">DC Electrical BOM</div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-700/50">
                                  <th className="text-left text-slate-400 py-1 font-semibold">Component</th>
                                  <th className="text-left text-slate-400 py-1 font-semibold">Specification</th>
                                  <th className="text-left text-slate-400 py-1 font-semibold">Qty</th>
                                  <th className="text-left text-slate-400 py-1 font-semibold">NEC Ref</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-700/30">
                                <tr>
                                  <td className="py-1.5 text-white font-medium">String OCPD (Fuse)</td>
                                  <td className="py-1.5 text-slate-300">{compliance.stringConfig.ocpdPerString}A, 600VDC, Class CC</td>
                                  <td className="py-1.5 text-white font-bold">{compliance.stringConfig.totalStrings} ea</td>
                                  <td className="py-1.5 text-slate-500 font-mono">NEC 690.9</td>
                                </tr>
                                <tr>
                                  <td className="py-1.5 text-white font-medium">DC PV Wire</td>
                                  <td className="py-1.5 text-slate-300">Min {compliance.stringConfig.dcWireAmpacity.toFixed(0)}A ampacity, 600VDC PV Wire</td>
                                  <td className="py-1.5 text-white font-bold">per plan</td>
                                  <td className="py-1.5 text-slate-500 font-mono">NEC 690.31</td>
                                </tr>
                                {compliance.stringConfig.combinerType !== 'DIRECT' && (
                                  <tr>
                                    <td className="py-1.5 text-white font-medium">{compliance.stringConfig.combinerType === 'COMBINER_BOX' ? 'Combiner Box' : 'Junction Box'}</td>
                                    <td className="py-1.5 text-slate-300">{compliance.stringConfig.combinerLabel}</td>
                                    <td className="py-1.5 text-white font-bold">1 ea</td>
                                    <td className="py-1.5 text-slate-500 font-mono">NEC 690.31</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          {compliance.stringConfig.warnings.length > 0 && (
                            <div className="space-y-1 pt-2">
                              {compliance.stringConfig.warnings.map((w, i) => (
                                <div key={i} className="text-xs text-amber-400 bg-amber-500/10 rounded px-2 py-1">⚠ {w}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* NEC Code References */}
                    <div className="card p-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                        <Book size={12} /> NEC Code References
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {(ac.necRefs as string[]).map((ref: string) => (
                          <div key={ref} className="flex items-center gap-2 text-xs">
                            <CheckCircle size={11} className="text-emerald-400 flex-shrink-0" />
                            <span className="text-slate-300">{ref}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* ── STRUCTURAL TAB ── */}
          {activeTab === 'structural' && (
            <div className="max-w-4xl space-y-5">
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Wind size={14} className="text-amber-400" /> Site & Wind Parameters</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Design Wind Speed (mph)</label>
                    <input type="number" value={config.windSpeed} onChange={e => updateConfig({ windSpeed: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Wind Exposure Category</label>
                    <select value={config.windExposure} onChange={e => updateConfig({ windExposure: e.target.value as 'B' | 'C' | 'D' })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      <option value="B">B — Suburban/Wooded</option>
                      <option value="C">C — Open Terrain</option>
                      <option value="D">D — Coastal/Water</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Ground Snow Load (psf)</label>
                    <input type="number" value={config.groundSnowLoad} onChange={e => updateConfig({ groundSnowLoad: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Roof Pitch (degrees)</label>
                    <input type="number" min={0} max={60} value={config.roofPitch} onChange={e => updateConfig({ roofPitch: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                  </div>
                </div>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Ruler size={14} className="text-amber-400" /> Roof Framing</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Framing Type</label>
                    <select value={config.framingType} onChange={e => updateConfig({ framingType: e.target.value as 'truss' | 'rafter' | 'unknown' })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      <option value="unknown">Auto-Detect (24" OC = Truss)</option>
                      <option value="truss">Truss (Pre-Engineered)</option>
                      <option value="rafter">Rafter (Stick-Built)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Rafter Size</label>
                    <select value={config.rafterSize} onChange={e => updateConfig({ rafterSize: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {['2x4', '2x6', '2x8', '2x10', '2x12'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Rafter Spacing (in O.C.)</label>
                    <select value={config.rafterSpacing} onChange={e => updateConfig({ rafterSpacing: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {[12, 16, 19.2, 24].map(s => <option key={s} value={s}>{s}"</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Rafter Span (ft)</label>
                    <input type="number" min={4} max={30} value={config.rafterSpan} onChange={e => updateConfig({ rafterSpan: +e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Wood Species</label>
                    <select value={config.rafterSpecies} onChange={e => updateConfig({ rafterSpecies: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {['Douglas Fir-Larch', 'Southern Pine', 'Hem-Fir', 'Spruce-Pine-Fir'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Weight size={14} className="text-amber-400" /> Racking System</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Mount Brand</label>
                    <select
                      value={ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.manufacturer ?? MOUNTING_BRANDS[0]}
                      onChange={e => {
                        const first = ALL_MOUNTING_SYSTEMS.find(s => s.manufacturer === e.target.value);
                        if (first) updateConfig({ mountingId: first.id });
                      }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                    >
                      {MOUNTING_BRANDS.map(brand => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Mount Type / Model</label>
                    <select value={config.mountingId} onChange={e => updateConfig({ mountingId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {ALL_MOUNTING_SYSTEMS
                        .filter(s => s.manufacturer === (ALL_MOUNTING_SYSTEMS.find(x => x.id === config.mountingId)?.manufacturer ?? MOUNTING_BRANDS[0]))
                        .map(s => <option key={s.id} value={s.id}>{s.model}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Panel Orientation</label>
                    <select value={config.panelOrientation ?? 'portrait'} onChange={e => updateConfig({ panelOrientation: e.target.value as 'portrait' | 'landscape' })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
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
                <div className="card p-5">
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
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
                        {compliance.structural.errors?.length > 0 && <span className="ml-3 font-normal text-red-300">{compliance.structural.errors.map((e: any) => e.message).join(' | ')}</span>}
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
                            [{e.autoFixed ? 'AUTO-FIXED' : 'ERROR'}] {e.code}: {e.message}
                          </div>
                        ))}
                      </div>
                    )}
                    {compliance.structural?.errors?.length > 0 && (
                      <div className="bg-slate-900/60 rounded-lg p-3">
                        <div className="text-red-400 font-bold mb-2">── Structural Errors ──</div>
                        {compliance.structural.errors.map((e: any, i: number) => (
                          <div key={i} className={`text-xs mb-1 ${e.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
                            [{e.severity?.toUpperCase() ?? 'ERROR'}] {e.code}: {e.message}
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
                <div className="card p-5">
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
            <div className="max-w-5xl space-y-4">
              {/* Controls bar */}
              <div className="flex items-center justify-between">
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
                              // Interconnection — critical for correct SLD rendering
                              interconnection: config.interconnectionMethod ?? 'LOAD_SIDE',
                              interconnectionType: config.interconnectionMethod ?? 'LOAD_SIDE',
                              panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200,
                              // Topology & module data
                              topologyType: computedSystem.isMicro ? 'MICROINVERTER' : 'STRING_INVERTER',
                              totalModules: totalPanels,
                              totalStrings: computedSystem.isMicro ? 0 : (computedSystem.strings?.length ?? 1),
                              // Inverter data
                              inverterManufacturer: (() => { const inv = config.inverters[0]; const d = getInvById(inv?.inverterId, inv?.type) as any; return d?.manufacturer || (computedSystem.isMicro ? 'Enphase' : 'SolarEdge'); })(),
                              inverterModel: (() => { const inv = config.inverters[0]; const d = getInvById(inv?.inverterId, inv?.type) as any; return d?.model || (computedSystem.isMicro ? 'IQ8+' : 'SE7600H'); })(),
                              acOutputKw: Number(totalInverterKw),
                              acOutputAmps: Math.round(Number(totalInverterKw) * 1000 / 240),
                              acOCPD: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.ocpdAmps ?? Math.ceil(Math.round(Number(totalInverterKw) * 1000 / 240) * 1.25 / 5) * 5,
                              backfeedAmps: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.ocpdAmps ?? Math.ceil(Math.round(Number(totalInverterKw) * 1000 / 240) * 1.25 / 5) * 5,
                              // Panel data
                              panelModel: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.model || 'Solar Panel'; })(),
                              panelWatts: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.watts || 400; })(),
                              panelVoc: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.voc || 41.6; })(),
                              panelIsc: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.isc || 12.26; })(),
                              // Wire data from computedSystem
                              dcWireGauge: computedSystem.runs?.find((r: any) => r.id === 'DC_STRING_RUN')?.wireGauge ?? '#10 AWG',
                              acWireGauge: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.wireGauge ?? '#8 AWG',
                              acConduitType: config.conduitType ?? 'EMT',
                              dcConduitType: config.conduitType ?? 'EMT',
                              acWireLength: config.wireLength ?? 60,
                              // Micro-specific
                              deviceCount: computedSystem.isMicro ? totalPanels : undefined,
                              microBranches: computedSystem.isMicro ? computedSystem.microBranches : undefined,
                              branchWireGauge: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.wireGauge : undefined,
                              branchConduitSize: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.conduitSize : undefined,
                              branchOcpdAmps: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.ocpdAmps : undefined,
                              // ComputedSystem runs — single source of truth
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
                      {/* BUG 4 FIX: Zoom controls */}
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
                  {/* BUG 4 FIX: Zoomable/Pannable SVG container */}
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
                    <Activity size={12} /> Conductor &amp; Disconnect Callouts — NEC 705.60 · 310.16 · Ch.9
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

              {/* Auto-resolution summary (if any) */}
              {compliance.electrical?.autoResolutions?.length > 0 && (
                <div className="card p-4">
                  <h4 className="text-xs font-bold text-emerald-400 mb-3 flex items-center gap-2">
                    <CheckCircle size={12} /> Auto-Resolution Log ({compliance.electrical.autoResolutions.length} corrections applied)
                  </h4>
                  <div className="space-y-2">
                    {compliance.electrical.autoResolutions.map((res: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 text-xs p-2 bg-slate-800/40 rounded-lg">
                        <span className="text-emerald-400 font-mono flex-shrink-0 mt-0.5">✓</span>
                        <div className="flex-1">
                          <span className="text-white font-medium">{res.field}</span>
                          <span className="text-slate-500 mx-1">·</span>
                          <span className="text-slate-400">{res.originalValue} → </span>
                          <span className="text-emerald-400 font-bold">{res.resolvedValue}</span>
                          <span className="text-slate-500 ml-2 font-mono">[{res.necReference}]</span>
                        </div>
                        <span className="text-slate-600 text-xs flex-shrink-0">{res.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* ── EQUIPMENT SCHEDULE TAB ── */}
          {activeTab === 'schedule' && (
            <div className="max-w-4xl">
              <div className="bg-white rounded-2xl p-8 shadow-2xl text-slate-900">
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
              const panelW = 60; const panelH = 36; const gap = 6;
              const cols = Math.min(5, Math.ceil(Math.sqrt(totalPanels)));
              const rows = Math.min(3, Math.ceil(totalPanels / cols));
              const svgW = cols * (panelW + gap) + 80;
              const svgH = rows * (panelH + gap) + 60;
              const mountPositions: {x:number,y:number}[] = [];
              for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                  if (c % 2 === 0) mountPositions.push({ x: 40 + c * (panelW + gap), y: 20 + r * (panelH + gap) + panelH / 2 });
                }
              }
              return (
                <svg width={svgW} height={svgH} className="w-full" viewBox={`0 0 ${svgW} ${svgH}`}>
                  {/* Rail lines */}
                  {Array.from({length: rows}).map((_, r) => (
                    <line key={`rail-top-${r}`} x1={30} y1={20 + r*(panelH+gap) + 8} x2={svgW-10} y2={20 + r*(panelH+gap) + 8} stroke="#f59e0b" strokeWidth="2" strokeDasharray="4,2" opacity="0.6"/>
                  ))}
                  {Array.from({length: rows}).map((_, r) => (
                    <line key={`rail-bot-${r}`} x1={30} y1={20 + r*(panelH+gap) + panelH - 8} x2={svgW-10} y2={20 + r*(panelH+gap) + panelH - 8} stroke="#f59e0b" strokeWidth="2" strokeDasharray="4,2" opacity="0.6"/>
                  ))}
                  {/* Panels */}
                  {Array.from({length: rows}).map((_, r) =>
                    Array.from({length: cols}).map((_, c) => (
                      <rect key={`p-${r}-${c}`} x={40 + c*(panelW+gap)} y={20 + r*(panelH+gap)} width={panelW} height={panelH} rx={2} fill="#1e293b" stroke="#334155" strokeWidth="1"/>
                    ))
                  )}
                  {/* Mount points */}
                  {mountPositions.map((m, i) => (
                    <g key={`m-${i}`}>
                      <circle cx={m.x} cy={m.y} r={5} fill="#ef4444" stroke="#fca5a5" strokeWidth="1.5"/>
                      <line x1={m.x} y1={m.y - 5} x2={m.x} y2={m.y - 14} stroke="#ef4444" strokeWidth="1.5"/>
                    </g>
                  ))}
                  {/* Spacing annotation */}
                  {mountPositions.length >= 2 && (
                    <g>
                      <line x1={mountPositions[0].x} y1={svgH - 15} x2={mountPositions[1]?.x ?? mountPositions[0].x + 66} y2={svgH - 15} stroke="#64748b" strokeWidth="1" markerEnd="url(#arrow)"/>
                      <text x={(mountPositions[0].x + (mountPositions[1]?.x ?? mountPositions[0].x + 66)) / 2} y={svgH - 4} textAnchor="middle" fill="#94a3b8" fontSize="9">{mountSpacing}"</text>
                    </g>
                  )}
                  <defs>
                    <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill="#64748b"/>
                    </marker>
                  </defs>
                  {/* Legend */}
                  <g transform={`translate(10, ${svgH - 30})`}>
                    <rect x={0} y={0} width={10} height={8} fill="#1e293b" stroke="#334155"/>
                    <text x={14} y={8} fill="#94a3b8" fontSize="8">Panel</text>
                    <line x1={50} y1={4} x2={60} y2={4} stroke="#f59e0b" strokeWidth="2" strokeDasharray="3,2"/>
                    <text x={64} y={8} fill="#94a3b8" fontSize="8">Rail</text>
                    <circle cx={100} cy={4} r={4} fill="#ef4444"/>
                    <text x={107} y={8} fill="#94a3b8" fontSize="8">Mount</text>
                  </g>
                </svg>
              );
            };

            // Ballast layout SVG (commercial)
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
                <div className="card p-5">
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
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
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
                  <div className="card p-5">
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
                  <div className="card p-5">
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
                  <div className="card p-5">
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
                <div className="card p-5">
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
                <div className="card p-5">
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
          ) : (
            <div className="max-w-4xl space-y-5">
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Stamp size={14} className="text-amber-400" /> Permit Package Generator</h3>
                <p className="text-slate-400 text-sm mb-4">Generate a complete permit-ready documentation package for AHJ submission.</p>
                <div className="space-y-2 mb-5">
                  {[
                    { label: 'Cover Page', done: true },
                    { label: 'System Summary', done: true },
                    { label: 'NEC Compliance Sheet', done: !!compliance.electrical },
                    { label: 'Structural Calculation Sheet', done: !!compliance.structural },
                    { label: 'Equipment Schedule', done: totalPanels > 0 },
                    { label: 'Single-Line Diagram', done: true },
                    { label: 'Mounting Details', done: true },
                    { label: 'Site Information', done: !!config.address },
                    { label: 'Jurisdiction Requirements', done: !!compliance.jurisdiction },
                    { label: 'Engineer Certification Block', done: !!config.designer },
                  ].map((item, i) => (
                    <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg ${item.done ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-slate-800/40 border border-slate-700/50'}`}>
                      {item.done ? <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-600 flex-shrink-0" />}
                      <span className={`text-sm ${item.done ? 'text-white' : 'text-slate-500'}`}>{item.label}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={async () => {
                    const permitInput = {
                      project: {
                        projectName: config.projectName, clientName: config.clientName,
                        address: config.address, designer: config.designer, date: config.date,
                        notes: config.notes, systemType: config.systemType,
                        mainPanelAmps: config.mainPanelAmps, mainPanelBrand: config.mainPanelBrand,
                        utilityMeter: config.utilityMeter, acDisconnect: config.acDisconnect,
                        dcDisconnect: config.dcDisconnect, productionMeter: config.productionMeter,
                        rapidShutdown: config.rapidShutdown, conduitType: config.conduitType,
                        wireGauge: config.wireGauge, wireLength: config.wireLength,
                        batteryBrand: config.batteryBrand, batteryModel: config.batteryModel,
                        batteryCount: config.batteryCount, batteryKwh: config.batteryKwh,
                        batteryBackfeedA: calcBatteryBackfeedAmps(config.batteryId, config.batteryCount),
                        generatorBrand: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? ''; })() : undefined,
                        generatorKw: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? 0; })() : undefined,
                        atsBrand: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.manufacturer ?? ''; })() : undefined,
                        atsAmpRating: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? 0; })() : undefined,
                      },
                      system: {
                        totalDcKw: parseFloat(totalKw), totalAcKw: parseFloat(totalInverterKw),
                        totalPanels, dcAcRatio: parseFloat(totalKw) / (parseFloat(totalInverterKw) || 1),
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
                    };
                    const res = await fetch('/api/engineering/permit?format=pdf', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(permitInput),
                    });
                    if (res.ok) {
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `PermitPackage-${config.projectName || 'project'}.pdf`;
                      a.click(); URL.revokeObjectURL(url);
                    }
                  }}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  <Printer size={16} /> Generate & Download Permit Package (PDF)
                </button>
                <button
                  onClick={async () => {
                    const permitInput = {
                      project: {
                        projectName: config.projectName, clientName: config.clientName,
                        address: config.address, designer: config.designer, date: config.date,
                        notes: config.notes, systemType: config.systemType,
                        mainPanelAmps: config.mainPanelAmps, mainPanelBrand: config.mainPanelBrand,
                        utilityMeter: config.utilityMeter, acDisconnect: config.acDisconnect,
                        dcDisconnect: config.dcDisconnect, productionMeter: config.productionMeter,
                        rapidShutdown: config.rapidShutdown, conduitType: config.conduitType,
                        wireGauge: config.wireGauge, wireLength: config.wireLength,
                      },
                      system: {
                        totalDcKw: parseFloat(totalKw), totalAcKw: parseFloat(totalInverterKw),
                        totalPanels, dcAcRatio: parseFloat(totalKw) / (parseFloat(totalInverterKw) || 1),
                        topology: topologyType,
                        inverters: config.inverters.map(inv => {
                          const invData = getInvById(inv.inverterId, inv.type) as any;
                          return { manufacturer: invData?.manufacturer || '', model: invData?.model || '', type: inv.type, acOutputKw: invData?.acOutputKw || 0, maxDcVoltage: invData?.maxDcVoltage || 480, efficiency: invData?.efficiency || 97, ulListing: invData?.ulListing || 'UL 1741', strings: inv.strings.map(str => { const panel = getPanelById(str.panelId) as any; return { label: str.label, panelCount: str.panelCount, panelManufacturer: panel?.manufacturer || '', panelModel: panel?.model || '', panelWatts: panel?.watts || 400, panelVoc: panel?.voc || 41.6, panelIsc: panel?.isc || 12.26, wireGauge: str.wireGauge, wireLength: str.wireLength }; }) };
                        }),
                      },
                      compliance, rulesResult, bom, overrides,
                    };
                    const res = await fetch('/api/engineering/permit?format=html', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(permitInput),
                    });
                    if (res.ok) {
                      const html = await res.text();
                      const win = window.open('', '_blank');
                      if (win) { win.document.write(html); win.document.close(); }
                    }
                  }}
                  className="btn-secondary w-full flex items-center justify-center gap-2 mt-2"
                >
                  <Eye size={16} /> Preview in Browser
                </button>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Lock size={14} className="text-amber-400" /> Engineer Certification Block</h3>
                <div className="bg-white rounded-xl p-6 text-slate-900 border-2 border-slate-300">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Prepared By</div>
                      <div className="space-y-2">
                        <div className="border-b border-slate-300 pb-1"><div className="text-sm font-bold">{config.designer || '________________________________'}</div><div className="text-xs text-slate-500">Designer / Engineer of Record</div></div>
                        <div className="border-b border-slate-300 pb-1"><div className="text-sm">________________________________</div><div className="text-xs text-slate-500">License Number</div></div>
                        <div className="border-b border-slate-300 pb-1"><div className="text-sm">________________________________</div><div className="text-xs text-slate-500">State</div></div>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Wet Stamp Area</div>
                      <div className="border-2 border-dashed border-slate-300 rounded-xl h-28 flex items-center justify-center">
                        <div className="text-center text-slate-400"><Stamp size={24} className="mx-auto mb-1 opacity-30" /><div className="text-xs">Engineer Wet Stamp</div></div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-200 text-xs text-slate-500">
                    I hereby certify that this solar PV system design complies with NEC {compliance.jurisdiction?.necVersion || '2020'}, applicable local codes, and the requirements of the Authority Having Jurisdiction ({compliance.jurisdiction?.state || 'jurisdiction'}). Date: {config.date}
                  </div>
                </div>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Activity size={14} className="text-amber-400" /> Revision History</h3>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-slate-700"><th className="text-left text-slate-400 pb-2 font-semibold">Rev</th><th className="text-left text-slate-400 pb-2 font-semibold">Date</th><th className="text-left text-slate-400 pb-2 font-semibold">Description</th><th className="text-left text-slate-400 pb-2 font-semibold">By</th></tr></thead>
                  <tbody>
                    <tr className="border-b border-slate-800"><td className="py-2 text-white">A</td><td className="py-2 text-slate-300">{config.date}</td><td className="py-2 text-slate-300">Initial Issue</td><td className="py-2 text-slate-300">{config.designer || '—'}</td></tr>
                    <tr className="border-b border-slate-800"><td className="py-2 text-slate-600">B</td><td className="py-2 text-slate-600">—</td><td className="py-2 text-slate-600">—</td><td className="py-2 text-slate-600">—</td></tr>
                    <tr><td className="py-2 text-slate-600">C</td><td className="py-2 text-slate-600">—</td><td className="py-2 text-slate-600">—</td><td className="py-2 text-slate-600">—</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* ── BOM TAB ── */}
          {activeTab === 'bom' && (!canBOM ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4">
                <Lock size={28} className="text-purple-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-1">Bill of Materials</h3>
              <p className="text-slate-400 text-sm mb-4 max-w-sm">
                BOM export and detailed material lists require Professional plan or above.
              </p>
              <a href="/account/billing" className="btn-primary inline-flex gap-2">
                Upgrade to Professional
              </a>
            </div>
          ) : (
            <div className="max-w-5xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Grid size={14} className="text-amber-400" /> Bill of Materials
                    <span className="text-xs font-normal bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">Auto-Sourced</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Derived from roof type · racking system · inverter ecosystem · jurisdiction · conduit type</p>
                </div>
                <button onClick={fetchBOM} disabled={bomLoading} className="btn-primary btn-sm">
                  <RefreshCw size={14} className={bomLoading ? 'animate-spin' : ''} />
                  {bomLoading ? 'Generating...' : bom.length > 0 ? 'Regenerate BOM' : 'Generate BOM'}
                </button>
              </div>

              {bomError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                  <XCircle size={14} /> {bomError}
                </div>
              )}

              {!bom.length && !bomLoading && !bomError && (
                <div className="card p-12 text-center">
                  <Grid size={40} className="mx-auto mb-4 text-slate-600" />
                  <div className="text-sm font-bold text-white mb-1">Auto-Sourced BOM Ready</div>
                  <div className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                    Click "Generate BOM" to auto-derive all materials from your system configuration — mounting hardware, wire, conduit, disconnects, monitoring, grounding, and labels.
                  </div>
                  <button onClick={fetchBOM} className="btn-primary btn-sm mx-auto">
                    <Grid size={14} /> Generate BOM
                  </button>
                </div>
              )}

              {bomLoading && (
                <div className="card p-12 text-center">
                  <RefreshCw size={32} className="mx-auto mb-3 text-amber-400 animate-spin" />
                  <div className="text-sm text-slate-400">Deriving materials from system configuration...</div>
                </div>
              )}

              {bom.length > 0 && !bomLoading && (
                <>
                  {/* ── BOM SELF-CHECK VALIDATION BANNER ── */}
                  {(() => {
                    const totalPanelsBom = config.inverters.reduce((s, inv) => s + inv.strings.reduce((ss, st) => ss + st.panelCount, 0), 0);
                    const firstInvBom = config.inverters[0];
                    const isMicroBom = firstInvBom?.type === 'micro';

                    // Panel count check
                    const bomPanelItem = bom.find((i: any) => i.category === 'panels' || i.category === 'solar_panel');
                    const bomPanelQty = bomPanelItem?.quantity ?? 0;
                    const panelCheck = bomPanelQty === totalPanelsBom;

                    // Microinverter count check
                    let microCheck = true;
                    let expectedMicro = 0;
                    let bomMicroQty = 0;
                    if (isMicroBom) {
                      const invDataBomCheck = MICROINVERTERS.find(m => m.id === firstInvBom.inverterId);
                      const regMpdBomCheck = invDataBomCheck?.modulesPerDevice ?? 1;
                      const mpdBomCheck = firstInvBom.deviceRatioOverride ?? regMpdBomCheck;
                      expectedMicro = Math.ceil(totalPanelsBom / mpdBomCheck);
                      const microItem = bom.find((i: any) => i.category === 'microinverter');
                      bomMicroQty = microItem?.quantity ?? 0;
                      microCheck = bomMicroQty === expectedMicro;
                    }

                    // String inverter count check
                    let stringInvCheck = true;
                    let expectedStringInv = 0;
                    let bomStringInvQty = 0;
                    if (!isMicroBom) {
                      expectedStringInv = config.inverters.length;
                      const invItem = bom.find((i: any) => i.category === 'string_inverter' || i.category === 'inverter');
                      bomStringInvQty = invItem?.quantity ?? 0;
                      stringInvCheck = bomStringInvQty === expectedStringInv;
                    }

                    const allPass = panelCheck && microCheck && stringInvCheck;
                    const checks = [
                      { label: 'Panel Count', expected: totalPanelsBom, actual: bomPanelQty, pass: panelCheck },
                      ...(isMicroBom ? [{ label: 'Microinverter Count', expected: expectedMicro, actual: bomMicroQty, pass: microCheck }] : []),
                      ...(!isMicroBom ? [{ label: 'String Inverter Count', expected: expectedStringInv, actual: bomStringInvQty, pass: stringInvCheck }] : []),
                    ];

                    return (
                      <div className={`rounded-xl border px-4 py-3 ${allPass ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          {allPass
                            ? <CheckCircle size={14} className="text-emerald-400" />
                            : <XCircle size={14} className="text-red-400" />}
                          <span className={`text-xs font-bold ${allPass ? 'text-emerald-400' : 'text-red-400'}`}>
                            BOM Self-Check {allPass ? '✓ PASS' : '✗ FAIL'} — {checks.filter(c => c.pass).length}/{checks.length} checks passed
                          </span>
                          <span className="text-xs text-slate-500 ml-auto italic">Validates BOM quantities against system config</span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {checks.map(chk => (
                            <div key={chk.label} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${chk.pass ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                              {chk.pass ? <CheckCircle size={11} /> : <XCircle size={11} />}
                              <span className="font-medium">{chk.label}:</span>
                              <span className="font-mono font-bold">{chk.actual}</span>
                              {!chk.pass && <span className="text-slate-400">(expected {chk.expected})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* BOM Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(() => {
                      const firstInvSumm = config.inverters[0];
                      const isMicroSumm = firstInvSumm?.type === 'micro';
                      const microItem = bom.find((i: any) => i.category === 'microinverter');
                      const strInvItem = bom.find((i: any) => i.category === 'string_inverter' || i.category === 'inverter');
                      const invQty = isMicroSumm ? (microItem?.quantity ?? 0) : (strInvItem?.quantity ?? 0);
                      const invLabel = isMicroSumm ? 'Microinverters' : 'Inverters';
                      return [
                        { label: 'Total Line Items', value: bom.length },
                        { label: 'Categories', value: [...new Set(bom.map((i: any) => i.category))].length },
                        { label: 'Total Panels', value: bom.find((i: any) => i.category === 'panels' || i.category === 'solar_panel')?.quantity ?? 0 },
                        { label: invLabel, value: invQty },
                      ];
                    })().map(item => (
                      <div key={item.label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                        <div className="text-sm font-bold text-white">{item.value}</div>
                        <div className="text-xs text-slate-500">{item.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* ── ComputedSystem Wire & Conduit Quantities ── */}
                  <div className="bg-slate-800/60 border border-amber-500/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap size={13} className="text-amber-400" />
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">Wire &amp; Conduit Quantities</span>
                      <span className="text-xs text-slate-500 ml-1">Auto-calculated from ComputedSystem runs (NEC Ch.9 · 15% waste factor)</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      {[
                        { label: '#10 AWG Wire', value: `${cs.bomQuantities.wire10AWG} ft`, show: cs.bomQuantities.wire10AWG > 0 },
                        { label: '#8 AWG Wire', value: `${cs.bomQuantities.wire8AWG} ft`, show: cs.bomQuantities.wire8AWG > 0 },
                        { label: '#6 AWG Wire', value: `${cs.bomQuantities.wire6AWG} ft`, show: cs.bomQuantities.wire6AWG > 0 },
                        { label: '#4 AWG Wire', value: `${cs.bomQuantities.wire4AWG} ft`, show: cs.bomQuantities.wire4AWG > 0 },
                        { label: 'EMT Conduit', value: `${cs.bomQuantities.conduitEMT} ft`, show: cs.bomQuantities.conduitEMT > 0 },
                        { label: 'PVC Conduit', value: `${cs.bomQuantities.conduitPVC} ft`, show: cs.bomQuantities.conduitPVC > 0 },
                        { label: cs.isMicro ? 'Microinverters' : 'String Inverters', value: cs.bomQuantities.inverters, show: true },
                        { label: cs.isMicro ? 'AC Combiner' : 'DC Disconnect', value: cs.isMicro ? cs.bomQuantities.acCombiner : cs.bomQuantities.dcDisconnect, show: true },
                      ].filter(i => i.show).map(item => (
                        <div key={item.label} className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                          <div className="text-sm font-bold text-white">{item.value}</div>
                          <div className="text-xs text-slate-500">{item.label}</div>
                        </div>
                      ))}
                    </div>
                    {cs.isMicro && (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2.5 text-center">
                          <div className="text-sm font-bold text-purple-300">{cs.bomQuantities.trunkCable} ft</div>
                          <div className="text-xs text-slate-500">AC Trunk Cable</div>
                        </div>
                        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2.5 text-center">
                          <div className="text-sm font-bold text-purple-300">{cs.bomQuantities.trunkCableTerminators}</div>
                          <div className="text-xs text-slate-500">Trunk Terminators</div>
                        </div>
                        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2.5 text-center">
                          <div className="text-sm font-bold text-purple-300">{cs.bomQuantities.acBranchOcpd}</div>
                          <div className="text-xs text-slate-500">Branch OCPDs</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Racking Materials (from Structural V3 Engine) */}
                  {compliance.structural?.rackingBOM && (
                    <div className="bg-slate-800/60 border border-amber-500/20 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Wrench size={13} className="text-amber-400" />
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">Racking Materials</span>
                        <span className="text-xs text-slate-500 ml-1">Derived from array geometry · ASCE 7-22 loads · {ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.manufacturer ?? 'Racking'} system</span>
                        {compliance.structural.mountLayout && (
                          <span className="ml-auto text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                            {compliance.structural.mountLayout.mountSpacingIn ?? compliance.structural.mountLayout.finalSpacingIn}"  O.C. calculated
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
                        {/* Mount spacing highlight */}
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 text-center">
                          <div className="text-base font-bold text-amber-300">{compliance.structural.mountLayout?.mountSpacingIn ?? compliance.structural.mountLayout?.finalSpacingIn ?? '—'}"</div>
                          <div className="text-xs text-slate-400">Mount Spacing</div>
                          <div className="text-xs text-slate-600">ASCE 7-22 calc</div>
                        </div>
                        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                          <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.mounts?.qty ?? '—'}</div>
                          <div className="text-xs text-slate-400">Roof Mounts</div>
                          <div className="text-xs text-slate-600 truncate">{compliance.structural.rackingBOM.mounts?.partNumber}</div>
                        </div>
                        {(compliance.structural.rackingBOM.rails?.qty ?? 0) > 0 && (
                          <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                            <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.rails.qty} × {compliance.structural.rackingBOM.rails.lengthFt?.toFixed(1)}ft</div>
                            <div className="text-xs text-slate-400">Rails</div>
                            <div className="text-xs text-slate-600 truncate">{compliance.structural.rackingBOM.rails.partNumber}</div>
                          </div>
                        )}
                        {(compliance.structural.rackingBOM.lFeet?.qty ?? 0) > 0 && (
                          <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                            <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.lFeet.qty}</div>
                            <div className="text-xs text-slate-400">L-Feet</div>
                            <div className="text-xs text-slate-600 truncate">{compliance.structural.rackingBOM.lFeet.partNumber}</div>
                          </div>
                        )}
                        {(compliance.structural.rackingBOM.railSplices?.qty ?? 0) > 0 && (
                          <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                            <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.railSplices.qty}</div>
                            <div className="text-xs text-slate-400">Rail Splices</div>
                            <div className="text-xs text-slate-600 truncate">{compliance.structural.rackingBOM.railSplices.partNumber}</div>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                          <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.midClamps?.qty ?? '—'}</div>
                          <div className="text-xs text-slate-400">Mid Clamps</div>
                        </div>
                        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                          <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.endClamps?.qty ?? '—'}</div>
                          <div className="text-xs text-slate-400">End Clamps</div>
                        </div>
                        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                          <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.groundLugs?.qty ?? '—'}</div>
                          <div className="text-xs text-slate-400">Ground Lugs</div>
                        </div>
                        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                          <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.lagBolts?.qty ?? '—'}</div>
                          <div className="text-xs text-slate-400">Lag Bolts</div>
                        </div>
                        <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                          <div className="text-base font-bold text-white">{compliance.structural.rackingBOM.bondingClips?.qty ?? '—'}</div>
                          <div className="text-xs text-slate-400">Bonding Clips</div>
                        </div>
                      </div>
                      {/* Array geometry summary */}
                      {compliance.structural.arrayGeometry && (
                        <div className="mt-3 pt-3 border-t border-slate-700/50 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-400">
                          <div>Array: <span className="text-white">{compliance.structural.arrayGeometry.colCount}×{compliance.structural.arrayGeometry.rowCount} ({compliance.structural.arrayGeometry.totalPanels} panels)</span></div>
                          <div>Width: <span className="text-white">{(compliance.structural.arrayGeometry.arrayWidthIn/12).toFixed(1)} ft</span></div>
                          <div>Height: <span className="text-white">{(compliance.structural.arrayGeometry.arrayHeightIn/12).toFixed(1)} ft</span></div>
                          <div>Rail Length: <span className="text-white">{compliance.structural.arrayGeometry.railLengthFt?.toFixed(1)} ft ea</span></div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* BOM Table by Category */}
                  {([...new Set(bom.map((i: any) => i.category))] as string[]).map(cat => (
                    <div key={cat} className="card overflow-hidden">
                      <div className="bg-slate-800/60 px-4 py-2 border-b border-slate-700/50">
                        <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wide">
                          {cat.replace(/_/g, ' ')}
                        </h4>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-700/50">
                              <th className="text-left text-slate-400 px-4 py-2 font-semibold">Manufacturer</th>
                              <th className="text-left text-slate-400 px-4 py-2 font-semibold">Model / Description</th>
                              <th className="text-left text-slate-400 px-4 py-2 font-semibold">Part #</th>
                              <th className="text-right text-slate-400 px-4 py-2 font-semibold">Qty</th>
                              <th className="text-left text-slate-400 px-4 py-2 font-semibold">Unit</th>
                              <th className="text-left text-slate-400 px-4 py-2 font-semibold">Derived From</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bom.filter((i: any) => i.category === cat).map((item: any) => (
                              <tr key={item.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                                <td className="px-4 py-2 text-slate-300">{item.manufacturer}</td>
                                <td className="px-4 py-2 text-white font-medium">{item.model}</td>
                                <td className="px-4 py-2 text-slate-500 font-mono">{item.partNumber}</td>
                                <td className="px-4 py-2 text-amber-400 font-bold text-right">{item.quantity}</td>
                                <td className="px-4 py-2 text-slate-400">{item.unit}</td>
                                <td className="px-4 py-2 text-slate-600 text-xs">{item.derivedFrom}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}

                  {/* Electrical Components BOM Section (auto-calculated) */}
                  {(compliance.electrical as any)?.acSizing && (() => {
                    const ac = (compliance.electrical as any).acSizing;
                    return (
                      <div className="card overflow-hidden">
                        <div className="bg-amber-500/10 px-4 py-2 border-b border-amber-500/30">
                          <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-2">
                            <Zap size={12} /> Electrical Components — Auto-Calculated (NEC 705.60 · 310.16)
                          </h4>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-700/50">
                                <th className="text-left text-slate-400 px-4 py-2 font-semibold">Component</th>
                                <th className="text-left text-slate-400 px-4 py-2 font-semibold">Specification</th>
                                <th className="text-right text-slate-400 px-4 py-2 font-semibold">Qty</th>
                                <th className="text-left text-slate-400 px-4 py-2 font-semibold">Unit</th>
                                <th className="text-left text-slate-400 px-4 py-2 font-semibold">NEC Ref</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/30">
                              <tr>
                                <td className="px-4 py-2 text-white font-medium">AC Disconnect Switch</td>
                                <td className="px-4 py-2 text-slate-300">{ac.disconnectAmps}A, 240V, {ac.disconnectType === 'fused' ? 'Fusible' : 'Non-Fusible'}</td>
                                <td className="px-4 py-2 text-white font-bold text-right">1</td>
                                <td className="px-4 py-2 text-slate-400">ea</td>
                                <td className="px-4 py-2 text-slate-500 font-mono">NEC 690.14</td>
                              </tr>
                              {ac.disconnectType === 'fused' && (
                              <tr>
                                <td className="px-4 py-2 text-white font-medium">AC Fuse</td>
                                <td className="px-4 py-2 text-slate-300">{ac.fuseAmps}A, 250V, Class R</td>
                                <td className="px-4 py-2 text-white font-bold text-right">{ac.fuseCount}</td>
                                <td className="px-4 py-2 text-slate-400">ea</td>
                                <td className="px-4 py-2 text-slate-500 font-mono">NEC 690.9</td>
                              </tr>
                              )}
                              <tr>
                                <td className="px-4 py-2 text-white font-medium">AC Conductor (THWN-2)</td>
                                <td className="px-4 py-2 text-slate-300">{ac.conductorGauge} THWN-2 Copper, 600V, {ac.conductorAmpacity}A</td>
                                <td className="px-4 py-2 text-white font-bold text-right">3</td>
                                <td className="px-4 py-2 text-slate-400">cond.</td>
                                <td className="px-4 py-2 text-slate-500 font-mono">NEC 310.16</td>
                              </tr>
                              <tr>
                                <td className="px-4 py-2 text-white font-medium">{ac.conduitType} Conduit</td>
                                <td className="px-4 py-2 text-slate-300">{ac.conduitSize}" {ac.conduitType}, {ac.conduitFillPct.toFixed(1)}% fill</td>
                                <td className="px-4 py-2 text-white font-bold text-right">—</td>
                                <td className="px-4 py-2 text-slate-400">per plan</td>
                                <td className="px-4 py-2 text-slate-500 font-mono">NEC Ch. 9</td>
                              </tr>
                              <tr>
                                <td className="px-4 py-2 text-white font-medium">Grounding Conductor</td>
                                <td className="px-4 py-2 text-slate-300">{ac.groundingConductor} Bare Copper</td>
                                <td className="px-4 py-2 text-white font-bold text-right">—</td>
                                <td className="px-4 py-2 text-slate-400">per plan</td>
                                <td className="px-4 py-2 text-slate-500 font-mono">NEC 250.66</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Export BOM */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const csvHeader = 'Manufacturer,Model,Part Number,Quantity,Unit,Category,Derived From';
                        const csvRows = bom.map((i: any) => [
                          i.manufacturer, i.model, i.partNumber, i.quantity, i.unit, i.category, i.derivedFrom
                        ].map((v: any) => JSON.stringify(String(v ?? ''))).join(','));
                        const csv = [csvHeader, ...csvRows].join('\r\n');
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `BOM-${config.projectName || 'project'}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="btn-secondary btn-sm"
                    >
                      <Download size={14} /> Export CSV
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

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

                {/* Row 7: Generate Full Permit Package */}
                <button
                  onClick={handleGeneratePermitPackage}
                  disabled={permitLoading || calculating || sldLoading || bomLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-amber-500/15 to-orange-500/15 border border-amber-500/40 text-amber-300 hover:from-amber-500/25 hover:to-orange-500/25 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                >
                  <Stamp size={12} className={permitLoading ? 'animate-spin' : ''} />
                  <span className="flex-1 text-left">{permitLoading ? 'Building Package…' : 'Generate Full Permit Package'}</span>
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