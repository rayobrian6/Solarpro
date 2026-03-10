// ============================================================
// CORE TYPE DEFINITIONS - Solar Design Platform
// ============================================================

export type SystemType = 'roof' | 'ground' | 'fence';
export type UserRole = 'admin' | 'designer' | 'sales';
export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected';
export type ProjectStatus = 'lead' | 'design' | 'proposal' | 'approved' | 'installed';

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
}

export interface Inverter {
  id: string;
  manufacturer: string;
  model: string;
  capacity: number;            // kW
  efficiency: number;          // %
  type: 'string' | 'micro' | 'optimizer';
  pricePerUnit: number;
  warranty?: number;
  mpptChannels?: number;
  batteryCompatible?: boolean;
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
  weight?: number;             // kg
}

export interface MountingSystem {
  id: string;
  name: string;
  type: SystemType;
  pricePerWatt: number;
  description: string;
  manufacturer?: string;
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
  x: number;                   // pixel/canvas x
  y: number;                   // pixel/canvas y
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
}

// ─── Roof Plane ───────────────────────────────────────────────
export interface RoofPlane {
  id: string;
  vertices: { lat: number; lng: number }[];
  pitch: number;               // degrees
  azimuth: number;
  area: number;                // m²
  usableArea: number;          // m² after setbacks
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
  
  // Calculated
  totalPanels: number;
  systemSizeKw: number;
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
  createdAt: string;
  updatedAt: string;
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
  // Extended pricing fields
  pricePerWatt?: number;
  cashPrice?: number;
  costAfterIncentives?: number;
  internalRevenue?: number;
  internalCost?: number;
  internalProfit?: number;
  internalMargin?: number;
}

// ─── Project ──────────────────────────────────────────────────
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
  // Synthetic layout + eng config (saved by preliminary endpoint)
  synthetic_layout?: PlacedPanel[];
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
  engineeringSeed?: EngineeringSeed;  // structured seed from bill upload
  notes?: string;
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

// ─── Design Tool State ────────────────────────────────────────
export type DrawingMode = 
  | 'select' 
  | 'draw_roof' 
  | 'draw_ground' 
  | 'draw_fence' 
  | 'place_panels' 
  | 'measure';

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
}