// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-1 — RESOLVER REGISTRY + THE SHARED GUARDED READ
// ───────────────────────────────────────────────────────────────────────────
// Resolvers are REGISTERED implementations. The registry is the ONLY way the
// lifecycle discovers them, and the DI seam (`createResolverRegistry`) is how a
// test injects deterministic fixture providers without touching production code.
//
// DISCIPLINE (directive "Execution discipline"): NO PLACEHOLDER ALWAYS-
// UNRESOLVED RESOLVERS. A resolver is registered only when it actually performs
// its work. A requirement whose owning resolver arrives in a later phase carries
// `resolverId: null` in its DECLARATION and is surfaced loudly as
// RESOLVER-NOT-IMPLEMENTED in the evidence — it is never presented as a
// silently-final blocker.
// ═══════════════════════════════════════════════════════════════════════════

import type { RequirementResolver, ResolutionMode, SafeDbRead } from './types';

/**
 * THE shared guarded read. Copies the `authorityInputs.ts` per-read try/catch
 * discipline (`:91-95`, `:104-106`, `:120-122`, `:134-136`, `:149-151`) into one
 * helper every resolver MUST use, because `lib/documents/registry.ts` and
 * `lib/reconciliation/reconcile.ts` contain zero error handling and throw the
 * raw Postgres error (migrations 113/114 are written but NOT RUN ⇒ 42P01
 * `relation does not exist` on every live read today).
 *
 * FAIL-SOFT TO THE CALLER'S EXPLICIT `failSoftTo` VALUE — which must always be
 * the BLOCKER-FIRING state. It never fabricates a clear, and it reports `ok:
 * false` + the exact error so the failure is EVIDENCED rather than swallowed.
 */
export const safeDbRead: SafeDbRead = async <T>(
  label: string,
  read: () => Promise<T>,
  failSoftTo: T,
): Promise<{ value: T; ok: boolean; error: string | null }> => {
  try {
    const value = await read();
    return { value, ok: true, error: null };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string } | null;
    const code = e?.code ? `${e.code} ` : '';
    const msg = e?.message ?? String(err);
    // 42P01 = undefined_table (migration 113/114 not run). Named explicitly so a
    // "table missing" failure is never confused with a genuine "no document".
    const hint = e?.code === '42P01' ? ' [table absent — migration 113/114 not run]' : '';
    return { value: failSoftTo, ok: false, error: `${label}: ${code}${msg}${hint}` };
  }
};

export interface ResolverRegistry {
  register(r: RequirementResolver): void;
  get(id: string): RequirementResolver | null;
  all(): RequirementResolver[];
  byMode(mode: ResolutionMode): RequirementResolver[];
  /** every resolver that claims the code (⇒ the code MUST be attempted). */
  forRequirement(code: string): RequirementResolver[];
  ids(): string[];
}

export function createResolverRegistry(seed: readonly RequirementResolver[] = []): ResolverRegistry {
  const map = new Map<string, RequirementResolver>();
  const order: string[] = [];
  const reg: ResolverRegistry = {
    register(r: RequirementResolver): void {
      if (!r.id.trim()) throw new Error('resolver id is required');
      if (map.has(r.id)) throw new Error(`duplicate resolver id: ${r.id}`);
      map.set(r.id, r);
      order.push(r.id);
    },
    get(id: string): RequirementResolver | null { return map.get(id) ?? null; },
    all(): RequirementResolver[] { return order.map(id => map.get(id)!); },
    byMode(mode: ResolutionMode): RequirementResolver[] { return reg.all().filter(r => r.mode === mode); },
    forRequirement(code: string): RequirementResolver[] {
      return reg.all().filter(r => r.requirementCodes.includes(code));
    },
    ids(): string[] { return [...order]; },
  };
  for (const r of seed) reg.register(r);
  return reg;
}
