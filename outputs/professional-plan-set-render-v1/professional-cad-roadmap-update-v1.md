# Professional CAD Roadmap Update V1

## Completed This Phase

- Professional SVG sheet output engine.
- Reusable sheet composition primitives: title block, legend, viewport, review stamp, metric cards, evidence tiles, notes panels.
- Deterministic annotation engine for roof labels, pitch/azimuth labels, setback preview labels, conduit labels, equipment labels, render confidence notes, and review callouts.
- Exportable SVG and print/PDF-ready HTML demo packaging.
- Visual OSS leverage assessment.

## Remaining Blockers Before Commercially Competitive Plan-Set Quality

- Need richer module layout fidelity and string/group labels from production design data when available.
- Need polished PDF export automation using the existing HTML/SVG package and a controlled browser/PDF adapter.
- Need real contractor branding/title-block customization and sheet index controls.
- Need optional thumbnail/contact-sheet generation from actual uploaded photo assets.
- Need AHJ-specific plan notes only after engineering authority boundaries are intentionally designed.

## Next Highest-Leverage Step

Build a static preview UI route or downloadable artifact endpoint around the generated `PlanSetRenderPackageV1`, then add direct PDF export using existing browser/PDF tooling. Current generated sheet types: cover_summary, evidence_review, site_plan_render.