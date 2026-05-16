// ============================================================
// CORE TYPE DEFINITIONS - Solar Design Platform
// ============================================================

export type SystemType = 'roof' | 'ground' | 'fence';
export type UserRole = 'admin' | 'designer' | 'sales';
export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'accepted' | 'rejected' | 'archived';
export type ProjectStatus = 'lead' | 'design' | 'proposal' | 'approved' | 'installed';
// ─── v61: Control Modes + Field Locking ──────────────────────────────────────
/**
 * ControlMode governs how much autonomy the auto-config engine has.
 *  auto    → engine has full control, overrides user selections silently
 *  guided  → engine suggests changes; user must approve overrides (DEFAULT)
 *  manual  → user selections are locked; engine can only warn, never override
 */
export type ControlMode = 'auto' | 'guided' | 'manual';

/**
 * Per-field lock map.  true = user has locked this field; auto-config must not override.
 * All fields default to false (unlocked).
 */
export interface SystemConfigLocks {
  panel:    boolean;
  inverter: boolean;
  battery:  boolean;
  strings:  boolean;
  wiring:   boolean;
}

/** Default locks — all fields unlocked */
export const DEFAULT_LOCKS: SystemConfigLocks = {
  panel:    false,
  inverter: false,
  battery:  false,
  strings:  false,
  wiring:   false,
};


// ─── Multi-Array Architecture ─────────────────────────────────────────────────
// A SolarArray represents one discrete mounting zone (roof face, ground field,
// fence run, carport canopy, etc.) within a system.
// Multiple SolarArrays compose a full system (hybrid or single-type).

export type ArrayMountType = 'roof' | 'ground' | 'fence' | 'carport';

export interface SolarArray {
  /** Unique identifier for this array within the system */
  id: string;
  /** Mount type determines production model and racking */
  type: ArrayMountType;
  /** Human-readable label, e.g. "South Roof", "Backyard Ground Mount" */
  label?: string;
  /** Number of panels in this array */
  panelCount: number;
  /** Panel wattage (Wp) -- may differ per array (e.g. roof 400W, fence 430W) */
  panelWattage: number;
  /** Tilt in degrees (0=flat, 90=vertical). Fence arrays always 90. */
  tilt: number;
  /** Azimuth in degrees (180=south). Fence may be 90 or 270 (E/W). */
  azimuth: number;
  /**
   * Production factor relative to optimal tilt roof mount (1.0 = optimal).
   * Fence arrays use 0.70-0.85 before bifacial gain.
   * Ground arrays may exceed 1.0 due to optimal tilt.
   */
  productionFactor: number;
  /**
   * Bifacial gain multiplier (1.0 = monofacial, 1.10-1.25 = bifacial).
   * Only meaningful for fence and some ground arrays.
   */
  bifacialGain: number;
  /** Calculated annual production in kWh for this array */
  annualKwh: number;
  /** System size for this array in kW = panelCount * panelWattage / 1000 */
  arraySizeKw: number;
}

/**
 * SystemConfig aggregates all arrays into a complete system.
 * This is the multi-array replacement for single {size_kw, annual_kwh}.
 */
export interface SystemConfig {
  arrays: SolarArray[];
  /** Sum of all array panel counts */
  totalPanels: number;
  /** Sum of all array sizes in kW */
  totalKw: number;
  /** Sum of all array annual kWh */
  totalAnnualKwh: number;
  /** True when more than one array type is present */
  isHybrid: boolean;
  /** Array types present, e.g. ['roof', 'fence'] */
  arrayTypes: ArrayMountType[];
}

// ─── User & Auth ─────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyName?: string;
  companyLogo?: string;
  createdAt: string;
}

// ─── Client ──────────────────────────────────────────────────
export interface Client {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
  utilityProvider?: string;
  monthlyKwh: number[];        // 12 months
  annualKwh: number;
  averageMonthlyKwh: number;
  averageMonthlyBill: number;
  annualBill: number;
  utilityRate: number;         // $/kWh
  createdAt: string;
  updatedAt: string;
}

// ─── Hardware ────────────────────────────────────────────────
export interface SolarPanel {
  id: string;
  manufacturer: string;
  model: string;
  wattage: number;             // Wp
  width: number;               // meters
  height: number;              // meters
  efficiency: number;          // %
  bifacial: boolean;
  bifacialFactor: number;      // 1.0–1.3
  temperatureCoeff: number;    // %/°C
  pricePerWatt: number;
  warranty?: number;           // years
  cellType?: string;           // Mono PERC, TOPCon, HJT, etc.
  datasheet?: string;
  datasheetUrl?: string;       // URL to manufacturer datasheet
  weight?: number;             // kg
  isActive?: boolean;          // for user equipment library
  isCustom?: boolean;          // true if user-created
}

export interface Inverter {
  id: string;
  manufacturer: string;
  model: string;
  capacity: number;            // kW
  efficiency: number;          // %
  type: 'string' | 'micro' | 'optimizer' | 'hybrid';
  pricePerUnit: number;
  warranty?: number;
  mpptChannels?: number;
  batteryCompatible?: boolean;
  datasheetUrl?: string;       // URL to manufacturer datasheet
  isActive?: boolean;          // for user equipment library
  isCustom?: boolean;          // true if user-created
}

export interface Battery {
  id: string;
  manufacturer: string;
  model: string;
  capacityKwh: number;         // usable kWh
  powerKw: number;             // continuous power kW
  peakPowerKw?: number;        // peak power kW
  roundTripEfficiency: number; // %
  chemistry: 'LFP' | 'NMC' | 'Lead-Acid';
  voltage?: number;
  cycles?: number;             // rated cycles
  warranty?: number;           // years
  pricePerUnit: number;
  stackable?: boolean;         // can add multiple units
  maxUnits?: number;
  dimensions?: string;
  weight?: number;             // lbs
  datasheetUrl?: string;       // URL to manufacturer datasheet
  isActive?: boolean;          // for user equipment library
  isCustom?: boolean;          // true if user-created
}

export interface MountingSystem {
  id: string;
  name: string;
  type: SystemType;
  pricePerWatt: number;
  description: string;
  manufacturer?: string;
}

// ─── Fence Racking ────────────────────────────────────────────────────────
// Represents a fence racking system (e.g. SOL Fence Nexus).
// Each "section" spans sectionWidthM and holds panelsPerSection panels.
// Posts are placed at section boundaries (every sectionWidthM along the fence).
export interface FenceRacking {
  id: string;
  manufacturer: string;
  model: string;
  description: string;
  // Section geometry
  sectionWidthM: number;           // e.g. 2.413m (7'11") per section
  fenceHeightM: number;            // metal-to-metal height, e.g. 1.778m (5'10")
  totalHeightMaxM: number;         // max total height including post cap, e.g. 1.829m (6')
  groundClearanceM: number;        // bottom of panel above grade, e.g. 0.051m (2")
  panelsPerSection: number;        // always 2 for SOL Fence Nexus
  wattagePerSection: number;       // e.g. 860W (2 x 430W)
  // Compatible panel
  panelId: string;                 // links to panels.json item id
  panelModel: string;
  // Post specs
  postMaterial: string;            // e.g. "Hot-dip galvanized steel"
  postThicknessM: number;          // e.g. 0.060m (2-3/8")
  postBurialDepthMinM: number;     // e.g. 0.914m (3') for concrete footing
  // Frame specs
  frameMaterial: string;           // e.g. "6061-T6 Aluminum"
  frameFinish: string;             // e.g. "Powder-coated"
  tiltDeg: number;                 // always 90 for vertical fence
  bifacial: boolean;               // always true for SOL Fence
  // Pricing
  pricePerSection?: number;
  pricePerWatt?: number;
  // Meta
  warranty?: string;
  datasheetUrl?: string;
  isActive?: boolean;
  isCustom?: boolean;
}

// ─── SOL Fence Section ──────────────────────────────────────────────────────────────
// Computed representation of one installed SOL Fence section.
// A section = 1 racking section (sectionWidthM wide) + 2 bifacial panels.
// Used for BOM generation, proposal output, and engineering docs.
export interface SolFenceSection {
  sectionIndex: number;            // 0-based index along the fence run
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  centerLat: number;
  centerLng: number;
  heightM: number;                 // fence height at this section
  wattage: number;                 // total section wattage (both panels)
  panelIds: string[];              // IDs of the 2 PlacedPanels in this section
  postPositions: { lat: number; lng: number }[];  // post lat/lng positions (left + right)
}


// ─── Bill Analysis ───────────────────────────────────────────
export interface BillAnalysis {
  monthlyKwh: number[];        // 12 months (or estimated from avg)
  annualKwh: number;
  averageMonthlyKwh: number;
  averageMonthlyBill: number;
  annualBill: number;
  utilityRate: number;         // $/kWh
  peakMonthKwh: number;
  peakMonth: number;           // 0-11
  recommendedSystemKw: number;
  recommendedPanelCount: number;
  offsetTarget: number;        // % (default 100)
  batteryRecommendation?: BatteryRecommendation;
}

export interface BatteryRecommendation {
  recommended: boolean;
  reason: string;
  dailyUsageKwh: number;
  nighttimeUsageKwh: number;
  recommendedCapacityKwh: number;
  recommendedUnits: number;
  suggestedBatteries: Battery[];
  backupHours: number;
  selfConsumptionRate: number; // %
}

// ─── Panel Placement ─────────────────────────────────────────
export interface PlacedPanel {
  id: string;
  layoutId: string;
  lat: number;
  lng: number;
  x: number;                   // pixel/canvas x (legacy)
  y: number;                   // pixel/canvas y (legacy)
  // v47.93: CAD metric coords -- offset from plane centroid in meters
  xMeters?: number;            // east offset from roof plane centroid (meters)
  yMeters?: number;            // north offset from roof plane centroid (meters)
  // v47.99: LECS -- Local Engineering Coordinate System (feet)
  // Authoritative CAD coordinates for all layout calculations.
  xFeet?: number;              // east offset from roof plane centroid (feet)
  yFeet?: number;              // north offset from roof plane centroid (feet)
  widthFeet?: number;          // CAD X dimension (along ridge) in feet
  heightFeet?: number;         // CAD Y dimension (up slope) in feet
  tilt: number;                // degrees (0=flat, 90=vertical)
  azimuth: number;             // degrees (180=south)
  wattage: number;
  bifacialGain: number;
  row: number;
  col: number;
  // 3D placement fields
  height?: number;             // meters above ellipsoid
  heading?: number;            // degrees (0=north)
  pitch?: number;              // degrees tilt from horizontal
  roll?: number;               // degrees roll
  systemType?: 'roof' | 'ground' | 'fence';
  arrayId?: string;
  // v30.9: Panel orientation (portrait = tall, landscape = wide)
  orientation?: 'portrait' | 'landscape' | 'hybrid';
  // v47.93: Architecture stabilization -- dual placement system
  layoutSource?: 'AUTO' | 'MANUAL';
  placementType?: 'ROOF' | 'GROUND' | 'FENCE';
  // v47.100: Portrait-first solver -- which strategy was selected
  layoutStrategy?: 'PORTRAIT' | 'MIXED' | 'LANDSCAPE';

  // v47.119 -- 3D surface grid indices
  // Used by surface-based placement engine. planeId links panel to its RoofPlane.
  // gridRow/gridCol are the panel's position in the 3D grid (0-indexed from anchor).
  planeId?: string;     // ID of the RoofPlane this panel belongs to
  gridRow?: number;     // row index from anchor panel (0 = eave row)
  gridCol?: number;     // col index from anchor panel (0 = first column)

  // v47.143: ECEF frame vectors stored per panel for exact orientation in addPanelEntity.
  // Orientation is built from rotation matrix [u, cross(n,u), n] in ECEF space,
  // bypassing HeadingPitchRoll approximation for tilted roof planes.
  ecefNx?: number; ecefNy?: number; ecefNz?: number;  // plane normal (ECEF unit vector)
  ecefUx?: number; ecefUy?: number; ecefUz?: number;  // plane u-axis (ECEF unit vector)

  // v1.shade: Per-panel shade analysis results
  // annualShadeFactor: 0 (fully shaded) .. 1 (full sun, no shade)
  // Set by computeShadeAnalysis() in lib/shadeAnalysis.ts
  annualShadeFactor?: number;
}

// ─── Roof Plane ───────────────────────────────────────────────
// ─── Roof Plane Edge Type ───────────────────────────────────────────────────────────────────
// Parallel to vertices[]: edge[i] goes from vertices[i] to vertices[(i+1) % n]
export type RoofEdgeType = 'ridge' | 'eave' | 'hip' | 'valley' | 'rake' | 'wall' | 'unknown';

// ─── Solar API Raw Segment ────────────────────────────────────────────────────────
// Shape returned by Google Solar API buildingInsights endpoint
export interface SolarApiSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  center: { latitude: number; longitude: number };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  planeHeightAtCenterMeters: number;
  stats: {
    areaMeters2: number;
    groundAreaMeters2: number;
    sunshineQuantiles?: number[];
  };
  segmentIndex?: number;
}

// ─── Roof Plane ─────────────────────────────────────────────────────────────
export interface RoofPlane {
  id: string;
  vertices: { lat: number; lng: number }[];
  pitch: number;               // degrees
  azimuth: number;
  area: number;                // m²
  usableArea: number;          // m² after setbacks

  // v47.94 -- Persistent centroid: computed ONCE when plane is created.
  centroidLat?: number;
  centroidLng?: number;

  // v47.99 -- LECS: local engineering coordinates in feet (centroid = origin)
  // verticesLocal: polygon vertices in feet, relative to centroid (xFeet east, yFeet north)
  // centroidLocal: always {0,0} when origin is centroid -- stored for explicitness
  verticesLocal?: { xFeet: number; yFeet: number }[];
  centroidLocal?: { xFeet: number; yFeet: number };

  // v47.96 -- Per-plane panel orientation (portrait = tall, landscape = wide, hybrid = auto-optimised mix)
  orientation?: 'portrait' | 'landscape' | 'hybrid';

  // v47.118 -- Primary axis detection: bearing of longest polygon edge [0,180)
  // Computed once at plane creation via longestEdgeBearing(vertices).
  // Used by generatePanelGridCAD when alignToEdge=true to snap grid to actual roof edge.
  roofEdgeAngleDeg?: number;

  // v47.81 -- architectural geometry metadata
  edgeTypes?: RoofEdgeType[];
  adjacentPlaneIds?: string[];

  // v47.81 -- Solar API provenance
  source?: 'solar_api' | 'manual' | 'imported';
  solarSegmentIndex?: number;
  planeHeightAtCenterMeters?: number;
  confirmed?: boolean;
  sunshineHoursPerYear?: number;

  // v47.119 -- 3D Surface Frame (computed from azimuth + tilt)
  // Stored once at plane creation. Used by surface-based panel placement.
  //   n = surface normal (outward from roof)
  //   u = along ridge / gutter direction (horizontal, east for south-facing)
  //   v = up-slope direction (perpendicular to ridge, toward peak)
  // All vectors are unit vectors in ENU (east/north/up) tangent space.
  localFrame3D?: {
    u: { x: number; y: number; z: number };  // along ridge
    v: { x: number; y: number; z: number };  // up slope
    n: { x: number; y: number; z: number };  // surface normal
  };

  // v47.121 -- 3D Roof Plane Creation Tool
  // When a plane is created by clicking points directly on 3D tiles (not drawn in 2D),
  // these fields store the exact 3D geometry captured from scene.pickPosition.
  //
  // origin3D: first clicked point in ECEF Cartesian (Cesium Cartesian3 components)
  // polygon3D: all clicked points in ECEF Cartesian -- the actual 3D roof boundary
  // normal3D:  outward surface normal in ECEF space (unit vector)
  //
  // These replace azimuth/pitch-based frame computation with exact geometry
  // derived directly from the photorealistic 3D tile surface.
  origin3D?: { x: number; y: number; z: number };     // ECEF Cartesian3 of first point
  normal3D?: { x: number; y: number; z: number };     // ECEF unit normal (outward)
  polygon3D?: Array<{ x: number; y: number; z: number }>; // ECEF corners in order
  createdFrom3D?: boolean;   // true when plane was created by 3D point picking (not 2D draw)

  // v47.128 -- ECEF frame axes (unit vectors in ECEF space, not ENU tangent space)
  // Stored alongside localFrame3D so buildSurfaceGrid can use pure ECEF arithmetic.
  // origin3D + ecefFrame3D enables: worldPos = origin + u*du + v*dv + normal*offset
  // without any metersPerDeg approximation. Only used when createdFrom3D=true.
  ecefFrame3D?: {
    u: { x: number; y: number; z: number };  // longest-edge axis (ECEF unit vector)
    v: { x: number; y: number; z: number };  // cross-slope axis (ECEF unit vector)
    n: { x: number; y: number; z: number };  // outward normal  (ECEF unit vector)
  };
}

// -- Obstruction --
// A roof obstruction (vent, skylight, chimney, etc.).
// Placed by clicking in 3D mode. Panels within radiusM are removed.
export interface PlacedObstruction {
  id: string;
  lat: number;
  lng: number;
  height: number;         // meters above ellipsoid (at obstruction base)
  radiusM: number;        // exclusion radius in meters
  type: 'vent' | 'skylight' | 'chimney' | 'hvac' | 'other';
  label?: string;
}

// ─── Layout ───────────────────────────────────────────────────
export interface Layout {
  id: string;
  projectId: string;
  systemType: SystemType;
  panels: PlacedPanel[];
  roofPlanes?: RoofPlane[];
  
  // Ground mount config
  groundTilt?: number;
  groundAzimuth?: number;
  rowSpacing?: number;
  groundHeight?: number;
  
  // Fence config
  fenceAzimuth?: number;
  fenceHeight?: number;
  fenceLength?: number;
  fenceLine?: { lat: number; lng: number }[];
  bifacialOptimized?: boolean;
  // v47.158: SOL Fence Nexus geometry
  fencePostHeightM?: number;        // height of post above grade (e.g. 1.829m = 6ft)
  fenceGroundClearanceM?: number;   // bottom of panel above grade (e.g. 0.051m = 2in)
  fenceSectionWidthM?: number;      // width of one section (e.g. 2.413m = 7ft11in)
  fenceRackingId?: string;          // links to racking.json item id
  fencePanelId?: string;            // links to panels.json item id
  
  // Calculated
  totalPanels: number;
  systemSizeKw: number;
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
  createdAt: string;
  updatedAt: string;

  // v47.182: Multi-array breakdown (optional — only present for hybrid/multi-array layouts)
  // When present, each entry describes one discrete mounting zone.
  // totalPanels and systemSizeKw are still the single-system totals for backward compat.
  arrays?: SolarArray[];
}

// ─── Production ───────────────────────────────────────────────
export interface ProductionResult {
  id: string;
  projectId: string;
  layoutId: string;
  annualProductionKwh: number;
  monthlyProductionKwh: number[];
  offsetPercentage: number;
  specificYield: number;       // kWh/kWp
  performanceRatio: number;
  capacityFactor: number;
  co2OffsetTons: number;
  treesEquivalent: number;
  pvWattsData?: PVWattsResponse;
  calculatedAt: string;
}

export interface PVWattsResponse {
  ac_annual: number;
  ac_monthly: number[];
  solrad_annual: number;
  solrad_monthly: number[];
  capacity_factor: number;
}

// ─── Pricing ──────────────────────────────────────────────────
export interface PricingConfig {
  pricePerWatt: number;
  laborCostPerWatt: number;
  equipmentCostPerWatt: number;
  fixedCosts: number;
  profitMargin: number;        // %
  taxCreditRate: number;       // % (default 30%)
  utilityEscalationRate: number; // % per year
  systemLifeYears: number;
}

export interface CostEstimateLineItem {
  type: 'roof' | 'ground' | 'fence' | 'carport';
  label: string;
  panelCount: number;
  pricePerPanel: number;
  subtotal: number;
}

export interface CostEstimate {
  systemSizeKw: number;
  grossCost: number;
  laborCost?: number;
  equipmentCost?: number;
  fixedCosts: number;
  totalBeforeCredit: number;
  taxCredit: number;
  netCost: number;
  annualSavings: number;
  monthlyPayment?: number;
  paybackYears: number;
  lifetimeSavings: number;
  roi: number;                 // %
  batteryCost?: number;
  batteryTaxCredit?: number;
  // Itemized breakdown by installation type (new)
  lineItems?: CostEstimateLineItem[];
  subtotalBeforeFixed?: number;
  // v47.182: Per-array production breakdown (only present for multi-array systems)
  arrayBreakdown?: Array<{
    id: string;
    type: ArrayMountType;
    label: string;
    panelCount: number;
    arraySizeKw: number;
    annualKwh: number;
    bifacialGain: number;
  }>;
  // Extended pricing fields
  pricePerWatt?: number;
  cashPrice?: number;
  costAfterIncentives?: number;
  internalRevenue?: number;
  internalCost?: number;
  internalProfit?: number;
  internalMargin?: number;
}

// ─── Engineering Seed ──────────────────────────────────────────────────────────
// Structured object saved to projects.engineering_seed (JSONB).
// Generated by /api/engineering/preliminary when a bill is uploaded.
// Consumed by the engineering page to hydrate the full engine state.
export interface EngineeringSeed {
  // Bill-derived usage data
  annual_kwh: number;
  monthly_kwh: number;
  electricity_rate: number | null;
  utility: string;
  // System sizing
  system_kw: number;
  panel_watt: number;
  panel_count: number;
  // Equipment defaults
  inverter_type: 'micro' | 'string' | 'optimizer';
  inverter_model: string;
  system_type: 'roof' | 'ground' | 'fence';
  // Layout defaults
  tilt: number;
  azimuth: number;
  // Production estimate
  production_factor: number;
  annual_production_kwh: number;
  // Pricing estimate
  cost_low: number;
  cost_high: number;
  // Location context
  state_code: string | null;
  // Client / project context
  client_name?: string;
  service_address?: string;
  // Synthetic eng config — exact inverter/panel/electrical specs
  synthetic_eng_config?: {
    inverterType: 'micro' | 'string' | 'optimizer';
    inverterId: string;
    panelId: string;
    panelCount: number;
    panelWatts: number;
    panelVoc: number;
    panelVmp: number;
    panelIsc: number;
    panelImp: number;
    panelTempCoeffVoc: number;
    panelTempCoeffIsc: number;
    panelMaxSeriesFuse: number;
    microAcOutputW?: number;
    microAcOutputCurrentMax?: number;
    microMaxDcVoltage?: number;
    microMpptVoltageMin?: number;
    microMpptVoltageMax?: number;
    stateCode: string | null;
    systemType: string;
    mainPanelAmps: number;
    wireGauge: string;
    wireLength: number;
    conduitType: string;
    rapidShutdown: boolean;
    acDisconnect: boolean;
    dcDisconnect: boolean;
    interconnectionMethod: string;
    panelBusRating: number;
  };
  // Metadata
  generated_at: string;
}

// ─── Project ──────────────────────────────────────────────────
export interface Project {
  id: string;
  userId: string;
  clientId?: string;           // optional — project can exist without a client
  client?: Client;
  name: string;
  status: ProjectStatus;
  systemType: SystemType;
  address?: string;            // project site address
  lat?: number;                // geocoded latitude
  lng?: number;                // geocoded longitude
  stateCode?: string;          // 2-letter state code (e.g. 'CA', 'TX')
  city?: string;               // city name
  county?: string;             // county name
  zip?: string;                // ZIP code
  utilityName?: string;        // detected utility provider name
  utilityRatePerKwh?: number;  // detected utility rate $/kWh
  systemSizeKw?: number;       // calculated system size
  layout?: Layout;
  production?: ProductionResult;
  costEstimate?: CostEstimate;
  selectedPanel?: SolarPanel;
  selectedInverter?: Inverter;
  selectedMounting?: MountingSystem;
  selectedBatteries?: Battery[];
  batteryCount?: number;
  billAnalysis?: BillAnalysis;
  billData?: Record<string, unknown>;  // raw extracted bill data from BillUploadFlow
  engineeringSeed?: EngineeringSeed;  // structured seed from bill upload — drives engineering engine hydration
  engineeringConfig?: Record<string, unknown>;  // persisted engineering workspace config (auto-saved)
  engineeringUpdatedAt?: string;                // ISO timestamp of last engineering config save
  notes?: string;
  noItc?: boolean;             // v47.243: suppress ITC for clients who don't qualify (no tax liability)
  /** v61: Control mode governs auto-config autonomy. Defaults to 'guided'. */
  controlMode?: ControlMode;
  /** v61: Per-field lock map — fields locked by user cannot be overridden by auto-config. */
  systemConfigLocks?: SystemConfigLocks;
  createdAt: string;
  updatedAt: string;
}

// ─── Proposal ─────────────────────────────────────────────────
export interface Proposal {
  id: string;
  projectId: string;
  project?: Project;
  status: ProposalStatus;
  title: string;
  preparedBy: string;
  preparedDate: string;
  validUntil: string;
  shareToken?: string;
  pdfUrl?: string;
  emailSent?: boolean;
  emailSentAt?: string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  // v47.224: frozen snapshots — stored in data_json, extracted by rowToProposal
  pricingSnapshot?: Record<string, unknown> | null; // admin pricing config at time of generation
  snapshotAt?: string;                              // ISO timestamp when snapshot was taken
  // v48.3: DB-fetched utility rate (utility_policies lookup, server-side only)
  dbUtilityRate?: number | null;
  // v48.36: explicit state code snapshot — avoids address regex fallback failures
  stateCode?: string | null;
}

// ─── Dashboard Stats ──────────────────────────────────────────
export interface DashboardStats {
  totalProjects: number;
  totalClients: number;
  totalProposals: number;
  totalSystemSizeKw: number;
  totalAnnualProductionKwh: number;
  totalRevenue: number;
  projectsByStatus: Record<ProjectStatus, number>;
  projectsByType: Record<SystemType, number>;
  recentProjects: Project[];
  monthlyRevenue: { month: string; revenue: number }[];
}

// ─── Map State ────────────────────────────────────────────────
export interface MapState {
  center: { lat: number; lng: number };
  zoom: number;
  bearing: number;
  pitch: number;
  style: 'satellite' | 'streets' | 'hybrid';
}


// ─── Ephemeral System Definition ──────────────────────────────────────────────
// Used by the production API when no saved project exists yet.
// Carries all inputs needed for a full PVWatts calculation from in-memory UI state.
export interface SystemDefinition {
  // Panel layout (required for calculation)
  panels: PlacedPanel[];
  systemType: SystemType;

  // Orientation (derived from panels or set explicitly)
  tilt?: number;
  azimuth?: number;

  // Ground / fence specific
  groundTilt?: number;
  groundAzimuth?: number;
  fenceAzimuth?: number;
  fenceHeight?: number;
  bifacialOptimized?: boolean;

  // Computed totals
  totalPanels?: number;
  systemSizeKw?: number;

  // Roof planes (optional — used for multi-face roof layouts)
  roofPlanes?: RoofPlane[];
}

// Location input for ephemeral production calculation
export interface LocationInput {
  lat: number;
  lng: number;
  address?: string;
  // Demand context — used for offset % and savings estimate
  annualKwh?: number;    // kWh/year consumption (defaults to 12,000 if omitted)
  utilityRate?: number;  // $/kWh (defaults to 0.13 if omitted)
}

// ─── Design Tool State ────────────────────────────────────────
export type DrawingMode = 
  | 'select' 
  | 'draw_roof' 
  | 'draw_ground' 
  | 'draw_fence' 
  | 'place_panels' 
  | 'measure'
  | 'draw_ridge'    // v47.81: draw ridge/valley line between two roof planes
  | 'edit_edges';   // v47.81: click edges of a roof plane to tag edge types

// ─── Fire Setback Config ──────────────────────────────────────────────────────
export interface FireSetbackConfig {
  /** Side (rake/gable end) setback in meters (default: 0.457m = 18 inches) */
  edgeSetbackM: number;
  /** Firefighter pathway width in meters (default: 0.914m = 36 inches) */
  pathwayWidthM: number;
  /** Ridge (top) setback in meters (default: 0.457m = 18 inches) */
  ridgeSetbackM: number;
  /** Eave (bottom/gutter) setback in meters (default: 0 -- no eave clearance required by IRC) */
  eaveSetbackM: number;
  /** Whether to enforce pathway requirement */
  enforcePathway: boolean;
}

export const DEFAULT_FIRE_SETBACKS: FireSetbackConfig = {
  edgeSetbackM: 0.457,   // 18" sides
  pathwayWidthM: 0.914,  // 36" pathway
  ridgeSetbackM: 0.457,  // 18" ridge
  eaveSetbackM:  0,      // 0"  eave -- panels go to gutter
  enforcePathway: true,
};

export interface DesignToolState {
  mode: DrawingMode;
  systemType: SystemType;
  selectedPanelId?: string;
  selectedPanel?: SolarPanel;
  tilt: number;
  azimuth: number;
  rowSpacing: number;
  panelSpacing: number;
  setback: number;
  bifacialGain: number;
  showShadows: boolean;
  show3D: boolean;
  // v30.9 additions
  orientation?: 'portrait' | 'landscape';
  fireSetbacks?: FireSetbackConfig;
}