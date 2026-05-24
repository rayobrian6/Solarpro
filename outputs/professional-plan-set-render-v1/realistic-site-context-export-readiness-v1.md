# Realistic Site Context / Export Readiness Report V1

## Realism Upgrades

- A deterministic grayscale site-context layer adds lot/property boundary, street/access cue, driveway/access shape, neighboring structure silhouettes, and aerial-like texture.
- Site plan composition remains diagrammatic and preview-only; it does not extract authoritative parcel geometry or mutate canonical roof geometry.
- Module layout visuals now include aligned rows, orientation labels, ground-mount rack grouping, solar-fence linear bay grouping, consistent spacing, string/group callouts, conductor homerun cues, rail/attachment symbols, and A-101 note/table density.
- Roof plan realism still includes roof hatch, edge vertices, obstruction reference symbols, and parcel hatch cues; ground/fence realism now includes support posts, rack/fence rails, access/clearance review zones, trench/conduit candidates, and stronger true-north/scale presentation while remaining explicitly diagrammatic.

## PDF / Preview Export

- PDF stack: wkhtmltopdf from deterministic HTML/SVG composition; sharp for PNG thumbnails/snapshots/contact sheets.
- PDF packages generated: 4/4.
- Preview assets generated: 12 thumbnails, 12 snapshots, 4 contact sheets, 4 manifests.

## Live Preview Readiness

The generated manifests define HTML, PDF, SVG sheet, thumbnail, snapshot, and contact-sheet access patterns. This prepares a lightweight future UI integration while intentionally leaving live Engineering UI wiring disabled.

## Remaining Public Preview Blockers

- Product approval of preview-only warning UX.
- Browser/download QA for PDFs and thumbnails.
- Final stakeholder acceptance of visual quality thresholds.
- Optional contractor/dealer branding and richer project metadata.

## Safety Boundary

- readOnly: true
- renderOutputOnly: true
- stampedEngineeringPackage: false
- automaticCadGenerationAllowed: false
- canonicalGeometryMutationAllowed: false
- cadMutationAllowed: false
- cadSolverExecutionAllowed: false
- persistenceAllowed: false
- downstreamEngineeringAllowed: false
- downstreamPermitAllowed: false
- downstreamBomAllowed: false