# Geometry Adapter Future Recommendation v1

## Keep or Remove

The isolated `polygon-clipping` adapter should remain, but only as a comparison-only geometry intelligence utility. It demonstrated enough value to justify keeping the adapter boundary for further fixture replay and review tooling. It should not be promoted into SolarPro geometry authority, CAD authority, readiness authority, engineering authority, permit authority, or BOM authority.

## Expand or Freeze

The adapter should expand cautiously in one direction: more offline/reporting coverage. The safest next step is to run the adapter across a larger corpus of captured survey fixtures and produce review-only discrepancy reports. The adapter should not yet be wired into the operator readiness endpoint as an automatic readiness modifier, and it should not block or promote `cad_preview_ready`.

## Native Hardening Recommended

SolarPro native geometry logic should remain primary and should be hardened using the signals found in this spike. Recommended native improvements are explicit duplicate roof-plane detection, duplicate edge/path detection, practical local projected-area thresholds, overlap warning generation for roof-plane candidates, better provenance for normalized pitch/azimuth defaults, and obstruction polygon DTO design if future field capture supports obstruction outlines.

## Adapter Boundary Recommended for Future CAD/Topology Phases

Future CAD/topology phases should build on the adapter boundary, not on direct `polygon-clipping` imports. The boundary should continue to return versioned, deterministic, non-authoritative reports with input/result hashes and no-authority flags. If future phases add another library such as `martinez-polygon-clipping` or `@turf/turf`, they should be plugged into the same comparison interface as secondary cross-checks rather than replacing SolarPro native logic.

## Conditions Before Any Operator-Facing Use

Before exposing adapter results to operators, SolarPro should add a clear UI label such as `OSS Cross-Check`, `Comparison Only`, and `Non-Authoritative`. Operator output should show affected geometry entities, severity, readiness impact, and recommended review actions. It must also show that SolarPro native readiness remains primary. No endpoint should write adapter results to production geometry tables unless a separate non-authoritative review artifact store is explicitly designed.

## Conditions Before Any Authority Promotion

No authority promotion is recommended. If the team ever considers authority promotion, it must be a separate architecture phase with legal review, deterministic golden fixtures, rollback controls, versioned artifact storage, reviewer traceability, production monitoring, and explicit sign-off that SolarPro native logic still owns final validation semantics.

## Final Recommendation

Keep the adapter. Expand only as offline/read-only comparison reporting. Do not use it to mutate geometry, CAD, readiness, engineering, permit, or BOM flows. Build future CAD/topology intelligence on this adapter boundary only if the boundary remains isolated, deterministic, test-covered, and non-authoritative.
