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
// 47360 (2026-07-01): "home in the center of the map" — the aerial frame now snaps
// to Nearmap's OWN AI-detected roof polygon (bbox center) when it contains the
// chosen center, or is nearest-within-25m of a design-centroid center. Same imagery
// frame as the Vert tiles → the home lands pixel-exact mid-frame, immune to street-
// interpolated geocode pins (~15m off at 3 Melvin) and GPS-vs-imagery registration.
// Coverage-gated, cached (1 AI credit/generate), fails safe to the unsnapped center.
// Also: fetchAerialRoofData no longer hard-requires a Google key when coords exist
// (the old early-return silently disabled Nearmap in Google-key-less envs).
// 47361 (2026-07-01): ROOT CAUSE of every "aerial not centred" report — the
// Nearmap tile stitcher chained .composite().extract() in ONE sharp pipeline,
// but sharp applies composite at the END (after extract): the crop was taken
// from the BLANK canvas and tiles pasted un-shifted, so the whole scene rendered
// offset by (cropLeft, cropTop) — a centre-dependent 0-255px (≈0-15 m @ z21)
// shift. Proved on the saved 3 Melvin render: measured scene shift +200,+112 px
// == the design-centre crop offset (190,112). Fix: two-pass stitchAndCropTiles
// (composite → PNG buffer → extract), locked by nearmapStitch.test.ts.
// 47363 (2026-07-01): un-mangled the PE letters — certPages/peLetter (and 6 spots
// in compliancePages) had literal \" sequences baked into their template output,
// so every HTML attribute on PE-1 (roof/fence/ground variants) parsed as garbage
// and the sheet rendered with NO CSS (class was literally '\"page\"'). Found by
// headless-rendering the sheets while reviewing SN Phases 6-8. Also: VAL-1 no
// longer crashes when compliance.jurisdiction is absent (optional in the type);
// PV-1 legend label 18\" backslash typo fixed.
// 47364 (2026-07-01): structural honesty + pro-visual pass (Ray's review of the
// v47363 render). LOGIC: PE-1 certification is now CONDITIONAL — it never says
// "confirmed adequate" while its own checks fail (red DO-NOT-ISSUE box instead);
// the "145%" mislabel fixed on PE-1 + PV-4C (that was the GOVERNING/deflection
// ratio printed beside a passing 90% bending check); PV-4C dead-load table now
// sums correctly (TOTAL ADDED 3.2 ≠ 17.6 — that's the new COMBINED row); E-1
// interconnection no longer hardcoded LOAD_SIDE (reads project method). VISUAL:
// PV-2 restyled to the PE-sealed reference language — white sheet + white roof
// linework, red HATCHED setback bands, white modules w/ blue attachment dots
// (was gray fills + solid navy modules); PE-1 restyled as an engineering letter
// (ruled headings via .pe-letter scope, RE:/DATE block, quiet label cells).
// 47365 (2026-07-01): PV-2 setback consistency + monochrome dims. The drawn hatch
// band read ahjRoofSetbackIn alone (36" pathway on this AHJ) while SYSTEM DATA /
// callout ② resolve ridge??edge (18") — one sheet printed two setbacks and the
// oversized band swallowed modules. Drawing now uses the SAME resolution as the
// data zone. Dimension linework black (was blue — reference sets are monochrome).
// 47366 (2026-07-01): AHJ DATABASE = SINGLE SOURCE OF TRUTH (Ray). (1) Permit
// route AHJ enrichment now DB-WINS over stale per-project snapshots (was fill-
// if-empty) for wind/snow/setbacks/NEC/seismic/fees, logged overrides. (2) The
// DB carries TWO setback semantics — roofSetbackInches = EDGE (eave/rake) path,
// ridgeSetbackInches = ridge/hip — previously flattened to one number, which is
// why the sheet contradicted itself. PV-2 now classifies every facet edge
// (shared-with-another-facet = ridge/hip, perimeter = eave/rake) and hatches
// each at ITS OWN AHJ setback, with heavy ridge/hip vs fine eave/rake linework
// (the per-edge line-style item) + dual legend/data-zone/callout display.
// 47367 (2026-07-01): CORRECTED AHJ setback semantics — ahjRoofSetbackIn is the
// IFC ACCESS PATHWAY width (a designated 36" route), NOT a uniform edge setback;
// ahjRidgeSetbackIn is the fire setback drawn on edges. v47366 hatched every
// eave/rake at the pathway width, flooding the sheet red and making compliant
// modules read as violations (Ray: "looks like shit"). PV-2 now draws thin
// fire-setback bands (18") on all edges, keeps per-edge ridge/hip vs eave/rake
// line weights, and reports the pathway in SYSTEM DATA / callout ② / plan note.
// 47368 (2026-07-01): PV-2 drafting-quality push (Ray: "amateur hour"). (1) NEW
// regularizeRoof.ts squares up hand-traced geometry for DISPLAY: welds shared
// facet corners (union-find), straightens near-axis eaves/ridge via dominant-
// axis snapping, caps vertex movement at 2 ft — kills the wavy eaves / dogleg
// ridge / asymmetric hips. Stored geometry + panels untouched. (2) EAVES get NO
// fire-setback band ("if there is no firewalk on the eave it needs to not
// show") — perimeter edges are classified eave vs rake by outward-normal vs
// plane azimuth; bands draw only on ridge/hips/rakes.
const PLANSET_ENGINE_VERSION = 47368;



export { PDF_PAGE_CONFIG, PLANSET_ENGINE_VERSION };
