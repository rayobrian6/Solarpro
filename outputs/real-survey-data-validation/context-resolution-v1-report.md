# Engineering Context Resolution V1 Report

Engineering Context Resolution V1 adds a deterministic arbitration layer between Structured Engineering Signals V1 and downstream requirements, decisions, CAD-readiness inspection, and output-impact reporting. The implemented flow is `canonical evidence -> grouped survey metadata -> structured engineering signals -> engineering context resolution -> requirements -> decisions -> outputs`. The context layer does not create a second truth source. It ranks, groups, and explains already-structured evidence lineage so downstream surfaces can see which engineering context is authoritative, preferred, partial, conflicting, blocked, unresolved, or not applicable.

## Implemented model

The public model is defined in `lib/engineeringIntelligence/contextTypes.ts`. The deterministic registry is defined in `lib/engineeringIntelligence/contextRegistry.ts`, and the resolver is implemented in `lib/engineeringIntelligence/contextResolution.ts`. The model version is `engineering_context_resolution_v1`.

A resolved context records its stable id, context type, domain, status, source signal ids, supporting signal ids, competing signal ids, canonical evidence ids, deterministic metadata ids, dependency lineage, invalidation lineage, stale-impact propagation, regeneration participation, affected outputs, CAD-readiness impacts, requirement impacts, decision impacts, deterministic confidence, ranking reason, conflict reasoning, fallback lineage, unresolved dependencies, fallback confidence penalties, and a deterministic hash.

The registry covers roof, routing, electrical, ESS, utility, detached/trench, and survey-quality domains. Context definitions declare primary signal types, supporting signal types, CAD-readiness flags, requirement impacts, decision impacts, affected outputs, explicit-primary requirements, optional-primary behavior, and whether deterministic fallback participation is allowed. The resolver evaluates the registry in a stable order and returns contexts sorted by context id. Confidence ranking is score-descending with context-id tie-breaking; rank values are then written back to the sorted context list.

## Deterministic inputs

The resolver consumes only canonical manifest metadata, deterministic photo grouping metadata, structured engineering signal summaries, CAD-readiness metadata, invalidation results, and invalidation propagation metadata. It carries source evidence ids and dependency nodes forward rather than interpreting runtime imagery or generating new measurements. Structured-signal fallback participation is preserved when linked candidate signals carry fallback lineage, so fallback-dependent contexts remain visible and receive deterministic confidence penalties.

## Boundary guarantees

The context layer declares scanner-safe prohibited behavior: no text extraction runtime over survey imagery, no computer-vision runtime dependency, no vision model runtime dependency, no pixel inspection or image-byte inspection, no semantic visual interpretation, no detected-object promotion, no language-model reasoning over context gaps, no geometry fabrication, no operator-free plan-output creation, no operator-free engineering decisioning, no hidden fallback promotion, no silent conflict resolution, and no autonomous regeneration.

## Integration points

Project hydration now builds context resolution after final structured signals and signal-aware CAD readiness are available, then rebuilds CAD readiness with context participation annotations. The Engineering Intelligence workspace model exposes resolved contexts, arbitration, conflict inspection, fallback chains, provenance, dependency graph, confidence breakdown, invalidations, stale impacts, and timeline views. The admin project page renders these context workspaces after signal inspection and before CAD-readiness inspection. `lib/engineeringIntelligence/index.ts` exports the context types, registry, and resolver.

## Regression coverage

`lib/engineeringIntelligence/contextResolution.test.ts` validates authoritative and preferred contexts from structured signals, conflict preservation without silent winner selection, fallback-dependent partial contexts with confidence penalties, explicit-primary blocked contexts versus optional not-applicable contexts, and CAD-readiness annotation with linked resolved context states.
