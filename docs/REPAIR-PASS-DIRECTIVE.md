# Post-Campaign Source-of-Truth Repair Pass — Directive

Status: ACTIVE 2026-07-22. Audit target: `PermitPackage-BRAIDON M PILLA — Solar TEST (2).html`
(PDS-310F43D87A27). Root-cause map: `docs/REPAIR-PASS-ROOT-CAUSE-MAP.md` (Phase 0 complete —
delivered package was a pre-d201ea21 deploy, but ~20 findings are LIVE at HEAD).

Primary rule: INPUT AUTHORITY → NORMALIZATION → ENGINE CALCULATION → VALIDATED
PermitDesignSnapshot → READ-ONLY SHEET PROJECTIONS → CROSS-SHEET EVIDENCE.
No renderer may invent, infer, calculate, override, or substitute engineering truth.
Fix at canonical source only; no HTML patching; no fixture tuning; no parallel engines.

## W1 — Electrical segment authority
One canonical ElectricalRouteSegment per physically distinct section: micro AC trunk/Q-Cable;
branch home-run; roof junction-box; branch raceway; combiner feeder; combiner-to-disconnect;
disconnect-to-tap; tap conductors; service equipment connection. Fields per segment: segment
ID; from/to device IDs; electrical function; operating current; continuous current; calculated
current; OCPD; conductor count/size/material; insulation; neutral status; EGC/bonding method;
raceway type/size/fill; length + length source; temperature basis; derating factors; voltage
drop; installation method; provenance; verification status.
Separate operating current from OCPD (PV-4B: 60 A shown beside VD computed ~45 A) — snapshot
and projections distinguish operating / continuous-load / design current / breaker rating; the
VD formula states which current it used. One segment set projects identically to E-1, PV-4A,
PV-4B, PV-5, PV-6, SCHED, SCHED-2, electrical BOM, labels, disconnect directory — no
sheet-local conductor/conduit/length/fill/VD calc. Resolve branch-routing ambiguity (no OPEN
AIR on E-1 while PV-4B gives 60 ft EMT) via separate sections w/ own segment IDs + displayed
boundaries. Fail closed: undefined/NaN/null numerics, missing fill, missing required length,
unresolved boundary, missing sizing, cross-projection mismatch = blocking; PENDING may render
but no global PASS / zero-warning claim while required inputs pending. PV-4A compliance summary
must derive from snapshot validation results, not a local counter (kill the legacy rules-engine
summary) — blocking tests.

## W2 — Service and disconnect topology
Explicit canonical objects: IQ Combiner branch breakers; combiner aggregate breaker/load-break;
rapid-shutdown initiation device; PV system disconnecting means; fused supply-side tap OCPD;
utility-accessible lockable generation-source disconnect; utility meter; main service
equipment; physical tap point; tap conductors. Fields: device ID; manufacturer/model; location;
rating; enclosure; fused/non-fused; lockable; service/PV function; rapid-shutdown function;
upstream/downstream relationships; conductor segment IDs; labeling requirements; utility
requirement basis; verification status. PV-6 must not describe a separate fused utility
disconnect as integral to the combiner; load-break ≠ fused tap disconnect; RSD initiator ≠
utility disconnect; tap-length rule only on the tap-conductor segment; 60-ft downstream feeder
never presented as tap conductor; unknown tap length = PENDING + blocks. Topology graph
validation: one role per device (or documented multi-role listing); every edge references a
canonical segment ID; no renderer renames devices; tap OCPD/utility-disconnect physically
coherent.

## W3 — PV-1/PV-1B projection regressions
Kill "WIRED IN SERIES PER AC BRANCH" (roof.ts renderer literal) via canonical
topology-description accessor → "MICROINVERTERS CONNECTED IN PARALLEL ON ENPHASE Q CABLE AC
BRANCH CIRCUIT". One RouteVerificationStatus authority (unverified estimate / CAD-derived
estimate / field measured / field verified / as-built verified); ALL route notes project it;
estimated route never prints "field-verified" (sheetComposition.ts:733 literal). Package-wide
regression tests: no "wired in series"; no "field-verified" without recorded field
verification; no string-layout terminology on a micro AC-branch sheet.

## W4 — Microinverter BOM topology
BOM rows from canonical physical objects only. 1:1 micro design distinguishes module factory
leads/connectors, short module-to-micro DC connection, Q-Cable AC trunk, terminators, sealing
caps, junction boxes, AC branch home runs. No string home-run wire unless an actual DC string
segment exists (kill #10/#12 USE-2 DC rows). Q-Cable = AC branch equipment. Terminators/caps/
connectors/branch lengths/unused-drop caps from actual branch topology + cable-end objects.
Raceway fittings per specific segment (no 1-1/4" PVC "all runs" + 3/4" EMT fittings): each
segment generates matching conduit/connectors/couplings/straps/bushings/transitions. Remove
substitute-equipment phrases ("or equivalent", "or approved equal", "compatible rail",
"typical", "contractor-selected") from permit-authoritative rows unless operator-approved
substitution selected+revalidated an exact product. Semantic scan, not single exact-string.

## W5 — Exact equipment and document authority
APP-A projects ONLY from versioned verified equipment/document records (delete hand-entered
parallel spec DB; audit found IQ8A 1.46A/349VA-peak/96.5%/2.2lb vs datasheet 1.45A max-cont/
366VA peak/349 cont/97.5% CEC/2.38lb). Every displayed manufacturer value carries: equipment
record ID; exact SKU; document record ID; document revision/date; extracted field path;
verification state. Validator coverage: current, continuous VA, peak VA, efficiency,
dimensions, weight, temp coefficients, branch limits, OCPD max, connector/cable requirements.
Exact SKU = IQ8A-72-2-US everywhere (APP-A, DS-2, title blocks, BOM, calcs, schedules). DS-1
must use the exact selected 400 W module document (not generic 395-415 W page) before
permit-ready. Singular ThermalDesignBasis (min/max design temp, source, station, revision,
coefficient source, method, provenance) — APP-A -10°C vs ASHRAE ~-23°C split eliminated; all
V/I/T calcs consume it; no renderer-local temperature.

## W6 — Racking assembly authority
One exact selected RackingAssembly: mount mfr/model/SKU/topology; rail mfr/model/SKU/stock
length; splice SKU; L-foot/adapter; T-bolt; mid/end clamps; bonding washer/lug; fastener
mfr/model/SKU/diameter/length/count-per-mount; pilot-hole rule; embedment; substrate; rafter/
deck condition; capacity doc ID; compatibility doc ID; UL 2703 listing doc; span/cantilever
source. No renderer outputs RAIL-PENDING-SELECTION / compatible rail / or equivalent /
approved equal / generic lag / approximate screw length. Resolve fastener contradiction (2×
5/16×3.5 screws vs 5/16×4 SS lag vs generic) to ONE verified installation or keep blocked
PENDING. APP-A projects mountTopology=rail_paired for RT-MINI (never rail-less/direct-attach).
If no verified exact rail assembly: render "PENDING RACKING ASSEMBLY SELECTION / NOT FOR
PERMIT SUBMISSION", prevent structural PASS, do NOT fabricate.

## W7 — Structural reaction authority
One canonical load basis per check: ASD or LRFD; wind pressure basis; load combination; zone
pressure; tributary area; reaction; capacity basis; adjustments. Never compare ASD reaction to
strength pressure. Replace uniform all-corner/11.0 ft² model OR label it explicitly
CONSERVATIVE SCREENING ENVELOPE (documented: why governing zone everywhere, why area overage,
intentionally conservative, no implied exact distribution) — not "geometric reconciliation".
Remove the 3.0× band: separate validations for exact geometric closure tolerance, documented
envelope ratio, lost-load prevention, duplicate-area prevention, count agreement. 369-vs-404:
resolved (stale deploy; 404 @ 61.15 psf is HEAD truth) — one value only. Attachment-level
artifact: id, rail, plane, coordinate, zone, tributary polygon/area, pressure, basis, uplift,
down, lateral, capacity status, provenance. Harness independently recomputes totals from
objects.

## W8 — Structural capacity and PE-1 gating
PE-1 projects check state from the SAME validated StructuralCheck objects as PV-4C. While
RT-MINI capacity unverified: no 600 lb as accepted allowable, no SF, no PASS, no "confirmed
adequate", no certified adequacy → "CAPACITY SOURCE UNVERIFIED / ENGINEERING REVIEW REQUIRED /
NO PASS/FAIL CONCLUSION ISSUED". Same gate for framing/truss (45 psf generic + 12 ft span +
69% are hardcoded defaults — no framing PASS without verified project-specific authority:
truss drawing, mfr data, species/grade, geometry, bearing, span, loads, engineer calc). CERT/
PE-1 stay visible as pending templates with ZERO affirmative results; package-level scan for
PASS/adequate/confirmed/certified/safety factor/allowable capacity on pending engineering
pages (narrow labeled-placeholder exceptions).

## W9 — Page composition and pagination
Print-layout validation per logical sheet: fits one 17×11 page OR becomes a formally numbered
continuation sheet (own title block, sheet ID/number, snapshot ID/digest, index entry,
continuation title). No browser-overflow unnumbered pages. PV-4C schedule: compact summary +
appendix, or formal PV-4C.1 continuation, or grouped-by-load-case schedule (machine-readable
per-attachment artifact retained). Chromium/PDF render tests: one physical page per logical
sheet unless declared continuation; no clipping; no missing title block; physical count ==
manifest count.

## W10 — Blocker and reconciliation visibility
Canonical PermitReadinessBlocker registry in snapshot: code, severity, authority path,
affected sheets, human explanation, resolution action, source/provenance, created
timestamp/version, resolved status, resolution audit ref. Every rendered review package shows
ALL active release blockers (cover or dedicated review-status sheet referenced from cover) —
no silent omission (fix the structuralBlockers-else-blockers ternary). Equipment identity:
REC-405 vs Qcells-400 conflict is STILL ACTIVE (no operator reconciliation occurred) — restore
to visible registry; renderer changes may not hide it. Project authority stays UNVERIFIED /
PENDING JURISDICTION CONFIRMATION; no ZIP-based inference.

## Permanent blocking gates (validator/regression list)
1 no "wired in series" for micro AC branches; 2 no "field-verified" without record; 3 no
differing raceway/conductor/length/fill/VD for same segment ID; 4 no global zero-error claim
with active electrical blockers; 5 no undefined/NaN/null/non-finite; 6 no string DC materials
in pure micro topology without DC segment objects; 7 no mismatched fittings vs segment; 8 no
substitute-equipment language in authoritative rows; 9 no APP-A field differing from verified
document record; 10 no split thermal basis; 11 no unverified capacity as PASS; 12 no pending
PE/CERT page with affirmative conclusions; 13 no unnumbered overflow pages; 14 no active
blocker omitted from rendered registry; 15 no hidden equipment conflict; 16 no report/evidence
value differing from rendered package; 17 no renderer-local engineering calculation; 18 no
renderer-local product selection; 19 no renderer-local issue-state/cert decision; 20 no
body/BOM/note bypass of canonical code/project authority. Truth matrix inspects RENDERED
output.

## Acceptance deliverables
Root-cause map (done); changed-file list grouped by authority/engine/snapshot/validator/
projection/renderer; regenerated full planset HTML; rendered screenshots all logical sheets;
physical page-count report; canonical segment report; service-topology graph; grounding
report; BOM-to-object reconciliation; equipment/document projection report; racking assembly
report; attachment reaction artifact; structural basis reconciliation; active blocker
registry; equipment-reconciliation audit evidence; cross-sheet truth matrix (zero
disagreements); report-equals-rendered evidence; focused tests; full repo tests vs baseline;
tsc; production build. Harness exits non-zero for any disagreement, missing source, hidden
blocker, unverified PASS, pagination overflow, stale projection, renderer-local calc, or
output/report mismatch.

## Boundaries
Dev only; separate commit; no HTML patching; no fixture-output edits to pass tests; no new
electrical/structural engine; no MFA/migration-governance changes; no auto-reconciling
production equipment; no fabricated AHJ/code/route/equipment/structural evidence; no validator
weakening; no blocker suppression.
