# Visual OSS Leverage Report V1

## Selected Approach

The first professional output engine intentionally uses native deterministic SVG string composition and print-ready HTML packaging. This provides immediate visual value with zero new dependency risk and minimal integration complexity.

## Existing OSS Utilities Considered

- `wkhtmltopdf`: selected for direct multi-sheet PDF export from deterministic HTML/SVG composition because no additional browser runtime was required in this environment.
- `jspdf`: available for future client-side or pure-JS PDF flows, but not selected here because HTML/SVG-to-PDF preserved the existing composition with less churn.
- `puppeteer-core`: available for a future controlled Chromium export adapter when a browser binary is guaranteed.
- `sharp`: used for deterministic PNG thumbnails, larger preview snapshots, and contact-sheet package previews.
- `exif-reader`: valuable for future metadata confidence scoring, not needed for SVG composition.

## Leverage Gained

Native SVG provided the strongest quality-per-credit leverage: export-safe vectors, precise line weights, title blocks, legends, annotations, and print CSS without adopting a heavy framework. The integration remains isolated and deterministic.

## Performance / Complexity

Performance impact is low for fixture-sized plan sets because rendering is string composition over existing DTOs, with explicit artifact generation confined to the generation script. Integration complexity remains low: one library module plus one generation script and focused tests.