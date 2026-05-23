# SolarPro Master Roadmap: Engineering OS + Controlled Intelligence Platform V1

## Executive intent

SolarPro's target architecture is a deterministic engineering operating system that can safely host controlled probabilistic assistance without allowing that assistance to become engineering authority. The platform should preserve canonical engineering truth, deterministic replayability, explicit provenance, explainable derived state, reviewer accountability, CAD-grade rendering discipline, and operational continuity across survey intake, evidence hygiene, engineering intelligence, decision lineage, state invalidation, document generation, rendering, and future assistance layers.

This roadmap records the long-term direction for SolarPro after the completion of the deterministic Engineering Intelligence foundation, the Assisted Evidence Sandbox baseline, the open-source source governance foundation, and the first controlled metadata/photo-quality runtime pilot. It is a planning and governance artifact only. It does not add runtime behavior, dependency changes, database migrations, canonical mutation paths, workflow mutation paths, CAD generation behavior, OCR, computer-vision runtime, model inference, or autonomous engineering decisions.

The core product principle is that SolarPro may become more intelligent over time, but it must never become opaque. Every added capability must be explainable, replayable, provenance-linked, review-aware, and bounded by deterministic policy. Probabilistic assistance may identify possible issues, candidates, hints, quality risks, duplicate hygiene concerns, or review queues, but canonical engineering truth must continue to come only from explicit survey evidence, reviewed evidence projections that have passed separately approved mapping layers, deterministic registries, and auditable engineering rules.

## Non-negotiable platform invariants

SolarPro must preserve a single canonical engineering truth boundary. Raw uploads, site survey rows, reviewed metadata, canonical evidence manifests, engineering requirement evaluations, engineering decision provenance, document provenance, CAD readiness metadata, render context metadata, output impact records, invalidation metadata, and regeneration planning metadata must remain distinct. No layer may silently duplicate truth or create an alternate authority path. Derived layers may explain, group, rank, invalidate, annotate, or queue review, but they may not override canonical evidence without an explicit, reviewed, deterministic mapping layer.

Deterministic replayability is mandatory. Any artifact used for engineering inspection, review, document provenance, CAD readiness, output impact, invalidation, or runtime governance must be reconstructable from declared inputs, registry versions, tool versions, configuration hashes, source hashes, timestamps supplied by callers or deterministic fallbacks, and stable ordering. Hashes must be stable over normalized structures. Candidate and runtime outputs must include provenance sufficient to replay or quarantine their effects. Non-replayable behavior is not acceptable for engineering authority.

Review accountability is mandatory wherever assistance crosses from informational context into possible engineering relevance. Assistance may create candidates, but candidates must be non-authoritative and review-required unless a future directive explicitly creates a narrower safe class. Accepted review projections must record reviewer id, reviewed timestamp, accepted fields, rejected fields, notes, candidate hash, source candidate id, and canonical participation status. Candidate acceptance must not equal canonical mutation. Canonical mapping must remain a separately approved, explicit layer.

Provenance must be visible and inspectable. The platform should make it possible to answer which survey upload, canonical evidence row, registry requirement, deterministic signal, resolved context, engineering decision, graph edge, invalidation trigger, reviewed projection, runtime tool, adapter version, and render input contributed to a visible engineering or document state. Hidden fallback promotion, hidden conflict resolution, hidden workflow mutation, and hidden output mutation are prohibited.

Engineering continuity must be preserved. Changes to survey evidence, candidate metadata, reviewed projections, requirements, decisions, documents, rendering contexts, or CAD-readiness inputs must propagate through explicit invalidation, stale-state preservation, snapshot deltas, and regeneration planning. The system should support safe continuity: preserving still-valid outputs, identifying stale or blocked outputs, explaining why a state changed, and showing what human review or explicit evidence is required before downstream regeneration.

Runtime governance is mandatory. Open-source tools and any future runtime must be registered before use, categorized by allowed capability, bounded by adapter contracts, licensed and risk-classified, deterministic where required, prohibited from canonical mutation, and covered by boundary scans. Runtime imports must be contained. Runtime output must normalize into review-required candidate forms unless a future approved governance layer creates a different bounded path. OCR, semantic image understanding, object detection, segmentation, geometry extraction, model inference, network inference, CAD influence, recommendation influence, workflow orchestration, and canonical mutation remain prohibited unless separately approved through future high-risk phases.

CAD-grade rendering discipline is mandatory. CAD-grade work must not be driven by unreviewed assistance or fabricated geometry. Rendering should be deterministic, provenance-bound, and traceable to explicit engineering inputs. CAD readiness can inspect whether required evidence and contexts are available, but readiness metadata is not itself geometry. Future CAD evolution must preserve exactness, layer discipline, stable primitives, sheet reproducibility, document provenance, and explicit blocked states where required evidence is missing.

## Current foundation snapshot

Phase 0, the deterministic engineering foundation, is largely complete as a platform base. Existing artifacts describe canonical survey evidence hygiene, engineering requirement registries, deterministic photo grouping, structured engineering signals, context resolution, CAD-readiness metadata, engineering decision provenance, document provenance, dependency traversal, state invalidation, snapshot deltas, regeneration planning metadata, workspace visualization, boundary scans, topology checks, and validation discipline. The foundation has already established the core pattern of explicit evidence flowing into deterministic derived state and review-visible outputs.

Phase 1, the Assisted Evidence Sandbox baseline, is complete as a containment model. The sandbox creates non-authoritative assisted evidence candidates, routes candidates through review-required lifecycle controls, supports accepted/rejected/invalidated/superseded states, and prevents direct influence over canonical evidence, requirements, CAD readiness, recommendations, workflow orchestration, and engineering truth. Boundary scans enforce containment, and the Engineering Intelligence admin UI surfaces candidate status as review-only.

Phase 2, controlled runtime execution, has begun. The open-source tool registry and fixture adapter foundation established a governed intake model for source tools. The first runtime pilot selected and registered `sharp-metadata-runtime@0.34.5` using `sharp@0.34.5` under Apache-2.0 licensing for server-only image metadata/photo-quality extraction. That pilot is intentionally narrow: metadata and photo-quality signals only, normalized into non-authoritative review-required candidates. It does not perform OCR, semantic visual interpretation, object detection, segmentation, geometry extraction, CAD generation, recommendation influence, workflow orchestration, network inference, or canonical mutation.

The next phases should build from these foundations without weakening them. The central challenge is to increase usefulness while keeping assistance subordinate to deterministic engineering truth.

## Phase 0: Deterministic Engineering Foundation

The foundation phase establishes the deterministic backbone of the SolarPro Engineering OS. Its purpose is to make survey evidence, requirements, decisions, documents, state, and outputs inspectable and reproducible before adding progressively more assistance. This phase is considered largely complete, but it remains the architectural baseline for all later work.

The maintained foundation should include canonical survey evidence manifests, evidence hygiene, deterministic grouping, structured signal extraction from explicit metadata, context resolution, requirement evaluation, CAD-readiness metadata, decision provenance, document provenance, dependency graphs, state registries, persistent graph construction, invalidation propagation, stale state preservation, snapshot deltas, regeneration planning metadata, and Engineering Intelligence workspace inspection. Each derived object should retain deterministic ordering, stable hashes where appropriate, explicit source ids, and visible blocked or missing states.

Future work in this phase should be treated as hardening rather than conceptual expansion. Priorities include reducing remaining topology warnings, optimizing deterministic graph operations without changing output contracts, expanding focused regression tests around invalidation and replay, and improving operator visibility for conflict, fallback, and blocked states. Any foundation change must preserve existing truth boundaries and must not introduce probabilistic interpretation.

Exit criteria for the maintained foundation are stable topology checks, passing engineering boundary scans, deterministic test coverage for major graph and replay paths, clear provenance from canonical evidence to visible engineering outputs, and no hidden fallback promotion.

## Phase 1: Assisted Evidence Sandbox

The Assisted Evidence Sandbox phase establishes the quarantine model for non-authoritative assistance. The sandbox is not a secondary evidence store and not a back door into engineering truth. It is a candidate and review system designed to let future tools surface possible metadata, quality issues, duplicate hygiene, or evidence organization hints while preserving human accountability and canonical separation.

The baseline is complete and should remain the only approved entry point for future assisted evidence candidates. Candidate records must remain non-authoritative, review-required, provenance-linked, confidence-bounded, invalidatable, and unable to satisfy requirements, mark CAD readiness, generate recommendations, create workflow actions, or mutate canonical evidence. Reviewed projections may become eligible for future mapping, but they do not mutate canonical truth by themselves.

Future hardening should improve review ergonomics, candidate filtering, invalidation visibility, and audit export. The platform should make it easier for reviewers to see why a candidate exists, what source produced it, which fields are being proposed, what limitations apply, whether a source file or tool version invalidated it, and what downstream objects remain blocked until explicit canonical evidence or approved mappings exist. UI language must continue to use terms such as possible, candidate, non-authoritative, review-required, and informational until a reviewed and mapped canonical state exists.

Exit criteria for this phase are durable candidate lifecycle tests, visible review-only UI surfaces, boundary scans that prevent candidate-to-truth imports, and clear documentation that candidates cannot become engineering authority without a separately approved reviewed mapping layer.

## Phase 2: Controlled Runtime Execution

Controlled runtime execution introduces real tools only after registry intake, risk review, license review, adapter containment, deterministic normalization, replay planning, and boundary validation. This phase is active and currently limited to the metadata/photo-quality runtime pilot. The governing rule is that runtime execution may create candidates, not truth.

The current approved runtime category is image metadata/photo quality only. The approved path is registered runtime to adapter extraction, adapter extraction to normalized payload, normalized payload to createCandidate, candidate to markReviewRequired, and review-only surfacing. The runtime may inspect image metadata through the approved server adapter, but it must not inspect image content semantically or infer engineering facts. The output may include orientation candidates, low-resolution or invalid-dimension quality candidates, large-image quality candidates, missing-metadata candidates, and metadata-only duplicate hygiene candidates. These remain review-required.

Near-term work in Phase 2 should focus on operationalizing this pilot rather than expanding capability. Priorities include runtime replay records, payload hash audits, runtime adapter health reports, failure-mode handling, fixture-to-runtime comparison reports, admin filtering by fixture versus runtime source, source file eligibility checks, deterministic sample corpus validation, and safe reviewer workflows for candidate disposition. The platform should establish how runtime outputs are retained, invalidated, replayed, and audited before any additional runtime family is considered.

Any expansion beyond metadata/photo quality must be treated as a new governance gate. OCR text candidates, visual categorization candidates, semantic scene hints, geometry-adjacent assistance, model-backed classification, or network-backed inference are not incremental changes to the current pilot. They are separate risk classes requiring new directives, registry categories, boundary updates, tests, reports, and explicit non-authoritative review semantics.

Exit criteria for controlled runtime execution are a stable registry, contained server-only adapters, deterministic replay support or explicit quarantine of non-replayable tools, passing boundary scans, no unauthorized runtime imports, no canonical mutation, no recommendation or workflow influence, and full validation artifacts for each approved runtime.

## Phase 3: Survey Intelligence Evolution

Survey Intelligence Evolution should improve how SolarPro organizes, explains, and validates survey evidence without converting assistance into truth. This phase may expand deterministic and review-required tooling around survey completeness, photo sequence continuity, upload hygiene, missing category visibility, reviewer triage, recapture requests, and evidence-to-requirement inspection.

The safe path is to build on existing deterministic photo grouping, evidence manifests, requirement registries, candidate review lifecycle, and invalidation metadata. The system may identify that required evidence appears missing based on canonical categories and explicit survey fields. It may show reviewers that a runtime candidate suggests a quality problem. It may queue human review or recapture requests through deterministic policy if the queue item is explicitly review-only and does not mutate engineering truth. It must not infer equipment identity, roof geometry, code compliance, conductor routing, panel capacity, structural suitability, or permit readiness from unreviewed candidates.

Potential deliverables include a survey review cockpit, candidate-aware evidence triage, deterministic recapture reason registry, explicit missing-evidence explanations, reviewer workload queues, and audit exports that join canonical gaps with candidate hints. The key distinction is that deterministic workflow may point a human toward review, but it must not complete the engineering task for them.

Exit criteria are reviewer-visible survey intelligence surfaces, no hidden candidate promotion, tests proving candidates cannot satisfy requirements, and deterministic queues that reference blocked requirements and candidate ids without mutating them.

## Phase 4: Geometry-Adjacent Assistance

Geometry-adjacent assistance is a future high-risk phase and must not be treated as an extension of the metadata runtime pilot. Any work near roof edges, routing continuity, trench context, detached structures, or spatial hints can easily be mistaken for engineering geometry. Therefore this phase requires explicit governance before implementation and should initially be limited to review-only annotations, not CAD primitives or measurements.

A safe geometry-adjacent path would produce non-authoritative hints that a reviewer can inspect. It must avoid fabricating dimensions, roof planes, setbacks, usable areas, spans, conductor routes, trench paths, or CAD-ready geometry. It must not generate layout primitives, change render contexts, satisfy structural or electrical requirements, or trigger CAD regeneration. If future tools mark possible regions or continuity hints, those hints must remain candidates with limitations, confidence bounds, source hashes, tool versions, and reviewer decisions.

Before this phase begins, SolarPro should add stricter boundary scans, visual-assistance risk registers, candidate-to-CAD isolation tests, candidate-to-requirement isolation tests, candidate-to-workflow isolation tests, and UI language reviews. Any model-backed or computer-vision-backed tool should be registered as a high-risk runtime and disabled by default until a directive approves a narrow pilot.

Exit criteria for any early geometry-adjacent pilot would include zero CAD influence, zero geometry truth, zero autonomous measurement, review-only candidate display, explicit reviewer acceptance semantics, replay or quarantine policy, and documented reasons why outputs cannot be used as engineering authority.

## Phase 5: CAD-Grade Rendering Evolution

CAD-grade rendering evolution is a major future initiative focused on deterministic rendering quality, document reproducibility, layer discipline, primitive traceability, sheet-level provenance, and safe regeneration. This phase should improve the quality and auditability of CAD and permit outputs without allowing unreviewed assistance to drive geometry or plan content.

The rendering stack should continue to derive from explicit engineering inputs, deterministic calculations, canonical evidence, reviewed mappings where approved, and registry-backed decisions. Rendered elements should be traceable to input records and decision provenance. Missing or blocked inputs should appear as visible validation or provenance warnings rather than being silently replaced by defaults. CAD readiness can say whether a domain appears ready, partial, blocked, or not applicable, but CAD readiness is not a license to invent geometry.

Future deliverables may include stronger primitive identity models, deterministic layer registries, sheet provenance overlays, render diff inspection, CAD output snapshot hashes, selective regeneration boundaries, output impact previews, and reviewer approval gates for high-impact plan changes. These should be implemented as deterministic infrastructure before any assistance is allowed to suggest CAD-adjacent changes.

Exit criteria are reproducible CAD/document outputs, stable render hashes or diff metadata where feasible, explicit provenance for rendered sections, guarded regeneration paths, and tests proving unreviewed candidates cannot modify render context or CAD primitives.

## Phase 6: Engineering Continuity Platform

The Engineering Continuity Platform phase turns deterministic provenance, graph traversal, invalidation, snapshots, stale-state preservation, and regeneration planning into an operational system for managing change. The objective is not to automate engineering decisions, but to preserve continuity when inputs change and to make required human action clear.

The platform should show what changed, what became stale, what remains valid, which outputs are impacted, which requirements are blocked, which reviewed projections need revalidation, and which regeneration actions are safe or blocked. Continuity should include audit trails across survey changes, requirement registry changes, decision changes, document changes, CAD-readiness changes, and approved runtime/candidate version changes.

Future deliverables may include operator-facing change workspaces, regeneration approval queues, output impact dashboards, stale-state preservation policies, reviewer assignment flows, and deterministic replay packs. Assistance may help prioritize review, but it must not silently regenerate high-impact outputs, mutate workflows, or make operator-free engineering decisions.

Exit criteria are transparent change lineage, deterministic invalidation results, explainable regeneration plans, explicit blocked states, and no autonomous output mutation.

## Phase 7: Trusted Assistance + Supervised Mapping

Trusted Assistance + Supervised Mapping is a distant phase where reviewed candidate outputs may be mapped into canonical or canonical-adjacent metadata through explicitly approved rules. This phase is where the platform can begin converting certain human-reviewed assistance into durable engineering inputs, but only with strict separation between candidate generation, reviewer decision, mapping policy, canonical participation, invalidation, and replay.

A safe supervised mapping layer must be explicit. It should declare which reviewed projection types are eligible, which fields may map, which canonical or reviewed-evidence target they can affect, what reviewer role is required, what conflicts block mapping, what evidence categories remain impossible to infer, what invalidation triggers apply, and how the mapping is reversed or superseded. Mapping must be diffable and auditable. It must not treat confidence as authority.

This phase should start with low-risk metadata fields, not engineering measurements. Potential low-risk fields could include reviewed orientation metadata, reviewed recapture status, reviewed duplicate relationship, reviewed quality flag, or reviewed evidence categorization if the category does not itself satisfy high-risk requirements without additional explicit evidence. High-risk fields such as electrical ratings, structural values, roof dimensions, code compliance, interconnection decisions, and CAD geometry should remain outside early supervised mapping.

Exit criteria are explicit mapping registries, reviewer accountability, deterministic mapping hashes, conflict and invalidation handling, rollback or supersession semantics, and tests proving unmapped candidates still have no canonical influence.

## Phase 8: Enterprise Engineering Operating System

The long-term target is an enterprise-grade engineering operating system that coordinates survey evidence, design readiness, document provenance, CAD-grade rendering, review operations, runtime governance, controlled assistance, change continuity, and audit exports across projects and teams. The platform should enable scale without weakening trust.

At this stage SolarPro should support organization-level governance policies, runtime allowlists, evidence quality dashboards, reviewer accountability reports, deterministic replay packages, project-to-project template governance, CAD/document output lineage, enterprise audit exports, and role-based controls over high-impact mapping and regeneration actions. Assistance can be present throughout the system, but it must remain governed, explainable, review-aware, and subordinate to deterministic truth.

The enterprise system succeeds when operators can inspect every important output, understand its evidence lineage, reproduce its derivation, identify stale dependencies, review assistance separately from truth, and approve high-impact changes with confidence. It fails if it becomes an opaque automation system that silently mutates engineering state.

Exit criteria are enterprise governance controls, reproducible audit packages, scalable review workflows, durable runtime governance, CAD/document lineage at project scale, and continued enforcement of no probabilistic authority.

## Cross-phase validation discipline

Every phase must include validation appropriate to its risk. Baseline checks should include TypeScript type-checking, targeted regression tests, full Vitest suites where feasible, production build, lint, topology checks, engineering boundary checks, assisted evidence boundary checks when candidate or runtime code is touched, and report artifacts under `outputs/real-survey-data-validation/`. Runtime phases must additionally include registry validation, adapter tests, replay tests, boundary import containment tests, unsafe-category rejection tests, and explicit logs or exit-code artifacts when requested.

Validation must prove negative boundaries, not just happy paths. Tests should demonstrate that candidates cannot satisfy requirements, cannot mark CAD readiness, cannot generate recommendations, cannot orchestrate workflows, cannot mutate canonical evidence, cannot bypass review, cannot import prohibited runtimes outside approved adapters, and cannot silently convert probabilistic outputs into deterministic truth.

Reports should record scope, implementation boundaries, prohibited behavior, validation commands, passing results, deferred risks, and next safe steps. The repository should continue to use direct commits to `dev` when explicitly required by project rule and should not create branches unless instructed.

## Prohibited evolution patterns

SolarPro must never evolve into uncontrolled AI automation, probabilistic engineering authority, hidden state mutation, silent inference, opaque workflow mutation, non-replayable engineering behavior, duplicated truth sources, unreviewed CAD generation, autonomous requirement satisfaction, autonomous permit readiness, or hidden default promotion. These are not implementation details; they are product-level failure modes.

Any future proposal that introduces OCR, semantic image understanding, object detection, segmentation, geometry extraction, model inference, LLM reasoning over engineering gaps, network inference, recommendation influence, workflow influence, CAD influence, database mutation, or canonical mapping must explicitly state its boundary, risk class, review model, replay model, validation plan, and reason it cannot become engineering authority without human approval.

## Recommended immediate next steps

The next practical work should keep Phase 2 narrow and operational. Recommended next steps are to create a runtime replay and audit pack for the metadata/photo-quality pilot, add source-file eligibility and failure-mode reporting for runtime candidates, expand admin filtering and review ergonomics for fixture versus runtime candidates, and produce deterministic sample-corpus validation that confirms stable payload hashes and candidate ordering across representative image metadata cases.

After the metadata runtime is operationally stable, SolarPro can consider a formal Phase 3 survey intelligence workstream focused on reviewer triage and deterministic recapture queues. That workstream should still avoid OCR, semantic image interpretation, geometry assistance, CAD influence, recommendation influence, and autonomous workflow mutation unless a separate directive authorizes a specifically bounded pilot.

## Success condition

SolarPro succeeds if it becomes a deterministic engineering platform capable of safely integrating controlled probabilistic assistance without sacrificing engineering trust, reproducibility, CAD-grade quality, review accountability, provenance visibility, runtime governance, or operational continuity. The platform should become more capable by making its boundaries stronger, not weaker.
