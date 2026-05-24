# Geometry Replay Intelligence Report V1

Corpus replay ran 16 fixture-driven survey items through parser, canonical geometry, CAD readiness, OSS comparison, geometry intelligence, and review recommendation logic. The replay hash is `dc5c23ca`, and all replay outputs are non-authoritative and replay-only.

## Replay Findings

Average geometry confidence was 89.13, average topology integrity was 95.06, average readiness trust was 76.81, and average discrepancy severity was 1.13. 8 item(s) were clean with no review recommendation, 8 item(s) entered review, 4 item(s) required review, and 4 item(s) required blocker review.

## Confidence Distributions

`geometryConfidenceScore`: {"min":30,"max":100,"average":89.13,"bands":{"0_34":1,"35_59":0,"60_81":3,"82_89":0,"90_100":12}}

`topologyIntegrityScore`: {"min":40,"max":100,"average":95.06,"bands":{"0_34":0,"35_59":1,"60_81":1,"82_89":0,"90_100":14}}

`readinessTrustScore`: {"min":13,"max":100,"average":76.81,"bands":{"0_34":1,"35_59":3,"60_81":3,"82_89":1,"90_100":8}}

`discrepancySeverityScore`: {"min":0,"max":18,"average":1.13,"bands":{"0_34":16,"35_59":0,"60_81":0,"82_89":0,"90_100":0}}

## Discrepancy Distribution

Discrepancy severity counts were {"info":15,"warning":1,"error":0}. Observation category counts were {"clipping_disagreement":1}. The replay surfaced 0 likely native false-positive tracking note(s) and 0 likely native false-negative tracking note(s).

## Recurring Risks

Top recurring geometry risk categories were readiness_downgrade_conditions (7), conflicting_survey_evidence (4), low_confidence_geometry (3), near_zero_geometry_projections (2), unsupported_polygon_structures (2), overlapping_geometry (1). Failure clusters were conflicting_survey_evidence+readiness_downgrade_conditions [4], low_confidence_geometry+readiness_downgrade_conditions [2], low_confidence_geometry+near_zero_geometry_projections+near_zero_geometry_projections+readiness_downgrade_conditions+unsupported_polygon_structures+unsupported_polygon_structures [1], overlapping_geometry [1].
