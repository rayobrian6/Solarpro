# Commercial Render Readiness Report V1

Generated from corpus: `expanded-professional-survey-fixtures-v1`  
Fixture count: **16**

## Executive Summary

Survey Photo Render Intelligence V1 connects deterministic survey photo metadata to the existing geometry trust backbone so operators can understand whether a survey is ready for a professional commercial render, a review-assisted preview, or a blocked state. The pipeline adds no CAD authority: it reads survey photo references, canonical geometry, CAD readiness, and geometry intelligence, then emits photo coverage, render readiness, blockers, review-needed photos, and recommended render layers.

Average render confidence across the corpus is **65.13**. **10/16** fixture(s) are preview/demo ready, while **5** are blocked and **1** require render review before commercial use.

## Render Readiness Distribution

| State | Count | Share |
|---|---:|---:|
| render_blocked | 5 | 31% |
| render_review_required | 1 | 6% |
| render_preview_ready | 2 | 13% |
| render_demo_ready | 8 | 50% |

## Strongest Render-Supporting Evidence Categories

- **meter**: 15
- **msp_electrical_panel**: 14
- **roof_overview**: 13
- **fence_vertical_solar_area**: 1
- **ground_mount_area**: 1
- **unknown_review_needed**: 1
- **attic_rafter**: 0
- **inverter_equipment**: 0

## Top Commercial Render Layers

- **render_confidence_notes**: recommended in 16 fixture(s)
- **evidence_review_callouts**: recommended in 10 fixture(s)
- **module_layout_previews**: recommended in 10 fixture(s)
- **msp_meter_markers**: recommended in 10 fixture(s)
- **fire_setback_overlays**: recommended in 8 fixture(s)
- **pitch_azimuth_overlays**: recommended in 8 fixture(s)
- **roof_outlines**: recommended in 8 fixture(s)
- **conduit_path_candidates**: recommended in 2 fixture(s)

## Remaining Commercialization Blockers

- CAD readiness is blocked by native survey validation. (4)
- Canonical geometry is not ready for CAD input preview. (4)
- Geometry intelligence requires blocker review before commercial render use. (4)
- Missing roof/ground/fence visual coverage needed for credible render context. (1)

## Missing Photo Category Warnings

- 1 photo(s) need human category review before render use. (1)
- Missing meter/MSP photo evidence for plan-set equipment marker confidence. (1)
- Missing roof overview photo evidence for professional render context. (1)
- Survey includes obstructions but lacks obstruction photo evidence for render callouts. (1)

## Safety Boundary

This report is render-assist and review-first only. It does not inspect image pixels, execute OpenCV/CV inference, generate authoritative CAD, mutate canonical geometry, run CAD solvers, write persistence, trigger permit engineering, or promote survey photos into source-of-truth geometry.
