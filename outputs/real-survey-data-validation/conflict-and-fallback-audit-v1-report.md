# Conflict and Fallback Audit V1 Report

## Structured signals

`signalExtraction.ts` evaluates registry-defined structured signals from canonical evidence, deterministic photo grouping metadata, CAD readiness metadata, and invalidation metadata. Missing, blocked, partial, confirmed, and not-applicable statuses are preserved. Missing or blocked downstream readiness participation is represented through explicit fallback participation rows rather than hidden promotion.

## Context arbitration

`contextResolution.ts` ranks contexts by deterministic confidence score and `context.id` tie-break. It preserves authoritative, preferred, partial, conflicting, blocked, unresolved, and not-applicable contexts separately. Conflict rows preserve competing context IDs, competing signal IDs, conflict reasoning, and deterministic resolution policy. Fallback participation, fallback lineage, confidence penalties, dependency lineage, invalidation lineage, stale impacts, CAD readiness mappings, and stable hashes remain explicit.

## CAD readiness

`cadReadiness.ts` derives readiness from explicit evidence categories, structured signal status, and context resolution metadata. Rules that require explicit primary evidence do not promote supporting signals into readiness without primary truth. Unresolved assumptions list missing explicit categories, blocked signals, conflicting contexts, blocked contexts, and unresolved contexts. Default-policy fallback rows are visible and sorted.

## Stabilization applied

The context dependency graph now suppresses duplicate edge IDs deterministically. This protects graph semantics when context source/supporting/competing signal lineage overlaps. Regression coverage in `contextResolution.test.ts` verifies sorted, unique graph edge IDs.
