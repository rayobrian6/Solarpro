/**
 * components/3d/panel/hotkeys.ts
 *
 * Pure function: map a keydown event's key string to a design-phase tool id.
 *
 * Exported as a pure function so the unit tests can call it without jsdom,
 * without React, without a real KeyboardEvent. The component layer wraps
 * it in a useEffect that subscribes to window keydown events.
 *
 * Modifier keys (Ctrl/Cmd/Alt) are intentionally NOT handled here — when
 * any modifier is held, the caller should skip the handler so we don't
 * hijack browser shortcuts (Ctrl+S = save, Ctrl+C = copy, etc.).
 */

import type { ToolId } from './types';
import { DESIGN_TOOLS } from './tools';

/**
 * Map a single key string to a tool id.
 *
 * @param key — the value of a KeyboardEvent's `key` field. Case-insensitive
 *              (we lowercase before lookup, so 'A' and 'a' both work).
 * @returns   the matching tool id, or null if the key is unmapped.
 *
 * The mapping is built once at module load from the DESIGN_TOOLS table,
 * so adding a new hotkey is a one-line change in tools.ts.
 */
export function designHotkeyToToolId(key: string): ToolId | null {
  if (!key) return null;
  const k = key.toLowerCase();

  // Linear scan is fine — there are only 9 entries and this runs on
  // every keypress. Keep it readable.
  for (const entry of DESIGN_TOOLS) {
    if (entry.hotkey && entry.hotkey.toLowerCase() === k) {
      return entry.id;
    }
  }
  return null;
}

/**
 * Check whether a KeyboardEvent-like object has a modifier key held.
 * If so, the hotkey handler should bail to avoid hijacking browser shortcuts.
 */
export function hasModifierKey(event: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return Boolean(event.ctrlKey || event.metaKey || event.altKey);
}
