// ============================================================
// StringSystem — String Inverter Topology Engine
// DC strings, Voc/Isc temperature correction, DC OCPD.
// DO NOT MODIFY — this is the working string inverter logic.
// Isolated here to prevent micro topology contamination.
// ============================================================

// ── Types ─────────────────────────────────────────────────────────────────

export interface StringSystemInput {
  inverters: StringInverterInput[];
  mainPanelAmps: number;
  systemVoltage: number;
  designTempMin: number;      // °C
  designTempMax: number;      // °C
  rooftopTempAdder: number;   // °C (added for rooftop DC runs)
  wireLength: number;         // ft (AC run)
  conduitType: string;
  necVersion: string;
}

export interface StringInverterInput {
  type: 'string' | 'optimizer';
  acOutputKw: number;
  maxDcVoltage: number;
  mpptVoltageMin: number;
  mpptVoltageMax: number;
  maxInputCurrentPerMppt: number;
  maxShortCircuitCurrent?: number;
  acOutputCurrentMax: number;
  strings: StringInputData[];
}

export interface StringInputData {
  panelCount: number;
  panelVoc: number;           // V at STC
  panelIsc: number;           // A at STC
  panelImp: number;           // A at STC
  panelVmp: number;           // V at STC
  panelWatts: number;         // W
  tempCoeffVoc: number;       // %/°C (negative)
  tempCoeffIsc: number;       // %/°C (positive)
  maxSeriesFuseRating: number; // A
  wireGauge: string;
  wireLength: number;         // ft
  conduitType: string;
  manualOCPDOverride?: number;
  engineeringMode?: 'AUTO' | 'MANUAL';
}

export interface StringCalcResult {
  stringId: number;
  panelCount: number;
  vocCorrected: number;       // V (at min temp)
  iscCorrected: number;       // A (at max temp)
  maxCurrentNEC: number;      // A = Isc × 1.25
  ocpdRating: number;         // A
  wireGauge: string;
  dcWireResult: {
    conductorCallout: string;
    voltageDrop: number;
    effectiveAmpacity: number;
  };
}

export interface StringSystemResult {
  topologyType: 'STRING_INVERTER' | 'STRING_WITH_OPTIMIZER';
  // DC side — populated for string topology
  hasDCStrings: true;
  strings: StringCalcResult[];
  // AC side
  acWireGauge: string;
  acConductorCallout: string;
  acWireAmpacity: number;
  acVoltageDrop: number;
  groundingConductor: string;
  busbar: {
    backfeedBreakerRequired: number;
    busbarRule: string;
    maxAllowedBackfeed: number;
    passes: boolean;
  };
  conduitFill: {
    conduitSize: string;
    conduitType: string;
  };
  status: 'PASS' | 'WARNING' | 'FAIL';
  issues: StringIssue[];
  autoResolutions: AutoResolution[];
}

export interface StringIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  necReference?: string;
  suggestion?: string;
}

export interface AutoResolution {
  field: string;
  originalValue: string | number;
  resolvedValue: string | number;
  reason: string;
  necReference: string;
}

// ── Temperature Correction ────────────────────────────────────────────────

function correctVoc(voc: number, panelCount: number, tempCoeffVoc: number, tempMin: number): number {
  // NEC 690.7: Voc correction at minimum temperature
  // tempCoeffVoc is %/°C (negative value, e.g. -0.26)
  const deltaT = tempMin - 25; // delta from STC (25°C)
  const correctionFactor = 1 + (tempCoeffVoc / 100) * deltaT;
  return voc * panelCount * correctionFactor;
}

function correctIsc(isc: number, tempCoeffIsc: number, tempMax: number): number {
  // NEC 690.8: Isc correction at maximum temperature
  const deltaT = tempMax - 25;
  const correctionFactor = 1 + (tempCoeffIsc / 100) * deltaT;
  return isc * correctionFactor;
}

// ── OCPD Sizing ───────────────────────────────────────────────────────────

const STANDARD_BREAKER_SIZES = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125];

function nextStandardBreaker(amps: number): number {
  for (const size of STANDARD_BREAKER_SIZES) {
    if (size >= amps) return size;
  }
  return Math.ceil(amps / 5) * 5;
}

// ── DC Wire Sizing (NEC 310.15, USE-2/PV Wire) ────────────────────────────

const DC_CONDUCTOR_TABLE: Array<{ gauge: string; ampacity: number }> = [
  { gauge: '#14 AWG', ampacity: 20 },
  { gauge: '#12 AWG', ampacity: 25 },
  { gauge: '#10 AWG', ampacity: 30 },
  { gauge: '#8 AWG',  ampacity: 55 },
  { gauge: '#6 AWG',  ampacity: 75 },
  { gauge: '#4 AWG',  ampacity: 95 },
  { gauge: '#2 AWG',  ampacity: 130 },
];

function selectDCConductor(requiredAmpacity: number): { gauge: string; ampacity: number } {
  for (const row of DC_CONDUCTOR_TABLE) {
    if (row.ampacity >= requiredAmpacity) return row;
  }
  return DC_CONDUCTOR_TABLE[DC_CONDUCTOR_TABLE.length - 1];
}

// ── AC Wire Sizing (NEC 310.15, THWN-2 copper) ───────────────────────────

const AC_CONDUCTOR_TABLE: Array<{ gauge: string; ampacity: number }> = [
  { gauge: '#14 AWG', ampacity: 15 },
  { gauge: '#12 AWG', ampacity: 20 },
  { gauge: '#10 AWG', ampacity: 30 },
  { gauge: '#8 AWG',  ampacity: 50 },
  { gauge: '#6 AWG',  ampacity: 65 },
  { gauge: '#4 AWG',  ampacity: 85 },
  { gauge: '#3 AWG',  ampacity: 100 },
  { gauge: '#2 AWG',  ampacity: 115 },
  { gauge: '#1 AWG',  ampacity: 130 },
  { gauge: '#1/0 AWG', ampacity: 150 },
  { gauge: '#2/0 AWG', ampacity: 175 },
  { gauge: '#3/0 AWG', ampacity: 200 },
  { gauge: '#4/0 AWG', ampacity: 230 },
];

function selectACConductor(requiredAmpacity: number): { gauge: string; ampacity: number } {
  for (const row of AC_CONDUCTOR_TABLE) {
    if (row.ampacity >= requiredAmpacity) return row;
  }
  return AC_CONDUCTOR_TABLE[AC_CONDUCTOR_TABLE.length - 1];
}

// ── Voltage Drop ──────────────────────────────────────────────────────────

function calcVoltageDrop(
  current: number,
  length: number,
  gauge: string,
  voltage: number,
): number {
  // Resistance per 1000ft (copper, approximate)
  const resistanceTable: Record<string, number> = {
    '#14 AWG': 3.14, '#12 AWG': 1.98, '#10 AWG': 1.24,
    '#8 AWG': 0.778, '#6 AWG': 0.491, '#4 AWG': 0.308,
    '#3 AWG': 0.245, '#2 AWG': 0.194, '#1 AWG': 0.154,
    '#1/0 AWG': 0.122, '#2/0 AWG': 0.0967, '#3/0 AWG': 0.0766, '#4/0 AWG': 0.0608,
  };
  const r = resistanceTable[gauge] ?? 1.0;
  const vDrop = (2 * current * length * r) / 1000;
  return (vDrop / voltage) * 100; // percent
}

// ── Busbar Rule (NEC 705.12) ──────────────────────────────────────────────

function calcBusbar(
  mainPanelAmps: number,
  totalACOutputCurrentMax: number,
  systemVoltage: number,
): StringSystemResult['busbar'] {
  // 120% rule: backfeed breaker ≤ (busbar rating × 1.2) - main breaker
  const maxAllowedBackfeed = Math.floor(mainPanelAmps * 0.2);
  const backfeedBreakerRequired = nextStandardBreaker(totalACOutputCurrentMax * 1.25);
  const passes = backfeedBreakerRequired <= maxAllowedBackfeed;

  return {
    backfeedBreakerRequired,
    busbarRule: '120%',
    maxAllowedBackfeed,
    passes,
  };
}

// ── Grounding Conductor (NEC 250.122) ─────────────────────────────────────

function selectGroundingConductor(ocpdAmps: number): string {
  if (ocpdAmps <= 15) return '#14 AWG';
  if (ocpdAmps <= 20) return '#12 AWG';
  if (ocpdAmps <= 60) return '#10 AWG';
  if (ocpdAmps <= 100) return '#8 AWG';
  if (ocpdAmps <= 200) return '#6 AWG';
  return '#4 AWG';
}

// ── Main StringSystem Calculation ─────────────────────────────────────────

export function calcStringSystem(input: StringSystemInput): StringSystemResult {
  const issues: StringIssue[] = [];
  const autoResolutions: AutoResolution[] = [];
  const allStringResults: StringCalcResult[] = [];

  let totalACOutputCurrentMax = 0;

  for (const inv of input.inverters) {
    totalACOutputCurrentMax += inv.acOutputCurrentMax;

    let stringId = 0;
    for (const str of inv.strings) {
      stringId++;

      // ── Voc correction (NEC 690.7) ──────────────────────────────────────
      const vocCorrected = correctVoc(
        str.panelVoc,
        str.panelCount,
        str.tempCoeffVoc,
        input.designTempMin,
      );

      // ── Isc correction (NEC 690.8) ──────────────────────────────────────
      const iscCorrected = correctIsc(str.panelIsc, str.tempCoeffIsc, input.designTempMax);

      // ── Max current NEC 690.8(A)(1): Isc × 1.25 ────────────────────────
      const maxCurrentNEC = iscCorrected * 1.25;

      // ── OCPD sizing ─────────────────────────────────────────────────────
      let ocpdRating: number;
      if (str.engineeringMode === 'MANUAL' && str.manualOCPDOverride) {
        ocpdRating = str.manualOCPDOverride;
      } else {
        // NEC 690.9: OCPD ≥ maxCurrentNEC, ≤ maxSeriesFuseRating
        const minOCPD = maxCurrentNEC;
        const maxOCPD = str.maxSeriesFuseRating;
        ocpdRating = nextStandardBreaker(minOCPD);
        if (ocpdRating > maxOCPD) {
          ocpdRating = maxOCPD;
          autoResolutions.push({
            field: `string_${stringId}_ocpd`,
            originalValue: nextStandardBreaker(minOCPD),
            resolvedValue: maxOCPD,
            reason: `OCPD capped at module maxSeriesFuseRating (${maxOCPD}A)`,
            necReference: 'NEC 690.9',
          });
        }
      }

      // ── DC wire sizing ───────────────────────────────────────────────────
      const dcConductor = selectDCConductor(maxCurrentNEC);
      const dcVoltageDrop = calcVoltageDrop(
        iscCorrected,
        str.wireLength,
        dcConductor.gauge,
        vocCorrected,
      );

      // ── Voc check (NEC 690.7) ────────────────────────────────────────────
      if (vocCorrected > inv.maxDcVoltage) {
        issues.push({
          code: 'VOC_EXCEEDS_INVERTER',
          severity: 'error',
          message: `String ${stringId}: corrected Voc (${vocCorrected.toFixed(0)}V) exceeds inverter max DC voltage (${inv.maxDcVoltage}V)`,
          necReference: 'NEC 690.7',
          suggestion: `Reduce string length to ${Math.floor(inv.maxDcVoltage / str.panelVoc)} panels`,
        });
      }

      allStringResults.push({
        stringId,
        panelCount: str.panelCount,
        vocCorrected,
        iscCorrected,
        maxCurrentNEC,
        ocpdRating,
        wireGauge: dcConductor.gauge,
        dcWireResult: {
          conductorCallout: `2${dcConductor.gauge} USE-2/PV Wire in ${str.conduitType}`,
          voltageDrop: dcVoltageDrop,
          effectiveAmpacity: dcConductor.ampacity,
        },
      });
    }
  }

  // ── AC wire sizing ─────────────────────────────────────────────────────
  const acContinuousLoad = totalACOutputCurrentMax * 1.25;
  const acConductor = selectACConductor(acContinuousLoad);
  const acVoltageDrop = calcVoltageDrop(
    totalACOutputCurrentMax,
    input.wireLength,
    acConductor.gauge,
    input.systemVoltage,
  );

  // ── Busbar rule ────────────────────────────────────────────────────────
  const busbar = calcBusbar(input.mainPanelAmps, totalACOutputCurrentMax, input.systemVoltage);
  if (!busbar.passes) {
    issues.push({
      code: 'BUSBAR_120PCT_FAIL',
      severity: 'error',
      message: `Backfeed breaker (${busbar.backfeedBreakerRequired}A) exceeds 120% rule limit (${busbar.maxAllowedBackfeed}A) for ${input.mainPanelAmps}A panel`,
      necReference: 'NEC 705.12(B)(2)',
      suggestion: 'Upgrade main panel or use load-side connection with supply-side tap',
    });
  }

  // ── Grounding conductor ────────────────────────────────────────────────
  const groundingConductor = selectGroundingConductor(busbar.backfeedBreakerRequired);

  // ── Voltage drop warning ───────────────────────────────────────────────
  if (acVoltageDrop > 3) {
    issues.push({
      code: 'AC_VOLTAGE_DROP',
      severity: 'warning',
      message: `AC voltage drop (${acVoltageDrop.toFixed(2)}%) exceeds 3% recommendation`,
      necReference: 'NEC 210.19(A) Informational Note',
      suggestion: `Upsize to ${selectACConductor(acContinuousLoad * 1.1).gauge} or reduce run length`,
    });
  }

  // ── Status ────────────────────────────────────────────────────────────
  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');
  const status = hasErrors ? 'FAIL' : hasWarnings ? 'WARNING' : 'PASS';

  return {
    topologyType: 'STRING_INVERTER',
    hasDCStrings: true,
    strings: allStringResults,
    acWireGauge: acConductor.gauge,
    acConductorCallout: `2${acConductor.gauge} THWN-2 + 1${groundingConductor} GND in ${input.conduitType}`,
    acWireAmpacity: acConductor.ampacity,
    acVoltageDrop,
    groundingConductor,
    busbar,
    conduitFill: {
      conduitSize: acConductor.ampacity <= 30 ? '3/4"' : acConductor.ampacity <= 65 ? '1"' : '1-1/4"',
      conduitType: input.conduitType,
    },
    status,
    issues,
    autoResolutions,
  };
}