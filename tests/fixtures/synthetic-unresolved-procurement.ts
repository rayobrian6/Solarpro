// ═══════════════════════════════════════════════════════════════════════════
// SYNTHETIC UNRESOLVED-PROCUREMENT FIXTURE.
//
// WHY THIS EXISTS — the same reason `synthetic-pending-grounding.ts` exists.
//
// A batch of tests asserted "the Q-Cable procurement is INSUFFICIENT" by reading
// the live/frozen package. That was never the property they guard. The property
// is: *while the procurement is unresolved, nothing may present the base cable
// quantity as orderable, the candidate connectors stay candidates, the blocker
// carries its payload, and every surface states the same deficit.* Whether THIS
// project is unresolved is a fact about the evidence archive — and WS-2 resolved
// it from an archived manufacturer manual, which is an improvement, not a
// regression.
//
// So the unresolved state is MANUFACTURED here, through the build's own
// authority socket, by REFUSING the field-termination authority. That is a real,
// precise, fail-closed condition (`resolveQCableProcurement` returns
// present:false with a stated reason), the live project keeps its resolution,
// and no test has to be weakened to expect a shortfall that no longer exists.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Authority bundle that REFUSES the Q-Cable field-termination authority.
 *
 * An explicit `null` (not `undefined`) is what refuses it — `undefined` means
 * "use the archived accessor", which is the live behaviour.
 */
export function unresolvedProcurementAuthority() {
  return { qcableFieldTerminationAuthority: null };
}

/** Merge the refusal into an existing authority bundle. */
export function withUnresolvedProcurement<T extends object>(authority: T | null | undefined): T {
  return { ...(authority ?? ({} as T)), ...unresolvedProcurementAuthority() };
}
