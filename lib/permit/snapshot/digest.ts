// Canonical-JSON SHA-256 digest for the PermitDesignSnapshot.
// snapshotId is CONTENT-DERIVED ('PDS-' + digest prefix) so identical designs
// produce identical ids (byte-identical re-render determinism holds).
import { createHash } from 'crypto';

/** Deterministic JSON: object keys sorted recursively, no whitespace.
 *  undefined values are dropped (JSON semantics); Maps/Sets are not allowed
 *  in the snapshot (plain data only). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

/** SHA-256 hex over the canonical JSON of the snapshot WITHOUT meta.digest /
 *  meta.snapshotId (they derive from this). */
export function computeSnapshotDigest(snapshot: Record<string, unknown>): string {
  const meta = { ...(snapshot.meta as Record<string, unknown>) };
  delete meta.digest;
  delete meta.snapshotId;
  const body = { ...snapshot, meta };
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

export function snapshotIdFromDigest(digest: string): string {
  return `PDS-${digest.slice(0, 12).toUpperCase()}`;
}

/** Deep-freeze after validation — the snapshot is immutable authority (req. 2). */
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}
