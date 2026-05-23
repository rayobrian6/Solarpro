# Engineering Intelligence Workspace UI v1 Report

## Summary

Engineering Intelligence Workspace UI v1 adds the first internal/admin UI layer over SolarPro's deterministic engineering architecture. The workspace is designed as a deterministic engineering-state visualization surface rather than an AI copilot, autonomous engineering system, CRM dashboard, or fake CAD generator.

The implementation introduces an admin workspace that exposes engineering health, canonical evidence grouping, requirement registry status, engineering decision provenance definitions, stale-state and invalidation surfaces, snapshot timeline surfaces, dependency graph visualization, selective regeneration planning visualization, and audit guard visualization.

## Architectural Placement

The UI is intentionally placed above existing deterministic state/provenance modules. It imports from the existing engineering-state invalidation, engineering decision provenance, and engineering requirement registry layers. It does not introduce upward imports into lower architecture layers and does not move backend logic into client components.

The new deterministic view-model layer is located at:

- `lib/engineeringIntelligence/types.ts`
- `lib/engineeringIntelligence/workspace.ts`
- `lib/engineeringIntelligence/index.ts`

The admin routes and panels are located at:

- `app/admin/engineering-intelligence/page.tsx`
- `app/admin/engineering-intelligence/project/[id]/page.tsx`
- `app/admin/engineering-intelligence/snapshots/page.tsx`
- `app/admin/engineering-intelligence/graph/page.tsx`
- `app/admin/engineering-intelligence/components.tsx`

## Workspace Panels Added

### Engineering Health Dashboard

The dashboard exposes deterministic counts for valid outputs, stale outputs, invalidated outputs, blocked outputs, regeneration candidates, active audit guard warnings, snapshot versions, dependency graph node counts, dependency graph edge counts, evidence completeness source, and requirement satisfaction source. When no project snapshot is supplied, the dashboard explicitly displays registry/empty-state counts instead of generating fake project health.

### Canonical Evidence Workspace

The evidence workspace groups canonical evidence into the requested operational buckets: utility, electrical, roof, structural, routing, detached structures, ESS, and trench/ground mount. Each group exposes linked requirement ids and, when project snapshot references are supplied, canonical evidence ids, provenance state ids, duplicate collapse count placeholders, linked requirements, linked document sections, and stale-state impact. Duplicate collapse counts are not inferred when a canonical manifest is absent.

### Requirement Workspace

The requirement workspace renders Engineering Requirement Registry v1 definitions and shows satisfied, missing, inactive, and not-loaded status surfaces depending on whether project snapshot state is available. Each requirement row exposes linked evidence ids, linked decision ids, linked document section ids, dependency references, and stale impact state ids when those deterministic references exist.

### Engineering Decision Workspace

The decision workspace renders deterministic engineering decision registry definitions, including conductor sizing, breaker sizing, inverter selection, MPPT assignment, ESS placement assumptions, setback assumptions, BOM derivation, and SLD metadata. Each card exposes governing rule ids, dependency lineage, explicit fallback/default chain indicators, affected outputs, and stale impact ids. It does not generate decisions or infer selected values.

### Stale-State / Invalidation Workspace

The invalidation workspace surfaces stale outputs, invalidation chains, triggering canonical evidence ids, affected decision ids, affected requirement ids, downstream state ids, preserved outputs, and regeneration scope. It reads transition history and selective regeneration plan metadata when supplied. No regeneration action is executed by the UI.

### Snapshot Timeline Workspace

The snapshot workspace displays persistent engineering state snapshot ids, snapshot hashes, diff counts, and transition event counts. Snapshot hashes are treated as durable metadata and are not recomputed in the UI.

### Dependency Graph Viewer

The graph viewer renders a deterministic SVG/HTML graph preview from persistent graph nodes and edges when supplied. Without a persistent graph, it displays registry nodes only. Supported visual node concepts include requirements, decisions, dependency nodes, document-section/state outputs, and stale outputs. Supported edge concepts include depends-on, invalidates, preserves, and generated-by mappings from the persisted engineering state graph.

### Regeneration Planning Workspace

The regeneration planning workspace displays selective regeneration plans, regeneration candidates, regeneration order, blocked dependencies, and preserved outputs. It visualizes deterministic planning metadata only. It does not initiate autonomous regeneration.

### Audit Guard Workspace

The audit guard workspace displays supplied engineering state audit guard results and groups failures into topology, provenance, orphaned-node, stale-lineage, and invalid-render-context categories. It does not hide or downgrade warnings/failures.

## Deterministic Behavior

The workspace model is built by `buildEngineeringIntelligenceWorkspace`. It deterministically sorts routes, requirements, decisions, graph nodes, graph edges, snapshots, diffs, plans, and guard rows. When project-bound snapshots, graphs, histories, plans, or guard outputs are absent, the UI uses explicit not-loaded or registry-visible states instead of fabricating downstream engineering truth.

Raw uploads, raw site survey arrays, and raw photo counts are not used by the workspace as engineering truth. Downstream project truth remains expected to come from canonical evidence, requirement evaluations, decision provenance, document provenance, engineering state snapshots, transition history, and persistent graph state.

## Prohibited Runtime Confirmation

This implementation does not introduce OpenCV runtime, OCR runtime, YOLO runtime, semantic inference, autonomous regeneration, autonomous CAD generation, image-byte inspection pipelines, perceptual hashing, AI-generated engineering decisions, hallucinated geometry, or hidden AI reasoning.

The graph viewer uses deterministic SVG layout inside the admin UI. No graph library with nondeterministic layout was added.

## Validation Results

The following validation was run after the Engineering Intelligence Workspace UI v1 implementation:

- `npm run check:topology` passed. The guard scanned 722 source files, reported the known unprotected `lib/utilityDetector.ts > lib/proposalTruthEngine.ts > lib/utilityDetector.ts` cycle, reported three known directional architecture warnings, found zero hard directional violations, and passed.
- `npm run type-check` passed with `tsc --noEmit` and no TypeScript errors.
- `npm test` passed with 140 test files and 4833 tests passing.
- `npm run build` passed. Build emitted expected sandbox/runtime environment warnings for missing `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY`, and `NEXT_PUBLIC_BASE_URL`, then compiled successfully and generated static pages.
- `npm run lint` exited successfully with existing repo-wide warnings such as `no-console`; no lint failure was introduced by this workspace.
- `bash scripts/full-system-regression-audit-scans.sh` completed and generated the regression audit logs. The prohibited-boundary log contains pre-existing references and negative guardrail text; the new Engineering Intelligence files only contain explicit negative guardrail statements and no prohibited runtime implementation.
