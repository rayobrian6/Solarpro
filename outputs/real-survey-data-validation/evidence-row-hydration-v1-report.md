# Evidence Row Hydration v1 Report

## Scope
This report documents the deterministic Evidence Row Hydration v1 implementation for the Engineering Intelligence Workspace. The change moves canonical evidence groups beyond registry-visible shells by hydrating row-level canonical evidence records from the real project survey evidence traceability bundle.

## Data sources
Evidence rows are sourced from `surveyEvidence.traceability.canonicalEvidence`, with requirement linkage from `surveyEvidence.requirementEvaluation.allRequirements`, graph linkage from the persistent engineering state graph, stale impact linkage from `invalidationResult.invalidationEvents`, regeneration candidate linkage from selective regeneration plans, and CAD readiness linkage from `buildCADReadinessMetadata` flags.

## Hydrated row fields
Each canonical row now exposes `canonicalEvidenceId`, evidence category and label, originating survey id, originating survey timestamp, duplicate group size, canonical representative status, canonical selection reason, evidence truth source, evidence source, evidence confidence, metadata completeness, linked requirements, linked decisions, linked document sections, linked outputs, linked graph nodes, linked graph edges, linked CAD readiness flags, readiness impact, deterministic field-quality signals, stale impacted state ids, stale impact reasons, and regeneration candidate ids.

## Required groups
The hydration model maps real canonical evidence categories into Utility, Electrical, Roof, Structural, Routing, Detached Structures, ESS, and Trench / Ground Mount groups. Groups with no matching canonical evidence rows remain explicit `no_evidence` states rather than synthesizing MSP, attic, routing, trench, ESS, detached-structure, or ground-mount evidence.

## Truth boundary
Snapshot-only rows are only emitted when no canonical traceability records are supplied to the workspace context. When real canonical traceability exists, group membership is based on matching canonical evidence categories only. This prevents requirement-linked state refs from making unrelated evidence appear in a group.

## Regression coverage
`lib/engineeringIntelligence/projectHydration.test.ts` now asserts row hydration from real survey files, survey origin timestamps, duplicate collapse metadata, canonical selection reason, requirement/decision/output/graph links, CAD readiness flags, stale impacts, regeneration candidates, and explicit missing-state signals for minimal walkaround survey data.
