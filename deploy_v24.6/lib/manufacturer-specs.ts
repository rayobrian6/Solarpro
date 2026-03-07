// ============================================================
// Manufacturer Specification Lookup Layer
// Typed helpers for deterministic engineering calculations
// All data sourced from equipment-db.ts — no hardcoded fallbacks
// ============================================================

import {
  SOLAR_PANELS,
  STRING_INVERTERS,
  MICROINVERTERS,
  CONDUCTORS,
  CONDUITS,
  SolarPanel,
  StringInverter,
  Microinverter,
  Conductor,
  Conduit,
} from './equipment-db';

// ─── Panel Spec Lookup ────────────────────────────────────────────────────────

export function getPanelSpec(panelId: string): SolarPanel | null {
  return SOLAR_PANELS.find(p => p.id === panelId) ?? null;
}

export function getPanelSpecOrThrow(panelId: string): SolarPanel {
  const p = SOLAR_PANELS.find(p => p.id === panelId);
  if (!p) throw new Error(`Panel spec not found: ${panelId}`);
  return p;
}

// ─── Inverter Spec Lookup ─────────────────────────────────────────────────────

export function getStringInverterSpec(inverterId: string): StringInverter | null {
  return STRING_INVERTERS.find(i => i.id === inverterId) ?? null;
}

export function getMicroinverterSpec(inverterId: string): Microinverter | null {
  return MICROINVERTERS.find(i => i.id === inverterId) ?? null;
}

export function getInverterSpecOrThrow(inverterId: string, type: 'string' | 'micro' | 'optimizer'): StringInverter | Microinverter {
  if (type === 'micro') {
    const m = MICROINVERTERS.find(i => i.id === inverterId);
    if (!m) throw new Error(`Microinverter spec not found: ${inverterId}`);
    return m;
  }
  const s = STRING_INVERTERS.find(i => i.id === inverterId);
  if (!s) throw new Error(`String inverter spec not found: ${inverterId}`);
  return s;
}

// ─── Conductor Lookup ─────────────────────────────────────────────────────────

// AWG order from smallest to largest (for auto-sizing iteration)
export const AWG_ORDER: string[] = [
  '#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG',
  '#4 AWG', '#2 AWG', '#1 AWG', '#1/0 AWG', '#2/0 AWG',
];

export function getConductorSpec(gauge: string): Conductor | null {
  return CONDUCTORS.find(c => c.gauge === gauge) ?? null;
}

export function getNextLargerGauge(currentGauge: string): string | null {
  const idx = AWG_ORDER.indexOf(currentGauge);
  if (idx === -1 || idx >= AWG_ORDER.length - 1) return null;
  return AWG_ORDER[idx + 1];
}

export function getConductorByMinAmpacity(
  requiredAmpacity: number,
  ratingColumn: '60c' | '75c' | '90c' = '75c'
): Conductor | null {
  const col = `ampacity_${ratingColumn}` as keyof Conductor;
  // AWG_ORDER is smallest to largest — find first that meets requirement
  for (const gauge of AWG_ORDER) {
    const cond = CONDUCTORS.find(c => c.gauge === gauge);
    if (cond && (cond[col] as number) >= requiredAmpacity) return cond;
  }
  return null;
}

// ─── Conduit Lookup ───────────────────────────────────────────────────────────

export function getSmallestConduit(
  conduitType: string,
  totalFillAreaSqIn: number
): Conduit | null {
  const matching = CONDUITS
    .filter(c => c.type === conduitType && c.maxFillArea_3plus >= totalFillAreaSqIn)
    .sort((a, b) => a.innerDiameter - b.innerDiameter);
  return matching[0] ?? null;
}

// ─── NEC Standard OCPD Sizes ─────────────────────────────────────────────────

export const STANDARD_OCPD_SIZES = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90,
  100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400,
];

export function nextStandardOCPD(amps: number): number {
  return STANDARD_OCPD_SIZES.find(s => s >= amps) ?? Math.ceil(amps / 10) * 10;
}

// ─── Temperature Derating (NEC Table 310.15(B)(2)(a)) ────────────────────────
// Based on 90°C rated conductors, 30°C ambient base

export function getTempDeratingFactor(ambientTempC: number): number {
  if (ambientTempC <= 30) return 1.00;
  if (ambientTempC <= 35) return 0.96;
  if (ambientTempC <= 40) return 0.91;
  if (ambientTempC <= 45) return 0.87;
  if (ambientTempC <= 50) return 0.82;
  if (ambientTempC <= 55) return 0.76;
  if (ambientTempC <= 60) return 0.71;
  if (ambientTempC <= 65) return 0.65;
  if (ambientTempC <= 70) return 0.58;
  if (ambientTempC <= 75) return 0.50;
  return 0.41;
}

// ─── Conduit Fill Derating (NEC 310.15(C)(1)) ────────────────────────────────

export function getConduitFillDeratingFactor(currentCarryingConductors: number): number {
  if (currentCarryingConductors <= 3) return 1.00;
  if (currentCarryingConductors <= 6) return 0.80;
  if (currentCarryingConductors <= 9) return 0.70;
  if (currentCarryingConductors <= 20) return 0.50;
  if (currentCarryingConductors <= 30) return 0.45;
  if (currentCarryingConductors <= 40) return 0.40;
  return 0.35;
}

// ─── Grounding Conductor Sizing (NEC Table 250.122) ──────────────────────────

export function getEGCSize(ocpdAmps: number): string {
  if (ocpdAmps <= 15)  return '#14 AWG';
  if (ocpdAmps <= 20)  return '#12 AWG';
  if (ocpdAmps <= 60)  return '#10 AWG';
  if (ocpdAmps <= 100) return '#8 AWG';
  if (ocpdAmps <= 200) return '#6 AWG';
  if (ocpdAmps <= 300) return '#4 AWG';
  if (ocpdAmps <= 400) return '#3 AWG';
  if (ocpdAmps <= 500) return '#2 AWG';
  if (ocpdAmps <= 600) return '#1 AWG';
  return '#1/0 AWG';
}

// ─── Voltage Drop Calculation ─────────────────────────────────────────────────
// Returns voltage drop as a percentage
// VD% = (2 × I × R × L) / (V × 1000) × 100
// R = DC resistance in ohms/1000ft

export function calcVoltageDrop(
  currentAmps: number,
  onewayLengthFt: number,
  gauge: string,
  systemVoltage: number
): number {
  const cond = getConductorSpec(gauge);
  if (!cond) return 0;
  const vd = (2 * currentAmps * cond.dcResistance * onewayLengthFt) / 1000;
  return (vd / systemVoltage) * 100;
}

// ─── String Voc Temperature Correction (NEC 690.7) ───────────────────────────

export function calcStringVocCorrected(
  panelVoc: number,
  panelCount: number,
  tempCoeffVocPctPerC: number, // negative value e.g. -0.27
  designTempMinC: number
): number {
  // ΔV = Voc_STC × (tempCoeff/100) × (Tmin - 25)
  const tempDelta = designTempMinC - 25; // negative when cold
  const correctionFactor = 1 + (tempCoeffVocPctPerC / 100) * tempDelta;
  return panelVoc * panelCount * correctionFactor;
}

// ─── String Isc Temperature Correction (NEC 690.8) ───────────────────────────

export function calcStringIscCorrected(
  panelIsc: number,
  tempCoeffIscPctPerC: number, // positive value e.g. 0.05
  designTempMaxC: number,
  rooftopTempAdderC: number
): number {
  const hotTemp = designTempMaxC + rooftopTempAdderC;
  const correctionFactor = 1 + (tempCoeffIscPctPerC / 100) * (hotTemp - 25);
  return panelIsc * correctionFactor;
}

// ─── Conductor Wire Area (for conduit fill) ───────────────────────────────────

export function getConductorArea(gauge: string): number {
  const cond = getConductorSpec(gauge);
  if (!cond) return 0;
  return Math.PI * Math.pow(cond.outerDiameter / 2, 2);
}