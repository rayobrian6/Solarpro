# Hierarchical Release-Gate Model — Directive

Status: ACTIVE 2026-07-26. Baseline dev @ `ee718f28`. Artifact: `PermitPackage-BRAIDON
M PILLA — Solar TEST (7).html` (PDS-9172F2215D34, 21 sheets, 19 blocking / 0 advisory).
Problem: every unresolved child requirement presents as an equal top-level blocker —
"19 OPEN RELEASE BLOCKERS" misrepresents ~7 unresolved root release gates containing 19
requirements. Preserve all 19; present root causes clearly. This pass must NOT: remove
any legitimate requirement; weaken permit blocking; fabricate authority; mark
permit-ready; hide requirements from RS-1/evidence; change engineering truth; patch
HTML; start a campaign.

## §1 Canonical ReleaseGateResult
Derived from the existing PermitReadinessBlocker registry — NO second readiness engine;
blocker codes remain the source requirements. Fields: gateId, gateCode, title,
description, gateCategory, status (OPEN | CLEARED | NOT_APPLICABLE — never PASS while
evidence pending), releaseImpact (axes: permitSubmission, procurement,
engineeringReview, construction, administrativeRelease — each gate states which it
blocks), requirementCodes, unresolvedRequirementCodes, clearedRequirementCodes,
unresolvedCount, totalRequirementCount, primaryResolutionAction, responsibleRole,
evidenceReferences, affectedSheets, snapshotId, snapshotDigest.

## §2 ReleaseRequirement projection per blocker code
Fields: requirementCode, gateId, title, findingType, status, severity, explanation,
resolutionAction, responsibleRole, releaseImpact, authorityPath, evidenceReferences,
affectedSheets, affectedObjects, relatedRequirementCodes, snapshotId, snapshotDigest.
Finding types: TECHNICAL_CONFLICT, VERIFIED_DEFICIENCY, PENDING_SELECTION,
PENDING_DOCUMENT, PENDING_AUTHORITY, FIELD_VERIFICATION, ADMINISTRATIVE_HOLD,
PROFESSIONAL_RELEASE, ADVISORY. Exactly ONE primary gate per requirement (related
gates referencable; counted once). No renderer-local grouping heuristics.

## §3 Canonical gate mapping (Braidon current — exactly seven root gates)
1. PROJECT_AND_AHJ_AUTHORITY (ADMINISTRATIVE / CODE AUTHORITY):
   CODE-AUTHORITY-INCOMPLETE, PROJECT-AUTHORITY-UNVERIFIED,
   PROJECT-NAME-NONPRODUCTION. Identity/jurisdiction/adopted codes/production naming
   unconfirmed — not engineering failures.
2. EQUIPMENT_RECONCILIATION: EQUIPMENT-IDENTITY-CONFLICT,
   MODULE-EXACT-DATASHEET-PENDING. One reconciliation workflow (REC Alpha Pure-R 405W
   vs Qcells Q.PEAK DUO BLK ML-G10+ 400W).
3. ENVIRONMENTAL_LOAD_AUTHORITY: ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED (110 mph /
   Exp C / 20 psf operator-entered, unverified).
4. STRUCTURAL_ASSEMBLY_AUTHORITY: FRAMING-AUTHORITY-UNVERIFIED,
   PENDING-RACKING-ASSEMBLY-SELECTION, FASTENER-ASSEMBLY-UNVERIFIED,
   RACKING-CAPACITY-SOURCE-NOT-ARCHIVED, RACKING-CAPACITY-APPLICABILITY-GAP,
   EQUIPMENT-DOCUMENT-APPLICABILITY. Six requirements, ONE root structural gate — not
   six unrelated failures.
5. ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE: ROUTE-LENGTH-ESTIMATE,
   CONDUIT-FILL-PENDING, TAP-CONDUCTOR-LENGTH-PENDING. The gate must explain which
   result each unresolved input affects; a route estimate must not automatically block
   calculations that don't materially depend on route length.
6. QCABLE_SYSTEM_CLOSURE: QCABLE-PROCUREMENT-INSUFFICIENT (166.5/152/14.5, no
   extension selected), QCABLE-GROUNDING-AUTHORITY-UNVERIFIED. Separate children, one
   root gate.
7. PROFESSIONAL_RELEASE: DESIGNER-OF-RECORD-MISSING, ENGINEERING-REVIEW-PENDING.
   Workflow requirements, not engineering defects. ENGINEERING-REVIEW-PENDING derives
   from the ABSENCE of an applicable digest-bound approval record — never from
   issue-state wording (no circular logic).

## §4 Top-level count semantics
Replace "19 OPEN RELEASE BLOCKERS" with: "7 OPEN RELEASE GATES / 19 UNRESOLVED
REQUIREMENTS / 0 ADVISORIES / NOT FOR PERMIT SUBMISSION". Only root gates count as
release gates; child counts fully visible; nothing suppressed; no impact weakened; one
open blocking requirement opens its parent gate; gate vs requirement counts never
conflated. Expected Braidon table: 3/2/1/6/3/2/2 → 7 gates, 19 requirements, 0
advisory.

## §5 RS-1 redesign
Lead with the seven-row root-gate table (Gate, Category, Status, Unresolved, Release
Impact, Primary Resolution, Responsible Role); child requirements beneath each gate or
in a continuation, retaining code, finding type, status, explanation, resolution,
authority path, affected sheets, evidence reference. Visual distinction by finding
type (root-gate hold / strong warning for conflicts-deficiencies / pending / field /
administrative / review-workflow / advisory) — legible in black-and-white. RS-1.1
continuation if required; don't shrink text to illegibility.

## §6 Cover banner
Show root gates, not 8 blockers + "11 more": "RELEASE STATUS / 7 OPEN RELEASE GATES /
19 UNRESOLVED REQUIREMENTS / NOT FOR PERMIT SUBMISSION / OPEN GATES: (the seven) / SEE
RS-1 FOR ALL 19 REQUIREMENTS". May highlight the most severe confirmed conflict; must
not duplicate the registry.

## §7 Technical vs workflow condition
Explicit distinction: verified engineering failure / technical conflict / missing
evidence / pending selection / field verification / administrative hold / professional
approval. PROJECT-NAME-NONPRODUCTION is not a structural/electrical failure;
ENGINEERING-REVIEW-PENDING is not an engineering defect;
RACKING-CAPACITY-SOURCE-NOT-ARCHIVED means capacity NOT YET ESTABLISHED from verified
authority, not failed capacity. Never replace pending authority with false failure
wording.

## §8 Issue state from gates
Derive from the gate model. DESIGN_REVIEW while any gate open.
READY_FOR_ENGINEERING_REVIEW only when technical inputs review-complete, major
equipment conflicts resolved, documents assembled, and professional-release is the
sole open gate. READY_FOR_PERMIT_SUBMISSION only when every permit-impacting gate
CLEARED + digest-bound approval + certification controls. PROCUREMENT_READY tracked
independently; false while any procurement-impacting gate open. Do not destabilize
existing issue-state behavior — a derived readiness-axis object is acceptable.

## §9 Backward compatibility
Blocker codes not deleted; registry remains canonical; gates are deterministic
projections; APIs keep `blockers`; ADD releaseGates, releaseRequirements,
releaseSummary, readinessAxes. No duplicated blocker-generation logic; no manual
requirement lists; prefer no DB migration; no migration-governance changes.

## §10 Evidence and audit
Evidence JSON: releaseSummary (openGateCount, unresolvedRequirementCount,
advisoryCount, permitReady, procurementReady, engineeringReviewReady); releaseGates
(all 7); releaseRequirements (all 19); requirementToGateMap. Harness independently
verifies: every active code = exactly one requirement; every requirement exactly one
primary gate; gate counts equal child counts; total unresolved == active blocker
multiset; no code lost/duplicated; no renderer-invented requirements; cover/RS-1/issue
state/evidence agree.

## Permanent gates (17)
1 every active blocker → exactly one requirement; 2 exactly one primary gate each; 3
the seven expected gates render for the fixture; 4 fixture renders 7/19/0; 5 gate
child counts total 19; 6 no silent suppression; 7 no double-count; 8 administrative
holds not labeled engineering failures; 9 professional review not labeled technical
defect; 10 pending authority not labeled verified failure; 11 RS-1 == cover counts; 12
issue-state readiness matches gate impacts; 13 evidence == rendered HTML; 14 snapshot
ID/digest across all 21 sheets; 15 RS-1/RS-1.1 within printable bounds; 16 H+V
clipping zero; 17 black-and-white legibility. ANTI-VACUITY inputs: all seven open; one
structural child clears; all structural children clear; one requirement
NOT_APPLICABLE w/ authority; professional approval added; administrative-only hold;
procurement-only hold; no active requirements; UNKNOWN blocker code fails closed into
an UNMAPPED_REQUIREMENT gate AND fails the harness — unknown codes never disappear
silently.

## Deliverables
Architecture report; 19-code inventory; requirement-to-gate map; both schemas;
readiness-axis model; before/after RS-1 + cover screenshots; gate rollup evidence;
requirement multiset reconciliation; issue-state derivation report;
backward-compatibility report; regenerated HTML; full PDF; per-sheet PNGs; page-fit
report; report-equals-rendered; focused tests; full-suite baseline; typecheck;
production build; separate commit pushed to dev.

## Boundaries
Dev only; separate commit; no HTML patching; no requirement removal; no impact
downgrade; never mark Braidon permit-ready; no fabricated
authority/reconciliation/selection/measurements/approval; no MFA/migration-governance
changes; preserve every existing gate; do NOT work the remaining
procurement-arithmetic audit findings unless required to keep harnesses green.
Final objective: keep preventing unsafe release while clearly communicating seven
unresolved root gates containing nineteen requirements — not nineteen unrelated
engineering failures.
