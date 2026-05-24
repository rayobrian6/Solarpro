# Plan-Set CAD Appendix Preview V1 — Implementation Report

## Summary

Plan-Set CAD Appendix Preview V1 adds the first visible CAD-backed plan-set rendering path as an explicitly gated preview appendix. The implementation is additive only and does not replace production `PV-2` or `PV-3` sheets. The appendix is generated only when `renderPlanSet()` receives `engOpts.cadAppendixPreviewV1 === true`; absent or false flags omit the appendix completely.

## Files Added

- `lib/drafting/cadAppendixPreviewSheet.ts`
- `tests/cadAppendixPreviewSheet.test.ts`
- `tests/renderPlanSetCadAppendix.test.ts`
- `outputs/real-survey-data-validation/plan-set-cad-appendix-preview-audit-v1.md`
- `outputs/real-survey-data-validation/plan-set-cad-appendix-preview-v1.md`
- `outputs/real-survey-data-validation/plan-set-cad-appendix-boundary-v1.md`
- `outputs/real-survey-data-validation/plan-set-cad-appendix-validation-v1.md`

## Files Modified

- `lib/drafting/renderPlanSet.ts`
- `todo.md`

## Appendix DTO

The new `PlanSetCADAppendixPreviewSheetV1` DTO is deterministic, JSON-safe, replay-safe, non-persistent, and non-authoritative. It carries `sheetType`, `sheetTitle`, system type, source CAD export hash, source SVG artifact hash, CAD model version, units, viewBox metadata, layer summary, deterministic notes, explicit preview-only labels, no-authority flags, SVG payload, rendering warnings, and deterministic sheet hash.

The visible preview labels are:

- `CAD PREVIEW ONLY`
- `NON-AUTHORITATIVE`
- `NOT PERMIT AUTHORITY`
- `NOT ENGINEERING AUTHORITY`
- `NOT CONSTRUCTION DRAWING`

## RenderPlanSet Wiring

`renderPlanSet()` continues to validate first with `assertValidPlanSet(cad, systemType)`. It then renders the existing system-specific production sheets exactly as before. Only after the base `PlanSetSheets` object exists does the new opt-in wrapper append `APP-CAD`. The appendix wrapper builds a `CADModelExportBundle` from the already-supplied solved CAD object, builds a `CADSvgArtifactPreview` from that export bundle, wraps both into `PlanSetCADAppendixPreviewSheetV1`, and renders the appendix SVG.

The feature flag path is `engOpts.cadAppendixPreviewV1`. It defaults to disabled because the optional property is absent unless explicitly set to true.

## Sheet Naming

The appendix sheet uses `APP-CAD`. The implementation contains guards preventing use of `PV-2` or `PV-3`, and it checks for sheet-key collisions before insertion. Existing production sheet keys remain untouched.

## Fail-Closed Behavior

If CAD export, SVG artifact, or appendix DTO validation fails, the appendix is omitted and the original production plan-set object is returned unchanged. Validation errors before base rendering still throw as before because the existing plan-set validation boundary remains ahead of all rendering.

## Solver and Mutation Boundary

The appendix path never calls `generateCADLayout()` and consumes only the `CADModel` already passed into `renderPlanSet()`. Tests verify the input CAD model remains unchanged after appendix generation. The implementation does not modify permit page assembly, engineering calculations, NEC calculations, BOM logic, routing logic, workflow logic, recommendations, or persistence.
