# CAD Model Export Bundle V1

## Scope

CAD Model Export Bundle V1 adds a deterministic, read-only export boundary for solved `CADModel` objects. The bundle is intended as the first safe handoff layer for future CAD artifact adapters, including SVG, DXF, and open-source CAD rendering/export libraries.

The implementation introduces `buildCADModelExportBundle(cad, input)` in `lib/cad/cadModelExportBundle.ts`. It accepts an already-solved CAD model, validates it through the existing plan-set validation gate, creates a JSON-safe sanitized model snapshot, records deterministic summary metadata, attaches explicit all-false authority flags, and computes a stable eight-character deterministic export hash.

## Export Contract

The export schema is `cad_model_export_bundle_v1` with persistence mode `deterministic_dto_only_v1`. Coordinates remain in solved local XY CAD units as `meters_local_xy`. The bundle records project, survey, CAD run, and plan-set source identifiers when supplied, but it does not persist those identifiers or write any database/file-system artifact beyond the caller-owned DTO returned from the function.

The bundle includes a model summary covering panel counts, DC size, panel dimensions, origin, bounds, warning and dimension counts, system-specific presence flags, and optional obstruction/electrical/conduit counts. It preserves a sanitized snapshot of the solved CAD model after removing unsupported JSON values such as functions, symbols, bigint values, and undefined properties. Non-finite numeric values are rejected.

## Validation Behavior

Exports require `exportedAt` and `exportedBy` metadata. Exports require a supported CAD system type: `roof`, `ground_mount`, or `solar_fence`. The module rejects missing models, invalid system types, non-finite top-level CAD geometry scalars, invalid plan-set validation results, missing required system-specific CAD payloads, and cross-contaminated CAD models such as roof models that also carry ground payloads.

The targeted test suite covers deterministic roof export, ground and fence export support, validation metadata rejection, invalid model rejection, cross-contamination rejection, non-finite geometry rejection, sanitized snapshot behavior, and explicit no-authority flags.

## Safety Boundary

This pack does not execute the CAD solver, rerun layout, modify CAD geometry, mutate canonical geometry, mutate roof planes, mutate setbacks, mutate plan-set output, persist export artifacts, call third-party CAD libraries, create SVG or DXF artifacts, create permit sheets, influence engineering, influence NEC calculations, influence BOM, influence routing, influence workflow state, influence recommendations, or grant third-party CAD output any downstream authority.

Open-source CAD libraries may consume this bundle in later increments as rendering/export adapters only. They do not become geometry authority, engineering authority, NEC authority, BOM authority, routing authority, workflow authority, recommendation authority, plan-set authority, or permit authority.

## Validation Completed

- `npm test -- tests/cadModelExportBundle.test.ts` — passed, 1 file and 4 tests.
- `npm run check:assisted-evidence-boundaries` — passed.
- `npm run check:engineering-boundaries` — passed.
- `npm run check:topology` — passed with the existing reported circular dependency and directional warnings; no hard directional violations.
- `npm run type-check` — passed.
- `npm run build` — passed. Build completed with the expected runtime environment warnings for missing local environment variables.
- `npm run lint` — passed with the existing repository warning set, primarily `no-console` warnings.
