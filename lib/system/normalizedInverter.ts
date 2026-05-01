// ═════════════════════════════════════════════════════════════════════════════
// Normalized Inverter State (Phase 12.5)
// lib/system/normalizedInverter.ts
// ─────────────────────────────────────────────────────────────────────────────
// CORE PROBLEM:
//   Different parts of the system interpret "inverter count" differently.
//   For micro topology, SystemSizingResult.inverterCount === panelCount
//   (each panel gets its own microinverter), but the UI groups them into
//   a single card. Mismatch logic that compared UI-card-count against the
//   sizing-engine's inverterCount produced false positives for micro
//   (1 card vs 36 microinverters).
//
// SOLUTION:
//   One canonical view, computed once, used everywhere. Separates PHYSICAL
//   hardware count from LOGICAL UI grouping.
//
//     physicalUnits = real hardware devices (microinverters, string boxes, …)
//     logicalGroups = how many UI cards / electrical groups the user sees
//     topology      = canonical topology family driving both
//
// RULES (non-negotiable):
//   1. physicalUnits ALWAYS represents real hardware.
//   2. logicalGroups is UI-only (cards, electrical clusters).
//   3. ALL system-wide comparisons use physicalUnits.
//   4. Mismatch logic NEVER uses raw UI grouping.
//
// TOPOLOGY MAPPING:
//   micro:     physicalUnits = panelCount,   logicalGroups = 1
//   string:    physicalUnits = inverterQty,  logicalGroups = inverterQty
//   hybrid:    physicalUnits = inverterQty,  logicalGroups = inverterQty
//   optimizer: physicalUnits = inverterQty,  logicalGroups = inverterQty
//              (optimizer devices per panel are tracked separately via
//               optimizerCount for BOM; not the inverter count.)
// ═════════════════════════════════════════════════════════════════════════════

import type { SystemSizingResult } from './sizingEngine';
import type { TopologyFamily } from './brandProfiles/types';

/**
 * One canonical representation of inverter quantity for a given system
 * state (either the sizing recommendation or the current user config).
 * Always produced by normalizeInverterState(); never constructed by hand.
 */
export interface NormalizedInverterState {
  /** Number of real hardware inverter devices. */
  physicalUnits: number;
  /** Number of UI cards / electrical groups. */
  logicalGroups: number;
  /** Canonical topology family. */
  topology: TopologyFamily;
  /**
   * Number of per-panel optimizer devices (optimizer topology only).
   * Tracked separately from physicalUnits because optimizers are NOT
   * inverters — they are DC power-electronics between panels and a
   * central string inverter. Zero for non-optimizer topologies.
   */
  optimizerCount: number;
}

/**
 * Snapshot of the user's current config as needed by the normalizer.
 * Deliberately minimal — mirrors what app/engineering already tracks
 * without requiring the full SystemDefinition / CAD model.
 */
export interface CurrentInverterConfigSnapshot {
  /** Count of inverter UI cards (user-visible groups). */
  cardCount: number;
  /**
   * Total panel count assigned across all cards/strings. This is what
   * the micro topology uses to compute physicalUnits.
   */
  panelCount: number;
  /**
   * Raw UI topology label. Accepts legacy 'ecoflow' and normalizes to
   * 'hybrid'. Anything else is assumed valid TopologyFamily.
   */
  topology: string;
}

/**
 * Input to normalizeInverterState(). At least one of sizingResult or
 * currentConfig must be provided. When both are present, the normalizer
 * produces a state from each and they can be diff'd by the caller.
 */
export interface NormalizeInput {
  /** The sizing engine's recommendation, if available. */
  sizingResult?: SystemSizingResult | null;
  /** The user's current UI config snapshot, if available. */
  currentConfig?: CurrentInverterConfigSnapshot | null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Produce a NormalizedInverterState from EITHER a sizingResult OR a
 * currentConfig snapshot (not both — callers wanting to diff should call
 * twice and compare the results).
 *
 * The canonical entry point for interpreting inverter quantity anywhere
 * in the system. No other module should derive physicalUnits on its own.
 */
export function normalizeInverterState(input: NormalizeInput): NormalizedInverterState {
  const { sizingResult, currentConfig } = input;

  if (sizingResult && currentConfig) {
    throw new Error(
      'normalizeInverterState: pass only one of sizingResult or currentConfig. ' +
      'To diff, call twice.',
    );
  }

  if (sizingResult) return fromSizingResult(sizingResult);
  if (currentConfig) return fromCurrentConfig(currentConfig);

  return emptyState();
}

/**
 * Convenience helper: compute BOTH states and return them alongside a
 * mismatch flag. Single-source-of-truth for mismatch detection.
 */
export interface NormalizedDiff {
  current: NormalizedInverterState;
  recommended: NormalizedInverterState;
  /**
   * True when physicalUnits OR topology differ between current and
   * recommended. UI logicalGroups is NEVER used for this flag.
   */
  physicalMismatch: boolean;
  /** True when current.topology !== recommended.topology. */
  topologyMismatch: boolean;
}

export function diffNormalizedInverterState(
  current: CurrentInverterConfigSnapshot | null | undefined,
  recommended: SystemSizingResult | null | undefined,
): NormalizedDiff {
  const cur = current ? fromCurrentConfig(current) : emptyState();
  const rec = recommended ? fromSizingResult(recommended) : emptyState();
  const topologyMismatch = cur.topology !== rec.topology;
  const physicalMismatch = topologyMismatch || cur.physicalUnits !== rec.physicalUnits;
  return { current: cur, recommended: rec, physicalMismatch, topologyMismatch };
}

// ─── Formatters ─────────────────────────────────────────────────────────────

/**
 * Human-readable summary for UI display. MUST be used by all cards /
 * headers / tooltips to surface the physical/logical distinction and
 * prevent the user from reading "1 card" as "1 inverter" for micro.
 */
export function formatNormalizedInverterSummary(state: NormalizedInverterState): string {
  if (state.physicalUnits === 0) return '(no inverter)';

  switch (state.topology) {
    case 'micro':
      return state.physicalUnits === 1
        ? '1 microinverter'
        : `${state.physicalUnits} microinverters${state.logicalGroups > 1 ? ` • ${state.logicalGroups} groups` : ' • 1 system group'}`;

    case 'string':
      return state.physicalUnits === 1
        ? '1 string inverter'
        : `${state.physicalUnits} string inverters`;

    case 'hybrid':
      return state.physicalUnits === 1
        ? '1 hybrid inverter'
        : `${state.physicalUnits} hybrid inverters`;

    case 'optimizer':
      return state.physicalUnits === 1
        ? `1 string inverter + ${state.optimizerCount} optimizers`
        : `${state.physicalUnits} string inverters + ${state.optimizerCount} optimizers`;

    default:
      return `${state.physicalUnits} units`;
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function emptyState(): NormalizedInverterState {
  return {
    physicalUnits: 0,
    logicalGroups: 0,
    topology: 'string',
    optimizerCount: 0,
  };
}

/**
 * Build a normalized state from the sizing engine's output. This is the
 * authoritative mapping — every other module that looked at
 * sizingResult.inverterCount directly should migrate to reading this.
 */
function fromSizingResult(r: SystemSizingResult): NormalizedInverterState {
  const topology = r.topology;

  switch (topology) {
    case 'micro': {
      // Microinverters: physicalUnits = actual PANEL count, not device count.
      // For single-module micros (mpd=1), panelCount === deviceCount so this
      // is unchanged. For dual-module micros (e.g. APsystems DS3-L, mpd=2),
      // microDeviceCount = ceil(panels / 2) which would be HALF the panel count.
      // Using input.panelCount here keeps both sides of the mismatch comparison
      // on the same scale: applySizingRecommendation stores actualPanelCount in
      // the string, fromCurrentConfig reads that sum as physicalUnits.
      // This prevents a false auto-apply loop when mpd > 1.
      const panelCount = r.input.panelCount > 0 ? r.input.panelCount
        : r.microDeviceCount > 0 ? r.microDeviceCount
        : r.inverterCount;
      return {
        physicalUnits: panelCount,
        logicalGroups: 1,
        topology,
        optimizerCount: 0,
      };
    }

    case 'optimizer': {
      // SolarEdge HD-Wave: N string inverters + panelCount optimizers. The
      // UI has one card per string inverter; optimizers are tracked in BOM
      // but not grouped in the inverter UI.
      const panelCount = r.input.panelCount;
      return {
        physicalUnits: r.inverterCount,
        logicalGroups: r.inverterCount,
        topology,
        optimizerCount: panelCount,
      };
    }

    case 'string':
    case 'hybrid': {
      return {
        physicalUnits: r.inverterCount,
        logicalGroups: r.inverterCount,
        topology,
        optimizerCount: 0,
      };
    }

    default: {
      // Should be unreachable (TopologyFamily is a closed union), but we
      // defend against future additions.
      return {
        physicalUnits: r.inverterCount,
        logicalGroups: r.inverterCount,
        topology,
        optimizerCount: 0,
      };
    }
  }
}

/**
 * Build a normalized state from the user's current UI snapshot.
 * Crucially, for micro topology physicalUnits is derived from panelCount —
 * NOT from the number of UI cards. This is the fix for the false-positive
 * mismatch that Phase 12 inherited.
 */
function fromCurrentConfig(c: CurrentInverterConfigSnapshot): NormalizedInverterState {
  const topology = mapLegacyTopology(c.topology);

  switch (topology) {
    case 'micro': {
      // For the user's current config, "how many microinverters exist?"
      // equals "how many panels are assigned". The UI only ever shows
      // 1 card in micro topology today.
      return {
        physicalUnits: c.panelCount,
        logicalGroups: Math.max(1, c.cardCount),
        topology,
        optimizerCount: 0,
      };
    }

    case 'optimizer': {
      return {
        physicalUnits: c.cardCount,
        logicalGroups: c.cardCount,
        topology,
        optimizerCount: c.panelCount,
      };
    }

    case 'string':
    case 'hybrid': {
      return {
        physicalUnits: c.cardCount,
        logicalGroups: c.cardCount,
        topology,
        optimizerCount: 0,
      };
    }

    default: {
      return {
        physicalUnits: c.cardCount,
        logicalGroups: c.cardCount,
        topology,
        optimizerCount: 0,
      };
    }
  }
}

/**
 * Accepts legacy UI topology labels ('ecoflow') and canonicalizes them
 * to the TopologyFamily union. Unknown strings default to 'string' so
 * validation catches the anomaly upstream.
 */
function mapLegacyTopology(raw: string): TopologyFamily {
  if (raw === 'micro' || raw === 'string' || raw === 'optimizer' || raw === 'hybrid') {
    return raw;
  }
  if (raw === 'ecoflow') return 'hybrid';
  return 'string';
}