// ============================================================
// Engineering Automation System — Report Generator
// Derives all engineering outputs from the Design Snapshot
// ============================================================

import type {
  DesignSnapshot, EngineeringReport, SystemSummary,
  ElectricalEngineering, StructuralEngineering,
  EquipmentSchedule, EquipmentLineItem,
  PanelLayoutData, PanelLayoutItem, PermitPackage,
  ProjectPhysicalData, SitePhotosSection,
} from './types';
import type { EnrichedSiteSurvey } from '@/lib/siteSurvey/types';
import { necNextStandardOcpd } from '@/lib/permit/utils/helpers';

// NEC wire sizing tables (simplified)
const DC_WIRE_SIZING: { maxAmps: number; gauge: string; conduit: string }[] = [
  { maxAmps: 20,  gauge: '#12 AWG',  conduit: '3/4" EMT' },
  { maxAmps: 30,  gauge: '#10 AWG',  conduit: '3/4" EMT' },
  { maxAmps: 40,  gauge: '#8 AWG',   conduit: '1" EMT'   },
  { maxAmps: 55,  gauge: '#6 AWG',   conduit: '1" EMT'   },
  { maxAmps: 70,  gauge: '#4 AWG',   conduit: '1-1/4" EMT' },
  { maxAmps: 85,  gauge: '#3 AWG',   conduit: '1-1/4" EMT' },
  { maxAmps: 95,  gauge: '#2 AWG',   conduit: '1-1/2" EMT' },
  { maxAmps: 130, gauge: '#1 AWG',   conduit: '1-1/2" EMT' },
  { maxAmps: 150, gauge: '#1/0 AWG', conduit: '2" EMT'   },
];

const AC_WIRE_SIZING: { maxAmps: number; gauge: string; conduit: string }[] = [
  { maxAmps: 20,  gauge: '#12 AWG',  conduit: '3/4" EMT' },
  { maxAmps: 30,  gauge: '#10 AWG',  conduit: '3/4" EMT' },
  { maxAmps: 40,  gauge: '#8 AWG',   conduit: '1" EMT'   },
  { maxAmps: 55,  gauge: '#6 AWG',   conduit: '1" EMT'   },
  { maxAmps: 70,  gauge: '#4 AWG',   conduit: '1-1/4" EMT' },
  { maxAmps: 95,  gauge: '#2 AWG',   conduit: '1-1/2" EMT' },
  { maxAmps: 130, gauge: '#1/0 AWG', conduit: '2" EMT'   },
];

// State NEC version mapping
const STATE_NEC: Record<string, string> = {
  CA: 'NEC 2022', TX: 'NEC 2020', FL: 'NEC 2020', NY: 'NEC 2020',
  IL: 'NEC 2020', PA: 'NEC 2020', OH: 'NEC 2020', GA: 'NEC 2020',
  NC: 'NEC 2020', MI: 'NEC 2020', NJ: 'NEC 2020', VA: 'NEC 2020',
  WA: 'NEC 2020', AZ: 'NEC 2020', MA: 'NEC 2020', TN: 'NEC 2020',
  IN: 'NEC 2020', MO: 'NEC 2020', MD: 'NEC 2020', WI: 'NEC 2020',
  CO: 'NEC 2020', MN: 'NEC 2020', SC: 'NEC 2020', AL: 'NEC 2020',
  OR: 'NEC 2020', NV: 'NEC 2020', KY: 'NEC 2020', OK: 'NEC 2020',
  CT: 'NEC 2020', UT: 'NEC 2020', IA: 'NEC 2020', AR: 'NEC 2020',
  NM: 'NEC 2020', KS: 'NEC 2020', NE: 'NEC 2020', ID: 'NEC 2020',
  WV: 'NEC 2020', HI: 'NEC 2020', NH: 'NEC 2020', ME: 'NEC 2020',
  RI: 'NEC 2020', MT: 'NEC 2020', DE: 'NEC 2020', SD: 'NEC 2020',
  ND: 'NEC 2020', AK: 'NEC 2020', VT: 'NEC 2020', WY: 'NEC 2020',
  DC: 'NEC 2020', MS: 'NEC 2020', LA: 'NEC 2020',
};

// State wind speed (mph, ASCE 7-22 Risk Category II)
const STATE_WIND: Record<string, number> = {
  FL: 150, TX: 130, LA: 130, MS: 130, AL: 130, GA: 120, SC: 120,
  NC: 115, VA: 110, MD: 110, DE: 110, NJ: 110, NY: 110, CT: 110,
  RI: 110, MA: 110, NH: 110, ME: 110, CA: 110, OR: 110, WA: 110,
  HI: 130, AK: 110,
};

// State ground snow load (psf)
const STATE_SNOW: Record<string, number> = {
  AK: 100, MT: 60, WY: 50, CO: 50, ID: 40, UT: 40, WA: 35, OR: 30,
  MN: 35, WI: 30, MI: 30, NY: 30, VT: 50, NH: 50, ME: 50, MA: 25,
  CT: 25, RI: 25, PA: 25, NJ: 20, OH: 20, IN: 20, IL: 20, IA: 25,
  MO: 15, KS: 15, NE: 20, SD: 30, ND: 35,
};

function getWindSpeed(stateCode: string): number {
  return STATE_WIND[stateCode] || 115;
}

function getSnowLoad(stateCode: string): number {
  return STATE_SNOW[stateCode] || 0;
}

function getNecVersion(stateCode: string): string {
  return STATE_NEC[stateCode] || 'NEC 2020';
}

function selectWire(amps: number, table: typeof DC_WIRE_SIZING): { gauge: string; conduit: string } {
  // NEC 690.8: multiply by 1.25 for continuous load
  const designAmps = amps * 1.25;
  for (const entry of table) {
    if (designAmps <= entry.maxAmps) return { gauge: entry.gauge, conduit: entry.conduit };
  }
  return { gauge: '#2/0 AWG', conduit: '2" EMT' };
}

// ── Main Report Generator ─────────────────────────────────────────────────────

export function generateEngineeringReport(
  snapshot: DesignSnapshot,
  reportId: string,
  physicalData?: ProjectPhysicalData | null,
  enrichedSurvey?: EnrichedSiteSurvey | null,
): EngineeringReport {
  const pd = physicalData ?? null;
  const systemSummary = generateSystemSummary(snapshot);
  const electrical = generateElectricalEngineering(snapshot, pd);
  const structural = generateStructuralEngineering(snapshot, pd);
  const equipmentSchedule = generateEquipmentSchedule(snapshot, electrical);
  const panelLayout = generatePanelLayout(snapshot);
  const permitPackage = generatePermitPackage(snapshot, electrical, structural);

  // Optional: Site Photos section — populated only when enrichedSurvey is provided
  // and contains photos from the project_files ingest pipeline.
  // Read-only and informational — no engineering calculations depend on this.
  const sitePhotos = generateSitePhotosSection(enrichedSurvey ?? null);

  return {
    id: reportId,
    projectId: snapshot.projectId,
    layoutId: snapshot.layoutId,
    designVersionId: snapshot.designVersionId,
    status: 'complete',
    systemSummary,
    electrical,
    structural,
    equipmentSchedule,
    panelLayout,
    permitPackage,
    generatedAt: new Date().toISOString(),
    generatedBy: 'auto',
    version: '1.0',
    // Only include sitePhotos when photos are actually available
    ...(sitePhotos !== null ? { sitePhotos } : {}),
  };
}

// ── System Summary ────────────────────────────────────────────────────────────

function generateSystemSummary(snap: DesignSnapshot): SystemSummary {
  const panel = snap.panel;
  const inverter = snap.inverter;
  const mounting = snap.mounting;

  // Estimate annual production (simplified PVWatts-like)
  const peakSunHours = getPeakSunHours(snap.lat, snap.stateCode);
  const systemLoss = 0.86; // 14% system losses
  const estimatedAnnualKwh = Math.round(snap.systemSizeKw * peakSunHours * 365 * systemLoss);
  const co2OffsetTons = parseFloat((estimatedAnnualKwh * 0.000386).toFixed(1));

  const mountType = snap.systemType === 'roof' ? 'Roof Mount' :
                    snap.systemType === 'ground' ? 'Ground Mount' : 'Fence Mount';

  return {
    panelCount: snap.panelCount,
    systemSizeKw: snap.systemSizeKw,
    systemSizeDcKw: snap.systemSizeKw,
    systemSizeAcKw: inverter ? Math.min(snap.systemSizeKw, inverter.capacity) : snap.systemSizeKw,
    panelModel: `${panel.manufacturer} ${panel.model}`,
    panelWattage: panel.wattage,
    inverterModel: inverter ? `${inverter.manufacturer} ${inverter.model}` : 'TBD',
    inverterType: inverter?.type || 'string',
    mountType,
    systemType: snap.systemType,
    address: snap.address,
    ahj: snap.ahj,
    utilityName: snap.utilityName,
    estimatedAnnualKwh,
    co2OffsetTons,
    roofSegmentCount: snap.roofSegments.length,
    groundArrayCount: snap.groundArrays.length,
    fenceArrayCount: snap.fenceArrays.length,
  };
}

function getPeakSunHours(lat: number, stateCode: string): number {
  // Simplified peak sun hours by latitude band — use the MAGNITUDE so Southern
  // Hemisphere sites (negative lat, e.g. Australia) map to the correct band
  // instead of always falling through to the max 5.8 and overstating production.
  const absLat = Math.abs(lat);
  if (absLat >= 45) return 4.0;
  if (absLat >= 40) return 4.5;
  if (absLat >= 35) return 5.0;
  if (absLat >= 30) return 5.5;
  return 5.8;
}

// ── Electrical Engineering ────────────────────────────────────────────────────

function generateElectricalEngineering(snap: DesignSnapshot, pd: ProjectPhysicalData | null): ElectricalEngineering {
  const panel = snap.panel;
  const inverter = snap.inverter;
  const isMicro = inverter?.type === 'micro';
  const isOptimizer = inverter?.type === 'optimizer';

  // Panel electrical specs (use typical values if not in panel spec)
  // Error 5g fix: voc/vmp/isc/imp now on SolarPanel type — remove `as any` casts
  const panelVoc = panel.voc || panel.wattage / 8.5;  // typical Voc
  const panelVmp = panel.vmp || panel.wattage / 9.5;  // typical Vmp
  const panelIsc = panel.isc || panel.wattage / panelVoc * 1.1;
  const panelImp = panel.imp || panel.wattage / panelVmp;

  // String sizing
  let panelsPerString = 1;
  let stringCount = snap.panelCount;
  let stringVoc = panelVoc;
  let stringVmp = panelVmp;
  let stringIsc = panelIsc;

  if (!isMicro) {
    // String inverter: calculate optimal string length
    // Error 5h fix: maxDcVoltage/mpptVoltageMax now on Inverter type — remove `as any` casts
    const maxDcVoltage = inverter?.maxDcVoltage || 600;
    const mpptVoltageMax = inverter?.mpptVoltageMax || 550;
    const mpptChannels = inverter?.mpptChannels || 2;

    // Max panels per string (NEC 690.7: Voc × 1.25 ≤ maxDcVoltage)
    const necMaxPerString = Math.max(1, Math.min(Math.floor(maxDcVoltage / (panelVoc * 1.25)), 20));
    panelsPerString = necMaxPerString;

    // Optimal: target Vmp in MPPT range
    const targetPanels = Math.floor(mpptVoltageMax / panelVmp);
    panelsPerString = Math.min(panelsPerString, targetPanels);

    // Prefer a minimum string length of 8, but NEVER exceed the actual panel
    // count or the NEC 690.7 maximum — otherwise small systems report a string
    // longer than the array (overstating Voc/Vmp) and high-Voc panels defeat
    // the safety clamp.
    panelsPerString = Math.min(panelsPerString, snap.panelCount || panelsPerString, necMaxPerString);
    if ((snap.panelCount || 0) >= 8) {
      panelsPerString = Math.min(Math.max(panelsPerString, 8), necMaxPerString, snap.panelCount);
    }
    panelsPerString = Math.max(1, panelsPerString);

    stringCount = Math.ceil(snap.panelCount / panelsPerString);
    stringVoc = panelVoc * panelsPerString;
    stringVmp = panelVmp * panelsPerString;
    stringIsc = panelIsc; // parallel strings don't change Isc per string
  }

  // DC wire sizing (NEC 690.8: Isc × 1.25 × 1.25 = 156% of Isc)
  const dcDesignAmps = panelIsc * 1.56;
  const dcWire = selectWire(dcDesignAmps, DC_WIRE_SIZING);

  // AC wire sizing
  const acOutputKw = inverter?.capacity || snap.systemSizeKw;
  const acVoltage = 240;
  const acAmps = (acOutputKw * 1000) / acVoltage;
  const acWire = selectWire(acAmps, AC_WIRE_SIZING);

  // Breaker sizing (NEC 705.12: 125% of inverter output)
  const acBreakerAmps = necNextStandardOcpd(acAmps * 1.25);
  const backfeedBreakerAmps = acBreakerAmps;

  // Main panel bus check (NEC 705.12(B))
  // Use real panel rating from project_physical_data if available.
  // Falls back to 200A (typical residential) only when no survey data exists.
  const mainPanelBusAmps: number = pd?.panel_rating_amps ?? 200;

  // Rapid shutdown (NEC 690.12)
  const rapidShutdownRequired = snap.systemType === 'roof';

  // Interconnection type
  // If the field tech explicitly identified the interconnection point, use it.
  // Otherwise derive from NEC 705.12(B): backfeed breaker ≤ 20% of bus rating
  // qualifies for load-side; above that requires supply-side tap.
  const _necCalcInterconnection = backfeedBreakerAmps <= (mainPanelBusAmps * 0.2) ? 'load-side' : 'supply-side';
  const _surveyInterconnection  = pd?.interconnection_point;
  const interconnectionType: 'load-side' | 'supply-side' =
    (_surveyInterconnection === 'load_side'   || _surveyInterconnection === 'main_panel') ? 'load-side'   :
    (_surveyInterconnection === 'supply_side' || _surveyInterconnection === 'sub_panel')  ? 'supply-side' :
    _necCalcInterconnection;

  const necVersion = getNecVersion(snap.stateCode);
  const complianceNotes: string[] = [
    `NEC ${necVersion} compliance required`,
    `NEC 690.12 Rapid Shutdown: ${rapidShutdownRequired ? 'Required' : 'Not Required'}`,
    `NEC 705.12(B) Bus Loading: ${backfeedBreakerAmps}A backfeed on ${mainPanelBusAmps}A bus`,
    `NEC 690.8 Wire Sizing: DC ${dcWire.gauge}, AC ${acWire.gauge}`,
  ];

  if (isMicro) {
    complianceNotes.push('Microinverter system: AC trunk cable sizing per NEC 690.8(B)');
  }

  return {
    dcSystemSizeKw: snap.systemSizeKw,
    dcVoltage: isMicro ? panelVoc : stringVoc,
    stringCount,
    panelsPerString,
    stringVoc: parseFloat(stringVoc.toFixed(1)),
    stringVmp: parseFloat(stringVmp.toFixed(1)),
    stringIsc: parseFloat(stringIsc.toFixed(2)),
    acSystemSizeKw: acOutputKw,
    acVoltage,
    acFrequency: 60,
    dcWireGauge: dcWire.gauge,
    dcConduitSize: dcWire.conduit,
    acWireGauge: acWire.gauge,
    acConduitSize: acWire.conduit,
    groundWireGauge: '#8 AWG',
    stringFuseAmps: necNextStandardOcpd(panelIsc * 1.56),
    dcDisconnectAmps: necNextStandardOcpd(dcDesignAmps),
    acBreakerAmps,
    mainPanelBusAmps,
    backfeedBreakerAmps,
    interconnectionType,
    interconnectionMethod: interconnectionType === 'load-side' ? 'Backfeed Breaker' : 'Supply-Side Tap',
    rapidShutdownRequired,
    rapidShutdownDevice: rapidShutdownRequired ? 'Tigo TS4-A-2F or equivalent' : 'N/A',
    necVersion,
    complianceNotes,
    // Survey-sourced fields (Phase 4 — optional, omitted when physicalData absent)
    ...(pd?.available_breaker_slots !== undefined ? { availableBreakerSlots: pd.available_breaker_slots } : {}),
    ...(pd?.service_entrance_type   !== undefined ? { serviceEntranceType:   pd.service_entrance_type   } : {}),
    ...(pd?.meter_socket_type       !== undefined ? { meterSocketType:       pd.meter_socket_type       } : {}),
    ...(pd?.has_sub_panel           !== undefined ? { hasSubPanel:           pd.has_sub_panel           } : {}),
    ...(pd?.sub_panel_rating_amps   !== undefined ? { subPanelRatingAmps:    pd.sub_panel_rating_amps   } : {}),
  };
}

// ── Structural Engineering ────────────────────────────────────────────────────

function generateStructuralEngineering(snap: DesignSnapshot, pd: ProjectPhysicalData | null): StructuralEngineering {
  const windSpeed = getWindSpeed(snap.stateCode);
  const snowLoad = getSnowLoad(snap.stateCode);

  // Panel weight (typical 40-50 lbs per panel)
  // Error 5f fix: SolarPanel.weight is in kg — convert to lbs (1 kg = 2.20462 lbs).
  // Remove `as any` cast that masked both the type-safety and unit-conversion issue.
  const panelWeightKg  = snap.panel.weight || 0;
  const panelWeightLbs = panelWeightKg > 0 ? panelWeightKg * 2.20462 : 44;
  const totalArrayWeightLbs = snap.panelCount * panelWeightLbs;

  // Dead load (panel + racking, typical 4-5 psf)
  const panelAreaM2 = snap.panel.width * snap.panel.height;
  const deadLoadPsf = parseFloat(((panelWeightLbs / (panelAreaM2 * 10.764)) + 1.5).toFixed(1));

  // Rafter sizing
  // Use real values from project_physical_data when available.
  // Falls back to typical residential defaults only when no survey data exists.
  const roofPitch = snap.roofSegments[0]?.pitchDegrees || 20;
  const rafterSize = roofPitch > 30 ? '2×6' : '2×6';
  const rafterSpanFt = 12; // typical residential — no survey field for span yet
  // rafter_spacing_in: survey captures 16" or 24" O.C. (or null for 'other'/unknown)
  const rafterSpacingIn: number = pd?.rafter_spacing_in ?? 24;

  // Mounting system
  const mountingSystem = snap.mounting?.name || 'IronRidge XR100 Rail System';
  const attachmentType = snap.systemType === 'roof' ? 'Lag Bolt to Rafter' : 'Ground Screw';
  const attachmentSpacingFt = snap.systemType === 'roof' ? 4 : 8;
  const railSpacingIn = snap.panel.height > 1.5 ? 48 : 36;

  const complianceNotes: string[] = [
    `ASCE 7-22 Wind Speed: ${windSpeed} mph (Risk Category II)`,
    `Ground Snow Load: ${snowLoad} psf`,
    `Dead Load: ${deadLoadPsf} psf (panels + racking)`,
    `Attachment: ${attachmentType} @ ${attachmentSpacingFt}ft O.C.`,
    `Rail Spacing: ${railSpacingIn}" O.C.`,
  ];

  if (snowLoad > 30) {
    complianceNotes.push(`High snow load region: verify rafter capacity for ${snowLoad} psf`);
  }
  if (windSpeed > 130) {
    complianceNotes.push(`High wind zone: enhanced attachment required per ASCE 7-22`);
  }

  return {
    roofType: pd?.roof_material ?? 'Asphalt Shingle',
    roofPitch,
    rafterSize,
    rafterSpanFt,
    rafterSpacingIn,
    windSpeedMph: windSpeed,
    groundSnowLoadPsf: snowLoad,
    seismicZone: getSeismicZone(snap.stateCode),
    panelWeightLbs,
    totalArrayWeightLbs,
    deadLoadPsf,
    mountingSystem,
    attachmentType,
    attachmentSpacingFt,
    railSpacingIn,
    ibc: 'IBC 2021',
    asce: 'ASCE 7-22',
    complianceNotes,
    // Survey-sourced fields (Phase 4 — optional, omitted when physicalData absent)
    ...(pd?.roof_pitch      !== undefined ? { roofPitchCategory: pd.roof_pitch      } : {}),
    ...(pd?.roof_age_years  !== undefined ? { roofAgeYears:      pd.roof_age_years  } : {}),
  };
}

function getSeismicZone(stateCode: string): string {
  const highSeismic = ['CA', 'AK', 'WA', 'OR', 'NV', 'UT', 'ID', 'MT', 'WY', 'HI'];
  const modSeismic = ['SC', 'TN', 'AR', 'MO', 'IL', 'IN', 'KY', 'OH'];
  if (highSeismic.includes(stateCode)) return 'D/E (High)';
  if (modSeismic.includes(stateCode)) return 'C (Moderate)';
  return 'A/B (Low)';
}

// ── Equipment Schedule ────────────────────────────────────────────────────────

function generateEquipmentSchedule(
  snap: DesignSnapshot,
  elec: ElectricalEngineering
): EquipmentSchedule {
  const panel = snap.panel;
  const inverter = snap.inverter;
  const isMicro = inverter?.type === 'micro';

  const panels: EquipmentLineItem[] = [{
    tag: 'PV-1',
    description: 'Solar PV Module',
    manufacturer: panel.manufacturer,
    model: panel.model,
    quantity: snap.panelCount,
    unit: 'EA',
    specs: `${panel.wattage}W, ${panel.efficiency}% eff, ${panel.width}m × ${panel.height}m`,
    notes: panel.bifacial ? 'Bifacial module' : undefined,
  }];

  const inverters: EquipmentLineItem[] = inverter ? [{
    tag: isMicro ? 'MI-1' : 'INV-1',
    description: isMicro ? 'Microinverter' : 'String Inverter',
    manufacturer: inverter.manufacturer,
    model: inverter.model,
    quantity: isMicro ? snap.panelCount : Math.ceil(snap.systemSizeKw / inverter.capacity),
    unit: 'EA',
    specs: `${inverter.capacity}kW AC, ${inverter.efficiency}% eff`,
    notes: inverter.batteryCompatible ? 'Battery compatible' : undefined,
  }] : [{
    tag: 'INV-1',
    description: 'String Inverter (TBD)',
    manufacturer: 'TBD',
    model: 'TBD',
    quantity: 1,
    unit: 'EA',
    specs: `${snap.systemSizeKw}kW AC`,
  }];

  const mounting: EquipmentLineItem[] = [{
    tag: 'MNT-1',
    description: snap.systemType === 'roof' ? 'Roof Mount Rail System' :
                 snap.systemType === 'ground' ? 'Ground Mount Structure' : 'Fence Mount System',
    manufacturer: snap.mounting?.manufacturer || 'IronRidge',
    model: snap.mounting?.name || 'XR100',
    quantity: snap.panelCount,
    unit: 'EA',
    specs: `For ${panel.wattage}W modules`,
  }];

  const electricalItems: EquipmentLineItem[] = [
    {
      tag: 'DC-DISC-1',
      description: 'DC Disconnect Switch',
      manufacturer: 'Midnite Solar',
      model: 'MNDC-GFP',
      quantity: 1,
      unit: 'EA',
      specs: `${elec.dcDisconnectAmps}A, 600VDC`,
    },
    {
      tag: 'AC-DISC-1',
      description: 'AC Disconnect Switch',
      manufacturer: 'Square D',
      model: 'DU222RB',
      quantity: 1,
      unit: 'EA',
      specs: `${elec.acBreakerAmps}A, 240VAC`,
    },
    {
      tag: 'COND-1',
      description: 'DC Conduit & Wire',
      manufacturer: 'Various',
      model: elec.dcConduitSize,
      quantity: 1,
      unit: 'LOT',
      specs: `${elec.dcWireGauge} THWN-2, ${elec.dcConduitSize}`,
    },
    {
      tag: 'COND-2',
      description: 'AC Conduit & Wire',
      manufacturer: 'Various',
      model: elec.acConduitSize,
      quantity: 1,
      unit: 'LOT',
      specs: `${elec.acWireGauge} THWN-2, ${elec.acConduitSize}`,
    },
  ];

  if (elec.rapidShutdownRequired) {
    electricalItems.push({
      tag: 'RSD-1',
      description: 'Rapid Shutdown Device',
      manufacturer: 'Tigo',
      model: 'TS4-A-2F',
      quantity: snap.panelCount,
      unit: 'EA',
      specs: 'NEC 690.12 compliant',
    });
  }

  const batteries: EquipmentLineItem[] = snap.batteries.map((bat, i) => ({
    tag: `BAT-${i + 1}`,
    description: 'Battery Energy Storage System',
    manufacturer: bat.manufacturer,
    model: bat.model,
    quantity: snap.batteryCount || 1,
    unit: 'EA',
    specs: `${bat.capacityKwh}kWh, ${bat.powerKw}kW, ${bat.chemistry}`,
  }));

  return { panels, inverters, mounting, electrical: electricalItems, batteries, other: [] };
}

// ── Panel Layout Data ─────────────────────────────────────────────────────────

function generatePanelLayout(snap: DesignSnapshot): PanelLayoutData {
  if (snap.panels.length === 0) {
    return {
      panels: [], roofSegments: [], setbackZones: [], firePathways: [],
      northArrow: 0, scale: '1:100', totalArea: 0, usableArea: 0,
    };
  }

  // Compute bounding box for normalization
  const lats = snap.panels.map(p => p.lat);
  const lngs = snap.panels.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;

  const panels: PanelLayoutItem[] = snap.panels.map(p => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    x: (p.lng - minLng) / lngRange,
    y: 1 - (p.lat - minLat) / latRange, // flip Y for drawing
    tilt: p.tilt,
    azimuth: p.azimuth,
    orientation: p.orientation || 'portrait',
    systemType: p.systemType || 'roof',
    row: p.row,
    col: p.col,
  }));

  // Roof segment layouts from segments
  const roofSegments = snap.roofSegments.map((seg, i) => ({
    id: seg.id,
    vertices: [],  // Would need actual polygon data
    azimuth: seg.azimuthDegrees,
    pitch: seg.pitchDegrees,
    label: `Roof ${String.fromCharCode(65 + i)} (${seg.azimuthDegrees}° az, ${seg.pitchDegrees}° pitch)`,
  }));

  // Setback zones
  const setbackZones = snap.systemType === 'roof' ? [
    { type: 'edge' as const, widthM: snap.edgeSetbackM, vertices: [] },
    { type: 'ridge' as const, widthM: snap.ridgeSetbackM, vertices: [] },
  ] : [];

  // Estimate total area
  const panelAreaM2 = snap.panel.width * snap.panel.height;
  const totalArea = parseFloat((snap.panelCount * panelAreaM2 * 1.3).toFixed(1)); // 30% for spacing
  const usableArea = parseFloat((snap.panelCount * panelAreaM2).toFixed(1));

  return {
    panels,
    roofSegments,
    setbackZones,
    firePathways: [],
    northArrow: 0,
    scale: '1:100',
    totalArea,
    usableArea,
  };
}

// ── Permit Package ────────────────────────────────────────────────────────────

function generatePermitPackage(
  snap: DesignSnapshot,
  elec: ElectricalEngineering,
  structural: StructuralEngineering
): PermitPackage {
  const requiredDocuments = [
    'Site Plan (roof layout with setbacks)',
    'Single Line Diagram (NEC compliant)',
    'Equipment Cut Sheets (panels, inverter, mounting)',
    'Structural Analysis (roof loading)',
    'Electrical Calculations',
    'Utility Interconnection Application',
  ];

  if (snap.batteries.length > 0) {
    requiredDocuments.push('Battery Storage System Documentation');
    requiredDocuments.push('Load Calculation for Battery Backup');
  }

  if (snap.systemType === 'ground') {
    requiredDocuments.push('Grading/Site Plan for Ground Mount');
    requiredDocuments.push('Foundation Engineering (if required)');
  }

  const specialConditions: string[] = [];
  if (structural.windSpeedMph > 130) {
    specialConditions.push(`High wind zone (${structural.windSpeedMph} mph) — enhanced attachment required`);
  }
  if (structural.groundSnowLoadPsf > 30) {
    specialConditions.push(`High snow load (${structural.groundSnowLoadPsf} psf) — structural engineer stamp may be required`);
  }
  if (elec.rapidShutdownRequired) {
    specialConditions.push('Rapid Shutdown required per NEC 690.12');
  }

  // Estimate permit fee (varies widely by AHJ)
  const estimatedPermitFee = Math.round(snap.systemSizeKw * 50 + 200);

  return {
    projectName: `Solar PV System — ${snap.address}`,
    projectAddress: snap.address,
    ahj: snap.ahj,
    utilityName: snap.utilityName,
    contractorName: 'Solar Contractor (TBD)',
    contractorLicense: 'License # (TBD)',
    systemSizeKw: snap.systemSizeKw,
    panelCount: snap.panelCount,
    panelModel: `${snap.panel.manufacturer} ${snap.panel.model}`,
    inverterModel: snap.inverter ? `${snap.inverter.manufacturer} ${snap.inverter.model}` : 'TBD',
    mountingSystem: snap.mounting?.name || 'IronRidge XR100',
    necVersion: elec.necVersion,
    interconnectionType: elec.interconnectionType,
    estimatedPermitFee,
    requiredDocuments,
    specialConditions,
    preparedDate: new Date().toISOString().split('T')[0],
  };
}

// ── Site Photos Section ────────────────────────────────────────────────────────────────────

/**
 * generateSitePhotosSection — builds the optional SitePhotosSection from an
 * EnrichedSiteSurvey's derived.photoCounts.
 *
 * Returns null when:
 *   - enrichedSurvey is null/undefined
 *   - No photos are present (total === 0)
 *
 * This keeps the report JSON clean when no photos have been ingested yet.
 * Never throws.
 */
function generateSitePhotosSection(
  enrichedSurvey: EnrichedSiteSurvey | null,
): SitePhotosSection | null {
  if (!enrichedSurvey) return null;

  const photoCounts = enrichedSurvey.derived?.photoCounts;
  if (!photoCounts || photoCounts.total === 0) return null;

  return {
    totalCount: photoCounts.total,
    categoryCounts: {
      roof:        photoCounts.roofCount,
      panel:       photoCounts.panelCount,
      meter:       photoCounts.meterCount,
      obstruction: photoCounts.obstructionCount,
      site:        photoCounts.siteCount,
      other:       photoCounts.otherCount,
    },
    hasRoofPhotos:        enrichedSurvey.derived.hasRoofPhotos,
    hasElectricalPhotos:  enrichedSurvey.derived.hasElectricalPhotos,
    hasObstructionPhotos: enrichedSurvey.derived.hasObstructionPhotos,
    note: `${photoCounts.total} site photo(s) available from field survey. See project_files for full-resolution images.`,
  };
}
