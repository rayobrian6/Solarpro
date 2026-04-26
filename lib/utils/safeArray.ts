/**
 * lib/utils/safeArray.ts
 *
 * Safely coerce any value into an array.
 * Prevents runtime crashes when APIs return null, undefined, objects, or unexpected shapes.
 *
 * Usage:
 *   const items = safeArray(response?.data);
 *   items.map(...)  // always safe
 */

export function safeArray<T = any>(input: unknown): T[] {
  if (Array.isArray(input)) return input as T[];
  return [];
}

/**
 * Safely coerce a value into a number. Returns fallback (default 0) on NaN/null/undefined.
 */
export function safeNum(input: unknown, fallback = 0): number {
  if (input === null || input === undefined || input === '') return fallback;
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Safely coerce a value into a string. Returns fallback (default '') on null/undefined.
 */
export function safeStr(input: unknown, fallback = ''): string {
  if (input === null || input === undefined) return fallback;
  return String(input);
}