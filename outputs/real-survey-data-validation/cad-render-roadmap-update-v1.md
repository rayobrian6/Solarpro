# CAD / Render Enhancement Roadmap Update V1

## Phase Added

Survey Photo Render Intelligence V1 adds the first commercial render bridge on top of the geometry trust backbone. The platform can now classify survey photo references deterministically, evaluate render readiness, recommend professional render layers, and expose operator summaries in the professional survey readiness report.

## Immediate Commercial Value

The highest-value render layers are `render_confidence_notes`, `evidence_review_callouts`, `module_layout_previews`, `msp_meter_markers`, `fire_setback_overlays`, `pitch_azimuth_overlays`. These layers convert trusted survey geometry into visible contractor-facing proof: roof outlines, pitch/azimuth overlays, module preview eligibility, equipment markers, MSP/meter markers, evidence callouts, and render confidence notes.

## Next Build Sequence

1. Add a static SVG/HTML render preview DTO consumer that reads `renderRecommendationReport` and displays enabled layers with callouts.
2. Add photo contact-sheet grouping by evidence category and review status.
3. Add metadata probing for image dimensions, timestamps, orientation, and optional GPS when present.
4. Add a contractor-facing render readiness panel with blockers, missing categories, and confidence notes.
5. Add export packaging for review-first permit-plan/demo PDFs without solver execution or authority promotion.

## Blockers Before Professional CAD Render Commercialization

- CAD readiness is blocked by native survey validation. (4)
- Canonical geometry is not ready for CAD input preview. (4)
- Geometry intelligence requires blocker review before commercial render use. (4)
- Missing roof/ground/fence visual coverage needed for credible render context. (1)

## Guardrails To Preserve

No automatic CAD generation from photos. No canonical geometry mutation. No CAD preview mutation. No CAD solver execution. No persistence side effects. No downstream engineering, permit, BOM, or approval triggers. Render readiness must remain an operator/commercial review signal, not an engineering authority signal.
