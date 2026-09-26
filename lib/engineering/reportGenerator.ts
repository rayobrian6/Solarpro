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
// ── The three authorities this file used to hand-roll ───────────────────────
// Conduit: real NEC Chapter 9 Table 4 areas + Table 1 fill limits, by conductor
// count — not a trade size read off an ampacity bracket.
import { conductorAreaIn2, selectSmallestConduit } from '@/lib/nec/chapter9';
// Interconnection: NEC 705.12(B)(2) takes the busbar AND the main breaker.
import { resolveInterconnectionMethod } from '@/lib/nec/rule705_12';
// Cold Voc: THE NEC 690.7(A) law — β when the module coefficient is known, the
// blanket ×1.25 only as a documented fallback.
import { coldVocFactor } from '@/lib/permit/utils/panelSpecs';
import { getThermalDesignBasis } from '@/lib/permit/utils/designTemps';

// NEC wire sizing tables (simplified).
//
// 🚨 THE `conduit` COLUMN IS DELETED ON PURPOSE. A conduit trade size cannot be
// read off an ampacity bracket: NEC Chapter 9 sizes a raceway from the SUM OF THE
// CONDUCTOR AREAS (Table 5 / Table 4) against a fill limit that depends on the
// CONDUCTOR COUNT (Table 1 — 53 % for one, 31 % for two, 40 % for three or more).
// None of those three inputs is a function of amps, so the column was a guess that
// happened to be printed on an equipment schedule and bought.
//
// The AC side over-bought one trade size. The DC side was the unsafe one: a
// ≥5-string design got 3/4" EMT at 43.5 % fill against the 40 % limit.
//
// Conduit is now computed in generateElectricalEngineering from the real bundle.
// Do NOT reintroduce a conduit column here — a second answer to this question is
// how the two surfaces came to disagree in the first place.
const DC_WIRE_SIZING: { maxAmps: number; gauge: string }[] = [
  { maxAmps: 20,  gauge: '#12 AWG'  },
  { maxAmps: 30,  gauge: '#10 AWG'  },
  { maxAmps: 40,  gauge: '#8 AWG'   },
  { maxAmps: 55,  gauge: '#6 AWG'   },
  { maxAmps: 70,  gauge: '#4 AWG'   },
  { maxAmps: 85,  gauge: '#3 AWG'   },
  { maxAmps: 95,  gauge: '#2 AWG'   },
  { maxAmps: 130, gauge: '#1 AWG'   },
  { maxAmps: 150, gauge: '#1/0 AWG' },
];

const AC_WIRE_SIZING: { maxAmps: number; gauge: string }[] = [
  { maxAmps: 20,  gauge: '#12 AWG'  },
  { maxAmps: 30,  gauge: '#10 AWG'  },
  { maxAmps: 40,  gauge: '#8 AWG'   },
  { maxAmps: 55,  gauge: '#6 AWG'   },
  { maxAmps: 70,  gauge: '#4 AWG'   },
  { maxAmps: 95,  gauge: '#2 AWG'   },
  { maxAmps: 130, gauge: '#1/0 AWG' },
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

function selectWire(amps: number, table: typeof DC_WIRE_SIZING): { gauge: string } {
  // NEC 690.8: multiply by 1.25 for continuous load
  const designAmps = amps * 1.25;
  for (const entry of table) {
    if (designAmps <= entry.maxAmps) return { gauge: entry.gauge };
  }
  return { gauge: '#2/0 AWG' };
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
  /** NEC 690.7(A)-corrected cold Voc for the string — the value the inverter's
   *  maximum DC input voltage is actually tested against. Defaults to the STC sum
   *  for micro topology, where there is no series string. */
  let stringVocCorrected = panelVoc;
  let stringVmp = panelVmp;
  let stringIsc = panelIsc;

  if (!isMicro) {
    // String inverter: calculate optimal string length
    // Error 5h fix: maxDcVoltage/mpptVoltageMax now on Inverter type — remove `as any` casts
    const maxDcVoltage = inverter?.maxDcVoltage || 600;
    const mpptVoltageMax = inverter?.mpptVoltageMax || 550;
    const mpptChannels = inverter?.mpptChannels || 2;

    // Max panels per string, NEC 690.7(A): corrected cold Voc × n ≤ maxDcVoltage.
    //
    // 🚨 This was `Math.floor(maxDcVoltage / (panelVoc * 1.25))` with a hard
    // `Math.min(…, 20)`. The blanket ×1.25 is Table 690.7(A)'s most conservative
    // row (−1 to −5 °C); it ignores the module's own temperature coefficient and
    // the site entirely. Because this function SETS panelsPerString, stringCount,
    // dcWireGauge, stringFuseAmps and dcDisconnectAmps on the stored engineering
    // report, the effect is over-restrictive for warm sites: a Florida job
    // (designTemps FL −2 °C, real factor ≈1.07) was capped as if it were at
    // −38 °C, so the report recommended shorter strings and therefore MORE
    // strings, more MPPT channels and sometimes another inverter than the design
    // needs — a price the customer pays.
    //
    // `coldVocFactor` is the one law (lib/permit/utils/panelSpecs.ts): β-based when
    // the coefficient resolves, the blanket ×1.25 only as a documented fallback.
    const _thermal = getThermalDesignBasis({ state: snap.stateCode ?? null });
    const _tempCoeffVoc = (panel as { tempCoeffVoc?: number })?.tempCoeffVoc;
    const _coldFactor = coldVocFactor(_tempCoeffVoc, _thermal.minDesignTempC);
    const _correctedPanelVoc = panelVoc * _coldFactor;

    // The 20-panel ceiling belongs to the inverter, not to a literal. Use the
    // record's own limit when it states one; otherwise no artificial ceiling —
    // the voltage rule above is the real constraint.
    const _inverterMaxPerString = Number(
      (inverter as { maxPanelsPerString?: number })?.maxPanelsPerString,
    ) || Infinity;

    const necMaxPerString = Math.max(1, Math.min(
      Math.floor(maxDcVoltage / _correctedPanelVoc),
      _inverterMaxPerString,
    ));
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
    // 🚨 `stringVoc` is the STC sum, and the report labels it "DC Voltage" — so a
    // reader checking headroom against a 600 V inverter saw 496 V for a string
    // whose real NEC 690.7(A) design maximum is 563 V. Both are now carried:
    // `stringVoc` stays the STC value the datasheet states, and
    // `stringVocCorrected` is the number the code limit is actually tested against.
    stringVoc = panelVoc * panelsPerString;
    stringVocCorrected = _correctedPanelVoc * panelsPerString;
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

  // ── Conduit trade size — NEC Chapter 9, not an ampacity bracket ────────────
  // 🚨 `dcConduitSize`/`acConduitSize` used to come from a `conduit` column on the
  // same wire-gauge bracket tables: no conductor area, no fill percentage, no
  // conductor count. These two fields reach the EQUIPMENT SCHEDULE — where the
  // trade size IS the line item's model and specs, i.e. the conduit a crew orders —
  // the rendered SLD wire label, the saved engineering artifact, and the
  // customer-visible Engineering tab.
  //
  // The AC side over-bought one trade size (cost, not safety). THE DC SIDE WAS THE
  // UNSAFE ONE: a ≥5-string design got 3/4" EMT printed and scheduled at 43.5 %
  // fill against Chapter 9 Table 1's 40 % limit, and nothing downstream could catch
  // it because the number never passed through a fill calculation at all.
  //
  // Build the real bundle and ask the real table. DC: two current-carrying
  // conductors per string plus one EGC. AC 1Ø240 V: two hots, a neutral and an EGC.
  const conduitType = 'EMT';
  const bundleArea = (gauge: string, count: number): number | null => {
    const a = conductorAreaIn2(gauge);
    return a === null ? null : a * count;
  };
  const dcConductorCount = Math.max(2, (stringCount || 1) * 2) + 1;
  const acConductorCount = 4;
  const dcArea = bundleArea(dcWire.gauge, dcConductorCount);
  const acArea = bundleArea(acWire.gauge, acConductorCount);
  const dcConduit = dcArea === null ? null : selectSmallestConduit(conduitType, dcArea, dcConductorCount);
  const acConduit = acArea === null ? null : selectSmallestConduit(conduitType, acArea, acConductorCount);
  // 🚨 'PENDING', never a fabricated trade size. The old print fallbacks
  // (`?? '3/4" EMT'` / `?? '1" EMT'` in artifactBuilders and save-outputs) are
  // arbitrary sizes, not what the surrounding logic would choose, and they drew on
  // the SLD when the engine had produced nothing. An unestablished raceway must not
  // be drawable as a real one.
  const dcConduitSize = dcConduit ? `${dcConduit.tradeSize} ${conduitType}` : 'PENDING';
  const acConduitSize = acConduit ? `${acConduit.tradeSize} ${conduitType}` : 'PENDING';

  // Breaker sizing (NEC 705.12: 125% of inverter output)
  const acBreakerAmps = necNextStandardOcpd(acAmps * 1.25);
  const backfeedBreakerAmps = acBreakerAmps;

  // Main panel bus check (NEC 705.12(B)).
  // 🚨 No `?? 200`. The 120% rule needs the busbar AND the main breaker, and an
  // invented service size used to produce a stated conclusion about the SCOPE OF
  // WORK — see lib/nec/rule705_12.ts. `null` means not established.
  const mainPanelBusAmps: number | null = pd?.panel_rating_amps ?? null;
  // project_physical_data has no main-breaker column today, so this is normally
  // null and the rule reports 'unresolved'. Read through an optional field so a
  // survey that gains one is consumed without another edit here.
  const mainBreakerAmps: number | null =
    (pd as { main_breaker_amps?: number } | null)?.main_breaker_amps ?? null;

  // Rapid shutdown (NEC 690.12)
  const rapidShutdownRequired = snap.systemType === 'roof';

  // Interconnection type — ONE authority, NEC 705.12(B)(2).
  // 🚨 This was `backfeedBreakerAmps <= mainPanelBusAmps * 0.2`, with a single
  // field standing in for both the busbar and the main breaker, and a fabricated
  // 200 A busbar when the survey was silent. `× 0.2` is not a rule the NEC states.
  // And 'supply-side' is not a label: SUPPLY_SIDE_TAP deletes the backfed breaker
  // from the BOM and adds three insulated multi-tap connectors plus a fused AC
  // disconnect that must BE the OCPD, under a 705.11(C) ≤10 ft placement
  // constraint. A derated-main service was being quoted and drawn for a
  // utility-coordinated line-side tap it does not need.
  const _interconnection = resolveInterconnectionMethod({
    surveyedPoint: pd?.interconnection_point ?? null,
    busRatingA: mainPanelBusAmps,
    mainBreakerA: mainBreakerAmps,
    backfeedBreakerA: backfeedBreakerAmps,
  });
  const interconnectionType = _interconnection.side;

  const necVersion = getNecVersion(snap.stateCode);
  const complianceNotes: string[] = [
    `NEC ${necVersion} compliance required`,
    `NEC 690.12 Rapid Shutdown: ${rapidShutdownRequired ? 'Required' : 'Not Required'}`,
    mainPanelBusAmps != null
      ? `NEC 705.12(B) Bus Loading: ${backfeedBreakerAmps}A backfeed on ${mainPanelBusAmps}A bus`
      : `NEC 705.12(B) Bus Loading: ${backfeedBreakerAmps}A backfeed — bus rating NOT ESTABLISHED`,
    `NEC 690.8 Wire Sizing: DC ${dcWire.gauge}, AC ${acWire.gauge}`,
    // The interconnection conclusion, or the reason there isn't one. The report
    // already has this channel, so an unresolved rule states itself instead of
    // being silently replaced by a derivation from an assumed service size.
    `NEC 705.12 Interconnection: ${_interconnection.basis}`,
    `NEC Ch.9 Conduit: DC ${dcConduitSize} (${dcConductorCount} conductors), `
      + `AC ${acConduitSize} (${acConductorCount} conductors)`,
  ];

  if (isMicro) {
    complianceNotes.push('Microinverter system: AC trunk cable sizing per NEC 690.8(B)');
  }
  if (interconnectionType === 'unresolved') {
    complianceNotes.push(
      'ACTION REQUIRED: interconnection method cannot be determined without the '
      + 'main service panel busbar rating AND main breaker rating. Capture both on '
      + 'the site survey — the scope of work (backfed breaker vs supply-side tap) '
      + 'depends on it.',
    );
  }

  return {
    dcSystemSizeKw: snap.systemSizeKw,
    dcVoltage: isMicro ? panelVoc : stringVoc,
    stringCount,
    panelsPerString,
    stringVoc: parseFloat(stringVoc.toFixed(1)),
    // The NEC 690.7(A) maximum the inverter limit is tested against — what a reader
    // checking headroom needs, and NOT the same number as the STC sum above.
    stringVocCorrected: parseFloat(stringVocCorrected.toFixed(1)),
    stringVmp: parseFloat(stringVmp.toFixed(1)),
    stringIsc: parseFloat(stringIsc.toFixed(2)),
    acSystemSizeKw: acOutputKw,
    acVoltage,
    acFrequency: 60,
    dcWireGauge: dcWire.gauge,
    dcConduitSize,
    acWireGauge: acWire.gauge,
    acConduitSize,
    groundWireGauge: '#8 AWG',
    stringFuseAmps: necNextStandardOcpd(panelIsc * 1.56),
    dcDisconnectAmps: necNextStandardOcpd(dcDesignAmps),
    acBreakerAmps,
    mainPanelBusAmps,
    backfeedBreakerAmps,
    interconnectionType,
    interconnectionMethod:
      interconnectionType === 'load-side'  ? 'Backfeed Breaker' :
      interconnectionType === 'supply-side' ? 'Supply-Side Tap'  :
      'UNRESOLVED — survey required',
    rapidShutdownRequired,
    rapidShutdownDevice: rapidShutdownRequired ? 'Tigo TS4-A-2F' : 'N/A',
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
