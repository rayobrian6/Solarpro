# Open-Source Assisted Evidence Risk Matrix V1

## Purpose

This matrix evaluates candidate open-source integration categories for SolarPro assisted evidence. The matrix assumes the Assisted Evidence Sandbox V1 remains the only allowed destination for runtime output. All categories are assessed under the invariant that outputs are non-authoritative, review-required, and projection-only.

## Scoring Scale

Risk is scored qualitatively as low, moderate, high, or blocked. Low risk means containment is straightforward and failure modes are easy to review. Moderate risk means containment is feasible but requires careful UI, validation, and provenance. High risk means semantic or engineering misuse is likely without strong controls. Blocked means the category must not be implemented without future explicit approval and additional architecture.

## Category Comparison

| Category | Example Output | Usefulness | Containment Difficulty | Engineering Risk | Recommended Timing | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| Image metadata / photo quality | dimensions, file type, orientation metadata, blur/quality candidate if non-semantic | High for upload triage and survey completeness | Low | Low | First runtime pilot | Proceed after registry, fixture adapter, and runtime harness |
| OCR / text-region candidate | possible labels, placards, utility text, equipment text snippets | High for review acceleration | Moderate | Moderate | Second pilot | Proceed only after image metadata pilot and strong review UI semantics |
| Visual categorization | possible roof photo, possible meter, possible electrical panel | High for organization and triage | Moderate-high | High | Later pilot | Defer until review metrics and boundary enforcement mature |
| Geometry / roof interpretation | possible roof edge, obstruction outline, pitch/azimuth cues | Potentially high | High | Very high | Future explicit approval only | Block for now |
| CAD / engineering authority | CAD-ready geometry, requirement satisfaction, engineering recommendation | Operationally tempting but unsafe | Not acceptable | Critical | Not allowed | Blocked |

## Image Metadata Risk Analysis

Image metadata extraction is the safest first runtime pilot because it can provide operational value without semantic interpretation. It can help identify unsupported file types, missing dimensions, low-resolution uploads, orientation anomalies, unusually large files, duplicate upload names, and survey organization issues. The containment difficulty is low because metadata can be converted into photo-quality or orientation candidates with clear limitations.

Key risks include over-interpreting metadata as proof of site conditions, relying on EXIF timestamps as authoritative, or using quality signals to reject evidence automatically. Mitigations include review-required status, explicit limitations, no automatic rejection, no requirement satisfaction, and preserving source metadata hashes.

Recommended status: first runtime pilot after fixture-only proof.

## OCR Risk Analysis

OCR can provide strong review acceleration by surfacing possible equipment labels, placard text, meter numbers, inverter labels, panel labels, or utility markings. It is riskier than metadata because text extraction can be wrong, partial, stale, duplicated, or context-free. OCR output can appear authoritative to reviewers if UI language is careless.

Key risks include treating recognized text as validated equipment data, satisfying requirements from OCR without review, leaking sensitive text into inappropriate logs, and false positives caused by poor image quality. Mitigations include text-region candidates only, field-level reviewer acceptance, redaction policy where needed, confidence/limitation labeling, and no canonical mapping without future explicit review.

Recommended status: second pilot after metadata runtime and review queue hardening.

## Visual Categorization Risk Analysis

Visual categorization can help sort photos and suggest context, but it introduces semantic interpretation risk. A model might suggest that a photo contains a roof, meter, trench, main service panel, detached structure, or obstruction. These labels are useful for triage but dangerous if treated as facts.

Key risks include false category labels driving reviewer bias, accidental influence on engineering context resolution, and premature product claims. Mitigations include possible/suggested labels only, low-confidence display, review-required candidates, no direct context resolution import, and strong boundary scans.

Recommended status: defer until metadata and OCR pilots prove safe.

## Geometry Detection Risk Analysis

Geometry detection is the most dangerous category among plausible assisted evidence tools. It may attempt roof edges, obstructions, setbacks, trench routes, structure outlines, pitch cues, or spatial relationships. These outputs can directly tempt CAD readiness and engineering decisions.

Key risks include autonomous roof geometry, incorrect obstruction boundaries, false CAD readiness, invalid designs, unsafe engineering assumptions, and downstream regeneration errors. Mitigations require future explicit approval, separate geometry-specific review workflows, measurement provenance, uncertainty modeling, visual overlays for review, and no engineering or CAD influence without mapping controls.

Recommended status: blocked in this program phase.

## CAD and Engineering Authority Risk Analysis

Any runtime claiming to generate CAD geometry, satisfy AHJ/electrical/structural requirements, determine feasibility, generate recommendations, create workflows, or trigger regeneration is outside the allowed assisted evidence scope.

Recommended status: blocked. This must never become autonomous without future explicit approval, separate safety architecture, human signoff, reversible mapping, and downstream impact tracing.

## License Risk Matrix

| License Posture | Risk | Policy |
| --- | --- | --- |
| MIT / Apache-2.0 / BSD / ISC | Low after verification | Preferred |
| MPL-2.0 | Moderate | Review compatibility before use |
| LGPL | Moderate-high | Require legal/architecture review |
| GPL / AGPL / SSPL | High to blocked | Do not use without explicit approval |
| Non-commercial / research-only | Blocked for production | Do not use |
| Custom model license | High | Require explicit review |
| Missing license | Blocked | Do not use |

## Dependency Risk Matrix

| Dependency Type | Risk | Policy |
| --- | --- | --- |
| Pure TypeScript/JavaScript fixture adapter | Low | Allowed |
| Small metadata parser without native binary | Low-moderate | Candidate for first runtime pilot |
| OCR library with WASM/native runtime | Moderate-high | Defer until harness and review UI mature |
| CV model runtime with model weights | High | Defer |
| Native binary requiring system packages | High | Block by default |
| Cloud-hosted external inference API | High | Not part of open-source local runtime; require separate privacy/security review |

## Boundary Risk Matrix

| Boundary | Violation Example | Severity | Required Control |
| --- | --- | --- | --- |
| Canonical survey evidence | Adapter calls survey evidence manifest builder | Critical | Import scan and forbidden symbol scan |
| Engineering requirements | OCR text satisfies requirement automatically | Critical | Guard tests and no direct imports |
| CAD readiness | Geometry candidate toggles CAD-ready status | Critical | CAD isolation tests and boundary script |
| Recommendations | Visual candidate creates recommendation | Critical | Recommendation isolation tests |
| Workflow orchestration | Candidate creates site follow-up task | High | Workflow isolation tests |
| Project mutation | Runtime writes project fields directly | Critical | Mutation symbol scan and database boundary rules |
| UI semantics | Candidate shown as verified fact | Moderate-high | Review UI language checklist |

## Operational Risk Matrix

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Reviewer over-trusts candidate | High | UI labels, limitations, training, acceptance workflow |
| Runtime timeout | Moderate | Timeout policy, failure envelope, no candidate or error candidate |
| Malformed output | Moderate | Schema validation and fail-closed behavior |
| Excessive candidate volume | Moderate | rate limits, grouping, queue prioritization |
| Low-quality uploads produce bad suggestions | Moderate | confidence limits and quality limitations |
| Dependency becomes unmaintained | Moderate | adapter replaceability and registry deprecation |
| License changes | High | pinned versions and license re-verification |

## Pilot Recommendation

The first runtime pilot should be image metadata/photo quality extraction. It provides high operational value with the lowest semantic and engineering risk. OCR should be second. Visual categorization should be third or later. Geometry detection and CAD/engineering assistance should remain blocked until the platform has proven review metrics, runtime containment, explicit mapping design, and downstream invalidation safety.

## No-Go Conditions

The program must stop and return to governance review if any proposed implementation requires direct canonical mutation, bypasses review, imports engineering/CAD/recommendation/workflow modules, uses a blocked license, requires unapproved native binaries, requires unapproved model weights, or presents unreviewed output as verified fact.
