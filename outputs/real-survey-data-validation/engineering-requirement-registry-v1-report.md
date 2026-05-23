# Engineering Requirement Registry v1 Report

Engineering Requirement Registry v1 adds a centralized deterministic requirement source of truth on top of the canonical survey evidence, duplicate hygiene, provenance, and traceability architecture. The implementation preserves the architectural boundary that raw `site_surveys` and upload rows remain immutable audit history, while `evidenceHygiene.canonicalManifest` and its canonical evidence representatives are the downstream engineering truth.

## Registry structures

The registry is implemented in `lib/survey/evidence/engineeringRequirements.ts`. It defines normalized engineering requirement records for `main_service_panel`, `utility_meter`, `roof_overview`, `attic_access`, `subpanel`, `main_disconnect`, `structural_access`, `utility_bill`, `placards`, `rapid_shutdown`, `battery_location`, and `service_equipment_label`.

Each requirement definition includes the requested deterministic fields: `requirementId`, `humanLabel`, `description`, `requiredEvidenceCategories`, `optionalEvidenceCategories`, `minimumCanonicalEvidenceCount`, `metadataCompletenessRules`, `engineeringUsage`, `permitUsage`, `confidencePolicy`, `readinessImpact`, `missingSeverity`, `futureCapabilities`, and `active` state. Inactive future requirements remain listed in the registry for normalization but are excluded from readiness and completeness scoring.

## Requirement evaluation engine

`buildEngineeringRequirementEvaluation()` evaluates requirements from the canonical manifest and provenance traceability bundle. The evaluator does not inspect raw uploads, image bytes, OCR output, CV output, CAD geometry generation output, or semantic inference. It deterministically produces `satisfiedRequirements`, `missingRequirements`, `partiallySatisfiedRequirements`, `blockedRequirements`, `informationalRequirements`, `inactiveRequirements`, and `allRequirements`.

Each requirement evaluation carries canonical evidence ids, originating survey ids, originating timestamps, provenance records, traceability records, duplicate-collapsed status, failed metadata rules, confidence source, reasoning path, and deterministic notes. Duplicate uploads cannot inflate satisfaction because satisfaction counts unique canonical evidence ids only; duplicate groups are represented only as provenance group sizes and duplicate-collapsed notes.

## Engineering integrations

`lib/survey/evidence/engineeringBridge.ts` now builds and exposes `requirementEvaluation` and derives bridge readiness from the registry. It accepts an optional traceability bundle so project-level duplicate hygiene can preserve duplicate group provenance through registry evaluation. `lib/engineering/surveyEvidence.ts` now exposes `requirementEvaluation`, derives completeness from the registry summary, derives missing categories from blocking registry requirements, and creates blockers/warnings from registry evaluations instead of scattered hard-coded category assumptions.

## Permit integrations

`lib/permit/sections/validationPage.ts` now renders Engineering Requirement Registry rows, deterministic missing requirement analysis, requirement provenance, inactive future flags, and blocked registry conditions. The previous fallback that manufactured engineering bridge counts from raw photo arrays was removed. Permit validation consumes the registry output when available and otherwise reports that no registry evaluation was provided.

## Survey UI additions

`app/projects/[id]/survey/[surveyId]/page.tsx` now displays expandable registry-driven sections in the survey evidence viewer: Engineering Requirement Registry, Requirement Satisfaction Summary, Missing Requirement Analysis, Requirement Provenance, and Inactive Future Capability Flags. The UI reads from `bridge.requirementEvaluation` and does not manufacture independent requirement state.

## Tests

Focused regression coverage was added and updated across `lib/survey/evidence/engineeringRequirements.test.ts`, `lib/survey/evidence/sessionGrouping.test.ts`, `lib/survey/evidence/manifest.test.ts`, `lib/engineering/surveyEvidence.test.ts`, and `lib/permit/validationPageSurveyEvidence.test.ts`. The tests verify deterministic missing requirements, duplicate upload collapse without inflated satisfaction, provenance linkage survival through evaluation, registry-derived engineering readiness/completeness, registry-derived permit rendering, and inactive future flags remaining informational.

## Boundary confirmation

No OpenCV runtime logic, OCR runtime logic, YOLO/runtime CV classification, image-byte inspection, perceptual hashing, semantic inference, CAD inference, or CAD generation logic was introduced. Engineering sizing calculations were not modified. Future capability flags such as `supportsOCR`, `supportsCVClassification`, `supportsCADInference`, and `supportsSemanticExtraction` are metadata only and do not activate runtime intelligence.

## Validation status

Focused tests passed with `18 passed` across the five focused test files. `npm run type-check` passed with exit code `0`. `npm run build` passed with exit code `0`. The prohibited-boundary scan found only inert future capability labels, explicit boundary metadata, existing external-worker/future-only references, and deterministic “no runtime intelligence” notes; no runtime OpenCV, OCR, YOLO, image-byte inspection, perceptual hashing, semantic inference, CAD inference, or CAD generation implementation was introduced.
