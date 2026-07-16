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
// 47379 (2026-07-03): PV-1 TOP-DOWN REBUILT (Ray rejected it twice; worker
// panel diagnosed "80% dead content under a black wash" + delivered the spec).
// (1) CONTENT-DRIVEN CROP via SVG viewBox over the embedded aerial — subject
// spans ~50% of the frame (34-70 m ground clamp, street-side bias), ~2x
// effective print resolution, zero fetch changes. (2) WHITE contextual wash
// (photo-on-paper) replaces the black dim. (3) PROPERTY LINES ARE REAL:
// lib/aerial/parcelBoundary.ts — county-GIS registry (entry #1 Madison County
// IL CCAO, VERIFIED live: Melvin parcel polygon + PIN 17-2-20-13-04-401-003
// in 0.2 s), dashed phantom-line + rotated PROPERTY LINE label, APN
// auto-backfills the title block; registry misses render honestly without
// (national fallback = Regrid when Ray buys it). (4) Equipment restyled to
// reference language: white square wall tags + straight fanned leaders to a
// margin label column w/ halo text (no more white boxes piled on the focal
// point). (5) Cartographic furniture: neatline, white-plate alternating
// scale bar + computed 1"≈N' ratio, white north rose; module badge moved to
// the caption strip. (6) Street name placed ON the road along its bearing
// (degenerate-pin guard → bottom edge). (7) Near-opaque navy modules.
// Also: aerial-vision sweep UPSCALE 2→3 (a 4" pipe ≈ 9 px) + LOUD skip-reason
// logging at every gate (the "did it even run?" question answers itself in
// the function logs — #1 suspect for the still-missing vent is
// ANTHROPIC_API_KEY absent on Vercel).
// 47380 (2026-07-03): TEARDOWN FIX CAMPAIGN — 61 confirmed defects from the
// 116-agent teardown of the v47379 package (docs/TEARDOWN-v47379.md), themes:
// (1) INTERCONNECTION SINGLE-SOURCED: isSupplySideInterconnection() helper —
// PV-0 summary/info rows, Scope of Work, PV-4A methodology, PV-4B load calc
// (supply-side jobs get a real NEC 705.11 analysis, never "FAIL — UPGRADE
// PANEL"), BOM label, and the E-1 tap now lands LINE side of the main breaker
// through a FUSED disconnect (tap OCPD). "NEC 705.12(B): REQUIRES REVIEW"
// can no longer print. 705.12(A) citations → 705.11 (2020+ numbering).
// (2) ELECTRICAL TRUTH: sldAdapter passes the real branch plan (microBranches)
// + engine fill/vdrop/EGC; renderer ceil(md/16) + 100A-branch-OCPD fallbacks
// dead; PV-4B branch rows = real AC amps (plan sizes × per-micro output);
// PV-5 POI label prints rated AC output (77A not 8.2A), code-text 690.56(C)
// placard, added 690.13(B)/690.56(C)(3) labels, 705.10 directory all cycles;
// "3#32 THWN-2" corruption fixed (plain-gauge extraction).
// (3) STRUCTURAL SINGLE ENGINE: V4 overwrites rules-engine wind/attachment
// values; deflection = live vs L/240 + total vs L/180 (IBC 1604.3 — the old
// L/240-on-total manufactured the 145% "failure"); F'b printed from the
// engine (CF included); snow-per-attachment computed; VAL-1 roof check reads
// real utilization; CERT letter conditional (never certifies over a failing
// check); rafter-rule rows deduped off PV-4A/PV-4C; span marked ASSUMED.
// (4) RACKING SINGLE-SOURCED: canonical.mountSystem = selected system (DB),
// PV-3 lag/embedment physically coherent (length ≥ embed + stack), APP-A
// racking table from the same DB record.
// (5) OVERFLOW: dynamic page assembly (numbering derived), SCHED-2 BOM
// continuation sheet, VAL-1 out of the AHJ deliverable (internal opt-in),
// cover index mirrors assembly, compact cover notes.
// (6) FIRE: setback width per IFC 1204.2.1.1 coverage test (>33% → 36");
// pathways DRAWN as green corridors + legend/note; §605 citations → §1204.
// (7) PV-2B: per-plane serpentine chains + Manhattan transitions, homeruns
// land at a JB clamped ON the roof, honest conduit note.
// (8) 52-vs-53: designed (GPS) modules are never silently obstruction-
// filtered — conflicts become FIELD VERIFY warnings.
// (9) DELIVERABLE HYGIENE: no vendor-as-EOR fallback, no version badges on
// customer sheets, CERT dates single-sourced, phantom ESS legend gone,
// PV-1 parcel gates on the crop window and full segments, multi-plane
// azimuth display, APP-A specs reproduce nameplate + match layout dims,
// pitch printed self-consistently (1-decimal ratio) set-wide.
// 47381 (2026-07-03): real-data fixes from Ray's v47380 regen (BRAIDON (10).html):
// (1) An AHJ ridge-setback of exactly 18" no longer bypasses the IFC 1204.2.1.1
// coverage test (18 is the bare exception value / DB default, not an
// amendment) — his 47%-coverage roof drew 18" bands again; only AHJ values
// >18" pass through untested. (2) PV-1 property line restored for parcels
// larger than the frame: Liang–Barsky segment clipping against the crop
// window (≥80px total visible), EVERY long visible run labeled — the
// full-segment gate had suppressed the line entirely on his apartment-lot
// parcel. (3) APP-A prints a red EQUIPMENT COMPATIBILITY warning when module
// Voc exceeds the inverter's max DC input (Maxeon-3-on-IQ8A shipped silently;
// upstream gate fix spun off). (4) PV-0 vicinity aerial 220→150px and PV-4C
// auto-resolutions table compacted/capped at 5 rows (real-data overflow).
// (5) RT-Mini/rail-less attachment callout says 'direct-attach mounts', not
// 'L-foot'.
// 47382 (2026-07-03): AUDIT ROUND — 9-agent verification of Ray's v47381 regen
// against all 61 teardown findings (34 fixed / 34 partial / 26 still-present;
// audit JSON in session scratchpad). Root theme: sheet TEXT still contradicted
// the fixed DRAWINGS, plus a stale stored artifact resurrected old defects.
// (1) E-1 uses the LIVE SLD first — a stored "Generate SLD" SVG is frozen at
// its old engine version and re-shipped every fixed defect (build badge,
// '3#32' corruption, ceil/16 branches); stored is now fallback-only.
// (2) ONE fire-setback rule (lib/permit/utils/fireSetback.ts) feeds the
// drawing, PV-2 data zone, and PV-2B notes — no more "1.5' EDGES" text beside
// 3'-0" hatched bands; PV-2B note states the coverage basis.
// (3) PV-3 detail SINGLE-SOURCED with its own specs table: adapter passes
// mountingSystemId/_canonical/resolvedAttachSpacingIn through to templates
// (they were stripped — the root cause of drawing-vs-table contradictions);
// callouts/notes/layers use DB lag+embed; rail-less wording; dimensions
// de-duplicated + de-collided; detail circle enlarged w/ fixed-pitch leader
// labels; UTILITY ANALYSIS block was near-white text on white (now dark).
// (4) titleBlock construction note prescribes 705.11 tap language on
// supply-side jobs (was load-side backfeed boilerplate set-wide).
// (5) Scale statements unified: title block prints AS NOTED only on drawing
// sheets (PV-1/2/2B/3), NTS elsewhere; cover sheet-ID row matches.
// (6) PV-0 vicinity: PROJECT SITE pin label (was empty), NTS to corner (sat
// on the house), north arrow, address caption in normal flow; module-wattage
// no longer printed twice; AC/DC kW precision unified at 2 decimals.
// (7) PV-2 flags designed-module/obstruction CONFLICTS in red (module drawn
// over a vent shipped unmarked); attach-spacing text single-sourced on the
// plan sheet too.
// (8) PV-1: legend keys = the same UM/MSP/AC/CB tag codes as the wall chips
// (numbered rows never matched the plan), leaders stop short of their text
// (self-strikethrough), emoji footer gone, honest legend swatches, disconnect
// name consistent between legend and plan.
// 47383 (2026-07-03): audit-round 2 (layout craft).
// (1) PV-2 setback hatch paints OVER the modules (painting modules on top hid
// every violation); modules inside a band get a red ◇ flag, counted in the
// general notes with "RELOCATE OR OBTAIN AHJ EXCEPTION". In-band setback
// labels de-collide globally (min 60px apart, min 150px band) — kills the
// NW/SE-corner label crisscross. Legend module swatch shows the real 4
// attachment points + an encroachment key.
// (2) PV-0 leads with a real headline ("PHOTOVOLTAIC ROOF MOUNT SYSTEM",
// 23px) instead of branding the racking vendor at 8px.
// (3) PE-1/CERT structural tables: load combos restated as ASD (ASCE 7-22
// §2.4, 0.6D+0.6W) to match the ASD capacities they sit beside — the LRFD
// §2.3 pairing was an engineering-review red flag.
// (4) PV-3 sidebar callout de-hardcoded (3/8" @ 2.5" → DB lag/embed via
// d.lagSpec) + rail-less wording; cross-section dims moved off the eave
// stack (self-strikethrough).
// 47384 (2026-07-04): audit of Ray's v47383 regen ((12).html) — cross-sheet
// single-sourcing round.
// (1) SCHED BOM sized the AC disconnect/fuses from DC kW (31.2 → 175A RK5
// fuses in an Eaton 200A disco) while PV-0/PV-4B/E-1 specify the 100A fused
// disco (75.6A × 1.25). bom-engine-v4 takes acOutputKw and sizes all AC-side
// gear (disco/fuse/backfeed/EGC/GEC fallbacks) from the AC nameplate.
// (2) APP-A 690.8 table printed Voc ×1.25 = 62.3 V "max" directly across from
// the inverter's 60 V DC limit with no flag. Now prints the exact NEC 690.7(A)
// cold-corrected Voc (project designTempMin, same input the engines use) and
// the red EQUIPMENT COMPATIBILITY warning fires on the CORRECTED value.
// (3) Attach spacing + lag spec single-sourced set-wide: PE-1 and the PV-4C
// requirements block now use the same engineering-resolved chain as PV-3
// (structural.attachment.maxAllowedSpacing → user input → racking max) and
// the mounting system's lag dia/embed — they printed 48" max / 3/8" beside
// PV-3/PV-4C-analysis' resolved 24" / 5/16" for the same job. APP-A's "Max
// Attach Spacing" prefers the resolved value over the racking's rated max.
// (4) PE-1 prints the pitch the structural engine analyzed (CAD plane[0] →
// project) — the letter claimed project.roofPitch 4.4:12 (20.0°) while the
// analysis above it ran on the 17° CAD plane (PV-0/PV-2 print 3.6:12).
// (5) Seismic Design Category single-sourced: PE-1/CERT '|| D' fallback
// printed SDC D beside PV-0's AHJ-derived CAT. B; now falls back to
// project.seismicCategory, then '—' (never invents a category).
// (6) PV-4C load-combo block restated as ASD §2.4 (0.6D+0.6W / D+S) — 47383
// fixed PE-1/CERT but this sheet still quoted LRFD §2.3 (0.9D+1.0W,
// 1.2D+1.6S) beside ASD capacities.
// (7) PV-4C auto-resolutions render as a compact footnote line (the 5-column
// table sat after the page conclusion and fell entirely past the page bottom
// on real data — invisible in print); typical-detail SVG slimmed 220→168px.
// (8) PV-0 vicinity aerial fills the space the column has left (flex,
// min 90px) instead of a fixed 150px that pushed the section 27px past the
// page bottom; CERT "Date of Certification" left blank for the PE (the
// prefilled issue date read as the license-expiration value above it).
// 47385 (2026-07-04): Ray's battery regen ((13)-era) — visual-fidelity round.
// (1) PV-1 module layer REGISTERS to the imagery: whole-roof bbox-center
// fallback when Nearmap returns fewer subject polygons than design planes
// (per-plane matching degenerated → shift always rejected → modules rendered
// ~1 m off, south row read as past the eave).
// (2) Fire setbacks are PER EDGE TYPE per IFC 2021 §1204.2: ridge gets the
// coverage-resolved 18"/36", hips/valleys 18" (§1204.2.1.2), eaves/rakes
// NONE — the blanket 3'-0" band on every hip buried the W/E planes in
// keep-out hatch. Labels/legend/data zones/callouts say which edge.
// (3) PV-2/PV-2B general notes get an opaque backing (printed over the NW
// hip hatch when the roof extended into the left column).
// (4) PV-0 construction notes scale with count (battery packages carry 22+
// notes — ran 31px past the page); PV-5 label schedule splits into two
// side-by-side half tables (all-13-labels battery case ran 81px past).
// (5) Micro overpower pairing surfaced: computed-system warns when module
// STC W > 1.55× the micro's AC rating (600W-on-IQ8A = 1.72 shipped silently
// as "31 kW DC / 18 kW AC"); APP-A prints the red compatibility warning for
// the same condition. Battery brand/model resolved from batteryId at permit
// build (L-8 BESS placard printed "Manufacturer: —").
// 47386 (2026-07-04): Ray's (13).html sweep ("plethora of problems") — 7 fixes.
// (1) PV-2B trunk routing is COLLISION-SCORED: plane transitions + homeruns
// pick the axis-aligned route (Manhattan corners + 4 array-bbox skirts) that
// passes through the fewest module bboxes — the fixed corner drew the trunk
// straight through other branches' modules. Cross-hip branch MEMBERSHIP is
// intentional (Ray's economical-branch directive 2026-07-03).
// (2) PV-4A now surfaces the micro overpower pairing as a WARNING row +
// count — it declared "0 warnings / complies" while APP-A red-flagged the
// same 600W-on-349W pairing.
// (3) PV-1: equipment labels sit on opaque plates (were halo text on the
// neighbor's parked cars), lot lines carry TRUE ground-length dimensions
// from the county ring, and the non-standard computed "1
// ≈ 14'" ratio is
// gone (graphic scale bar carries the scale).
// (4) PV-3: callout bubbles at a 16px pitch (r7 bubbles at 13px stacked on
// each other), leaders land at the text BASELINE with a horizontal landing
// (mid-glyph endpoints read as strike-throughs), rafter-O.C. dim moved off
// the section's thick baseline, attach dim de-collided; utility name
// humanized ('il-ameren-illinois' → 'Ameren Illinois').
// (5) E-1: "(N) AC DISCONNECT" node label moved above the enclosure (it
// printed exactly on renderDisco's internal header — the garbled label);
// embedded SLDs suppress the internal SOLARPRO title panel + crop the
// viewBox (it duplicated the sheet title block).
// (6) BOM disconnecting-means labels = AC/DC disco + POI (NEC 690.13), not
// inverterCount+1 (printed qty 53 on a 52-micro job).
// (7) PV-4B supply-side jobs: AC Output lands at "Supply-Side Tap @
// Service" and the EGC at the disco ground bus (both said "Main Panel");
// PV-2B JB note gets an opaque backing (hip/eave linework struck it).
// 47387 (2026-07-06): market-readiness round — honesty + density.
// (1) Encroachment test = module FOOTPRINT (center + 4 rotation-aware
// corners) vs setback bands — the centers-only test let a module overlap a
// band by half its width silently.
// (2) Display azimuths snap to the sheet axes within the regularizer's 8°
// tolerance (table read 3°/273°/89° beside axis-squared linework).
// (3) PV-4A carries an AC BRANCH CIRCUIT SCHEDULE (per-branch devices/amps/
// ×1.25/OCPD/conductor/terminus from the same planMicroBranches plan PV-2B
// draws) + an INTERCONNECTION SUMMARY block — the bottom 60% shipped blank.
// (4) APP-A upgraded to DATASHEET-GRADE: real manufacturer Vmp/Imp/temp-
// coefficients/NOCT/cell-type from equipment-db (Vmp was estimated Voc×0.83,
// coeffs hardcoded), plus PV MODULE and MICROINVERTER datasheet-reference
// tables (max system V, series fuse, MPPT range, max input current,
// units/branch, CEC eff, RSD, warranties). The 690.7 Voc calc now uses the
// module's own coefficient.
// (5) PV-3 structural canvas 520→800 (was letterboxing into a half-blank
// sheet): FASTENER & HARDWARE SCHEDULE (lag/embed/pilot/torque/flashing/
// bonding) + WATERPROOFING & ROOFING NOTES fill the band below the section;
// section + detail circle pinned to their original frame so the taller
// canvas can't slide them.
// 47388 (2026-07-06): Ray's Google-fallback render exposed a class bug —
// PV-1 overlay furniture was sized in ABSOLUTE image pixels and ballooned
// ~2.4× on a 640px Google crop (giant plates burying the aerial; Nearmap's
// ~900px crop was the only case ever verified). All PV-1 furniture (labels,
// plates, chips, leaders, street label, canopy/parcel labels, lot dims,
// scale-bar plate, north arrow, neatline) now scales with fk = cropW/900,
// verified at BOTH resolutions. (2) PV-2 fit-to-frame RESERVES the tables/
// notes column (280px, plan mode only) so the roof can never slide under it
// — replaces the opaque-backing patch that erased linework. (3) On-screen
// VIEWER in the HTML shell: gray desk, sheet shadows, fixed toolbar (zoom
// in/out, fit-width, 100%, sheet prev/next + indicator, print), keyboard
// +/−/0; print CSS hides the toolbar and resets the transform so print/PDF
// output is byte-identical. Default = fit-width for laptop readability.
// 47389 (2026-07-06): STRUCTURAL TRUTH — Ray zoomed into PE-1's DO-NOT-ISSUE
// and called it ("we drive screws into trusses all the time"). The letter was
// failing on FICTION: the UI held framingType 'unknown' but never threaded it
// into the permit payload, and generatePermit coerced everything non-truss to
// 'rafter' — the V4 engine's own auto-detect (24" O.C. → truss, BCSI capacity
// path) was unreachable, and the span was a flat 12 ft guess. Now: (1) the
// engineering payload threads framingType/rafterSpan/rafterSpecies; (2)
// generatePermit passes 'unknown' through so auto-detect runs; (3) span
// derives from the ROOF GEOMETRY when unset (truss = building short
// dimension, stick = half of it) labeled 'PER ROOF GEOMETRY — FIELD VERIFY';
// (4) PE-1 truss rows speak truss (BCSI basis, capacity in PSF, governing
// utilization, deflection per truss mfr) instead of lb-ft stick concepts.
// Melvin: truss @ 24" O.C., span 32.4 ft, 31.1/35 psf = 89% PASS — letter
// certifies instead of DO-NOT-ISSUE. Explicit rafter still runs the honest
// stick path.
// 47390 (2026-07-06): PV-1 module↔imagery alignment on GOOGLE-FALLBACK
// aerials (Ray's 07-06 render: modules hung past the south eave). Google has
// no imagery-registered vector layer — Solar API roofSegments belong to a
// NEIGHBOR building on Melvin (measured 14 m off), so registration now comes
// from the IMAGE: utils/aerialEdgeSnap.ts grid-searches a ≤3.5 m translation
// that lands the design roof hull on the strongest oriented Sobel edges
// (route pre-pass → aerialData.registrationShift → PV-1 toPxD). Confidence
// gates (score ratio ≥1.3, ≥50% of perimeter on edges, no boundary lock)
// fail OPEN to the previous unshifted behavior. Melvin real-Google fixture:
// 1.11 m shift, ratio 3.34 — modules land on the roof pixels; Nearmap path
// byte-identical (its vector registration is untouched).
// 47391 (2026-07-06): PV-1 module ROTATION regularizer (Ray: "straighter to
// the edge of the roof"). PV-1 drew each module rotate(rawAzimuth); hand-
// traced planes carry ~3° azimuth noise so opposite slopes of one ridge
// weren't exact opposites (Melvin N 3.2° vs S 180.1°) → the top array
// rendered canted off the eave while the bottom sat straight. New
// utils/moduleAzimuthGrid.ts snaps each module's DRAW rotation to the
// building's principal 90° grid (doubled-angle circular mean; near-square
// buildings collapse to true cardinal → matches PV-2's 0/180/270/90),
// leaving genuinely off-grid arrays (>10° from grid) alone. Display-only,
// same spirit as regularizeRoofPlanes; positions untouched. Both Melvin
// arrays now render upright and parallel to the roof edges.
// 47392 (2026-07-06): PV-1 module WIDTH from design pitch (Ray: "hip cluster
// looks messy"). The payload often omits real panel dimensions and the 66×40"
// default drew modules ~10% narrower than the placement pitch (1.13 m vs 40" =
// 1.016 m) → an ~11 cm gap between every module. On the small triangular hip
// clusters those gaps made 4 panels read as scattered tiles. sitePlan now
// derives the drawn width from the median nearest-neighbour spacing (= module
// footprint in its tightest-packing direction) less a hairline rail gap, so
// panels tile as solid blocks; length already matched the ~66" row pitch.
// Applies only when the real width is absent; sanity-bounded 0.6-2.5 m. Module
// positions untouched — the hip layout is still the design's, just drawn tight.
// 47393 (2026-07-07): DE-SKEW the array to TRUE lines (Ray: "the arrays are
// slightly askewed and not recognizing lines of trueness … left side not
// snapping true, other 3 fine"). Measured cause: the design's per-plane grid
// noise is UNEVEN — Melvin's WEST plane grid sits 3.1° off cardinal while N/S/E
// are all <0.8°, so only the west cluster looks crooked. New
// utils/deskewArrayToTrue.ts runs ONCE at the source (route, before render +
// snapshot): (1) snaps every plane's + panel's azimuth to the building cardinal
// grid so rectangles draw true; (2) measures each plane's own grid tilt from
// its row/col structure and rotates that plane's panels about their centroid to
// remove it, so rows/columns land on true horizontal/vertical LINES. De-skew
// only — same panels/count/arrangement/symmetry; a square plane barely moves; a
// genuinely rotated building is preserved (target = dominant-plane tilt, not
// forced cardinal). Every sheet (PV-1, PV-2, …) now draws the array identically
// square. Verified: west 3.29°→0, all four planes 0.00°, both hips symmetric.
// 47394 (2026-07-07): PE-1 structural — recompute when the saved result is
// STALE, not just missing. The V4 truss auto-detect (v47389) was being bypassed
// whenever the payload already carried a structural result: needsCalc only fired
// on missing/zero bending, so a stale worst-case STICK analysis (framingType
// 'rafter', assumed 12ft span, 109% deflection) survived and printed a false
// "DO NOT ISSUE" on a trussed house. needsCalc now also fires when the saved
// framingType disagrees with what the current design resolves (explicit
// selection, else 24" O.C.→truss). Melvin: stale rafter/109%/DO-NOT-ISSUE →
// live truss/32.4ft-geometry-span/89%/PASS/certifies. Same stale-payload class
// as the 600W module drift — never trust a saved result the inputs contradict.
// 47395 (2026-07-07): CERT letter speaks TRUSS on trussed houses. The
// certification paragraph hard-coded rafter language ("rafter bending stress
// F'b …, bending utilization 0%, deflection Δ = — in") even for trusses (which
// have no bending/deflection numbers). Now branches: truss → "pre-engineered
// truss load capacity (governing utilization X%; member deflection to be
// verified with the truss manufacturer)"; stick keeps the rafter wording.
// 47396 (2026-07-07): APP-A module efficiency + physical dims from the
// equipment-db record, not the 66"×40" layout default. A 440W module over the
// generic 66×40 footprint back-computed to 25.8% efficiency (physically
// impossible for silicon); now uses the manufacturer/CEC datasheet value
// (Philadelphia Solar 440W → 22.6%) and real 67.8"×44.6"/46 lbs dims. Efficiency
// is never back-computed from a drawn footprint when a DB record resolves.
// 47397 (2026-07-07): two minor completeness fixes. (a) BOM PV Junction Box
// manufacturer was hard-coded "TBD" → now specs a real Soladeck 0786-41 (or
// approved equal), the industry-standard roof-flashed open-air-to-conduit box.
// (b) NEC 220.82 dwelling-load Step 1 now labels the sqft as "assumed from the
// service size — field verify" (no dwelling-area field exists on the project; it
// is keyed to service amps), matching the HVAC row's existing field-verify note.
// 47398 (2026-07-08): PV-2 site-context inset (Phase 1). A parcel-scale plot view
// (county-GIS property line + edge dims, building/roof footprint, PV array,
// street name label, service equipment, approximate building/array→property-line
// setbacks, north, scale, APN, provenance) is injected into the roof SVG's empty
// bottom-left reserve — the main roof/module viewport is untouched. Renders only
// when a county-GIS parcel is present; otherwise the roof plan is kept as-is (no
// fabricated lot). All GIS-derived geometry/dimensions labeled APPROXIMATE. No
// driveways/sidewalks/roads fabricated; a provider seam (approved-only) is left
// for later. Parcel fetch wired into the permit route (POST + GET self-heal).
// 47399 (2026-07-08): PV-2 inset render fix for REAL parcels. A large apartment/
// complex lot (Braidon's actual parcel) shrank the building to a dot and drew a
// clutter of ~12 overlapping edge-length labels over a jagged boundary. Now the
// inset ZOOMS to the building + adaptive margin (enough to show the nearest
// property line when reasonable), CLIPS the parcel to that window (nearest lines
// only), and skips per-edge dimension labels on complex (>8-vertex) lots. Footer
// cleaned. Simple small lots still show the full parcel with edge dims.
// 47400 (2026-07-08): PV-2 site context INTEGRATED into the main roof drawing
// (Ray: the driveways/sidewalks belong WITH the roof drawout, not a separate
// box). Removed the bolted-on plot inset; drawRoofPlan now draws the property
// line + street + driveway + sidewalk in the roof's own frame (real lat/lng →
// cad.origin → fake-degree → toX/toY), fit window expands to include the lot
// (capped so the roof stays prominent). Gated on a county-GIS parcel; roof-only
// (byte-identical) when absent. See lib/drafting/templates/roofSiteContext.ts.
// 47401 (2026-07-08): PV-2 site plan now draws REALITY, not guesses. Added
// lib/aerial/siteFeatures.ts (OpenStreetMap via Overpass) → real road
// centerlines + names (drawn where the road actually is) and real surrounding
// building footprints (critical for apartment complexes: Braidon's building is
// 1 of ~13 on a single 3.12-ac parcel). REMOVED the inferred driveway/sidewalk
// (no data behind them). Fetched in the async permit route alongside the parcel.
// 47402 (2026-07-08): (1) RT-Mini feet drawn STAGGERED @ 48" O.C. (Ray: not a
// foot per module / not 2 ft O.C. — over-built labor). Both foot-rows start on
// the same rafter; top row +2 ft then 4 ft O.C., bottom row straight 4 ft O.C.
// Attach-spacing callout + SYSTEM DATA + ATTACHMENT ZONE now say 48" O.C.
// STAGGERED for rail-less. (2) Plane callouts decluttered → small numbered
// badges keyed to the ROOF DESCRIPTION table (were 3-line boxes burying the
// modules). (3) Fixed the OSM site-features fetch (GET not POST — POST→406).
// 47403 (2026-07-08): RT-Mini CANTILEVER logic (Ray). Foot+RAIL now drawn at the
// 25%/75% points of the module (equal cantilevers, 50% span carries the load);
// feet on rafters @ 48" O.C. staggered; END OVERHANG capped at 18" — a
// DECK-MOUNTED foot (open ◻) is placed where no rafter falls within 18" of the
// end panel edge (else the panel droops). Legend + general note added. Also:
// roads pulled into the PV-2 fit window + more Overpass mirrors (datacenter IPs
// like Vercel get rate-limited on the main instance — parcel uses a diff source).
// 47404 (2026-07-08): BIG/SHARED PARCEL → frame the SUBJECT building (Ray: when
// the parcel holds >1 livable building we only want to see what we're working
// on). When the parcel is >2× the roof extent (apartment complex / big rural
// lot), the PV-2 fit tightens to 1.4× the roof so the building dominates and the
// attachment detail stays readable, instead of cramming the whole 3-ac lot in.
// A normal home lot still shows the full lot + street. Uses parcel-vs-roof extent
// (robust) rather than a point-in-parcel test on OSM footprints (they don't
// register to the county GIS lot — 0/13 matched Braidon's parcel).
// 47405 (2026-07-08): PHASE B — REAL site surfaces from Nearmap AI. mapNearmapSurfaces
// pulls Driveway / Concrete-Asphalt-HardSurface (walks+paving) / Road / Building
// footprints from the AI Feature response; drawn as filled polygons on PV-2's
// site layer (preferred over OSM). QUOTA SAFETY (trial = 100 parcels): new
// lib/aerial/nearmapCache.ts + migration 102 (nearmap_ai_cache) persist each
// location's response so a property costs AT MOST 1 AI parcel EVER (in-memory
// cache dies on Vercel cold starts). Coverage check SKIPPED (trial keys lack
// coverage v2 → would 403). Route fetches once, prefers Nearmap, OSM fallback.
// 47406 (2026-07-08): Nearmap surface CONTRAST — the light-gray fills blended into
// the sheet. Neighbor buildings now draw with a clear dark outline (read as
// footprints), driveways get a diagonal HATCH + "DRIVEWAY" label (standard
// site-plan treatment), road/walk grays darkened. Same real data, readable.
// 47407 (2026-07-08): ★ THE BUG — Nearmap/OSM surfaces never reached the render.
// The POST route fetched them onto aerialData, but the aerial RE-CENTER
// (enrichedBody.aerialData = _recentered) REPLACED aerialData right after, wiping
// them; the parcel survived only because it's re-fetched post-recenter. Moved the
// surface fetch (Nearmap AI + OSM fallback) to AFTER the re-center, next to the
// parcel re-attach, so driveways/paving/buildings actually land on PV-2.
// 47408 (2026-07-08): SOFTSCAPE + SHADING — mapNearmapSurfaces now also extracts
// Lawn/Pervious and tall Vegetation (>2m). PV-2 draws lawn as a light-green base
// (site reads as landscape, not a gray hardscape sea) and tree canopies as
// semi-transparent green; a canopy reaching the array is outlined amber + noted
// (SHADING — FIELD VERIFY). Same cached AI response, no extra parcel.
// 47409 (2026-07-08): SETBACK DIMS + SUBJECT EMPHASIS. (1) Setback dimensions —
// ray-cast from each building side to the nearest property line; draw a dim line
// + distance where it fits (≤70 ft, so normal home lots get front/side/rear
// setbacks; big shared lots skip and keep the closest-approach note). (2) De-
// noise — neighbor buildings + non-shading trees fade with distance from the
// subject so it + its immediate context read crisp and the far complex recedes.
// 47410 (2026-07-08): EQUIPMENT ON THE SITE PLAN (roadmap #4) — meter/MSP/AC
// disconnect located on the building wall (survey-photo GPS or street-side
// heuristic, the same locateEquipment PV-1 uses) and drawn as UM/MSP/AC tags
// clamped just outside the roof footprint, keyed to a "SERVICE EQUIP" legend row.
// 47411 (2026-07-08): FOLD PV-1 → drop a page ("less is more"). The standalone
// site plan is retired; the array sheet now IS the site plan (integrated site
// context) and is renamed PV-1 (was PV-2); array geometry → PV-1B (was PV-2B).
// Statutory clearance notes (gas-meter 3', vents, knife-blade disconnect)
// migrated into the shared construction notes → cover General Notes. Cover
// vicinity aerial enlarged. Downstream sheet indices renumbered set-wide.
// 47412 (2026-07-08): PV-1B circuit-sheet polish (branch-color mode only, PV-1
// untouched): removed the redundant in-drawing "CIRCUIT LAYOUT" watermark +
// bottom caption reworded to a color key; AC-branch daisy-chain routing made
// bold (the sheet's hero); fire-access pathway labels dropped (they live on
// PV-1); and the drawing now frames the ARRAY (modules + margin) instead of the
// whole roof plane, so a small array no longer renders tiny in a sea of white.
// 47413 (2026-07-08): PV-1B redesigned to the CANNON PE-set style (Ray's ref).
// Modules are no longer garish solid branch-color blocks — they're clean uniform
// white outlines (like PV-1), the branch identity carried by THIN colored circuit
// WIRES + a small circuit number per module + an in-drawing CIRCUIT LEGEND box.
// 47414 (2026-07-08): PV-1B pro-parity — Ray "should be visually similar to PV-1".
// Un-gated PV-1's rich frame onto the circuit sheet: site context (faded 0.5 so
// wires stay hero), overall dimensions, full N/E/S/W compass rose (was a plain
// arrow), and the faint rafter framing lines. Full symbol legend stays PV-1-only
// (PV-1B keeps the compact CIRCUIT LEGEND). PV-1B is now a sibling of PV-1.
// 47415 (2026-07-08): PV-1B = the ELECTRICAL sheet (PV-1 = physical/setbacks).
// Draw the IQ8 MICROINVERTER under each module (dark device box, branch-color
// outline) + "IQ8 MICROINVERTER" legend row + caption; the AC branch wires
// daisy-chain them per circuit. Also matched leftReserve (280) on both sheets so
// PV-1B frames at the same zoom/scale as PV-1 (was more zoomed at reserve 0).
// 47416 (2026-07-08): PV-1B cleanup — un-gated vents/obstructions onto PV-1B
// (a circuit can't route through a vent keep-out); plane numbers now sit OFF the
// plane with a leader line to the facet centroid (both sheets), decluttering the
// roof. Verified the micro string sizing matches Enphase IQ8 spec (IQ8+ = 13 per
// 20A branch) and fixed a stale "16 units" comment (that was IQ7+, not IQ8+).
// 47417 (2026-07-08): PV-3 attachment-detail cleanup (Ray "absolute trainwreck").
// The giant empty detail circle (r=148, tiny stack floating in it) is right-sized
// (r=122) with the zoomed layers filling it and a LAG BOLT drawn penetrating
// flashing/shingle/sheathing INTO the rafter with the embedment dimensioned — the
// actual point of an attachment detail. Removed the triplicated ①–⑦ callout list
// (killed the in-drawing "ATTACHMENT CALLOUT SCHEDULE"; the data-zone keeps the
// one schedule) and the stray UTILITY ANALYSIS block that doesn't belong here.
// 47418 (2026-07-08): PV-3 detail circle under-filled at 47417 (stack only filled
// the middle half → still read as an empty bubble). Enlarged the zoomed layer
// stack (~119→~194px) so the detail fills the r=122 circle edge-to-edge; lag bolt
// auto-scales with it. Page-level blank lower area still pending a layout pass.
// 47419 (2026-07-08): PV-3 detail rebuilt to a REAL MECHANICAL ASSEMBLY vs the
// flat colored layer-cake (Ray sent the Cannon PE reference — "looks like dook").
// Now draws the actual hardware: module frame + laminate, clamp, mount + base
// plate (steel-hatched), butyl flashing pad, seated on shingle/sheathing/rafter,
// with the lag bolt (hex head + EPDM washer) driven into the rafter + embedment
// dim; numbered leaders out to labels. Still to do toward full Cannon match: iso
// context view + mounting BOM + finer clamp/rail geometry + page vertical-fill.
// 47420 (2026-07-08): PV-3 detail → TRUE CAD LINE-ART (multi-agent workflow spec):
// white/hatched fills (zero saturated color), strict 4:2:1 line weights, real
// hardware profiles (hollow frame extrusion, top-hat clamp + WEEB serration,
// T-slot base + riser, lag screw w/ chamfered hex head + EPDM washer + hidden
// threads in rafter), rebalanced proportions (bigger hardware, thin separated
// layers). This is now the FALLBACK; the plan (Ray-approved) is to EMBED real
// MANUFACTURER attachment details from a DB asset library keyed by racking brand.
const PLANSET_ENGINE_VERSION = 47420;



export { PDF_PAGE_CONFIG, PLANSET_ENGINE_VERSION };
