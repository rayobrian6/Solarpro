# Live Project Graph Hydration v1 Report

## Scope
This report documents the live project graph hydration path after replacing demo-only project routing with real project UUID routing.

## Hydration Entry Point
Project graph hydration continues to enter through `/admin/engineering-intelligence/project/[id]`. The route now validates that `[id]` is a UUID before calling `hydrateProjectEngineeringIntelligenceFromDb({ projectId, userId })`. This preserves the existing live hydration stack while preventing placeholder identifiers from reaching database queries.

## Real Data Inputs
The graph and workspace model are hydrated from the existing deterministic project engineering pipeline, which loads real project survey sessions and files, builds canonical evidence hygiene, derives canonical evidence manifests, evaluates requirements, assembles provenance, builds persistent engineering state graph metadata, generates snapshot metadata, evaluates invalidation metadata, and prepares selective regeneration plan metadata where real upstream evidence exists.

## Graph Edge Contract
Graph relationships remain deterministic and derived from canonical evidence/provenance/state builders. The required relationship directions are preserved by the existing workspace hydration architecture: evidence to requirement, requirement to decision, decision to output, output to stale state, evidence change to invalidation, and invalidation to regeneration candidate. The routing change does not create mock edges or synthetic graph relationships.

## Empty Graph Behavior
If no persistent graph snapshot is available for a project, the UI continues to render an explicit `no_graph` state in `DependencyGraphViewer`. Registry-visible requirement and decision nodes may be shown as empty-state context, but they are not presented as fabricated project evidence or fake persistent graph edges.

## Snapshot and Invalidation Behavior
Snapshot history, transition metadata, invalidation chains, stale outputs, preserved outputs, and regeneration scope remain loaded from the deterministic engineering state hydration model when available. If unavailable, the existing UI panels render explicit `no_snapshot`, `not_loaded`, or equivalent empty states rather than generated history.

## CAD-Readiness Metadata
CAD-readiness remains metadata-only through `buildCADReadinessMetadata`. The project route passes the real project id and hydrated canonical evidence context where available; it does not generate CAD, infer geometry from images, or run autonomous design/regeneration.

## Duplicate and Provenance Awareness
The live hydration path remains connected to canonical evidence hygiene and duplicate-collapse-aware evidence manifests. Counts are not inflated from duplicate uploads; canonical groups and duplicate collapse metadata remain part of the evidence model.

## Prohibited Behavior Confirmation
No AI/CV/OCR/YOLO/image-byte analysis, semantic inference, autonomous CAD generation, hallucinated geometry, fake graph state, or autonomous regeneration runtime behavior was introduced by this phase.
