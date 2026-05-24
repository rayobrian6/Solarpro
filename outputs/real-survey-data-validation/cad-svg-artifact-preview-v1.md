# CAD SVG Artifact Preview V1

## Scope

CAD SVG Artifact Preview V1 adds a deterministic, read-only SVG preview artifact generator for solved CAD model export bundles. The new module is `lib/cad/cadSvgArtifactPreview.ts`, and its public entry point is `buildCADSvgArtifactPreview(bundle)`.

The artifact generator consumes `CADModelExportBundle` only. It does not accept permit input, does not call the CAD solver, does not call plan-set rendering, and does not alter canonical geometry. It projects the sanitized CAD snapshot from local XY meters into a fixed SVG viewBox and emits a preview DTO containing SVG markup, source export metadata, viewBox metadata, layer summary, deterministic notes, explicit no-authority flags, and a stable eight-character artifact hash.

## Rendered Preview Layers

The preview renderer supports the three current CAD system types:

- Roof systems: roof plane polygons, usable roof polygons, roof panels, obstructions, and dimensions.
- Ground mount systems: ground arrays, ground rows, and ground panels.
- Solar fence systems: fence segments, fence posts, and fence panels.

All rendered output is deterministic and derived from the sanitized source export snapshot. SVG text and attributes are escaped before being embedded in the artifact string.

## Safety Boundary

This pack does not execute the CAD solver, rerun layout, modify CAD geometry, mutate canonical geometry, mutate roof planes, mutate setbacks, mutate plan-set output, add plan-set sheets, persist SVG artifacts, call third-party or open-source CAD libraries, create DXF artifacts, create permit sheets, influence engineering, influence NEC calculations, influence BOM, influence routing, influence workflow state, influence recommendations, or grant SVG artifacts any downstream authority.

The SVG artifact is preview-only. It is not geometry authority, not engineering authority, not NEC authority, not BOM authority, not route authority, not workflow authority, not recommendation authority, not plan-set authority, and not permit authority.

## Validation Completed

- `npm test -- tests/cadSvgArtifactPreview.test.ts` — passed, 1 file and 4 tests.
- `npm run check:assisted-evidence-boundaries` — passed.
- `npm run check:engineering-boundaries` — passed.
- `npm run check:topology` — passed with the existing reported circular dependency and directional warnings; no hard directional violations.
- `npm run type-check` — passed.
- `npm run build` — passed. Build completed with the expected runtime environment warnings for missing local environment variables.
- `npm run lint` — passed with the existing repository warning set, primarily `no-console` warnings.
