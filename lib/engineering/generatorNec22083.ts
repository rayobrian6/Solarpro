// NEC 2023 Article 220, Part IV — Optional Method for Existing Dwelling Units.
//
// This is the load calc code-compliant electricians and inspectors use. It
// produces a SERVICE/FEEDER size (not a generator size directly). To convert
// to generator size: apply the 80% rule (× 1.25, per Generac / NEC 700/701/702).
//
// Inputs are intentionally minimal — sq ft + the major fixed appliances
// that drive residential demand. Defaults are NEC 2023 §220 values.
//
// Result is intentionally a CONSERVATIVE THEORETICAL MAX. Real homes draw
// less. The BILL method (utility peak demand × 1.25) is the empirical truth.
//
// --- Boundary vs. other NEC 220 demand calcs in this codebase ---
//
// This file implements NEC 220.83 OPTIONAL METHOD (the 3-3000-120k formula:
// first 3 kVA @ 100%, next 117 kVA @ 35%, balance @ 25%). It is used ONLY
// by the standby-generator sizing flow (grafted with the Generator
// Estimator tool) to recommend a generator kW rating — that is why we
// expose `recommendedKw` (totalVa × 1.25) directly.
//
// `lib/permit/sections/electricalPages.ts` is a separate, INLINE NEC 220
// computation rendered into the permit doc. It implements NEC 220.82
// STANDARD METHOD (first 10 kVA @ 100%, remainder @ 40%) — note its HTML
// label currently says "Optional Method" but the formula is actually the
// Standard Method; that label discrepancy is a pre-existing doc issue
// outside this commit's scope (flagged to PM).
//
// These two calcs coexist by design:
//   - generatorNec22083.ts (Optional Method) -> generator kW
//   - electricalPages.ts  (Standard Method)  -> service/feeder rating in the
//                                              permit document
// They are not interchangeable. Do not unify without first deciding which
// NEC method each downstream consumer actually wants.

export type HeatingType = "gas" | "electric-resistance" | "heat-pump" | "none";

export type Nec220_83Input = {
  squareFeet: number;
  /** Heating system — drives heating load (larger of heat/cool per 220.60). */
  heatingType: HeatingType;
  /** Heating watts (nameplate) for the chosen system. */
  heatingWatts: number;
  /** AC cooling running watts. */
  coolingWatts: number;
  /** AC compressor starting watts — added at 25% (NEC 220.50/220.60). */
  largestMotorStartingWatts: number;
  /** Electric range nameplate watts (0 if gas). */
  rangeWatts: number;
  /** Electric dryer nameplate watts (0 if gas). */
  dryerWatts: number;
  /** Electric water heater nameplate watts (0 if gas/tankless-gas). */
  waterHeaterWatts: number;
  /** Other fixed appliances — dishwasher, disposal, microwave, etc. */
  fixedAppliances: Array<{ name: string; watts: number }>;
  /** Small-appliance branch circuits (NEC 220.52 minimum 2). */
  smallApplianceCircuits?: number;
  /** Laundry branch circuits (NEC 220.52 minimum 1). */
  laundryCircuits?: number;
};

export type Nec220_83Result = {
  /** Total calculated load in VA (service/feeder size per NEC). */
  totalVa: number;
  /** Service/feeder amps at 240V single phase. */
  totalAmps: number;
  /** Recommended standby generator size in kW (NEC load × 1.25 for 80% rule). */
  recommendedKw: number;
  /** Breakdown of the load components (in VA, after demand factors). */
  breakdown: {
    generalLightingAfterDemand: number;
    smallApplianceAfterDemand: number;
    laundryAfterDemand: number;
    range: number;
    dryer: number;
    waterHeater: number;
    fixedAppliances: number;
    heatingOrCooling: number;
    largestMotor25pct: number;
  };
};

const VOLTAGE = 240;
const GENERATOR_SAFETY_FACTOR = 1.25; // Generac 80% rule

// NEC 220.83 demand factors for general lighting + small appliance + laundry
function apply220_83Demand(va: number): number {
  if (va <= 3000) return va;
  if (va <= 120_000) return 3000 + (va - 3000) * 0.35;
  return 3000 + 117_000 * 0.35 + (va - 120_000) * 0.25;
}

// NEC Table 220.55 — demand factors for electric ranges (Optional Method).
// Col B: ranges 8-12 kW → 80% of nameplate. Below 8 kW, use nameplate.
function rangeDemand(watts: number): number {
  if (watts <= 0) return 0;
  if (watts < 8000) return watts;
  if (watts <= 12_000) return watts * 0.8;
  // Larger ranges use Table 220.55 col C/D; for MVP, apply 0.8 conservatively.
  return watts * 0.8;
}

// NEC 220.54 — dryer demand (Optional Method is 25% of nameplate, min 5000 VA).
function dryerDemand(watts: number): number {
  if (watts <= 0) return 0;
  return Math.max(5000, watts) * 0.25;
}

// NEC 220.53 — fixed appliances: 75% if 4 or more, else 100%.
function fixedApplianceDemand(watts: number, count: number): number {
  if (count === 0) return 0;
  const factor = count >= 4 ? 0.75 : 1.0;
  return watts * factor;
}

export function calculateNec220_83(input: Nec220_83Input): Nec220_83Result {
  const smallApplianceCircuits = input.smallApplianceCircuits ?? 2;
  const laundryCircuits = input.laundryCircuits ?? 1;

  // 1) General lighting + general-use receptacles: 3 VA/sq ft (NEC 220.12, 220.42)
  const generalLightingVa = input.squareFeet * 3;
  const generalLightingDemand = apply220_83Demand(generalLightingVa);

  // 2) Small-appliance circuits: 1500 VA each (NEC 220.52). Already demand-factored
  //    via the 220.83 table — the 3-3000-120k formula covers them.
  const smallApplianceTotal = smallApplianceCircuits * 1500;
  const smallApplianceDemand = apply220_83Demand(smallApplianceTotal);

  // 3) Laundry: 1500 VA per circuit
  const laundryTotal = laundryCircuits * 1500;
  const laundryDemand = apply220_83Demand(laundryTotal);

  // 4) Specific appliance loads (added separately, with their own demand factors)
  const range = rangeDemand(input.rangeWatts);
  const dryer = dryerDemand(input.dryerWatts);
  const waterHeater = input.waterHeaterWatts > 0 ? input.waterHeaterWatts : 0;

  const fixedWatts = input.fixedAppliances.reduce((s, a) => s + a.watts, 0);
  const fixedAppliances = fixedApplianceDemand(fixedWatts, input.fixedAppliances.length);

  // 5) Heating vs cooling — non-coincident (220.60): pick the larger
  const heatingOrCooling = Math.max(input.heatingWatts, input.coolingWatts);

  // 6) Largest motor at 25% (220.50, 220.60)
  const largestMotor25pct = input.largestMotorStartingWatts * 0.25;

  const totalVa =
    generalLightingDemand +
    smallApplianceDemand +
    laundryDemand +
    range +
    dryer +
    waterHeater +
    fixedAppliances +
    heatingOrCooling +
    largestMotor25pct;

  const totalAmps = totalVa / VOLTAGE;
  const recommendedKw = Math.ceil((totalVa * GENERATOR_SAFETY_FACTOR) / 1000);

  return {
    totalVa: Math.round(totalVa),
    totalAmps: Math.round(totalAmps),
    recommendedKw,
    breakdown: {
      generalLightingAfterDemand: Math.round(generalLightingDemand),
      smallApplianceAfterDemand: Math.round(smallApplianceDemand),
      laundryAfterDemand: Math.round(laundryDemand),
      range: Math.round(range),
      dryer: Math.round(dryer),
      waterHeater: Math.round(waterHeater),
      fixedAppliances: Math.round(fixedAppliances),
      heatingOrCooling: Math.round(heatingOrCooling),
      largestMotor25pct: Math.round(largestMotor25pct),
    },
  };
}
