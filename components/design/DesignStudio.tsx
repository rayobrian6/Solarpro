'use client';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type {
  Project, Layout, PlacedPanel, SolarPanel, Inverter, Battery,
  SystemType, DrawingMode, RoofPlane, BillAnalysis, BatteryRecommendation
} from '@/types';
import { generateFenceLayout, calculateSystemSize, polygonAreaM2 } from '@/lib/panelLayout';
import { generateRoofLayoutOptimized, generateGroundLayoutOptimized, clearGridCache } from '@/lib/panelLayoutOptimized';
import {
  type PanelOrientation,
  type FireSetbackConfig,
  type SetbackZone,
  DEFAULT_FIRE_SETBACKS,
  generateSetbackZones,
  calcEffectiveSetback,
  generateMultipleRows,
  calcMinRowSpacing,
} from '@/lib/placementEngine';
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
  Info, ChevronRight, Eye, EyeOff
} from 'lucide-react';
import Link from 'next/link';

interface Props {
  project: Project;
  onSave?: (layout: Layout) => void;
}

const TILE_SIZE = 256;

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
          {badge && <span className="ml-1 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs normal-case font-normal">{badge}</span>}
        </div>
        {open ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
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
function azimuthLabel(az: number) {
  const nearest = Object.keys(AZIMUTH_LABELS).map(Number).reduce((a, b) => Math.abs(b - az) < Math.abs(a - az) ? b : a);
  return AZIMUTH_LABELS[nearest];
}

// ─── Bill Analysis Calculator ─────────────────────────────────
function BillCalculator({ onAnalysis, project }: {
  onAnalysis: (analysis: BillAnalysis) => void;
  project: Project;
}) {
  const [mode, setMode] = useState<'monthly' | 'annual' | 'bill'>('monthly');
  const [annualKwh, setAnnualKwh] = useState(project.client?.annualKwh || 12000);
  const [avgMonthlyBill, setAvgMonthlyBill] = useState(project.client?.averageMonthlyBill || 180);
  const [utilityRate, setUtilityRate] = useState(project.client?.utilityRate || 0.15);
  const [offsetTarget, setOffsetTarget] = useState(100);
  const [monthlyKwh, setMonthlyKwh] = useState<number[]>(
    project.client?.monthlyKwh || Array(12).fill(1000)
  );
  const [wantBattery, setWantBattery] = useState(false);
  const [peakDemandHours, setPeakDemandHours] = useState(6);

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const calculate = () => {
    let kwh12: number[];
    let rate = utilityRate;

    if (mode === 'annual') {
      const avg = annualKwh / 12;
      kwh12 = Array(12).fill(0).map((_, i) => {
        const seasonal = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87];
        return Math.round(avg * seasonal[i]);
      });
    } else if (mode === 'bill') {
      const estKwh = avgMonthlyBill / rate;
      kwh12 = Array(12).fill(0).map((_, i) => {
        const seasonal = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87];
        return Math.round(estKwh * seasonal[i]);
      });
    } else {
      kwh12 = monthlyKwh;
    }

    const totalKwh = kwh12.reduce((a, b) => a + b, 0);
    const avgMonthly = totalKwh / 12;
    const peakMonth = kwh12.indexOf(Math.max(...kwh12));
    const peakKwh = kwh12[peakMonth];

    // System size: account for losses (~14%), offset target
    const systemKw = (totalKwh * (offsetTarget / 100)) / (1400); // ~1400 kWh/kW/yr avg
    const panelCount = Math.ceil((systemKw * 1000) / 400); // assume 400W panels

    let batteryRec: BatteryRecommendation | undefined;
    if (wantBattery) {
      const dailyKwh = totalKwh / 365;
      const nighttimeKwh = dailyKwh * 0.4; // ~40% used at night
      const recCapacity = Math.ceil(nighttimeKwh * 1.2); // 20% buffer
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
  };

  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="flex gap-1 bg-slate-800/60 rounded-lg p-1">
        {(['monthly', 'annual', 'bill'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              mode === m ? 'bg-amber-500 text-black font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            {m === 'monthly' ? 'Monthly' : m === 'annual' ? 'Annual kWh' : 'Avg Bill'}
          </button>
        ))}
      </div>

      {mode === 'monthly' && (
        <div>
          <div className="text-xs text-slate-400 mb-2">Enter monthly kWh usage:</div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((month, i) => (
              <div key={i}>
                <div className="text-xs text-slate-500 mb-0.5">{month}</div>
                <input
                  type="number"
                  value={monthlyKwh[i]}
                  onChange={e => {
                    const v = [...monthlyKwh];
                    v[i] = parseInt(e.target.value) || 0;
                    setMonthlyKwh(v);
                  }}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-xs text-white"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'annual' && (
        <div>
          <label className="text-xs text-slate-400">Annual kWh Usage</label>
          <input
            type="number"
            value={annualKwh}
            onChange={e => setAnnualKwh(parseInt(e.target.value) || 0)}
            className="w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
          />
        </div>
      )}

      {mode === 'bill' && (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-slate-400">Average Monthly Bill ($)</label>
            <input
              type="number"
              value={avgMonthlyBill}
              onChange={e => setAvgMonthlyBill(parseInt(e.target.value) || 0)}
              className="w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Utility Rate ($/kWh)</label>
            <input
              type="number"
              step="0.01"
              value={utilityRate}
              onChange={e => setUtilityRate(parseFloat(e.target.value) || 0)}
              className="w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
      )}

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

      <button
        onClick={calculate}
        className="btn-primary w-full text-sm"
      >
        <Calculator size={14} /> Calculate System Size
      </button>
    </div>
  );
}

// ─── Main Design Studio ───────────────────────────────────────
export default function DesignStudio({ project, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

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
  const [mapTiles, setMapTiles] = useState<Map<string, HTMLImageElement>>(new Map());
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
  const [groundArea, setGroundArea] = useState<{ lat: number; lng: number }[]>([]);
  
  // Google Solar API data
  const [roofSegments, setRoofSegments] = useState<any[]>([]);
  const [solarApiData, setSolarApiData] = useState<any>(null);
  const [solarDataLoading, setSolarDataLoading] = useState(false);
  const [solarDataError, setSolarDataError] = useState<string | null>(null);
  const [fenceLine, setFenceLine] = useState<{ lat: number; lng: number }[]>([]);

  // Mixed system support - active drawing zone type
  const [activeZoneType, setActiveZoneType] = useState<SystemType>(project.systemType);
  const [selectedPanelIds, setSelectedPanelIds] = useState<Set<string>>(new Set());

  // 3D placement mode
  const [placementMode3D, setPlacementMode3D] = useState<PlacementMode>('select');
  const [showShade3D, setShowShade3D] = useState(false);

  // Equipment state
  const [availablePanels, setAvailablePanels] = useState<SolarPanel[]>([]);
  const [availableInverters, setAvailableInverters] = useState<Inverter[]>([]);
  const [availableBatteries, setAvailableBatteries] = useState<any[]>([]);
  const [selectedPanel, setSelectedPanel] = useState<SolarPanel>(
    project.selectedPanel || {
      id: 'panel-sp1', manufacturer: 'SunPower', model: 'Maxeon 7 440W',
      wattage: 440, width: 1.046, height: 1.812, efficiency: 22.8,
      bifacial: false, bifacialFactor: 1.0, temperatureCoeff: -0.27, pricePerWatt: 0.52,
    }
  );
  const [selectedInverter, setSelectedInverter] = useState<Inverter | null>(project.selectedInverter || null);
  const [selectedBattery, setSelectedBattery] = useState<any | null>(null);
  const [batteryCount, setBatteryCount] = useState(1);
  const [panelFilter, setPanelFilter] = useState('');
  const [inverterFilter, setInverterFilter] = useState('');

  // Config state
  const [tilt, setTilt] = useState(project.systemType === 'fence' ? 90 : 20);
  const [azimuth, setAzimuth] = useState(180);
  const [rowSpacing, setRowSpacing] = useState(1.5);
  const [panelSpacing, setPanelSpacing] = useState(0.02);
  const [setback, setSetback] = useState(0.9);
  const [bifacialOptimized, setBifacialOptimized] = useState(true);
  const [fenceHeight, setFenceHeight] = useState(2.0);
  const [groundHeight, setGroundHeight] = useState(0.6);
  const [panelsPerRow, setPanelsPerRow] = useState(10);
  const [show3D, setShow3D] = useState(true);  // Default to 3D view
  const [showPanels, setShowPanels] = useState(true);

  // v30.9: Panel orientation (portrait/landscape)
  const [orientation, setOrientation] = useState<PanelOrientation>('portrait');

  // v30.9: Fire setback configuration (AHJ-configurable)
  const [fireSetbacks, setFireSetbacks] = useState<FireSetbackConfig>(DEFAULT_FIRE_SETBACKS);
  const [showSetbackZones, setShowSetbackZones] = useState(false);
  const [setbackZones, setSetbackZones] = useState<SetbackZone[]>([]);

  // v30.9: Multi-row placement tool
  const [multiRowMode, setMultiRowMode] = useState(false);
  const [multiRowCount, setMultiRowCount] = useState(3);
  const [multiRowStart, setMultiRowStart] = useState<{lat: number; lng: number} | null>(null);
  const [multiRowEnd, setMultiRowEnd] = useState<{lat: number; lng: number} | null>(null);
  const [hoverPos, setHoverPos] = useState<{lat: number; lng: number} | null>(null); // v30.9: cursor tracking

  // Bill analysis state
  const [billAnalysis, setBillAnalysis] = useState<BillAnalysis | null>(null);
  const [activeTab, setActiveTab] = useState<'design' | 'bill' | 'equipment' | 'battery'>('design');

  // Calculation state
  const [calculating, setCalculating] = useState(false);
  const [production, setProduction] = useState<any>(null);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [calcMessage, setCalcMessage] = useState<string>('');

  // Auto-save refs — use refs for mapCenter/zoom so the debounce callback
  // doesn't get recreated on every map pan (which would reset the 3-second timer)
  const mapCenterRef = useRef(mapCenter);
  const zoomRef = useRef(zoom);
  const lastSavedPanelsRef = useRef<string>('[]');
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const panelsRef2 = useRef<PlacedPanel[]>(panels);
  const roofPlanesRef = useRef<RoofPlane[]>([]); // keeps roofPlanes accessible in saveLayoutToDB

  const systemSizeKw = calculateSystemSize(panels);

  // Quick production estimate (shown before full PVWatts calculation)
  const quickEstimate = useMemo(() => {
    if (panels.length === 0 || systemSizeKw === 0) return null;
    // Regional sun-hours lookup by latitude (rough estimate)
    const lat = mapCenter.lat;
    let peakSunHours = 4.5; // national average
    if (lat >= 25 && lat <= 35) peakSunHours = 5.8;       // Southwest (AZ, NM, TX, FL)
    else if (lat > 35 && lat <= 40) peakSunHours = 5.2;   // Mid-South (CA, CO, NC)
    else if (lat > 40 && lat <= 45) peakSunHours = 4.8;   // Mid-North (OH, PA, OR)
    else if (lat > 45) peakSunHours = 4.2;                 // Northwest/Northeast
    else if (lat < 25) peakSunHours = 5.5;                 // Hawaii/Puerto Rico

    // Tilt adjustment factor (optimal ~latitude angle)
    const tiltDiff = Math.abs(tilt - lat);
    const tiltFactor = 1 - (tiltDiff / 180) * 0.15;

    // System losses: ~14% (wiring, inverter, soiling, temp)
    const systemLoss = 0.86;
    const annualKwh = Math.round(systemSizeKw * peakSunHours * 365 * tiltFactor * systemLoss);
    const monthlyAvg = Math.round(annualKwh / 12);

    // Savings estimate at $0.15/kWh average
    const utilityRate = 0.15;
    const annualSavings = Math.round(annualKwh * utilityRate);

    return { annualKwh, monthlyAvg, annualSavings, peakSunHours };
  }, [panels.length, systemSizeKw, mapCenter.lat, tilt]);

  // Keep refs in sync with state
  useEffect(() => { mapCenterRef.current = mapCenter; }, [mapCenter]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panelsRef2.current = panels; }, [panels]);
  useEffect(() => { roofPlanesRef.current = roofPlanes; }, [roofPlanes]);

  // ── Auto-save layout to DB (3-second debounce after panel changes) ──────────
  const saveLayoutToDB = useCallback(async (panelList: PlacedPanel[]) => {
    const panelsJson = JSON.stringify(panelList);
    if (panelsJson === lastSavedPanelsRef.current) return; // nothing changed
    lastSavedPanelsRef.current = panelsJson;
    const payload = {
      panels: panelList,
      mapCenter: mapCenterRef.current,
      mapZoom: zoomRef.current,
      systemType: project.systemType,
      // Include roofPlanes so permit generator can use exact roof geometry
      roofPlanes: roofPlanesRef.current.length > 0 ? roofPlanesRef.current : undefined,
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
  }, [project.id, project.systemType]);

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
      if (JSON.stringify(panelList) === lastSavedPanelsRef.current) return;
      const payload = JSON.stringify({
        panels: panelList,
        mapCenter: mapCenterRef.current,
        mapZoom: zoomRef.current,
        systemType: project.systemType,
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
          lastSavedPanelsRef.current = JSON.stringify(data.data.panels);
          console.log(`[DesignStudio] Restored ${data.data.panels.length} panels from DB`);
        }
        // CRITICAL FIX: Also restore roofPlanes so roofPlanesRef stays populated
        // Without this, auto-save fires with roofPlanesRef.current = [] and roof planes are lost
        if (data.success && data.data?.roofPlanes && data.data.roofPlanes.length > 0) {
          setRoofPlanes(data.data.roofPlanes);
          console.log(`[DesignStudio] Restored ${data.data.roofPlanes.length} roof planes from DB`);
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
        setMapTiles(new Map()); // clear tiles to force reload at new location
        setLocationStatus('found');
        fetchSolarData(newLat, newLng);
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
    setMapTiles(new Map());
    fetchSolarData(s.lat, s.lng);
    setLocationStatus('found');
    toast.info('Loading site model...', `${s.short_name} · Resetting 3D scene`);
  }, [toast]);

  // Fetch Google Solar API data
  const fetchSolarData = useCallback(async (lat: number, lng: number) => {
    setSolarDataLoading(true);
    setSolarDataError(null);
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
    } catch (error: any) {
      console.error("Failed to fetch solar data:", error);
      setSolarDataError(error.message || "Failed to load solar data");
    } finally {
      setSolarDataLoading(false);
    }
  }, []);

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

    // Update map center and address bar
    setMapCenter({ lat: pickedLat, lng: pickedLng });
    setAddressSearch(pickedAddress);
    setLocationStatus('found');

    // Show toast
    toast.info('🏡 House selected', `Loading solar data for ${pickedAddress}`);

    // Fetch Solar API data for the new location
    fetchSolarData(pickedLat, pickedLng);

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
  // Phase 3-6: Priority chain:
  //   1. project.lat/lng (saved at creation — fastest, no async needed)
  //   2. project.client.lat/lng (client geocoded coords)
  //   3. Geocode project.address
  //   4. Geocode client address
  // Camera flies immediately to resolved coords — no wrong-location flash.
  useEffect(() => {
    // Phase 3: Project has its own geocoded coords (set at creation)
    if (hasValidCoords(project.lat, project.lng)) {
      setMapCenter({ lat: project.lat!, lng: project.lng! });
      setLocationStatus('found');
      fetchSolarData(project.lat!, project.lng!);
      if (project.address) setAddressSearch(project.address);
      return;
    }

    // Phase 6 fallback: try client coords
    if (hasValidCoords(project.client?.lat, project.client?.lng)) {
      setMapCenter({ lat: project.client!.lat!, lng: project.client!.lng! });
      setLocationStatus('found');
      fetchSolarData(project.client!.lat!, project.client!.lng!);
      if (project.client?.address) {
        setAddressSearch([project.client.address, project.client.city, project.client.state].filter(Boolean).join(', '));
      }
      return;
    }

    // Phase 6 fallback: geocode project address
    const projectAddr = project.address?.trim();
    if (projectAddr) {
      setLocationStatus('locating');
      setAddressSearch(projectAddr);
      geocodeAddress(projectAddr);
      return;
    }

    // Phase 6 fallback: geocode client address
    if (project.client?.address) {
      setLocationStatus('locating');
      const fullAddress = [
        project.client.address,
        project.client.city,
        project.client.state,
        project.client.zip,
      ].filter(Boolean).join(', ');
      setAddressSearch(fullAddress);
      geocodeAddress(fullAddress);
      return;
    }

    // No address at all — stay at default, let user search manually
    setLocationStatus('failed');
  }, [project.id]); // Only run once when project loads

  // ── Load map tiles ─────────────────────────────────────────
  // ArcGIS World Imagery max native zoom
  const ARCGIS_MAX_ZOOM = 19;

  const loadTiles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Clamp fetch zoom to ArcGIS max — we scale up on canvas if display zoom > 19
    const fetchZoom = Math.min(zoom, ARCGIS_MAX_ZOOM);
    const scale = Math.pow(2, zoom - fetchZoom); // e.g. zoom=20 gives scale=2

    // Compute tile coords at FETCH zoom
    const center = latLngToWorld(mapCenter.lat, mapCenter.lng, fetchZoom);
    const tileX = Math.floor(center.x / TILE_SIZE);
    const tileY = Math.floor(center.y / TILE_SIZE);

    // How many fetch-zoom tiles needed to cover canvas
    const tilesX = Math.ceil((canvas.width  / (TILE_SIZE * scale))) + 3;
    const tilesY = Math.ceil((canvas.height / (TILE_SIZE * scale))) + 3;

    const needed: string[] = [];
    for (let dx = -Math.floor(tilesX / 2); dx <= Math.floor(tilesX / 2); dx++) {
      for (let dy = -Math.floor(tilesY / 2); dy <= Math.floor(tilesY / 2); dy++) {
        needed.push(`${fetchZoom}/${tileX + dx}/${tileY + dy}`);
      }
    }

    needed.forEach(key => {
      if (mapTiles.has(key) && (mapTiles.get(key) as any)._loaded) return;
      const [fz, ftx, fty] = key.split('/').map(Number);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${fz}/${fty}/${ftx}`;
      img.onload = () => {
        (img as any)._loaded = true;
        setMapTiles(prev => {
          const next = new Map(prev);
          next.set(key, img);
          return next;
        });
        setMapLoaded(true);
      };
      img.onerror = () => {};

      setMapTiles(prev => {
        if (prev.has(key)) return prev;
        const next = new Map(prev);
        next.set(key, img);
        return next;
      });
    });
  }, [mapCenter, zoom]);

  useEffect(() => { if (!show3D) loadTiles(); }, [mapCenter, zoom, show3D]);

  // ── Draw canvas ────────────────────────────────────────────
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Draw map tiles
    // Tiles are stored at fetchZoom (clamped to ARCGIS_MAX_ZOOM=19)
    // If display zoom > 19, we scale tiles up on canvas
    const fetchZoom = Math.min(zoom, 19);
    const tileScale = Math.pow(2, zoom - fetchZoom); // 1 at zoom<=19, 2 at zoom=20, 4 at zoom=21
    const displayTileSize = TILE_SIZE * tileScale;

    // Center position in fetch-zoom world coords
    const fetchCenter = latLngToWorld(mapCenter.lat, mapCenter.lng, fetchZoom);

    mapTiles.forEach((img, key) => {
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

    const mpp = metersPerPixel(mapCenter.lat, zoom);
    const pxPerM = 1 / mpp;

    // Draw roof planes
    roofPlanes.forEach(plane => {
      if (plane.vertices.length < 2) return;
      ctx.beginPath();
      plane.vertices.forEach((v, i) => {
        const p = latLngToCanvas(v.lat, v.lng, mapCenter, zoom, W, H);
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(251, 191, 36, 0.12)';
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    });

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
      panels.forEach(panel => {
        // v31.1: per-panel orientation-aware dimensions
        const panelW = panel.orientation === 'landscape' ? selectedPanel.height : selectedPanel.width;
        const panelH = panel.orientation === 'landscape' ? selectedPanel.width : selectedPanel.height;
        const pw = panelW * pxPerM;
        const ph = panelH * pxPerM;

        const p = latLngToCanvas(panel.lat, panel.lng, mapCenter, zoom, W, H);
        const isSelected = selectedPanelIds.has(panel.id);

        ctx.save();
        ctx.translate(p.x, p.y);

        // v31.1: use per-panel systemType for color (supports mixed designs)
        const sType = panel.systemType ?? project.systemType;
        const color = sType === 'roof' ? '#f59e0b' :
                      sType === 'ground' ? '#14b8a6' : '#a855f7';

        // Panel shadow
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        // Panel body
        ctx.fillStyle = isSelected ? '#ffffff' : color;
        ctx.globalAlpha = isSelected ? 0.95 : 0.80;
        ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
        ctx.shadowColor = 'transparent';

        // Cell grid lines
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = isSelected ? '#f59e0b' : 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 0.5;
        const cols = 6, rows = 10;
        for (let c = 1; c < cols; c++) {
          ctx.beginPath();
          ctx.moveTo(-pw / 2 + (pw / cols) * c, -ph / 2);
          ctx.lineTo(-pw / 2 + (pw / cols) * c, ph / 2);
          ctx.stroke();
        }
        for (let r = 1; r < rows; r++) {
          ctx.beginPath();
          ctx.moveTo(-pw / 2, -ph / 2 + (ph / rows) * r);
          ctx.lineTo(pw / 2, -ph / 2 + (ph / rows) * r);
          ctx.stroke();
        }

        // Panel border
        ctx.globalAlpha = isSelected ? 1 : 0.9;
        ctx.strokeStyle = isSelected ? '#fbbf24' : 'rgba(255,255,255,0.7)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);

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

  }, [mapCenter, zoom, mapTiles, panels, roofPlanes, groundArea, fenceLine,
      drawnPoints, selectedPanelIds, selectedPanel, drawingMode, showPanels,
      measurePoints, measureDistance, showSetbackZones, setbackZones,
      multiRowMode, multiRowStart, hoverPos, multiRowCount]);

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
      // v31.1: use per-panel orientation-aware hit box (not selectedPanel global dims)
      panels.forEach(panel => {
        const panelW = panel.orientation === 'landscape' ? selectedPanel.height : selectedPanel.width;
        const panelH = panel.orientation === 'landscape' ? selectedPanel.width : selectedPanel.height;
        const pw = panelW * pxPerM;
        const ph = panelH * pxPerM;
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

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom(prev => Math.max(14, Math.min(21, prev + (e.deltaY < 0 ? 1 : -1))));
  };

  const handleDoubleClick = () => {
    if (drawnPoints.length >= 2) finalizeDrawing();
    if (drawingMode === 'measure') {
      setMeasurePoints([]);
      setMeasureDistance(null);
    }
  };

  // ── Finalize drawing ───────────────────────────────────────
  const finalizeDrawing = () => {
    if (drawnPoints.length < 2) return;
    const latLngs = drawnPoints.map(p => ({ lat: p.lat, lng: p.lng }));

    if (drawingMode === 'draw_roof') {
      const area = polygonAreaM2(latLngs);
      const plane: RoofPlane = {
        id: uuidv4(), vertices: latLngs, pitch: tilt, azimuth,
        area, usableArea: area * 0.75,
      };
      setRoofPlanes(prev => [...prev, plane]);
      autoPlacePanels('roof', latLngs);
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
      });
      // Update setback zone overlay
      if (showSetbackZones) {
        setSetbackZones(generateSetbackZones(points, fireSetbacks));
      }
    } else if (type === 'ground') {
      newPanels = generateGroundLayoutOptimized({
        layoutId, area: points, panel: selectedPanel,
        tilt, azimuth, rowSpacing, panelSpacing, panelsPerRow, groundHeight,
        orientation,
      });
    } else if (type === 'fence') {
      newPanels = generateFenceLayout({ layoutId, fenceLine: points, panel: selectedPanel, azimuth, panelSpacing, fenceHeight, bifacialOptimized });
    }

    setPanels(prev => [...prev, ...newPanels]);
  };

  // ── Auto Layout: fill all existing zones with current settings ────────────────
  const [autoLayoutRunning, setAutoLayoutRunning] = useState(false);

  const autoLayoutAll = useCallback(() => {
    const hasZones = roofPlanes.length > 0 || groundArea.length > 0 || fenceLine.length > 0;
    if (!hasZones) {
      toast.error('No zones defined', 'Draw a roof, ground, or fence zone first, then click Auto Layout.');
      return;
    }
    setAutoLayoutRunning(true);
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback, panelSpacing, rowSpacing,
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
        orientation, fireSetbackM,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth, rowSpacing, panelSpacing, panelsPerRow, groundHeight,
        orientation,
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

    setPanels(allNew);
    setAutoLayoutRunning(false);
    toast.success(
      'Auto Layout complete',
      `${allNew.length} panels placed · ${(calculateSystemSize(allNew)).toFixed(2)} kW`
    );
  }, [roofPlanes, groundArea, fenceLine, selectedPanel, setback, panelSpacing, rowSpacing,
      tilt, azimuth, panelsPerRow, groundHeight, fenceHeight, bifacialOptimized]);

  // ── Fill Roof: maximize panels with minimal setback (0.3 m) ─────────────────
  const fillRoof = useCallback(() => {
    if (roofPlanes.length === 0 && groundArea.length === 0) {
      toast.error('No zones defined', 'Draw a roof or ground zone first.');
      return;
    }
    setAutoLayoutRunning(true);
    const minSetback = 0.3;
    const tightSpacing = 0.01;
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      // v30.9: fire setback takes precedence over minSetback
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      const effectiveSetback = Math.max(minSetback, fireSetbackM);
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback: effectiveSetback, panelSpacing: tightSpacing,
        rowSpacing: Math.max(rowSpacing * 0.85, selectedPanel.height + 0.05),
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
        orientation, fireSetbackM,
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
        orientation,
      });
      allNew = [...allNew, ...newPanels];
    }

    setPanels(allNew);
    setAutoLayoutRunning(false);
    toast.success(
      'Fill Roof complete',
      `${allNew.length} panels · ${(calculateSystemSize(allNew)).toFixed(2)} kW (max density)`
    );
  }, [roofPlanes, groundArea, selectedPanel, rowSpacing, tilt, azimuth, panelsPerRow, groundHeight]);

  // ── Optimize Layout: best production/cost ratio (wider row spacing) ──────────
  const optimizeLayout = useCallback(() => {
    if (roofPlanes.length === 0 && groundArea.length === 0) {
      toast.error('No zones defined', 'Draw a roof or ground zone first.');
      return;
    }
    setAutoLayoutRunning(true);
    // Optimal row spacing: panel height / tan(tilt) * 2 to avoid inter-row shading
    const tiltRad = (tilt * Math.PI) / 180;
    const shadowLength = tiltRad > 0.05 ? selectedPanel.height * Math.cos(tiltRad) / Math.tan(tiltRad) : selectedPanel.height;
    const optRowSpacing = Math.max(rowSpacing, selectedPanel.height + shadowLength * 0.5);
    const optSetback = Math.max(setback, 0.6);
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      const fireSetbackM = calcEffectiveSetback(fireSetbacks);
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback: optSetback, panelSpacing: 0.02, rowSpacing: optRowSpacing,
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
        orientation, fireSetbackM,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth, rowSpacing: optRowSpacing, panelSpacing: 0.02,
        panelsPerRow, groundHeight,
        orientation,
      });
      allNew = [...allNew, ...newPanels];
    }

    setPanels(allNew);
    setAutoLayoutRunning(false);
    toast.success(
      'Optimized Layout complete',
      `${allNew.length} panels · ${(calculateSystemSize(allNew)).toFixed(2)} kW · min shading`
    );
  }, [roofPlanes, groundArea, selectedPanel, setback, rowSpacing, tilt, azimuth, panelsPerRow, groundHeight]);

  // ── Calculate production ───────────────────────────────────
  const calculateProduction = async () => {
    if (panels.length === 0) return;
    setCalculating(true);
    setCalcMessage('');
    const toastId = toast.loading('Running production simulation...', `PVWatts · ${panels.length} panels · ${systemSizeKw.toFixed(2)} kW`);
    try {
      const layout = buildLayout();
      const res = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, layout }),
      });
      const data = await res.json();
      if (data.success) {
        setProduction(data.data.production);
        setCostEstimate(data.data.costEstimate);
        const annualKwh = data.data.production?.annualProductionKwh ?? 0;
        const sizeKw = data.data.layout?.systemSizeKw ?? layout.systemSizeKw;
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
    } catch (e: any) {
      setCalcMessage(`❌ ${e?.message || 'Network error'}`);
      toast.update(toastId, {
        type: 'error',
        title: 'Network error',
        message: e?.message || 'Could not connect to server',
      });
    } finally {
      setCalculating(false);
    }
  };

  const buildLayout = (): Omit<Layout, 'id' | 'createdAt' | 'updatedAt'> => {
    // Extract tilt/azimuth from actual placed panels (3D placement data)
    // This ensures production calculation uses real panel orientations
    let effectiveTilt = tilt;
    let effectiveAzimuth = azimuth;
    
    if (panels.length > 0) {
      // Use the most common tilt/azimuth from placed panels
      const tilts = panels.map((p: any) => p.tilt ?? tilt).filter((t: number) => t > 0);
      const azimuths = panels.map((p: any) => p.azimuth ?? azimuth).filter((a: number) => a > 0);
      
      if (tilts.length > 0) {
        effectiveTilt = tilts.reduce((a: number, b: number) => a + b, 0) / tilts.length;
      }
      if (azimuths.length > 0) {
        effectiveAzimuth = azimuths.reduce((a: number, b: number) => a + b, 0) / azimuths.length;
      }
    }

    // Build roof planes from placed panels if no manual roof planes drawn
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
      projectId: project.id,
      systemType: project.systemType,
      panels,
      roofPlanes: effectiveRoofPlanes,
      groundTilt: effectiveTilt,
      groundAzimuth: effectiveAzimuth,
      rowSpacing, groundHeight,
      fenceAzimuth: effectiveAzimuth,
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
        body: JSON.stringify({ projectId: project.id, layout }),
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
    } catch (e: any) {
      setSaveStatus('error');
      toast.update(toastId, {
        type: 'error',
        title: 'Save failed',
        message: e?.message || 'Network error',
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
      {/* ── Studio Header ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 border-b border-slate-700/50 flex-shrink-0">
        <div className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${systemTypeBg} ${systemTypeColor}`}>
          {systemTypeLabel}
        </div>
        <span className="font-semibold text-white text-sm truncate">{project.name}</span>
        {project.client && (
          <span className="text-xs text-slate-500 truncate hidden md:block">— {project.client.name}</span>
        )}

        {/* Address search with autocomplete */}
        <div className="flex items-center gap-2 ml-2 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 z-10" />
            <input
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

            {/* Autocomplete dropdown */}
            {showAddressSuggestions && addressSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 overflow-hidden">
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
            )}
          </div>
          <button
            onClick={() => { setShowAddressSuggestions(false); geocodeAddress(addressSearch); }}
            disabled={searchLoading || locationStatus === 'locating'}
            className="btn-secondary btn-sm px-2.5 flex-shrink-0"
          >
            {searchLoading || locationStatus === 'locating' ? <Loader size={12} className="animate-spin" /> : 'Go'}
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Automation buttons */}
          {(roofPlanes.length > 0 || groundArea.length > 0 || fenceLine.length > 0) && (
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
          )}
          {panels.length > 0 && (
            <div className="flex items-center gap-3 text-xs bg-slate-800/60 rounded-lg px-3 py-1.5">
              <span className="text-slate-400">{panels.length} panels</span>
              <span className="text-amber-400 font-bold">{systemSizeKw.toFixed(2)} kW</span>
            </div>
          )}
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

          {drawnPoints.length >= 2 && (
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
          )}

          {selectedPanelIds.size > 0 && (
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
          )}

          {drawnPoints.length > 0 && (
            <div className="mt-auto mb-2 w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-bold">
              {drawnPoints.length}
            </div>
          )}
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
              projectAddress={
                project.address ||
                (project.client ? [project.client.address, project.client.city, project.client.state].filter(Boolean).join(', ') : '')
              }
              placementMode={placementMode3D}
              onPlacementModeChange={setPlacementMode3D}
              showShade={showShade3D}
              fireSetbacks={fireSetbacks}
              onTwinLoaded={(twin) => {
                if (twin.solarData) setSolarApiData(twin.solarData);
                if (twin.roofSegments) setRoofSegments(twin.roofSegments);
              }}
              onError={(error) => {
                console.error('3D engine error:', error);
                setShow3D(false);
              }}
              onLocationPick={handleLocationPick}
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

              {!mapLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
                  <div className="text-center">
                    <div className="spinner w-8 h-8 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">Loading satellite imagery...</p>
                  </div>
                </div>
              )}

              {/* Location finding overlay */}
              {(locationStatus === 'locating' || searchLoading) && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 pointer-events-none">
                  <div className="glass rounded-2xl px-6 py-4 text-center">
                    <div className="spinner w-8 h-8 mx-auto mb-3" />
                    <p className="text-white font-semibold text-sm">Finding address...</p>
                    <p className="text-slate-400 text-xs mt-1">{addressSearch}</p>
                  </div>
                </div>
              )}

              {/* Location found toast */}
              {locationStatus === 'found' && !searchLoading && (
                <div className="absolute top-4 right-16 glass rounded-xl px-3 py-2 flex items-center gap-2 pointer-events-none">
                  <CheckCircle size={14} className="text-emerald-400" />
                  <span className="text-xs text-emerald-400 font-medium">Location found</span>
                </div>
              )}

              {/* Location failed toast */}
              {locationStatus === 'failed' && (
                <div className="absolute top-4 right-16 glass rounded-xl px-3 py-2 flex items-center gap-2 pointer-events-none">
                  <AlertCircle size={14} className="text-red-400" />
                  <span className="text-xs text-red-400 font-medium">Address not found — try a different search</span>
                </div>
              )}

              {/* Drawing instructions */}
              {drawingMode !== 'select' && drawingMode !== 'measure' && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 text-sm text-white pointer-events-none flex items-center gap-2">
                  <span>
                    {drawingMode === 'draw_roof' && '🏠 Click to draw roof outline'}
                    {drawingMode === 'draw_ground' && '🌱 Click to draw ground area'}
                    {drawingMode === 'draw_fence' && '🔲 Click to draw fence line'}
                  </span>
                  <span className="text-slate-400">• Double-click to finish</span>
                  {drawnPoints.length > 0 && <span className="text-amber-400 font-semibold">{drawnPoints.length} pts</span>}
                </div>
              )}
              {drawingMode === 'measure' && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 text-sm text-cyan-300 pointer-events-none">
                  📏 Click to measure distance • Double-click to clear
                  {measureDistance !== null && <span className="ml-2 font-bold">{measureDistance.toFixed(1)}m</span>}
                </div>
              )}

              {/* v30.9: Multi-row mode hint */}
              {multiRowMode && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 text-sm text-amber-300 pointer-events-none flex items-center gap-2">
                  <span>⊞ Multi-Row Tool ({multiRowCount} rows)</span>
                  <span className="text-slate-400">•</span>
                  <span>{multiRowStart ? '📍 Click end of first row' : '📍 Click start of first row'}</span>
                </div>
              )}

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
                {selectedPanelIds.size > 0 && (
                  <span className="text-xs text-amber-400 font-semibold ml-1">
                    · {selectedPanelIds.size} selected
                  </span>
                )}
                <span className="text-xs text-slate-600 ml-1">V/R/G/F/M</span>
              </div>

              {/* Zoom controls */}
              <div className="absolute bottom-10 right-4 flex flex-col gap-1">
                <button onClick={() => setZoom(z => Math.min(21, z + 1))} className="w-8 h-8 bg-slate-800 border border-slate-600 rounded-lg text-white hover:bg-slate-700 flex items-center justify-center font-bold text-lg">+</button>
                <div className="w-8 h-6 bg-slate-800/60 border border-slate-700 rounded flex items-center justify-center text-xs text-slate-400">{zoom}</div>
                <button onClick={() => setZoom(z => Math.max(14, z - 1))} className="w-8 h-8 bg-slate-800 border border-slate-600 rounded-lg text-white hover:bg-slate-700 flex items-center justify-center font-bold text-lg">−</button>
              </div>

              {/* Panel count overlay */}
              {panels.length > 0 && (
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
                    {selectedPanelIds.size > 0 && (
                      <span className="text-blue-400">{selectedPanelIds.size} selected</span>
                    )}
                  </div>
                </div>
              )}

              {/* Bill analysis recommendation banner */}
              {billAnalysis && panels.length === 0 && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-3 text-sm pointer-events-none max-w-sm text-center">
                  <div className="text-amber-400 font-semibold">Recommended System Size</div>
                  <div className="text-white text-lg font-bold">{billAnalysis.recommendedSystemKw} kW</div>
                  <div className="text-slate-400 text-xs">~{billAnalysis.recommendedPanelCount} panels • Draw your {activeZoneType === 'roof' ? 'roof' : activeZoneType === 'ground' ? 'ground area' : 'fence line'} to place panels</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right Sidebar ── */}
        <div className="w-80 bg-slate-900 border-l border-slate-700/50 flex flex-col flex-shrink-0 min-h-0">
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
            {activeTab === 'design' && (
              <>
                {/* System Configuration */}
                <Section title="Configuration" icon={<Settings size={12} />}>
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
                  </div>

                  {activeZoneType !== 'fence' && (
                    <SliderRow label="Tilt Angle" value={tilt} min={0} max={45} step={1} unit="°" onChange={setTilt} />
                  )}
                  {activeZoneType === 'fence' && (
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 text-xs text-purple-300">
                      ⚡ Vertical mount (90°) — Sol Fence bifacial optimized
                    </div>
                  )}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-slate-400">Azimuth</label>
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

                  {activeZoneType === 'roof' && (
                    <SliderRow label="Roof Setback" value={setback} min={0.3} max={2.0} step={0.1} unit="m" onChange={v => { clearGridCache(); setSetback(v); }} />
                  )}
                  {(activeZoneType === 'roof' || activeZoneType === 'ground') && (
                    <SliderRow label="Row Spacing" value={rowSpacing} min={0.5} max={5.0} step={0.1} unit="m" onChange={v => { clearGridCache(); setRowSpacing(v); }} />
                  )}
                  <SliderRow label="Panel Spacing" value={panelSpacing} min={0.01} max={0.1} step={0.01} unit="m" onChange={v => { clearGridCache(); setPanelSpacing(v); }} />

                  {/* v30.9: Panel Orientation Toggle */}
                  <div className="flex items-center justify-between py-1">
                    <label className="text-xs text-slate-400">Panel Orientation</label>
                    <div className="flex rounded-lg overflow-hidden border border-slate-600">
                      <button
                        onClick={() => { setOrientation('portrait'); clearGridCache(); }}
                        className={`px-2.5 py-1 text-xs font-medium transition-colors ${orientation === 'portrait' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
                      >
                        ▯ Portrait
                      </button>
                      <button
                        onClick={() => { setOrientation('landscape'); clearGridCache(); }}
                        className={`px-2.5 py-1 text-xs font-medium transition-colors ${orientation === 'landscape' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
                      >
                        ▭ Landscape
                      </button>
                    </div>
                  </div>

                  {/* v30.9: Fire Setback Controls (roof only) */}
                  {activeZoneType === 'roof' && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-red-400">🔥 Fire Setbacks</span>
                        <button
                          onClick={() => setShowSetbackZones(v => !v)}
                          className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${showSetbackZones ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
                        >
                          {showSetbackZones ? <Eye size={10} /> : <EyeOff size={10} />}
                          {showSetbackZones ? 'Zones On' : 'Zones Off'}
                        </button>
                      </div>
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
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-slate-400">Pathway (36″)</label>
                        <button
                          onClick={() => setFireSetbacks(prev => ({ ...prev, enforcePathway: !prev.enforcePathway }))}
                          className={`w-10 h-5 rounded-full transition-colors relative ${fireSetbacks.enforcePathway ? 'bg-red-500' : 'bg-slate-600'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${fireSetbacks.enforcePathway ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      {fireSetbacks.enforcePathway && (
                        <div className="text-xs text-red-400/80 bg-red-500/10 rounded-lg p-2">
                          36″ pathway enforced — panels will not be placed in pathway zone
                        </div>
                      )}
                    </div>
                  )}

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
                    {multiRowMode && (
                      <div className="mt-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg p-2">
                        {multiRowStart ? '📍 Click end of first row to generate all rows' : '📍 Click start of first row on the map'}
                      </div>
                    )}
                  </div>

                  {activeZoneType === 'ground' && (
                    <>
                      <SliderRow label="Mount Height" value={groundHeight} min={0.3} max={2.0} step={0.1} unit="m" onChange={setGroundHeight} />
                      <SliderRow label="Panels Per Row" value={panelsPerRow} min={2} max={30} step={1} unit="" onChange={setPanelsPerRow} />
                    </>
                  )}

                  {activeZoneType === 'fence' && (
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
                      {bifacialOptimized && (
                        <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg p-2">
                          +20% bifacial gain applied for E-W facing panels
                        </div>
                      )}
                    </>
                  )}
                </Section>

                {/* 3D Auto-Place Panels */}
                {show3D && (
                  <Section title="3D Panel Placement" icon={<Layers size={12} />} defaultOpen={true}>
                    <div className="space-y-2">
                      <div className="text-xs text-slate-400 leading-relaxed">
                        Use the toolbar in the 3D view to place panels. Click <strong className="text-amber-400">✨ Auto</strong> to automatically fill all roof segments with optimal panel placement.
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        {[
                          { mode: 'select' as PlacementMode, icon: '↖', label: 'Select', desc: 'Select / pan' },
                          { mode: 'roof' as PlacementMode, icon: '🏠', label: 'Place Roof', desc: 'Click to place panel' },
                          { mode: 'ground' as PlacementMode, icon: '🌍', label: 'Place Ground', desc: 'Click to place panel' },
                          { mode: 'auto_roof' as PlacementMode, icon: '✨', label: 'Auto Fill', desc: 'Fill all roofs' },
                        ].map(({ mode, icon, label, desc }) => (
                          <button
                            key={mode}
                            onClick={() => setPlacementMode3D(mode)}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left transition-all ${
                              placementMode3D === mode
                                ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                                : 'border-slate-700 text-slate-400 hover:text-slate-300 hover:border-slate-600'
                            }`}
                          >
                            <span>{icon}</span>
                            <div>
                              <div className="font-medium">{label}</div>
                              <div className="text-slate-500 text-xs">{desc}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                      {roofSegments.length > 0 && (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-xs text-emerald-300">
                          <div className="font-semibold mb-0.5">✅ Solar API Ready</div>
                          <div>{roofSegments.length} roof segments detected</div>
                          <div>Max capacity: {((solarApiData?.solarPotential?.maxArrayPanelsCount ?? 0) * 400 / 1000).toFixed(1)} kW</div>
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {/* Roof Analysis - Google Solar API */}
                {roofSegments.length > 0 && (
                  <Section title="Roof Analysis" icon={<Sun size={12} />} badge={`${roofSegments.length} segments`}>
                    <div className="space-y-1.5">
                      {roofSegments.map((segment, idx) => {
                        const area = segment.areaM2 ?? segment.stats?.areaMeters2 ?? 0;
                        const pitch = segment.pitchDegrees ?? 0;
                        const az = segment.azimuthDegrees ?? 180;
                        const sunshine = segment.sunshineHours ?? segment.stats?.sunshineQuantiles?.[5] ?? 0;
                        const maxSunshine = Math.max(...roofSegments.map((s: any) => s.sunshineHours ?? s.stats?.sunshineQuantiles?.[5] ?? 0));
                        const sunPct = maxSunshine > 0 ? (sunshine / maxSunshine) * 100 : 0;
                        const azLabel = ['N','NE','E','SE','S','SW','W','NW','N'][Math.round(az / 45) % 8];
                        return (
                          <div key={idx} className="bg-slate-800/60 rounded-lg p-2.5 border border-slate-700/40 hover:border-amber-500/30 transition-colors">
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-xs font-bold text-white">Segment {idx + 1}</span>
                              <span className="text-xs text-slate-400 font-mono">{(area * 10.7639).toFixed(0)} ft²</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1 text-xs mb-1.5">
                              <div className="text-center bg-slate-900/60 rounded p-1">
                                <div className="text-slate-500 text-[10px]">Pitch</div>
                                <div className="text-amber-400 font-bold">{pitch.toFixed(0)}°</div>
                              </div>
                              <div className="text-center bg-slate-900/60 rounded p-1">
                                <div className="text-slate-500 text-[10px]">Azimuth</div>
                                <div className="text-blue-400 font-bold">{azLabel}</div>
                              </div>
                              <div className="text-center bg-slate-900/60 rounded p-1">
                                <div className="text-slate-500 text-[10px]">Sun hrs</div>
                                <div className="text-yellow-400 font-bold">{sunshine > 0 ? sunshine.toFixed(0) : '—'}</div>
                              </div>
                            </div>
                            {sunshine > 0 && (
                              <div className="mt-1">
                                <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                      width: `${sunPct}%`,
                                      background: `linear-gradient(90deg, #f59e0b, #fbbf24)`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {solarApiData?.solarPotential && (
                      <div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 text-xs">
                        <div className="text-amber-400 font-semibold mb-1">☀️ Solar Potential</div>
                        <div className="grid grid-cols-2 gap-1 text-slate-300">
                          <div>Max panels: <span className="text-white font-bold">{solarApiData.solarPotential.maxArrayPanelsCount}</span></div>
                          <div>Max kW: <span className="text-white font-bold">{((solarApiData.solarPotential.maxArrayPanelsCount * 400) / 1000).toFixed(1)}</span></div>
                          <div>Sunshine: <span className="text-white font-bold">{solarApiData.solarPotential.maxSunshineHoursPerYear?.toFixed(0)} hrs/yr</span></div>
                          <div>Roof area: <span className="text-white font-bold">{((solarApiData.solarPotential.wholeRoofStats?.areaMeters2 ?? 0) * 10.7639).toFixed(0)} ft²</span></div>
                        </div>
                      </div>
                    )}
                  </Section>
                )}

                {/* System Summary */}
                {panels.length > 0 && (
                  <Section title="System Summary" icon={<Zap size={12} />}>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { label: 'Panels', value: panels.length.toString(), color: 'text-white' },
                        { label: 'System Size', value: `${systemSizeKw.toFixed(2)} kW`, color: 'text-amber-400' },
                        { label: 'Panel Wattage', value: `${selectedPanel.wattage}W`, color: 'text-white' },
                        { label: 'Array Area', value: `${(panels.length * selectedPanel.width * selectedPanel.height).toFixed(0)} m²`, color: 'text-white' },
                      ].map(item => (
                        <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                          <div className="text-slate-400">{item.label}</div>
                          <div className={`font-semibold ${item.color}`}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Quick production estimate preview */}
                    {quickEstimate && !production && (
                      <div className="bg-slate-800/60 rounded-lg p-2.5 border border-slate-700/50">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Sun size={11} className="text-amber-400" />
                          <span className="text-xs text-slate-400 font-medium">Quick Estimate</span>
                          <span className="text-xs text-slate-600 ml-auto">(pre-calculation)</span>
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
                        <div className="text-xs text-slate-600 mt-1.5 text-center">Run PVWatts for precise results</div>
                      </div>
                    )}
                    <button
                      onClick={calculateProduction}
                      disabled={calculating}
                      className="btn-primary w-full mt-1"
                    >
                      {calculating ? <><Loader size={14} className="animate-spin" /> Calculating...</> : <><Play size={14} /> Calculate Production</>}
                    </button>
                    {calcMessage && (
                      <div className={`text-xs mt-1 px-2 py-1.5 rounded-lg ${
                        calcMessage.startsWith('✅')
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {calcMessage}
                      </div>
                    )}
                  </Section>
                )}

                {/* Production Results */}
                {production && (
                  <Section title="Production Results" icon={<BarChart2 size={12} />}>
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
                )}

                {/* Cost Estimate */}
                {costEstimate && (
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
                )}
              </>
            )}

            {/* ── BILL ANALYSIS TAB ── */}
            {activeTab === 'bill' && (
              <>
                <Section title="Bill Analysis" icon={<Calculator size={12} />} defaultOpen={true}>
                  <BillCalculator onAnalysis={setBillAnalysis} project={project} />
                </Section>

                {billAnalysis && (
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

                    {billAnalysis.batteryRecommendation && (
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
                    )}
                  </Section>
                )}
              </>
            )}

            {/* ── EQUIPMENT TAB ── */}
            {activeTab === 'equipment' && (
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
                          <span className="text-xs text-slate-500">{p.width}×{p.height}m</span>
                          {p.bifacial && <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">Bifacial</span>}
                          {p.cellType && <span className="text-xs text-slate-600">{p.cellType}</span>}
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedPanel && (
                    <div className="bg-slate-800/60 rounded-lg p-3 text-xs space-y-1.5">
                      <div className="text-slate-300 font-semibold">Selected: {selectedPanel.manufacturer} {selectedPanel.model}</div>
                      <div className="grid grid-cols-2 gap-1">
                        <div><span className="text-slate-500">Wattage:</span> <span className="text-amber-400 font-semibold">{selectedPanel.wattage}W</span></div>
                        <div><span className="text-slate-500">Efficiency:</span> <span className="text-white">{selectedPanel.efficiency}%</span></div>
                        <div><span className="text-slate-500">Size:</span> <span className="text-white">{selectedPanel.width}×{selectedPanel.height}m</span></div>
                        <div><span className="text-slate-500">Temp Coeff:</span> <span className="text-white">{selectedPanel.temperatureCoeff}%/°C</span></div>
                        <div><span className="text-slate-500">Bifacial:</span> <span className={selectedPanel.bifacial ? 'text-emerald-400' : 'text-slate-400'}>{selectedPanel.bifacial ? `Yes (×${selectedPanel.bifacialFactor})` : 'No'}</span></div>
                        <div><span className="text-slate-500">Warranty:</span> <span className="text-white">{selectedPanel.warranty || 25}yr</span></div>
                      </div>
                    </div>
                  )}
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
                          {inv.batteryCompatible && <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">Battery Ready</span>}
                          <span className="text-xs text-slate-600">${inv.pricePerUnit.toLocaleString()}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {/* ── BATTERY TAB ── */}
            {activeTab === 'battery' && (
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
                          {bat.cycles && <span className="text-xs text-slate-600">{bat.cycles.toLocaleString()} cycles</span>}
                          <span className="text-xs text-slate-500">${bat.pricePerUnit.toLocaleString()}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>

                {selectedBattery && (
                  <Section title="Battery Configuration" icon={<Settings size={12} />}>
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 text-xs">
                      <div className="font-semibold text-purple-300 mb-2">{selectedBattery.manufacturer} {selectedBattery.model}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div><span className="text-slate-500">Capacity:</span> <span className="text-purple-400 font-semibold">{selectedBattery.capacityKwh} kWh</span></div>
                        <div><span className="text-slate-500">Power:</span> <span className="text-white">{selectedBattery.powerKw} kW</span></div>
                        <div><span className="text-slate-500">Chemistry:</span> <span className="text-white">{selectedBattery.chemistry}</span></div>
                        <div><span className="text-slate-500">Warranty:</span> <span className="text-white">{selectedBattery.warranty}yr</span></div>
                        {selectedBattery.dimensions && <div className="col-span-2"><span className="text-slate-500">Dimensions:</span> <span className="text-white">{selectedBattery.dimensions}</span></div>}
                        {selectedBattery.weight && <div><span className="text-slate-500">Weight:</span> <span className="text-white">{selectedBattery.weight}kg</span></div>}
                      </div>
                    </div>

                    {selectedBattery.stackable && (
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
                    )}

                    {/* Backup estimate */}
                    {billAnalysis && (
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
                    )}
                  </Section>
                )}

                {!selectedBattery && (
                  <div className="p-4 text-center text-slate-500 text-xs">
                    Select a battery above to configure storage
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}