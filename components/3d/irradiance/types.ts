/**
 * components/3d/irradiance/types.ts
 *
 * Type contracts for the irradiance map toggle slice.
 *
 * Aurora parity reference: HANDOFF_2026-08-25_AURORA_ANALYSIS.md §6
 *   - "Toggle Irradiance Map (I)" tooltip on the top-right toolbar button
 *   - "Irradiance Map was queued" toast at the top-right
 *   - (I) hotkey
 *   - Overlay rendered on the roof when the computation finishes
 *
 * This file defines the *only* shared vocabulary between the store,
 * the toggle button, the toast, the overlay, and the hotkey handler.
 * Keeping it small and stable is the whole point — the future
 * irradiance-engine epic (per-vertex kWh/m²/year computation,
 * Cesium entity rendering) will conform to `IrradianceResult` and
 * drop its results into the same store without changing any UI
 * shape.
 */

// ─── State machine ──────────────────────────────────────────────────────────

/**
 * The four states the toggle can be in. Strings are exported as a
 * const tuple so the store, the UI, and the tests can share them
 * without a hardcoded literal mismatch.
 */
export const IRRADIANCE_STATES = ['idle', 'queued', 'computing', 'visible'] as const;
export type IrradianceState = (typeof IRRADIANCE_STATES)[number];

/**
 * Sentinel that captures the legal transition table at the type
 * level. Used by the store's `transition()` helper to refuse any
 * edge that isn't on the diagram in DESIGN.md.
 */
export const IRRADIANCE_TRANSITIONS: Readonly<Record<IrradianceState, ReadonlyArray<IrradianceState>>> = {
  idle: ['queued'],
  queued: ['computing', 'idle'], // idle is reachable only via abort (not exposed in UI; reserved)
  computing: ['visible', 'idle'],
  visible: ['idle'],
} as const;

// ─── Computation result ─────────────────────────────────────────────────────

/**
 * Shape of the result the future irradiance engine will produce.
 * The 2-second stub returns a uniform placeholder so the rest of
 * the UI can be built and tested in parallel with the real math.
 */
export interface IrradianceResult {
  /** Unix ms when the computation completed. */
  computedAt: number;
  /**
   * Annual irradiation in kWh/m²/year, averaged across the
   * active roof planes. The real engine will also return a
   * per-vertex grid (added in a future epic, not in this slice).
   */
  annualKwhPerM2: number;
}

// ─── Toast contract ─────────────────────────────────────────────────────────

/**
 * A single entry in the local irradiance toast queue. The toast
 * is a single-slot queue (one at a time) — this object carries
 * just enough state for the `IrradianceToast` component to render
 * and for the store to know when to clear it.
 */
export interface IrradianceToast {
  /** Stable id (for React key + clearTimeout). */
  id: string;
  /** "Irradiance Map was queued" — literal Aurora text. */
  title: string;
  /** Optional sub-line (e.g. "Calculating 1,450 kWh/m²/yr …"). */
  message?: string;
  /** Auto-dismiss timer handle, kept here so the store can clear it. */
  createdAt: number;
}

// ─── Hotkey contract ────────────────────────────────────────────────────────

/** The key Aurora binds to the irradiance toggle. */
export const IRRADIANCE_HOTKEY = 'i' as const;
/** User-visible label for the tooltip / docs. */
export const IRRADIANCE_HOTKEY_LABEL = '(I)';
/** Tooltip text — literal Aurora copy. */
export const IRRADIANCE_TOGGLE_TOOLTIP = `Toggle Irradiance Map ${IRRADIANCE_HOTKEY_LABEL}`;
/** Toast title — literal Aurora copy. */
export const IRRADIANCE_QUEUED_TOAST_TITLE = 'Irradiance Map was queued';

// ─── Stub timing ────────────────────────────────────────────────────────────

/** How long the placeholder computation takes. Matches the
 *  "actually doing work" timing so the toast is visible long
 *  enough to be read before the overlay appears. */
export const IRRADIANCE_COMPUTE_DELAY_MS = 2000;

/** How long the "Irradiance Map was queued" toast stays on screen. */
export const IRRADIANCE_TOAST_DURATION_MS = 3000;
