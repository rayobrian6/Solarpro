# Final Source-of-Truth Closeout Pass — Directive

Status: ACTIVE 2026-07-23. Baseline `3a06cc80` (dev). Audit target:
`PermitPackage-BRAIDON M PILLA — Solar TEST (3).html` (PDS-1DDC4EDE238C, 20 sheets/20
pages, engineering-review disposition). Ray's verbatim contract. Final objective: make
SolarPro INCAPABLE of generating these contradictions or clipped sheets for any future
project — never make Braidon merely look permit-ready.

Primary rule: PROJECT INPUTS → VERSIONED EQUIPMENT/AHJ AUTHORITY → CANONICAL ENGINE
OBJECTS → VALIDATED PermitDesignSnapshot → READ-ONLY SHEET PROJECTIONS → OBJECT-DERIVED
BOM → RENDERED-EVIDENCE VERIFICATION. No renderer may calculate, select, infer,
override, or repair engineering truth.

## §1 Remove the remaining PV-4A legacy electrical path
PV-4A's lower advisory/rules content still prints stale authority: NEC 705.12 busbar
PASS, 27.5% fill, 3/4" EMT, PASS — vs canonical supply-side tap (705.12 N/A), 1-1/4"
PVC Sch 80, fill PENDING. Delete/retire the remaining legacy rules calculation path;
every PV-4A detail row projects canonical snapshot results; 120% busbar rule renders
N/A for supply-side; fill reads the canonical segment; PENDING never becomes PASS; no
local default raceway/fill/NEC rule/warning count/pass-fail remains. Regression tests:
changing a canonical segment changes PV-4A, E-1, PV-4B, SCHED identically.

## §2 Fix the PV-1 PVC-vs-EMT contradiction
PV-1 drawing annotation says 1-1/4" PVC Sch 80 while the callout schedule says "conduit
route — EMT". One canonical route-description accessor driven by the exact physical
segment; drawing labels, callouts, notes, legend all use the same segment ID, raceway
type/size, route-verification state, length/provenance. Package-level gate: reject more
than one raceway type or size for the same segment ID.

## §3 Explicitly model branch route sections
Separate per branch: Q Cable under array; junction-box transition; branch home-run
raceway; shared-or-separate branch raceways; combiner termination (e.g.
BRANCH-QCABLE-B1 / BRANCH-TRANSITION-B1 / BRANCH-HOMERUN-B1 / BRANCH-COMBINER-TERM-B1,
×B2/B3, or reference a shared physical raceway). Full field list per segment (id,
from/to devices, physical function, conductor/cable type/count/size, EGC method,
racewayId, raceway type/size, operating current, OCPD, actual length + source, fill,
derating, VD, verification state). No sheet may describe a multi-method branch with one
merged string (PV-4B's "95 ft #12 in 1-1/4" PVC" whole-branch description).

## §4 Audit the 1-1/4" branch raceway engine result
Do not simply shrink it. Determine: separate raceways per branch vs shared vs
accidental feeder-raceway reference vs project-level conduit fallback in computeSystem.
Raceway authority fields: physicalRacewayId, sharedCircuitCount, minimumCodeRacewaySize,
calculatedFillRacewaySize, selectedRacewaySize/Type, upsizingReason, conductor
count/areas, current-carrying count, derating basis, support/environmental conditions,
provenance. Tests: feeder raceway change cannot affect branch raceways unless shared
physicalRacewayId; separate vs shared topologies produce different counts/fill/derating;
oversize requires documented rationale; ambiguous grouping blocks permit-ready.

## §5 Reconcile branch wire quantities with the BOM
PV-4B: 3 × 95 ft branches; SCHED-2 supplies only ~110 ft total #12 (impossible) and
assigns #10 to BRANCH_RUN vs the schedule's #12, plus #10 green EGC. Derive quantities
from actual route segments (conductor count per segment × length × branch count +
neutral/EGC + documented waste). Every BOM row carries source segment IDs or aggregation
ref. No generic "AC wiring" merging branch conductors, EGC, feeder, Q Cable. Evidence:
B1/B2/B3 segment-length table, conductor-by-conductor calc, aggregation proof, no
orphan wire row.

## §6 Replace "all runs" with physical raceway objects
No project-level "all runs" conduit row. Each physical raceway object independently
generates material, size, length, connectors, couplings, bends/elbows, bushings,
straps/supports, expansion fittings when applicable, transition fittings, source route
segments; BOM says which raceway each quantity belongs to.

## §7 Correct raceway code references
PVC Sch 80 rows/support rows cite NEC 358 (EMT-only). Raceway record carries its NEC
article + support rules (PVC → proper PVC article; 358 only when an EMT segment
exists); citations derive from raceway type authority, not a generic template. Tests
for EMT, PVC and mixed-transition systems.

## §8 Remove unused string/DC authority
Pure 1:1 micro project: E-1 still carries generic DC-conductor legend entries; SCHED's
module table includes generic #10 AWG wire + 14-ft run. Render DC conductors only when
canonical DC segment objects exist; model module factory leads/connectors/short
module-to-micro connections, no generic string home run; remove unbacked DC legends/
schedules/lengths; topology-specific gates prevent string materials in micro packages.

## §9 Verify the service-topology physical order
Prove the physical graph order/relationships: PV combiner, combiner load-break,
rapid-shutdown initiator, fused tap OCPD, utility-accessible disconnect, utility meter,
supply-side tap point, main service equipment. Determine whether the fused tap OCPD and
utility-accessible disconnect are ONE listed dual-purpose device or TWO physical
devices — do not render duplicates when one listed device, do not merge when two
required. Device fields: unique id, exact mfr/model when selected, location,
upstream/downstream segment IDs, electrical role, utility role, fused state, lockable,
RSD role, verification state.

## §10 Keep unselected racking documents from looking authoritative
DS-4 shows IronRidge XR100 which reads as the selected rail. Either (A) select+verify
the exact XR100 assembly into RackingAssembly, or (B) rail stays pending: label DS-4
"NON-AUTHORITATIVE REFERENCE — NOT SELECTED", preferably OMIT it from the permit
package until selected; never use its values in calcs/BOM. A datasheet appears as an
authoritative appendix only when its document record is selected by the snapshot.

## §11 Correct RT-MINI terminology
PV-3 still says DIRECT-ATTACH MOUNT. Canonical mountTopology is rail_paired → project
"RAIL-PAIRED ROOF ATTACHMENT BASE" (or equivalent precise manufacturer-supported
language) via the equipment projection accessor. No name-based topology inference.

## §12 Normalize fastener authority
PV-3/APP-A: 2× ~3.5" structural screws, no pilot hole. PE-1 still: generic "lag bolt
with flashing / 5/16" minimum / stainless hardware". One exact FastenerAssembly object
(mfr, model/SKU, diameter, length, qty/mount, material/coating, head/drive, pilot rule,
embedment, substrate, rafter/deck installation, source document, verification status);
every sheet projects it; when unverified PE-1 prints "PENDING VERIFIED FASTENER
ASSEMBLY" — no generic fallback fastener language.

## §13 Remove unsupported framing adequacy
PV-4C/PE-1 still print generic BCSI truss capacity, 55 psf, 12-ft span, 56%
utilization, "existing framing is adequate" — with no archived project authority (truss
drawing, member layout, species/grade, plates, bearing, span, loads, deflection, mfr
approval). Enforce FRAMING-AUTHORITY-UNVERIFIED blocker; no numeric capacity/
utilization/PASS/adequate without verified authority; keep observed framing data
separate from verified capacity; engine may calculate added PV loads but may not
certify existing framing from generic BCSI. Print "EXISTING FRAMING CAPACITY NOT
VERIFIED / PROJECT-SPECIFIC STRUCTURAL REVIEW REQUIRED".

## §14 Preserve the screening-envelope honesty
Keep the envelope honest: never "exact tributary geometry"; state all attachments use
governing corner-zone pressure; state the 1.106 area ratio; state ASD vs strength;
capacity checks eventually use the same load basis; full attachment artifact stays
machine-readable. Do not weaken the conservative method.

## §15 Fix hidden print clipping
`.page { overflow: hidden }` hides content without adding pages — the 20==20 gate is
insufficient. Confirmed clipped: PV-0, PV-4C, PV-4B, SCHED, CERT. Build a TRUE
geometry-based page-fit validator (rendered element geometry: content bbox vs printable
bbox, title-block exclusion zone, page edges, hidden-overflow regions); fail on
meaningful element below page, clipped-by-overflow, text outside container, hidden
footer/conclusion, title-block overlap. Do NOT merely flip overflow to visible.
Recompose: PV-0 (reduce/reorganize vicinity/site sections, all map/address visible);
PV-4C (detailed reaction rows → formal continuation or machine-readable appendix;
summary + governing checks stay); PV-4B/SCHED (compact/remove duplicated conclusions,
preserve required tables); CERT (shorten or formally continue limitation/footer text —
no clipped legal text). Every formal continuation: sheet ID, title block, manifest
entry, snapshot ID/digest, sheet number, continuation title. Acceptance:
screenshot/PDF proof for all sheets at 17×11.

## §16 Replace "Issued for permit review"
Cover engineering summary says "Issued for permit review" while the set is PENDING
ENGINEERING REVIEW / NOT FOR PERMIT SUBMISSION. Replace via the issue-state accessor
with "PREPARED FOR ENGINEERING REVIEW" or "DESIGN REVIEW PACKAGE — NOT FOR PERMIT
SUBMISSION". No renderer-local issue wording.

## §17 Promote permit-critical advisories to blockers
Review registry severity: unresolved required conduit fill → BLOCKING; unresolved
supply-side tap-conductor length → BLOCKING; missing exact selected module
electrical/mechanical source → BLOCKING before permit-ready. Advisory only when the
missing fact cannot affect safety, code compliance, procurement, engineering approval,
or permit acceptance. Explicit severity-policy tests.

## §18 Keep legitimate project blockers
Never suppress/auto-resolve: REC-405-vs-Qcells-400; TEST project name; blank
designer/EOR; AHJ/state verification pending; IBC/IRC/IFC pending; route-length
estimate; exact racking assembly pending; RT-MINI capacity source missing; racking
applicability gap; no approved digest-bound review; framing capacity unverified.

## Permanent regression gates (rendered-output inspection)
1 no stale PV-4A rule calc; 2 supply-side tap cannot display 705.12 busbar PASS; 3 same
segment ID cannot print PVC on one projection and EMT on another; 4 every branch
physical section has an explicit segment ID; 5 branch conductor quantities equal
object-derived requirements; 6 no generic "all runs" conduit row; 7 raceway code
article matches raceway type; 8 no string/DC legend or BOM row without canonical DC
segment; 9 device-role graph has no conflation or duplicate physical devices; 10
unselected datasheets cannot appear authoritative; 11 RT-MINI always projects
rail_paired; 12 exact fastener object identical across all sheets; 13 unverified
framing cannot display capacity/utilization/PASS/adequate; 14 screening envelope
labeled honestly; 15 no page content clipped or hidden; 16 page count equals manifest;
17 every continuation has title block + manifest entry; 18 issue wording agrees
everywhere; 19 permit-critical missing inputs are blockers not advisories; 20 rendered
HTML values equal evidence JSON values.

## Acceptance deliverables
Root-cause report (all 18 sections); changed files grouped by authority/engine/
snapshot/validator/projection/renderer/BOM/layout/tests; regenerated full HTML; full
PDF; one screenshot per logical sheet; true geometry-based page-fit report; electrical
segment graph; physical raceway graph; branch conductor quantity reconciliation;
raceway/fitting BOM reconciliation; service-device topology graph; exact
racking/fastener state report; framing-authority report; attachment screening-envelope
report; active blocker registry with reviewed severity; cross-sheet truth matrix;
report-equals-rendered evidence; focused tests; full repo tests vs baseline; typecheck;
production build. Harness exits non-zero for: stale local calculation, projection
disagreement, BOM quantity mismatch, code-article mismatch, hidden/clipped content,
unverified structural PASS, omitted blocker, report/rendered mismatch.

## Boundaries
Dev only; separate commit; no generated-HTML patching; no hand-edited evidence outputs;
no second electrical/structural engine; no MFA/migration-governance changes; no
auto-reconciling Braidon; no fabricated route geometry/AHJ/equipment
selections/truss data/manufacturer evidence; no validator weakening; preserve
legitimate blockers; fix canonical sources so future projects inherit every correction.
