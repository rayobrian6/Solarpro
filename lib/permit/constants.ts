// ═══════════════════════════════════════════════════════════════
// Permit Engine Constants — Extracted from route.ts
// ═══════════════════════════════════════════════════════════════

// ═══ Planset Engine Constants ═══════════════════════════════════════════════
// Single source of truth for PDF dimensions and engine version.
// Bump PLANSET_ENGINE_VERSION on every release that changes planset output.

/** PDF page dimensions — ANSI B landscape (17×11 in). Used by ALL wkhtmltopdf calls. */
const PDF_PAGE_CONFIG = {
  width:  '17in',
  height: '11in',
} as const;

/** Engine version for staleness detection. Bump with every planset-affecting release. */
// 47346 (2026-06-30): aerial centering now pin-authoritative (no neighbor-segment
// override), battery gated on the permit payload, PV-2B branch-colored real-roof plan,
// PV-1 panels removed. Bumped so cached plansets generated before these fixes are treated
// as stale and force a fresh regenerate instead of serving the old (wrong-aerial) HTML.
// 47350 (2026-06-30): PV-2/PV-2B roof plan — fire setback now drawn as a REAL
// inward inset (was zero-inset = no visible setback band); plane-label pitch
// rounded to one decimal so it matches the SYSTEM-DATA table (was "5:12" vs
// "4.8:12" on the same sheet).
// 47351 (2026-06-30): "3D drives 2D" — PV-1 aerial re-centers on the design's
// array centroid (post-enrichment) instead of the address geocode, guarded by
// chooseAerialCenter's corruption check (centroid >300m from pin = rejected).
// 47352 (2026-07-01): PV-1/site-plan aerial now prefers Nearmap HD (7.5cm, stitched
// Vert tiles) over Google Static Maps satellite; Google is the fallback.
// 47353 (2026-07-01): PV-2 gains the pro "MAIN HOME ROOF DESCRIPTION" (per-facet
// modules/azimuth/tilt/truss) + "ARRAY & ROOF CALC" (plan-view area/array/%) tables;
// escapeXml now actually escapes &<>" (was a no-op → broke SVG on those chars).
// 47354 (2026-07-01): PV-2 gains a full N/E/S/W compass rose + a LEGEND box (PV
// module / fire setback / roof edge / callout ref) to match the pro reference.
// 47355 (2026-07-01): PV-1 aerial is now LANDSCAPE 16:9 (was square → clipped by
// the wide column, shoving the centred roof to the bottom edge — the "not centered"
// bug, present with Google too); + subject roof outlined on the aerial (projected).
// 47356 (2026-07-01): removed the PV-1 roof-outline overlay — trace sits ~1m off
// Nearmap registration; the HD aerial shows the roof clearly on its own. Keep clean.
// 47357 (2026-07-01): PV-1 aerial re-center threshold 12m→3m (a 7-8m geocode-vs-
// design gap on the neighbour parcel was under the old gate → never re-centred, so
// the aerial stayed on the neighbour); + temp [dbg] tag on PV-1 caption to surface
// image source + centre in prod. Remove the dbg tag once verified.
// 47358 (2026-07-01): center the INITIAL aerial fetch on the design centroid (from
// the request body, available pre-enrichment) so the design always wins the framing
// without relying on the post-enrichment re-center firing. + readable DBG box +
// center crosshair on PV-1 (TEMP — remove once centering is confirmed).
const PLANSET_ENGINE_VERSION = 47359;



export { PDF_PAGE_CONFIG, PLANSET_ENGINE_VERSION };
