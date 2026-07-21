// Read-side accessor for sheet templates (W2+). Sheets project the snapshot;
// they never mutate, supplement, or recalculate it (W1 req. 3). A sheet asked
// to render WITHOUT a validated snapshot is a fail-closed condition — never a
// silent fallback to legacy derivations.
import type { PermitInput } from '../types';
import type { PermitDesignSnapshot } from './types';

export function getSnapshot(input: PermitInput): Readonly<PermitDesignSnapshot> {
  const s = (input as unknown as { _snapshot?: PermitDesignSnapshot })._snapshot;
  if (!s || !s.meta?.snapshotId) {
    throw new Error('[PermitDesignSnapshot] sheet rendered without a validated snapshot — generation order violation (fail closed)');
  }
  return s;
}

/** Non-throwing peek for code paths that run OUTSIDE permit generation
 *  (e.g. standalone SLD route) — callers must handle null explicitly. */
export function peekSnapshot(input: PermitInput): Readonly<PermitDesignSnapshot> | null {
  const s = (input as unknown as { _snapshot?: PermitDesignSnapshot })._snapshot;
  return s?.meta?.snapshotId ? s : null;
}
