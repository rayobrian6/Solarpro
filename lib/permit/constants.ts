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
// 47369 (2026-07-01): three-lens critique batch (CAD drafter / reference-match /
// AHJ plan-checker panel on the rendered sheet). Modules now ROTATE to their
// plane's fall line (end-plane arrays overlapped drawn axis-aligned) and ride
// the regularizer via per-facet affine (top row overhung the straightened
// eave); two rail-foot dots per module. Targeted callout anchors (bubbles beside
// their objects, short leaders — ③ ridge, ② hip band, ④ dashed conduit route to
// the SE corner). Vertical dim moved off the data tables. GENERAL NOTES block
// (numbered, upright) replaces the italic footer. Scale-bar tick labels 0/5/10.
// Plane labels auto-dodge modules. Title block: SCALE 'AS NOTED' (was NTS vs a
// scaled view), PE seal placeholder text removed, 'NEC NEC' dedup guard. IFC
// citations updated §605.11 → §1204.2 (2018+ editions). FRAMING wording unified.
// 47370 (2026-07-01): the SET-WIDE pro restructure (Ray: "nowhere near the
// detail of a professional planset"). (1) VERTICAL TITLE-BLOCK STRIP on the
// right edge of EVERY sheet — firm block, project block, meta, REVISIONS, PE
// seal, sheet name, and the big sheet ID in the extreme lower-right where a
// set is indexed (the horizontal top banner was the biggest "generated" tell).
// (2) PV-2 direct equipment callouts in reference style — real "(N) qty —
// make/model (W)" text with short leaders for modules, microinverters,
// mounts/attachments, fire setback, ridge, junction-box SYMBOL + labeled
// dashed conduit route (numbered bubbles retired). (3) Viewport title below
// the drawing (circled 1 + underlined name + scale) replacing the solid black
// banner. Equipment identity now flows into the drafting layer (adapter).
// 47371 (2026-07-02): ROOF OBSTRUCTIONS ON PV-2 (Ray item #1 — "I don't think
// this is implemented anywhere" — correct: the design studio fetched Nearmap AI
// obstructions but never persisted them; nothing reached the planset). The
// permit route's aerial pass now returns obstructions from the SAME AI call as
// the frame snap (no extra credit, cache serves the double-fetch), forwards
// them to project.roofObstructions; roofCAD projects them into the local frame
// (per-plane assignment + existing panel-collision filtering now actually run);
// the adapter emits fake-degree circles; PV-2 draws footprint + dashed keep-out
// ring + type label, with legend entry and an honest GENERAL NOTES line.
// 47372 (2026-07-02): PV-1 SERVICE-EQUIPMENT MARKERS (Ray item #3). New
// equipmentLocator (pure, 5 tests): source hierarchy = labeled survey photos
// w/ EXIF GPS (exact — pipeline ready; Melvin's survey photos carry NO GPS,
// the capture app strips location) → street-side wall heuristic (meter/MSP/AC
// on the wall facing the geocoded address point, quarter-point placement).
// PV-1 draws blue UM/MSP/AC tags with white-haloed leaders + label boxes that
// PRINT PROVENANCE ("PER SURVEY PHOTO GPS" vs "APPROX. — FIELD VERIFY") — the
// sheet never claims surveyed precision it doesn't have.
// 47373 (2026-07-02): Ray's regen punch list. OBSTRUCTIONS de-fucked: (a)
// neighbor filter — the AI query AOI covers adjacent buildings; only
// obstructions whose centroid sits on THIS project's roof planes survive;
// (b) linear features (ridge vents/flashing runs, aspect>3 & >2m) dropped —
// a circle abstraction turned them into a blob mid-ridge (ridge setback bands
// already cover them); (c) radius cap 1.2m. PANELS un-crooked: module rotation
// snaps to the sheet axes (raw 3-4° trace azimuth made grid rows read gapped/
// crooked). FRAMING LINES drawn per facet @ rafter O.C. along the fall line
// (legend entry) — attachment feet moved to the module clamp edges so they
// land on framing. CALLOUTS: labels hug their targets w/ short leaders, JB +
// conduit merged into one label, "(E) RIDGE" dropped, module/inverter fallback
// text no longer reads as a broken sentence.
// 47374 (2026-07-02): RAIL/FOOT + STRING/INVERTER LOGIC (Ray). Mount hardware
// is now SYSTEM-AWARE: rail-less (RT-Mini) draws 4 mounts under the module's
// long-side frame edges SNAPPED to the framing grid; railed systems draw the
// two row rails + feet at framing crossings. AC branch assignment is now REAL
// wiring logic: largest planes first + serpentine row order → contiguous
// daisy-chain runs (was a global row/col sort that interleaved planes and
// scattered every branch). PV-2B draws each branch's trunk-cable run through
// its modules in wiring order with a B# tag at the head; legend order = trunk
// order by construction (panelColorById insertion order is the wiring order).
// Obstruction radius caps per type (a vent is never 1.2 m across).
// 47375 (2026-07-02): TREE CANOPY + METER VERIFICATION (Ray: "meter callout
// bold-faced wrong" / "tree hidden vent"). (1) CANOPY: Nearmap tree/vegetation
// features are no longer discarded — mapped to new 'canopy' obstruction type,
// kept ONLY where they overlap a detected roof plane (filterCanopyToRoof).
// Canopy-covered roof is a blind spot (AI can't see vents under it) so it now
// renders on PV-2 as a dashed green hatched zone "TREE CANOPY — CONCEALED
// AREA, FIELD VERIFY" (+ legend entry + GENERAL NOTE 5) and excludes panels
// via the standard keep-out path. roofCAD: canopy membership = vertex overlap
// (centroid-on-roof would drop eave-overhanging trees), marker re-centered on
// the over-roof part, 3.5 m radius cap. (2) METER: SurveyV2 photo capture now
// samples device geolocation at snap time (browser photos carry no EXIF GPS)
// → mig 099 gps columns on site_survey_files → permit route builds
// surveyPhotoHints → equipmentLocator tier 1 FINALLY has a data source, and
// snaps the surveyor's GPS onto the nearest building wall (snapToBuildingRing,
// 15 m cap) so the UM/MSP marker sits on the house, not the lawn.
// 47376 (2026-07-02 late): THE QUALITY BLITZ (Ray: "come back a hero" — 4-agent
// cross-comparison vs the Wyssling PE reference + canonical-path root-causes).
// PV-2B: (1) trunk STARBURST killed for real — wiring order now computed
// GEOMETRICALLY inside drawRoofPlan (greedy nearest-neighbor per branch on
// rendered coords; long plane-crossing hops drawn dashed); root cause was
// planeId dropped at the permit-body build (now threaded, both page.tsx sites)
// which collapsed the serpentine sort into a global row/col interleave.
// (2) Overlay BRANCH LEGEND deleted (opaque box painted over the viewport
// title → "UT — AC BRANCH COLOR MAP"). (3) NEC 690.8 FIX: branch max is now
// PER MODEL from Enphase capability profiles via lib/permit/utils/branching
// (IQ8A=10, IQ8M=11 — was hardcoded 16 → 14-module branches, a plan-check
// violation); one resolver feeds PV-2B, circuit schedule, E-1 SLD; balanced
// chunk sizes (9/9/9/9/9/8 not 14/14/14/11). (4) ARRAY PARAMETERS tilt shows
// the facet RANGE, not plane[0]. (5) obstruction/canopy hatch suppressed on
// the circuit map. PV-2: roof-plan canvas 1060×920 (was ×460 letterboxing 50%
// of the sheet blank and rasterizing table text illegibly — Ray's "1/7°/2/3°"
// was 5.4px type losing the 7's top bar); table typography ≥6.6px + TRUSS/
// SPACING columns (reference parity); MODULES column now SUMS to the declared
// count (point-in-poly + nearest-plane fallback; read 41 of 53); module/micro
// callouts merged into one stacked block (they printed on top of each other);
// JB callout margin-aware; attachments callout below the dim band; fire-
// setback labels moved IN-BAND (rotated, reference-style — margin callout
// leader crossed the array and collided with GENERAL NOTES); honest computed
// scale note. roofCAD: CANOPY no longer hard-filters designed modules off the
// drawing (header said 53, roof drew 41 — canopy flags, never deletes; vents/
// chimneys still filter). PV-1: full overlay stack on the Nearmap aerial —
// module footprints (rotated per-panel azimuth, translucent fill), subject-
// building dimming mask + registration shift from imagery-registered Nearmap
// AI polygons (new aerialData.subjectRoofPolygons via cropToSubjectBuilding),
// canopy zones, street-name label (geocode-pin direction), equipment markers
// ride the shift, 20-FT imperial scale bar, and an HONEST legend built from
// what the sheet actually draws (PROPERTY LINE/FIRE SETBACK promises removed
// until drawable — no parcel data source exists yet).
// 47377 (2026-07-03): INSTALLER-TRUTH BRANCHES + AERIAL-VISION VENT SWEEP +
// PV-1 DE-SLOP (Ray's morning markup). (1) BRANCHES NEVER CROSS PLANES:
// planMicroBranches (branching.ts) chunks each roof face independently —
// crews don't run a trunk over the ridge; small hip caps get their own short
// branch (Melvin: 8 branches 8/8/7|8/7/7|4|4, was 6 spanning opposite faces).
// Same planner feeds PV-2B, the SLD, and the circuit schedule; 16-color
// branch palette (color-keyed trunk grouping merged branch 1 with 9).
// (2) AERIAL-VISION OBSTRUCTION SWEEP (lib/aerial/aerialVisionObstructions):
// Claude vision reads the SAME stitched Nearmap HD aerial — subject-roof crop,
// 2x upscale, strict-JSON detections → inverse Web-Mercator → real lat/lng →
// on-design-roof filter + 1.2m dedupe vs Nearmap AI → roofObstructions with
// "(aerial vision — field verify)" provenance. Finds the pipes the feature
// layer misses (Ray's tree-shaded vent), generic for every property; fail-safe
// to none without ANTHROPIC_API_KEY. (3) PV-1: neighbor-tree canopy dropped at
// the route (canopy must overlap OUR roof planes — a neighbor's tree drew a
// giant green blob); dimming mask is now the padded CONVEX HULL of the
// subject polygons with the actual roof outlines drawn in white (imagery-
// registered — the boxy dashed rect read sloppy); 20-FT scale bar moved
// bottom-left off the module-count badge.
// 47378 (2026-07-03): ECONOMICAL BRANCHES (Ray rejected 47377's never-cross-
// planes rule — "owners aren't going to spend extra money on wire to run 5
// strings of 4"). planMicroBranches now plans the MINIMUM homerun count:
// ceil(total/NEC-max) branches, full branches within each face first, then
// leftovers merge with the NEAREST leftover across ONE adjacent hip with
// balanced capacity targets (Melvin: 10/10 N + 10/10 S + [3N+4W]=7 +
// [2S+4E]=6 → 6 branches, the theoretical minimum; regression-locked in
// branching.test.ts incl. the no-runt and never-pair-opposite-caps rules).
// Review-panel fixes (installer/plan-checker/drafter agents vs the Wyssling
// reference): branch legend Wp now computed from SYSTEM kW÷modules (stale
// per-panel field said 440W on a 400W job); PV-2B plane transitions route
// MANHATTAN (dashed) instead of freehand diagonals through the setback
// hatch; JB terminus symbol + "N AC BRANCH CIRCUITS → 3/4-in EMT" note at
// the SE eave; FIRE SETBACKS cites IFC 2021 §1204.2.1.1 (36" default,
// confirm exception w/ AHJ) + combiner-capacity note when branches > 4
// (IQ Combiner takes 4 — rest land on AC subpanel, see E-1). PV-1: the
// design→imagery registration shift is now a per-plane-matched MEDIAN with
// an agreement gate (raw centroid delta skewed when the subject crop
// grabbed/dropped a plane — modules hung off the west eave); hull pad
// tightened 1.28→1.12.
const PLANSET_ENGINE_VERSION = 47378;



export { PDF_PAGE_CONFIG, PLANSET_ENGINE_VERSION };
