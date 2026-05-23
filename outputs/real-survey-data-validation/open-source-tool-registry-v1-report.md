# Open-Source Tool Registry V1 Report

## Scope

This phase implements the first safe execution foundation for open-source assisted evidence sources. It adds governed registry infrastructure under `lib/assistedEvidenceSources/` without adding any real OCR, CV, image-processing, object-detection, segmentation, geometry, CAD, engineering, recommendation, workflow, or canonical evidence runtime. The registry is an allowlist for fixture-only tools and is designed to fail closed when metadata, license posture, review requirements, or canonical mutation invariants are violated.

## Files Added

The registry foundation adds `openSourceToolTypes.ts`, `openSourceToolLicenses.ts`, `openSourceToolValidation.ts`, and `openSourceToolRegistry.ts`. These files define tool metadata, license posture helpers, registry validation rules, fixture-only registered tools, and an explicit lookup function that rejects unregistered execution.

## Registry Schema

Each tool definition includes tool name, version, source URL, license, runtime category, allowed candidate types, allowed candidate categories, image-byte requirements, native binary requirements, model-weight requirements, browser/server compatibility, review requirement, canonical mutation permission, runtime boundary, deterministic replay support, risk level, enabled status, maintained status, and registry notes.

The fields `reviewRequired: true`, `nonAuthoritative` through candidate creation, and `canonicalMutationAllowed: false` are treated as invariants. A tool cannot opt into canonical mutation. A tool cannot run without review-required semantics. A tool cannot emit candidate types outside its allowlist.

## Registered Fixture Tools

Two fixture-only tools are registered in this phase. `fixture-image-metadata-adapter@1.0.0` can emit orientation, photo-quality, and duplicate-hygiene candidates. `fixture-ocr-text-adapter@1.0.0` can emit text-region candidates only. Both are internal fixture tools with MIT posture, no image-byte processing, no native binaries, no model weights, fixture-static runtime boundary, and fixture replay support.

## License Posture

The license helper classifies permissive licenses such as MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC as approved. MPL-2.0 and LGPL variants are treated as caution. GPL, AGPL, SSPL, unknown, unlicensed, non-commercial, and research-only postures are blocked. Registry validation rejects blocked or unknown licenses.

## Validation Rules

The registry validation rejects missing tool names, versions, source URLs, and licenses. It rejects blocked license posture, abandoned or unknown maintenance status, blocked risk level, blocked enabled status, unapproved native binaries, unapproved model weights, future geometry runtime categories, blocked future geometry boundaries, empty candidate type allowlists, empty category allowlists, missing review requirements, and canonical mutation permission.

## Containment Guarantee

The registry does not execute runtime OCR/CV code. It only defines fixture-only source metadata and allows adapter code to resolve registered tools before generating candidates. Unregistered tools throw an error before candidate generation. Registered tools can only feed normalized payloads into the assisted evidence candidate lifecycle.
