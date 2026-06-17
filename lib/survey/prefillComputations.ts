/**
 * lib/survey/prefillComputations.ts
 * Phase 2G: Auto-compute survey fields from available project data.
 *
 * Three computations:
 *   1. Roof pitch → tilt angle (degrees)
 *   2. Default panel rating (most common residential = 200A)
 *   3. Interconnection point from NEC 705.12 rules
 */

import type { InterconnectionMethod } from '@/lib/electrical-calc';

// ── Roof Pitch → Tilt Angle Conversion ─────────────────────
// Roof pitch is expressed as rise/run ratio (e.g., "4/12" = 4" rise per 12" run)
// Tilt angle = arctan(rise / run)

const PITCH_TO_TILT: Record<string, number> = {
  'flat':       0,     // <2:12
  'low':        9,     // 2-4:12 average → ~9°
  'standard':   22,    // 5-9:12 average → ~22°
  'steep':      35,    // 10-14:12 average → ~35°
  'very_steep': 45,    // 15+:12 → ~45°
};

export function pitchToTilt(pitch: string): number | null {
  // Direct lookup for our chip values
  if (PITCH_TO_TILT[pitch]) return PITCH_TO_TILT[pitch];

  // Try parsing "X/12" format
  const match = pitch.match(/^(\d+(?:\.\d+)?)\s*\/\s*12/);
  if (match) {
    const rise = parseFloat(match[1]);
    return Math.round(Math.atan(rise / 12) * (180 / Math.PI));
  }

  // Try parsing as direct degrees
  const asNum = parseFloat(pitch);
  if (!isNaN(asNum) && asNum >= 0 && asNum <= 90) return asNum;

  return null;
}

export interface TiltPrefill {
  tilt: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'survey' | 'ahj' | 'address-lookup';
  derivation: string;
}

/**
 * Compute tilt angle from survey roof pitch, falling back to AHJ/latitude defaults.
 */
export function computeTilt(input: {
  roofPitch?: string;
  lat?: number;
  ahjDefaultTilt?: number;
}): TiltPrefill | null {
  // Best: from survey roof pitch
  if (input.roofPitch && input.roofPitch !== 'flat') {
    const tilt = pitchToTilt(input.roofPitch);
    if (tilt !== null && tilt > 0) {
      return {
        tilt,
        confidence: 'high',
        source: 'survey',
        derivation: `Converted from roof pitch "${input.roofPitch}" → ${tilt}° tilt`,
      };
    }
  }

  // Good: from AHJ default
  if (input.ahjDefaultTilt && input.ahjDefaultTilt > 0) {
    return {
      tilt: input.ahjDefaultTilt,
      confidence: 'medium',
      source: 'ahj',
      derivation: `AHJ default tilt: ${input.ahjDefaultTilt}°`,
    };
  }

  // Fallback: from latitude
  if (input.lat) {
    const latTilt = Math.round(Math.abs(input.lat));
    return {
      tilt: latTilt,
      confidence: 'low',
      source: 'address-lookup',
      derivation: `Estimated from latitude: |${input.lat.toFixed(1)}°| = ${latTilt}°`,
    };
  }

  return null;
}

// ── Default Panel Rating ────────────────────────────────────
export interface PanelRatingPrefill {
  rating: string;   // chip value for survey
  amps: number;     // numeric value
  confidence: 'high' | 'medium' | 'low';
  source: 'ecosystem' | 'survey';
  derivation: string;
}

/**
 * Suggest default panel rating. 200A is by far the most common residential main panel.
 */
export function computeDefaultPanelRating(systemType?: string): PanelRatingPrefill {
  if (systemType === 'commercial' || systemType === 'industrial') {
    return {
      rating: '400',
      amps: 400,
      confidence: 'medium',
      source: 'ecosystem',
      derivation: 'Commercial/industrial buildings typically have 400A service',
    };
  }

  // Default: 200A residential
  return {
    rating: '200',
    amps: 200,
    confidence: 'high',
    source: 'ecosystem',
    derivation: '200A is the most common residential main panel rating in the US',
  };
}

// ── Interconnection Point Auto-Computation (NEC 705.12) ─────
export interface InterconnectionPrefill {
  method: InterconnectionMethod;
  methodLabel: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'nec' | 'ecosystem';
  derivation: string;
  necReference: string;
}

/**
 * Auto-compute the best interconnection method from panel data.
 * Applies NEC 705.12 rules to determine:
 *   - LOAD_SIDE: default if 120% rule passes
 *   - SUPPLY_SIDE_TAP: if load side fails (no breaker space or 120% exceeded)
 *   - MAIN_BREAKER_DERATE: if main breaker can be derated
 *   - PANEL_UPGRADE: if nothing else works
 */
export function computeInterconnection(input: {
  busRating?: number;       // Panel bus bar rating (A)
  mainBreaker?: number;     // Main breaker size (A)
  solarBreaker?: number;    // Solar backfeed breaker (A) — computed if omitted
  availableSlots?: number;  // Available breaker slots
}): InterconnectionPrefill {
  const { busRating, mainBreaker, solarBreaker, availableSlots } = input;

  // If we don't have panel data, suggest the most common scenario
  if (!busRating || !mainBreaker) {
    return {
      method: 'LOAD_SIDE',
      methodLabel: 'Load Side',
      confidence: 'low',
      source: 'ecosystem',
      derivation: 'No panel data available — load side is the most common interconnection method. Survey the panel for accurate NEC 705.12 sizing.',
      necReference: 'NEC 705.12(B)',
    };
  }

  // Compute solar breaker size from system size if not provided
  const computedSolarBreaker = solarBreaker || Math.ceil(busRating * 0.2); // 20% of bus rating
  const maxAllowed = busRating * 1.2 - mainBreaker; // 120% rule: max solar breaker

  // Check if load-side 120% rule passes
  if (computedSolarBreaker <= maxAllowed && (availableSlots === undefined || availableSlots > 0)) {
    return {
      method: 'LOAD_SIDE',
      methodLabel: 'Load Side',
      confidence: 'high',
      source: 'nec',
      derivation: `120% rule passes: ${busRating}A bus × 1.2 = ${busRating * 1.2}A - ${mainBreaker}A main = ${maxAllowed}A max solar. Need ${computedSolarBreaker}A breaker. ${availableSlots !== undefined ? `${availableSlots} slot(s) available.` : ''}`,
      necReference: 'NEC 705.12(B)',
    };
  }

  // Load side fails — check main breaker derate
  const deratedMain = busRating * 1.2 - computedSolarBreaker;
  if (deratedMain >= mainBreaker * 0.7) { // Don't derate more than 30%
    return {
      method: 'MAIN_BREAKER_DERATE',
      methodLabel: 'Main Breaker Derate',
      confidence: 'medium',
      source: 'nec',
      derivation: `120% rule fails with current main breaker. Derate main from ${mainBreaker}A to ${Math.round(deratedMain)}A to allow ${computedSolarBreaker}A solar breaker. Bus rating: ${busRating}A.`,
      necReference: 'NEC 705.12(B)',
    };
  }

  // Check supply-side tap
  if (mainBreaker < busRating) {
    return {
      method: 'SUPPLY_SIDE_TAP',
      methodLabel: 'Supply Side Tap',
      confidence: 'medium',
      source: 'nec',
      derivation: `Load side fails 120% rule. Supply-side tap is available — connect between utility meter and main breaker. No bus rating limitation.`,
      necReference: 'NEC 705.11',
    };
  }

  // Nothing works — panel upgrade needed
  return {
    method: 'PANEL_UPGRADE',
    methodLabel: 'Panel Upgrade',
    confidence: 'low',
    source: 'nec',
    derivation: `Current ${busRating}A panel cannot accommodate solar under NEC 705.12. Panel upgrade to ${Math.ceil(computedSolarBreaker / 200) * 200}A or higher is required.`,
    necReference: 'NEC 705.12(B)',
  };
}
