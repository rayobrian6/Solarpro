# Professional CAD Roadmap Update V1

## Completed This Phase

- Professional SVG sheet output engine.
- Reusable sheet composition primitives: title block, legend, viewport, review stamp, metric cards, evidence tiles, notes panels.
- Deterministic annotation engine for roof labels, pitch/azimuth labels, setback preview labels, conduit labels, equipment labels, render confidence notes, and review callouts.
- Realistic site-context composition and richer module layout preview treatment.
- Exportable SVG, print/PDF-ready HTML, direct PDF package generation, thumbnails, snapshots, contact sheets, and preview manifests.
- Visual OSS leverage assessment.

## Remaining Blockers Before Commercially Competitive Public Preview Quality

- Need production module/string layout data when available under explicit authority controls.
- Need real contractor branding/title-block customization and sheet index controls.
- Need final browser/download QA for generated PDFs and preview images.
- Need AHJ-specific plan notes only after engineering authority boundaries are intentionally designed.

## Next Highest-Leverage Step

Build a static preview UI route or downloadable artifact endpoint around the generated `PlanSetRenderPackageV1` and `professional_plan_set_preview_manifest_v1`; direct PDF export and preview asset generation now exist and should be QA-reviewed before public UI wiring. Current generated sheet types: cover_summary, evidence_review, site_plan_render.