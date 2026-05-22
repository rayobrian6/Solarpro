# Survey Evidence Manifest v1 — Real Survey Data Validation Pass

Date: 2026-05-22
Branch: `dev`
Baseline commit before this pass: `43fd663 Harden survey evidence foundation`
Validation mode: Field-truth verification before OpenCV/AI/CV/CAD

## Executive conclusion

Survey Evidence Manifest v1 is structurally usable as the canonical evidence foundation, but the real-data validation pass exposed a critical field-truth weakness in the original hardened state: real technician/human labels from the available partner audit snapshot were not being interpreted by the manifest when they were stored as `site_survey_files.label`. Before this pass, all ten field-derived uploaded-photo labels in the available audit snapshot collapsed into `uncategorized`. That meant the manifest was technically correct as a strict registry, but operationally too brittle for real survey uploads.

This pass hardened the manifest without starting any prohibited AI/CV/CAD work. The fix is deterministic: uploaded file labels are first normalized by exact alias lookup, and only if that fails, the manifest applies the existing registry text-inference function. No OpenCV, YOLO, OCR, Claude image reasoning, Open3D, FreeCAD, segmentation, CAD automation, or permit AI extraction was introduced.

After the deterministic label fallback, the available real audit snapshot improved from `10/10 uncategorized` to `7 uncategorized`, `2 overview`, and `1 meter`. This is a meaningful improvement, but it is not a full real-world validation victory. The uploaded image URLs in the audit snapshot currently return `404`, so actual photo-byte validation remains blocked. The system still cannot truthfully claim validation against blurry photos, duplicate angles, rotated images, dark attic photos, detached garages, mixed shots, wrong visual categories, or actual image quality conditions until live storage or restored photo files are available.

## Real-data source and access limitations

The sandbox did not contain live production database credentials. Runtime build output also confirmed missing `DATABASE_URL` and `JWT_SECRET`, so live `site_surveys` and `site_survey_files` queries could not be performed from this environment.

The only available real-data artifact was `partner_db_audit.md`, a prior live pull from the `site_survey_app` Render PostgreSQL database. It contains 11 submitted survey records and 10 uploaded photo URL references with field labels such as `unlabeled`, `Got that sauce`, `Site Access Photo`, `Meter Photo`, and `Overhead Line Photo`. This artifact was treated as field-derived metadata, not as a synthetic fixture and not as a substitute for live DB access.

All ten Render upload URLs listed in the audit returned `404` with JSON `{"error":"Not found"}` during validation. That blocks direct visual/photo validation. The validation could verify label normalization, grouping, required warning generation, bridge counts, and future-worker metadata shape using real field-derived labels and URLs, but it could not verify the actual image contents.

## Category normalization findings

The required canonical alias examples validate correctly through the registry:

| Input | Canonical result |
|---|---|
| `utility_meter` | `meter` |
| `site_exterior` | `overview` |
| `attic_rafter` | `rafters` |
| `roof_obstruction` | `obstructions` |
| `grounding_bonding` | `grounding` |

The real partner-audit labels exposed the stronger operational finding:

| Real label | Exact alias normalization | Text inference | Final manifest behavior after this pass |
|---|---:|---:|---:|
| `Meter Photo` | `uncategorized` | `meter` | `meter` |
| `Site Access Photo` | `uncategorized` | `overview` | `overview` |
| `Overhead Line Photo` | `uncategorized` | `uncategorized` | `uncategorized` |
| `Got that sauce` | `uncategorized` | `uncategorized` | `uncategorized` |
| `unlabeled` | `uncategorized` | `uncategorized` | `uncategorized` |

A misleading intermediate behavior was found and corrected during this pass: `Site Access Photo` previously inferred to `attic_access` because the text inference treated any token `access` as attic access. That was not field-truth-safe. The inference order now resolves `site` or `exterior` to `overview` before generic `access` can map to `attic_access`. This prevents a site access photo from falsely strengthening structural/attic evidence.

The system still correctly refuses to invent categories from slang or ambiguous labels. `Got that sauce` remains `uncategorized`. `Overhead Line Photo` also remains `uncategorized`; it may eventually deserve a deliberate alias such as `utility_connection`, but that decision should be made explicitly with field review rather than guessed automatically.

## Real snapshot results

The field snapshot harness processed the available prior live audit metadata: 9 survey groups with 10 uploaded file references. After this pass, category counts were:

```json
{
  "uncategorized": 7,
  "overview": 2,
  "meter": 1
}
```

This is better than the initial all-uncategorized result, but it also shows how sparse the available field data is. Most real uploads still do not provide enough trustworthy label information to satisfy required evidence coverage. That is not a manifest failure; it is a survey capture/technician workflow problem that the manifest now exposes instead of hiding.

## Technician behavior findings

The available real audit snapshot shows technician upload behavior is messy and inconsistent. Several uploads are unlabeled. At least one label is slang/non-evidence text (`Got that sauce`). Some labels are human-readable but not canonical (`Meter Photo`, `Site Access Photo`, `Overhead Line Photo`). The manifest must therefore continue to preserve the original `submittedCategory` while separately reporting the canonical category. This is essential for operational traceability: field operations can see what the technician actually submitted, while engineering receives normalized evidence only where deterministic normalization is defensible.

The snapshot also suggests partial/under-captured surveys are common. Required categories are frequently missing. The manifest correctly reports these as warnings rather than pretending the survey is complete.

Because the image files are unavailable, this pass could not validate technician behavior involving blur, duplicate angles, rotation, dark attic photos, detached garages, mixed roof/electrical shots, wrong visual categories, or over-uploaded angle spam. Those remain open real-world validation items, not completed ones.

## Required evidence warning usefulness

Required canonical categories are still `main_service_panel`, `meter`, `roof_plane`, and `overview`. In the field snapshot, missing-required warnings fired heavily because most survey groups lacked enough mapped evidence. This is useful and truthful: the manifest does not block construction, but it makes evidence gaps explicit.

The warning model is appropriate for this stage because the survey evidence foundation should not reject imperfect field data before the workflow is ready. It should make missing evidence visible to operations, engineering, and permit review. The current behavior does that.

## Engineering bridge usefulness

The engineering bridge is useful as an advisory routing layer, not as proof of engineering completeness. After deterministic label inference, `Meter Photo` contributes to electrical evidence and `Site Access Photo` contributes to site-plan/general overview evidence rather than incorrectly strengthening attic/structural evidence. This is materially better than the pre-pass behavior where every real label became uncategorized and bridge counts stayed empty.

The bridge remains intentionally conservative. It should not route `Got that sauce` or `Overhead Line Photo` into engineering buckets without explicit category support. This avoids false confidence.

## Permit summary truthfulness

The permit validation summary remains truthful because it labels survey evidence as fallback/advisory evidence and does not claim AI extraction or CAD automation. The manifest preserves visible source metadata and canonical category coverage. Missing evidence remains visible. No permit AI extraction was started.

The main permit-summary risk before this pass was false omission: real human labels like `Meter Photo` were not counted as meter evidence. That has been improved. The remaining risk is false confidence if future aliases are added too aggressively. Any new alias should be field-reviewed and covered by tests using real technician label examples.

## Topology and operational traceability findings

The topology remains accurate at the code level: Survey App data flows through `site_surveys` and `site_survey_files`, then into `SurveyEvidenceManifest v1`, then into the engineering bridge and permit validation summary. Future worker boundaries are still explicitly labeled as not started.

Operational traceability improved because manifest items preserve both `submittedCategory` and canonical `category`. That is important for real survey operations: the system can show that a technician submitted `Meter Photo` while the manifest normalized it to `meter`; it can also show that `Got that sauce` remained uncategorized.

This pass did not complete browser/UI visual validation against a live project page because live DB/auth access was unavailable. The code-level topology and build were validated, but live UI rendering against real projects remains blocked by environment access.

## Performance findings

The field snapshot was tiny: 10 uploaded file references across 9 grouped surveys. Runtime performance was not a concern at this size. Focused tests completed quickly, type-check passed, and production build passed.

This is not enough to claim production-scale performance under thousands of survey uploads. Before adding OpenCV Quality Scoring v1, performance should be tested against a larger real export or seeded copy of production survey metadata, especially because future image workers will add queue and storage pressure.

## Future worker contract readiness

The manifest remains ready for future worker outputs because items expose placeholders/statuses such as quality not processed, duplicate not processed, AI extraction not started, CAD automation not started, null blur score, and related future-worker fields. These fields are truthful: no worker has run.

This pass confirms the contract shape is useful, but it does not validate actual worker behavior. No blur score, duplicate score, image dimensions, orientation, object detection, OCR, segmentation, or CAD extraction was computed.

## Open-source and AI/CV/CAD boundary validation

A targeted scan of the relevant survey evidence surfaces found zero prohibited runtime imports/usages for OpenCV, YOLO, PaddleOCR, Tesseract, Detectron2, Open3D, FreeCAD, Label Studio, Supervision, Claude/Anthropic, or OpenAI in the Survey Evidence manifest/bridge/API/UI/topology/permit surfaces reviewed.

Boundary language remains descriptive and future-facing only. No prohibited feature work was started.

## Validation commands and results

Focused tests:

```text
npm test -- --run lib/survey/evidence/manifest.test.ts lib/engineering/surveyEvidence.test.ts lib/permit/validationPageSurveyEvidence.test.ts
Result: 3 test files passed, 11 tests passed
```

Type-check:

```text
npm run type-check
Result: exit 0
```

Production build:

```text
npm run build
Result: exit 0
```

Build warnings were expected sandbox runtime warnings for missing environment variables such as `DATABASE_URL` and `JWT_SECRET`. They are not caused by this survey evidence change.

Boundary scan:

```text
Targeted grep across survey evidence/API/UI/topology/permit surfaces
Result: 0 prohibited runtime imports/usages found
```

Field snapshot harness:

```text
npx tsx ../outputs/real-survey-data-validation/validate-field-snapshot.ts
Result saved to outputs/real-survey-data-validation/field-snapshot-results-after-site-access-correction.json
```

## Remaining pain points

The biggest pain point is not code; it is data access. Without live DB credentials or restored uploaded photos, validation remains metadata-only. Actual photo chaos cannot be verified.

The second pain point is technician labeling inconsistency. The manifest now handles some real human labels, but seven of ten real audit references still classify as uncategorized. That is likely correct for the available labels, but it means operations needs better capture prompts, required photo slots, or post-survey review tooling before engineering can rely on evidence coverage.

The third pain point is alias governance. `Overhead Line Photo` may be useful evidence, but the correct canonical category needs a conscious product/engineering decision. Blindly mapping every recognizable phrase creates false confidence.

## Exact blockers before OpenCV Quality Scoring v1

OpenCV Quality Scoring v1 should not start until these blockers are resolved:

1. Provide live read access to `site_surveys` and `site_survey_files`, or provide a fresh export containing real survey rows, file rows, labels, storage keys, and timestamps.
2. Restore or provide access to actual uploaded image bytes for the audit URLs or an equivalent real photo corpus. Current Render `/uploads/*.jpg` audit URLs return 404.
3. Validate actual image conditions manually first: blurry photos, duplicates, rotations, dark attic images, mixed shots, detached garages, roof/electrical confusion, and over-uploaded angle spam.
4. Decide whether `Overhead Line Photo` should map to `utility_connection`, `overview`, or remain uncategorized. Add only explicit reviewed aliases.
5. Add a larger real-data performance run before introducing image-worker queueing.
6. Keep worker outputs advisory and visibly separate from technician-submitted evidence until reviewed.

## Final assessment

Survey Evidence Manifest v1 is ready to remain the canonical evidence foundation after this pass. It is more truthful with real technician labels than it was before. It still exposes real-world incompleteness instead of hiding it. It is not yet ready for OpenCV Quality Scoring v1 because actual photo-byte validation is blocked by unavailable image storage and missing live DB access.
