# Final Blocker and Authority Reconciliation — Directive

Status: ACTIVE 2026-07-24. Baseline `9ea52f22` (approved). Audit target:
`PermitPackage-BRAIDON M PILLA — Solar TEST (5).html` (PDS-937E0289544B, 21 sheets,
DESIGN REVIEW PACKAGE). Focused closeout: no new campaign, no HTML patching, no
legitimate-blocker removal, no fabricated evidence.

## §1 Reconcile the blocker count
Rendered RS-1 shows 17 OPEN RELEASE BLOCKERS; the implementation report claimed 18.
Compare the live registry, RS-1, cover banner, evidence JSON, issue-state gate; identify
the exact code multiset on each surface; remove no legitimate blocker; fix any
missing/duplicated/unrendered item; all surfaces identical codes+severities+counts;
rendered multiset-equality test; deliver before/after blocker list.

## §2 Environmental load authority
Live uses 110 mph / Exposure C / 20 psf ground snow with no verified source shown.
EnvironmentalLoadAuthority object: wind speed, wind-speed basis, risk category, exposure
category, ground snow load, snow-load source, coordinates/address used, source
document/dataset, source version/date, lookup timestamp, operator overrides,
verification status, applicable project/AHJ, evidence reference. Operator-entered =
observation/override, never auto-verified; generic defaults = preliminary only;
unverified → blocking ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED; PV-0, PV-4C, PE-1, RS-1,
evidence show the same state; values stay in preliminary analysis but are never called
verified design criteria without provenance. Tests: verified source, operator override,
missing source, stale source.

## §3 Remove the false SCHED compliance claim
SCHED concludes all-UL-listed / wire sizing verified / complies with NEC 2020 — incompatible
with active blockers (racking, fastener, RT-MINI capacity, doc applicability, module
datasheet, conduit fill, Q-Cable sufficiency, engineering approval). Derive the SCHED
conclusion from the registry + issue state; while blockers remain render "DESIGN REVIEW
PACKAGE / COMPLIANCE NOT YET ESTABLISHED / SEE RS-1 FOR ACTIVE RELEASE BLOCKERS";
positive conclusion only when every applicable authority and calculation passed. Gate:
no global PASS/compliance language while blocking items exist.

## §4 Shared-raceway ampacity evidence
Six CCC #10 THWN-2 in the shared 1-1/4" PVC, three 20 A branches; E-1 shows a bare 0.96
derate. Canonical AmpacityAdjustmentResult: conductor material, insulation rating, size,
base table ampacity, terminal temperature limitation, CCC count, conductor-count
adjustment factor, ambient temperature, ambient correction factor, rooftop adder when
applicable, corrected ampacity, final allowable, required continuous, pass/fail/pending,
NEC references, provenance. No unexplained multiplied "derate". E-1, PV-4A, PV-4B,
evidence identical; missing input → PENDING, never PASS.

## §5 Q-Cable grounding authority
E-1 says listed 2-conductor Q-Cable + separate #12 EGC with circuit conductors, but the
BOM has no branch-length open-air EGC quantities. Determine the ACTUAL canonical
grounding method from verified manufacturer/system authority; model exactly one result:
(A) grounding/bonding by the listed Q-Cable/micro/racking system, (B) separate EGC
required, or (C) pending verification. Fields: groundingMethod, conductor/bonding
component, size, path, segment IDs, length, source document, equipment compatibility,
verification state. If separate EGC: derive length from branch paths, add to BOM, show
on PV-1B/E-1/PV-4B. If not: remove the false statement. Do not guess.

## §6 Unverified fasteners non-orderable
SCHED-3 shows ~128 roof fasteners with dimensional description while
FASTENER-ASSEMBLY-UNVERIFIED blocks. Retain calculated attachment quantity as DESIGN
QUANTITY — NON-ORDERABLE / PENDING VERIFIED FASTENER ASSEMBLY; exclude from
authoritative procurement totals; no manufacturer/SKU/diameter/length/coating/capacity
display unless verified; auto-regenerate the exact row when FastenerAssembly verifies.
Test: unverified fasteners cannot become orderable.

## §7 Sealing caps and terminators from topology
BOM supplies 3 sealing caps as one-per-branch — insufficient authority. Model
separately: branch terminator, unused connector/drop, unused-connector sealing cap,
branch starting connector/transition, branch ending connector. terminators = actual
cable ends requiring them; sealing caps = actual unused connector/drop objects;
connectors = occupied drops. 31 modules/31 micros/31 occupied drops — independently
determine whether unused drops exist from the selected cable pieces + topology. BOM +
evidence list source object IDs per cap/terminator.

## §8 Remove the stale E-1 open-air legend
E-1 legend still says "OPEN AIR — PV WIRE / THWN-2"; the actual open-air sections are
the listed Q-Cable assembly. Generate the legend from the canonical wiring-method
objects present on the sheet; exact Q-Cable identity for open-air branch sections; no
generic PV Wire/THWN-2 unless those methods exist in the topology; semantic gate
comparing legend entries to displayed segments.

## Permanent gates
1 blocker multisets match across surfaces; 2 wind/snow always carry provenance +
verification state; 3 no global compliance statement with blocking items; 4 six-CCC
ampacity shows every factor; 5 missing ampacity inputs → PENDING; 6 grounding method
explicit; 7 separate-EGC language requires matching route + BOM quantities; 8 unverified
fasteners non-orderable; 9 caps == actual unused connector objects; 10 terminators ==
required cable-end objects; 11 legend entries == segment wiring methods; 12
report-equals-rendered zero mismatches; 13 page-fit zero meaningful clipping; 14
snapshot ID/digest match across all sheets.

## Deliverables
Root-cause report (8 findings); before/after blocker registry; environmental-load
authority report; shared-raceway ampacity artifact; Q-Cable grounding authority report;
fastener procurement-authority report; connector/cap/terminator topology; E-1 legend
reconciliation; updated HTML + PDF; per-sheet screenshots; rendered truth matrix;
report-equals-rendered; focused tests; full-suite baseline comparison; typecheck;
production build. Harness exits non-zero for: blocker-count mismatch, unproven
environmental input, false global compliance claim, incomplete ampacity, grounding/BOM
mismatch, orderable unverified fastener, topology-independent cap quantity, stale
legend, clipping, evidence/rendered mismatch.

## Boundaries
Dev only; separate commit; no HTML patching; no fabricated wind/snow sources, grounding
authority, fastener SKUs, or manufacturer evidence; never auto-reconcile Braidon; no
blocker weakening; PRESERVE the framing-authority (`903e14cd`) and Q-Cable sufficiency
(`9ea52f22`) gates; no MFA/migration-governance changes.
