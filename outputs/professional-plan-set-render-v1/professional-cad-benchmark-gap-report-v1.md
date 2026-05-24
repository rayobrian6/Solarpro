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
- Symbolized legend with matching roof/module/fire path/conduit/equipment/attachment symbols.
- Leader-line callouts for module preview zones and fire setback overlays.
- A-000 rebalanced into system summary, sheet index, render layer summary, trust indicators, and review notes.
- A-101 reworked around a cleaner roof plan viewport, scale/north placement, rail/attachment symbols, and active render layer table.
- A-201 converted into evidence records plus evidence coverage and review/risk regions.
- Deterministic render quality checklist added for visual QA only.

## Lowest-Cost Polish Wins Remaining

- Direct PDF export from the existing SVG/HTML composition.
- Real brand/title-block customization per contractor or dealer.
- Better project/address/client metadata where survey fixtures provide it.
- Production module/string layout data when available, replacing deterministic preview modules.

## Blockers To Professional Commercial Standard

The upgraded output is closer to commercial preview quality, but it is still not a stamped permit package. Remaining blockers before full professional standard are direct PDF export, production-grade module/string placement, AHJ-specific note libraries under explicit authority controls, and richer imagery/context overlays. Live UI wiring should wait until product stakeholders accept the quality checklist threshold and preview-only warnings in the UI experience.

## Quality Result

Average deterministic render quality score: **100/100**. Checklist keys: title_block_rail, sheet_border, legend_symbols, viewport_readability, annotation_readability, line_weight_consistency, render_confidence_display, review_warning_visibility, print_export_readiness, evidence_grouping.