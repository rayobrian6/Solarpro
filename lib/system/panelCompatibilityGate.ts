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
//   MICRO TOPOLOGY SHORT-CIRCUIT
//   When brand.topology === 'micro', the per-MPPT current gate does not apply:
//   microinverters serve individual panels (1–2 modules per device) and have
//   no shared MPPT bus. The gate returns 'compatible' with a reason explaining
//   the gate is not applicable. This prevents a false "unknown" banner for
//   Enphase IQ8, APsystems, Hoymiles, and any future micro brand.
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
import type { SolarPanel, StringInverter } from '../equipment-db';
import { STRING_INVERTERS, SOLAR_PANELS } from '../equipment-db';
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
  };
  brand: {
    id: string;
    displayName: string;
    /** The minimum per-MPPT current cap across the brand's supported models (A).
     *  null when the cap cannot be determined. */
    effectiveMaxInputCurrentPerMppt: number | null;
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
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_NEC_MULTIPLIER    = 1.25;
const DEFAULT_MARGINAL_THRESHOLD = 0.15; // 15%
const DEFAULT_MAX_SUGGESTIONS    = 3;

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
 * NOTE: For micro topology brands, this function is NOT called —
 * evaluatePanelBrandCompatibility() short-circuits to 'compatible' before
 * reaching the MPPT current gate, since per-MPPT input current is a
 * string-inverter concept that doesn't apply to per-panel microinverters.
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

  // ── Micro topology short-circuit ──────────────────────────────────────
  // Per-MPPT input current is a string-inverter concept. Microinverters
  // serve individual panels (1–2 modules per device) with no shared MPPT
  // bus, so the current-gate concept doesn't apply. Return 'compatible'
  // with a reason explaining the gate is not applicable. This prevents a
  // false "unknown" / "no resolvable inverter models" banner for Enphase
  // IQ8, APsystems, Hoymiles, and any future micro brand.
  if (brand.topology === 'micro') {
    return {
      status: 'compatible',
      panel: {
        id:            panel.id,
        manufacturer:  panel.manufacturer,
        model:         panel.model,
        isc:           panel.isc,
        designCurrent: roundA(panel.isc * necMultiplier),
      },
      brand: {
        id:                              brand.id,
        displayName:                     brand.displayName,
        effectiveMaxInputCurrentPerMppt: null,
      },
      headroomPct: 100,   // not applicable — report full headroom
      suggestions: [],
      reason:      buildReason('compatible', panel, brand, null, roundA(panel.isc * necMultiplier), 100, []),
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