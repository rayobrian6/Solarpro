/**
 * Click Audit Logger — Debug utility for tracking UI interactions.
 * 
 * Usage:
 *   logClick('ACTION_NAME')           — log a button/icon click
 *   logClick('ACTION_NAME', { id })   — log with metadata
 *   logNavigation('/route')           — log a navigation event
 * 
 * All entries print as: [CLICK] ACTION_NAME { ...meta }
 * Errors print as:      [CLICK ERROR] ACTION_NAME { error }
 */

export function logClick(action: string, meta?: Record<string, unknown>): void {
  try {
    console.log('[CLICK]', action, meta ?? '');
  } catch {
    // Never throw from debug logging
  }
}

export function logNavigation(route: string): void {
  logClick('NAVIGATE', { route });
}

/**
 * Wraps an async action with click logging + error catching.
 * Returns a new function safe to use as onClick.
 */
export function safeAction(
  actionName: string,
  fn: () => void | Promise<void>,
  meta?: Record<string, unknown>
): () => void {
  return () => {
    logClick(actionName, meta);
    try {
      const result = fn();
      if (result instanceof Promise) {
        result.catch((err) => {
          console.error('[CLICK ERROR]', actionName, (err as Error)?.message || err);
        });
      }
    } catch (err: unknown) {
      console.error('[CLICK ERROR]', actionName, (err as Error)?.message || err);
    }
  };
}