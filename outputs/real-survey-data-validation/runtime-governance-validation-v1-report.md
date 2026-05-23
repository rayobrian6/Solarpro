# Runtime Governance Validation V1 Report

## Scope

This report documents the governance controls added for the first controlled metadata runtime pilot. The goal is to prove that a real runtime can execute only when registered, licensed, adapter-contained, deterministic, review-required, and incapable of canonical or engineering mutation.

## Registry Enforcement

The open-source tool registry now supports `enabled_for_runtime_pilot` and includes the single runtime registration `sharp-metadata-runtime@0.34.5`. Runtime execution resolves this registration through `getRegisteredOpenSourceTool()` before candidate generation. Unregistered tool names or versions throw before execution.

The validator rejects missing tool metadata, duplicate registrations, blocked licenses, abandoned or unknown maintenance status, blocked risk status, blocked enabled status, canonical mutation permission, empty candidate allowlists, empty category allowlists, unapproved runtime categories, model-weight requirements, non-server metadata runtime execution, and metadata runtimes outside the server adapter boundary.

## License Validation

License normalization was corrected so SPDX-style permissive identifiers remain approved after normalization. `Apache-2.0` is now classified as approved, matching the pinned `sharp@0.34.5` lockfile license. GPL, AGPL, SSPL, unknown, unlicensed, non-commercial, and research-only postures remain blocked. MPL and LGPL variants remain caution.

## Runtime Category Controls

Only `image_metadata` is enabled for this pilot. `ocr_text_candidate`, `visual_categorization_candidate`, and `future_geometry_placeholder` remain rejected by registry validation. This ensures the pilot cannot silently escalate into OCR, visual categorization, semantic understanding, or geometry extraction.

## Adapter Controls

`metadataRuntimeAdapter.ts` is the sole approved runtime wrapper. It imports `sharp`, extracts metadata only, builds normalized candidate payloads, and routes all output through `createReviewRequiredCandidates()`. The shared normalization bridge then routes to `createCandidate()` and `markReviewRequired()`.

The adapter includes runtime provenance fields such as runtime source, runtime version, runtime payload hash, image format, dimensions, orientation, density, profile presence, EXIF presence, file-size bucket, and runtime pilot labeling. All confidence values remain bounded by the existing normalization helpers.

## Test Coverage

`lib/assistedEvidenceSources/metadataRuntimeAdapter.test.ts` adds deterministic runtime tests covering runtime registration, blocked runtime definitions, canonical mutation rejection, unsupported OCR-category rejection, server-only enforcement, deterministic metadata extraction, stable candidate hashes, stable candidate ordering, bounded confidence, provenance attachment, review-required enforcement, non-authoritative status, and absence of canonical/CAD/recommendation/workflow authority strings in runtime output.

The combined assisted evidence source test suite passed with two test files and thirteen tests.

## Governance Result

The first controlled runtime executes only as a registered, server-only, metadata-scoped runtime pilot. It is not a general image-processing interface. It does not grant runtime outputs any authority beyond review-required assisted evidence candidate generation.
