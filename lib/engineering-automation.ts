/**
 * SolarPro V2.5 Smart Engineering Automation Engine
 * 
 * Automatically configures engineering parameters based on:
 * - Site location (geocode → state/county)
 * - Environmental data (ASCE wind, NOAA snow)
 * - NEC version (state-specific)
 * - System design parameters (inverter output, run length)
 * - Jurisdictional requirements
 */

import { getDb } from './auth';

// Get database connection
const getSql = () => getDb();

// ===== TYPES =====

export interface SiteConditions {
  project_id: number;
  state: string;
  county: string;
  latitude: number;
  longitude: number;
  nec_version: string;
  wind_speed_mph: number;
  ground_snow_load_psf: number;
  exposure_category: 'A' | 'B' | 'C' | 'D';
  wind_design_speed_mph: number;
  auto_configured: boolean;
}

export interface ElectricalAutoConfig {
  ac_breaker_size: number;
  required_conductor_ampacity: number;
  minimum_wire_gauge: string;
  conductor_type: string;
  egc_size: string;
  dc_ocpd: number;
  voltage_drop_percent: number;
  conduit_fill_percent: number;
  conduit_size: string;
}

export interface HardwareSelection {
  component_id: number;
  category: string;
  manufacturer: string;
  model: string;
  part_number: string;
  quantity: number;
  auto_selected: boolean;
}

export interface AutoConfigResult {
  siteConditions: SiteConditions;
  electrical: ElectricalAutoConfig;
  hardware: HardwareSelection[];
  warnings: string[];
  logs: Array<{
    field: string;
    auto_value: any;
    reason: string;
  }>;
}

// ===== STATE TO NEC MAPPING =====

const STATE_NEC_DEFAULTS: Record<string, string> = {
  CA: '2023', NY: '2023', MA: '2023', WA: '2020', TX: '2023',
  FL: '2020', AZ: '2023', CO: '2020', NV: '2020', NM: '2020',
  OR: '2023', UT: '2020', NC: '2020', SC: '2020', GA: '2020',
  VA: '2023', MD: '2023', PA: '2020', NJ: '2023', CT: '2023',
  RI: '2023', VT: '2020', NH: '2020', ME: '2020',
};

// DEFAULT NEC 2020 FOR UNMAPPED STATES
const DEFAULT_NEC_VERSION = '2020';

// ===== EXPOSURE CATEGORIES (ASCE 7) =====

const EXPOSURE_CATEGORY_RULES = {
  A: 'Urban or suburban areas with numerous closely spaced obstructions',
  B: 'Open terrain with scattered obstructions less than 30 feet tall',
  C: 'Open terrain with flat surfaces and minimal obstructions',
  D: 'Flat, unobstructed areas exposed to wind flowing over large bodies of water',
};

// ===== CONDUCTOR AMPACITY DATA =====

const CONDUCTOR_AMPACITY = {
  copper: {
    THHN: {
      90: { 14: 25, 12: 30, 10: 40, 8: 55, 6: 75, 4: 95, 3: 110, 2: 130, 1: 150 },
      75: { 14: 20, 12: 25, 10: 35, 8: 50, 6: 65, 4: 85, 3: 100, 2: 115, 1: 130 },
    },
    XHHW2: {
      90: { 14: 25, 12: 30, 10: 40, 8: 55, 6: 75, 4: 95, 3: 110, 2: 130, 1: 150 },
      75: { 14: 25, 12: 25, 10: 35, 8: 50, 6: 65, 4: 85, 3: 100, 2: 115, 1: 130 },
    },
    USE2: {
      90: { 14: 25, 12: 30, 10: 40, 8: 55, 6: 75, 4: 95, 3: 110, 2: 130, 1: 150 },
      75: { 14: 20, 12: 25, 10: 35, 8: 50, 6: 65, 4: 85, 3: 100, 2: 115, 1: 130 },
    },
  },
};

// EGC SIZE (NEC 250.122)
const EGC_SIZES = [14, 12, 10, 8, 6, 4, 3, 2, 1, '1/0', '2/0', '3/0', '4/0', '250'];

function getEGCSize(ocpdAmps: number): string {
  for (const size of EGC_SIZES) {
    const amps = typeof size === 'number' ? size * 15 : parseInt(size.toString()) * 15;
    if (amps >= ocpdAmps) return `${size} AWG`;
  }
  return '250 kcmil';
}

// CONDUIT FILL CALCULATION
const CONDUIT_TYPES = {
  'schedule40_pvc': { fill_percent: 53, sizes: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4] },
  'schedule80_pvc': { fill_percent: 40, sizes: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4] },
  'emt': { fill_percent: 40, sizes: [0.5, 0.75, 1, 1.25, 1.5, 2] },
};

function calculateConduitFill(
  conductors: { awg: number; count: number }[],
  conduitType: keyof typeof CONDUIT_TYPES
): { conduit_size: string; fill_percent: number } {
  const spec = CONDUIT_TYPES[conduitType];
  const conductorAreas = { 14: 0.008, 12: 0.013, 10: 0.021, 8: 0.036, 6: 0.059, 4: 0.088, 3: 0.112, 2: 0.126 } as const;
  
  let totalArea = 0;
  conductors.forEach(c => {
    totalArea += (conductorAreas[c.awg as keyof typeof conductorAreas] || 0.008) * c.count;
  });
  
  for (const size of spec.sizes) {
    const conduitAreas = { 0.5: 0.078, 0.75: 0.135, 1: 0.212, 1.25: 0.366, 1.5: 0.486, 2: 0.823, 2.5: 1.324, 3: 1.902, 3.5: 2.548, 4: 3.344 };
    const maxFill = (conduitAreas[size as keyof typeof conduitAreas] || 0.078) * (spec.fill_percent / 100);
    if (totalArea <= maxFill) {
      return { conduit_size: `${size}"`, fill_percent: Math.round((totalArea / maxFill) * 100) };
    }
  }
  
  return { conduit_size: '4"', fill_percent: 100 };
}

// ===== API HELPERS =====

interface GeocodeResult {
  state: string;
  county: string;
  latitude: number;
  longitude: number;
}

async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  try {
    const encoded = encodeURIComponent(address);
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${apiKey}`
    );
    const data = await res.json();
    
    if (data.status !== 'OK' || !data.results?.[0]) {
      console.warn('Geocode failed:', data.status);
      return null;
    }
    
    const result = data.results[0];
    const lat = result.geometry.location.lat;
    const lng = result.geometry.location.lng;
    
    let state = '';
    let county = '';
    
    for (const component of result.address_components) {
      if (component.types.includes('administrative_area_level_1')) {
        state = component.short_name;
      }
      if (component.types.includes('administrative_area_level_2')) {
        county = component.long_name.replace(' County', '');
      }
    }
    
    return { state, county, latitude: lat, longitude: lng };
  } catch (err) {
    console.error('Geocode error:', err);
    return null;
  }
}

interface CensusGeocodeResult {
  state: string;
  county: string;
}

async function censusReverseGeocode(lat: number, lon: number): Promise<CensusGeocodeResult | null> {
  try {
    const res = await fetch(
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Census2020&vintage=Census2020&format=json`
    );
    const data = await res.json();
    
    if (!data.result?.Counties?.[0]) {
      console.warn('Census geocode failed');
      return null;
    }
    
    const geo = data.result.Counties[0];
    const state = geo.STATE;
    const county = geo.NAME.replace(' County', '');
    
    return { state, county };
  } catch (err) {
    console.error('Census geocode error:', err);
    return null;
  }
}

interface PVWattsResult {
  ac_annual: number;
  dc_monthly: number[];
  ac_monthly: number[];
}

async function getPVWattsData(
  lat: number,
  lon: number,
  systemSizeKw: number,
  arrayType: number = 1, // 1=fixed open rack, 2=fixed roof mount, 3=1-axis tracking, 4=1-axis backtracking, 5=2-axis
  tilt: number = 20,
  azimuth: number = 180,
  losses: number = 14
): Promise<PVWattsResult | null> {
  try {
    const apiKey = process.env.NREL_API_KEY || 'DEMO_KEY';
    const params = new URLSearchParams({
      api_key: apiKey,
      lat: lat.toString(),
      lon: lon.toString(),
      system_capacity: systemSizeKw.toString(),
      module_type: '1',
      losses: losses.toString(),
      array_type: arrayType.toString(),
      tilt: tilt.toString(),
      azimuth: azimuth.toString(),
    });
    
    const res = await fetch(
      `https://developer.nrel.gov/api/pvwatts/v8.json?${params.toString()}`
    );
    const data = await res.json();
    
    if (!data.outputs) {
      console.warn('PVWatts failed:', data);
      return null;
    }
    
    return {
      ac_annual: data.outputs.ac_annual,
      dc_monthly: data.outputs.dc_monthly,
      ac_monthly: data.outputs.ac_monthly,
    };
  } catch (err) {
    console.error('PVWatts error:', err);
    return null;
  }
}

// ===== SMART ENGINEERING ENGINE =====

export async function autoConfigureProject(
  projectId: number,
  address: string,
  inverterACOutput: number,
  dcStringCurrent: number,
  runLengthFeet: number,
  conduitType: string = 'schedule40_pvc',
  conductorType: string = 'THHN',
  arrayType: string = 'roof'
): Promise<AutoConfigResult> {
  const logs: AutoConfigResult['logs'] = [];
  const warnings: string[] = [];
  
  // ===== STEP 1: GEOCODE & DETECT STATE/COUNTY =====
  let geo = await geocodeAddress(address);
  if (!geo?.state) {
    warnings.push('Geocode failed, cannot auto-detect state/county');
    return {
      siteConditions: {} as any,
      electrical: {} as any,
      hardware: [],
      warnings,
      logs,
    };
  }
  
  logs.push({
    field: 'state',
    auto_value: geo.state,
    reason: 'Detected from address geocoding',
  });
  logs.push({
    field: 'county',
    auto_value: geo.county,
    reason: 'Detected from address geocoding',
  });
  
  // ===== STEP 2: DETERMINE NEC VERSION =====
  const necVersion = STATE_NEC_DEFAULTS[geo.state] || DEFAULT_NEC_VERSION;
  logs.push({
    field: 'nec_version',
    auto_value: necVersion,
    reason: `State ${geo.state} adopts NEC ${necVersion}`,
  });
  
  // ===== STEP 3: FETCH ENVIRONMENTAL DATA =====
  const envResult = await getSql()`
    SELECT wind_speed_mph, ground_snow_load_psf, exposure_category
    FROM county_environmental_data
    WHERE state = ${geo.state} AND county = ${geo.county}
    LIMIT 1
  `;
  
  let windSpeed = 90; // ASCE 7 default
  let snowLoad = 0; // NOAA default
  let exposure = 'B' as const;
  
  if (envResult.length > 0) {
    windSpeed = envResult[0].wind_speed_mph;
    snowLoad = envResult[0].ground_snow_load_psf;
    exposure = envResult[0].exposure_category as any;
    logs.push({
      field: 'wind_speed_mph',
      auto_value: windSpeed,
      reason: `ASCE dataset for ${geo.county}, ${geo.state}`,
    });
    logs.push({
      field: 'ground_snow_load_psf',
      auto_value: snowLoad,
      reason: `NOAA dataset for ${geo.county}, ${geo.state}`,
    });
    logs.push({
      field: 'exposure_category',
      auto_value: exposure,
      reason: `Default for ${geo.county}, ${geo.state}`,
    });
  } else {
    warnings.push(`No environmental data for ${geo.county}, ${geo.state} - using defaults`);
  }
  
  // Adjust wind speed for importance factor (Risk Category II residential)
  const windDesignSpeed = windSpeed * 1.0;
  logs.push({
    field: 'wind_design_speed_mph',
    auto_value: windDesignSpeed,
    reason: 'ASCE 7-16 Risk Category II (importance factor = 1.0)',
  });
  
  // ===== STEP 4: AUTO-POPULATE ELECTRICAL DESIGN =====
  
  // NEC 705.12(B)(2)(1) - AC breaker size (125% of inverter AC output)
  const requiredBreakerAmps = inverterACOutput * 1.25;
  const standardBreakerSizes = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400];
  const acBreakerSize = standardBreakerSizes.find(size => size >= requiredBreakerAmps) || Math.ceil(requiredBreakerAmps);
  
  logs.push({
    field: 'ac_breaker_size',
    auto_value: acBreakerSize,
    reason: `NEC 705.12(B)(2)(1): 125% of ${inverterACOutput}A = ${requiredBreakerAmps.toFixed(1)}A, rounded to ${acBreakerSize}A standard size`,
  });
  
  // Required conductor ampacity (125% of inverter AC output)
  const requiredAmpacity = inverterACOutput * 1.25;
  
  // Select minimum wire gauge
  const ampTable = CONDUCTOR_AMPACITY.copper[conductorType as keyof typeof CONDUCTOR_AMPACITY.copper] as any;
  const tempColumn = conductorType === 'THHN' ? '90' : '75';
  const ampacityCol = ampTable?.[tempColumn] || {};
  
  let minimumWireGauge = '10 AWG';
  let foundGauge = false;
  const gaugeOrder = [14, 12, 10, 8, 6, 4, 3, 2, 1];
  
  for (const gauge of gaugeOrder) {
    if (ampacityCol[gauge] >= requiredAmpacity) {
      minimumWireGauge = `${gauge} AWG`;
      foundGauge = true;
      break;
    }
  }
  
  if (!foundGauge) {
    warnings.push(`Required ampacity ${requiredAmpacity.toFixed(1)}A exceeds available wire sizes`);
    minimumWireGauge = '1 AWG';
  }
  
  logs.push({
    field: 'minimum_wire_gauge',
    auto_value: minimumWireGauge,
    reason: `NEC 240.4: Ampacity ${requiredAmpacity.toFixed(1)}A required, ${minimumWireGauge} selected for ${conductorType} conductor`,
  });
  
  // EGC size per NEC 250.122
  const egcSize = getEGCSize(acBreakerSize);
  logs.push({
    field: 'egc_size',
    auto_value: egcSize,
    reason: `NEC 250.122: EGC sized for ${acBreakerSize}A OCPD`,
  });
  
  // DC OCPD (typically 1.56 × Isc)
  const dcOcpd = Math.ceil(dcStringCurrent * 1.56);
  const standardDcOcpd = standardBreakerSizes.find(size => size >= dcOcpd) || dcOcpd;
  logs.push({
    field: 'dc_ocpd',
    auto_value: standardDcOcpd,
    reason: `NEC 690.8(B): 1.56 × ${dcStringCurrent}A = ${dcOcpd.toFixed(1)}A, rounded to ${standardDcOcpd}A`,
  });
  
  // Voltage drop (Vd = 2 × K × I × D / CM)
  const K = 12.9; // Copper, DC/AC single phase
  const wireAWG = parseInt(minimumWireGauge);
  const circularMils = { 14: 4110, 12: 6530, 10: 10380, 8: 16510, 6: 26240, 4: 41740, 3: 52620, 2: 66360, 1: 83690 };
  const cm = circularMils[wireAWG as keyof typeof circularMils] || 83690;
  const voltage = 240; // Assume 240V single phase
  const voltageDrop = (2 * K * inverterACOutput * runLengthFeet) / cm;
  const voltageDropPercent = (voltageDrop / voltage) * 100;
  
  logs.push({
    field: 'voltage_drop_percent',
    auto_value: voltageDropPercent.toFixed(2),
    reason: `NEC 210.19(A): Vd = (2 × ${K} × ${inverterACOutput}A × ${runLengthFeet}ft) / ${cm} = ${voltageDrop.toFixed(2)}V (${voltageDropPercent.toFixed(2)}%)`,
  });
  
  // Conduit fill
  const conductorCount = 4; // 2 hots + neutral + EGC
  const wireGaugeForFill = parseInt(minimumWireGauge);
  const conduitResult = calculateConduitFill(
    [{ awg: wireGaugeForFill, count: conductorCount }],
    conduitType as keyof typeof CONDUIT_TYPES
  );
  
  logs.push({
    field: 'conduit_fill',
    auto_value: `${conduitResult.fill_percent}% in ${conduitResult.conduit_size}`,
    reason: `NEC Chapter 9: ${conductorCount} × ${minimumWireGauge} conductors in ${conduitType} conduit`,
  });
  
  const electrical: ElectricalAutoConfig = {
    ac_breaker_size: acBreakerSize,
    required_conductor_ampacity: requiredAmpacity,
    minimum_wire_gauge: minimumWireGauge,
    conductor_type: conductorType,
    egc_size: egcSize,
    dc_ocpd: standardDcOcpd,
    voltage_drop_percent: parseFloat(voltageDropPercent.toFixed(2)),
    conduit_fill_percent: conduitResult.fill_percent,
    conduit_size: conduitResult.conduit_size,
  };
  
  // ===== STEP 5: AUTO-SELECT HARDWARE =====
  
  // Primary mounting: Roof Tech Mini II with L-Bracket
  const hardware: HardwareSelection[] = [];
  
  const rackingResult = await getSql()`
    SELECT id, manufacturer, model, part_number, specs
    FROM hardware_components
    WHERE category = 'racking' AND model ILIKE '%Mini II%'
    LIMIT 1
  `;
  
  if (rackingResult.length > 0) {
    const rack = rackingResult[0];
    hardware.push({
      component_id: rack.id,
      category: 'racking',
      manufacturer: rack.manufacturer,
      model: rack.model,
      part_number: rack.part_number,
      quantity: 1, // Will be calculated based on module count
      auto_selected: true,
    });
    logs.push({
      field: 'primary_racking',
      auto_value: `${rack.manufacturer} ${rack.model}`,
      reason: `Default selection for ${arrayType} mount, uplift capacity: ${rack.specs.uplift_capacity_lbs}lbs`,
    });
  } else {
    warnings.push('Roof Tech Mini II not found in hardware database');
  }
  
  // Auto-select conductor
  const conductorResult = await getSql()`
    SELECT id, manufacturer, model, part_number
    FROM hardware_components
    WHERE category = 'conductor' AND specs->>'awg' = ${minimumWireGauge.split(' ')[0]} AND specs->>'type' = ${conductorType}
    LIMIT 1
  `;
  
  if (conductorResult.length > 0) {
    const cond = conductorResult[0];
    hardware.push({
      component_id: cond.id,
      category: 'conductor',
      manufacturer: cond.manufacturer,
      model: cond.model,
      part_number: cond.part_number,
      quantity: Math.ceil(runLengthFeet / 500), // Estimate per 500ft spool
      auto_selected: true,
    });
  }
  
  // Auto-select AC breaker
  const breakerResult = await getSql()`
    SELECT id, manufacturer, model, part_number
    FROM hardware_components
    WHERE category = 'breakers' AND specs->>'amperage' = ${acBreakerSize}::text
    LIMIT 1
  `;
  
  if (breakerResult.length > 0) {
    const brk = breakerResult[0];
    hardware.push({
      component_id: brk.id,
      category: 'breakers',
      manufacturer: brk.manufacturer,
      model: brk.model,
      part_number: brk.part_number,
      quantity: 1,
      auto_selected: true,
    });
  }
  
  // ===== STEP 6: SAVE TO DATABASE =====
  
  const siteConditions: SiteConditions = {
    project_id: projectId,
    state: geo.state,
    county: geo.county,
    latitude: geo.latitude,
    longitude: geo.longitude,
    nec_version: necVersion,
    wind_speed_mph: windSpeed,
    ground_snow_load_psf: snowLoad,
    exposure_category: exposure,
    wind_design_speed_mph: windDesignSpeed,
    auto_configured: true,
  };
  
  await getSql()`
    INSERT INTO site_conditions (
      project_id, state, county, latitude, longitude,
      nec_version, wind_speed_mph, ground_snow_load_psf,
      exposure_category, wind_design_speed_mph, auto_configured
    ) VALUES (
      ${siteConditions.project_id}, ${siteConditions.state}, ${siteConditions.county},
      ${siteConditions.latitude}, ${siteConditions.longitude}, ${siteConditions.nec_version},
      ${siteConditions.wind_speed_mph}, ${siteConditions.ground_snow_load_psf},
      ${siteConditions.exposure_category}, ${siteConditions.wind_design_speed_mph},
      ${siteConditions.auto_configured}
    )
    ON CONFLICT (project_id) DO UPDATE SET
      state = EXCLUDED.state,
      county = EXCLUDED.county,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      nec_version = EXCLUDED.nec_version,
      wind_speed_mph = EXCLUDED.wind_speed_mph,
      ground_snow_load_psf = EXCLUDED.ground_snow_load_psf,
      exposure_category = EXCLUDED.exposure_category,
      wind_design_speed_mph = EXCLUDED.wind_design_speed_mph,
      auto_configured = EXCLUDED.auto_configured,
      calculated_at = NOW()
  `;
  
  // Log all auto-configuration decisions
  for (const log of logs) {
    await getSql()`
      INSERT INTO auto_config_log (project_id, field_name, auto_value, reason, was_overridden)
      VALUES (${projectId}, ${log.field}, ${JSON.stringify(log.auto_value)}, ${log.reason}, FALSE)
    `;
  }
  
  return {
    siteConditions,
    electrical,
    hardware,
    warnings,
    logs,
  };
}

// ===== GENERATE DYNAMIC SLG =====

export async function generateDynamicSLG(
  projectId: number,
  inverterACOutput: number,
  moduleCount: number,
  arrayTilt: number,
  systemCapacityKw: number
): Promise<string> {
  // Get site conditions
  const siteResult = await getSql()`
    SELECT * FROM site_conditions WHERE project_id = ${projectId}
  `;
  
  if (siteResult.length === 0) {
    throw new Error('Site conditions not configured. Run auto-configure first.');
  }
  
  const site = siteResult[0];
  
  // Get electrical config from logs
  const electricalLogs = await getSql()`
    SELECT field_name, auto_value FROM auto_config_log
    WHERE project_id = ${projectId} AND field_name IN (
      'ac_breaker_size', 'minimum_wire_gauge', 'egc_size', 'voltage_drop_percent',
      'conduit_fill', 'primary_racking'
    )
  `;
  
  const electricalConfig: Record<string, any> = {};
  for (const row of electricalLogs) {
    electricalConfig[row.field_name] = row.auto_value;
  }
  
  // Generate SLG
  const necRef = site.nec_version === '2023' ? 'NEC 2023' : 'NEC 2020';
  
  let slg = `
SOLAR LOAD GENERATION (SLG)
============================
Project ID: ${projectId}
Date: ${new Date().toISOString().split('T')[0]}
System: ${systemCapacityKw.toFixed(2)} kW DC

SITE CONDITIONS
---------------
Location: ${site.county}, ${site.state}
Coordinates: ${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)}
Exposure: ${site.exposure_category}
Design Wind: ${site.wind_design_speed_mph} mph (ASCE 7-16)
Snow Load: ${site.ground_snow_load_psf} psf
NEC Version: ${necRef}

SYSTEM DATA
-----------
AC Output: ${inverterACOutput} A
Modules: ${moduleCount} × (assume 400W)
Array Tilt: ${arrayTilt}°
System Capacity: ${systemCapacityKw.toFixed(2)} kW DC

ELECTRICAL DESIGN (AUTO-CONFIGURED)
------------------------------------
AC Breaker: ${electricalConfig.ac_breaker_size || 'TBD'} A (NEC 705.12)
Conductor: ${electricalConfig.minimum_wire_gauge || 'TBD'} ${electricalConfig.conductor_type || 'THHN'}
EGC: ${electricalConfig.egc_size || 'TBD'} (NEC 250.122)
Voltage Drop: ${electricalConfig.voltage_drop_percent || 'TBD'}%
Conduit Fill: ${electricalConfig.conduit_fill || 'TBD'}

MOUNTING SYSTEM
---------------
${electricalConfig.primary_racking || 'Roof Tech Mini II with L-Bracket'}
Attachment: L-Bracket flush mount
Max Spacing: 48" (per manufacturer)
Roof Type: Composition Shingle

COMPLIANCE NOTES
----------------
System designed per ${necRef} Article 690 & 705
Rapid shutdown: NEC 690.12 (as applicable)
All conductors sized per ${necRef} Chapter 3 & 9
Grounding per ${necRef} Article 250

This SLG was auto-generated by SolarPro V2.5 Smart Engineering Engine.
All values are subject to verification by a licensed electrical engineer.
  `.trim();
  
  return slg;
}

// ===== ENGINEERING ASSIST MODE =====

export async function runEngineeringAssist(projectId: number, params: {
  address: string;
  inverterACOutput: number;
  dcStringCurrent: number;
  runLengthFeet: number;
  conduitType?: string;
  conductorType?: string;
  arrayType?: string;
}) {
  const result = await autoConfigureProject(
    projectId,
    params.address,
    params.inverterACOutput,
    params.dcStringCurrent,
    params.runLengthFeet,
    params.conduitType || 'schedule40_pvc',
    params.conductorType || 'THHN',
    params.arrayType || 'roof'
  );
  
  // Mark project as "Auto-Configured"
  await getSql()`
    UPDATE projects
    SET notes = COALESCE(notes, '') || E'\\nAuto-configured by SolarPro V2.5 on ' || NOW()::text
    WHERE id = ${projectId}
  `;
  
  return {
    status: 'success',
    projectId,
    result,
    timestamp: new Date().toISOString(),
  };
}

export async function overrideAutoConfig(
  projectId: number,
  fieldName: string,
  overrideValue: any,
  reason: string
) {
  // Get current auto value
  const currentResult = await getSql()`
    SELECT auto_value FROM auto_config_log
    WHERE project_id = ${projectId} AND field_name = ${fieldName} AND was_overridden = FALSE
    ORDER BY calculated_at DESC LIMIT 1
  `;
  
  if (currentResult.length === 0) {
    throw new Error(`No auto-configured value found for ${fieldName}`);
  }
  
  const originalValue = currentResult[0].auto_value;
  
  // Log the override
  await getSql()`
    INSERT INTO auto_config_log (project_id, field_name, auto_value, override_value, reason, was_overridden)
    VALUES (${projectId}, ${fieldName}, ${JSON.stringify(originalValue)}, ${JSON.stringify(overrideValue)}, ${reason}, TRUE)
  `;
  
  return {
    status: 'overridden',
    projectId,
    fieldName,
    originalValue,
    overrideValue,
    reason,
  };
}