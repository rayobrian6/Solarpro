# Final Projection / Procurement Authority Corrective Pass — Directive

Status: ACTIVE 2026-07-26. Baseline dev @ `41225032`. Audit target:
`PermitPackage-BRAIDON M PILLA — Solar TEST (6).html` (PDS-2CF4E96E35E5, 21 sheets, 19
blocking / 0 advisory, DESIGN REVIEW PACKAGE). Focused corrective pass: no new
campaign, no HTML patching, no legitimate-blocker removal, no fabricated authority.
Final objective: make SolarPro incapable of presenting pending engineering assumptions
as installed equipment, orderable material, verified structural instructions,
branch-wide PASS, or approved-design authority.

## §1 E-1 must not assert an installed open-air EGC
While QCABLE-GROUNDING-AUTHORITY-UNVERIFIED (neither A nor B established), each E-1
open-air branch row still prints "#12 AWG Cu EGC — with circuit conductors" — an
installed-conductor assertion. Required render: "OPEN-AIR GROUNDING METHOD: PENDING
MANUFACTURER AUTHORITY / INSTALLED OPEN-AIR EGC: NOT ASSERTED". Never: installed #12
EGC, verified method, PASS, "with circuit conductors". The proposed EGC exists only as
"CANDIDATE DESIGN QUANTITY — NON-ORDERABLE / NOT PART OF THE APPROVED INSTALLATION /
PENDING EXACT MANUFACTURER AUTHORITY". Keep 6 objects separate (open-air Q-Cable
grounding; shared PVC home-run EGC; feeder EGC; service bonding; module/racking
bonding; GEC). Rendered gate: pending grounding result cannot produce an installed-EGC
assertion.

## §2 RS-1 grounding-blocker detail template
The QCABLE-GROUNDING-AUTHORITY-UNVERIFIED row renders a "DEFICIT PAYLOAD" box with
empty SKU/drop-spacing/deficit/affected-branch fields — that payload belongs to
QCABLE-PROCUREMENT-INSUFFICIENT. Select blocker-detail components by canonical blocker
schema/type. The grounding payload: selected micro SKU, Q-Cable SKU, authority result,
verification state, applicable manufacturer document, document hash, applicability,
equipment classification, candidate EGC quantity + orderability, resolution action,
affected segment IDs. No empty procurement-deficit fields. Test: every blocker code
maps to its correct payload schema.

## §3 Remove all unsupported "maximum spacing" language
Canonical spacing authority says DESIGN 48" OC PENDING VERIFICATION, but stale
renderers remain: PV-1 `48" O.C. MAX`; PV-3 `ATTACH: 48" O.C. MAX`, `4'-0" ATTACH.
O.C. MAX`, `ATTACH. SPACING: 4'-0" O.C. MAX`. Every sheet projects one canonical
SpacingAuthorityResult. Pending wording: "DESIGN ATTACHMENT SPACING: 48 IN. O.C. /
STATUS: PENDING STRUCTURAL VERIFICATION". Never MAX / MAXIMUM / MAXIMUM ALLOWED /
allowable spacing / approved spacing without verified authority. Package-wide semantic
gate.

## §4 Remove unverified fastener + RT-MINI II authority from PV-3
PV-3 still prescribes exact installation requirements (5/16" dia, 3.5" length, 2
screws/mount, 2.5" embedment, 6-12 ft-lb torque, no pilot hole, flashing/sealant
instructions) and says they come from the RT-MINI II manual "on file" — while
FASTENER-ASSEMBLY-UNVERIFIED and EQUIPMENT-DOCUMENT-APPLICABILITY are active. PV-3
consumes FastenerAssemblyAuthority + EquipmentDocumentApplicability +
MountAssemblyAuthority + RackingAssemblyAuthority; while unverified print NO exact
diameter/length/embedment/torque/pilot/sealant/screw-count/manufacturer instructions —
render "FASTENER ASSEMBLY: PENDING VERIFIED SELECTION / INSTALLATION DETAILS: NOT
ESTABLISHED / DOCUMENT APPLICABILITY: RT-MINI II MANUAL NOT VERIFIED FOR SELECTED
RT-MINI / REFERENCE DETAIL: NON-AUTHORITATIVE — DO NOT INSTALL FROM THIS DETAIL".
Exact instructions return only after exact SKU + verified applicability + archived
hash-bound document + verified fastener assembly + current-digest selection. Rendered
gate.

## §5 All pending racking components non-orderable
SCHED-3 still lists quantities + apparent manufacturers for end/mid clamps, bonding
hardware, L-feet, mount hardware, rails, splices, RT-MINI-01 kit. Classify BOM rows:
A VERIFIED/ORDERABLE, B DESIGN QUANTITY/NON-ORDERABLE, C CANDIDATE/NOT SELECTED, D
EXCLUDED FROM TOTALS. Until the exact assembly is selected, every assembly-dependent
component non-orderable; RT-MINI-01 never an authoritative selected SKU; no
manufacturer/exact SKU prints unless verified; design-estimate quantities labeled
"DESIGN QUANTITY — NON-ORDERABLE / PENDING RACKING ASSEMBLY SELECTION"; authoritative
procurement total excludes every pending row. Tests: no pending component orderable;
no candidate SKU in totals; verified selection auto-regenerates.

## §6 SCHED branch "PASS" semantics
B1/B2/B3 show generic PASS while grounding pending, route estimated, procurement
insufficient. Rename column "AMPACITY / DEVICE-RATING RESULT"; value "PASS —
ELECTRICAL RATING ONLY"; add separate status lines: route authority PENDING, grounding
authority PENDING, procurement sufficiency BLOCKED, OVERALL RELEASE: BLOCKED. Remove
topology-inapplicable load-side citations (NEC 705.12) from supply-side branch
schedules (705.11 selected). Topology-driven code-reference test.

## §7 Delete the legacy PV-4B project-level EGC row
Stale row (Array → AC Disconnect ground bus, #10 bare Cu, 1-1/4" PVC, 20 ft)
reconciles with nothing. Delete; replace only with canonical GroundingSegment objects
(groundingSegmentId, from/to device IDs, associated circuit/segment, size,
insulation/type, physicalRacewayId, length + source, NEC basis, authority state, BOM
line ID). Every rendered grounding conductor reconciles to a canonical segment,
raceway where applicable, BOM derivation, evidence. Gate: no rendered grounding row
without groundingSegmentId.

## §8 Sealing-cap quantity must not render as certain zero
SCHED-2 says QUANTITY PENDING but Qty prints 0. Render "PENDING" or "0 MODELED / FIELD
QUANTITY PENDING"; a hard zero only when the exact cable-piece topology proves every
drop/occupied/unused/end/terminator/cap object. Row excluded from final procurement
approval while pending. Terminators and caps stay separate canonical types.

## §9 Q-Cable BOM row itself non-orderable
The warning is correct but the SCHED-2 row still shows Enphase Q-12-10-240 31 ea with
no row-level state — an operator reading the continuation alone could order the
insufficient quantity. Row must carry: STATUS NON-ORDERABLE; REASON
QCABLE-PROCUREMENT-INSUFFICIENT; DESIGNED-INSTALLED 166.5 FT; CURRENT BASE 152 FT;
DEFICIT 14.5 FT; EXTENSION SOLUTION NOT SELECTED. Excluded from authoritative totals.
Keep the selected cable identity; never imply sufficiency. Procurement-export gate:
blocked rows cannot enter orderable exports.

## §10 Remove "approved design" from PV-5
PV-5 says labels are "SITE-COMPUTED FROM THE APPROVED DESIGN" — false with 19
blockers/no seal. Required: "SITE-COMPUTED FROM THE CURRENT DESIGN-REVIEW SNAPSHOT —
NOT YET APPROVED". One issue-state language accessor used by every sheet; only a
digest-bound engineering approval may produce approved-design language. Package-wide
semantic gate: no approved design/plans/engineer approved/permit approved/construction
approved while pending.

## Permanent gates (rendered HTML inspection)
1 pending grounding cannot assert installed EGC; 2 candidate EGC non-orderable; 3
blocker detail matches schema; 4 no unsupported MAX spacing; 5 pending fastener cannot
render exact dims/instructions; 6 unverified RT-MINI II cannot authorize RT-MINI
instructions; 7 pending racking excluded from totals; 8 generic PASS cannot hide
branch blockers; 9 supply-side cannot render load-side-only citations; 10 every
grounding row has groundingSegmentId; 11 pending caps cannot render certain zero; 12
insufficient Q-Cable row non-orderable; 13 procurement exports exclude blocked rows;
14 pending issue state cannot render approved-design; 15 blocker counts identical
across registry/RS-1/cover/evidence/issue gate; 16 snapshot ID/digest identical across
sheets; 17 page-fit detects horizontal AND vertical clipping; 18 report-equals-rendered
zero mismatches.

## Deliverables
Root-cause map (10 findings); changed files by canonical-objects/snapshot/projections/
renderers/BOM/blocker-components/issue-state-language/tests; before/after E-1
grounding rows; grounding object graph; RS-1 blocker-schema reconciliation;
spacing-language package scan; PV-3 authority before/after; racking BOM orderability
report; branch status semantic matrix; grounding-segment/BOM reconciliation;
cap/terminator topology report; Q-Cable orderability report; issue-state language
scan; regenerated 21-sheet HTML; full PDF; per-sheet PNGs; H+V page-fit report;
report-equals-rendered; focused tests; full-suite baseline comparison; typecheck;
production build. Harness exits non-zero for each of the 12 listed violation classes.

## Boundaries
Dev only; separate commit; no HTML patching; no legitimate-blocker removal; no
fabricated Enphase grounding authority / RT-MINI applicability / fastener specs /
racking selection / Q-Cable extensions or cap quantities; no MFA/migration-governance
changes. PRESERVE: framing-authority, environmental-load-authority, Q-Cable
procurement-sufficiency, Q-Cable grounding-authority, blocker-registry equality,
page-fit gates. Fix source projections so every future planset inherits.
