/**
 * components/3d/irradiance/useIrradianceHotkey.ts
 *
 * Hook that wires the (I) keyboard shortcut into the irradiance
 * store. Designed to be called once from `SolarEngine3D.tsx`,
 * alongside the existing `setupKeyboardHandler` — but kept here
 * so the irradiance feature is self-contained and can be tested
 * in isolation.
 *
 * Usage from a parent that already owns a `window` keydown listener:
 *
 *   useEffect(() => {
 *     const off = bindIrradianceHotkey();
 *     return off;
 *   }, []);
 *
 * Or, if the parent prefers to fold the handler into an existing
 * onKey closure, call `isIrradianceHotkeyEvent(e)` directly and
 * dispatch to `useIrradianceStore.getState().toggle()` on a match.
 * (That second path is what `SolarEngine3D` takes to keep the
 * keydown listener count at one.)
 */

'use client';

import { useEffect } from 'react';
import { useIrradianceStore, isIrradianceHotkeyEvent } from './irradianceStore';

/**
 * Attach a `keydown` listener to `window` that fires the irradiance
 * toggle on bare-`I`. Returns an unsubscribe function. Safe to call
 * inside a `useEffect`.
 */
export function bindIrradianceHotkey(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!isIrradianceHotkeyEvent(e)) return;
    e.preventDefault();
    useIrradianceStore.getState().toggle();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

/**
 * React hook: bind the irradiance hotkey for the lifetime of the
 * calling component. Default target is `window`. Pass an HTMLElement
 * to scope the hotkey to a specific region (useful for embedded
 * viewers).
 */
export function useIrradianceHotkey(target: Window | HTMLElement = window): void {
  useEffect(() => {
    const off = bindIrradianceHotkey();
    if (target !== window) {
      // If a non-window target is provided, mirror the listener there
      // too. (Window binding is the primary path; the mirror is
      // convenience for embedded surfaces.)
      const handler = (e: KeyboardEvent) => {
        if (!isIrradianceHotkeyEvent(e)) return;
        e.preventDefault();
        useIrradianceStore.getState().toggle();
      };
      target.addEventListener('keydown', handler as EventListener);
      return () => {
        off();
        target.removeEventListener('keydown', handler as EventListener);
      };
    }
    return off;
  }, [target]);
}
