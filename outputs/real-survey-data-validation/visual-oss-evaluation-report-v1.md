# Lightweight Visual OSS Evaluation Report V1

## Evaluation Context

Survey Photo Render Intelligence V1 intentionally avoids broad CV adoption. The immediate commercial need is credible render and plan-set acceleration, so the most valuable OSS utilities are those that help display, annotate, validate, or package existing trusted geometry and photo references without claiming geometry authority.

## Most Promising OSS Utility Categories

1. **SVG/Canvas overlay composition utilities** appear most promising for near-term demo value because roof outlines, pitch/azimuth labels, MSP/meter markers, evidence callouts, and confidence notes can be rendered from existing DTOs without solver execution.
2. **EXIF and metadata parsers** are useful if uploads include camera timestamps, GPS, orientation, or operator-entered tags. They should feed deterministic confidence and sorting signals only, never automatic geometry extraction.
3. **Image dimension/probe utilities** can support layout quality checks such as aspect ratio, missing image dimensions, and file validity. These checks are safe because they do not infer roof geometry.
4. **PDF/SVG annotation libraries** are commercially valuable for permit-plan demos because they can package render overlays, evidence callouts, and readiness notes into review-first plan-set artifacts.
5. **Lightweight thumbnail/contact-sheet generation** can improve operator review throughput by grouping roof, electrical, obstruction, and unknown photos beside render readiness warnings.

## Deferred or Avoided OSS Areas

Heavy OpenCV pipelines, segmentation models, aerial imagery inference stacks, automatic obstruction detection, module placement optimizers, and conduit routers remain deferred. They could create false authority, credit drain, and commercial risk before the deterministic trust workflow is proven.

## Recommended Next OSS Experiments

- Prototype SVG overlay export from `ProfessionalRenderRecommendationReportV1` using existing roof plane polygons and layer recommendations.
- Add metadata probing for dimensions/timestamps/orientation where available, feeding only photo evidence confidence and review notes.
- Generate a review contact sheet that groups photos by `SurveyPhotoEvidenceCategoryV1` and shows missing category warnings.
- Package render readiness, layer recommendations, and evidence callouts into a static HTML/PDF demo artifact for contractor-facing review.

## Current Corpus Signals

Preview/demo-ready fixtures: **10/16**. Average render confidence: **65.13**. Top render layers were `render_confidence_notes`, `evidence_review_callouts`, `module_layout_previews`, `msp_meter_markers`, `fire_setback_overlays`.
