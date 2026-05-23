# Geometry Candidate Roadmap Lineage Compatibility V1

## Scope

This report documents the first dependency graph compatibility increment for geometry-adjacent assisted evidence candidates. The implementation does not connect geometry candidates to authoritative CAD, roof, setback, engineering, routing, BOM, plan-set, workflow, or recommendation systems. It creates lineage-only metadata that can be displayed or audited by review tooling.

## Implemented Helper

`buildGeometryCandidateLineageNode()` creates a deterministic metadata node for a geometry candidate. The node type is `review_required_geometry_candidate`, and its dependency role is `lineage_visibility_only`. The node records the candidate ID, source file ID, source upload key, project ID, survey ID, runtime tool name and version, runtime payload hash, source image lineage reference, boundary policy version, review state, and deterministic hash.

## Allowed and Forbidden Edges

The lineage node allows only `source_image_to_candidate` and `candidate_to_review_projection`. It explicitly marks downstream authority as false. It records forbidden edges for candidate-to-CAD, candidate-to-roof-plane, candidate-to-setback, candidate-to-layout, candidate-to-NEC, candidate-to-engineering, candidate-to-workflow, and candidate-to-recommendation paths.

The forbidden edge list is defensive metadata and is not an integration with those systems. No CAD, roof-plane, setback, layout, NEC, engineering, workflow, or recommendation module is imported or called by the helper.

## Boundary Checker Update

The assisted evidence boundary checker was narrowly updated to allow explicit negative-policy text in `geometryCandidateReviewLifecycle.ts`. The allowance is limited to guard and denial contexts such as `forbiddenEdges`, `forbiddenStaleClasses`, review guard calls, and no-authority explanatory strings. Active geometry measurement, CAD generation, engineering fact production, workflow influence, recommendation influence, image decoding, CV/ML runtime use, and direct canonical mutation remain prohibited by the checker.

## Safety Conclusion

The lineage compatibility increment makes geometry candidates easier to audit without granting downstream authority. The graph-compatible node is visibility-only, deterministic, and explicitly barred from CAD, roof, setback, layout, NEC, engineering, workflow, and recommendation edges.
