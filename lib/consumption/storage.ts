/**
 * lib/consumption/storage.ts
 *
 * localStorage helpers for the Consumption Profile. The form is
 * designed to work fully offline (the API is a stub) — rehydrating
 * from localStorage on mount lets users pick up where they left off.
 *
 * SSR-SAFE: every function checks for `typeof window` before touching
 * the global. Tests that run under `vitest` (Node env) get back
 * the "no data" path without errors.
 */

import type { ConsumptionProfileResult } from './types';

export const STORAGE_KEY = 'solarpro:consumption-profile';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Read the most recent saved profile. Returns null if nothing has
 * been saved yet, the stored value is malformed, or we are running
 * server-side.
 */
export function loadSavedProfile(): ConsumptionProfileResult | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    // Light shape check — full validation lives in the form.
    const candidate = parsed as ConsumptionProfileResult;
    if (typeof candidate.id !== 'string') return null;
    if (typeof candidate.createdAt !== 'string') return null;
    if (typeof candidate.updatedAt !== 'string') return null;
    if (!candidate.profile || typeof candidate.profile !== 'object') return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Persist a profile. Returns true on success, false on failure
 * (private-mode browsers, quota exceeded, SSR).
 */
export function saveProfile(result: ConsumptionProfileResult): boolean {
  if (!hasStorage()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    return true;
  } catch {
    return false;
  }
}

/**
 * Wipe the saved profile. Used by the "Reset" button in the form.
 */
export function clearSavedProfile(): boolean {
  if (!hasStorage()) return false;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
