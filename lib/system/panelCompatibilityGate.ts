// ════════════════════════════════════════════════════════════════════════════
// Panel ↔ Brand Compatibility Gate
// lib/system/panelCompatibilityGate.ts
//
// v47.423 — Brand-Agnostic Panel Auto-Swap.
//
// PURPOSE
//   Before inverter sizing runs, evaluate whether the currently-loaded solar
//   panel is electrically compatible with the user's selected brand ecosystem.
//   When a panel's NEC 690.8(A)(1) design current (Isc × 1.25) exceeds the
//   brand's strictest per-MPPT input-current cap, the design is infeasible
//   regardless of how strings get distributed.
//
//   Rather than surface "MPPT_CURRENT_EXCEEDED" error walls downstream, this
//   gate detects the incompatibility *up front* and tells the caller to
//   either (a) auto-swap to a compatible panel, or (b) flag a marginal pair.
//
// TIERED STATUS
//   • incompatible — designCurrent > brand.effectiveMaxInputCurrentPerMppt
//       → caller should auto-swap panel (UI shows "Panel auto-switched" banner)
//   • marginal     — designCurrent ≤ cap but headroom < MARGINAL_THRESHOLD
//       → caller should warn (UI shows yellow chip); no auto-swap
//   • compatible   — headroom ≥ MARGINAL_THRESHOLD
//       → no action; silent pass
//   • unknown      — cap cannot be determined from the brand's supported
//       models (empty list, unresolvable ids). No action. Fail-open.
//
// BRAND-AGNOSTIC
//   Works for every current and future brand. The gate scans
//   brand.supportedInverterModels, resolves each equipmentDbId against the
//   STRING_INVERTERS registry, and takes the minimum maxInputCurrentPerMppt
//   as the brand's "effective" cap. Zero per-brand special-casing.
//
//   MICRO TOPOLOGY — MODULE VOC GATE (v47.431, TEARDOWN-v47379 P0)
//   When brand.topology === 'micro', the per-MPPT current gate does not apply
//   (microinverters serve individual panels, no shared MPPT bus) — but the
//   module's cold-corrected Voc (NEC 690.7) is gated against the brand's
//   strictest microinverter max-DC-input voltage (e.g. Enphase IQ8 = 60 V).
//   High-Voc modules like SunPower Maxeon 3 (75.6 V) return 'incompatible'
//   with Voc-fitting replacement suggestions; unresolvable caps fail open to
//   'compatible' so no false "unknown" banner appears for micro brands.
//
// USAGE (sizingEngine.ts):
//   const gate = evaluatePanelBrandCompatibility(panel, brand);
//   if (gate.status === 'incompatible' && gate.suggestions.length > 0) {
//     // auto-swap to suggestions[0]
//   } else if (gate.status === 'marginal') {
//     // emit warning
//   }
// ════════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './brandProfiles';
import type { SolarPanel, StringInverter, Microinverter } from '../equipment-db';
import { STRING_INVERTERS, MICROINVERTERS, SOLAR_PANELS } from '../equipment-db';
import { findCompatiblePanels } from '../panel-compatibility';

// ─── Public types ──────────────────────────────────────────────────────────

export type PanelBrandStatus = 'compatible' | 'marginal' | 'incompatible' | 'unknown';

export interface PanelBrandSuggestion {
  /** Equipment-db panel id. */
  id: string;
  /** Manufacturer (e.g. "Panasonic"). */
  manufacturer: string;
  /** Model (e.g. "EverVolt HK Black 410W"). */
  model: string;
  /** Panel STC watts. */
  watts: number;
  /** Panel STC Isc (A). */
  isc: number;
  /** NEC design current = Isc × 1.25 (A). */
  designCurrent: number;
  /** Headroom as a PERCENTAGE (not fraction). 30 = 30%. */
  headroomPct: number;
  /** 'comfortable' (≥20% headroom) or 'marginal' (0–20%). */
  tier: 'comfortable' | 'marginal';
}

export interface PanelCompatibilityGateResult {
  status: PanelBrandStatus;
  panel: {
    id: string;
    manufacturer: string;
    model: string;
    isc: number;
    /** NEC design current = Isc × 1.25 (A). */
    designCurrent: number;
    /** Panel STC open-circuit voltage (V). Populated for micro topology. */
    voc?: number;
    /** Cold-corrected Voc per NEC 690.7 (V). Populated for micro topology. */
    vocColdCorrected?: number;
  };
  brand: {
    id: string;
    displayName: string;
    /** The minimum per-MPPT current cap across the brand's supported models (A).
     *  null when the cap cannot be determined. */
    effectiveMaxInputCurrentPerMppt: number | null;
    /** Micro topology only: the minimum max-DC-input voltage across the
     *  brand's supported microinverter models (V). null / undefined when
     *  not applicable or not resolvable. */
    effectiveMaxDcInputVoltage?: number | null;
  };
  /** Percent headroom of the current panel vs brand cap.
   *  Negative when designCurrent > cap. Zero-floored for display. */
  headroomPct: number;
  /** Ranked replacement suggestions (empty for 'compatible' / 'unknown'). */
  suggestions: PanelBrandSuggestion[];
  /** Human-readable reason suitable for a banner. */
  reason: string;
}

export interface EvaluatePanelBrandOptions {
  /** NEC design-current multiplier. Default 1.25 (NEC 690.8(A)(1)). */
  necMultiplier?: number;
  /** Headroom threshold (fraction) below which a pairing is 'marginal'.
   *  Default 0.15 (15%). */
  marginalThreshold?: number;
  /** Max number of replacement suggestions to return. Default 3. */
  maxSuggestions?: number;
  /** Site design low temperature (°C) for the NEC 690.7(A)(1) Voc cold
   *  correction. When provided (and the panel has a tempCoeffVoc), the
   *  exact formula is used; otherwise the conservative table multiplier
   *  below applies. */
  designTempMinC?: number;
  /** Fallback NEC 690.7 Table cold-correction multiplier applied to Voc
   *  when no designTempMinC is available. Default 1.12 (≈ −1 to −5 °C
   *  ambient band of NEC Table 690.7(A)). */
  vocColdMultiplier?: number;
  /** Micro topology: cold-Voc headroom (fraction) below which a pairing is
   *  'marginal'. Kept separate from marginalThreshold because the ×1.12
   *  cold correction already embeds worst-case margin. Default 0.05 (5%). */
  microVocMarginalThreshold?: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_NEC_MULTIPLIER    = 1.25;
const DEFAULT_MARGINAL_THRESHOLD = 0.15; // 15%
const DEFAULT_MAX_SUGGESTIONS    = 3;
const DEFAULT_VOC_COLD_MULTIPLIER = 1.12; // NEC Table 690.7(A), −1…−5 °C band
const DEFAULT_MICRO_VOC_MARGINAL_THRESHOLD = 0.05; // 5%

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Find the strictest per-MPPT current cap among a brand's supported inverter
 * models. Scans brand.supportedInverterModels, resolves each equipmentDbId
 * against the StringInverter registry, and returns the minimum
 * maxInputCurrentPerMppt.
 *
 * Returns null when:
 *   - brand has no supportedInverterModels (empty array)
 *   - none of the equipmentDbIds resolve (all misses)
 *
 * BRAND-AGNOSTIC: no per-brand logic. Works for every current/future brand.
 *
 * NOTE: For micro topology brands, this function is NOT called — per-MPPT
 * input current is a string-inverter concept that doesn't apply to per-panel
 * microinverters. Micro brands are gated on module Voc vs max DC input
 * voltage instead (see getBrandMinMicroMaxDcVoltage).
 */
export function getBrandMinMpptCurrent(brand: BrandProfile | null | undefined): number | null {
  if (!brand) return null;
  const models = brand.supportedInverterModels ?? [];
  if (models.length === 0) return null;

  let min: number | null = null;
  for (const ref of models) {
    const inv = STRING_INVERTERS.find(x => x.id === ref.equipmentDbId) as StringInverter | undefined;
    if (!inv) continue;
    const cap = inv.maxInputCurrentPerMppt;
    if (typeof cap !== 'number' || cap <= 0) continue;
    if (min === null || cap < min) min = cap;
  }
  return min;
}

/**
 * Micro-topology counterpart of getBrandMinMpptCurrent(): the strictest
 * max-DC-input voltage among a brand's supported microinverter models.
 * Scans brand.supportedInverterModels, resolves each equipmentDbId against
 * the MICROINVERTERS registry, and returns the minimum maxDcVoltage.
 *
 * Returns null when the brand has no supported models or none resolve.
 * BRAND-AGNOSTIC: no per-brand logic (Enphase IQ8 = 60 V, APsystems DS3 =
 * 60 V, Hoymiles HM = 60 V — all from datasheet-backed equipment-db records).
 */
export function getBrandMinMicroMaxDcVoltage(brand: BrandProfile | null | undefined): number | null {
  if (!brand) return null;
  const models = brand.supportedInverterModels ?? [];
  if (models.length === 0) return null;

  let min: number | null = null;
  for (const ref of models) {
    const micro = MICROINVERTERS.find(x => x.id === ref.equipmentDbId) as Microinverter | undefined;
    if (!micro) continue;
    const cap = micro.maxDcVoltage;
    if (typeof cap !== 'number' || cap <= 0) continue;
    if (min === null || cap < min) min = cap;
  }
  return min;
}

/**
 * NEC 690.7(A) cold-temperature Voc correction factor.
 * Exact formula when a design-low temperature and panel coefficient are
 * available; conservative table multiplier (default ×1.12) otherwise.
 */
function vocColdFactor(
  panel: SolarPanel,
  designTempMinC: number | undefined,
  fallbackMultiplier: number,
): number {
  if (
    typeof designTempMinC === 'number' &&
    typeof panel.tempCoeffVoc === 'number' &&
    panel.tempCoeffVoc !== 0
  ) {
    // tempCoeffVoc is %/°C (negative) → factor > 1 for sub-25°C design temps
    return 1 + (panel.tempCoeffVoc / 100) * (designTempMinC - 25);
  }
  return fallbackMultiplier;
}

function roundA(a: number): number {
  return Math.round(a * 100) / 100;
}

function roundPct(p: number): number {
  return Math.round(p * 10) / 10;
}

function buildSuggestions(
  cap: number,
  necMultiplier: number,
  maxSuggestions: number,
  excludePanelId?: string,
): PanelBrandSuggestion[] {
  const result = findCompatiblePanels(cap, { necMultiplier });
  // Prefer comfortable tier first; fall back to marginal.
  const ranked: PanelBrandSuggestion[] = [];

  for (const c of result.comfortable) {
    if (c.id === excludePanelId) continue;
    const panel = SOLAR_PANELS.find(p => p.id === c.id);
    if (!panel) continue;
    ranked.push({
      id:            c.id,
      manufacturer:  panel.manufacturer,
      model:         panel.model,
      watts:         panel.watts,
      isc:           c.isc,
      designCurrent: c.designCurrent,
      headroomPct:   roundPct(c.headroom * 100),
      tier:          'comfortable',
    });
    if (ranked.length >= maxSuggestions) return ranked;
  }

  // Fill remaining slots with marginal-tier candidates
  for (const c of result.marginal) {
    if (c.id === excludePanelId) continue;
    const panel = SOLAR_PANELS.find(p => p.id === c.id);
    if (!panel) continue;
    ranked.push({
      id:            c.id,
      manufacturer:  panel.manufacturer,
      model:         panel.model,
      watts:         panel.watts,
      isc:           c.isc,
      designCurrent: c.designCurrent,
      headroomPct:   roundPct(c.headroom * 100),
      tier:          'marginal',
    });
    if (ranked.length >= maxSuggestions) return ranked;
  }

  return ranked;
}

/**
 * Micro topology: rank replacement panels whose COLD-CORRECTED Voc fits under
 * the brand's max-DC-input voltage cap. Voltage analogue of buildSuggestions().
 * tier/headroomPct here express VOLTAGE headroom, not current headroom.
 */
function buildMicroVocSuggestions(
  vocCap: number,
  designTempMinC: number | undefined,
  coldMultiplier: number,
  necMultiplier: number,
  marginalFrac: number,
  maxSuggestions: number,
  excludePanelId?: string,
): PanelBrandSuggestion[] {
  const candidates = SOLAR_PANELS
    .filter(p => p.id !== excludePanelId && p.active !== false && p.voc > 0)
    .map(p => {
      const vocCold = p.voc * vocColdFactor(p, designTempMinC, coldMultiplier);
      return { p, vocCold, headroomFrac: (vocCap - vocCold) / vocCap };
    })
    .filter(c => c.vocCold <= vocCap)
    // Comfortable-voltage-headroom panels first, then highest watts.
    .sort((a, b) => {
      const aComf = a.headroomFrac >= marginalFrac ? 1 : 0;
      const bComf = b.headroomFrac >= marginalFrac ? 1 : 0;
      if (aComf !== bComf) return bComf - aComf;
      return b.p.watts - a.p.watts;
    });

  return candidates.slice(0, maxSuggestions).map(c => ({
    id:            c.p.id,
    manufacturer:  c.p.manufacturer,
    model:         c.p.model,
    watts:         c.p.watts,
    isc:           c.p.isc,
    designCurrent: roundA(c.p.isc * necMultiplier),
    headroomPct:   roundPct(c.headroomFrac * 100),
    tier:          c.headroomFrac >= marginalFrac ? 'comfortable' : 'marginal',
  }));
}

function buildReason(
  status: PanelBrandStatus,
  panel: SolarPanel,
  brand: BrandProfile,
  cap: number | null,
  designCurrent: number,
  headroomPct: number,
  suggestions: PanelBrandSuggestion[],
): string {
  const panelName = `${panel.manufacturer} ${panel.model}`;
  switch (status) {
    case 'incompatible': {
      const capStr = cap !== null ? `${cap.toFixed(1)} A/MPPT` : 'its MPPT current cap';
      if (suggestions.length > 0) {
        const top = suggestions[0];
        return (
          `${panelName} (${panel.watts}W, Isc ${panel.isc.toFixed(2)} A, ` +
          `design ${designCurrent.toFixed(2)} A) exceeds ${brand.displayName}'s ${capStr}. ` +
          `Auto-switched to ${top.manufacturer} ${top.model} ` +
          `(${top.watts}W, ${top.headroomPct.toFixed(1)}% headroom) for a compliant design.`
        );
      }
      return (
        `${panelName} draws ${designCurrent.toFixed(2)} A per string (NEC 690.8(A)(1)), ` +
        `which exceeds ${brand.displayName}'s ${capStr}. No compatible replacement was ` +
        `found in the catalog — please pick a different brand or contact support.`
      );
    }
    case 'marginal':
      return (
        `${panelName} fits ${brand.displayName}'s MPPT channels but with only ` +
        `${headroomPct.toFixed(1)}% current headroom. Layout will succeed, but ` +
        `consider a lower-Isc panel for a more robust design.`
      );
    case 'compatible': {
      // When cap is null the MPPT current gate doesn't apply (micro topology).
      if (cap === null) {
        return (
          `${panelName} is compatible with ${brand.displayName} — ` +
          `per-MPPT current gating does not apply to microinverters ` +
          `(each panel is served by its own device).`
        );
      }
      return (
        `${panelName} is fully compatible with ${brand.displayName} ` +
        `(${headroomPct.toFixed(1)}% MPPT current headroom).`
      );
    }
    case 'unknown':
    default:
      return (
        `Compatibility for ${panelName} with ${brand.displayName} could not be ` +
        `determined (no resolvable inverter models for this brand).`
      );
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Evaluate whether a panel is compatible with a brand's MPPT input current
 * budget, returning a tiered verdict + ranked replacement suggestions.
 *
 * This is a PURE function — no side effects, no logging.
 *
 * @param panel   The user's currently-loaded panel (from SOLAR_PANELS).
 * @param brand   The user's selected brand profile.
 * @param options NEC multiplier / threshold / suggestion-count overrides.
 */
export function evaluatePanelBrandCompatibility(
  panel: SolarPanel | null | undefined,
  brand: BrandProfile | null | undefined,
  options: EvaluatePanelBrandOptions = {},
): PanelCompatibilityGateResult {
  const necMultiplier     = options.necMultiplier     ?? DEFAULT_NEC_MULTIPLIER;
  const marginalThreshold = options.marginalThreshold ?? DEFAULT_MARGINAL_THRESHOLD;
  const maxSuggestions    = options.maxSuggestions    ?? DEFAULT_MAX_SUGGESTIONS;

  // Fail-open shell when panel or brand is missing
  if (!panel || !brand) {
    return {
      status: 'unknown',
      panel: {
        id:            panel?.id            ?? '(unknown)',
        manufacturer:  panel?.manufacturer  ?? '(unknown)',
        model:         panel?.model         ?? '(unknown)',
        isc:           panel?.isc           ?? 0,
        designCurrent: 0,
      },
      brand: {
        id:                              brand?.id            ?? '(unknown)',
        displayName:                     brand?.displayName   ?? '(unknown)',
        effectiveMaxInputCurrentPerMppt: null,
      },
      headroomPct: 0,
      suggestions: [],
      reason:      'Insufficient data to evaluate panel/brand compatibility.',
    };
  }

  // ── Micro topology — module Voc vs max DC input voltage ──────────────
  // Per-MPPT input current is a string-inverter concept and doesn't apply
  // to per-panel microinverters — but the module's COLD-CORRECTED Voc must
  // stay under the micro's max DC input voltage (NEC 690.7). Before
  // v47.431 this branch returned 'compatible' unconditionally, which let
  // e.g. SunPower Maxeon 3 (Voc 75.6 V → ~84.7 V cold) ship as compatible
  // with Enphase IQ8 (60 V max DC input). TEARDOWN-v47379 P0.
  if (brand.topology === 'micro') {
    const vocCap        = getBrandMinMicroMaxDcVoltage(brand);
    const designCurrent = roundA(panel.isc * necMultiplier);
    const coldMult      = options.vocColdMultiplier ?? DEFAULT_VOC_COLD_MULTIPLIER;
    const vocMarginal   = options.microVocMarginalThreshold ?? DEFAULT_MICRO_VOC_MARGINAL_THRESHOLD;
    const coldFactor    = vocColdFactor(panel, options.designTempMinC, coldMult);
    const vocCold       = roundA(panel.voc * coldFactor);
    const panelName     = `${panel.manufacturer} ${panel.model}`;

    const panelBlock = {
      id:                panel.id,
      manufacturer:      panel.manufacturer,
      model:             panel.model,
      isc:               panel.isc,
      designCurrent,
      voc:               panel.voc,
      vocColdCorrected:  vocCold,
    };
    const brandBlock = {
      id:                              brand.id,
      displayName:                     brand.displayName,
      effectiveMaxInputCurrentPerMppt: null,
      effectiveMaxDcInputVoltage:      vocCap,
    };

    // Fail-open when the voltage cap can't be resolved or the panel record
    // has no usable Voc — same philosophy as 'unknown' for string brands,
    // but keep 'compatible' to avoid the false-banner regression the
    // original short-circuit was added for.
    if (vocCap === null || !(panel.voc > 0)) {
      return {
        status:      'compatible',
        panel:       panelBlock,
        brand:       brandBlock,
        headroomPct: 100,   // not determinable — report full headroom
        suggestions: [],
        reason:      buildReason('compatible', panel, brand, null, designCurrent, 100, []),
      };
    }

    const headroomFrac = (vocCap - vocCold) / vocCap;
    const headroomPct  = roundPct(headroomFrac * 100);

    if (vocCold > vocCap) {
      const suggestions = buildMicroVocSuggestions(
        vocCap, options.designTempMinC, coldMult, necMultiplier,
        vocMarginal, maxSuggestions, panel.id,
      );
      const top = suggestions[0];
      const reason =
        `${panelName} (Voc ${panel.voc.toFixed(1)} V, ${vocCold.toFixed(1)} V cold-corrected per ` +
        `NEC 690.7) exceeds ${brand.displayName}'s ${vocCap.toFixed(0)} V max DC input per ` +
        `microinverter. ` +
        (top
          ? `Auto-switched to ${top.manufacturer} ${top.model} (${top.watts}W, ` +
            `${top.headroomPct.toFixed(1)}% voltage headroom) for a compliant design.`
          : `No compatible replacement was found in the catalog — please pick a ` +
            `different brand or contact support.`);
      return {
        status: 'incompatible',
        panel:  panelBlock,
        brand:  brandBlock,
        headroomPct,
        suggestions,
        reason,
      };
    }

    if (headroomFrac < vocMarginal) {
      return {
        status: 'marginal',
        panel:  panelBlock,
        brand:  brandBlock,
        headroomPct,
        suggestions: [],
        reason:
          `${panelName} fits under ${brand.displayName}'s ${vocCap.toFixed(0)} V max DC input, ` +
          `but with only ${headroomPct.toFixed(1)}% cold-temperature voltage headroom ` +
          `(Voc ${vocCold.toFixed(1)} V cold-corrected per NEC 690.7). Verify the site's ` +
          `design low temperature before permitting.`,
      };
    }

    return {
      status: 'compatible',
      panel:  panelBlock,
      brand:  brandBlock,
      headroomPct,
      suggestions: [],
      reason:
        `${panelName} is compatible with ${brand.displayName} — per-MPPT current gating ` +
        `does not apply to microinverters (each panel is served by its own device). ` +
        `Cold-corrected Voc ${vocCold.toFixed(1)} V is within the ${vocCap.toFixed(0)} V ` +
        `max DC input (${headroomPct.toFixed(1)}% headroom, NEC 690.7).`,
    };
  }

  const cap           = getBrandMinMpptCurrent(brand);
  const designCurrent = roundA(panel.isc * necMultiplier);

  let status: PanelBrandStatus;
  let headroomPct: number;
  let suggestions: PanelBrandSuggestion[] = [];

  if (cap === null) {
    status      = 'unknown';
    headroomPct = 0;
  } else if (designCurrent > cap) {
    status      = 'incompatible';
    // Negative headroom shown to UI as 0 for clarity
    headroomPct = roundPct(((cap - designCurrent) / cap) * 100);
    suggestions = buildSuggestions(cap, necMultiplier, maxSuggestions, panel.id);
  } else {
    const headroomFrac = (cap - designCurrent) / cap;
    headroomPct = roundPct(headroomFrac * 100);
    if (headroomFrac < marginalThreshold) {
      status = 'marginal';
    } else {
      status = 'compatible';
    }
  }

  const reason = buildReason(status, panel, brand, cap, designCurrent, headroomPct, suggestions);

  return {
    status,
    panel: {
      id:            panel.id,
      manufacturer:  panel.manufacturer,
      model:         panel.model,
      isc:           panel.isc,
      designCurrent,
    },
    brand: {
      id:                              brand.id,
      displayName:                     brand.displayName,
      effectiveMaxInputCurrentPerMppt: cap,
    },
    headroomPct,
    suggestions,
    reason,
  };
}