# Visual Categorization Runtime Pilot V1 Report

Controlled Visual Categorization Pilot V1 was implemented as a governed assisted-evidence runtime on branch `dev`. The runtime is intentionally narrow: it emits only review-required possible photo-category candidates and does not perform object detection, segmentation, geometry extraction, engineering inference, CAD readiness analysis, recommendation generation, workflow creation, or canonical evidence mutation.

## Implemented runtime

The pilot added a new server-side governed runtime named `deterministic-visual-categorization-runtime@1.0.0`. It is registered in `lib/assistedEvidenceSources/openSourceToolRegistry.ts` with runtime category `visual_categorization_candidate`, candidate type `visual_category_candidate`, server adapter boundary `server_adapter_contract`, `reviewRequired: true`, `canonicalMutationAllowed: false`, no model weights, no native binaries, and no browser execution.

The runtime implementation lives in:

- `lib/assistedEvidenceSources/visualCategorizationRuntimeTypes.ts`
- `lib/assistedEvidenceSources/visualCategorizationRuntimeAdapter.ts`
- `lib/assistedEvidenceSources/visualCategorizationRuntimeBridge.ts`
- `lib/assistedEvidenceSources/visualCategorizationRuntimeAdapter.test.ts`

The assisted-evidence candidate type union was expanded with `visual_category_candidate` in `lib/assistedEvidence/types.ts`. Existing candidate normalization was updated so provenance notes distinguish controlled visual categorization output from OCR and metadata output.

## Allowed candidate labels

The runtime is restricted to exactly these review-required possible photo-category labels:

- `possible_roof_photo`
- `possible_attic_photo`
- `possible_msp_photo`
- `possible_inverter_photo`
- `possible_meter_photo`
- `possible_equipment_label_photo`
- `possible_utility_bill_photo`
- `possible_site_overview_photo`
- `possible_obstruction_photo`

These labels remain candidate payload values only. They are not canonical survey evidence categories, engineering facts, equipment confirmations, geometry truth, or CAD inputs.

## Runtime method

The pilot uses `deterministic_source_context_and_byte_hash`. It computes deterministic hashes from the input bytes and optional source-context text supplied to the bridge. Source-context text can weakly suggest possible labels when it contains terms such as roof, attic, meter, main service panel, inverter, equipment label, utility bill, overview, or obstruction. If no source-context term matches, the runtime emits a deterministic low-confidence fallback candidate based on the byte hash. This fallback exists only to prove deterministic replay behavior and is intentionally low confidence.

The runtime does not import or call OpenCV, YOLO, TensorFlow, ONNX, MediaPipe, Detectron, segmentation libraries, `lib/vision`, external vision services, or browser image APIs. It does not emit bounding boxes, polygons, coordinates, roof edges, setbacks, conduit paths, obstruction maps, object detections, geometry outputs, engineering conclusions, CAD readiness, recommendations, workflow actions, or canonical mutations.

## Assisted-evidence lifecycle

The bridge resolves the registered runtime through `getRegisteredOpenSourceTool()` and verifies candidate emission through `assertToolCanEmitCandidateType()`. The adapter returns normalized payloads and routes candidate creation through `createReviewRequiredCandidates()`, which uses `createCandidate()` and `markReviewRequired()`. Candidate payloads include runtime hashes, evidence basis, limitations, non-spatial/non-geometric flags, non-authoritative/review-required flags, and forbidden-use declarations.

Accepted visual candidates remain projection-only through the existing review lifecycle. The reviewed projection status remains `active_reviewed_projection` with `canonicalParticipationStatus: 'eligible_for_mapping'`; no automatic canonical mapping occurs.

## Targeted test coverage

`lib/assistedEvidenceSources/visualCategorizationRuntimeAdapter.test.ts` verifies:

- governed registry approval for the visual runtime;
- rejection of unregistered and unsafe visual runtime definitions;
- deterministic candidates for the same image and context;
- deterministic runtime hashes;
- bounded confidence;
- provenance attachment;
- review-required and non-authoritative candidate status;
- allowed labels only;
- no geometry, object detection, CAD, workflow, recommendation, or canonical mutation payload fields;
- sandbox guard functions remain false for requirements, CAD readiness, recommendations, and workflows;
- accepted review projections remain projection-only and do not automatically mutate canonical evidence.

## Validation results

Final validation logs were captured in `outputs/real-survey-data-validation/visual-categorization-validation-v1/`. The final summary reports `VALIDATION_STATUS=passed` with exit code `0` for all required commands:

- `npm run check:engineering-boundaries`
- `npm run check:topology`
- `npm run check:assisted-evidence-boundaries`
- `npm run type-check`
- `npm exec vitest -- lib/assistedEvidenceSources/visualCategorizationRuntimeAdapter.test.ts --run`
- `npm test`
- `npm run build`
- `npm run lint`

## Safety conclusion

The visual categorization pilot remains non-authoritative, non-spatial, non-geometric, review-required, provenance-preserved, deterministic, confidence-bounded, server-side only, registry-governed, adapter-contained, and isolated from canonical mutation and downstream engineering authority.
