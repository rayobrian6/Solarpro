# Geometry Candidate UI Review V1

This report documents the review-only UI surfacing for the controlled geometry-adjacent evidence pilot. The UI integration is intentionally limited to the Assisted Evidence Sandbox workspace. It does not surface geometry candidates as canonical roof truth, CAD truth, engineering truth, readiness truth, NEC truth, layout truth, workflow authority, or recommendation authority.

## UI insertion point

The pilot adds a demonstration geometry candidate to the existing Assisted Evidence Sandbox panel in the Engineering Intelligence admin page. The candidate is produced by the governed runtime bridge using deterministic byte hashing and bounded source-context text. It is appended alongside existing assisted evidence sandbox candidates and remains inside the assisted evidence review workspace boundary.

No CAD editor, roof plane workspace, plan-set renderer, layout optimizer, routing workspace, engineering requirements panel, NEC evaluation view, BOM view, readiness view, workflow queue, or recommendation surface consumes the geometry candidate as authority.

## Required labels

The Assisted Evidence Sandbox candidate card now detects `possible_obstruction_candidate` and displays explicit geometry-review labels. The UI text includes `NON-AUTHORITATIVE`, `REVIEW REQUIRED`, `GEOMETRY CANDIDATE`, `CONFIDENCE`, and `SOURCE IMAGE`. It also states that the candidate is not canonical geometry, not CAD input, not engineering authority, and not used for readiness, workflow, or recommendations.

The UI label design follows the geometry UI lineage planning guidance: a user can see the candidate and its lineage, but the UI does not present it as accepted geometry or as an input to deterministic outputs.

## Lineage display

For geometry candidates, the card displays a geometry candidate lineage section. The lineage tokens include the candidate label, boundary policy version, runtime payload hash, source image lineage reference, review region descriptor, candidate invalidation only, no CAD invalidation, and no engineering invalidation. These tokens make the candidate’s provenance and stale propagation boundary visible to reviewers.

The source image lineage is represented through the candidate source upload key and source image lineage hash. The displayed confidence is the bounded candidate confidence produced by the runtime. The review region descriptor is `coarse_source_image_context`, which deliberately avoids measurable geometry, bounding boxes, polygons, coordinates, or obstruction footprints.

## Review-only behavior

The UI provides visibility and review context only. It does not create roof planes, create setbacks, create CAD obstruction objects, route conduit, filter panels, update engineering requirements, update readiness, enqueue workflows, or create recommendations. If a reviewer accepts an assisted evidence candidate through the existing lifecycle, the result remains a reviewed evidence projection and does not automatically mutate canonical evidence.

## Demonstration candidate boundary

The demo candidate uses a small deterministic byte array and source-context text indicating possible vent obstruction review context. This demo validates the runtime, provenance, and labeling path without performing image decoding or geometry extraction. It is fixture/runtime pilot data only, and the Assisted Evidence Sandbox warning explicitly states that geometry candidates are review-only source-image context and are not CAD input, roof-plane truth, setbacks, NEC authority, layout input, workflow input, or recommendation input.

## UI safety conclusion

The UI integration satisfies the V1 review-only requirement. Geometry candidates are visible only as assisted evidence candidates, with explicit uncertainty, confidence, source image lineage, and non-authoritative labeling. The UI does not promote them into deterministic engineering truth or CAD truth.
