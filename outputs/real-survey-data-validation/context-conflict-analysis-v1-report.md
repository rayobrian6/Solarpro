# Engineering Context Conflict Analysis V1 Report

Engineering Context Resolution V1 preserves competing structured engineering signals as review-visible context metadata. The resolver never chooses a hidden winner when candidate signals are partial, blocked, missing, invalidated, or share duplicate source evidence ownership. Conflicts are represented as deterministic context state, conflict reasoning, competing signal ids, and conflict records in the resolution summary.

## Conflict detection

The conflict detector operates on candidate signals declared by each context definition. A signal participates in conflict analysis when it is partial, blocked, missing, invalidated, or owns evidence also used by another candidate signal. Duplicate evidence ownership is intentionally treated as a conflict trigger because it indicates that multiple structured signals are attempting to derive context from the same canonical evidence row. This preserves ambiguity for operator review rather than collapsing it into a single downstream requirement or output decision.

## Conflict outputs

Each conflicting or competition-bearing context exposes `competingSignalIds`, `conflictReasoning`, and a deterministic conflict record. Conflict records include a stable conflict id, context id, context type, domain, competing context ids, competing signal ids, reasoning, and a deterministic policy stating that competing signals must not be collapsed and that conflict metadata remains available for operator review and downstream invalidation awareness.

## Fallback and blocked-state preservation

Fallback lineage is not promoted into truth. Context fallback lineage may come from context-definition fallback allowance, missing explicit-primary lineage, CAD-readiness default policy fallbacks, structured signal blocking reasons, or linked structured-signal fallback participation. These rows remain visible through `fallbackLineage`, `fallbackParticipation`, and `fallbackConfidencePenalties`. Explicit-primary contexts with only supporting signal evidence become blocked rather than preferred. Optional contexts such as explicit trench path context can become not applicable when the explicit primary is absent and the definition allows optional-primary absence.

## Downstream behavior

Requirements, decisions, CAD readiness, and output impact surfaces can inspect conflicts, but the context layer does not authorize automatic plan-output creation or operator-free engineering decisions. Conflicting contexts are confidence-capped and remain traceable through signal ids, evidence ids, dependency lineage, invalidation lineage, stale classes, and timeline events.

## Regression coverage

The focused context test suite validates that shared evidence between primary and supporting electrical signals produces a conflicting MSP context, that the conflict record preserves its deterministic policy, and that fallback-dependent partial contexts retain fallback lineage and confidence penalties.
