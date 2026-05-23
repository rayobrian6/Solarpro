# Document Provenance + Requirement Binding Foundation v1 Report

## Scope

Document Provenance + Requirement Binding Foundation v1 adds a deterministic bridge layer between canonical survey evidence, Engineering Requirement Registry v1 evaluations, provenance traceability, and document/render pipelines. The implementation is provenance-binding architecture only. It does not add OpenCV, OCR, YOLO, semantic inference, CAD generation, image-byte inspection, perceptual hashing, geometry hallucination, or engineering sizing changes.

The layer preserves the existing truth boundary: immutable raw uploads and `site_surveys` remain audit/history inputs, while `evidenceHygiene.canonicalManifest` and derived registry/provenance outputs remain downstream engineering evidence truth. The new structures are additive metadata carriers for document auditability and do not change CAD solving, SLD topology, BOM sizing, or engineering calculations.

## Provenance structures added

The implementation adds `lib/documentProvenance/types.ts`, `lib/documentProvenance/builders.ts`, `lib/documentProvenance/guards.ts`, `lib/documentProvenance/requirementDocumentBindings.ts`, and `lib/documentProvenance/index.ts`.

`DocumentProvenanceBundle` normalizes document-level provenance. Each bundle includes `documentId`, `documentType`, `requirementIds`, `canonicalEvidenceIds`, `originatingSurveyIds`, `provenanceSource`, `engineeringDependencyIds`, `confidenceSource`, `renderInputs`, `truthSource`, `generatedAt`, `deterministicNotes`, `sections`, `auditGuards`, and an optional `dependencyGraph`. Canonical evidence ids are de-duplicated before they are emitted into document provenance, preventing repeated uploads from inflating document truth.

`DocumentProvenanceSection` carries section-level provenance for permit sheets, SLD sections, plan-set sections, render contexts, and summaries. Each section records bound requirement ids, canonical evidence ids, originating survey ids, dependency ids, confidence source, render inputs, truth source, and deterministic notes. This makes it possible for future renderers to expose which registry requirements and canonical evidence records supported a visible document element.

`DocumentRenderInputs` records deterministic input categories, including high-level permit inputs, canonical inputs, CAD primitive ids, and explicit legacy fallback keys. Raw upload counts are not represented as render truth.

## Requirement-document bindings added

`RequirementDocumentBinding` creates deterministic requirement-to-document mappings derived from `ENGINEERING_REQUIREMENT_REGISTRY`, avoiding duplicated requirement logic. The binding registry maps each requirement to known document targets and policies:

- `main_service_panel` binds to `VAL-1.registry`, `E-1.interconnection`, and `SLD.service-equipment`.
- `utility_meter` binds to `VAL-1.registry`, `E-1.utility-meter`, and `SLD.utility-meter`.
- `roof_overview` binds to `VAL-1.registry`, `PV-1.site-verification`, `PV-2.layout-verification`, and `PV-2.layout-context`.
- `attic_access` binds to `VAL-1.registry` and `PV-3.structural-review`.
- `subpanel` binds to `VAL-1.registry` and `E-1.optional-subpanel`.
- `main_disconnect` binds to `VAL-1.registry`, `E-1.disconnect`, and `SLD.disconnect`.
- `structural_access` binds to `VAL-1.registry` and `PV-3.structural-access`.
- `battery_location` binds to `VAL-1.registry`, `PV-1.ess-location`, and `ESS.location-context`.
- inactive future requirements such as `utility_bill`, `placards`, `rapid_shutdown`, and `service_equipment_label` bind only as inactive or future-context records unless already represented by existing document sections.

Each binding exposes required/optional evidence categories, provenance linkage mode, missing-behavior policy, blocked render policy, informational-only policy, and deterministic notes. Blocking registry requirements currently render warnings/provenance rather than stopping the whole permit package, preserving the existing permit behavior while making bypasses visible and auditable.

## Render-context and permit integrations added

`EngineeringSurveyEvidence` now carries optional `documentProvenance`. `collectEngineeringSurveyEvidence()` builds an initial permit-package provenance bundle from the canonical manifest, registry evaluation, traceability bundle, and deterministic render input metadata.

`PermitInput` now accepts optional `documentProvenance`, allowing permit pipelines to carry the bundle explicitly.

`generatePermitHTML()` now builds a `DocumentProvenanceBundle` when `surveyEvidence` is present, attaches it to the permit input, and passes it into `buildRenderContext()`. This makes the permit generator and its render context provenance-aware without changing sizing, CAD solving, BOM generation, SLD rendering, or sheet calculations.

`RenderContext` now includes `documentProvenance: DocumentProvenanceBundle | null`. This is additive metadata only. Templates may continue rendering normally when the bundle is absent, and no renderer uses the provenance bundle to infer geometry or sizing.

`renderPlanSet()` can now receive `documentProvenance` through its engineering options and passes it to `RenderContext`. The standalone plan-set route is not fully refactored, but the core drafting render context is now capable of preserving provenance when callers provide it.

`pageValidationSummary()` now renders a compact `Document Provenance + Requirement Bindings` section showing document id, document type, truth source, confidence source, bound requirements, canonical evidence links, originating surveys, dependency graph size/hash, audit guard status, and section-level provenance rows.

## Audit guards added

`runDocumentAuditGuards()` and `assertDocumentProvenanceGuards()` add deterministic route/render audit checks:

- `registry_evaluation_required` fails when a document provenance bundle lacks Engineering Requirement Registry evaluation.
- `canonical_truth_required` warns when provenance is not backed by `canonical_manifest_v1`.
- `raw_upload_count_not_render_truth` fails when raw upload count exists without canonical evidence, preventing raw uploads from silently becoming render truth.
- `section_provenance_required` fails when document sections lose requirement/dependency provenance.
- `render_context_provenance_required` fails when a render-context provenance bundle does not retain sections/dependencies.

The guards are deterministic and inspect existing typed provenance structures only. They do not read image bytes, inspect file contents, or infer document meaning.

## Generators now provenance-aware

The permit evidence adapter, permit HTML generator, permit validation sheet, and drafting `RenderContext` are now provenance-aware. The core `renderPlanSet()` function is provenance-capable when a caller supplies a bundle. SLD, standalone plan-set route, BOM route, engineering calculations, engineering reports, and proposal rendering were not fully refactored in this version; they remain legacy/body/design-driven consumers except for future compatibility through shared provenance structures and render context extensions.

## Tests added

`lib/documentProvenance/documentProvenance.test.ts` adds focused regression coverage proving duplicate uploads do not inflate document provenance, document sections retain canonical evidence linkage, provenance survives render contexts, registry bypass attempts fail audit guards, raw uploads cannot silently become render truth, and the dependency graph remains deterministic.

## Validation status

Focused regression tests passed with `1 passed` test file and `6 passed` tests using `npx vitest run lib/documentProvenance/documentProvenance.test.ts --reporter=verbose` with exit code `0`. `npm run type-check` passed with exit code `0`. `npm run build` passed with exit code `0`. The prohibited-boundary scan found no runtime implementation of OpenCV, OCR, YOLO, semantic inference, CAD generation, image-byte inspection, perceptual hashing, geometry hallucination, or engineering sizing changes. Remaining matches were explicit report/todo boundary-confirmation language only.
