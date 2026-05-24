# Professional CAD Benchmark Gap Report V1

## Benchmark Used

The uploaded sealed residential solar permit package was reviewed as a visual benchmark for sheet structure, title block treatment, drafting hierarchy, legends, roof/module readability, fire setback annotations, equipment callouts, and print/export credibility. The benchmark uses ANSI/letter plan-sheet conventions: strong borders, right-side title block rail, sheet index, system summary tables, dense but organized notes, clear legends, roof/module plan framing, scale/north references, and professional callout hierarchy.

## Gaps Found In V1 Output

- V1 looked more like a dashboard/report than a permit drawing because rounded metric cards, soft colors, and bottom title blocks dominated the sheets.
- Title block identity was present but not permit-like; it lacked a right-side rail, drawing metadata rows, and strong sheet-number hierarchy.
- Legend content was text-heavy and did not use graphic symbols matching the linework.
- Site plan callouts lacked professional leader-line hierarchy and did not clearly group module, setback, conduit, and equipment annotations.
- Evidence sheets used UI-style tiles instead of report-sheet evidence records.
- Print/export styling existed but did not yet express ANSI/permit drawing conventions strongly enough for live Engineering UI trust.

## Highest-Impact Improvements Applied

- CAD-style double border and right-side title block rail added to every sheet.
- Monochrome drafting hierarchy with controlled module, setback, conduit, and equipment accents.
- Deterministic grayscale site-context composition added for lot/property, access, driveway, neighboring structure, and aerial-like realism cues.
- Symbolized legend with matching roof/module/fire path/conduit/equipment/attachment symbols.
- Leader-line callouts for module preview zones, PV group/string callouts, and fire setback overlays.
- A-000 rebalanced into system summary, sheet index, render layer summary, trust indicators, and review notes.
- A-101 reworked as the flagship commercial sheet with roof edge articulation, hatch linework, obstruction symbols, parcel/access realism cues, professional true-north/scale graphics, rail/attachment symbols, equipment summary, construction notes, revision/QA table, and active render layer table.
- A-201 converted into evidence records plus evidence coverage and review/risk regions.
- Deterministic render quality checklist, direct PDF export, preview thumbnails/snapshots, contact sheets, and live-preview manifests added for visual QA only.

## Lowest-Cost Polish Wins Remaining

- Real brand/title-block customization per contractor or dealer.
- Better project/address/client metadata where survey fixtures provide it.
- Production module/string layout data when available, replacing deterministic preview modules.
- Public preview QA for PDF/download/browser behavior.

## Blockers To Public-Facing Professional Standard

The upgraded output is closer to commercial preview quality, but it is still not a stamped permit package. Remaining blockers before public-facing release are production-grade module/string placement when authoritative design data exists, AHJ-specific note libraries under explicit authority controls, branding/custom metadata, and product-approved preview-only warning UX. Live UI wiring should wait until product stakeholders accept the quality checklist threshold and preview warnings in the UI experience.

## Quality Result

Average evidence-alignment render quality score: **31/100**. Checklist keys: survey_photo_truth_usage, survey_metadata_truth_usage, design_layout_truth_usage, layer_provenance_completeness, fallback_disclosure, design_survey_reconciliation, authenticity_score, oss_adapter_boundaries, no_authority_boundaries, review_warning_visibility, export_presentation_readiness.