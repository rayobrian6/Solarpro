# Visual Categorization Boundary V1 Report

This report documents the boundary expansion and final validation status for Controlled Visual Categorization Pilot V1.

## Boundary posture

The pilot is review-only assisted evidence. It does not provide object detection, segmentation, roof modeling, geometry extraction, CAD generation, semantic engineering authority, recommendation authority, workflow authority, or canonical evidence mutation.

## Expanded boundary guard

`scripts/check-assisted-evidence-boundaries.js` was expanded to cover controlled visual categorization risks. The guard now checks assisted-evidence runtime files for forbidden imports and active patterns involving:

- legacy `lib/vision` imports;
- `lib/system/visionPatch` imports;
- OpenCV/cv2 escalation;
- YOLO/Ultralytics escalation;
- TensorFlow escalation;
- PyTorch escalation;
- ONNX escalation;
- MediaPipe escalation;
- Detectron/segmentation escalation;
- external vision-service references such as `VISION_SERVICE_URL` or `/vision/infer`;
- legacy detection types such as `VisionDetection`, `VisionInferenceResult`, and `VisionBoundingBox`;
- active spatial outputs such as bounding boxes, polygons, coordinates, roof edges, setbacks, conduit paths, obstruction maps, and geometry truth;
- CAD, engineering, recommendation, and workflow influence;
- direct canonical mutation;
- survey table mutation;
- duplicate image metadata/OCR/runtime systems outside approved adapter files;
- candidate-generation paths that do not resolve a registered runtime or delegate to an approved registered bridge;
- adapters that bypass `createCandidate()`/`createReviewRequiredCandidates()` or `markReviewRequired()`/`createReviewRequiredCandidates()`.

The guard also preserves existing metadata and OCR runtime restrictions and allows only narrowly approved hashing/image-byte handling inside approved runtime adapters.

## Legacy CV risk handling

The audit identified existing legacy/roadmap CV artifacts under `lib/vision` and type references from `lib/system/visionPatch.ts`. The pilot does not import or call those files. The boundary guard now treats those paths as forbidden inside assisted-evidence runtime files. This ensures the visual categorization pilot cannot silently reuse YOLO-style detection aggregation, bounding-box types, external vision services, or geometry-adjacent outputs.

## Runtime-specific safeguards

The visual runtime registry entry is constrained to:

- `runtimeCategory: 'visual_categorization_candidate'`;
- `allowedCandidateTypes: ['visual_category_candidate']`;
- `allowedRuntimeBoundary: 'server_adapter_contract'`;
- `enabledStatus: 'enabled_for_runtime_pilot'`;
- `serverOnly: true`;
- `browserCompatible: false`;
- `requiresNativeBinaries: false`;
- `requiresModelWeights: false`;
- `reviewRequired: true`;
- `canonicalMutationAllowed: false`.

`openSourceToolValidation.ts` rejects visual runtime definitions that attempt browser execution, model weights, native binaries, blocked geometry boundaries, canonical mutation, or non-visual candidate types.

## Validation evidence

Final validation logs are stored in `outputs/real-survey-data-validation/visual-categorization-validation-v1/`. The final `validation-summary.txt` reports `VALIDATION_STATUS=passed` and exit code `0` for:

- `check-engineering-boundaries`
- `check-topology`
- `check-assisted-evidence-boundaries`
- `type-check`
- `targeted-visual-runtime-tests`
- `npm-test`
- `build`
- `lint`

The full test suite passed with 158 test files and 4924 tests passing in the captured `npm-test.log`.

## Boundary guarantees

The implemented pilot preserves these guarantees:

- categorization remains non-authoritative;
- no geometry extraction exists in the pilot;
- no object detection exists in the pilot;
- no segmentation exists in the pilot;
- no engineering authority exists in the pilot;
- no CAD influence exists in the pilot;
- no recommendation influence exists in the pilot;
- no workflow influence exists in the pilot;
- no canonical mutation exists in the pilot;
- all visual outputs remain review-required assisted evidence candidates;
- accepted review results remain projection-only and do not automatically map to canonical survey evidence.
