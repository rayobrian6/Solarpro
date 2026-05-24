# Plan-Set CAD Appendix Preview V1 — Boundary Report

## Boundary Status

Plan-Set CAD Appendix Preview V1 is a preview-only appendix boundary. It is not a CAD solver, not a source of geometry truth, not permit authority, not engineering authority, not a construction drawing, and not a replacement for production plan-set sheets.

## Authority Flags

`PlanSetCADAppendixPreviewAuthorityFlagsV1` sets all authority-related permissions to false:

- persistenceAllowed: false
- solverExecutionAllowed: false
- cadMutationAllowed: false
- canonicalGeometryMutationAllowed: false
- planSetProductionSheetMutationAllowed: false
- pv2ReplacementAllowed: false
- pv3ReplacementAllowed: false
- engineeringInfluenceAllowed: false
- necInfluenceAllowed: false
- bomInfluenceAllowed: false
- routeInfluenceAllowed: false
- workflowInfluenceAllowed: false
- recommendationInfluenceAllowed: false
- permitAuthorityAllowed: false
- constructionDrawingAuthorityAllowed: false
- downstreamAuthority: false

## Production Sheet Boundary

The appendix sheet ID is `APP-CAD`. Runtime guards prevent the appendix ID from being `PV-2` or `PV-3`, and insertion checks for collisions before assigning the appendix sheet. Tests compare baseline and enabled `PV-2`/`PV-3` SVG strings to prove production sheets remain unchanged when the appendix flag is enabled.

## Validation Boundary

The existing `assertValidPlanSet(cad, systemType)` call remains the first operation in `renderPlanSet()`. Cross-system contamination still fails before appendix generation. The CAD export boundary independently validates solved CAD through `validatePlanSet()`, and the SVG artifact boundary validates export schema, persistence mode, source validation status, hash format, units, supported system type, and snapshot system-type consistency.

## CAD Solver Boundary

The appendix path does not import or invoke `generateCADLayout()`. It uses only the solved `CADModel` already supplied to `renderPlanSet()`. The added tests verify no CAD mutation occurs by comparing the serialized CAD model before and after opt-in rendering.

## Engineering, NEC, BOM, Routing, Workflow, and Recommendation Boundary

The appendix path does not write to engineering data, NEC calculations, BOM generation, routing, workflow, recommendations, or permit page assembly. It receives `planSet.warnings` as rendering warnings only and does not feed appendix metadata back into production calculations.

## Permit Authority Boundary

`lib/permit/generatePermit.ts` was audited but not modified for this increment. The appendix is available only through the drafting `renderPlanSet()` path and only through explicit opt-in. The rendered appendix visibly displays `CAD PREVIEW ONLY`, `NON-AUTHORITATIVE`, `NOT PERMIT AUTHORITY`, `NOT ENGINEERING AUTHORITY`, and `NOT CONSTRUCTION DRAWING`.

## Fail-Loud / Fail-Closed Rules

The boundary fails loudly for invalid appendix DTO inputs, mismatched source export hashes, mismatched system types, invalid source CAD export validation, invalid appendix schema, invalid persistence mode, or invalid sheet IDs. In `renderPlanSet()`, invalid appendix generation fails closed by omitting `APP-CAD` while returning production sheets unchanged.
