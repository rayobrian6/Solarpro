// ═══════════════════════════════════════════════════════════════════════════
// W3 §6 — Fence wind / overturning / embedment engine.
// RELOCATED VERBATIM out of lib/permit/sections/structuralPages.ts
// (pageStructuralFence, formerly lines ~149-186) so the renderer no longer
// carries load math. The math is UNCHANGED (ASCE 7-22 §29.4 velocity pressure →
// force coefficient → per-post lateral force → overturning moment → Broms-style
// required embedment). The renderer now PROJECTS this result; the snapshot
// carries the resulting StructuralCheck (fence-overturning) so PV-4C / PE-1 /
// CERT all print the SAME acceptance rule.
//
// Constants that were sheet literals (Kz, Kzt, Kd, Cf, post width) are ASCE
// table values documented at their source here — a single engine owns them.
// ═══════════════════════════════════════════════════════════════════════════

export interface FenceWindInput {
  windSpeedMph: number;       // design (ultimate) wind speed
  exposure: string;           // exposure category (display / basis)
  panelHeightFt: number;      // vertical fence panel height
  postSpacingFt: number;      // post spacing O.C.
  postEmbedFt: number;        // provided embedment
  soilResistancePsf: number;  // passive soil resistance
  groundSnowPsf: number;      // ground snow (display only for fence)
  /** minimum overturning safety factor (acceptance bar). ASCE 7-22 §12.13. */
  minOverturningSF?: number;
}

export interface FenceWindResult {
  // ASCE coefficients (documented at source — no longer sheet literals)
  Kz: number; Kzt: number; Kd: number; Cf: number;
  velocityPressurePsf: number;   // qz
  netWindPressurePsf: number;    // p = qz·Cf
  panelAreaFt2: number;          // tributary area per post
  lateralForcePerPostLbs: number;
  overturningMomentFtLbs: number;
  postWidthFt: number;
  requiredEmbedmentFt: number;
  providedEmbedmentFt: number;
  overturningSafetyFactor: number;   // provided / required embedment ratio
  minOverturningSF: number;
  passes: boolean;
}

// ASCE 7-22 documented coefficients (exposure C, z=10ft, flat terrain, solid
// fence panel). These were inline literals in the renderer; they live here now.
const KZ = 0.85;    // Table 26.10-1 (exposure C, z = 10 ft)
const KZT = 1.0;    // flat terrain (topographic factor)
const KD = 0.85;    // Table 26.6-1 (wind directionality)
const CF = 1.3;     // Fig. 29.4-1 (solid fence panel force coefficient)
const POST_WIDTH_FT = 0.25;   // 3" HSS assumed post width
const MIN_OVERTURNING_SF = 1.5;   // ASCE 7-22 §12.13 overturning

export function analyzeFenceWind(inp: FenceWindInput): FenceWindResult {
  const V = inp.windSpeedMph;
  const qz = 0.00256 * KZ * KZT * KD * V * V;   // velocity pressure (psf)
  const p = qz * CF;                             // net wind pressure (psf)
  const panelArea = inp.panelHeightFt * inp.postSpacingFt;      // ft²
  const lateralForce = p * panelArea;                          // lbs at post
  const overturnMoment = lateralForce * (inp.panelHeightFt / 2); // ft-lbs at grade
  // Broms-style required embedment: D_req ≈ 1.5 · ∛(M / (q_soil · b))
  const reqEmbed = 1.5 * Math.pow(overturnMoment / (inp.soilResistancePsf * POST_WIDTH_FT), 1 / 3);
  const sf = inp.postEmbedFt / Math.max(reqEmbed, 0.001);
  const minSF = inp.minOverturningSF ?? MIN_OVERTURNING_SF;
  return {
    Kz: KZ, Kzt: KZT, Kd: KD, Cf: CF,
    velocityPressurePsf: qz,
    netWindPressurePsf: p,
    panelAreaFt2: panelArea,
    lateralForcePerPostLbs: lateralForce,
    overturningMomentFtLbs: overturnMoment,
    postWidthFt: POST_WIDTH_FT,
    requiredEmbedmentFt: reqEmbed,
    providedEmbedmentFt: inp.postEmbedFt,
    overturningSafetyFactor: sf,
    minOverturningSF: minSF,
    // acceptance: provided embedment ≥ required (embedment ratio is the SF)
    passes: inp.postEmbedFt >= reqEmbed,
  };
}
