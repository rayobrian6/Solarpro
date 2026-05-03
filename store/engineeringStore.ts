/**
 * store/engineeringStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight Zustand slice for engineering page → SolarDog awareness bridge.
 *
 * The engineering page writes a snapshot of its control-plane state here
 * on every meaningful change. SolarDog reads from this store so it has
 * full situational awareness without requiring prop drilling.
 *
 * ARCHITECTURE:
 *   app/engineering/page.tsx
 *       │  useEffect → setEngineeringSnapshot(...)
 *       ↓
 *   engineeringStore (Zustand)
 *       │  useEngineeringStore(s => s.snapshot)
 *       ↓
 *   components/support/SolarDog.tsx → richContext.engineeringState
 *
 * RULES:
 *  - Engineering page is the ONLY writer.
 *  - SolarDog (and any other component) is read-only.
 *  - Snapshot is cleared when the engineering page unmounts.
 *  - Never store mutable objects; primitives + shallow copies only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use client';

import { create } from 'zustand';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * The fields the architecture spec (Phase 7) requires SolarDog to know about.
 * Keep this flat and serialisable — no React state objects, no circular refs.
 */
export interface EngineeringSnapshot {
  /** Which project is loaded in the engineering page. */
  projectId: string | null;

  // ── Control-plane flags ────────────────────────────────────────────────
  /** 'auto' | 'guided' | 'manual' — gates which pipelines may mutate config. */
  controlMode: 'auto' | 'guided' | 'manual';
  /** When true, the auto-apply watcher runs on every sizing recommendation. */
  sizingAutoApply: boolean;
  /** When true, user's inverter config is locked; auto-apply + smart-defaults are blocked. */
  userHasEditedInverters: boolean;

  // ── Display state ──────────────────────────────────────────────────────
  /** Which data source the STRING LAYOUT panel currently reads from. */
  displayMode: 'current' | 'recommended';

  // ── Panel count authority ──────────────────────────────────────────────
  /**
   * Which source provided the authoritative panel count.
   * Maps panelCountSource.ts `source` field to the simplified 'cad' | 'config' form.
   */
  panelCountSource: 'cad' | 'config' | 'none';
  /** Authoritative panel count (from CAD or config fallback). */
  panelCount: number;
  /** True when panelCountSource !== 'config' and it disagrees with config strings sum. */
  panelCountMismatch: boolean;

  // ── Sizing summary ────────────────────────────────────────────────────
  /** System kW DC. */
  systemKwDc: number;
  /** Inverter kW AC. */
  systemKwAc: number;
  /** Current inverter topology (micro | string | optimizer | hybrid). */
  topology: string;
  /** Inverter model display name. */
  inverterModel: string;
  /** Number of strings in current layout. */
  stringCount: number;

  // ── Compliance summary ────────────────────────────────────────────────
  /** Last-known compliance status. */
  complianceStatus: string | null;

  // ── Timestamp ────────────────────────────────────────────────────────
  /** Unix ms when this snapshot was last updated. */
  updatedAt: number;
}

const NULL_SNAPSHOT: EngineeringSnapshot = {
  projectId:              null,
  controlMode:            'auto',
  sizingAutoApply:        false,
  userHasEditedInverters: false,
  displayMode:            'current',
  panelCountSource:       'none',
  panelCount:             0,
  panelCountMismatch:     false,
  systemKwDc:             0,
  systemKwAc:             0,
  topology:               'string',
  inverterModel:          '',
  stringCount:            0,
  complianceStatus:       null,
  updatedAt:              0,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export interface EngineeringStore {
  snapshot: EngineeringSnapshot;
  setEngineeringSnapshot: (patch: Partial<EngineeringSnapshot>) => void;
  clearEngineeringSnapshot: () => void;
}

export const useEngineeringStore = create<EngineeringStore>()((set) => ({
  snapshot: NULL_SNAPSHOT,

  setEngineeringSnapshot: (patch) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        ...patch,
        updatedAt: Date.now(),
      },
    })),

  clearEngineeringSnapshot: () =>
    set({ snapshot: { ...NULL_SNAPSHOT, updatedAt: Date.now() } }),
}));

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectEngineeringSnapshot = (s: EngineeringStore) => s.snapshot;

/**
 * Convenience: maps the raw panelCountSource string from panelCountSource.ts
 * to the simplified 'cad' | 'config' | 'none' form the snapshot uses.
 */
export function simplifyPanelCountSource(
  raw: 'cad-panels' | 'cad-total' | 'system-definition' | 'config-fallback' | 'none',
): EngineeringSnapshot['panelCountSource'] {
  if (raw === 'cad-panels' || raw === 'cad-total' || raw === 'system-definition') return 'cad';
  if (raw === 'config-fallback') return 'config';
  return 'none';
}