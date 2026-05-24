# Visual OSS Leverage Report V1

## Selected Approach

The first professional output engine intentionally uses native deterministic SVG string composition and print-ready HTML packaging. This provides immediate visual value with zero new dependency risk and minimal integration complexity.

## Existing OSS Utilities Considered

- `jspdf`: useful next step for direct PDF export, but deferred because SVG/HTML print output is faster and more inspectable for this phase.
- `puppeteer-core`: useful for automated PDF snapshots later, but unnecessary for deterministic SVG unit tests.
- `sharp`: valuable for future image/contact-sheet thumbnails, deferred to avoid pixel/image processing expansion.
- `exif-reader`: valuable for future metadata confidence scoring, not needed for SVG composition.

## Leverage Gained

Native SVG provided the strongest quality-per-credit leverage: export-safe vectors, precise line weights, title blocks, legends, annotations, and print CSS without adopting a heavy framework. The integration remains isolated and deterministic.

## Performance / Complexity

Performance impact is negligible for fixture-sized plan sets because rendering is string composition over existing DTOs. Integration complexity is low: one library module plus one generation script and focused tests.