# Plan-Set CAD Appendix Preview V1 — Audit First

## Scope

This audit was completed before implementation of Plan-Set CAD Appendix Preview V1. The requested branch is the existing `feature/cad-svg-artifact-preview-v1` branch. This phase must add only an explicitly gated, non-authoritative CAD preview appendix sheet. It must not replace `PV-2`, replace `PV-3`, mutate CAD, rerun layout solving, mutate engineering truth, mutate permit logic, or become permit authority.

## Files Audited

The audit reviewed the plan-set render entrypoint in `lib/drafting/renderPlanSet.ts`, validation gates in `lib/drafting/validation.ts`, permit generation flow in `lib/permit/generatePermit.ts`, sheet composition/title-block helpers in `lib/drafting/sheetComposition.ts`, `lib/permit/utils/titleBlock.ts`, `lib/permit/utils/drawing.ts`, and `lib/plan-set/title-block.ts`, plus the CAD preview boundaries in `lib/cad/cadModelExportBundle.ts` and `lib/cad/cadSvgArtifactPreview.ts`.

## Existing Validation Boundary

`renderPlanSet()` calls `assertValidPlanSet(cad, systemType)` before rendering any system-specific sheets. `assertValidPlanSet()` delegates to `validatePlanSet()` and throws `PlanSetValidationError` if the CAD model is invalid. The validation layer already enforces system-type compatibility and cross-contamination rules: roof plan sets cannot include ground or fence CAD sections, ground plan sets cannot include roof or fence sections, and solar-fence plan sets cannot include roof or ground sections. This validation boundary must remain ahead of appendix generation.

The CAD export boundary in `buildCADModelExportBundle()` also independently validates the solved CAD model using `validatePlanSet(cad, cad.systemType)`, requires supported system types, rejects non-finite CAD scalar/bounds values, sanitizes the model into JSON-safe form, and produces deterministic hashes. The SVG artifact boundary in `buildCADSvgArtifactPreview()` accepts only valid `CADModelExportBundle` inputs and fails closed for invalid schema versions, persistence modes, invalid validation results, malformed hashes, unit mismatches, unsupported systems, or mismatched snapshot system types.

## Existing Render Ordering

`renderPlanSet()` currently switches by system type after validation and returns one of three system-specific render functions. Each system-specific renderer creates a fresh `sheets: Record<string, string>` and assigns production sheets as follows:

- Solar fence: `PV-3` from `drawFenceElevation()` and `PV-2` from `drawFencePlan()`.
- Ground mount: `PV-2` from `drawGroundArray()` and `PV-3` from `drawGroundStructural()`.
- Roof: `PV-2` from `drawRoofPlan()` and `PV-3` from `drawRoofStructural()`.

The existing `buildResult()` then returns the production sheet map together with `systemType`, `totalPanels`, `totalDcKw`, validation warnings, and `renderContext`. The current safest appendix point is after the base `PlanSetSheets` object is produced by the existing system-specific rendering path, because that preserves existing validation and production sheet generation unchanged while allowing a distinct appendix key to be added only when explicitly enabled.

## Permit Generation Boundary

`lib/permit/generatePermit.ts` generates CAD once using `generateCADLayout(input as any)` and then performs permit-oriented page assembly with a fixed page list. That flow is more authoritative and closer to production permit output than the isolated drafting `renderPlanSet()` contract. This phase should avoid modifying permit page assembly unless a future directive explicitly asks for permanent permit-page inclusion. The appendix preview should remain a plan-set render pipeline capability behind an opt-in flag, not a globally enabled permit-generation page.

## Sheet Registration and Title-Block Observations

`lib/drafting/sheetComposition.ts` contains composition metadata with `sheetId` fields and current production IDs around `PV-2` and `PV-3`. Existing title-block utilities support production permit/page rendering, but the appendix DTO can remain independent by producing a self-contained SVG sheet. If title-block styling is reused, it must not inherit permit-authority semantics. A preview appendix should visibly display its own disclaimers instead of relying on production title-block wording.

## Safest Appendix Insertion Point

The safest implementation path is:

1. Keep `assertValidPlanSet(cad, systemType)` as the first operation inside `renderPlanSet()`.
2. Build the normal base `PlanSetSheets` through the existing system-specific branch exactly as before.
3. If and only if an explicit disabled-by-default feature flag is true, build a CAD export bundle from the already-supplied solved `cad`, build a CAD SVG artifact preview from that bundle, wrap it in a deterministic appendix-sheet DTO, and add a new sheet key such as `APP-CAD`.
4. Before assigning the appendix, assert that the key is not `PV-2` or `PV-3` and that the key does not already exist in the returned sheet map.
5. If the CAD export/artifact/appendix build fails, fail closed by omitting the appendix and preserving the production sheets.

This approach does not rerun the CAD solver because it consumes only the `cad` already passed into `renderPlanSet()`. It does not mutate CAD because export and SVG boundaries sanitize/read from the model and tests can verify the input object remains unchanged. It does not alter PV-2/PV-3 because the appendix uses a separate key and can be checked against collisions.

## Safest Feature-Flag Path

The safest feature flag is an optional `cadAppendixPreviewV1?: boolean` property on the existing optional `engOpts` object passed to `renderPlanSet()`. It must default to false because missing `engOpts` or missing `cadAppendixPreviewV1` should omit the appendix completely. This avoids global enablement and avoids introducing environment-variable behavior that might silently change snapshots. The same options object may also carry optional export metadata if needed, but default deterministic metadata can be constructed locally for tests and preview generation without persistence.

## Risks of Accidental PV-2/PV-3 Replacement

The primary replacement risk is writing the appendix into `sheets['PV-2']` or `sheets['PV-3']`, or mutating the sheet map before/inside the system-specific renderers. A secondary risk is introducing a shared sheet registration helper that reorders or renames existing production sheets. The mitigation is to add only a distinct appendix key, assert no collision before assignment, and include tests that compare `PV-2` and `PV-3` output with the flag disabled and enabled.

## Risks of Accidental Permit Authority Escalation

The primary authority-escalation risk is integrating the CAD preview into `generatePermit.ts` fixed permit pages, using production title-block/certification language, or presenting the CAD preview as construction geometry. A second risk is allowing preview artifact hashes or layer summaries to influence engineering, NEC, BOM, routing, workflow, or recommendation outputs. The mitigation is to keep the module DTO-only, include explicit all-false authority flags, render visible labels stating `CAD PREVIEW ONLY`, `NON-AUTHORITATIVE`, `NOT PERMIT AUTHORITY`, `NOT ENGINEERING AUTHORITY`, and `NOT CONSTRUCTION DRAWING`, and keep the feature disabled by default.

## Required Implementation Constraints Confirmed

Implementation must be additive only. It must consume the solved CAD object already passed to `renderPlanSet()`. It must preserve plan-set validation. It must use the CAD export bundle and SVG artifact preview boundary rather than directly becoming a CAD solver or authoritative renderer. It must fail closed on invalid CAD export/artifact inputs. It must not modify permit production page assembly, engineering calculations, NEC calculations, BOM logic, routing logic, workflow logic, recommendation logic, or persistence.
