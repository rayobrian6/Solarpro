'use client';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type {
  Project, Layout, PlacedPanel, SolarPanel, Inverter, Battery,
  SystemType, DrawingMode, RoofPlane, BillAnalysis, BatteryRecommendation,
  DesignElectrical
} from '@/types';
import { generateFenceLayout, calculateSystemSize, polygonAreaM2 } from '@/lib/panelLayout';
import { generateRoofLayoutOptimized, generateGroundLayoutOptimized, clearGridCache } from '@/lib/panelLayoutOptimized';
import { assignStrings, type Topology } from '@/lib/stringAssignment';
import {
  RACKING_SYSTEMS, OPTIMIZERS, MICROINVERTERS,
  getMidClampGapMeters, getMidClampGapInches,
} from '@/lib/equipment-db';
import { enrichRoofPlaneWithLECS, longestEdgeBearing } from '@/lib/roofGeometry';
import { enrichRoofPlaneWith3DFrame } from '@/lib/surfaceGeometry3D';
// v50.11: POA calculation + segment labels
import { ghiToPoa, poaQualityLabel, segmentLabel } from '@/lib/poaCalc';
import {
  FEET_PER_METER, METERS_PER_FOOT,
  STANDARD_PANEL_WIDTH_FEET, STANDARD_PANEL_HEIGHT_FEET,
} from '@/lib/localProjection';
import {
  type PanelOrientation,
  type FireSetbackConfig,
  type SetbackZone,
  DEFAULT_FIRE_SETBACKS,
  generateSetbackZones,
  calcEffectiveSetback,
  getPerEdgeSetbacks,
  generateMultipleRows,
  calcMinRowSpacing,
} from '@/lib/placementEngine';
import { getAhjByAddress } from '@/lib/jurisdictions/ahj-national';
// Phase 2: Compute & Recommend — provenance-aware form fields
import { ComputedField, type ComputedFieldValue } from '@/components/recommend/ComputedField';
import { ConfidenceBadge, type ConfidenceSource } from '@/components/recommend/ConfidenceBadge';
import { RecommendationCard, type RecommendationValue } from '@/components/recommend/RecommendationCard';
// Phase 2I: PVWatts-quality local production calc for reactive quick estimate
import { calculateProductionLocal } from '@/lib/pvwatts';
import { v4 as uuidv4 } from 'uuid';
import SolarEngine3D, { type PlacementMode } from '../3d/SolarEngine3D';
import { useToast } from '@/components/ui/Toast';
import { localSaveLayout } from '@/lib/clientStorage';
import { SaveStatusBar } from '@/components/ui/SaveStatusBar';
import {
  Layers, Zap, Sun, RotateCcw, Save, Play, ChevronDown, ChevronUp,
  CheckCircle, Loader, Settings, DollarSign, Battery as BatteryIcon,
  FileText, ArrowRight, MousePointer2, Home, Square, Minus, Ruler,
  Trash2, CheckSquare, Fence, Plus, Minus as MinusIcon, Search,
  TrendingUp, Leaf, BarChart2, AlertCircle, X, Upload, Calculator,
  Info, ChevronRight, Eye, EyeOff, Bug
} from 'lucide-react';
import FeedbackModal from '@/components/ui/FeedbackModal';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Props {
  project: Project;
  onSave?: (layout: Layout) => void;
}

type SolarE2EState = {
  roofPlanes: RoofPlane[];
  panels: PlacedPanel[];
  stitchedCorners: Array<{ id: string; vertices: Array<{ lat: number; lng: number }> }>;
  setbackInsets: number;
  fullRebuildCount: number;
};

declare global {
  interface Window {
    __solarE2E?: SolarE2EState;
  }
}

const E2E_ENABLED = process.env.NEXT_PUBLIC_E2E === '1';

const TILE_SIZE = 256;

// ─── Module-level tile cache (survives re-renders, cleared on location/provider change) ─
// Keyed as "zoom/x/y" → loaded HTMLImageElement. Module-level means tiles fetched
// during one pan are instantly available on the next without re-fetching from network.
const TILE_CACHE: Map<string, HTMLImageElement> = new Map();
const TILE_INFLIGHT: Set<string> = new Set();  // prevents duplicate in-flight requests
const TILE_CACHE_MAX = 512;                    // LRU eviction above this count

function evictTileCache() {
  if (TILE_CACHE.size <= TILE_CACHE_MAX) return;
  const toDelete = TILE_CACHE.size - TILE_CACHE_MAX;
  let deleted = 0;
  for (const key of TILE_CACHE.keys()) {
    TILE_CACHE.delete(key);
    TILE_INFLIGHT.delete(key);
    if (++deleted >= toDelete) break;
  }
}

// ─── Utility: lat/lng ↔ world/canvas ─────────────────────────
function latLngToWorld(lat: number, lng: number, zoom: number) {
  const scale = Math.pow(2, zoom);
  const x = (lng + 180) / 360 * scale * TILE_SIZE;
  const sinLat = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale * TILE_SIZE;
  return { x, y };
}
function worldToLatLng(wx: number, wy: number, zoom: number) {
  const scale = Math.pow(2, zoom);
  const lng = wx / (scale * TILE_SIZE) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * wy / (scale * TILE_SIZE);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}
function latLngToCanvas(lat: number, lng: number, mapCenter: { lat: number; lng: number }, zoom: number, canvasW: number, canvasH: number) {
  const center = latLngToWorld(mapCenter.lat, mapCenter.lng, zoom);
  const point = latLngToWorld(lat, lng, zoom);
  return { x: canvasW / 2 + (point.x - center.x), y: canvasH / 2 + (point.y - center.y) };
}
function canvasToLatLng(cx: number, cy: number, mapCenter: { lat: number; lng: number }, zoom: number, canvasW: number, canvasH: number) {
  const center = latLngToWorld(mapCenter.lat, mapCenter.lng, zoom);
  return worldToLatLng(center.x + (cx - canvasW / 2), center.y + (cy - canvasH / 2), zoom);
}
function metersPerPixel(lat: number, zoom: number) {
  const scale = Math.pow(2, zoom);
  const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);
  return (metersPerDegLng * 360) / (scale * TILE_SIZE);
}

// ─── Sidebar Section ──────────────────────────────────────────
function Section({ title, icon, children, defaultOpen = true, badge }: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
  defaultOpen?: boolean; badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-700/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-wide">
          {icon}{title}
          {badge ? <span className="ml-1 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs normal-case font-normal">{badge}</span> : null}
        </div>
        {open ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
      </button>
      {open ? <div className="px-4 pb-4 space-y-3">{children}</div> : null}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs text-slate-400">{label}</label>
        <span className="text-xs font-semibold text-white">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
      />
    </div>
  );
}

const AZIMUTH_LABELS: Record<number, string> = {
  0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW', 360: 'N'
};

/**
 * v50.25: Map FireSetbackConfig → generateRoofLayoutOptimized per-edge param keys.
 * getPerEdgeSetbacks() returns {eaveM, ridgeM, sideM} (used by controlLayer/planeEngine).
 * generateRoofLayoutOptimized() expects {eaveSetbackM, ridgeSetbackM, sideSetbackM}.
 * This bridge fixes the silent key mismatch that was dropping all per-edge setbacks.
 */
function toLayoutSetbacks(config: import('@/lib/placementEngine').FireSetbackConfig) {
  return {
    eaveSetbackM:  config.eaveSetbackM  ?? 0,
    ridgeSetbackM: config.ridgeSetbackM ?? 0.457,
    sideSetbackM:  config.edgeSetbackM  ?? 0.457,
  };
}
function azimuthLabel(az: number) {
  const nearest = Object.keys(AZIMUTH_LABELS).map(Number).reduce((a, b) => Math.abs(b - az) < Math.abs(a - az) ? b : a);
  return AZIMUTH_LABELS[nearest];
}

// ── Bill Analysis Calculator ────────────────────────────────────────────
// QW-4/QW-6: Simplified — no mode selector. Annual kWh is auto-computed
// from client data (bill OCR or entered consumption). The user sees the
// computed value and can override it. Offset defaults to 100% (QW-5).
function BillCalculator({ onAnalysis, project }: {
  onAnalysis: (analysis: BillAnalysis) => void;
  project: Project;
}) {
  // ── Phase 2B: Determine annual kWh source + confidence ──
  // Priority: bill OCR (12-mo history) > bill OCR (annual) > client data > bill-derived > estimate
  const kwhSource = useMemo<{ value: number; source: ConfidenceSource; confidence: 'high' | 'medium' | 'low'; derivation: string }>(() => {
    const bd = project.billData as Record<string, unknown> | undefined;
    const monthlyHistory = bd?.monthlyUsageHistory as number[] | undefined;
    const billAnnualKwh = bd?.estimatedAnnualKwh as number | undefined;
    const billMonthlyKwh = bd?.monthlyKwh as number | undefined;
    const clientMonthly = project.client?.monthlyKwh;

    // Best: 12+ months of actual bill history from OCR
    if (monthlyHistory && monthlyHistory.length >= 12) {
      return {
        value: monthlyHistory.reduce((a, b) => a + b, 0),
        source: 'bill-ocr',
        confidence: 'high',
        derivation: `${monthlyHistory.length} months of usage history from bill OCR`,
      };
    }
    // Good: bill OCR annual kWh (may be from fewer months, extrapolated)
    if (billAnnualKwh && billAnnualKwh > 0) {
      const months = monthlyHistory?.length ?? 1;
      return {
        value: billAnnualKwh,
        source: 'bill-ocr',
        confidence: monthlyHistory && monthlyHistory.length >= 6 ? 'medium' : 'low',
        derivation: `Annual kWh from bill OCR${months > 1 ? ` (${months} months extrapolated)` : ''}`,
      };
    }
    // Good: client monthly data (12 months = high, else medium)
    if (clientMonthly && clientMonthly.length === 12) {
      return {
        value: clientMonthly.reduce((a, b) => a + b, 0),
        source: 'user',
        confidence: 'high',
        derivation: '12 months of client consumption data',
      };
    }
    // Medium: client annual kWh or bill-derived estimate
    const clientAnnual = project.client?.annualKwh;
    if (clientAnnual && clientAnnual > 0) {
      return {
        value: clientAnnual,
        source: 'user',
        confidence: 'medium',
        derivation: 'Annual kWh from client profile',
      };
    }
    // Low: bill monthly × 12
    if (billMonthlyKwh && billMonthlyKwh > 0) {
      return {
        value: billMonthlyKwh * 12,
        source: 'bill-ocr',
        confidence: 'low',
        derivation: 'Single monthly reading × 12 (consider uploading full bill history)',
      };
    }
    // Fallback: estimate from average bill
    const avgBill = project.client?.averageMonthlyBill || 180;
    return {
      value: Math.round(avgBill / 0.15 * 12),
      source: 'state-avg',
      confidence: 'low',
      derivation: 'Estimated from average monthly bill / state rate. Upload a bill for accuracy.',
    };
  }, [project.billData, project.client?.monthlyKwh, project.client?.annualKwh, project.client?.averageMonthlyBill]);

  // ── Phase 2C: Determine utility rate source + confidence ──
  const rateSource = useMemo<{ value: number; source: ConfidenceSource; confidence: 'high' | 'medium' | 'low'; derivation: string }>(() => {
    const bd = project.billData as Record<string, unknown> | undefined;
    const billRate = bd?.electricityRate as number | undefined;
    const dbRate = project.utilityRatePerKwh;

    // Best: extracted from bill OCR
    if (billRate && billRate > 0 && billRate !== 0.13) {
      return {
        value: billRate,
        source: 'bill-ocr',
        confidence: 'high',
        derivation: 'Rate extracted from uploaded utility bill',
      };
    }
    // Good: from utility DB (detected from address)
    if (dbRate && dbRate > 0) {
      return {
        value: dbRate,
        source: 'utility-db',
        confidence: 'medium',
        derivation: `Average rate for ${project.utilityName || 'detected utility'}`,
      };
    }
    // Low: client-entered rate
    const clientRate = project.client?.utilityRate;
    if (clientRate && clientRate > 0) {
      return {
        value: clientRate,
        source: 'user',
        confidence: 'medium',
        derivation: 'Rate from client profile',
      };
    }
    // Fallback: state average
    return {
      value: 0.15,
      source: 'state-avg',
      confidence: 'low',
      derivation: 'National average rate. Upload a bill or set utility for accuracy.',
    };
  }, [project.billData, project.utilityRatePerKwh, project.utilityName, project.client?.utilityRate]);

  const [annualKwh, setAnnualKwh] = useState(kwhSource.value);
  const [utilityRate, setUtilityRate] = useState(rateSource.value);
  const [offsetTarget, setOffsetTarget] = useState(100); // QW-5: default 100%
  const [wantBattery, setWantBattery] = useState(false);

  // Phase 2B: ComputedFieldValue descriptors for ComputedField rendering
  const annualKwhComputed: ComputedFieldValue = {
    value: kwhSource.value,
    confidence: kwhSource.confidence,
    source: kwhSource.source,
    derivation: kwhSource.derivation,
    unit: 'kWh/yr',
  };
  const utilityRateComputed: ComputedFieldValue = {
    value: rateSource.value,
    confidence: rateSource.confidence,
    source: rateSource.source,
    derivation: rateSource.derivation,
    unit: '$/kWh',
  };

  // QW-4: Auto-compute whenever inputs change (reactive, no button needed)
  const calculate = useCallback(() => {
    const rate = utilityRate;
    const avg = annualKwh / 12;
    const seasonal = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87];
    const kwh12 = Array(12).fill(0).map((_, i) => Math.round(avg * seasonal[i]));

    const totalKwh = kwh12.reduce((a, b) => a + b, 0);
    const avgMonthly = totalKwh / 12;
    const peakMonth = kwh12.indexOf(Math.max(...kwh12));
    const peakKwh = kwh12[peakMonth];

    // System size: account for losses (~14%), offset target
    const systemKw = (totalKwh * (offsetTarget / 100)) / (1400);
    const panelCount = Math.ceil((systemKw * 1000) / 400);

    let batteryRec: BatteryRecommendation | undefined;
    if (wantBattery) {
      const dailyKwh = totalKwh / 365;
      const nighttimeKwh = dailyKwh * 0.4;
      const recCapacity = Math.ceil(nighttimeKwh * 1.2);
      batteryRec = {
        recommended: true,
        reason: 'Based on your usage pattern, battery storage will cover nighttime usage and provide backup power.',
        dailyUsageKwh: Math.round(dailyKwh * 10) / 10,
        nighttimeUsageKwh: Math.round(nighttimeKwh * 10) / 10,
        recommendedCapacityKwh: recCapacity,
        recommendedUnits: Math.ceil(recCapacity / 13.5),
        suggestedBatteries: [],
        backupHours: Math.round((recCapacity / (dailyKwh / 24)) * 10) / 10,
        selfConsumptionRate: 85,
      };
    }

    onAnalysis({
      monthlyKwh: kwh12,
      annualKwh: totalKwh,
      averageMonthlyKwh: Math.round(avgMonthly),
      averageMonthlyBill: Math.round(avgMonthly * rate),
      annualBill: Math.round(totalKwh * rate),
      utilityRate: rate,
      peakMonthKwh: peakKwh,
      peakMonth,
      recommendedSystemKw: Math.round(systemKw * 100) / 100,
      recommendedPanelCount: panelCount,
      offsetTarget,
      batteryRecommendation: batteryRec,
    });
  }, [annualKwh, utilityRate, offsetTarget, wantBattery, onAnalysis]);

  // QW-4: Reactive computation — auto-calculate whenever inputs change
  useEffect(() => { calculate(); }, [calculate]);

  return (
    <div className="space-y-3">
      {/* Phase 2B: Annual kWh with provenance — ComputedField replaces plain input */}
      <ComputedField
        label="Annual kWh Usage"
        computed={annualKwhComputed}
        value={annualKwh}
        onChange={v => setAnnualKwh(parseInt(v) || 0)}
        placeholder="12000"
        data-testid="bill-annual-kwh"
      />

      {/* Phase 2C: Utility Rate with provenance — ComputedField replaces plain input */}
      <ComputedField
        label="Utility Rate"
        computed={utilityRateComputed}
        value={utilityRate}
        onChange={v => setUtilityRate(parseFloat(v) || 0)}
        type="number"
        step={0.001}
        placeholder="0.15"
        data-testid="bill-utility-rate"
      />

      <SliderRow
        label="Offset Target"
        value={offsetTarget} min={50} max={150} step={5} unit="%"
        onChange={setOffsetTarget}
      />

      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-400">Include Battery Storage?</label>
        <button
          onClick={() => setWantBattery(!wantBattery)}
          className={`w-10 h-5 rounded-full transition-colors relative ${wantBattery ? 'bg-amber-500' : 'bg-slate-600'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${wantBattery ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Phase 3D: Monthly usage distribution — sparkline instead of 12 blank fields */}
      {annualKwh > 0 ? (
        <div>
          <div className="text-xs text-slate-500 mb-1">Seasonal Usage Pattern</div>
          <div className="flex items-end gap-0.5 h-8">
            {(() => {
              const avg = annualKwh / 12;
              const seasonal = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87];
              const kwh12 = seasonal.map(s => Math.round(avg * s));
              const max = Math.max(...kwh12);
              const labels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
              return kwh12.map((kwh, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div
                    className="w-full bg-blue-500/50 rounded-sm"
                    style={{ height: `${(kwh / max) * 28}px` }}
                    title={`${labels[i]}: ${kwh.toLocaleString()} kWh`}
                  />
                  <span className="text-slate-600" style={{ fontSize: '6px' }}>{labels[i]}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Main Design Studio ───────────────────────────────────────
export default function DesignStudio({ project, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const router = useRouter();

  // ── Resolve initial map center ──────────────────────────────────────────────
  // Priority: project.lat/lng (geocoded at creation) → client.lat/lng → geocode on load
  // Never default to Phoenix (33.4484, -112.0740) — that was a hardcoded placeholder
  const PHOENIX_LAT = 33.4484;
  const PHOENIX_LNG = -112.0740;
  function isPhoenixDefault(lat?: number, lng?: number) {
    return lat === PHOENIX_LAT && lng === PHOENIX_LNG;
  }
  function hasValidCoords(lat?: number, lng?: number): boolean {
    return typeof lat === 'number' && typeof lng === 'number' &&
      isFinite(lat) && isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
      !isPhoenixDefault(lat, lng);
  }

  const initialLat = hasValidCoords(project.lat, project.lng)
    ? project.lat!
    : hasValidCoords(project.client?.lat, project.client?.lng)
      ? project.client!.lat!
      : PHOENIX_LAT; // Will be replaced by geocoding in useEffect below
  const initialLng = hasValidCoords(project.lat, project.lng)
    ? project.lng!
    : hasValidCoords(project.client?.lat, project.client?.lng)
      ? project.client!.lng!
      : PHOENIX_LNG;

  // Map state
  const [mapCenter, setMapCenter] = useState({
    lat: initialLat,
    lng: initialLng,
  });
  const [zoom, setZoom] = useState(19);
  // Tile provider: 'auto' tries Google first, falls back to ESRI on error.
  // 'google' forces Google only. 'esri' forces ESRI only (caps at zoom 19).
  // 'auto' is the default — Google primary for zoom 20+, ESRI for zoom <=19 if Google fails.
  const [tileProvider, setTileProvider] = useState<'auto' | 'google' | 'esri'>('auto');
  // High-res Google Solar RGB backdrop (~10 cm, covered addresses) — sharp enough to tag vents/obstructions
  const [hdImagery, setHdImagery] = useState(false);
  const [hdStatus, setHdStatus]   = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const hdImageRef = useRef<{ img: HTMLImageElement; bounds: { north: number; south: number; east: number; west: number } } | null>(null);
  // Track which zoom levels ESRI has run out of imagery (variance too low)
  const esriBlankZoomsRef = React.useRef<Set<number>>(new Set());
  // Current active provider per tile batch (for the badge)
  const [activeTileSource, setActiveTileSource] = useState<'google' | 'esri'>('google');
  const [mapTiles, setMapTiles] = useState<Map<string, HTMLImageElement>>(new Map());
  // Ref mirrors TILE_CACHE so drawCanvas can read tiles without stale closure issues.
  // We use a simple counter to trigger redraws instead of putting the full Map in deps.
  const mapTilesRef = useRef<Map<string, HTMLImageElement>>(TILE_CACHE);
  const [tileRedrawTick, setTileRedrawTick] = useState(0);        // incremented to trigger redraws
  const tileRedrawRafRef = useRef<number | null>(null);           // rAF handle for batching
  const loadTilesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null); // debounce
  const [mapLoaded, setMapLoaded] = useState(false);
  const [addressSearch, setAddressSearch] = useState(
    // Priority: project address → client address
    project.address
      ? project.address
      : project.client
        ? [project.client.address, project.client.city, project.client.state].filter(Boolean).join(', ')
        : ''
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'locating' | 'found' | 'failed'>('idle');
  const [addressSuggestions, setAddressSuggestions] = useState<Array<{ short_name: string; display_name: string; lat: number; lng: number }>>([]);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const [addressSuggestionsLoading, setAddressSuggestionsLoading] = useState(false);
  // The address input lives inside the overflow-x-auto header, which clips the
  // dropdown AND sits below the 3D canvas. Render the dropdown as position:fixed
  // (escapes both, like the floating Report-a-Bug button), positioned from the
  // input's live rect.
  const addrInputRef = useRef<HTMLInputElement>(null);
  const [addrDropdownPos, setAddrDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const addressDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Drawing state
  const [drawingMode, setDrawingMode] = useState<DrawingMode>('select');
  const [drawnPoints, setDrawnPoints] = useState<{ x: number; y: number; lat: number; lng: number }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragStartCenter, setDragStartCenter] = useState({ lat: 0, lng: 0 });
  const [measurePoints, setMeasurePoints] = useState<{ x: number; y: number; lat: number; lng: number }[]>([]);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);

  // Layout state
  const [panels, setPanels] = useState<PlacedPanel[]>([]);
  const [roofPlanes, setRoofPlanes] = useState<RoofPlane[]>([]);
  const [e2eStitchedCorners, setE2EStitchedCorners] = useState<Array<{ id: string; vertices: Array<{ lat: number; lng: number }> }>>([]);
  const [e2eDiagnostics, setE2EDiagnostics] = useState({ fullRebuildCount: 0, setbackInsets: 0 });
  const [expandedPlaneId, setExpandedPlaneId] = useState<string | null>(null);
  const [groundArea, setGroundArea] = useState<{ lat: number; lng: number }[]>([]);
  
  // Google Solar API data
  const [roofSegments, setRoofSegments] = useState<any[]>([]);
  const [solarApiData, setSolarApiData] = useState<any>(null);
  const [solarDataAddress, setSolarDataAddress] = useState<string | null>(null); // address Solar data is actually for
  const [solarDataCityOnly, setSolarDataCityOnly] = useState(false); // v50.13: true when data came from city-level coords (no street number)
  const [solarDataLoading, setSolarDataLoading] = useState(false);
  const [solarDataError, setSolarDataError] = useState<string | null>(null);
  // Solar API roof plane auto-detection status
  const [solarApiStatus, setSolarApiStatus] = useState<'idle' | 'loading' | 'loaded' | 'unavailable'>('idle');
  // Nearmap aerial roof detection (licensed HD aerial → real planes, on demand)
  const [aerialDetecting, setAerialDetecting] = useState(false);
  // Pending plane: drawn vertices awaiting azimuth/pitch tagging before panels are placed
  const [pendingPlane, setPendingPlane] = useState<{ vertices: {lat:number;lng:number}[]; area: number } | null>(null);
  const [pendingPlaneAzimuth, setPendingPlaneAzimuth] = useState<number>(180);
  const [pendingPlanePitch, setPendingPlanePitch] = useState<number>(20);
  const [fenceLine, setFenceLine] = useState<{ lat: number; lng: number }[]>([]);

  useEffect(() => {
    if (!E2E_ENABLED || typeof window === 'undefined') return;
    window.__solarE2E = {
      roofPlanes,
      panels,
      stitchedCorners: e2eStitchedCorners,
      setbackInsets: e2eDiagnostics.setbackInsets,
      fullRebuildCount: e2eDiagnostics.fullRebuildCount,
    };
  }, [roofPlanes, panels, e2eStitchedCorners, e2eDiagnostics]);

  // Mixed system support - active drawing zone type
  const [activeZoneType, setActiveZoneType] = useState<SystemType>(project.systemType);
  const [selectedPanelIds, setSelectedPanelIds] = useState<Set<string>>(new Set());

  // 3D placement mode
  const [placementMode3D, setPlacementMode3D] = useState<PlacementMode>('select');
  const [showShade3D, setShowShade3D] = useState(false);
  // v50.11: irradiance heatmap toggle
  const [showIrradiance, setShowIrradiance] = useState(false);

  // Equipment state
  const [availablePanels, setAvailablePanels] = useState<SolarPanel[]>([]);
  const [availableInverters, setAvailableInverters] = useState<Inverter[]>([]);
  const [availableBatteries, setAvailableBatteries] = useState<any[]>([]);
  const [selectedPanel, setSelectedPanel] = useState<SolarPanel>(
    project.selectedPanel || {
      // v47.109: Standard 440W default (Jinko Eagle Neo 440W)
      // width: 44.49" = 1.130m = 3.708ft, height: 69.4" = 1.762m = 5.781ft
      id: 'panel-std440', manufacturer: 'Jinko Solar', model: 'Eagle Neo N-type 440W',
      wattage: 440,
      width:  1.130,   // 44.49" = 1.130m (standard 440W residential width)
      height: 1.762,   // 69.4"  = 1.762m (standard 440W residential height)
      efficiency: 22.0,
      bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.30, pricePerWatt: 0.28,
    }
  );
  const [selectedInverter, setSelectedInverter] = useState<Inverter | null>(project.selectedInverter || null);
  const [selectedBattery, setSelectedBattery] = useState<any | null>(null);
  const [batteryCount, setBatteryCount] = useState(1);
  const [panelFilter, setPanelFilter] = useState('');
  const [inverterFilter, setInverterFilter] = useState('');

  // ── AHJ-derived initial values (Phase 1 QW-1a/QW-1b) ──────────────────
  // Look up AHJ jurisdiction from project address to get fire setback defaults
  // instead of dangerous zero values. Falls back to national defaults if no match.
  // v63: pass structured county/city/state hints so downstate addresses resolve to
  // the correct AHJ (e.g. Wood River → Madison County) instead of the old bug that
  // defaulted every unmatched Illinois address to Cook County / Chicago.
  const ahjRecord = (project.address || (project as any).county || (project as any).stateCode)
    ? getAhjByAddress(project.address || '', {
        stateCode: (project as any).stateCode,
        county:    (project as any).county,
        city:      (project as any).city,
      })
    : null;
  const INCHES_TO_METERS = 0.0254;

  // QW-1a: Compute initial fire setbacks from AHJ jurisdiction data
  const initialFireSetbacks: FireSetbackConfig = ahjRecord ? {
    edgeSetbackM:  (ahjRecord.ridgeSetbackInches ?? 18) * INCHES_TO_METERS,  // ridge=18" → 0.457m
    pathwayWidthM: (ahjRecord.pathwayWidthInches ?? 36) * INCHES_TO_METERS,   // pathway=36" → 0.914m
    ridgeSetbackM: (ahjRecord.ridgeSetbackInches ?? 18) * INCHES_TO_METERS,   // ridge=18" → 0.457m
    eaveSetbackM:  (ahjRecord.eaveSetbackInches ?? 0) * INCHES_TO_METERS,     // eave=0" (no IRC requirement)
    enforcePathway: true,
  } : DEFAULT_FIRE_SETBACKS;

  // QW-1a: Compute initial setback from AHJ roofSetbackInches (the "setback" slider
  // represents the general roof setback used in layout calculations).
  // Default AHJ value is 36" (0.914m) — NOT zero, which produces non-compliant designs.
  const initialSetbackM = ahjRecord
    ? (ahjRecord.roofSetbackInches ?? 36) * INCHES_TO_METERS
    : calcEffectiveSetback(DEFAULT_FIRE_SETBACKS);  // fallback: ~0.457m

  // QW-1b: Compute initial row spacing from latitude-based shadow formula
  // For roof mounts: 0.02m (clip gap only, panels are flush to roof)
  // For ground mounts: calcMinRowSpacing using latitude-derived solar altitude
  const initialPanelHeight = project.selectedPanel?.height ?? 1.7; // default panel ~1.7m tall
  const initialTilt = project.systemType === 'fence' ? 90 : Math.round(Math.abs(initialLat));
  const initialRowSpacing = project.systemType === 'ground'
    ? calcMinRowSpacing(initialTilt, initialPanelHeight, initialLat)
    : 0.02; // roof/fence: flush mount clip gap

  // Config state
  const [tilt, setTilt] = useState(initialTilt);
  const [azimuth, setAzimuth] = useState(180);
  const [rowSpacing, setRowSpacing] = useState(initialRowSpacing);
  const [panelSpacing, setPanelSpacing] = useState(0.006); // v47.98: 0.006m = ¼" clamp gap (was 0.02m)
  const [setback, setSetback] = useState(initialSetbackM);
  const [bifacialOptimized, setBifacialOptimized] = useState(true);

  // v63: Strings & equipment visualization + mid-clamp-driven spacing
  const [rackingId, setRackingId] = useState('ironridge-xr100');
  const [topology, setTopology] = useState<Topology>('string');
  const [modulesPerString, setModulesPerString] = useState(10);
  const [colorByString, setColorByString] = useState(false);
  const [showEquipment, setShowEquipment] = useState(false);
  const [panelOpacity, setPanelOpacity] = useState(1);
  // v63: manual string painting — paint mode, active target string, per-panel overrides
  const [paintMode, setPaintMode] = useState(false);
  const [paintStringIndex, setPaintStringIndex] = useState(0);
  const [stringOverrides, setStringOverrides] = useState<Record<string, number>>({});
  // Mid-clamp module gap (meters) for the selected racking — drives panel spacing.
  const midClampGapM = useMemo(() => getMidClampGapMeters(rackingId), [rackingId]);
  // Apply the hardware mid-clamp gap to the panel spacing whenever the racking changes.
  const applyRacking = useCallback((id: string) => {
    setRackingId(id);
    clearGridCache();
    setPanelSpacing(getMidClampGapMeters(id));
  }, []);

  // v63: derive per-panel string + equipment assignment from the placed panels.
  const stringAssignment = useMemo(
    () => assignStrings(panels as any, {
      modulesPerString,
      topology,
      modulesPerDevice: 1,
      optimizerModelId: OPTIMIZERS[0]?.id,
      microModelId: MICROINVERTERS[0]?.id,
      overrides: stringOverrides,
    }),
    [panels, modulesPerString, topology, stringOverrides],
  );
  const panelMeta = useMemo(() => {
    const m: Record<string, { color?: string; deviceType?: 'optimizer' | 'micro' | 'none'; stringLabel?: string }> = {};
    for (const id in stringAssignment.byPanelId) {
      const a = stringAssignment.byPanelId[id];
      m[id] = { color: a.color, deviceType: a.deviceType, stringLabel: a.stringLabel };
    }
    return m;
  }, [stringAssignment]);
  const stringLegend = useMemo(
    () => stringAssignment.strings.map(s => ({ label: s.label, color: s.color, panelCount: s.panelCount })),
    [stringAssignment],
  );
  // Turning equipment view on dims the panels so devices are visible underneath.
  const toggleEquipment = useCallback(() => {
    setShowEquipment(prev => {
      const next = !prev;
      setPanelOpacity(next ? 0.35 : 1);
      return next;
    });
  }, []);

  // v63: paint mode — clicking a panel in 3D assigns it to the active string.
  const togglePaintMode = useCallback(() => {
    setPaintMode(prev => {
      const next = !prev;
      if (next) { setColorByString(true); setPlacementMode3D('select'); } // colors must be visible + clicks route to select handler
      return next;
    });
  }, []);
  const handlePanelPaint = useCallback((panelId: string) => {
    setStringOverrides(prev => ({ ...prev, [panelId]: paintStringIndex }));
  }, [paintStringIndex]);
  const resetStringOverrides = useCallback(() => setStringOverrides({}), []);

  // v63: serialize the current electrical design for the Engineering handoff.
  // Logged into the saved Layout (only happens when a real project is active —
  // scratch/testing designs never persist), read by the Engineering page to seed
  // its inverter/string/topology config with no re-entry.
  const buildDesignElectrical = useCallback((): DesignElectrical => {
    const byPanelId: Record<string, number> = {};
    const stringMap = new Map<number, string[]>();
    for (const pid in stringAssignment.byPanelId) {
      const idx = stringAssignment.byPanelId[pid].stringIndex;
      byPanelId[pid] = idx;
      const arr = stringMap.get(idx);
      if (arr) arr.push(pid); else stringMap.set(idx, [pid]);
    }
    const strings = [...stringMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([stringIndex, panelIds]) => ({ stringIndex, panelCount: panelIds.length, panelIds }));
    return {
      topology,
      inverterBrand: topology === 'micro' ? 'Enphase' : 'SolarEdge',
      modulesPerString,
      rackingId,
      panelId: (selectedPanel as any)?.id,
      optimizerModelId: topology === 'optimizer' ? OPTIMIZERS[0]?.id : undefined,
      microModelId: topology === 'micro' ? MICROINVERTERS[0]?.id : undefined,
      byPanelId,
      overrides: Object.keys(stringOverrides).length > 0 ? stringOverrides : undefined,
      strings,
      deviceCount: stringAssignment.deviceCount,
      generatedAt: new Date().toISOString(),
    };
  }, [stringAssignment, topology, modulesPerString, rackingId, selectedPanel, stringOverrides]);

  // Keep the latest electrical design in a ref for the beforeunload save path.
  const designElectricalRef = useRef<DesignElectrical | null>(null);
  useEffect(() => {
    designElectricalRef.current = panels.length > 0 ? buildDesignElectrical() : null;
  }, [panels.length, buildDesignElectrical]);

  // Phase 2D: ComputedField descriptors for tilt and azimuth with provenance
  const tiltComputed: ComputedFieldValue = useMemo(() => ({
    value: initialTilt,
    confidence: initialLat !== 0 ? 'high' as const : 'medium' as const,
    source: 'address-lookup' as ConfidenceSource,
    derivation: `Optimal tilt = |latitude| (${Math.abs(initialLat).toFixed(1)}°) for maximum annual production`,
    unit: '°',
  }), [initialTilt, initialLat]);

  const azimuthComputed: ComputedFieldValue = useMemo(() => ({
    value: 180,
    confidence: 'high' as const,
    source: 'ecosystem' as ConfidenceSource,
    derivation: 'South-facing (180°) is optimal in the Northern Hemisphere for maximum annual solar gain',
    unit: '°',
  }), []);
  const [fenceHeight, setFenceHeight] = useState(2.0);
  const [groundHeight, setGroundHeight] = useState(0.6);
  const [panelsPerRow, setPanelsPerRow] = useState(10);
  const [show3D, setShow3D] = useState(true);  // Default to 3D view
  const [showPanels, setShowPanels] = useState(true);

  // v30.9: Panel orientation (portrait/landscape)
  const [orientation, setOrientation] = useState<PanelOrientation>('portrait');

  // v30.9: Fire setback configuration (AHJ-configurable)
  // QW-1a: Initialize from AHJ jurisdiction data instead of generic defaults
  const [fireSetbacks, setFireSetbacks] = useState<FireSetbackConfig>(initialFireSetbacks);
  const [showSetbackZones, setShowSetbackZones] = useState(false);
  const [showCADDebug, setShowCADDebug] = useState(false); // CAD debug overlay: usable polygon + row lines
  // v47.118: Align panel grid to longest roof edge (instead of pure azimuth)
  const [alignToEdge, setAlignToEdge] = useState(true);  // default ON for best visual alignment
  const [setbackZones, setSetbackZones] = useState<SetbackZone[]>([]);

  // v30.9: Multi-row placement tool
  const [multiRowMode, setMultiRowMode] = useState(false);
  const [multiRowCount, setMultiRowCount] = useState(3);
  const [multiRowStart, setMultiRowStart] = useState<{lat: number; lng: number} | null>(null);
  const [multiRowEnd, setMultiRowEnd] = useState<{lat: number; lng: number} | null>(null);
  const [hoverPos, setHoverPos] = useState<{lat: number; lng: number} | null>(null); // v30.9: cursor tracking

  // Bill analysis state
  const [billAnalysis, setBillAnalysis] = useState<BillAnalysis | null>(null);

  // Phase 2E: PVWatts auto-sizing recommendation state
  const [pvwattsSizing, setPvwattsSizing] = useState<{
    recommendedKw: number;
    annualKwhProduction: number;
    monthlyProduction: number[];
    peakSunHours: number;
    panelCount400w: number;
    source: 'pvwatts' | 'estimate';
  } | null>(null);
  const [pvwattsLoading, setPvwattsLoading] = useState(false);

  // Phase 2E: Auto-call PVWatts when we have annual kWh + location data
  useEffect(() => {
    if (!billAnalysis || !project.lat || !project.lng || !project.stateCode) return;
    if (billAnalysis.annualKwh <= 0) return;
    // Don't re-run if we already have a PVWatts result
    if (pvwattsSizing) return;

    let cancelled = false;
    setPvwattsLoading(true);

    import('@/lib/autoSizing').then(({ calculateSystemSize }) => {
      if (cancelled) return;
      return calculateSystemSize({
        annualKwh: billAnalysis.annualKwh,
        lat: project.lat!,
        lng: project.lng!,
        stateCode: project.stateCode!,
        offsetPercent: billAnalysis.offsetTarget || 100,
        tilt,
        azimuth,
      });
    }).then(result => {
      if (cancelled || !result) return;
      setPvwattsSizing({
        recommendedKw: result.recommendedKw,
        annualKwhProduction: result.annualKwhProduction,
        monthlyProduction: result.monthlyProduction,
        peakSunHours: result.peakSunHours,
        panelCount400w: result.panelCount400w,
        source: result.source,
      });
    }).catch(err => {
      console.warn('[DesignStudio] PVWatts auto-sizing failed:', err);
    }).finally(() => {
      if (!cancelled) setPvwattsLoading(false);
    });

    return () => { cancelled = true; };
  }, [billAnalysis, project.lat, project.lng, project.stateCode, tilt, azimuth, pvwattsSizing]);

  const [activeTab, setActiveTab] = useState<'design' | 'bill' | 'equipment' | 'battery'>('design');

  // Calculation state
  const [calculating, setCalculating] = useState(false);
  const [production, setProduction] = useState<any>(null);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [calcMessage, setCalcMessage] = useState<string>('');
  // QW-10: Reactive production calculation — auto-compute when layout changes
  // with 3-second debounce. Replaces the manual "Calculate Production" button.
  const autoCalcTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Restore indicators — show what was loaded from DB on mount
  const [restoredPanelCount, setRestoredPanelCount] = useState<number>(0);
  const [restoredRoofPlaneCount, setRestoredRoofPlaneCount] = useState<number>(0);
  const [layoutLoadedFromDB, setLayoutLoadedFromDB] = useState<boolean>(false);

  // Auto-save refs — use refs for mapCenter/zoom so the debounce callback
  // doesn't get recreated on every map pan (which would reset the 3-second timer)
  const mapCenterRef = useRef(mapCenter);
  const zoomRef = useRef(zoom);
  const lastSavedPanelsRef = useRef<string>('[]');
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const panelsRef2 = useRef<PlacedPanel[]>(panels);
  const roofPlanesRef = useRef<RoofPlane[]>([]); // keeps roofPlanes accessible in saveLayoutToDB
  const fenceLineRef = useRef<{ lat: number; lng: number }[]>([]); // keeps fence geometry accessible in saveLayoutToDB autosave
  const fenceHeightRef = useRef<number>(2.0);
  // v50.22: tracks the address from an explicit user pick (address search or Pick House).
  // onTwinLoaded must not overwrite solarDataAddress/solarDataCityOnly when a pick is in flight.
  const explicitPickAddressRef = useRef<string | null>(null);

  const systemSizeKw = calculateSystemSize(panels);

  // Phase 2I: PVWatts-quality production estimate (shown before full API calculation)
  // Uses calculateProductionLocal() which applies climate-zone multipliers,
  // azimuth/tilt correction, bifacial gain, and system losses — matching PVWatts
  // methodology locally without an API call. Much more accurate than the old
  // rough peakSunHours * 365 formula.
  const quickEstimate = useMemo(() => {
    if (panels.length === 0 || systemSizeKw === 0) return null;
    const lat = mapCenter.lat;
    const lng = mapCenter.lng;
    const effectiveTilt = project.systemType === 'fence' ? 90 : tilt;
    const effectiveAzimuth = azimuth;
    const bifacialFactor = project.systemType === 'fence'
      ? (bifacialOptimized ? 1.20 : 1.10)
      : 1.0;

    try {
      const pvData = calculateProductionLocal({
        lat, lng, systemSizeKw,
        tilt: effectiveTilt,
        azimuth: effectiveAzimuth,
        losses: 14,
        bifacialFactor,
      });

      const annualKwh = pvData.ac_annual;
      const monthlyProduction = pvData.ac_monthly.map(Math.round);
      const peakSunHours = pvData.solrad_annual;
      const utilityRate = project.utilityRatePerKwh || 0.15;
      const annualSavings = Math.round(annualKwh * utilityRate);
      const capacityFactor = pvData.capacity_factor;

      return {
        annualKwh,
        monthlyProduction,
        peakSunHours,
        annualSavings,
        capacityFactor,
        source: 'local' as const,
      };
    } catch {
      // Fallback to simple estimate if local calc fails
      const annualKwh = Math.round(systemSizeKw * 4.5 * 365 * 0.86);
      const monthlyProduction = Array(12).fill(Math.round(annualKwh / 12));
      const utilityRate = project.utilityRatePerKwh || 0.15;
      const annualSavings = Math.round(annualKwh * utilityRate);
      return {
        annualKwh,
        monthlyProduction,
        peakSunHours: 4.5,
        annualSavings,
        capacityFactor: 0,
        source: 'fallback' as const,
      };
    }
  }, [panels.length, systemSizeKw, mapCenter.lat, mapCenter.lng, tilt, azimuth, project.systemType, bifacialOptimized, project.utilityRatePerKwh]);

  // Keep refs in sync with state
  useEffect(() => { mapCenterRef.current = mapCenter; }, [mapCenter]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panelsRef2.current = panels; }, [panels]);
  useEffect(() => { roofPlanesRef.current = roofPlanes; }, [roofPlanes]);
  useEffect(() => { fenceLineRef.current = fenceLine; }, [fenceLine]);
  useEffect(() => { fenceHeightRef.current = fenceHeight; }, [fenceHeight]);

  // QW-10: Reactive production calculation — auto-compute with 3s debounce
  // whenever panels change significantly. Replaces the manual button click.
  useEffect(() => {
    // Don't auto-calc if no panels or already calculating
    if (panels.length === 0 || calculating) return;
    // Clear any pending timer
    if (autoCalcTimerRef.current) clearTimeout(autoCalcTimerRef.current);
    // Debounce: wait 3 seconds after the last panel change before calculating
    autoCalcTimerRef.current = setTimeout(() => {
      calculateProduction();
    }, 3000);
    return () => {
      if (autoCalcTimerRef.current) clearTimeout(autoCalcTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels.length, systemSizeKw, tilt, azimuth]);

  // ── Auto-save layout to DB (3-second debounce after panel changes) ──────────
  const saveLayoutToDB = useCallback(async (panelList: PlacedPanel[]) => {
    // v63: fold the electrical design into the dedup signature so topology /
    // modules-per-string / string-paint changes persist even when panels are unchanged.
    const designElectrical = panelList.length > 0 ? buildDesignElectrical() : undefined;
    const sig = JSON.stringify(panelList) + '|' + JSON.stringify(designElectrical ?? null);
    if (sig === lastSavedPanelsRef.current) return; // nothing changed
    lastSavedPanelsRef.current = sig;
    const payload = {
      panels: panelList,
      mapCenter: mapCenterRef.current,
      mapZoom: zoomRef.current,
      systemType: project.systemType,
      // v63: electrical design handoff for Engineering (string/topology/brand/equipment)
      designElectrical,
      // Include roofPlanes so permit generator can use exact roof geometry
      roofPlanes: roofPlanesRef.current.length > 0 ? roofPlanesRef.current : undefined,
      // Persist fence geometry on autosave too — previously only the manual
      // buildLayout()→/api/production path saved these, so an auto-saved fence
      // design lost its line/height on reload (and engineering had no geometry
      // to recognize it by). Mirrors the roofPlanes treatment.
      fenceLine:  fenceLineRef.current.length > 1 ? fenceLineRef.current : undefined,
      fenceHeight: project.systemType === 'fence' ? fenceHeightRef.current : undefined,
    };
    // STEP 1 -- LAYOUT SAVE LOGGING
    console.log('[LAYOUT SAVE PAYLOAD]', {
      projectId: project.id,
      panelCount: panelList.length,
      roofPlaneCount: roofPlanesRef.current.length,
      hasRoofPlanes: roofPlanesRef.current.length > 0,
      panels: panelList.slice(0, 3),
      roofPlanes: roofPlanesRef.current,
    });
    // Always save to localStorage first (survives serverless cold starts)
    localSaveLayout(project.id, payload);
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/projects/${project.id}/layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setLastSavedAt(new Date());
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 3000);
      } else {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus(s => s === 'error' ? 'idle' : s), 5000);
      }
    } catch (e) {
      console.error('Auto-save failed:', e);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(s => s === 'error' ? 'idle' : s), 5000);
    }
  }, [project.id, project.systemType, buildDesignElectrical]);

  // Trigger auto-save 3 seconds after panels change
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveLayoutToDB(panels);
    }, 3000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [panels, saveLayoutToDB]);

  // Save on page exit using sendBeacon (reliable even during unload)
  useEffect(() => {
    const handleBeforeUnload = () => {
      const panelList = panelsRef2.current;
      const designElectrical = designElectricalRef.current ?? undefined;
      const sig = JSON.stringify(panelList) + '|' + JSON.stringify(designElectrical ?? null);
      if (sig === lastSavedPanelsRef.current) return;
      const payload = JSON.stringify({
        panels: panelList,
        mapCenter: mapCenterRef.current,
        mapZoom: zoomRef.current,
        systemType: project.systemType,
        designElectrical,
        roofPlanes: roofPlanesRef.current.length > 0 ? roofPlanesRef.current : undefined,
      });
      navigator.sendBeacon(
        `/api/projects/${project.id}/layout`,
        new Blob([payload], { type: 'application/json' })
      );
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [project.id, project.systemType]);

  // ── Restore panels from DB on mount ─────────────────────────────────────────
  useEffect(() => {
    const restorePanels = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/layout`);
        const data = await res.json();
        console.log('[LAYOUT RESTORE FROM DB]', {
          projectId: project.id,
          success: data.success,
          panelCount: data.data?.panels?.length ?? 0,
          roofPlaneCount: data.data?.roofPlanes?.length ?? 0,
          hasRoofPlanes: !!(data.data?.roofPlanes && data.data.roofPlanes.length > 0),
        });
        if (data.success && data.data?.panels && data.data.panels.length > 0) {
          setPanels(data.data.panels);
          lastSavedPanelsRef.current = JSON.stringify(data.data.panels) + '|' + JSON.stringify(data.data?.designElectrical ?? null);
          setRestoredPanelCount(data.data.panels.length);
          setLayoutLoadedFromDB(true);
          console.log(`[DesignStudio] Restored ${data.data.panels.length} panels from DB`);
        }
        // v63: restore the electrical design (topology / brand / modules-per-string /
        // racking / manual string-paint overrides) so the UI reflects what was saved.
        const de = data.data?.designElectrical as DesignElectrical | undefined;
        if (de) {
          if (de.topology) setTopology(de.topology);
          if (typeof de.modulesPerString === 'number') setModulesPerString(de.modulesPerString);
          if (de.rackingId) setRackingId(de.rackingId);
          if (de.overrides && Object.keys(de.overrides).length > 0) setStringOverrides(de.overrides);
          console.log('[DesignStudio] Restored design electrical:', { topology: de.topology, overrides: Object.keys(de.overrides ?? {}).length });
        }
        // CRITICAL FIX: Also restore roofPlanes so roofPlanesRef stays populated
        // Without this, auto-save fires with roofPlanesRef.current = [] and roof planes are lost
        // Only restore planes that have actual vertices — ignore placeholder planes with empty vertices
        const savedPlanes = (data.data?.roofPlanes ?? []).filter(
          (rp: RoofPlane) => rp.vertices && rp.vertices.length >= 3
        );
        if (data.success && savedPlanes.length > 0) {
          setRoofPlanes(savedPlanes);
          setRestoredRoofPlaneCount(savedPlanes.length);
          console.log(`[DesignStudio] Restored ${savedPlanes.length} roof planes from DB (filtered ${(data.data?.roofPlanes?.length ?? 0) - savedPlanes.length} empty planes)`);
        } else {
          // Solar API auto-detect DISABLED on project load.
          // Project coords may be a city centre or wrong building.
          // Roof planes only load when user explicitly picks a building via Pick House.
          setSolarApiStatus('idle');
          console.log('[DesignStudio] Skipping auto-detect — waiting for explicit building pick');
        }
      } catch (e) {
        console.error('Panel restore failed:', e);
      }
    };
    restorePanels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Load hardware
  useEffect(() => {
    fetch('/api/hardware').then(r => r.json()).then(d => {
      if (d.success) {
        setAvailablePanels(d.data.panels);
        setAvailableInverters(d.data.inverters);
        setAvailableBatteries(d.data.batteries || []);
        if (d.data.panels.length > 0 && !project.selectedPanel) {
          setSelectedPanel(d.data.panels[0]);
        }
        if (d.data.inverters.length > 0 && !project.selectedInverter) {
          setSelectedInverter(d.data.inverters[3]); // SolarEdge default
        }
      }
    });
  }, []);

  // ── Geocode address for initial fly-to (does NOT clear panels or fetch Solar data) ───────
  // Used on project load to fly the camera to the correct street-level address without
  // destroying the saved panel layout or triggering Solar API auto-fetch.
  // FIX v52.2: AbortController ref cancels in-flight geocode when project changes.
  // Without this, switching Project A → Braidon causes A's geocode (still in flight)
  // to land AFTER Braidon's fires, overwriting mapCenter with A's coordinates.
  const flyToAbortRef = useRef<AbortController | null>(null);

  const geocodeAddressForFlyTo = async (address: string, signal?: AbortSignal) => {
    if (!address.trim()) return;
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}&mode=search`, { signal });
      const data = await res.json();
      if (signal?.aborted) return; // double-check after await
      if (data.success && data.data) {
        const newLat = data.data.lat;
        const newLng = data.data.lng;
        setMapCenter({ lat: newLat, lng: newLng });
        setZoom(19);
        setLocationStatus('found');
        // Persist street-level coords back to project so future loads skip geocoding
        if (project.id) {
          fetch(`/api/projects/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: newLat, lng: newLng }),
          }).catch(() => {}); // non-fatal
        }
      } else {
        if (!signal?.aborted) setLocationStatus('failed');
      }
    } catch (err) {
      // AbortError is expected on project switch — not a real error
      if (err instanceof Error && err.name === 'AbortError') return;
      setLocationStatus('failed');
    }
  };

  // ── Address geocoding ──────────────────────────────────────
  const geocodeAddress = async (address: string) => {
    if (!address.trim()) return;
    setSearchLoading(true);
    // Clear panels from old address before flying to new location
    setPanels([]);
    lastSavedPanelsRef.current = '[]';
    setProduction(null);
    setCostEstimate(null);
    setCalcMessage('');
    const toastId = toast.loading('Finding address...', address);
    try {
      // Use server-side proxy to avoid CORS/rate-limit issues with Nominatim
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}&mode=search`);
      const data = await res.json();
      if (data.success && data.data) {
        const newLat = data.data.lat;
        const newLng = data.data.lng;
        setMapCenter({ lat: newLat, lng: newLng });
        setZoom(19);
        TILE_CACHE.clear(); TILE_INFLIGHT.clear(); setMapTiles(new Map()); // clear tiles to force reload at new location
        setLocationStatus('found');
        // v50.13: Pass address and city-only flag so Roof Analysis can show a warning
        // when data came from city-level coordinates (no specific building)
        const resolvedShortName = data.data.short_name || address;
        const isCityOnly = !isStreetLevelAddress(resolvedShortName);
        fetchSolarData(newLat, newLng, resolvedShortName, isCityOnly);
        toast.update(toastId, {
          type: 'success',
          title: 'Location found!',
          message: `${newLat.toFixed(5)}, ${newLng.toFixed(5)} · Loading 3D site model...`,
        });
        // Phase 6: Save resolved coords back to project so next load is instant
        if (project.id && (!project.lat || !project.lng)) {
          fetch(`/api/projects/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: newLat, lng: newLng, address }),
          }).catch(() => {}); // non-fatal
        }
      } else {
        setLocationStatus('failed');
        toast.update(toastId, {
          type: 'error',
          title: 'Address not found',
          message: 'Try a more specific address or include city and state',
        });
      }
    } catch (e) {
      console.error('Geocoding failed:', e);
      setLocationStatus('failed');
      toast.update(toastId, {
        type: 'error',
        title: 'Geocoding failed',
        message: 'Network error — please try again',
      });
    } finally {
      setSearchLoading(false);
    }
  };

  // Keep the fixed-positioned address dropdown anchored to the input's live rect
  // (recompute on open, and while open on scroll/resize).
  useEffect(() => {
    if (!showAddressSuggestions || addressSuggestions.length === 0) return;
    const update = () => {
      const el = addrInputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAddrDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showAddressSuggestions, addressSuggestions.length]);

  // ── Address autocomplete ──────────────────────────────────
  const handleAddressSearchInput = useCallback((value: string) => {
    setAddressSearch(value);
    setLocationStatus('idle');
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (value.length < 3) {
      setAddressSuggestions([]);
      setShowAddressSuggestions(false);
      return;
    }
    addressDebounceRef.current = setTimeout(async () => {
      setAddressSuggestionsLoading(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(value)}&mode=autocomplete`);
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          setAddressSuggestions(data.data);
          setShowAddressSuggestions(true);
        } else {
          setAddressSuggestions([]);
          setShowAddressSuggestions(false);
        }
      } catch {
        setAddressSuggestions([]);
      } finally {
        setAddressSuggestionsLoading(false);
      }
    }, 350);
  }, []);

  const handleSelectAddressSuggestion = useCallback((s: { short_name: string; lat: number; lng: number }) => {
    setAddressSearch(s.short_name);
    setShowAddressSuggestions(false);
    setAddressSuggestions([]);
    // Clear panels from old address before flying to new location
    setPanels([]);
    lastSavedPanelsRef.current = '[]';
    setProduction(null);
    setCostEstimate(null);
    setCalcMessage('');
    setMapCenter({ lat: s.lat, lng: s.lng });
    setZoom(19);
    TILE_CACHE.clear(); TILE_INFLIGHT.clear(); setMapTiles(new Map());
    // v50.13: detect city-only autocomplete selections (no house number)
    const suggAddr = s.short_name ?? addressSearch;
    fetchSolarData(s.lat, s.lng, suggAddr, !isStreetLevelAddress(suggAddr));
    setLocationStatus('found');
    toast.info('Loading site model...', `${s.short_name} · Resetting 3D scene`);
  }, [toast]);

  // v50.13: Returns true when address string has a leading house number (e.g. "123 Main St")
  // City-only addresses like "Edwardsville, IL" have no house number — Solar API returns random building data.
  const isStreetLevelAddress = (addr: string | null | undefined): boolean => {
    if (!addr) return false;
    return /^\d+\s/.test(addr.trim());
  };

  // Fetch Google Solar API data — only call this when a specific building has been picked
  const fetchSolarData = useCallback(async (lat: number, lng: number, address?: string, cityOnly = false) => {
    setSolarDataLoading(true);
    setSolarDataError(null);
    setSolarDataAddress(address ?? null);
    setSolarDataCityOnly(cityOnly);
    // v50.22: mark an explicit pick so onTwinLoaded doesn't clobber address/cityOnly
    if (address) explicitPickAddressRef.current = address;
    try {
      const response = await fetch(
        `/api/solar?endpoint=buildingInsights&lat=${lat}&lng=${lng}&quality=HIGH`
      );
      if (!response.ok) {
        throw new Error(`Solar API error: ${response.status}`);
      }
      const data = await response.json();
      setSolarApiData(data);
      if (data.solarPotential?.roofSegmentStats) {
        setRoofSegments(data.solarPotential.roofSegmentStats);
        console.log("Google Solar API: Roof segments loaded", data.solarPotential.roofSegmentStats.length);
      }
    } catch (error: unknown) {
      console.error("Failed to fetch solar data:", error);
      setSolarDataError((error as Error).message || "Failed to load solar data");
    } finally {
      setSolarDataLoading(false);
    }
  }, []);

  // ── Nearmap aerial roof detection (on-demand, licensed HD aerial) ──────
  // Pulls real roof planes (outline + pitch + material) for the building under
  // the current map center and drops them into the roofPlanes slot as
  // confirmed:false, so they render in the 3D scene and route through the
  // existing operator review/confirm step. Costs Nearmap credits → user-action
  // only, never auto. Falls back gracefully (toast) when there's no coverage.
  const detectRoofFromAerial = useCallback(async () => {
    setAerialDetecting(true);
    setSolarApiStatus('loading');
    try {
      const res = await fetch(
        `/api/aerial-roof-detect?lat=${mapCenter.lat}&lng=${mapCenter.lng}`
      );
      const data = await res.json();
      if (!data.success) {
        setSolarApiStatus('unavailable');
        toast.error('Aerial detect failed', data.error || 'Could not reach Nearmap.');
        return;
      }
      if (!data.covered || !Array.isArray(data.planes) || data.planes.length === 0) {
        setSolarApiStatus('unavailable');
        toast.info('No aerial coverage here', data.message || 'Use Solar API or draw the roof manually.');
        return;
      }
      const planes = data.planes as RoofPlane[];
      setRoofPlanes(planes);
      setSolarApiStatus('loaded');
      if (data.resolved?.address) setSolarDataAddress(data.resolved.address);
      toast.success('🛰️ Roof detected from aerial', `${planes.length} plane${planes.length !== 1 ? 's' : ''} from Nearmap · review pitch & azimuth, then confirm`);
    } catch (e) {
      setSolarApiStatus('unavailable');
      toast.error('Aerial detect failed', (e as Error).message);
    } finally {
      setAerialDetecting(false);
    }
  }, [mapCenter.lat, mapCenter.lng, toast]);

  // ── Handle house pick from 3D view ──────────────────────────────────
  // Called when user clicks a house in Pick House mode.
  // Updates the map center, fetches new Solar API data, and updates the address bar.
  const handleLocationPick = useCallback(async (pickedLat: number, pickedLng: number, pickedAddress: string) => {
    // Clear existing panels — new house, fresh start
    setPanels([]);
    lastSavedPanelsRef.current = '[]';
    setProduction(null);
    setCostEstimate(null);
    setCalcMessage('');
    setSolarApiData(null);
    setRoofSegments([]);
    setSolarDataAddress(null);
    setSolarDataCityOnly(false);

    // Update map center and address bar
    setMapCenter({ lat: pickedLat, lng: pickedLng });
    setAddressSearch(pickedAddress);
    setLocationStatus('found');

    // Show toast
    toast.info('🏡 House selected', `Loading solar data for ${pickedAddress}`);

    // Fetch Solar API data for the explicitly picked building
    setSolarDataAddress(null); setSolarDataCityOnly(false); // clear while loading
    fetchSolarData(pickedLat, pickedLng, pickedAddress);

    // Save resolved coords back to project (non-fatal)
    if (project.id) {
      fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pickedLat, lng: pickedLng, address: pickedAddress }),
      }).catch(() => {});
    }
  }, [fetchSolarData, project.id, toast]);

  // ── Resolve location on load ─────────────────────────────────────────
  // v52.1: Street-level geocode always wins over stored coords.
  // Stored project.lat/lng may be city-center (from bill-parse which geocodes the city,
  // not the street address). If we have a street-level address (starts with a house number),
  // always geocode it to get precise parcel coords, even if stored coords look valid.
  // This fixes the "flew to wrong city downtown" bug after bill parse + project creation.
  useEffect(() => {
    setSolarApiData(null); setRoofSegments([]); setSolarDataAddress(null); setSolarDataCityOnly(false);

    const projectAddr = project.address?.trim();
    const clientAddr  = project.client?.address;

    // Best full address available for geocoding
    const fullClientAddr = clientAddr
      ? [clientAddr, project.client?.city, project.client?.state, project.client?.zip].filter(Boolean).join(', ')
      : null;
    const addrToGeocode = projectAddr || fullClientAddr;

    // Cancel any in-flight geocode from a previous project before starting a new one.
    // This prevents the previous project's geocode response landing after we've already
    // switched projects and overwriting mapCenter with the wrong coordinates.
    if (flyToAbortRef.current) flyToAbortRef.current.abort();
    const abortCtrl = new AbortController();
    flyToAbortRef.current = abortCtrl;

    // If we have a street-level address (house number present), geocode it for precise coords.
    // Pre-position camera at stored coords so the 3D scene isn't blank during geocoding.
    if (addrToGeocode && isStreetLevelAddress(addrToGeocode)) {
      if (hasValidCoords(project.lat, project.lng)) {
        setMapCenter({ lat: project.lat!, lng: project.lng! });
      } else if (hasValidCoords(project.client?.lat, project.client?.lng)) {
        setMapCenter({ lat: project.client!.lat!, lng: project.client!.lng! });
      }
      setLocationStatus('locating');
      setAddressSearch(addrToGeocode);
      geocodeAddressForFlyTo(addrToGeocode, abortCtrl.signal); // pass signal so it can be cancelled
      return;
    }

    // No street number — use stored coords (city-level is fine when no street address to geocode).
    if (hasValidCoords(project.lat, project.lng)) {
      setMapCenter({ lat: project.lat!, lng: project.lng! });
      setLocationStatus('found');
      if (projectAddr) setAddressSearch(projectAddr);
      return;
    }

    if (hasValidCoords(project.client?.lat, project.client?.lng)) {
      setMapCenter({ lat: project.client!.lat!, lng: project.client!.lng! });
      setLocationStatus('found');
      if (fullClientAddr) setAddressSearch(fullClientAddr);
      return;
    }

    // Last resort: geocode whatever address we have (even city-level)
    if (addrToGeocode) {
      setLocationStatus('locating');
      setAddressSearch(addrToGeocode);
      geocodeAddressForFlyTo(addrToGeocode, abortCtrl.signal);
      return;
    }

    // No address at all — stay at default, let user search manually
    setLocationStatus('failed');

    // Cleanup: abort the geocode if the component unmounts or project changes again
    return () => { abortCtrl.abort(); };
  }, [project.id]); // Only run when project changes


  // ── Load map tiles ──────────────────────────────────────────────────────────
  // Provider priority (v47.87):
  //   'auto'   — Google primary (zoom 21), ESRI fallback on error or blank tile
  //   'google' — Google only (forced)
  //   'esri'   — ESRI only, capped at zoom 19
  // Smart quality detection: ESRI tiles with pixel variance <80 are flagged as blank
  // (ESRI stops real imagery above zoom 19 for rural areas, returns solid grey tile)
  const GOOGLE_MAX_ZOOM = 21;
  const ARCGIS_MAX_ZOOM = 19;

  // Cache Google Maps session token at component scope
  const googleSessionRef = React.useRef<{ token: string; key: string } | null>(null);
  const googleSessionFetchedRef = React.useRef(false);

  // Fetch Google Maps session token once on mount — pre-warm so tiles are ready immediately
  useEffect(() => {
    if (googleSessionFetchedRef.current) return;
    googleSessionFetchedRef.current = true;
    fetch('/api/maps-session')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.session) {
          // Store session token; tiles are proxied through /api/maps-session (POST)
          // so the API key stays server-side and never needs to be returned here.
          googleSessionRef.current = { token: data.session, key: '' };
          setActiveTileSource('google');
        } else {
          setActiveTileSource('esri');
        }
      })
      .catch(() => { setActiveTileSource('esri'); });
  }, []);

  /** Detect if a canvas tile image is blank/solid-colour (low pixel variance).
   *  ESRI returns a ~2.5KB grey placeholder when it has no imagery at that zoom.
   *  Uses a small 16x16 sample to minimise main-thread paint cost. */
  const detectBlankTile = (img: HTMLImageElement): boolean => {
    try {
      // Use OffscreenCanvas where available to avoid blocking the main thread
      let oc: OffscreenCanvas | HTMLCanvasElement;
      let ctx2d: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      if (typeof OffscreenCanvas !== 'undefined') {
        oc = new OffscreenCanvas(16, 16);
        ctx2d = (oc as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
      } else {
        oc = document.createElement('canvas');
        (oc as HTMLCanvasElement).width  = 16;
        (oc as HTMLCanvasElement).height = 16;
        ctx2d = (oc as HTMLCanvasElement).getContext('2d');
      }
      if (!ctx2d) return false;
      ctx2d.drawImage(img, 0, 0, 16, 16);
      const d = ctx2d.getImageData(0, 0, 16, 16).data;
      let sum = 0, sum2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += lum; sum2 += lum * lum; n++;
      }
      const mean = sum / n;
      const variance = sum2 / n - mean * mean;
      return variance < 80;
    } catch { return false; }
  };

  // ── Trigger batched canvas redraw after tiles load ────────────────────────
  const scheduleTileRedraw = useCallback(() => {
    if (tileRedrawRafRef.current !== null) return; // already scheduled
    tileRedrawRafRef.current = requestAnimationFrame(() => {
      tileRedrawRafRef.current = null;
      mapTilesRef.current = new Map(TILE_CACHE); // sync ref for drawCanvas
      setTileRedrawTick(t => t + 1);             // trigger useEffect → drawCanvas
      setMapLoaded(true);
    });
  }, []);

  const loadTiles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const hasGoogle = !!googleSessionRef.current;
    const forceEsri   = tileProvider === 'esri';
    const forceGoogle = tileProvider === 'google';

    // Determine fetch zoom based on provider capabilities
    const MAX_ZOOM  = (!forceEsri && hasGoogle) ? GOOGLE_MAX_ZOOM : ARCGIS_MAX_ZOOM;
    const fetchZoom = Math.min(zoom, MAX_ZOOM);
    const scale     = Math.pow(2, zoom - fetchZoom);

    const center = latLngToWorld(mapCenter.lat, mapCenter.lng, fetchZoom);
    const tileX  = Math.floor(center.x / TILE_SIZE);
    const tileY  = Math.floor(center.y / TILE_SIZE);

    const tilesX = Math.ceil((canvas.width  / (TILE_SIZE * scale))) + 3;
    const tilesY = Math.ceil((canvas.height / (TILE_SIZE * scale))) + 3;

    const needed: string[] = [];
    for (let dx = -Math.floor(tilesX / 2); dx <= Math.floor(tilesX / 2); dx++) {
      for (let dy = -Math.floor(tilesY / 2); dy <= Math.floor(tilesY / 2); dy++) {
        needed.push(`${fetchZoom}/${tileX + dx}/${tileY + dy}`);
      }
    }

    const esriUrl = (fz: number, ftx: number, fty: number) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${fz}/${fty}/${ftx}`;
    // Fetch Google tile via server-side proxy (POST /api/maps-session) so the API key stays server-side.
    // Returns a Promise that resolves to an object URL for the tile image blob.
    const fetchGoogleTile = async (fz: number, ftx: number, fty: number): Promise<string> => {
      const res = await fetch('/api/maps-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ z: fz, x: ftx, y: fty }),
      });
      if (!res.ok) throw new Error(`Tile ${res.status}`);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    };

    needed.forEach(key => {
      // ✓ Already cached and loaded — no re-fetch needed
      if (TILE_CACHE.has(key) && (TILE_CACHE.get(key) as any)._loaded) return;
      // ✓ Request already in-flight — avoid duplicates
      if (TILE_INFLIGHT.has(key)) return;

      const [fz, ftx, fty] = key.split('/').map(Number);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      TILE_INFLIGHT.add(key);

      const commitTile = (source: 'google' | 'esri') => {
        (img as any)._loaded  = true;
        (img as any)._source  = source;
        TILE_INFLIGHT.delete(key);
        TILE_CACHE.set(key, img);
        evictTileCache();
        setActiveTileSource(source);
        scheduleTileRedraw();  // batched — one rAF for all tiles in this batch
      };

      const tryEsri = () => {
        img.onerror = () => { TILE_INFLIGHT.delete(key); (img as any)._loaded = false; };
        img.onload  = () => {
          if (detectBlankTile(img)) {
            esriBlankZoomsRef.current.add(fz);
            if (hasGoogle && googleSessionRef.current) {
              // Fallback to Google proxy when ESRI tile is blank
              fetchGoogleTile(fz, ftx, fty)
                .then(objectUrl => {
                  img.onload = () => { URL.revokeObjectURL(objectUrl); commitTile('google'); };
                  img.onerror = () => { URL.revokeObjectURL(objectUrl); TILE_INFLIGHT.delete(key); };
                  img.src = objectUrl;
                })
                .catch(() => commitTile('esri'));
              return;
            }
          }
          commitTile('esri');
        };
        img.src = esriUrl(fz, ftx, fty);
      };

      if (forceEsri) {
        img.onload  = () => commitTile('esri');
        img.onerror = () => { TILE_INFLIGHT.delete(key); };
        img.src = esriUrl(Math.min(fz, ARCGIS_MAX_ZOOM), ftx, fty);
      } else if (forceGoogle || hasGoogle) {
        // Load Google tile via server-side proxy (keeps API key server-side)
        fetchGoogleTile(fz, ftx, fty)
          .then(objectUrl => {
            img.onload = () => { URL.revokeObjectURL(objectUrl); commitTile('google'); };
            img.onerror = () => { URL.revokeObjectURL(objectUrl); img.onerror = null; tryEsri(); };
            img.src = objectUrl;
          })
          .catch(() => tryEsri());
      } else {
        tryEsri();
      }

      // Pre-populate cache slot so duplicate needed[] entries skip immediately
      TILE_CACHE.set(key, img);
    });

    // Draw immediately with whatever tiles are already cached (instant feedback on pan)
    scheduleTileRedraw();
  }, [mapCenter, zoom, tileProvider, scheduleTileRedraw]);

  // Fetch high-res Google Solar RGB imagery when HD is on (covered addresses).
  // 404 = no coverage (rural) → keep base tiles. Loaded image drawn georeferenced in the redraw.
  useEffect(() => {
    if (!hdImagery || show3D) { hdImageRef.current = null; return; }
    let cancelled = false;
    setHdStatus('loading');
    (async () => {
      try {
        const res = await fetch(`/api/solar-rgb?lat=${mapCenter.lat}&lng=${mapCenter.lng}`);
        if (!res.ok) { if (!cancelled) { hdImageRef.current = null; setHdStatus('unavailable'); } return; }
        const data = await res.json();
        if (cancelled || !data?.imageDataUrl || !data?.bounds) { if (!cancelled) setHdStatus('unavailable'); return; }
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          hdImageRef.current = { img, bounds: data.bounds };
          setHdStatus('ready');
          scheduleTileRedraw();
        };
        img.onerror = () => { if (!cancelled) { hdImageRef.current = null; setHdStatus('unavailable'); } };
        img.src = data.imageDataUrl;
      } catch { if (!cancelled) { hdImageRef.current = null; setHdStatus('unavailable'); } }
    })();
    return () => { cancelled = true; };
  }, [hdImagery, show3D, mapCenter.lat, mapCenter.lng, scheduleTileRedraw]);

  // Debounced loadTiles — 80ms debounce prevents firing on every pixel of pan/zoom
  useEffect(() => {
    if (show3D) return;
    if (loadTilesDebounceRef.current) clearTimeout(loadTilesDebounceRef.current);
    loadTilesDebounceRef.current = setTimeout(() => {
      loadTilesDebounceRef.current = null;
      loadTiles();
    }, 80);
    return () => {
      if (loadTilesDebounceRef.current) clearTimeout(loadTilesDebounceRef.current);
    };
  }, [mapCenter, zoom, show3D, loadTiles]);

  // ── Draw canvas ────────────────────────────────────────────
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Draw map tiles
    // Tiles are stored at fetchZoom — clamped to GOOGLE_MAX_ZOOM=21 (or ARCGIS_MAX_ZOOM=19 fallback)
    // If display zoom > max, tiles are scaled up on canvas
    const _tileMaxZoom = googleSessionRef.current ? GOOGLE_MAX_ZOOM : ARCGIS_MAX_ZOOM;
    const fetchZoom = Math.min(zoom, _tileMaxZoom);
    const tileScale = Math.pow(2, zoom - fetchZoom); // 1 at zoom<=max, 2 at +1, 4 at +2
    const displayTileSize = TILE_SIZE * tileScale;

    // Center position in fetch-zoom world coords
    const fetchCenter = latLngToWorld(mapCenter.lat, mapCenter.lng, fetchZoom);

    mapTilesRef.current.forEach((img, key) => {
      if (!(img as any)._loaded || img.naturalWidth === 0) return;
      const [fz, ftx, fty] = key.split('/').map(Number);
      if (fz !== fetchZoom) return;

      // World position of this tile at fetch zoom
      const wx = ftx * TILE_SIZE;
      const wy = fty * TILE_SIZE;

      // Canvas position: offset from center, scaled up
      const cx = W / 2 + (wx - fetchCenter.x) * tileScale;
      const cy = H / 2 + (wy - fetchCenter.y) * tileScale;

      ctx.drawImage(img, cx, cy, displayTileSize, displayTileSize);
    });

    // High-res Solar RGB backdrop — overlays base tiles where available (covered addresses).
    // Gated on the ref (nulled when HD is off/unavailable) so this stays out of the redraw deps.
    const _hd = hdImageRef.current;
    if (_hd && _hd.img.naturalWidth > 0) {
      const nw = latLngToCanvas(_hd.bounds.north, _hd.bounds.west, mapCenter, zoom, W, H);
      const se = latLngToCanvas(_hd.bounds.south, _hd.bounds.east, mapCenter, zoom, W, H);
      ctx.drawImage(_hd.img, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
    }

    const mpp = metersPerPixel(mapCenter.lat, zoom);
    const pxPerM = 1 / mpp;

    // Draw roof planes — confirmed=solid amber, unconfirmed=dashed amber with edge-type coloring
    roofPlanes.forEach(plane => {
      if (plane.vertices.length < 2) return;
      const isUnconfirmed = plane.confirmed === false;
      const isSolarApi = plane.source === 'solar_api';

      // Build path
      ctx.beginPath();
      plane.vertices.forEach((v, i) => {
        const p = latLngToCanvas(v.lat, v.lng, mapCenter, zoom, W, H);
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();

      // Fill
      ctx.fillStyle = isUnconfirmed
        ? 'rgba(251, 191, 36, 0.07)'
        : 'rgba(251, 191, 36, 0.15)';
      ctx.fill();

      // Draw each edge with its edge type color/style
      if (plane.edgeTypes && plane.edgeTypes.length === plane.vertices.length) {
        const edgeColors: Record<string, string> = {
          ridge:   '#ef4444', // red — peak
          eave:    '#fbbf24', // amber — bottom edge
          hip:     '#f97316', // orange — diagonal
          valley:  '#60a5fa', // blue — valley
          rake:    '#a3e635', // lime — gable end
          wall:    '#94a3b8', // slate — wall
          unknown: '#fbbf24', // amber — default
        };
        for (let i = 0; i < plane.vertices.length; i++) {
          const v1 = plane.vertices[i];
          const v2 = plane.vertices[(i + 1) % plane.vertices.length];
          const p1 = latLngToCanvas(v1.lat, v1.lng, mapCenter, zoom, W, H);
          const p2 = latLngToCanvas(v2.lat, v2.lng, mapCenter, zoom, W, H);
          const edgeType = plane.edgeTypes[i] ?? 'unknown';
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = edgeColors[edgeType] ?? '#fbbf24';
          ctx.lineWidth = edgeType === 'ridge' ? 3.5 : edgeType === 'eave' ? 2.5 : 2;
          ctx.setLineDash(isUnconfirmed ? [5, 4] : edgeType === 'valley' ? [4, 3] : []);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        // Fallback: uniform stroke
        ctx.strokeStyle = isUnconfirmed ? '#fbbf24' : '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash(isUnconfirmed ? [6, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Label: pitch/azimuth at centroid
      if (plane.vertices.length >= 3) {
        const cx = plane.vertices.reduce((s, v) => s + v.lng, 0) / plane.vertices.length;
        const cy = plane.vertices.reduce((s, v) => s + v.lat, 0) / plane.vertices.length;
        const cp = latLngToCanvas(cy, cx, mapCenter, zoom, W, H);
        const azDir = ['N','NE','E','SE','S','SW','W','NW','N'][Math.round((plane.azimuth ?? 180) / 45) % 8];
        const label = `${(plane.pitch ?? 0).toFixed(0)}° ${azDir}`;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Background pill
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = isUnconfirmed ? 'rgba(251,191,36,0.80)' : 'rgba(245,158,11,0.90)';
        ctx.beginPath();
        const rx = cp.x - tw / 2, ry = cp.y - 7;
        ctx.roundRect(rx, ry, tw, 14, 4);
        ctx.fill();
        ctx.fillStyle = '#1e293b';
        ctx.fillText(label, cp.x, cp.y);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        // Unconfirmed badge
        if (isUnconfirmed) {
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(251,191,36,0.95)';
          ctx.fillText('⚠ Unconfirmed', cp.x, cp.y + 14);
          ctx.textAlign = 'left';
        }
      }
    });

    // ─── CAD Debug Overlay (v47.89) ──────────────────────────────────────────
    // Draws: (1) usable roof polygon after setback shrink, (2) row alignment lines
    // Toggle with showCADDebug state (default: off — see toolbar)
    if (showCADDebug && roofPlanes.length > 0) {
      roofPlanes.forEach(plane => {
        if (!plane.vertices || plane.vertices.length < 3) return;
        // v47.94: Use stored centroid -- same origin as CAD engine.
        // Fall back to vertex average only for legacy planes without stored centroid.
        const origin = {
          lat: plane.centroidLat ?? plane.vertices.reduce((s: number, v: {lat:number;lng:number}) => s + v.lat, 0) / plane.vertices.length,
          lng: plane.centroidLng ?? plane.vertices.reduce((s: number, v: {lat:number;lng:number}) => s + v.lng, 0) / plane.vertices.length,
        };
        const METERS_PER_DEG_LAT_D = 111320;
        const cosLatD = Math.cos(origin.lat * Math.PI / 180);

        // Convert vertices to local metric
        const localVerts = plane.vertices.map((v: {lat:number;lng:number}) => ({
          x: (v.lng - origin.lng) * cosLatD * METERS_PER_DEG_LAT_D,
          y: (v.lat - origin.lat) * METERS_PER_DEG_LAT_D,
        }));

        // Simple inward shrink for display (approximate — mirrors shrinkPolygon logic)
        const fireSetbackM = calcEffectiveSetback(fireSetbacks);
        const signedAreaDebug = (pts: {x:number;y:number}[]) => {
          let a = 0;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
          }
          return a / 2;
        };
        const ccwVerts = signedAreaDebug(localVerts) < 0 ? [...localVerts].reverse() : [...localVerts];
        const n = ccwVerts.length;
        const shrunkVerts: {x:number;y:number}[] = [];
        for (let i = 0; i < n; i++) {
          const prev = ccwVerts[(i + n - 1) % n];
          const curr = ccwVerts[i];
          const next = ccwVerts[(i + 1) % n];
          const e1x = curr.x - prev.x, e1y = curr.y - prev.y;
          const e2x = next.x - curr.x, e2y = next.y - curr.y;
          const len1 = Math.hypot(e1x, e1y), len2 = Math.hypot(e2x, e2y);
          if (len1 < 1e-9 || len2 < 1e-9) { shrunkVerts.push({...curr}); continue; }
          const n1x = e1y / len1, n1y = -e1x / len1;
          const n2x = e2y / len2, n2y = -e2x / len2;
          const bx = n1x + n2x, by = n1y + n2y;
          const blen = Math.hypot(bx, by);
          if (blen < 1e-9) {
            shrunkVerts.push({ x: curr.x + n1x * fireSetbackM, y: curr.y + n1y * fireSetbackM });
          } else {
            const bn = { x: bx / blen, y: by / blen };
            const dot = bn.x * n1x + bn.y * n1y;
            const miter = Math.min(fireSetbackM / Math.max(dot, 0.1), fireSetbackM * 3);
            shrunkVerts.push({ x: curr.x + bn.x * miter, y: curr.y + bn.y * miter });
          }
        }

        // Convert shrunk verts back to canvas coords
        const shrunkCanvas = shrunkVerts.map((v: {x:number;y:number}) => {
          const lat = origin.lat + v.y / METERS_PER_DEG_LAT_D;
          const lng = origin.lng + v.x / (cosLatD * METERS_PER_DEG_LAT_D);
          return latLngToCanvas(lat, lng, mapCenter, zoom, W, H);
        });

        if (shrunkCanvas.length >= 3) {
          // Draw usable polygon (cyan dashed)
          ctx.beginPath();
          shrunkCanvas.forEach((p: {x:number;y:number}, i: number) => {
            i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.90)'; // cyan
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(34, 211, 238, 0.06)';
          ctx.fill();

          // Draw row alignment lines (azimuth-perpendicular lines across usable polygon)
          // Rotate usable polygon to azimuth frame to find row Y positions
          const az = plane.azimuth ?? 180;
          const rotAngle = (90 - az) * Math.PI / 180;
          const cosR = Math.cos(rotAngle), sinR = Math.sin(rotAngle);
          const rotated = shrunkVerts.map((v: {x:number;y:number}) => ({
            x: v.x * cosR - v.y * sinR,
            y: v.x * sinR + v.y * cosR,
          }));
          let minY_r = Infinity, maxY_r = -Infinity;
          let minX_r = Infinity, maxX_r = -Infinity;
          for (const rv of rotated) {
            if (rv.x < minX_r) minX_r = rv.x;
            if (rv.x > maxX_r) maxX_r = rv.x;
            if (rv.y < minY_r) minY_r = rv.y;
            if (rv.y > maxY_r) maxY_r = rv.y;
          }
          // v47.98: use CAD frame panelY (up-slope dimension) for row step
          const planeOrient = orientation;
          const cadPanelY = planeOrient === 'landscape' ? selectedPanel.width : selectedPanel.height;
          const rowStep = cadPanelY + rowSpacing;
          const pxPerM = 1 / metersPerPixel(mapCenter.lat, zoom);

          ctx.strokeStyle = 'rgba(34, 211, 238, 0.40)';
          ctx.lineWidth = 0.75;
          ctx.setLineDash([3, 4]);

          for (let y = minY_r; y <= maxY_r; y += rowStep) {
            // Row line in rotated metric frame: horizontal line at y, from minX_r to maxX_r
            // Rotate back two endpoints
            const cosRBack = Math.cos(-rotAngle), sinRBack = Math.sin(-rotAngle);
            const lx1 = minX_r * cosRBack - y * sinRBack;
            const ly1 = minX_r * sinRBack + y * cosRBack;
            const lx2 = maxX_r * cosRBack - y * sinRBack;
            const ly2 = maxX_r * sinRBack + y * cosRBack;

            const lat1 = origin.lat + ly1 / METERS_PER_DEG_LAT_D;
            const lng1 = origin.lng + lx1 / (cosLatD * METERS_PER_DEG_LAT_D);
            const lat2 = origin.lat + ly2 / METERS_PER_DEG_LAT_D;
            const lng2 = origin.lng + lx2 / (cosLatD * METERS_PER_DEG_LAT_D);

            const p1c = latLngToCanvas(lat1, lng1, mapCenter, zoom, W, H);
            const p2c = latLngToCanvas(lat2, lng2, mapCenter, zoom, W, H);
            ctx.beginPath();
            ctx.moveTo(p1c.x, p1c.y);
            ctx.lineTo(p2c.x, p2c.y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }
      });
    }
    // ─── End CAD Debug Overlay ──────────────────────────────────────────────

    // v47.94: Validation Overlay -- roof polygon + CAD bbox + panel centers
    // When showCADDebug is ON, draw three layers that must all align:
    //   1. Roof polygon outline (orange -- same as roof plane)
    //   2. CAD grid bounding box (blue rect from min/max of panel lat/lng)
    //   3. Panel center dots (yellow)
    // All three must overlap exactly to confirm coordinate frame alignment.
    if (showCADDebug && panels.length > 0) {
      // Group panels by their plane (approximate: use nearest plane centroid)
      roofPlanes.forEach(plane => {
        if (!plane.vertices || plane.vertices.length < 3) return;

        // Panels belonging to this plane (filter by proximity to centroid)
        const cLat = plane.centroidLat ?? plane.vertices.reduce((s: number, v: {lat:number;lng:number}) => s + v.lat, 0) / plane.vertices.length;
        const cLng = plane.centroidLng ?? plane.vertices.reduce((s: number, v: {lat:number;lng:number}) => s + v.lng, 0) / plane.vertices.length;

        // Use panels with ROOF placementType (or all roof panels if no placementType)
        const planePanels = panels.filter(p =>
          (p.placementType === 'ROOF' || p.systemType === 'roof') &&
          p.layoutSource !== 'MANUAL'
        );

        if (planePanels.length === 0) return;

        // 1. CAD bbox: min/max lat/lng of all panel centers
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const p of planePanels) {
          if (p.lat < minLat) minLat = p.lat;
          if (p.lat > maxLat) maxLat = p.lat;
          if (p.lng < minLng) minLng = p.lng;
          if (p.lng > maxLng) maxLng = p.lng;
        }

        // Draw CAD bounding box (blue)
        const bbTL = latLngToCanvas(maxLat, minLng, mapCenter, zoom, W, H);
        const bbTR = latLngToCanvas(maxLat, maxLng, mapCenter, zoom, W, H);
        const bbBR = latLngToCanvas(minLat, maxLng, mapCenter, zoom, W, H);
        const bbBL = latLngToCanvas(minLat, minLng, mapCenter, zoom, W, H);

        ctx.beginPath();
        ctx.moveTo(bbTL.x, bbTL.y);
        ctx.lineTo(bbTR.x, bbTR.y);
        ctx.lineTo(bbBR.x, bbBR.y);
        ctx.lineTo(bbBL.x, bbBL.y);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.90)'; // blue
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 2. Panel center dots (yellow)
        ctx.fillStyle = 'rgba(253, 224, 71, 0.85)';
        for (const p of planePanels) {
          const pc = latLngToCanvas(p.lat, p.lng, mapCenter, zoom, W, H);
          ctx.beginPath();
          ctx.arc(pc.x, pc.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // 3. Centroid dot (red) -- the coordinate origin
        const cc = latLngToCanvas(cLat, cLng, mapCenter, zoom, W, H);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
        ctx.beginPath();
        ctx.arc(cc.x, cc.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.70)';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('origin', cc.x + 5, cc.y - 3);
      });
    }
    // v47.94 End Validation Overlay

    // v30.9: Draw fire setback zones (red restricted / green buildable)
    if (showSetbackZones && setbackZones.length > 0) {
      setbackZones.forEach(zone => {
        if (zone.vertices.length < 3) return;
        ctx.beginPath();
        zone.vertices.forEach((v, i) => {
          const p = latLngToCanvas(v.lat, v.lng, mapCenter, zoom, W, H);
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        if (zone.type === 'restricted') {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
        } else {
          ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
          ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
        }
        ctx.lineWidth = 1.5;
        ctx.setLineDash(zone.type === 'restricted' ? [4, 3] : []);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // Draw ground area
    if (groundArea.length >= 2) {
      ctx.beginPath();
      groundArea.forEach((v, i) => {
        const p = latLngToCanvas(v.lat, v.lng, mapCenter, zoom, W, H);
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      if (groundArea.length >= 3) ctx.closePath();
      ctx.fillStyle = 'rgba(20, 184, 166, 0.12)';
      ctx.strokeStyle = '#14b8a6';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    // Draw fence line
    if (fenceLine.length >= 2) {
      ctx.beginPath();
      fenceLine.forEach((v, i) => {
        const p = latLngToCanvas(v.lat, v.lng, mapCenter, zoom, W, H);
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Draw fence posts
      fenceLine.forEach(v => {
        const p = latLngToCanvas(v.lat, v.lng, mapCenter, zoom, W, H);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#a855f7';
        ctx.fill();
      });
    }

    // Draw panels
    if (showPanels) {
      // v47.105: Corner-based panel rendering — no canvas rotation needed.
      // Compute the 4 geographic corners of each panel from its center lat/lng,
      // azimuth, widthFeet (along-ridge), and heightFeet (up-slope).
      // This is correct for ALL azimuth values without any rotation formula hacks.
      //
      // Ridge direction = azimuth - 90° (perpendicular to slope, rightward)
      // Slope direction = azimuth (up the slope)
      // hW = widthFeet/2 * METERS_PER_FOOT  (half along-ridge)
      // hH = heightFeet/2 * METERS_PER_FOOT (half up-slope)
      // Corner offsets in meters from center:
      //   BL: -hW along ridge, -hH up slope
      //   BR: +hW along ridge, -hH up slope
      //   TR: +hW along ridge, +hH up slope
      //   TL: -hW along ridge, +hH up slope
      const METERS_PER_DEG_LAT = 111320.0;
      const DEG_TO_RAD_PANEL = Math.PI / 180;

      panels.forEach(panel => {
        const orient = panel.orientation ?? 'portrait';
        // Determine along-ridge and up-slope dimensions in meters
        let hW: number, hH: number;
        if (panel.widthFeet !== undefined && panel.heightFeet !== undefined) {
          hW = (panel.widthFeet  * METERS_PER_FOOT) / 2;  // half along-ridge
          hH = (panel.heightFeet * METERS_PER_FOOT) / 2;  // half up-slope
        } else {
          // Legacy fallback
          const pXm = orient === 'landscape' ? selectedPanel.height : selectedPanel.width;
          const pYm = orient === 'landscape' ? selectedPanel.width  : selectedPanel.height;
          hW = pXm / 2;
          hH = pYm / 2;
        }

        const panelAz = panel.azimuth ?? 180;
        const azRad   = panelAz * DEG_TO_RAD_PANEL;
        const ridgeRad = (panelAz - 90) * DEG_TO_RAD_PANEL;

        // Unit vectors
        const ridgeNorth = Math.cos(ridgeRad);
        const ridgeEast  = Math.sin(ridgeRad);
        const slopeNorth = Math.cos(azRad);
        const slopeEast  = Math.sin(azRad);

        const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(panel.lat * DEG_TO_RAD_PANEL);

        // Compute 4 corners in canvas pixels: BL, BR, TR, TL
        const cornerSigns = [[-1,-1],[+1,-1],[+1,+1],[-1,+1]] as const;
        const cornerPx = cornerSigns.map(([sr, ss]) => {
          const northM = sr * hW * ridgeNorth + ss * hH * slopeNorth;
          const eastM  = sr * hW * ridgeEast  + ss * hH * slopeEast;
          const cLat = panel.lat + northM / METERS_PER_DEG_LAT;
          const cLng = panel.lng + eastM  / metersPerDegLng;
          return latLngToCanvas(cLat, cLng, mapCenter, zoom, W, H);
        });

        const isSelected = selectedPanelIds.has(panel.id);
        const sType = panel.systemType ?? project.systemType;
        const color = sType === 'roof' ? '#f59e0b' :
                      sType === 'ground' ? '#14b8a6' : '#a855f7';

        ctx.save();

        // Build polygon path from corners
        ctx.beginPath();
        ctx.moveTo(cornerPx[0].x, cornerPx[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(cornerPx[i].x, cornerPx[i].y);
        ctx.closePath();

        // ── Panel rendering: shadow → gradient fill → grid lines → border ──────────
        // Panel dimensions in pixels (for gradient and grid)
        const dxRidge = cornerPx[1].x - cornerPx[0].x;
        const dyRidge = cornerPx[1].y - cornerPx[0].y;
        const gridRot = Math.atan2(dyRidge, dxRidge);
        const pwPx = Math.hypot(dxRidge, dyRidge);   // along-ridge pixel size
        const dxSlope = cornerPx[2].x - cornerPx[1].x;
        const dySlope = cornerPx[2].y - cornerPx[1].y;
        const phPx = Math.hypot(dxSlope, dySlope);   // up-slope pixel size
        const pCtr = latLngToCanvas(panel.lat, panel.lng, mapCenter, zoom, W, H);

        // 1. Drop shadow (stronger, more professional)
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur  = Math.max(2, pwPx * 0.08);
        ctx.shadowOffsetX = Math.max(1, pwPx * 0.03);
        ctx.shadowOffsetY = Math.max(1, phPx * 0.03);

        // 2. Panel body with subtle gradient for depth
        // Gradient runs from top-left (lighter) to bottom-right (darker) in screen space
        if (isSelected) {
          ctx.fillStyle   = '#ffffff';
          ctx.globalAlpha = 0.95;
          ctx.fill();
        } else {
          // Build gradient aligned with panel slope direction (BL→TR)
          const gx1 = cornerPx[0].x, gy1 = cornerPx[0].y;  // BL
          const gx2 = cornerPx[2].x, gy2 = cornerPx[2].y;  // TR
          // Parse base color to rgb for gradient stops with explicit alpha
          // color is '#rrggbb' hex — extract components for rgba()
          const _r = parseInt(color.slice(1,3),16);
          const _g = parseInt(color.slice(3,5),16);
          const _b = parseInt(color.slice(5,7),16);
          try {
            const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
            // Subtle gradient: top-left slightly lighter, bottom-right slightly darker
            grad.addColorStop(0,   `rgba(${Math.min(255,_r+18)},${Math.min(255,_g+14)},${Math.min(255,_b+8)},0.92)`);
            grad.addColorStop(0.5, `rgba(${_r},${_g},${_b},0.88)`);
            grad.addColorStop(1,   `rgba(${Math.max(0,_r-20)},${Math.max(0,_g-18)},${Math.max(0,_b-10)},0.82)`);
            ctx.fillStyle   = grad;
            ctx.globalAlpha = 1.0;  // alpha is in the gradient stops
          } catch {
            ctx.fillStyle   = color;
            ctx.globalAlpha = 0.85;
          }
          ctx.fill();
        }
        ctx.shadowColor = 'transparent';

        // 3. Cell grid lines — very low opacity, clipped to polygon
        ctx.save();
        ctx.globalAlpha = isSelected ? 0.22 : 0.18;  // very subtle
        ctx.strokeStyle = isSelected ? '#f59e0b' : 'rgba(255,255,255,0.9)';
        ctx.lineWidth   = 0.4;
        ctx.beginPath();
        ctx.moveTo(cornerPx[0].x, cornerPx[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(cornerPx[i].x, cornerPx[i].y);
        ctx.closePath();
        ctx.clip();
        ctx.translate(pCtr.x, pCtr.y);
        ctx.rotate(gridRot);
        const cols = 6, rows = 10;
        for (let c = 1; c < cols; c++) {
          ctx.beginPath();
          ctx.moveTo(-pwPx / 2 + (pwPx / cols) * c, -phPx / 2);
          ctx.lineTo(-pwPx / 2 + (pwPx / cols) * c,  phPx / 2);
          ctx.stroke();
        }
        for (let r = 1; r < rows; r++) {
          ctx.beginPath();
          ctx.moveTo(-pwPx / 2, -phPx / 2 + (phPx / rows) * r);
          ctx.lineTo( pwPx / 2, -phPx / 2 + (phPx / rows) * r);
          ctx.stroke();
        }
        ctx.restore();

        // 4. Outer border — thicker, crisper
        ctx.globalAlpha = isSelected ? 1.0 : 0.95;
        ctx.strokeStyle = isSelected ? '#fbbf24' : 'rgba(255,255,255,0.92)';
        ctx.lineWidth   = isSelected ? 2.5 : 1.5;  // thicker outer border
        ctx.beginPath();
        ctx.moveTo(cornerPx[0].x, cornerPx[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(cornerPx[i].x, cornerPx[i].y);
        ctx.closePath();
        ctx.stroke();

        // v47.100: Strategy debug label
        if (showCADDebug && panel.layoutStrategy) {
          const labelText = panel.layoutStrategy === 'PORTRAIT' ? 'P'
                          : panel.layoutStrategy === 'MIXED'    ? 'M'
                          : 'L';
          const labelColor = panel.layoutStrategy === 'PORTRAIT' ? '#22d3ee'
                           : panel.layoutStrategy === 'MIXED'    ? '#a78bfa'
                           : '#fb923c';
          ctx.globalAlpha = 0.95;
          ctx.font = `bold ${Math.max(7, Math.min(11, pwPx * 0.28))}px monospace`;
          ctx.fillStyle = labelColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, pCtr.x, pCtr.y);
        }

        ctx.restore();
      });
    }

    // v30.9: Draw multi-row placement guide line
    if (multiRowMode && multiRowStart) {
      const startPx = latLngToCanvas(multiRowStart.lat, multiRowStart.lng, mapCenter, zoom, W, H);
      // Draw start point marker
      ctx.beginPath();
      ctx.arc(startPx.x, startPx.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Draw guide line to hover position
      if (hoverPos) {
        const endPx = latLngToCanvas(hoverPos.lat, hoverPos.lng, mapCenter, zoom, W, H);
        ctx.beginPath();
        ctx.moveTo(startPx.x, startPx.y);
        ctx.lineTo(endPx.x, endPx.y);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label
        ctx.fillStyle = 'rgba(15,23,42,0.85)';
        ctx.fillRect(endPx.x + 8, endPx.y - 14, 90, 18);
        ctx.fillStyle = '#fbbf24';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${multiRowCount} rows — click end`, endPx.x + 12, endPx.y - 2);
      }
    }

    // Draw current drawing points
    if (drawnPoints.length > 0) {
      ctx.beginPath();
      drawnPoints.forEach((p, i) => {
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      const color = drawingMode === 'draw_roof' ? '#fbbf24' :
                    drawingMode === 'draw_ground' ? '#14b8a6' : '#a855f7';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      drawnPoints.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? 'white' : color;
        ctx.fill();
        ctx.strokeStyle = i === 0 ? color : 'white';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // v47.96: Snap-to-close indicator -- green ring on first point when 3+ points drawn
      if (drawnPoints.length >= 3 && hoverPos) {
        const first = drawnPoints[0];
        const hpx = latLngToCanvas(hoverPos.lat, hoverPos.lng, mapCenter, zoom, W, H);
        const nearFirst = Math.abs(hpx.x - first.x) < 18 && Math.abs(hpx.y - first.y) < 18;
        // Always show subtle green ring on first point when polygon can be closed
        ctx.beginPath();
        ctx.arc(first.x, first.y, nearFirst ? 14 : 10, 0, Math.PI * 2);
        ctx.strokeStyle = nearFirst ? '#22c55e' : 'rgba(34,197,94,0.5)';
        ctx.lineWidth = nearFirst ? 2.5 : 1.5;
        ctx.setLineDash(nearFirst ? [] : [3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (nearFirst) {
          // Label: 'Click to close'
          ctx.fillStyle = 'rgba(15,23,42,0.9)';
          ctx.fillRect(first.x + 16, first.y - 14, 88, 18);
          ctx.fillStyle = '#22c55e';
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('Click to close', first.x + 20, first.y - 1);
        }
      }
    }

    // Draw measure tool
    if (drawingMode === 'measure' && measurePoints.length > 0) {
      ctx.beginPath();
      measurePoints.forEach((p, i) => {
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      measurePoints.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#22d3ee';
        ctx.fill();
      });
      if (measureDistance !== null) {
        const last = measurePoints[measurePoints.length - 1];
        ctx.fillStyle = 'rgba(15,23,42,0.85)';
        ctx.fillRect(last.x + 8, last.y - 14, 80, 20);
        ctx.fillStyle = '#22d3ee';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillText(`${measureDistance.toFixed(1)}m`, last.x + 12, last.y + 1);
      }
    }

    // Compass
    drawCompass(ctx, W - 50, 50);
    // Scale bar
    drawScaleBar(ctx, W, H, mpp);
    // Tile source badge (bottom-left, above scale bar)
    drawTileSourceBadge(ctx, W, H, activeTileSource, zoom);
    // Panel dimension legend (bottom-right corner) — only when panels exist
    if (panels.length > 0) {
      drawPanelDimensionLegend(ctx, W, H, mpp, selectedPanel, orientation === 'hybrid' ? 'portrait' : orientation);
    }

  // tileRedrawTick replaces mapTiles in deps — avoids new drawCanvas on every individual tile load
  }, [mapCenter, zoom, tileRedrawTick, panels, roofPlanes, groundArea, fenceLine,
      drawnPoints, selectedPanelIds, selectedPanel, drawingMode, showPanels,
      measurePoints, measureDistance, showSetbackZones, setbackZones, showCADDebug,
      multiRowMode, multiRowStart, hoverPos, multiRowCount, activeTileSource, orientation]);

  function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(5, 4); ctx.lineTo(0, 0); ctx.lineTo(-5, 4);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 13); ctx.lineTo(5, -4); ctx.lineTo(0, 0); ctx.lineTo(-5, -4);
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -16);
    ctx.restore();
  }

  function drawTileSourceBadge(
    ctx: CanvasRenderingContext2D,
    W: number, H: number,
    source: 'google' | 'esri',
    currentZoom: number
  ) {
    const label = source === 'google'
      ? `📷 Google z${currentZoom}`
      : `🌍 ESRI z${Math.min(currentZoom, 19)}`;
    const color = source === 'google' ? '#60a5fa' : '#fbbf24';
    ctx.save();
    ctx.font = 'bold 9px Inter, sans-serif';
    const tw = ctx.measureText(label).width;
    const x = 20, y = H - 52;
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(x - 4, y - 11, tw + 10, 16);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  function drawScaleBar(ctx: CanvasRenderingContext2D, W: number, H: number, mpp: number) {
    const scaleMeters = 10;
    const scalePixels = scaleMeters / mpp;
    const x = 20, y = H - 30;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(x - 4, y - 14, scalePixels + 8, 22);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + scalePixels, y);
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
    ctx.moveTo(x + scalePixels, y - 5); ctx.lineTo(x + scalePixels, y + 5);
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${scaleMeters}m`, x + scalePixels / 2, y - 2);
    ctx.restore();
  }

  function drawPanelDimensionLegend(
    ctx: CanvasRenderingContext2D,
    W: number, H: number, mpp: number,
    panel: { id?: string; manufacturer?: string; model?: string; width: number; height: number; wattage: number },
    orientation: 'portrait' | 'landscape' | 'hybrid'
  ) {
    const pW = orientation === 'landscape' ? panel.height : panel.width;  // meters (along-ridge visual)
    const pH = orientation === 'landscape' ? panel.width  : panel.height; // meters (up-slope visual)
    const pWpx = pW / mpp;
    const pHpx = pH / mpp;
    const x = W - pWpx - 16;
    const y = H - pHpx - 36;

    // Count rows and cols from placed panels
    const rowSet = new Set(panels.map(p => p.row ?? 0));
    const colSet = new Set(panels.map(p => p.col ?? 0));
    const rowCount = rowSet.size;
    const colCount = colSet.size;

    ctx.save();
    // ── MODULE DEBUG BADGE (top-left corner) ─────────────────────────────────
    const badgeLines = [
      `MODULE: ${panel.manufacturer ?? ''} ${panel.model ?? ''}`,
      `ID: ${panel.id ?? 'unknown'}`,
      `RAW: ${(panel.width * 100).toFixed(1)}cm × ${(panel.height * 100).toFixed(1)}cm`,
      `     (${(panel.width * 39.3701).toFixed(1)}" × ${(panel.height * 39.3701).toFixed(1)}")`,
      `ORIENT: ${orientation.toUpperCase()}`,
      `VISUAL: ${(pW * 100).toFixed(1)}cm × ${(pH * 100).toFixed(1)}cm`,
      `        (${(pW * 39.3701).toFixed(1)}" × ${(pH * 39.3701).toFixed(1)}")`,
      `ROWS: ${rowCount}  COLS: ${colCount}  TOTAL: ${panels.length}`,
    ];
    const badgeX = 8;
    const badgeY = 8;
    const lineH = 13;
    const badgeW = 240;
    const badgeH = badgeLines.length * lineH + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.80)';
    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.strokeStyle = 'rgba(251,191,36,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    badgeLines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#fbbf24' : i === 7 ? '#34d399' : '#e2e8f0';
      ctx.fillText(line, badgeX + 6, badgeY + lineH * (i + 1));
    });

    // ── PANEL BOX (bottom-right, actual scale) ────────────────────────────────
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(x - 8, y - 20, pWpx + 50, pHpx + 48);
    ctx.fillStyle = 'rgba(245,158,11,0.75)';
    ctx.fillRect(x, y, pWpx, pHpx);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, pWpx, pHpx);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.5;
    const cellCols = 6, cellRows = 10;
    for (let c = 1; c < cellCols; c++) {
      ctx.beginPath();
      ctx.moveTo(x + (pWpx / cellCols) * c, y);
      ctx.lineTo(x + (pWpx / cellCols) * c, y + pHpx);
      ctx.stroke();
    }
    for (let r = 1; r < cellRows; r++) {
      ctx.beginPath();
      ctx.moveTo(x, y + (pHpx / cellRows) * r);
      ctx.lineTo(x + pWpx, y + (pHpx / cellRows) * r);
      ctx.stroke();
    }
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(pW * 100).toFixed(0)}cm`, x + pWpx / 2, y - 6);
    ctx.save();
    ctx.translate(x + pWpx + 12, y + pHpx / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${(pH * 100).toFixed(0)}cm`, 0, 0);
    ctx.restore();
    ctx.fillStyle = 'white';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${panel.wattage}W`, x + pWpx / 2, y + pHpx + 12);
    ctx.fillText(orientation === 'landscape' ? 'Landscape' : 'Portrait', x + pWpx / 2, y + pHpx + 23);
    ctx.restore();
  }

  useEffect(() => { drawCanvas(); }, [drawCanvas]);

  // ── Canvas resize ──────────────────────────────────────────
  useEffect(() => {
    // Re-run when switching to 2D so canvas gets sized correctly
    if (show3D) return; // canvas not in DOM when 3D is active
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const w = container.offsetWidth || container.clientWidth;
      const h = container.offsetHeight || container.clientHeight;
      if (w > 0 && h > 0) { canvas.width = w; canvas.height = h; }
      drawCanvas();
    };
    // Small delay to let React finish rendering the canvas into the DOM
    const t1 = setTimeout(resize, 100);
    const t2 = setTimeout(resize, 300);
    const t3 = setTimeout(resize, 800);
    window.addEventListener('resize', resize);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); window.removeEventListener('resize', resize); };
  }, [drawCanvas, show3D]);

  // ── Native (non-passive) wheel listener for 2D map zoom ─────────────────
  // React 18 registers synthetic onWheel listeners as PASSIVE at the document
  // root, which means e.preventDefault() inside onWheel is silently ignored —
  // the browser still scrolls the page underneath the canvas.
  //
  // Fixes applied here (all require a non-passive listener):
  //   1. e.preventDefault() actually works → page no longer scrolls while zooming
  //   2. Cursor-aware zoom: the geographic point under the cursor stays fixed
  //      instead of zooming toward the canvas center (standard map behaviour)
  //   3. Fractional zoom: each notch moves by 0.75 levels instead of 1.0,
  //      making the zoom feel smooth rather than snapping between discrete levels
  //      (tile rendering still uses Math.floor/Math.min for fetch zoom, so this
  //       only affects the continuous scale — no extra tile fetches)
  useEffect(() => {
    if (show3D) return; // canvas not in DOM in 3D mode
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ZOOM_STEP = 0.75; // fractional levels per notch — smooth but not slow
    const ZOOM_MIN  = 14;
    const ZOOM_MAX  = 21;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Direction only — ignore magnitude to treat all mice/trackpads equally.
      const direction = e.deltaY < 0 ? 1 : -1;

      const rect  = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const W = canvas.width;
      const H = canvas.height;

      setZoom(prevZoom => {
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevZoom + direction * ZOOM_STEP));
        if (newZoom === prevZoom) return prevZoom;

        // Cursor-aware zoom: keep the lat/lng under the cursor fixed.
        // 1. Find the lat/lng at the cursor position BEFORE zoom change.
        // 2. After zoom change the canvas scale changes — shift mapCenter so
        //    that same lat/lng lands back under the cursor.
        //
        // latLngToWorld / worldToLatLng use mapCenter from closure (stale-safe
        // because we're computing the DELTA, not an absolute position).
        const centerWorld = latLngToWorld(mapCenter.lat, mapCenter.lng, prevZoom);
        // World coords of cursor at old zoom
        const cursorWorldX = centerWorld.x + (cursorX - W / 2);
        const cursorWorldY = centerWorld.y + (cursorY - H / 2);
        // Same world point at new zoom (world coords scale with 2^zoom)
        const scale = Math.pow(2, newZoom - prevZoom);
        const newCursorWorldX = cursorWorldX * scale;
        const newCursorWorldY = cursorWorldY * scale;
        // New center world coords so cursor stays fixed
        const newCenterWorldX = newCursorWorldX - (cursorX - W / 2);
        const newCenterWorldY = newCursorWorldY - (cursorY - H / 2);
        const newCenter = worldToLatLng(newCenterWorldX, newCenterWorldY, newZoom);
        setMapCenter(newCenter);

        return newZoom;
      });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [show3D, mapCenter]); // mapCenter in deps so cursor-world math uses fresh value
  // ────────────────────────────────────────────────────────────────────────

  // v31.1: Global keyboard shortcuts — tool switching + panel deletion + escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      switch (e.key) {
        case 'v': case 'V':
          e.preventDefault();
          setDrawingMode('select');
          setMultiRowMode(false); setMultiRowStart(null); setMultiRowEnd(null);
          break;
        case 'r': case 'R':
          e.preventDefault();
          setDrawingMode('draw_roof'); setActiveZoneType('roof');
          setMultiRowMode(false); setMultiRowStart(null); setMultiRowEnd(null);
          break;
        case 'g': case 'G':
          e.preventDefault();
          setDrawingMode('draw_ground'); setActiveZoneType('ground');
          setMultiRowMode(false); setMultiRowStart(null); setMultiRowEnd(null);
          break;
        case 'f': case 'F':
          e.preventDefault();
          setDrawingMode('draw_fence'); setActiveZoneType('fence');
          setMultiRowMode(false); setMultiRowStart(null); setMultiRowEnd(null);
          break;
        case 'm': case 'M':
          e.preventDefault();
          setDrawingMode('measure');
          setMultiRowMode(false); setMultiRowStart(null); setMultiRowEnd(null);
          break;
        case 'Delete': case 'Backspace':
          if (selectedPanelIds.size > 0) {
            e.preventDefault();
            setPanels(prev => prev.filter(p => !selectedPanelIds.has(p.id)));
            setSelectedPanelIds(new Set());
          }
          break;
        case 'Escape':
          if (multiRowMode) {
            setMultiRowMode(false); setMultiRowStart(null); setMultiRowEnd(null);
          } else if (drawingMode !== 'select') {
            setDrawingMode('select');
            setDrawnPoints([]);
          }
          setSelectedPanelIds(new Set());
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPanelIds, multiRowMode, drawingMode]);

  // ── Mouse handlers ─────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only left-click (button=0) should pan/drag.
    // Middle-click (button=1) and right-click (button=2) must not trigger drag —
    // middle-click is a scroll/pan gesture handled by the OS/browser natively, and
    // accidentally entering drag state causes the map to jump when the mouse moves
    // even slightly during the middle-button press.
    if (e.button !== 0) return;
    if (drawingMode === 'select') {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setDragStartCenter({ ...mapCenter });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const pos = canvasToLatLng(cx, cy, mapCenter, zoom, canvas.width, canvas.height);
      setHoverPos(pos);
    }
    if (!isDragging || drawingMode !== 'select') return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const mpp = metersPerPixel(mapCenter.lat, zoom);
    const degPerPixelLat = mpp / 111320;
    const degPerPixelLng = mpp / (111320 * Math.cos(mapCenter.lat * Math.PI / 180));
    setMapCenter({
      lat: dragStartCenter.lat - dy * degPerPixelLat,
      lng: dragStartCenter.lng - dx * degPerPixelLng,
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only process left-click release — middle/right button releases must not
    // trigger a canvas click or interfere with drag state.
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { lat, lng } = canvasToLatLng(x, y, mapCenter, zoom, canvas.width, canvas.height);

    const wasDrag = isDragging && (Math.abs(e.clientX - dragStart.x) > 5 || Math.abs(e.clientY - dragStart.y) > 5);
    setIsDragging(false);

    if (!wasDrag) {
      handleCanvasClick(x, y, lat, lng, canvas);
    }
  };

  // ── Multi-row placement handler ──────────────────────────────────────────────
  const handleMultiRowClick = (lat: number, lng: number) => {
    if (!multiRowStart) {
      setMultiRowStart({ lat, lng });
      toast.info('Multi-Row Tool', 'First point set — click end of row to place panels');
    } else {
      const layoutId = uuidv4();
      const minSpacing = calcMinRowSpacing(tilt, selectedPanel.height, mapCenter.lat);
      const newPanels = generateMultipleRows({
        layoutId,
        startLat: multiRowStart.lat, startLng: multiRowStart.lng,
        endLat: lat, endLng: lng,
        rowCount: multiRowCount,
        rowSpacingM: Math.max(rowSpacing, minSpacing),
        panel: selectedPanel, orientation, tilt, azimuth,
        panelSpacingM: panelSpacing, systemType: activeZoneType,
      });
      if (newPanels.length > 0) {
        setPanels(prev => [...prev, ...newPanels]);
        toast.success('Multi-Row placed', `${multiRowCount} rows · ${newPanels.length} panels · ${(calculateSystemSize(newPanels)).toFixed(2)} kW`);
      }
      setMultiRowStart(null);
      setMultiRowEnd(null);
      setMultiRowMode(false);
    }
  };

  const handleCanvasClick = (x: number, y: number, lat: number, lng: number, canvas: HTMLCanvasElement) => {
    // v31.1: Multi-row placement mode takes priority
    if (multiRowMode) {
      handleMultiRowClick(lat, lng);
      return;
    }
    // v31.1: Placement safety guard — only place geometry when a draw tool is active
    // Select mode NEVER places panels (prevents accidental placement)
    if (drawingMode === 'draw_roof' || drawingMode === 'draw_ground' || drawingMode === 'draw_fence') {
      // v47.96: Snap-to-first-point -- if 3+ points drawn and click is near first point, close polygon
      if (drawnPoints.length >= 3) {
        const first = drawnPoints[0];
        const snapDist = 18; // pixels -- generous snap radius
        if (Math.abs(x - first.x) < snapDist && Math.abs(y - first.y) < snapDist) {
          finalizeDrawing();
          return;
        }
      }
      setDrawnPoints(prev => [...prev, { x, y, lat, lng }]);
    } else if (drawingMode === 'measure') {
      const newPts = [...measurePoints, { x, y, lat, lng }];
      setMeasurePoints(newPts);
      if (newPts.length >= 2) {
        const p1 = newPts[newPts.length - 2];
        const p2 = newPts[newPts.length - 1];
        const dlat = (p2.lat - p1.lat) * 111320;
        const dlng = (p2.lng - p1.lng) * 111320 * Math.cos(p1.lat * Math.PI / 180);
        setMeasureDistance(Math.sqrt(dlat * dlat + dlng * dlng));
      }
    } else if (drawingMode === 'select') {
      const mpp = metersPerPixel(mapCenter.lat, zoom);
      const pxPerM = 1 / mpp;

      let clicked = false;
      // v47.99: use LECS feet dims for hit box (matches actual drawn rectangle)
      panels.forEach(panel => {
        const orient = panel.orientation ?? 'portrait';
        let panelXm: number, panelYm: number;
        if (panel.widthFeet !== undefined && panel.heightFeet !== undefined) {
          panelXm = panel.widthFeet  * METERS_PER_FOOT;
          panelYm = panel.heightFeet * METERS_PER_FOOT;
        } else {
          panelXm = orient === 'landscape' ? selectedPanel.height : selectedPanel.width;
          panelYm = orient === 'landscape' ? selectedPanel.width  : selectedPanel.height;
        }
        const pw = panelXm * pxPerM;
        const ph = panelYm * pxPerM;
        const p = latLngToCanvas(panel.lat, panel.lng, mapCenter, zoom, canvas.width, canvas.height);
        // Use generous hit tolerance (+4px) to make panels easier to click
        if (Math.abs(x - p.x) < pw / 2 + 4 && Math.abs(y - p.y) < ph / 2 + 4) {
          setSelectedPanelIds(prev => {
            const next = new Set(prev);
            next.has(panel.id) ? next.delete(panel.id) : next.add(panel.id);
            return next;
          });
          clicked = true;
        }
      });
      if (!clicked) setSelectedPanelIds(new Set());
    }
  };

  const handleWheel = (_e: React.WheelEvent<HTMLCanvasElement>) => {
    // Intentionally empty — all scroll-zoom logic is handled by the native
    // non-passive wheel listener registered in the useEffect below.
    // React 18 registers onWheel as a passive listener at the document root,
    // so e.preventDefault() here is silently ignored and the page scrolls
    // underneath the canvas.  The native listener registered with
    // { passive: false } is the only way to reliably prevent that.
  };

  const handleDoubleClick = () => {
    if (drawnPoints.length >= 3) finalizeDrawing(); // v47.96: need 3+ points for valid polygon
    if (drawingMode === 'measure') {
      setMeasurePoints([]);
      setMeasureDistance(null);
    }
  };

  // ── Finalize drawing ───────────────────────────────────────
  const finalizeDrawing = () => {
    if (drawnPoints.length < 3) return; // v47.96: need at least 3 points for a valid polygon
    const latLngs = drawnPoints.map(p => ({ lat: p.lat, lng: p.lng }));

    if (drawingMode === 'draw_roof') {
      // Instead of immediately placing panels, show the plane-tagging modal
      // so user can specify which direction this roof face slopes
      const area = polygonAreaM2(latLngs);
      setPendingPlane({ vertices: latLngs, area });
      setPendingPlaneAzimuth(azimuth); // default to current global azimuth
      setPendingPlanePitch(tilt);      // default to current global pitch
      setDrawnPoints([]);
      setDrawingMode('select');
      return; // don't place panels yet — wait for tagging confirmation
    } else if (drawingMode === 'draw_ground') {
      setGroundArea(latLngs);
      autoPlacePanels('ground', latLngs);
    } else if (drawingMode === 'draw_fence') {
      setFenceLine(latLngs);
      autoPlacePanels('fence', latLngs);
    }

    setDrawnPoints([]);
    setDrawingMode('select');
  };

  // Confirm pending plane with chosen azimuth + pitch, then place panels
  const confirmPendingPlane = () => {
    if (!pendingPlane) return;

    // v47.99: enrichRoofPlaneWithLECS computes centroid ONCE and attaches
    // LECS (feet) local coordinates. This is the single coordinate reference
    // origin for the CAD engine, 2D debug overlay, and 3D Cesium rendering.
    const basePlane: RoofPlane = {
      id: uuidv4(),
      vertices: pendingPlane.vertices,
      pitch: pendingPlanePitch,
      azimuth: pendingPlaneAzimuth,
      area: pendingPlane.area,
      usableArea: pendingPlane.area * 0.75,
      source: 'manual' as const,
      confirmed: true,
      orientation,   // v47.96: store orientation at plane creation
    };
    const lecsPlane = enrichRoofPlaneWithLECS(basePlane);
    const plane = enrichRoofPlaneWith3DFrame(lecsPlane);
    setRoofPlanes(prev => [...prev, plane]);

    // [CAD-LECS] v47.99
    console.log('[CAD-LECS] RoofPlane confirmed', {
      id: plane.id,
      centroidLat: plane.centroidLat,
      centroidLng: plane.centroidLng,
      centroidLocal: plane.centroidLocal,
      pitch: plane.pitch,
      azimuth: plane.azimuth,
      vertexCount: plane.vertices.length,
      verticesLocalCount: plane.verticesLocal?.length,
    });

    // Place panels using THIS plane's azimuth + pitch — temporarily override global tilt/azimuth
    // by using the plane object which autoLayoutAll already respects via plane.pitch/plane.azimuth
    const layoutId = uuidv4();
    const fireSetbackM = calcEffectiveSetback(fireSetbacks);
    const newPanels = generateRoofLayoutOptimized({
      layoutId, roofPlane: plane, panel: selectedPanel,
      setback, panelSpacing, rowSpacing,
      tilt: pendingPlanePitch,
      azimuth: pendingPlaneAzimuth,
      orientation, fireSetbackM,
      pathwayWidthM: fireSetbacks.pathwayWidthM,
      enforcePathway: fireSetbacks.enforcePathway,
      ...toLayoutSetbacks(fireSetbacks),
      alignToEdge,
    });
    setPanels(prev => [...prev, ...newPanels]);
    if (showSetbackZones) {
      setSetbackZones(generateSetbackZones(pendingPlane.vertices, fireSetbacks));
    }
    setPendingPlane(null);
    toast.success('Roof plane added', `${newPanels.length} panels placed · ${pendingPlaneAzimuth}° azimuth · ${pendingPlanePitch}° pitch`);
  };

  // ── Re-layout panels for an existing plane (after azimuth/pitch change) ──
  const relayoutPlane = (plane: RoofPlane) => {
    // Inline point-in-polygon (ray casting) to filter panels inside this plane
    const pipTest = (lat: number, lng: number, verts: {lat:number;lng:number}[]): boolean => {
      let inside = false;
      for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const xi = verts[i].lng, yi = verts[i].lat;
        const xj = verts[j].lng, yj = verts[j].lat;
        if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    };
    setPanels(prev => {
      const remaining = prev.filter(panel => {
        if (!plane.vertices || plane.vertices.length < 3) return true;
        return !pipTest(panel.lat, panel.lng, plane.vertices);
      });
      const layoutId = uuidv4();
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      const newPanels = generateRoofLayoutOptimized({
        layoutId,
        roofPlane: plane,
        panel: selectedPanel,
        setback,
        panelSpacing,
        rowSpacing,
        tilt: plane.pitch ?? tilt,
        azimuth: plane.azimuth ?? azimuth,
        orientation: (plane.orientation as 'portrait' | 'landscape' | 'hybrid' | undefined) ?? orientation, // v50.23: per-plane override → global fallback
        fireSetbackM,
        pathwayWidthM: fireSetbacks.pathwayWidthM,
        enforcePathway: fireSetbacks.enforcePathway,
        ...toLayoutSetbacks(fireSetbacks),
        alignToEdge,
      });
      toast.success('Panels re-laid out', `${newPanels.length} panels · ${plane.azimuth ?? azimuth}° azimuth · ${plane.pitch ?? tilt}° pitch`);
      return [...remaining, ...newPanels];
    });
  };

  // ── Auto-place panels ──────────────────────────────────────
  const autoPlacePanels = (type: SystemType, points: { lat: number; lng: number }[]) => {
    const layoutId = uuidv4();
    let newPanels: PlacedPanel[] = [];

    if (type === 'roof') {
      const plane: RoofPlane = {
        id: uuidv4(), vertices: points, pitch: tilt, azimuth,
        area: polygonAreaM2(points), usableArea: polygonAreaM2(points) * 0.75,
      };
      // v30.9: pass orientation + fire setback
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback, panelSpacing, rowSpacing, tilt, azimuth,
        orientation, fireSetbackM,
       pathwayWidthM: fireSetbacks.pathwayWidthM,
       enforcePathway: fireSetbacks.enforcePathway,
       ...toLayoutSetbacks(fireSetbacks),
       alignToEdge,
      });
      // Update setback zone overlay
      if (showSetbackZones) {
        setSetbackZones(generateSetbackZones(points, fireSetbacks));
      }
    } else if (type === 'ground') {
      newPanels = generateGroundLayoutOptimized({
        layoutId, area: points, panel: selectedPanel,
        tilt, azimuth, rowSpacing, panelSpacing, panelsPerRow, groundHeight,
        orientation: (orientation === 'hybrid' ? 'portrait' : orientation) as 'portrait' | 'landscape',
      });
    } else if (type === 'fence') {
      newPanels = generateFenceLayout({ layoutId, fenceLine: points, panel: selectedPanel, azimuth, panelSpacing, fenceHeight, bifacialOptimized });
    }

    setPanels(prev => [...prev, ...newPanels]);
  };

  // ── Auto Layout: fill all existing zones with current settings ────────────────
  const [autoLayoutRunning, setAutoLayoutRunning] = useState(false);

  // v47.103 / v50.23: Re-layout all AUTO panels immediately when orientation toggle changes.
  // Called with the NEW orientation value directly (before React state update settles).
  const relayoutWithOrientation = useCallback((newOrientation: 'portrait' | 'landscape' | 'hybrid') => {
    const hasZones = roofPlanes.length > 0 || groundArea.length > 0;
    if (!hasZones) return; // no zones yet, nothing to re-layout
    const hasAutoPanels = panels.some(p => p.layoutSource === 'AUTO');
    if (!hasAutoPanels) return; // no auto panels to refresh

    // v48.37: In 3D mode with 3D-placed panels (height > 0), re-trigger the 3D
    // engine's handleAutoRoof instead of the 2D layout engine.
    // The 2D engine outputs panels with height=undefined → renders underground.
    // The orientation prop flowing to SolarEngine3D ensures panelOrientationRef
    // is updated BEFORE handleAutoRoof fires, so it uses the correct new orientation.
    if (show3D && panels.some(p => (p.height ?? 0) > 0)) {
      setPlacementMode3D('auto_roof');
      return;
    }

    clearGridCache();
    const manualPanels = panels.filter(p => p.layoutSource === 'MANUAL');
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      // v50.23: per-plane orientation overrides global — use plane.orientation if set,
      // otherwise fall back to the global orientation.
      const planeOrientation = (plane.orientation as 'portrait' | 'landscape' | 'hybrid' | undefined) ?? newOrientation;
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback, panelSpacing, rowSpacing,
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
        orientation: planeOrientation,
        fireSetbackM,
        pathwayWidthM: fireSetbacks.pathwayWidthM,
        enforcePathway: fireSetbacks.enforcePathway,
        ...toLayoutSetbacks(fireSetbacks),
        alignToEdge,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      // Ground mount doesn't support hybrid — use portrait as fallback for hybrid global mode
      const groundOrientation = newOrientation === 'hybrid' ? 'portrait' : newOrientation;
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth, rowSpacing, panelSpacing, panelsPerRow, groundHeight,
        orientation: groundOrientation,
      });
      allNew = [...allNew, ...newPanels];
    }

    setPanels([...manualPanels, ...allNew]);
    toast.success(
      `Orientation: ${newOrientation}`,
      `${allNew.length} panels re-laid out`
    );
  }, [panels, roofPlanes, groundArea, selectedPanel, setback, panelSpacing, rowSpacing,
      tilt, azimuth, panelsPerRow, groundHeight, fireSetbacks, alignToEdge, show3D, setPlacementMode3D]);

  const autoLayoutAll = useCallback(() => {
    const hasZones = roofPlanes.length > 0 || groundArea.length > 0 || fenceLine.length > 0;
    if (!hasZones) {
      toast.error('No zones defined', 'Draw a roof, ground, or fence zone first, then click Auto Layout.');
      return;
    }

    // v48.35: In 3D mode, the 2D layout engines produce panels without terrain heights,
    // which render underground. Route through SolarEngine3D's auto_roof engine instead,
    // which samples terrain and places panels at the correct elevation.
    if (show3D) {
      setPlacementMode3D('auto_roof');
      return;
    }

    setAutoLayoutRunning(true);

    // v47.93: Preserve MANUAL panels — only replace AUTO-generated panels
    const manualPanels = panels.filter(p => p.layoutSource === 'MANUAL');
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback, panelSpacing, rowSpacing,
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
        orientation: (plane.orientation as 'portrait' | 'landscape' | 'hybrid' | undefined) ?? orientation, // v50.23: per-plane override
        fireSetbackM,
       pathwayWidthM: fireSetbacks.pathwayWidthM,
       enforcePathway: fireSetbacks.enforcePathway,
       ...toLayoutSetbacks(fireSetbacks),
       alignToEdge,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      const groundOrientation = orientation === 'hybrid' ? 'portrait' : orientation;
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth, rowSpacing, panelSpacing, panelsPerRow, groundHeight,
        orientation: groundOrientation,
      });
      allNew = [...allNew, ...newPanels];
    }

    if (fenceLine.length >= 2) {
      const layoutId = uuidv4();
      const newPanels = generateFenceLayout({
        layoutId, fenceLine, panel: selectedPanel,
        azimuth, panelSpacing, fenceHeight, bifacialOptimized,
      });
      allNew = [...allNew, ...newPanels];
    }

    // Combine: manual panels first (preserved), then new auto panels
    setPanels([...manualPanels, ...allNew]);
    setAutoLayoutRunning(false);
    toast.success(
      'Auto Layout complete',
      `${allNew.length} panels placed · ${(calculateSystemSize(allNew)).toFixed(2)} kW`
    );
  }, [panels, roofPlanes, groundArea, fenceLine, selectedPanel, setback, panelSpacing, rowSpacing,
      tilt, azimuth, panelsPerRow, groundHeight, fenceHeight, bifacialOptimized, orientation, show3D, setPlacementMode3D]);

  // ── Fill Roof: maximize panels with minimal setback (0.3 m) ─────────────────
  const fillRoof = useCallback(() => {
    if (roofPlanes.length === 0 && groundArea.length === 0) {
      toast.error('No zones defined', 'Draw a roof or ground zone first.');
      return;
    }
    setAutoLayoutRunning(true);
    const minSetback = 0;    // v47.95: no minimum -- AHJ fire setbacks handle clearances
    const tightSpacing = midClampGapM; // v63: mid-clamp gap from selected racking (was hardcoded ¼")
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      // v30.9: fire setback takes precedence over minSetback
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      const effectiveSetback = Math.max(minSetback, fireSetbackM);
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback: effectiveSetback, panelSpacing: tightSpacing,
        rowSpacing: 0.02,  // v47.95: flush roof mount -- panels touch row-to-row
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
        orientation: (plane.orientation as 'portrait' | 'landscape' | 'hybrid' | undefined) ?? orientation, // v50.23: per-plane override
        fireSetbackM,
       pathwayWidthM: fireSetbacks.pathwayWidthM,
       enforcePathway: fireSetbacks.enforcePathway,
       ...toLayoutSetbacks(fireSetbacks),
       alignToEdge,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth,
        rowSpacing: Math.max(rowSpacing * 0.85, selectedPanel.height + 0.05),
        panelSpacing: tightSpacing, panelsPerRow, groundHeight,
        orientation: (orientation === 'hybrid' ? 'portrait' : orientation) as 'portrait' | 'landscape',
      });
      allNew = [...allNew, ...newPanels];
    }

    const manualPanels = panels.filter(p => p.layoutSource === 'MANUAL');
    setPanels([...manualPanels, ...allNew]);
    setAutoLayoutRunning(false);
    toast.success(
      'Fill Roof complete',
      `${allNew.length} panels · ${(calculateSystemSize(allNew)).toFixed(2)} kW (max density)`
    );
  }, [roofPlanes, groundArea, selectedPanel, rowSpacing, tilt, azimuth, panelsPerRow, groundHeight, panels, orientation, midClampGapM]);

  // ── Optimize Layout: best production/cost ratio (wider row spacing) ──────────
  const optimizeLayout = useCallback(() => {
    if (roofPlanes.length === 0 && groundArea.length === 0) {
      toast.error('No zones defined', 'Draw a roof or ground zone first.');
      return;
    }
    setAutoLayoutRunning(true);
    // v47.95: Roof panels are flush-mount -- use user rowSpacing directly
    // Ground mount: calculate shadow clearance to avoid inter-row shading
    const tiltRad = (tilt * Math.PI) / 180;
    const shadowLength = tiltRad > 0.05 ? selectedPanel.height * Math.cos(tiltRad) / Math.tan(tiltRad) : selectedPanel.height;
    const optRowSpacingRoof   = rowSpacing; // roof: user-controlled, no shadow calc
    const optRowSpacingGround = Math.max(rowSpacing, selectedPanel.height + shadowLength * 0.5); // ground: shade avoidance
    const optSetback = setback; // v47.95: AHJ fire setbacks handle clearances
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback: optSetback, panelSpacing: midClampGapM, rowSpacing: optRowSpacingRoof, // v63: mid-clamp gap from racking
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
        orientation: (plane.orientation as 'portrait' | 'landscape' | 'hybrid' | undefined) ?? orientation, // v50.23: per-plane override
        fireSetbackM,
       pathwayWidthM: fireSetbacks.pathwayWidthM,
       enforcePathway: fireSetbacks.enforcePathway,
       ...toLayoutSetbacks(fireSetbacks),
       alignToEdge,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth, rowSpacing: optRowSpacingGround, panelSpacing: midClampGapM, // v63: mid-clamp gap from racking
        panelsPerRow, groundHeight,
        orientation: (orientation === 'hybrid' ? 'portrait' : orientation) as 'portrait' | 'landscape',
      });
      allNew = [...allNew, ...newPanels];
    }

    const manualPanels2 = panels.filter(p => p.layoutSource === 'MANUAL');
    setPanels([...manualPanels2, ...allNew]);
    setAutoLayoutRunning(false);
    toast.success(
      'Optimized Layout complete',
      `${allNew.length} panels · ${(calculateSystemSize(allNew)).toFixed(2)} kW · min shading`
    );
  }, [roofPlanes, groundArea, selectedPanel, setback, rowSpacing, tilt, azimuth, panelsPerRow, groundHeight, panels, orientation, midClampGapM]);

  // ── Calculate production ───────────────────────────────────
  const buildSystemDefinition = () => {
    // Extract effective tilt/azimuth from placed panels
    let effectiveTilt = tilt;
    let effectiveAzimuth = azimuth;
    if (panels.length > 0) {
      const tilts = panels.map((p: any) => p.tilt ?? tilt).filter((t: number) => t > 0);
      const azimuths = panels.map((p: any) => p.azimuth ?? azimuth).filter((a: number) => a > 0);
      if (tilts.length > 0) effectiveTilt = tilts.reduce((a: number, b: number) => a + b, 0) / tilts.length;
      if (azimuths.length > 0) effectiveAzimuth = azimuths.reduce((a: number, b: number) => a + b, 0) / azimuths.length;
    }
    const effectiveRoofPlanes = roofPlanes.length > 0 ? roofPlanes :
      (panels.length > 0 && project.systemType === 'roof' ? [{
        id: 'auto-plane-1',
        vertices: [],
        pitch: effectiveTilt,
        azimuth: effectiveAzimuth,
        area: panels.length * 1.134 * 1.722,
        usableArea: panels.length * 1.134 * 1.722 * 0.85,
      }] : undefined);
    return {
      panels,
      systemType: project.systemType,
      tilt: effectiveTilt,
      azimuth: effectiveAzimuth,
      groundTilt: effectiveTilt,
      groundAzimuth: effectiveAzimuth,
      fenceAzimuth: effectiveAzimuth,
      fenceHeight,
      bifacialOptimized,
      totalPanels: panels.length,
      systemSizeKw,
      roofPlanes: effectiveRoofPlanes,
    };
  };

  const buildLocationInput = () => {
    return {
      lat: mapCenter.lat,
      lng: mapCenter.lng,
      address: project.address,
      annualKwh: project.client?.annualKwh ?? 12000,
      utilityRate: project.client?.utilityRate ?? project.utilityRatePerKwh ?? 0.13,
    };
  };

  const calculateProduction = async () => {
    if (panels.length === 0) return;
    setCalculating(true);
    setCalcMessage('');
    const toastId = toast.loading('Running production simulation...', `PVWatts · ${panels.length} panels · ${systemSizeKw.toFixed(2)} kW`);
    try {
      // Always use ephemeral shape: systemDefinition + location
      // The API will enrich with project data if projectId is also provided
      const systemDefinition = buildSystemDefinition();
      const location = buildLocationInput();
      const body: Record<string, unknown> = { systemDefinition, location };
      if (project.id) body.projectId = project.id;
      // Carry the equipment selection so the production route persists it and the
      // project hydrates it back (engineering audit C2 — was local-only/dropped).
      if (selectedInverter) body.selectedInverter = selectedInverter;
      if (selectedPanel) body.selectedPanel = selectedPanel;
      const res = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setProduction(data.data.production);
        setCostEstimate(data.data.costEstimate);
        const annualKwh = data.data.production?.annualProductionKwh ?? 0;
        const sizeKw = data.data.layout?.systemSizeKw ?? systemSizeKw;
        setCalcMessage(`✅ ${annualKwh.toLocaleString()} kWh/yr · ${sizeKw.toFixed(2)} kW system`);
        toast.update(toastId, {
          type: 'success',
          title: 'Production calculated!',
          message: `${annualKwh.toLocaleString()} kWh/yr · ${sizeKw.toFixed(2)} kW`,
        });
      } else {
        setCalcMessage(`❌ ${data.error || 'Calculation failed'}`);
        toast.update(toastId, {
          type: 'error',
          title: 'Calculation failed',
          message: data.error || 'Please try again',
        });
      }
    } catch (e: unknown) {
      setCalcMessage(`❌ ${(e as Error)?.message || 'Network error'}`);
      toast.update(toastId, {
        type: 'error',
        title: 'Network error',
        message: (e as Error)?.message || 'Could not connect to server',
      });
    } finally {
      setCalculating(false);
    }
  };

  const buildLayout = (): Omit<Layout, 'id' | 'createdAt' | 'updatedAt'> => {
    // Reuse buildSystemDefinition for shared tilt/azimuth/roofPlane logic
    const sysDef = buildSystemDefinition();
    return {
      projectId: project.id,
      systemType: project.systemType,
      panels,
      roofPlanes: sysDef.roofPlanes,
      groundTilt: sysDef.groundTilt,
      groundAzimuth: sysDef.groundAzimuth,
      rowSpacing, groundHeight,
      fenceAzimuth: sysDef.fenceAzimuth,
      fenceHeight,
      fenceLine: fenceLine.length > 0 ? fenceLine : undefined,
      bifacialOptimized,
      totalPanels: panels.length,
      systemSizeKw,
      mapCenter, mapZoom: zoom,
    };
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    const toastId = toast.loading('Calculating production...', `${panels.length} panels · ${systemSizeKw.toFixed(2)} kW system`);
    try {
      const layout = buildLayout();
      // Save to localStorage immediately before server call
      localSaveLayout(project.id, { panels, mapCenter: mapCenterRef.current, mapZoom: zoomRef.current, systemType: project.systemType });
      const res = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Persist the inverter/panel selection with the layout. upsertProduction
        // saves them and getProjectById hydrates them back onto the project, so
        // engineering/permit see the choice. Without this the picks were
        // local-only and silently discarded (engineering audit C2).
        body: JSON.stringify({
          projectId: project.id,
          layout,
          selectedInverter: selectedInverter ?? undefined,
          selectedPanel: selectedPanel ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProduction(data.data.production);
        setCostEstimate(data.data.costEstimate);
        setSaveStatus('saved');
        setLastSavedAt(new Date());
        onSave?.(data.data.layout);
        const annualKwh = data.data.production?.annualProductionKwh ?? 0;
        const sizeKw = data.data.layout?.systemSizeKw ?? layout.systemSizeKw;
        toast.update(toastId, {
          type: 'success',
          title: 'Design saved & calculated!',
          message: `${annualKwh.toLocaleString()} kWh/yr · ${sizeKw.toFixed(2)} kW · ${panels.length} panels`,
        });
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
        toast.update(toastId, {
          type: 'error',
          title: 'Calculation failed',
          message: data.error || 'Please try again',
        });
      }
    } catch (e: unknown) {
      setSaveStatus('error');
      toast.update(toastId, {
        type: 'error',
        title: 'Save failed',
        message: (e as Error)?.message || 'Network error',
      });
    }
  };

  const clearAll = () => {
    setPanels([]); setRoofPlanes([]); setGroundArea([]); setFenceLine([]);
    setDrawnPoints([]); setProduction(null); setCostEstimate(null);
    setSelectedPanelIds(new Set()); setMeasurePoints([]); setMeasureDistance(null);
  };

  const systemTypeLabel = { roof: 'Roof Mount', ground: 'Ground Mount', fence: 'Sol Fence' }[project.systemType];
  const systemTypeColor = { roof: 'text-amber-400', ground: 'text-teal-400', fence: 'text-purple-400' }[project.systemType];
  const systemTypeBg = { roof: 'bg-amber-500/10 border-amber-500/20', ground: 'bg-teal-500/10 border-teal-500/20', fence: 'bg-purple-500/10 border-purple-500/20' }[project.systemType];

  const filteredPanels = availablePanels.filter(p =>
    !panelFilter || `${p.manufacturer} ${p.model}`.toLowerCase().includes(panelFilter.toLowerCase())
  );
  const filteredInverters = availableInverters.filter(i =>
    !inverterFilter || `${i.manufacturer} ${i.model}`.toLowerCase().includes(inverterFilter.toLowerCase())
  );

  const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Report a Bug — floating (Design Studio runs without the app header) */}
      <button
        type="button"
        onClick={() => setFeedbackOpen(true)}
        title="Report a bug or suggest an improvement"
        className="fixed bottom-4 left-4 z-[60] flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800/90 border border-slate-600/60 text-xs font-medium text-slate-300 hover:text-amber-400 hover:border-amber-500/40 shadow-lg backdrop-blur transition-colors"
      >
        <Bug size={14} /> Report a Bug
      </button>
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* ── Studio Header ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-900 border-b border-slate-700/50 flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${systemTypeBg} ${systemTypeColor}`}>
          {systemTypeLabel}
        </div>
        <span className="font-semibold text-white text-sm truncate">{project.name}</span>
        {project.client ? (
          <span className="text-xs text-slate-500 truncate hidden md:block">— {project.client.name}</span>
        ) : null}

        {/* Address search with autocomplete */}
        <div className="flex items-center gap-2 ml-2 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 z-10" />
            <input
              ref={addrInputRef}
              type="text"
              value={addressSearch}
              onChange={e => handleAddressSearchInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { setShowAddressSuggestions(false); geocodeAddress(addressSearch); }
                if (e.key === 'Escape') setShowAddressSuggestions(false);
              }}
              onBlur={() => setTimeout(() => setShowAddressSuggestions(false), 150)}
              onFocus={() => addressSuggestions.length > 0 && setShowAddressSuggestions(true)}
              placeholder="Search any address..."
              autoComplete="off"
              className={`w-full bg-slate-800 border rounded-lg pl-7 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors ${
                locationStatus === 'found' ? 'border-emerald-500/50' :
                locationStatus === 'failed' ? 'border-red-500/50' :
                locationStatus === 'locating' ? 'border-amber-500/50' :
                'border-slate-600 focus:border-amber-500'
              }`}
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {addressSuggestionsLoading || searchLoading ? (
                <Loader size={11} className="animate-spin text-slate-400" />
              ) : locationStatus === 'found' ? (
                <CheckCircle size={11} className="text-emerald-400" />
              ) : null}
            </div>

            {/* Autocomplete dropdown — position:fixed so it escapes the header's
                overflow clipping and renders above the 3D canvas (z-[100]). */}
            {showAddressSuggestions && addressSuggestions.length > 0 && addrDropdownPos ? (
              <div
                className="fixed bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-[100] overflow-hidden"
                style={{ top: addrDropdownPos.top, left: addrDropdownPos.left, width: addrDropdownPos.width }}
              >
                {addressSuggestions.map((s, i) => (
                  <button
                    key={i}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0"
                    onMouseDown={e => { e.preventDefault(); handleSelectAddressSuggestion(s); }}
                  >
                    <div className="flex items-start gap-1.5">
                      <Search size={10} className="text-amber-400 mt-0.5 shrink-0" />
                      <div>
                        <div className="text-xs text-white font-medium">{s.short_name}</div>
                        <div className="text-xs text-slate-500 truncate max-w-xs">{s.display_name}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            onClick={() => { setShowAddressSuggestions(false); geocodeAddress(addressSearch); }}
            disabled={searchLoading || locationStatus === 'locating'}
            className="btn-secondary btn-sm px-2.5 flex-shrink-0"
          >
            {searchLoading || locationStatus === 'locating' ? <Loader size={12} className="animate-spin" /> : 'Go'}
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {/* Automation buttons */}
          {(roofPlanes.length > 0 || groundArea.length > 0 || fenceLine.length > 0) ? (
            <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg px-2 py-1">
              <button
                onClick={autoLayoutAll}
                disabled={autoLayoutRunning}
                className="btn-sm btn-secondary flex items-center gap-1 text-xs"
                title="Auto Layout: fill all zones with current settings"
              >
                {autoLayoutRunning ? <Loader size={11} className="animate-spin" /> : <Zap size={11} className="text-amber-400" />}
                Auto Layout
              </button>
              <button
                onClick={fillRoof}
                disabled={autoLayoutRunning}
                className="btn-sm btn-secondary flex items-center gap-1 text-xs"
                title="Fill Roof: maximize panel count with minimal setback"
              >
                <Layers size={11} className="text-teal-400" />
                Fill Roof
              </button>
              <button
                onClick={optimizeLayout}
                disabled={autoLayoutRunning}
                className="btn-sm btn-secondary flex items-center gap-1 text-xs"
                title="Optimize: best production/cost ratio with inter-row shading avoidance"
              >
                <TrendingUp size={11} className="text-purple-400" />
                Optimize
              </button>
            </div>
          ) : null}
          {panels.length > 0 ? (
            <div className="flex items-center gap-3 text-xs bg-slate-800/60 rounded-lg px-3 py-1.5">
              <span className="text-slate-400">{panels.length} panels</span>
              <span className="text-amber-400 font-bold">{systemSizeKw.toFixed(2)} kW</span>
            </div>
          ) : null}
          <button
            onClick={() => setShowPanels(!showPanels)}
            className={`btn-sm ${showPanels ? 'btn-secondary' : 'btn-ghost'}`}
            title="Toggle panel visibility"
          >
            {showPanels ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button
            onClick={() => setShowShade3D(!showShade3D)}
            className={`btn-sm ${showShade3D ? 'btn-primary' : 'btn-secondary'}`}
            title="Toggle shade analysis"
          >
            🌡️ Shade
          </button>
          <button
            onClick={() => setShow3D(!show3D)}
            className={`btn-sm ${show3D ? 'btn-primary' : 'btn-secondary'}`}
            title="Toggle 3D Digital Twin"
          >
            {show3D ? '🌐 3D View' : '🗺️ 2D Map'}
          </button>
          {/* Tile provider toggle — only shown in 2D mode */}
          {!show3D ? (
            <div className="flex items-center gap-0.5 bg-slate-800 border border-slate-600 rounded-lg overflow-hidden">
              {(['auto', 'google', 'esri'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => {
                    setTileProvider(p);
                    TILE_CACHE.clear(); TILE_INFLIGHT.clear(); setMapTiles(new Map());
                  }}
                  className={`px-2 py-1 text-[10px] font-semibold transition-colors ${
                    tileProvider === p
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                  }`}
                  title={
                    p === 'auto'   ? 'Auto: Google primary, ESRI fallback on blank tile' :
                    p === 'google' ? 'Force Google Maps satellite (zoom 21)' :
                                     'Force ESRI World Imagery (zoom 19 max)'
                  }
                >
                  {p === 'auto' ? '🔍 Auto' : p === 'google' ? 'Google' : 'ESRI'}
                </button>
              ))}
              <span className={`px-1.5 py-1 text-[9px] font-bold border-l border-slate-600 ${
                activeTileSource === 'google' ? 'text-blue-400' : 'text-amber-400'
              }`}>
                {activeTileSource === 'google' ? '✓G' : '✓E'}
              </span>
            </div>
          ) : null}
          {/* HD imagery — Google Solar RGB (~10cm) for tagging vents/obstructions; covered addresses only */}
          {!show3D ? (
            <button
              onClick={() => setHdImagery(v => !v)}
              className={`px-2 py-1 text-[10px] font-semibold rounded-lg border transition-colors ${
                hdImagery
                  ? (hdStatus === 'unavailable'
                      ? 'bg-slate-800 text-amber-400 border-amber-500/40'
                      : 'bg-emerald-600 text-white border-emerald-500')
                  : 'bg-slate-800 text-slate-400 border-slate-600 hover:text-white'
              }`}
              title="High-res Solar aerial (~10cm) — sharp enough to tag vents/obstructions. Covered addresses only."
            >
              {hdImagery && hdStatus === 'loading' ? '⏳ HD'
                : hdImagery && hdStatus === 'unavailable' ? '🛰 HD n/a here'
                : '🛰 HD'}
            </button>
          ) : null}
          <button onClick={clearAll} className="btn-secondary btn-sm">
            <RotateCcw size={13} /> Clear
          </button>
          <button
            onClick={handleSave}
            disabled={panels.length === 0 || saveStatus === 'saving'}
            className="btn-primary btn-sm"
          >
            {saveStatus === 'saving' ? <><Loader size={13} className="animate-spin" /> Saving...</> :
             saveStatus === 'saved' ? <><CheckCircle size={13} /> Saved</> :
             <><Save size={13} /> Save &amp; Calculate</>}
          </button>
          <SaveStatusBar
            status={saveStatus}
            lastSavedAt={lastSavedAt}
            className="ml-1"
          />
          {/* Unsaved Design badge — shown when panels exist but design has never been saved this session */}
          {panels.length > 0 && saveStatus !== 'saving' && saveStatus !== 'saved' && lastSavedAt === null && !layoutLoadedFromDB ? (
            <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full ml-1 flex items-center gap-1 flex-shrink-0">
              <AlertCircle size={10} /> Unsaved Design
            </span>
          ) : null}
          {/* Restore indicators — visible proof that layout was loaded from DB */}
          {layoutLoadedFromDB ? (
            <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full ml-1 flex items-center gap-1">
              <CheckCircle size={10} /> Layout loaded from DB · {restoredPanelCount} panels{restoredRoofPlaneCount > 0 ? ` · ${restoredRoofPlaneCount} roof planes` : ''}
            </span>
          ) : null}
          {/* Proceed to Engineering CTA — shown once panels are placed */}
          {panels.length > 0 ? (
            <button
              onClick={() => router.push(`/engineering?projectId=${project.id}`)}
              className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300 transition-all text-xs font-semibold flex-shrink-0"
              title="Open Engineering with this project"
            >
              Engineering <ArrowRight size={11} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ── Left Toolbar ── */}
        <div className="w-14 bg-slate-900 border-r border-slate-700/50 flex flex-col items-center py-3 gap-1 flex-shrink-0">
          {/* Active zone type badge */}
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-2 text-sm ${
            activeZoneType === 'roof' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
            activeZoneType === 'ground' ? 'bg-teal-500/10 border-teal-500/20 text-teal-400' :
            'bg-purple-500/10 border-purple-500/20 text-purple-400'
          }`}>
            {activeZoneType === 'roof' ? '🏠' : activeZoneType === 'ground' ? '🌱' : '🔲'}
          </div>
          <div className="w-8 border-t border-slate-700/50 mb-1" />

          {/* Tools - ALL system types always available */}
          {[
            { id: 'select' as DrawingMode, icon: <MousePointer2 size={16} />, label: 'Select / Pan', key: 'V', color: '' },
            { id: 'draw_roof' as DrawingMode, icon: <Home size={16} />, label: 'Draw Roof Zone', key: 'R', color: 'text-amber-400', activeColor: 'bg-amber-500/20 border-amber-500/40 text-amber-400' },
            { id: 'draw_ground' as DrawingMode, icon: <Square size={16} />, label: 'Draw Ground Zone', key: 'G', color: 'text-teal-400', activeColor: 'bg-teal-500/20 border-teal-500/40 text-teal-400' },
            { id: 'draw_fence' as DrawingMode, icon: <Minus size={16} />, label: 'Draw Fence Line', key: 'F', color: 'text-purple-400', activeColor: 'bg-purple-500/20 border-purple-500/40 text-purple-400' },
            { id: 'measure' as DrawingMode, icon: <Ruler size={16} />, label: 'Measure Distance', key: 'M', color: '' },
          ].map(tool => (
            <button
              key={tool.id}
              onClick={() => {
                setDrawingMode(tool.id);
                setMeasurePoints([]);
                setMeasureDistance(null);
                // v31.1: deactivate multi-row mode when switching tools
                setMultiRowMode(false);
                setMultiRowStart(null);
                setMultiRowEnd(null);
                // Set active zone type based on tool
                if (tool.id === 'draw_roof') setActiveZoneType('roof');
                else if (tool.id === 'draw_ground') setActiveZoneType('ground');
                else if (tool.id === 'draw_fence') setActiveZoneType('fence');
              }}
              title={`${tool.label} (${tool.key})`}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all group relative ${
                drawingMode === tool.id
                  ? ((tool as any).activeColor || 'bg-amber-500/20 border border-amber-500/40 text-amber-400')
                  : `text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 ${(tool as any).color || ''}`
              } border border-transparent`}
            >
              {tool.icon}
              <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
                {tool.label} <span className="text-slate-500">{tool.key}</span>
              </div>
            </button>
          ))}

          <div className="w-8 border-t border-slate-700/50 my-1" />

          {/* v30.9: Multi-Row Tool */}
          <button
            onClick={() => { setMultiRowMode(v => !v); setMultiRowStart(null); setMultiRowEnd(null); }}
            title={`Multi-Row Placement (${multiRowCount} rows)`}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all group relative border ${
              multiRowMode
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-700/60'
            }`}
          >
            <span className="text-sm font-bold leading-none">⊞</span>
            <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
              Multi-Row ({multiRowCount} rows)
            </div>
          </button>

          {drawnPoints.length >= 2 ? (
            <button
              onClick={finalizeDrawing}
              title="Finish Drawing"
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 transition-all group relative"
            >
              <CheckSquare size={16} />
              <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                Finish Drawing
              </div>
            </button>
          ) : null}

          {selectedPanelIds.size > 0 ? (
            <button
              onClick={() => { setPanels(prev => prev.filter(p => !selectedPanelIds.has(p.id))); setSelectedPanelIds(new Set()); }}
              title="Delete Selected"
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all group relative"
            >
              <Trash2 size={16} />
              <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                Delete Selected
              </div>
            </button>
          ) : null}

          {drawnPoints.length > 0 ? (
            <div className="mt-auto mb-2 w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-bold">
              {drawnPoints.length}
            </div>
          ) : null}
        </div>

        {/* ── Map Canvas ── */}
        <div className="flex-1 relative min-w-0" ref={containerRef}>
          {show3D ? (
            <SolarEngine3D
              lat={mapCenter.lat}
              lng={mapCenter.lng}
              panels={panels as any}
              onPanelsChange={(p) => setPanels(p as any)}
              systemType={activeZoneType as any}
              tilt={tilt}
              azimuth={azimuth}
              fenceHeight={fenceHeight}
              selectedPanel={selectedPanel}
              roofPlanes={roofPlanes as any}
              projectAddress={
                project.address ||
                (project.client ? [project.client.address, project.client.city, project.client.state].filter(Boolean).join(', ') : '')
              }
              placementMode={placementMode3D}
              onPlacementModeChange={setPlacementMode3D}
              showShade={showShade3D}
              showIrradiance={showIrradiance}
              fireSetbacks={fireSetbacks}
              showSetbackZones={showSetbackZones}
              mountingSystemId={rackingId}
              colorByString={colorByString}
              showEquipment={showEquipment}
              panelOpacity={panelOpacity}
              panelMeta={panelMeta}
              stringLegend={stringLegend}
              paintMode={paintMode}
              onPanelPaint={handlePanelPaint}
              orientation={(orientation === 'hybrid' ? 'portrait' : orientation) as 'portrait' | 'landscape'}
              onOrientationChange={(o) => setOrientation(o)}
              onTwinLoaded={(twin) => {
                if (twin.solarData) setSolarApiData(twin.solarData);
                if (twin.roofSegments) {
                  setRoofSegments(twin.roofSegments);
                  // v50.22: If an explicit Pick House / address-search pick is in flight,
                  // do NOT update solarDataAddress or solarDataCityOnly — those are already
                  // set correctly by fetchSolarData and must not be clobbered by the twin
                  // reload (which uses projectAddress, the old/saved address).
                  if (explicitPickAddressRef.current) return;
                  // v50.10: tag segments with the address they belong to.
                  // Only set if not already anchored to an explicit Pick House / address-search pick —
                  // we never want to overwrite a user-chosen address with project boot coords.
                  const twinAddr = twin.address || null;
                  setSolarDataAddress(prev => prev ?? twinAddr);
                  // v50.13: flag city-only if twin address has no street number and not already anchored to explicit pick
                  setSolarDataCityOnly(current => current ? current : !isStreetLevelAddress(twinAddr));
                }
              }}
              onError={(error) => {
                // v47.120: Log the error but do NOT hide the 3D view.
                // SolarEngine3D shows its own error overlay with a Retry button.
                // Calling setShow3D(false) here would permanently destroy the
                // 3D component on any transient boot failure (network, Cesium CDN, etc.)
                // and leave the user with no way to recover without a full page refresh.
                console.error('[DesignStudio] 3D engine error (keeping 3D view visible for retry):', error);
              }}
              onLocationPick={handleLocationPick}
              onRoofPlaneCreated={(plane) => {
                // v47.121: 3D Plane Tool — receive a plane created by clicking in 3D
                // enrich with LECS + 3D frame and add to roofPlanes state
                const lecsPlane = enrichRoofPlaneWithLECS(plane);
                const enrichedPlane = enrichRoofPlaneWith3DFrame(lecsPlane);
                setRoofPlanes(prev => [...prev, enrichedPlane]);
                console.log('[DesignStudio] 3D plane added:', enrichedPlane.id,
                  `az=${enrichedPlane.azimuth.toFixed(1)}° tilt=${enrichedPlane.pitch.toFixed(1)}°`);
              }}
              onE2EDiagnostics={E2E_ENABLED ? setE2EDiagnostics : undefined}
              onRoofPlanesStitched={(updates) => {
                if (E2E_ENABLED) setE2EStitchedCorners(updates);
                // v64: Stitch wrote averaged/connected corners + the stitched plane
                // frame back. Replace each plane's vertices AND localFrame3D with the
                // stitched geometry so panel placement (Auto Layout) lays its grid on
                // the new outline — not the stale pre-stitch frame — and re-enrich the
                // 2D LECS fields. enrichRoofPlaneWith3DFrame is a no-op once
                // localFrame3D is set, so the stitched frame we pass is preserved.
                setRoofPlanes(prev => prev.map(p => {
                  const u = updates.find(x => x.id === p.id);
                  if (!u || u.vertices.length < 3) return p;
                  return enrichRoofPlaneWithLECS({ ...p, vertices: u.vertices, localFrame3D: u.localFrame3D });
                }));
                console.log('[DesignStudio] Stitch synced', updates.length, 'plane(s) into roofPlanes');
              }}
            />
          ) : (
            <>
              <canvas
                ref={canvasRef}
                className="w-full h-full"
                style={{ cursor: drawingMode === 'select' ? (isDragging ? 'grabbing' : 'grab') : 'crosshair' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => setIsDragging(false)}
                onWheel={handleWheel}
                onDoubleClick={handleDoubleClick}
              />

              {/* ── Plane Tagging Modal ─────────────────────────────────────────
                  Appears after user finishes drawing a roof plane.
                  Lets them specify which direction the roof face slopes (azimuth)
                  and pitch before panels are placed. */}
              {pendingPlane ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70 z-50">
                  <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-5 w-80 shadow-2xl">
                    <div className="text-amber-400 font-bold text-sm mb-1">🏠 Tag This Roof Plane</div>
                    <div className="text-slate-400 text-xs mb-4 leading-relaxed">
                      Which direction does this roof face slope <span className="text-white">downward</span>? (Where water runs off)
                    </div>

                    {/* Compass rose */}
                    <div className="relative w-44 h-44 mx-auto mb-4">
                      {/* Outer ring */}
                      <div className="absolute inset-0 rounded-full border-2 border-slate-700 bg-slate-800/80" />
                      {/* Cardinal direction buttons */}
                      {[
                        { label: 'N',  az: 0,   x: 50, y: 2  },
                        { label: 'NE', az: 45,  x: 78, y: 10 },
                        { label: 'E',  az: 90,  x: 86, y: 41 },
                        { label: 'SE', az: 135, x: 78, y: 72 },
                        { label: 'S',  az: 180, x: 50, y: 80 },
                        { label: 'SW', az: 225, x: 18, y: 72 },
                        { label: 'W',  az: 270, x: 8,  y: 41 },
                        { label: 'NW', az: 315, x: 18, y: 10 },
                      ].map(({ label, az, x, y }) => {
                        const isSelected = Math.abs(pendingPlaneAzimuth - az) < 23;
                        return (
                          <button
                            key={label}
                            onClick={() => setPendingPlaneAzimuth(az)}
                            style={{ left: `${x}%`, top: `${y}%` }}
                            className={`absolute text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center transition-all -translate-x-1/2 -translate-y-1/2 ${
                              isSelected
                                ? 'bg-amber-500 text-slate-900 shadow-lg scale-110'
                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                      {/* Center label */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <div className="text-amber-400 font-bold text-lg leading-none">{pendingPlaneAzimuth}°</div>
                          <div className="text-slate-500 text-[10px]">azimuth</div>
                        </div>
                      </div>
                      {/* Arrow pointing in selected direction */}
                      <div
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                        style={{ transform: `rotate(${pendingPlaneAzimuth}deg)` }}
                      >
                        <div className="w-0.5 h-14 bg-amber-400/50 rounded-full" style={{ marginTop: '-28px' }} />
                      </div>
                    </div>

                    {/* Fine azimuth slider */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Fine adjust azimuth</span>
                        <span className="text-amber-400 font-mono">{pendingPlaneAzimuth}° {['N','NE','E','SE','S','SW','W','NW','N'][Math.round(pendingPlaneAzimuth/45)%8]}</span>
                      </div>
                      <input
                        type="range" min={0} max={359} step={1}
                        value={pendingPlaneAzimuth}
                        onChange={e => setPendingPlaneAzimuth(Number(e.target.value))}
                        className="w-full h-1.5 accent-amber-400"
                      />
                    </div>

                    {/* Pitch slider */}
                    <div className="mb-5">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Roof pitch</span>
                        <span className="text-amber-400 font-mono">{pendingPlanePitch}° ({Math.round(Math.tan(pendingPlanePitch*Math.PI/180)*12)}/12)</span>
                      </div>
                      <input
                        type="range" min={0} max={45} step={1}
                        value={pendingPlanePitch}
                        onChange={e => setPendingPlanePitch(Number(e.target.value))}
                        className="w-full h-1.5 accent-amber-400"
                      />
                      <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
                        <span>Flat 0°</span><span>Low 5°</span><span>Med 20°</span><span>Steep 45°</span>
                      </div>
                    </div>

                    {/* Area info */}
                    <div className="text-xs text-slate-500 mb-4 bg-slate-800/60 rounded-lg p-2">
                      Area: <span className="text-white font-medium">{(pendingPlane.area * 10.764).toFixed(0)} ft²</span>
                      &nbsp;·&nbsp; Vertices: <span className="text-white font-medium">{pendingPlane.vertices.length}</span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPendingPlane(null)}
                        className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-xs font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmPendingPlane}
                        className="flex-2 flex-grow py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-xs font-bold transition-colors"
                      >
                        ✅ Confirm & Place Panels
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {!mapLoaded ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
                  <div className="text-center">
                    <div className="spinner w-8 h-8 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">Loading satellite imagery...</p>
                  </div>
                </div>
              ) : null}

              {/* Location finding overlay */}
              {(locationStatus === 'locating' || searchLoading) ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 pointer-events-none">
                  <div className="glass rounded-2xl px-6 py-4 text-center">
                    <div className="spinner w-8 h-8 mx-auto mb-3" />
                    <p className="text-white font-semibold text-sm">Finding address...</p>
                    <p className="text-slate-400 text-xs mt-1">{addressSearch}</p>
                  </div>
                </div>
              ) : null}

              {/* Location found toast */}
              {locationStatus === 'found' && !searchLoading ? (
                <div className="absolute top-4 right-16 glass rounded-xl px-3 py-2 flex items-center gap-2 pointer-events-none">
                  <CheckCircle size={14} className="text-emerald-400" />
                  <span className="text-xs text-emerald-400 font-medium">Location found</span>
                </div>
              ) : null}

              {/* Location failed toast */}
              {locationStatus === 'failed' ? (
                <div className="absolute top-4 right-16 glass rounded-xl px-3 py-2 flex items-center gap-2 pointer-events-none">
                  <AlertCircle size={14} className="text-red-400" />
                  <span className="text-xs text-red-400 font-medium">Address not found — try a different search</span>
                </div>
              ) : null}

              {/* Drawing instructions */}
              {drawingMode !== 'select' && drawingMode !== 'measure' ? (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 text-sm text-white pointer-events-none flex items-center gap-2">
                  <span>
                    {drawingMode === 'draw_roof' && '🏠 Click to draw roof outline'}
                    {drawingMode === 'draw_ground' && '🌱 Click to draw ground area'}
                    {drawingMode === 'draw_fence' && '🔲 Click to draw fence line'}
                  </span>
                  <span className="text-slate-400">• Double-click to finish</span>
                  {drawnPoints.length > 0 ? <span className="text-amber-400 font-semibold">{drawnPoints.length} pts</span> : null}
                </div>
              ) : null}
              {drawingMode === 'measure' ? (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 text-sm text-cyan-300 pointer-events-none">
                  📏 Click to measure distance • Double-click to clear
                  {measureDistance !== null ? <span className="ml-2 font-bold">{measureDistance.toFixed(1)}m</span> : null}
                </div>
              ) : null}

              {/* v30.9: Multi-row mode hint */}
              {multiRowMode ? (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 text-sm text-amber-300 pointer-events-none flex items-center gap-2">
                  <span>⊞ Multi-Row Tool ({multiRowCount} rows)</span>
                  <span className="text-slate-400">•</span>
                  <span>{multiRowStart ? '📍 Click end of first row' : '📍 Click start of first row'}</span>
                </div>
              ) : null}

              {/* v31.1: Active Tool Indicator */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 glass rounded-xl px-3 py-1.5 pointer-events-none">
                <span className={`w-2 h-2 rounded-full ${
                  multiRowMode ? 'bg-amber-400 animate-pulse' :
                  drawingMode === 'select' ? 'bg-emerald-400' :
                  drawingMode === 'draw_roof' ? 'bg-amber-400' :
                  drawingMode === 'draw_ground' ? 'bg-teal-400' :
                  drawingMode === 'draw_fence' ? 'bg-purple-400' :
                  drawingMode === 'measure' ? 'bg-cyan-400' : 'bg-slate-400'
                }`} />
                <span className="text-xs text-slate-300 font-medium">
                  {multiRowMode ? `⊞ Multi-Row (${multiRowCount} rows)` :
                   drawingMode === 'select' ? '↖ Select' :
                   drawingMode === 'draw_roof' ? '🏠 Draw Roof Zone' :
                   drawingMode === 'draw_ground' ? '🌱 Draw Ground Zone' :
                   drawingMode === 'draw_fence' ? '🔲 Draw Fence Line' :
                   drawingMode === 'measure' ? '📏 Measure' : drawingMode}
                </span>
                {selectedPanelIds.size > 0 ? (
                  <span className="text-xs text-amber-400 font-semibold ml-1">
                    · {selectedPanelIds.size} selected
                  </span>
                ) : null}
                <span className="text-xs text-slate-600 ml-1">V/R/G/F/M</span>
              </div>

              {/* Zoom controls */}
              <div className="absolute bottom-10 right-4 flex flex-col gap-1">
                <button onClick={() => setZoom(z => Math.min(21, z + 1))} className="w-8 h-8 bg-slate-800 border border-slate-600 rounded-lg text-white hover:bg-slate-700 flex items-center justify-center font-bold text-lg">+</button>
                <div className="w-8 h-6 bg-slate-800/60 border border-slate-700 rounded flex items-center justify-center text-xs text-slate-400">{zoom}</div>
                <button onClick={() => setZoom(z => Math.max(14, z - 1))} className="w-8 h-8 bg-slate-800 border border-slate-600 rounded-lg text-white hover:bg-slate-700 flex items-center justify-center font-bold text-lg">−</button>
              </div>

              {/* Panel count overlay */}
              {panels.length > 0 ? (
                <div className="absolute bottom-10 left-4 glass rounded-xl px-3 py-2">
                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Layers size={12} className="text-amber-400" />
                      <span className="text-white font-semibold">{panels.length} panels</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Zap size={12} className="text-amber-400" />
                      <span className="text-amber-400 font-bold">{systemSizeKw.toFixed(2)} kW</span>
                    </div>
                    {selectedPanelIds.size > 0 ? (
                      <span className="text-blue-400">{selectedPanelIds.size} selected</span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Bill analysis recommendation banner */}
              {billAnalysis && panels.length === 0 ? (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-3 text-sm pointer-events-none max-w-sm text-center">
                  <div className="text-amber-400 font-semibold">Recommended System Size</div>
                  <div className="text-white text-lg font-bold">{billAnalysis.recommendedSystemKw} kW</div>
                  <div className="text-slate-400 text-xs">~{billAnalysis.recommendedPanelCount} panels • Draw your {activeZoneType === 'roof' ? 'roof' : activeZoneType === 'ground' ? 'ground area' : 'fence line'} to place panels</div>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ── Right Sidebar ── */}
        <div className="w-64 xl:w-80 bg-slate-900 border-l border-slate-700/50 flex flex-col flex-shrink-0 min-h-0">
          {/* Tab bar */}
          <div className="flex border-b border-slate-700/50 flex-shrink-0">
            {[
              { id: 'design', label: 'Design', icon: <Settings size={12} /> },
              { id: 'bill', label: 'Bill', icon: <Calculator size={12} /> },
              { id: 'equipment', label: 'Equipment', icon: <Zap size={12} /> },
              { id: 'battery', label: 'Battery', icon: <BatteryIcon size={12} /> },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-500/5'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* ── DESIGN TAB ── */}
            {activeTab === 'design' ? (
              <>
                {/* System Summary — always visible so Calculate Production is always accessible */}
                <Section title="System Summary" icon={<Zap size={12} />}>
                  {panels.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { label: 'Panels', value: panels.length.toString(), color: 'text-white' },
                        { label: 'System Size', value: `${systemSizeKw.toFixed(2)} kW`, color: 'text-amber-400' },
                        { label: 'Panel Wattage', value: `${selectedPanel.wattage}W`, color: 'text-white' },
                        { label: 'Array Area', value: `${(panels.length * selectedPanel.width * selectedPanel.height * FEET_PER_METER * FEET_PER_METER).toFixed(0)} ft²`, color: 'text-white' },
                      ].map(item => (
                        <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                          <div className="text-slate-400">{item.label}</div>
                          <div className={`font-semibold ${item.color}`}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 bg-slate-800/40 rounded-lg p-2.5 border border-slate-700/40 text-center">
                      Place panels on the roof to see system summary
                    </div>
                  )}
                  {/* Phase 2I: PVWatts-quality production estimate with monthly breakdown */}
                  {quickEstimate && !production ? (
                    <div className="bg-slate-800/60 rounded-lg p-2.5 border border-slate-700/50">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Sun size={11} className="text-amber-400" />
                        <span className="text-xs text-slate-400 font-medium">Production Estimate</span>
                        <ConfidenceBadge
                          confidence={quickEstimate.source === 'local' ? 'medium' : 'low'}
                          source={quickEstimate.source === 'local' ? 'local_calc' : 'fallback'}
                          size="xs"
                        />
                        <span className="text-xs text-slate-600 ml-auto">
                          {quickEstimate.source === 'local' ? 'PVWatts method' : 'rough estimate'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-xs">
                        <div className="text-center">
                          <div className="text-amber-400 font-bold">{quickEstimate.annualKwh.toLocaleString()}</div>
                          <div className="text-slate-500">kWh/yr</div>
                        </div>
                        <div className="text-center">
                          <div className="text-emerald-400 font-bold">${quickEstimate.annualSavings.toLocaleString()}</div>
                          <div className="text-slate-500">est. savings</div>
                        </div>
                        <div className="text-center">
                          <div className="text-blue-400 font-bold">{quickEstimate.peakSunHours}</div>
                          <div className="text-slate-500">sun hrs/day</div>
                        </div>
                      </div>
                      {/* Monthly production sparkline */}
                      {quickEstimate.monthlyProduction ? (
                        <div className="mt-2">
                          <div className="text-xs text-slate-500 mb-1">Monthly</div>
                          <div className="flex items-end gap-px h-8">
                            {quickEstimate.monthlyProduction.map((kwh: number, i: number) => {
                              const max = Math.max(...quickEstimate.monthlyProduction);
                              return (
                                <div key={i} className="flex-1 flex flex-col items-center">
                                  <div
                                    className="w-full bg-amber-500/50 rounded-sm"
                                    style={{ height: `${(kwh / max) * 28}px` }}
                                    title={`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}: ${kwh.toLocaleString()} kWh`}
                                  />
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-between text-slate-600 mt-0.5" style={{ fontSize: '6px' }}>
                            <span>J</span><span>F</span><span>M</span><span>A</span><span>M</span><span>J</span>
                            <span>J</span><span>A</span><span>S</span><span>O</span><span>N</span><span>D</span>
                          </div>
                        </div>
                      ) : null}
                      <div className="text-xs text-slate-600 mt-1.5 text-center">API calculation pending...</div>
                    </div>
                  ) : null}
                  {/* QW-10: Production auto-calculates with 3s debounce.
                      This button allows immediate re-calculation if needed. */}
                  <button
                    onClick={calculateProduction}
                    disabled={calculating || panels.length === 0}
                    className={`w-full mt-1 text-sm font-medium rounded-lg px-3 py-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      calculating
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-slate-700/50 text-slate-300 border border-slate-600 hover:bg-slate-600/50'
                    }`}
                  >
                    {calculating ? <><Loader size={14} className="animate-spin" /> Calculating...</> : <><Play size={14} /> Recalculate</>}
                  </button>
                  {!calculating && panels.length > 0 && !production ? (
                    <div className="text-xs text-slate-500 text-center mt-0.5">
                      Auto-calculating in 3s...
                    </div>
                  ) : null}
                  {calcMessage ? (
                    <div className={`text-xs mt-1 px-2 py-1.5 rounded-lg ${
                      calcMessage.startsWith('✅')
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {calcMessage}
                    </div>
                  ) : null}
                  {/* Generate Proposal — always visible, disabled until production is calculated */}
                  <Link
                    href={production ? `/proposals?projectId=${project.id}` : '#'}
                    onClick={e => { if (!production) e.preventDefault(); }}
                    className={`btn-primary w-full mt-1 text-xs text-center ${!production ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
                  >
                    Generate Proposal <ArrowRight size={12} />
                  </Link>
                  {!production ? (
                    <div className="text-xs text-slate-600 text-center -mt-1">Calculate production first</div>
                  ) : null}
                </Section>

                {/* Production Results */}
                {production ? (
                  <Section title="Production Results" icon={<BarChart2 size={12} />}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <ConfidenceBadge
                        confidence={production.pvWattsData ? 'high' : 'medium'}
                        source={production.pvWattsData ? 'pvwatts' : 'local_calc'}
                        detail={production.pvWattsData ? 'NREL API' : 'local calc'}
                        size="xs"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { label: 'Annual Production', value: `${production.annualProductionKwh.toLocaleString()} kWh`, color: 'text-amber-400' },
                        { label: 'Offset', value: `${production.offsetPercentage}%`, color: production.offsetPercentage >= 100 ? 'text-emerald-400' : 'text-blue-400' },
                        { label: 'Specific Yield', value: `${production.specificYield} kWh/kWp`, color: 'text-white' },
                        { label: 'CO₂ Offset', value: `${production.co2OffsetTons} tons/yr`, color: 'text-emerald-400' },
                      ].map(item => (
                        <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                          <div className="text-slate-400 text-xs">{item.label}</div>
                          <div className={`font-semibold text-xs ${item.color}`}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1.5">Monthly Production (kWh)</div>
                      <div className="flex items-end gap-0.5 h-12">
                        {production.monthlyProductionKwh.map((kwh: number, i: number) => {
                          const max = Math.max(...production.monthlyProductionKwh);
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                              <div
                                className="w-full bg-amber-500/70 rounded-sm hover:bg-amber-400 transition-colors"
                                style={{ height: `${(kwh / max) * 40}px` }}
                                title={`${MONTHS[i]}: ${kwh.toLocaleString()} kWh`}
                              />
                              <span className="text-slate-600" style={{ fontSize: '7px' }}>{MONTHS[i]}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">Energy Offset</span>
                        <span className="font-semibold text-white">{production.offsetPercentage}%</span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill bg-gradient-to-r from-amber-500 to-emerald-500" style={{ width: `${Math.min(100, production.offsetPercentage)}%` }} />
                      </div>
                    </div>
                  </Section>
                ) : null}

                {/* Cost Estimate */}
                {costEstimate ? (
                  <Section title="Cost Estimate" icon={<DollarSign size={12} />}>
                    <div className="space-y-2 text-xs">
                      {[
                        { label: 'Gross System Cost', value: `$${costEstimate.grossCost.toLocaleString()}` },
                        { label: 'Est. Incentives / ITC*', value: costEstimate.taxCredit > 0 ? `-$${costEstimate.taxCredit.toLocaleString()}` : 'See proposal', color: 'text-emerald-400' },
                      ].map(item => (
                        <div key={item.label} className="flex justify-between">
                          <span className="text-slate-400">{item.label}</span>
                          <span className={`font-semibold ${(item as any).color || 'text-white'}`}>{item.value}</span>
                        </div>
                      ))}
                      <div className="border-t border-slate-700 pt-2 flex justify-between">
                        <span className="text-slate-300 font-semibold">Net Cost</span>
                        <span className="font-bold text-amber-400">${costEstimate.netCost.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Annual Savings</span>
                        <span className="font-semibold text-emerald-400">${costEstimate.annualSavings.toLocaleString()}/yr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Payback Period</span>
                        <span className="font-semibold text-white">{costEstimate.paybackYears} years</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">25-Year Savings</span>
                        <span className="font-semibold text-emerald-400">${costEstimate.lifetimeSavings.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">ROI</span>
                        <span className="font-semibold text-emerald-400">{costEstimate.roi}%</span>
                      </div>
                    </div>
                    <Link href={`/proposals?projectId=${project.id}`} className="btn-primary w-full mt-2 text-xs">
                      Generate Proposal <ArrowRight size={12} />
                    </Link>
                  </Section>
                ) : null}
                {/* System Configuration */}
                <Section title="Configuration" icon={<Settings size={12} />} defaultOpen={true}>
                  {/* Active Zone Type Switcher */}
                  <div className="mb-3">
                    <div className="text-xs text-slate-500 mb-1.5">Active Drawing Zone</div>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { type: 'roof' as SystemType, label: '🏠 Roof', color: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
                        { type: 'ground' as SystemType, label: '🌱 Ground', color: 'border-teal-500/40 bg-teal-500/10 text-teal-400' },
                        { type: 'fence' as SystemType, label: '⚡ Fence', color: 'border-purple-500/40 bg-purple-500/10 text-purple-400' },
                      ].map(({ type, label, color }) => (
                        <button
                          key={type}
                          onClick={() => {
                            setActiveZoneType(type);
                            if (type === 'roof') setDrawingMode('draw_roof');
                            else if (type === 'ground') setDrawingMode('draw_ground');
                            else setDrawingMode('draw_fence');
                          }}
                          className={`px-1 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                            activeZoneType === type ? color : 'border-slate-700 text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Phase 2F: System type inference hint */}
                    {(() => {
                      const sunbeltStates = ['AZ', 'NM', 'NV', 'TX', 'CA', 'FL', 'CO', 'UT'];
                      const isSunbelt = sunbeltStates.includes(project.stateCode || '');
                      return isSunbelt && project.systemType === 'roof' ? (
                        <div className="mt-1.5 px-2 py-1 rounded border border-amber-500/20 bg-amber-500/5 text-[10px] text-amber-300 flex items-center gap-1.5">
                          <ConfidenceBadge confidence="medium" source="address-lookup" size="xs" />
                          <span>Ground mount viable in your state — high irradiance. Switch if roof space is limited.</span>
                        </div>
                      ) : null;
                    })()}
                  </div>

                  {activeZoneType !== 'fence' ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-slate-400 flex items-center gap-1.5">
                          Tilt Angle
                          <ConfidenceBadge confidence={tiltComputed.confidence} source={tiltComputed.source} size="xs" />
                        </label>
                        <span className="text-xs font-semibold text-white">{tilt}°</span>
                      </div>
                      <input
                        type="range" min={0} max={45} step={1} value={tilt}
                        onChange={e => setTilt(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Optimal: |lat| = {Math.abs(initialLat).toFixed(0)}° for max annual production
                      </p>
                    </div>
                  ) : null}
                  {activeZoneType === 'fence' ? (
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 text-xs text-purple-300">
                      ⚡ Vertical mount (90°) — Sol Fence bifacial optimized
                    </div>
                  ) : null}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-slate-400 flex items-center gap-1.5">
                        Azimuth
                        <ConfidenceBadge confidence={azimuthComputed.confidence} source={azimuthComputed.source} size="xs" />
                      </label>
                      <span className="text-xs font-semibold text-white">{azimuth}° ({azimuthLabel(azimuth)})</span>
                    </div>
                    <input
                      type="range" min={0} max={360} step={5} value={azimuth}
                      onChange={e => setAzimuth(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
                    />
                    <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                      <span>N</span><span>E</span><span>S</span><span>W</span><span>N</span>
                    </div>
                  </div>

                  {activeZoneType === 'roof' ? (
                    <SliderRow label="Roof Setback" value={setback} min={0} max={2.0} step={0.05} unit="m" onChange={v => { clearGridCache(); setSetback(v); }} />
                  ) : null}
                  {(activeZoneType === 'roof' || activeZoneType === 'ground') ? (
                    <SliderRow label="Row Spacing" value={rowSpacing} min={0.01} max={3.0} step={0.01} unit="m" onChange={v => { clearGridCache(); setRowSpacing(v); }} />
                  ) : null}
                  <SliderRow label="Panel Spacing" value={panelSpacing} min={0.001} max={0.05} step={0.001} unit="m" onChange={v => { clearGridCache(); setPanelSpacing(v); }} />

                  {/* v63: Racking → mid-clamp gap drives panel spacing & the firewalk filter */}
                  {(activeZoneType === 'roof' || activeZoneType === 'fence') ? (
                    <div className="py-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-400">Racking (mid-clamp)</span>
                        <span className="text-xs text-cyan-400 font-mono">{getMidClampGapInches(rackingId).toFixed(2)}&quot; gap</span>
                      </div>
                      <select
                        value={rackingId}
                        onChange={e => applyRacking(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600 rounded text-xs text-slate-200 px-2 py-1"
                      >
                        {RACKING_SYSTEMS.filter(r => activeZoneType === 'fence'
                          ? r.systemType === 'fence'
                          : (r.systemType === 'roof' || r.systemType === 'flat_roof')
                        ).map(r => (
                          <option key={r.id} value={r.id}>{r.manufacturer} {r.model}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Mid-clamp gaps accumulate across each row — applied to panel spacing and the firewalk filter.
                      </p>
                    </div>
                  ) : null}

                  {/* v63: Strings & Equipment visualization */}
                  <div className="py-1 mt-1 border-t border-slate-700/60 pt-2">
                    <div className="flex items-center gap-1 mb-1.5">
                      <Zap size={11} className="text-amber-400" />
                      <span className="text-xs font-medium text-amber-400">Strings &amp; Equipment</span>
                    </div>
                    <label className="text-[10px] text-slate-400">Topology</label>
                    <select
                      value={topology}
                      onChange={e => setTopology(e.target.value as Topology)}
                      className="w-full bg-slate-800 border border-slate-600 rounded text-xs text-slate-200 px-2 py-1 mb-1.5"
                    >
                      <option value="string">String (no module electronics)</option>
                      <option value="optimizer">String + Optimizers</option>
                      <option value="micro">Microinverters</option>
                    </select>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-slate-400">Modules / string</span>
                      <input
                        type="number" min={1} max={30} value={modulesPerString}
                        onChange={e => setModulesPerString(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
                        className="w-16 bg-slate-800 border border-slate-600 rounded text-xs text-slate-200 px-2 py-1 text-right"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setColorByString(v => !v)}
                        className={`flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${colorByString ? 'border-blue-500/50 bg-blue-500/10 text-blue-400' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
                      >
                        🎨 {colorByString ? 'Strings ✓' : 'Color strings'}
                      </button>
                      <button
                        onClick={toggleEquipment}
                        className={`flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${showEquipment ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
                      >
                        ⚡ {showEquipment ? 'Equip ✓' : 'Show equip'}
                      </button>
                    </div>
                    {showEquipment ? (
                      <div className="mt-1.5">
                        <SliderRow label="Panel Opacity" value={panelOpacity} min={0.1} max={1} step={0.05} unit="" onChange={setPanelOpacity} />
                      </div>
                    ) : null}
                    {(colorByString || showEquipment) ? (
                      <p className="text-[10px] text-slate-500 mt-1">
                        {stringAssignment.strings.length} string{stringAssignment.strings.length !== 1 ? 's' : ''}
                        {stringAssignment.deviceType !== 'none'
                          ? ` · ${stringAssignment.deviceCount} ${stringAssignment.deviceType === 'micro' ? 'micros' : 'optimizers'}`
                          : ''}
                      </p>
                    ) : null}

                    {/* v63: Manual string painting — click panels in 3D to assign them */}
                    {panels.length > 0 ? (
                      <div className="mt-2 pt-2 border-t border-slate-700/40">
                        <button
                          onClick={togglePaintMode}
                          className={`w-full flex items-center justify-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${paintMode ? 'border-fuchsia-500/60 bg-fuchsia-500/10 text-fuchsia-300' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
                        >
                          🖌 {paintMode ? 'Painting — click panels' : 'Paint strings'}
                        </button>
                        {paintMode ? (
                          <div className="mt-1.5">
                            <div className="text-[10px] text-slate-400 mb-1">Active string (click panels in 3D to assign):</div>
                            <div className="flex flex-wrap gap-1">
                              {stringAssignment.strings.map(s => (
                                <button
                                  key={s.stringIndex}
                                  onClick={() => setPaintStringIndex(s.stringIndex)}
                                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${paintStringIndex === s.stringIndex ? 'border-white text-white' : 'border-transparent text-slate-900'}`}
                                  style={{ background: s.color }}
                                  title={`${s.label} · ${s.panelCount} panels`}
                                >
                                  S{s.stringIndex + 1}
                                </button>
                              ))}
                              {(() => {
                                const nextIdx = stringAssignment.strings.length > 0
                                  ? Math.max(...stringAssignment.strings.map(s => s.stringIndex)) + 1
                                  : 0;
                                return (
                                  <button
                                    onClick={() => setPaintStringIndex(nextIdx)}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border ${paintStringIndex === nextIdx ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}
                                  >
                                    + New
                                  </button>
                                );
                              })()}
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[10px] text-slate-500">
                                → String {paintStringIndex + 1} · {Object.keys(stringOverrides).length} override{Object.keys(stringOverrides).length !== 1 ? 's' : ''}
                              </span>
                              {Object.keys(stringOverrides).length > 0 ? (
                                <button onClick={resetStringOverrides} className="text-[10px] text-slate-400 hover:text-red-400 underline">
                                  Reset to auto
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* v30.9 / v50.23: Panel Orientation Toggle — portrait | landscape | hybrid */}
                  <div className="py-1">
                    <label className="text-xs text-slate-400 block mb-1.5">Panel Orientation</label>
                    <div className="grid grid-cols-3 rounded-lg overflow-hidden border border-slate-600">
                      <button
                        onClick={() => { setOrientation('portrait'); relayoutWithOrientation('portrait'); }}
                        className={`py-1.5 text-xs font-medium transition-colors text-center ${orientation === 'portrait' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
                        title="Portrait — all panels tall (long edge vertical)"
                      >
                        ▯ Portrait
                      </button>
                      <button
                        onClick={() => { setOrientation('landscape'); relayoutWithOrientation('landscape'); }}
                        className={`py-1.5 text-xs font-medium transition-colors text-center border-x border-slate-600 ${orientation === 'landscape' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
                        title="Landscape — all panels wide (long edge horizontal)"
                      >
                        ▭ Land.
                      </button>
                      <button
                        onClick={() => { setOrientation('hybrid'); relayoutWithOrientation('hybrid'); }}
                        className={`py-1.5 text-xs font-medium transition-colors text-center ${orientation === 'hybrid' ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
                        title="Hybrid — auto-optimises each roof plane independently: portrait rows + landscape fill in ridge strip for maximum panel count"
                      >
                        ⚡ Hybrid
                      </button>
                    </div>
                  </div>

                  {/* v30.9: Fire Setback Controls (roof only) */}
                  {activeZoneType === 'roof' ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-red-400">🔥 Fire Setbacks</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setShowCADDebug(v => !v)}
                            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${showCADDebug ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
                            title="Show CAD debug overlay: usable polygon + row alignment lines"
                          >
                            📐 {showCADDebug ? 'CAD On' : 'CAD'}
                          </button>
                          <button
                            onClick={() => setShowSetbackZones(v => !v)}
                            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${showSetbackZones ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
                          >
                            {showSetbackZones ? <Eye size={10} /> : <EyeOff size={10} />}
                            {showSetbackZones ? 'Zones On' : 'Zones Off'}
                          </button>
                          {/* v47.118: Align panels to longest roof edge */}
                          <button
                            onClick={() => setAlignToEdge(v => !v)}
                            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${alignToEdge ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
                            title="Align panel grid to longest roof edge (recommended)"
                          >
                            📐 {alignToEdge ? 'Edge ✓' : 'Edge'}
                          </button>
                        </div>
                      </div>
                      {/* v62: AHJ fire-code requirements — what THIS jurisdiction requires
                          for ridge / valley / hip / eave / edge / pathway, with one-click apply. */}
                      {(() => {
                        const r = ahjRecord;
                        const M = 0.0254;
                        const cells: Array<[string, number]> = r ? [
                          ['Ridge',  r.ridgeSetbackInches],
                          ['Valley', r.valleySetbackInches],
                          ['Hip',    r.hipRoofSetbackInches],
                          ['Eave',   r.eaveSetbackInches],
                          ['Perim',  r.roofSetbackInches],
                          ['Pathway', r.pathwayWidthInches],
                        ] : [];
                        return (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-red-300">
                                {r ? `📍 ${r.city || r.county}, ${r.stateCode} requires` : '📋 IRC R324 defaults'}
                              </span>
                              {r ? <span className="text-[10px] text-slate-400">NEC {r.necVersion}</span> : null}
                            </div>
                            {r ? (
                              <>
                                <div className="grid grid-cols-3 gap-1">
                                  {cells.map(([label, inches]) => (
                                    <div key={label} className="rounded bg-slate-800/60 px-1.5 py-1 text-center">
                                      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
                                      <div className="text-xs font-semibold text-slate-200">{inches}″</div>
                                    </div>
                                  ))}
                                </div>
                                <div className="text-[10px] text-slate-500 leading-tight truncate" title={r.ahjName}>{r.ahjName}</div>
                                <button
                                  onClick={() => {
                                    setFireSetbacks(prev => ({
                                      ...prev,
                                      ridgeSetbackM: r.ridgeSetbackInches * M,
                                      // edge/side covers rake + hip + valley in the layout engine — use the strictest
                                      edgeSetbackM:  Math.max(r.valleySetbackInches, r.hipRoofSetbackInches, r.ridgeSetbackInches) * M,
                                      eaveSetbackM:  r.eaveSetbackInches * M,
                                      pathwayWidthM: r.pathwayWidthInches * M,
                                      enforcePathway: true,
                                    }));
                                    setSetback(r.roofSetbackInches * M);
                                  }}
                                  className="w-full text-[11px] py-1 rounded border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors"
                                >
                                  Apply {r.city || r.county} fire setbacks
                                </button>
                              </>
                            ) : (
                              <div className="text-[10px] text-slate-400 leading-snug">
                                18″ ridge · 18″ valley · 18″ hip · 36″ pathway (IRC R324). Set a project address to load the local jurisdiction&apos;s exact requirements.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <SliderRow
                        label="Edge Setback"
                        value={Math.round(fireSetbacks.edgeSetbackM * 39.37)}
                        min={12} max={36} step={1} unit="in"
                        onChange={v => setFireSetbacks(prev => ({ ...prev, edgeSetbackM: v / 39.37 }))}
                      />
                      <SliderRow
                        label="Ridge Setback"
                        value={Math.round(fireSetbacks.ridgeSetbackM * 39.37)}
                        min={12} max={36} step={1} unit="in"
                        onChange={v => setFireSetbacks(prev => ({ ...prev, ridgeSetbackM: v / 39.37 }))}
                      />
                      {/* v50.25: Eave/Gutter setback — default 0" (panels go to gutter line) */}
                      <SliderRow
                        label="Eave Setback"
                        value={Math.round((fireSetbacks.eaveSetbackM ?? 0) * 39.37)}
                        min={0} max={24} step={1} unit="in"
                        onChange={v => setFireSetbacks(prev => ({ ...prev, eaveSetbackM: v / 39.37 }))}
                      />
                      {(fireSetbacks.eaveSetbackM ?? 0) === 0 ? (
                        <div className="text-xs text-emerald-400/80 bg-emerald-500/10 rounded-lg p-2">
                          0″ eave — panels extend to gutter line (max coverage)
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-slate-400">Pathway (36″)</label>
                        <button
                          onClick={() => setFireSetbacks(prev => ({ ...prev, enforcePathway: !prev.enforcePathway }))}
                          className={`w-10 h-5 rounded-full transition-colors relative ${fireSetbacks.enforcePathway ? 'bg-red-500' : 'bg-slate-600'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${fireSetbacks.enforcePathway ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      {fireSetbacks.enforcePathway ? (
                        <div className="text-xs text-red-400/80 bg-red-500/10 rounded-lg p-2">
                          36″ side-edge pathway enforced — rake/hip edge setback includes pathway clearance
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* v30.9: Multi-Row Placement Tool */}
                  <div className="mt-2 pt-2 border-t border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-300">Multi-Row Tool</span>
                      <button
                        onClick={() => { setMultiRowMode(v => !v); setMultiRowStart(null); setMultiRowEnd(null); }}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${multiRowMode ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
                      >
                        {multiRowMode ? '✓ Active' : '⊞ Activate'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400 flex-1">Row Count</label>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setMultiRowCount(v => Math.max(2, v - 1))} className="w-6 h-6 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center justify-center text-xs">−</button>
                        <span className="text-xs font-semibold text-white w-5 text-center">{multiRowCount}</span>
                        <button onClick={() => setMultiRowCount(v => Math.min(20, v + 1))} className="w-6 h-6 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center justify-center text-xs">+</button>
                      </div>
                    </div>
                    {multiRowMode ? (
                      <div className="mt-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-2">
                        {multiRowStart ? '📍 Click end of first row to generate all rows' : '📍 Click start of first row on the map'}
                      </div>
                    ) : null}
                  </div>

                  {activeZoneType === 'ground' ? (
                    <>
                      <SliderRow label="Mount Height" value={groundHeight} min={0.3} max={2.0} step={0.1} unit="m" onChange={setGroundHeight} />
                      <SliderRow label="Panels Per Row" value={panelsPerRow} min={2} max={30} step={1} unit="" onChange={setPanelsPerRow} />
                    </>
                  ) : null}

                  {activeZoneType === 'fence' ? (
                    <>
                      <SliderRow label="Fence Height" value={fenceHeight} min={1.0} max={4.0} step={0.1} unit="m" onChange={setFenceHeight} />
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-slate-400">Bifacial E-W Optimization</label>
                        <button
                          onClick={() => setBifacialOptimized(!bifacialOptimized)}
                          className={`w-10 h-5 rounded-full transition-colors relative ${bifacialOptimized ? 'bg-amber-500' : 'bg-slate-600'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${bifacialOptimized ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      {bifacialOptimized ? (
                        <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg p-2">
                          +20% bifacial gain applied for E-W facing panels
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </Section>



                {/* Roof Analysis - Google Solar API */}
                {(() => {
                  // Show section always so user knows it exists
                  if (roofSegments.length === 0) {
                    return (
                      <Section title="Roof Analysis" icon={<Sun size={12} />} defaultOpen={false}>
                        <div className="text-xs text-slate-400 bg-slate-800/60 rounded-lg p-3 border border-slate-700/40 text-center">
                          <div className="text-2xl mb-1.5">🏠</div>
                          <div className="font-semibold text-slate-300 mb-1">No building selected</div>
                          <div className="text-slate-500 leading-relaxed">Use <span className="text-amber-400 font-medium">Pick House</span> in the 3D viewer to select a specific building — solar data will load for that exact address.</div>
                        </div>
                      </Section>
                    );
                  }
                  return null;
                })()}
                {roofSegments.length > 0 ? ((() => {
                  // Pre-compute summary stats
                  const totalAreaFt2 = roofSegments.reduce((s: number, seg: any) => s + (seg.areaM2 ?? seg.stats?.areaMeters2 ?? 0) * 10.7639, 0);
                  const bestSeg = roofSegments.reduce((best: any, seg: any) => {
                    const sun = seg.sunshineHours ?? seg.stats?.sunshineQuantiles?.[5] ?? 0;
                    const bestSun = best.sunshineHours ?? best.stats?.sunshineQuantiles?.[5] ?? 0;
                    return sun > bestSun ? seg : best;
                  }, roofSegments[0]);
                  const bestAz = bestSeg.azimuthDegrees ?? 180;
                  const bestAzLabel = ['N','NE','E','SE','S','SW','W','NW','N'][Math.round(bestAz / 45) % 8];
                  const bestSun = Math.round(bestSeg.sunshineHours ?? bestSeg.stats?.sunshineQuantiles?.[5] ?? 0);
                  const maxPanels = solarApiData?.solarPotential?.maxArrayPanelsCount ?? 0;
                  const peakKw = ((maxPanels * 400) / 1000).toFixed(1);
                  const maxSunshine = Math.max(...roofSegments.map((s: any) => s.sunshineHours ?? s.stats?.sunshineQuantiles?.[5] ?? 0));
                  return (
                    <Section title="Roof Analysis" icon={<Sun size={12} />} badge={`${roofSegments.length} sections`} defaultOpen={false}>
                      <div className="space-y-2">

                        {/* Address tag — shows which building this data is for */}
                        {solarDataAddress ? (
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-900/60 rounded px-2 py-1 border border-slate-700/30">
                            <span>📍</span>
                            <span className="truncate">{solarDataAddress}</span>
                          </div>
                        ) : null}

                        {/* v50.13: City-only address warning — data may not match building on screen */}
                        {solarDataCityOnly ? (
                          <div className="flex items-start gap-2 text-[10px] text-amber-300 bg-amber-500/10 rounded-lg px-2.5 py-2 border border-amber-500/30">
                            <span className="text-sm leading-none mt-0.5">⚠</span>
                            <div>
                              <div className="font-semibold mb-0.5">No street address — data may not match this building</div>
                              <div className="text-amber-200/70 leading-relaxed">
                                Solar data was loaded from city-level coordinates. For accurate results, enter a full street address (e.g. <span className="font-medium text-amber-300">123 Main St, Edwardsville IL</span>) or use <span className="font-medium text-amber-300">Pick House</span> to click the exact building.
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {/* Hero summary row */}
                        <div className="grid grid-cols-3 gap-1.5">
                          <div className="bg-slate-900/80 rounded-lg p-2 text-center border border-slate-700/50">
                            <div className="text-[10px] text-slate-500 mb-0.5">Total Roof</div>
                            <div className="text-sm font-bold text-white">{totalAreaFt2.toFixed(0)}</div>
                            <div className="text-[10px] text-slate-500">ft²</div>
                          </div>
                          <div className="bg-amber-500/10 rounded-lg p-2 text-center border border-amber-500/30">
                            <div className="text-[10px] text-amber-400 mb-0.5">Best Face</div>
                            <div className="text-sm font-bold text-white">{bestAzLabel}</div>
                            <div className="text-[10px] text-amber-400">{bestSun} hrs/yr</div>
                          </div>
                          <div className="bg-slate-900/80 rounded-lg p-2 text-center border border-slate-700/50">
                            <div className="text-[10px] text-slate-500 mb-0.5">Peak Power</div>
                            <div className="text-sm font-bold text-white">{peakKw}</div>
                            <div className="text-[10px] text-slate-500">kW max</div>
                          </div>
                        </div>

                        {/* Section table — compact rows (v50.11: labels + POA) */}
                        <div className="rounded-lg overflow-hidden border border-slate-700/40">
                          {/* 5 columns: Label | Area | Faces | POA | Sun */}
                          <div className="grid grid-cols-5 gap-0 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                            <div>Plane</div><div className="text-right">Area</div><div className="text-right">Faces</div><div className="text-right">POA</div><div className="text-right">Sun</div>
                          </div>
                          {roofSegments.map((segment: any, idx: number) => {
                            const area = (segment.areaM2 ?? segment.stats?.areaMeters2 ?? 0) * 10.7639;
                            const pitch = segment.pitchDegrees ?? 0;
                            const az = segment.azimuthDegrees ?? 180;
                            const sun = segment.sunshineHours ?? segment.stats?.sunshineQuantiles?.[5] ?? 0;
                            const azLabel = ['N','NE','E','SE','S','SW','W','NW','N'][Math.round(az / 45) % 8];
                            const sunPct = maxSunshine > 0 ? sun / maxSunshine : 0;
                            const isBest = segment === bestSeg;
                            const sunColor = sunPct > 0.85 ? 'text-amber-400' : sunPct > 0.65 ? 'text-yellow-400' : 'text-slate-400';
                            // v50.11: POA estimate + plane label
                            const poa = ghiToPoa(sun, pitch, az, mapCenter.lat);
                            const { color: poaColor } = poaQualityLabel(poa);
                            const label = segmentLabel(idx);
                            return (
                              <div key={idx} className={`grid grid-cols-5 gap-0 px-2 py-1.5 text-xs border-t border-slate-700/30 items-center ${isBest ? 'bg-amber-500/5' : idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}>
                                {/* Plane label badge */}
                                <div className="flex items-center gap-1">
                                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded font-bold text-[10px] ${isBest ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>
                                    {label}
                                  </span>
                                </div>
                                <div className="text-right text-slate-300">{area.toFixed(0)} ft²</div>
                                <div className="text-right">
                                  <span className="text-blue-400 font-semibold">{azLabel}</span>
                                  <span className="text-slate-600 ml-0.5 text-[10px]">{pitch.toFixed(0)}°</span>
                                </div>
                                <div className={`text-right font-semibold ${poaColor}`}>
                                  {poa > 0 ? poa.toLocaleString() : '—'}
                                </div>
                                <div className={`text-right font-semibold ${sunColor}`}>{sun > 0 ? sun.toFixed(0) : '—'}</div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Legend row */}
                        <div className="flex items-center justify-between text-[10px] text-slate-600">
                          <span>POA = kWh/m²/yr (est.)</span>
                          <span>Sun hrs/yr · Google Solar API</span>
                        </div>

                        {/* v50.11: Heatmap toggle button */}
                        {show3D ? (
                          <button
                            onClick={() => setShowIrradiance(v => !v)}
                            className={`w-full py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                              showIrradiance
                                ? 'bg-orange-500/20 border border-orange-500/40 text-orange-400'
                                : 'bg-slate-800/60 border border-slate-700/40 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
                            }`}
                          >
                            <span>☀</span>
                            <span>{showIrradiance ? 'Heatmap On — Click to Hide' : 'Show Irradiance Heatmap'}</span>
                          </button>
                        ) : null}

                        {/* v50.11: Irradiance colormap legend */}
                        {showIrradiance ? (
                          <div className="space-y-1">
                            <div className="h-3 rounded w-full" style={{
                              background: 'linear-gradient(to right, #3b82f6, #8b5cf6, #facc15, #f97316, #ef4444)',
                            }} />
                            <div className="flex justify-between text-[10px] text-slate-500">
                              <span>Low</span>
                              <span className="text-slate-400 font-medium">Annual Solar Flux (kWh/m²/yr)</span>
                              <span>High</span>
                            </div>
                          </div>
                        ) : null}

                      </div>
                    </Section>
                  );
                })()) : null}

                {/* ── Roof Planes Section ─────────────────────────────────────────── */}
                <Section
                    title="Roof Planes"
                    icon={<Home size={12} />}
                    badge={roofPlanes.length > 0 ? `${roofPlanes.length} planes` : undefined}
                    defaultOpen={false}
                  >
                    <div className="space-y-2">

                      {/* Nearmap aerial detect — real planes from licensed HD aerial, on demand */}
                      <button
                        onClick={detectRoofFromAerial}
                        disabled={aerialDetecting}
                        className="w-full py-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white"
                      >
                        {aerialDetecting ? (
                          <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Detecting from aerial…</>
                        ) : (
                          <>🛰️ Detect roof from aerial</>
                        )}
                      </button>

                      {/* Idle state */}                      {/* Idle state */}
                      {solarApiStatus === 'idle' && roofPlanes.length === 0 ? (
                        <div className="text-xs text-slate-400 bg-slate-800/60 rounded-lg p-2.5 border border-slate-700/40">
                          <div className="font-semibold text-slate-300 mb-1">No Planes Detected</div>
                          <div className="leading-relaxed">Navigate to an address to auto-detect, or use <span className="text-amber-400 font-medium">Draw Roof Zone</span> to trace manually.</div>
                        </div>
                      ) : null}

                      {/* Loading */}
                      {solarApiStatus === 'loading' ? (
                        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-2.5 border border-amber-500/20">
                          <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                          <span>Detecting roof planes…</span>
                        </div>
                      ) : null}

                      {/* Unavailable */}
                      {solarApiStatus === 'unavailable' && roofPlanes.length === 0 ? (
                        <div className="text-xs text-slate-400 bg-slate-800/60 rounded-lg p-2.5 border border-slate-700/40">
                          <div className="font-semibold text-slate-300 mb-1">⚠ Auto-detect Unavailable</div>
                          <div>Use <span className="text-amber-400 font-medium">Draw Roof Zone</span> to trace planes manually.</div>
                        </div>
                      ) : null}

                      {/* Address tag for Roof Planes */}
                      {solarDataAddress && roofPlanes.length > 0 ? (
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-900/60 rounded px-2 py-1 border border-slate-700/30">
                          <span>📍</span>
                          <span className="truncate">{solarDataAddress}</span>
                        </div>
                      ) : null}

                      {/* Unconfirmed banner */}
                      {roofPlanes.some(p => p.confirmed === false) ? (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-xs">
                          <div className="text-amber-300 font-semibold mb-1">🛰️ We found your roof sections</div>
                          <div className="text-slate-300 mb-2 leading-relaxed">
                            We automatically mapped your roof from satellite imagery. Take a quick look and confirm — or adjust anything that looks off.
                          </div>
                          <button
                            onClick={() => {
                              setRoofPlanes(prev => prev.map(p => ({ ...p, confirmed: true })));
                              toast.success('✅ Roof planes confirmed', `${roofPlanes.length} planes locked in for permit generation`);
                            }}
                            className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg text-xs transition-colors"
                          >
                            ✅ Confirm All Planes
                          </button>
                          <button
                            onClick={() => {
                              setRoofPlanes([]);
                              setSolarApiStatus('idle');
                              setDrawingMode('draw_roof');
                              toast.info('✏️ Draw mode activated', 'Use R key or toolbar to draw each roof plane');
                            }}
                            className="w-full mt-1.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-lg text-xs transition-colors"
                          >
                            ✏️ Draw Manually Instead
                          </button>
                        </div>
                      ) : null}

                      {/* All confirmed banner */}
                      {roofPlanes.length > 0 && roofPlanes.every(p => p.confirmed !== false) ? (
                        <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 rounded-lg p-2 border border-emerald-500/20">
                          <span>✅</span>
                          <span className="font-semibold">{roofPlanes.length} planes confirmed</span>
                          <span className="text-slate-500 ml-auto">Ready for permit</span>
                        </div>
                      ) : null}

                      {/* Plane table — contractor-grade compact rows */}
                      {roofPlanes.length > 0 ? (
                        <div className="rounded-lg overflow-hidden border border-slate-700/40">
                          {/* Header */}
                          <div className="grid grid-cols-[1.2rem_1fr_2rem_2.5rem_2rem] gap-1.5 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wide items-center">
                            <div></div>
                            <div>Plane</div>
                            <div className="text-right">Slope</div>
                            <div className="text-right">Faces</div>
                            <div></div>
                          </div>

                          {roofPlanes.map((plane, idx) => {
                            const azDir = ['N','NE','E','SE','S','SW','W','NW','N'][Math.round((plane.azimuth ?? 180) / 45) % 8];
                            const isUnconfirmed = plane.confirmed === false;
                            const areaFt2 = ((plane.area ?? 0) * 10.764).toFixed(0);
                            const isExpanded = expandedPlaneId === plane.id;
                            return (
                              <div key={plane.id} className={`border-t border-slate-700/30 ${isUnconfirmed ? 'bg-amber-500/5' : idx % 2 === 0 ? 'bg-slate-800/20' : ''}`}>
                                {/* Main row */}
                                <div
                                  className="grid grid-cols-[1.2rem_1fr_2rem_2.5rem_2rem] gap-1.5 px-2 py-1.5 items-center cursor-pointer hover:bg-slate-700/20 transition-colors"
                                  onClick={() => setExpandedPlaneId(isExpanded ? null : plane.id)}
                                >
                                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isUnconfirmed ? 'bg-amber-500/60' : 'bg-emerald-500/80'}`} />
                                  <div className="min-w-0">
                                    <span className="text-xs font-semibold text-white">Plane {idx + 1}</span>
                                    <span className="text-[10px] text-slate-500 ml-1">{areaFt2} ft²</span>
                                  </div>
                                  <div className="text-right text-[11px] text-amber-400 font-mono">{(plane.pitch ?? 0).toFixed(0)}°</div>
                                  <div className="text-right text-[11px] text-blue-400 font-semibold">{azDir}</div>
                                  <div className="flex items-center justify-end gap-0.5">
                                    <button
                                      onClick={e => { e.stopPropagation(); setRoofPlanes(prev => prev.filter(p => p.id !== plane.id)); }}
                                      className="w-4 h-4 flex items-center justify-center text-slate-600 hover:text-red-400 transition-colors text-[10px]"
                                      title="Delete"
                                    >✕</button>
                                  </div>
                                </div>

                                {/* Expanded editor */}
                                {isExpanded ? (
                                  <div className="px-3 pb-2.5 pt-0.5 border-t border-slate-700/20 bg-slate-900/30 space-y-2">
                                    {/* Confirm / unconfirm */}
                                    {isUnconfirmed ? (
                                      <button
                                        onClick={() => setRoofPlanes(prev => prev.map(p => p.id === plane.id ? { ...p, confirmed: true } : p))}
                                        className="w-full py-1 bg-emerald-600/80 hover:bg-emerald-500 text-white rounded text-[10px] font-semibold transition-colors"
                                      >
                                        ✓ Confirm This Plane
                                      </button>
                                    ) : null}
                                    {/* Slope slider */}
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-slate-500 w-10 flex-shrink-0">Slope</span>
                                      <input
                                        type="range" min={0} max={45} step={1}
                                        value={plane.pitch ?? 0}
                                        onChange={e => setRoofPlanes(prev => prev.map(p => p.id === plane.id ? { ...p, pitch: Number(e.target.value) } : p))}
                                        className="flex-1 h-1 accent-amber-400"
                                      />
                                      <span className="text-amber-400 font-mono text-[10px] w-5 text-right">{(plane.pitch ?? 0).toFixed(0)}°</span>
                                    </div>
                                    {/* Direction */}
                                    <div>
                                      <div className="text-[10px] text-slate-500 mb-1">Direction this face points</div>
                                      <div className="grid grid-cols-8 gap-0.5">
                                        {[{l:'N',a:0},{l:'NE',a:45},{l:'E',a:90},{l:'SE',a:135},{l:'S',a:180},{l:'SW',a:225},{l:'W',a:270},{l:'NW',a:315}].map(({l,a}) => {
                                          const isSel = Math.abs((plane.azimuth ?? 180) - a) < 23;
                                          return (
                                            <button key={l}
                                              onClick={() => setRoofPlanes(prev => prev.map(p => p.id === plane.id ? { ...p, azimuth: a } : p))}
                                              className={`py-0.5 rounded text-[9px] font-bold transition-all ${isSel ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white'}`}
                                            >{l}</button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                    {/* v50.23: Per-plane orientation override */}
                                    <div>
                                      <div className="text-[10px] text-slate-500 mb-1">Panel orientation for this plane</div>
                                      <div className="flex rounded-lg overflow-hidden border border-slate-600">
                                        {([
                                          { v: undefined,    label: 'Global', icon: '↑' },
                                          { v: 'portrait',   label: 'Portrait',  icon: '▯' },
                                          { v: 'landscape',  label: 'Land.',     icon: '▭' },
                                          { v: 'hybrid',     label: 'Hybrid',    icon: '⚡' },
                                        ] as { v: 'portrait' | 'landscape' | 'hybrid' | undefined; label: string; icon: string }[]).map(({ v, label, icon }) => {
                                          const isActive = plane.orientation === v;
                                          return (
                                            <button
                                              key={label}
                                              onClick={() => {
                                                setRoofPlanes(prev => prev.map(p =>
                                                  p.id === plane.id ? { ...p, orientation: v } : p
                                                ));
                                              }}
                                              className={`flex-1 py-0.5 text-[9px] font-semibold transition-colors ${
                                                isActive
                                                  ? v === 'hybrid' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                                                  : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                                              }`}
                                              title={v === undefined ? 'Use global orientation setting' : `Force ${label} on this plane`}
                                            >
                                              {icon} {label}
                                            </button>
                                          );
                                        })}
                                      </div>
                                      <div className="text-[9px] text-slate-600 mt-0.5">
                                        {plane.orientation === 'hybrid'
                                          ? '⚡ Auto-optimising: portrait rows + landscape ridge fill'
                                          : plane.orientation
                                          ? `Overrides global (${orientation}) for this plane only`
                                          : `Following global: ${orientation}`}
                                      </div>
                                    </div>
                                    {/* Re-layout */}
                                    <button
                                      onClick={() => relayoutPlane(plane)}
                                      className="w-full py-1.5 bg-blue-600/80 hover:bg-blue-500 text-white rounded-lg text-[10px] font-semibold transition-colors flex items-center justify-center gap-1"
                                    >
                                      ↺ Update Panel Layout
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {/* Add plane button */}
                      <button
                        onClick={() => { setDrawingMode('draw_roof'); setActiveZoneType('roof'); }}
                        className="w-full py-2 border border-dashed border-slate-600 hover:border-amber-500/50 hover:text-amber-400 text-slate-500 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Home size={11} />
                        Add Roof Plane
                      </button>

                    </div>
                  </Section>


              </>
            ) : null}

            {/* ── BILL ANALYSIS TAB ── */}
            {activeTab === 'bill' ? (
              <>
                <Section title="Bill Analysis" icon={<Calculator size={12} />} defaultOpen={true}>
                  <BillCalculator onAnalysis={setBillAnalysis} project={project} />

                  {/* Phase 2E: PVWatts Auto-Sizing Recommendation */}
                  {pvwattsLoading ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-3">
                      <span className="spinner w-3 h-3" />
                      Running PVWatts simulation...
                    </div>
                  ) : null}
                  {pvwattsSizing && billAnalysis ? (
                    <div className="mt-3">
                      <RecommendationCard
                        title="System Size"
                        currentDisplay={`${billAnalysis.recommendedSystemKw} kW`}
                        currentRaw={billAnalysis.recommendedSystemKw}
                        recommended={{
                          display: `${pvwattsSizing.recommendedKw}`,
                          raw: pvwattsSizing.recommendedKw,
                          confidence: pvwattsSizing.source === 'pvwatts' ? 'high' : 'medium',
                          source: pvwattsSizing.source === 'pvwatts' ? 'pvwatts' : 'state-avg',
                          unit: 'kW',
                        }}
                        reason={`PVWatts calculates ${pvwattsSizing.recommendedKw} kW for ${billAnalysis.annualKwh.toLocaleString()} kWh/yr at ${pvwattsSizing.peakSunHours} peak sun hours with ${billAnalysis.offsetTarget}% offset.`}
                        derivation={`Production model: ${pvwattsSizing.source === 'pvwatts' ? 'NREL PVWatts v8 API' : 'State average estimate'}. Annual production: ${pvwattsSizing.annualKwhProduction.toLocaleString()} kWh. Estimated panels: ~${pvwattsSizing.panelCount400w} (400W).`}
                        onApply={(kw) => {
                          // Apply the PVWatts recommendation — user can see it reflected in panel count guidance
                          toast.success('PVWatts sizing applied', `${kw} kW recommended for your consumption and location`);
                        }}
                        onDismiss={() => {}}
                        variant="inline"
                        data-testid="pvwatts-sizing-recommendation"
                      />
                    </div>
                  ) : null}
                </Section>

                {billAnalysis ? (
                  <Section title="Recommendation" icon={<TrendingUp size={12} />} defaultOpen={true}>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { label: 'Annual Usage', value: `${billAnalysis.annualKwh.toLocaleString()} kWh`, color: 'text-white' },
                        { label: 'Annual Bill', value: `$${billAnalysis.annualBill.toLocaleString()}`, color: 'text-red-400' },
                        { label: 'Recommended Size', value: `${billAnalysis.recommendedSystemKw} kW`, color: 'text-amber-400' },
                        { label: 'Est. Panels', value: `~${billAnalysis.recommendedPanelCount}`, color: 'text-white' },
                        { label: 'Offset Target', value: `${billAnalysis.offsetTarget}%`, color: 'text-emerald-400' },
                        { label: 'Utility Rate', value: `$${billAnalysis.utilityRate}/kWh`, color: 'text-white' },
                      ].map(item => (
                        <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                          <div className="text-slate-400">{item.label}</div>
                          <div className={`font-semibold ${item.color}`}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Monthly usage chart */}
                    <div>
                      <div className="text-xs text-slate-500 mb-1.5">Monthly Usage (kWh)</div>
                      <div className="flex items-end gap-0.5 h-12">
                        {billAnalysis.monthlyKwh.map((kwh, i) => {
                          const max = Math.max(...billAnalysis.monthlyKwh);
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                              <div
                                className="w-full bg-blue-500/60 rounded-sm hover:bg-blue-400 transition-colors"
                                style={{ height: `${(kwh / max) * 40}px` }}
                                title={`${MONTHS[i]}: ${kwh.toLocaleString()} kWh`}
                              />
                              <span className="text-slate-600" style={{ fontSize: '7px' }}>{MONTHS[i]}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs">
                      <div className="text-amber-400 font-semibold mb-1">💡 Design Tip</div>
                      <div className="text-slate-300">
                        Draw your {activeZoneType === 'roof' ? 'roof outline' : activeZoneType === 'ground' ? 'ground area' : 'fence line'} on the map.
                        The system will auto-place panels to reach your {billAnalysis.recommendedSystemKw} kW target.
                      </div>
                    </div>

                    {billAnalysis.batteryRecommendation ? (
                      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 text-xs">
                        <div className="text-purple-400 font-semibold mb-1">🔋 Battery Recommendation</div>
                        <div className="text-slate-300 mb-2">{billAnalysis.batteryRecommendation.reason}</div>
                        <div className="grid grid-cols-2 gap-1">
                          <div><span className="text-slate-500">Daily Usage:</span> <span className="text-white">{billAnalysis.batteryRecommendation.dailyUsageKwh} kWh</span></div>
                          <div><span className="text-slate-500">Night Usage:</span> <span className="text-white">{billAnalysis.batteryRecommendation.nighttimeUsageKwh} kWh</span></div>
                          <div><span className="text-slate-500">Rec. Capacity:</span> <span className="text-amber-400 font-semibold">{billAnalysis.batteryRecommendation.recommendedCapacityKwh} kWh</span></div>
                          <div><span className="text-slate-500">Backup:</span> <span className="text-white">{billAnalysis.batteryRecommendation.backupHours}h</span></div>
                        </div>
                        <button onClick={() => setActiveTab('battery')} className="btn-secondary w-full mt-2 text-xs">
                          View Battery Options →
                        </button>
                      </div>
                    ) : null}
                  </Section>
                ) : null}
              </>
            ) : null}

            {/* ── EQUIPMENT TAB ── */}
            {activeTab === 'equipment' ? (
              <>
                {/* Panel Selection */}
                <Section title="Solar Panels" icon={<Sun size={12} />} badge={`${availablePanels.length} models`}>
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={panelFilter}
                      onChange={e => setPanelFilter(e.target.value)}
                      placeholder="Search panels..."
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-500"
                    />
                  </div>

                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {filteredPanels.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { clearGridCache(); setSelectedPanel(p); }}
                        className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                          selectedPanel.id === p.id
                            ? 'bg-amber-500/15 border-amber-500/40'
                            : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-white truncate">{p.manufacturer}</div>
                            <div className="text-xs text-slate-400 truncate">{p.model}</div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-xs font-bold text-amber-400">{p.wattage}W</div>
                            <div className="text-xs text-slate-500">{p.efficiency}%</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs text-slate-500">{(p.width * FEET_PER_METER).toFixed(2)}×{(p.height * FEET_PER_METER).toFixed(2)}ft</span>
                          {p.bifacial ? <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">Bifacial</span> : null}
                          {p.cellType ? <span className="text-xs text-slate-600">{p.cellType}</span> : null}
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedPanel ? (
                    <div className="bg-slate-800/60 rounded-lg p-3 text-xs space-y-1.5">
                      <div className="text-slate-300 font-semibold">Selected: {selectedPanel.manufacturer} {selectedPanel.model}</div>
                      <div className="grid grid-cols-2 gap-1">
                        <div><span className="text-slate-500">Wattage:</span> <span className="text-amber-400 font-semibold">{selectedPanel.wattage}W</span></div>
                        <div><span className="text-slate-500">Efficiency:</span> <span className="text-white">{selectedPanel.efficiency}%</span></div>
                        <div><span className="text-slate-500">Size:</span> <span className="text-white">{(selectedPanel.width * FEET_PER_METER).toFixed(2)}×{(selectedPanel.height * FEET_PER_METER).toFixed(2)}ft</span></div>
                        <div><span className="text-slate-500">Temp Coeff:</span> <span className="text-white">{selectedPanel.temperatureCoeff}%/°C</span></div>
                        <div><span className="text-slate-500">Bifacial:</span> <span className={selectedPanel.bifacial ? 'text-emerald-400' : 'text-slate-400'}>{selectedPanel.bifacial ? `Yes (×${selectedPanel.bifacialFactor})` : 'No'}</span></div>
                        <div><span className="text-slate-500">Warranty:</span> <span className="text-white">{selectedPanel.warranty || 25}yr</span></div>
                      </div>
                    </div>
                  ) : null}
                </Section>

                {/* Inverter Selection */}
                <Section title="Inverters" icon={<Zap size={12} />} badge={`${availableInverters.length} models`} defaultOpen={false}>
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={inverterFilter}
                      onChange={e => setInverterFilter(e.target.value)}
                      placeholder="Search inverters..."
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-500"
                    />
                  </div>

                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {filteredInverters.map(inv => (
                      <button
                        key={inv.id}
                        onClick={() => setSelectedInverter(inv)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                          selectedInverter?.id === inv.id
                            ? 'bg-blue-500/15 border-blue-500/40'
                            : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-white truncate">{inv.manufacturer}</div>
                            <div className="text-xs text-slate-400 truncate">{inv.model}</div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-xs font-bold text-blue-400">{inv.capacity}kW</div>
                            <div className="text-xs text-slate-500">{inv.efficiency}%</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            inv.type === 'micro' ? 'bg-emerald-500/20 text-emerald-400' :
                            inv.type === 'optimizer' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-slate-700 text-slate-400'
                          }`}>{inv.type}</span>
                          {inv.batteryCompatible ? <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">Battery Ready</span> : null}
                          <span className="text-xs text-slate-600">${inv.pricePerUnit.toLocaleString()}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              </>
            ) : null}

            {/* ── BATTERY TAB ── */}
            {activeTab === 'battery' ? (
              <>
                <Section title="Battery Storage" icon={<BatteryIcon size={12} />} badge={`${availableBatteries.length} models`}>
                  <div className="text-xs text-slate-400 bg-slate-800/40 rounded-lg p-2.5">
                    Battery storage provides backup power, maximizes self-consumption, and protects against outages.
                  </div>

                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {availableBatteries.map((bat: any) => (
                      <button
                        key={bat.id}
                        onClick={() => setSelectedBattery(selectedBattery?.id === bat.id ? null : bat)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                          selectedBattery?.id === bat.id
                            ? 'bg-purple-500/15 border-purple-500/40'
                            : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-white truncate">{bat.manufacturer}</div>
                            <div className="text-xs text-slate-400 truncate">{bat.model}</div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-xs font-bold text-purple-400">{bat.capacityKwh} kWh</div>
                            <div className="text-xs text-slate-500">{bat.powerKw}kW</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            bat.chemistry === 'LFP' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                          }`}>{bat.chemistry}</span>
                          <span className="text-xs text-slate-500">{bat.roundTripEfficiency}% RTE</span>
                          {bat.cycles ? <span className="text-xs text-slate-600">{bat.cycles.toLocaleString()} cycles</span> : null}
                          <span className="text-xs text-slate-500">${bat.pricePerUnit.toLocaleString()}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>

                {selectedBattery ? (
                  <Section title="Battery Configuration" icon={<Settings size={12} />}>
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 text-xs">
                      <div className="font-semibold text-purple-300 mb-2">{selectedBattery.manufacturer} {selectedBattery.model}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div><span className="text-slate-500">Capacity:</span> <span className="text-purple-400 font-semibold">{selectedBattery.capacityKwh} kWh</span></div>
                        <div><span className="text-slate-500">Power:</span> <span className="text-white">{selectedBattery.powerKw} kW</span></div>
                        <div><span className="text-slate-500">Chemistry:</span> <span className="text-white">{selectedBattery.chemistry}</span></div>
                        <div><span className="text-slate-500">Warranty:</span> <span className="text-white">{selectedBattery.warranty}yr</span></div>
                        {selectedBattery.dimensions ? <div className="col-span-2"><span className="text-slate-500">Dimensions:</span> <span className="text-white">{selectedBattery.dimensions}</span></div> : null}
                        {selectedBattery.weight ? <div><span className="text-slate-500">Weight:</span> <span className="text-white">{selectedBattery.weight}kg</span></div> : null}
                      </div>
                    </div>

                    {selectedBattery.stackable ? (
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-xs text-slate-400">Number of Units</label>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setBatteryCount(Math.max(1, batteryCount - 1))}
                              className="w-6 h-6 rounded bg-slate-700 text-white flex items-center justify-center hover:bg-slate-600"
                            >
                              <MinusIcon size={12} />
                            </button>
                            <span className="text-white font-semibold w-6 text-center">{batteryCount}</span>
                            <button
                              onClick={() => setBatteryCount(Math.min(selectedBattery.maxUnits || 4, batteryCount + 1))}
                              className="w-6 h-6 rounded bg-slate-700 text-white flex items-center justify-center hover:bg-slate-600"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-slate-800/60 rounded-lg p-2">
                            <div className="text-slate-400">Total Capacity</div>
                            <div className="font-bold text-purple-400">{(selectedBattery.capacityKwh * batteryCount).toFixed(1)} kWh</div>
                          </div>
                          <div className="bg-slate-800/60 rounded-lg p-2">
                            <div className="text-slate-400">Total Cost</div>
                            <div className="font-bold text-white">${(selectedBattery.pricePerUnit * batteryCount).toLocaleString()}</div>
                          </div>
                          <div className="bg-slate-800/60 rounded-lg p-2">
                            <div className="text-slate-400">Total Power</div>
                            <div className="font-bold text-white">{(selectedBattery.powerKw * batteryCount).toFixed(1)} kW</div>
                          </div>
                          <div className="bg-slate-800/60 rounded-lg p-2">
                            <div className="text-slate-400">After Tax Credit</div>
                            <div className="font-bold text-emerald-400">${Math.round(selectedBattery.pricePerUnit * batteryCount * 0.7).toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Backup estimate */}
                    {billAnalysis ? (
                      <div className="bg-slate-800/60 rounded-lg p-3 text-xs">
                        <div className="text-slate-300 font-semibold mb-1.5">Backup Estimate</div>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Daily Usage</span>
                            <span className="text-white">{(billAnalysis.annualKwh / 365).toFixed(1)} kWh/day</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Battery Capacity</span>
                            <span className="text-purple-400">{(selectedBattery.capacityKwh * batteryCount).toFixed(1)} kWh</span>
                          </div>
                          <div className="flex justify-between border-t border-slate-700 pt-1">
                            <span className="text-slate-300 font-semibold">Backup Duration</span>
                            <span className="text-emerald-400 font-bold">
                              {((selectedBattery.capacityKwh * batteryCount) / (billAnalysis.annualKwh / 365) * 24).toFixed(1)}h
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </Section>
                ) : null}

                {!selectedBattery ? (
                  <div className="p-4 text-center text-slate-500 text-xs">
                    Select a battery above to configure storage
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}