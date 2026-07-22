# Post-Campaign Correction — 2026-07-22

Status: ACTIVE. Ray's full audit of the generated package
`PermitPackage-BRAIDON M PILLA — Solar TEST (1).html` (19 sheets) found live
truth-authority regressions. This is a FOCUSED correction: no generated-HTML patching,
no new architecture campaign. Verbatim binding corrections:

## 1. Issue-state authority
Remove ISSUED FOR PERMIT from every revision block while the snapshot is PENDING
ENGINEERING REVIEW. CERT revision history must not say Initial Issue for Permit.
Add a regression test over all 19 sheets.

## 2. Certification gate
CERT and PE-1 may not render "I hereby certify," "prepared under my supervision,"
"confirmed adequate," or equivalent affirmative conclusions without an approved review
record covering the current digest. Render disabled pending-review templates only.

## 3. Electrical segment authority
Reconcile E-1, PV-4A, PV-4B, SCHED and BOM to one set of canonical segment objects.
Eliminate the 3/4 EMT vs 1-inch EMT vs 1-1/4 PVC conflict. Eliminate 1.11% vs 0.37%
voltage-drop conflict. The displayed length must equal the length used in the formula.
undefined/NaN/null must be blocking and may never render PASS. Fittings must match the
selected raceway type and size.

## 4. Branch representation
E-1 may not represent BR-1 as #6, 45A, 60A. Render the three actual 20A branches or a
fully defined multi-circuit raceway. Rename PV-1B to AC BRANCH CIRCUIT LAYOUT. Replace
"wired in series" with the correct parallel AC-branch/Q-Cable description.

## 5. Supply-side tap topology
Reconcile the stated 10-ft fused-tap requirement with the displayed 60-ft
disconnect-to-MSP run. Create separate canonical objects for tap point, tap conductors,
fused OCPD, utility disconnect, meter and service disconnect.

## 6. Route provenance
Remove "route field-verified" from PV-1 while ROUTE-LENGTH-ESTIMATE exists. Print
CAD-DERIVED ESTIMATE — FIELD VERIFY.

## 7. Grounding authority
Reconcile branch EGC, feeder EGC, raceway bonding and GEC. Remove the automatic ground
rod, acorn clamp and #6 GEC unless an authoritative design requires a new electrode.

## 8. Structural reconciliation
The package shows 636.48 ft², 55.95 psf and 64 attachments but reports only
369 lb/attachment. Produce an attachment-ID reaction schedule. Sum tributary areas and
reactions back to the applied load. Do the same for snow. Block when the object count
and reaction model do not reconcile.

## 9. Capacity gate
Do not render the unverified RT-MINI 600 lb value as PASS. Until the exact source and
assembly applicability are verified, render UNVERIFIED / PENDING STRUCTURAL SOURCE.

## 10. Exact racking assembly
APP-A must not describe RT-MINI as rail-less. Pin the exact rail SKU, splice, clamps,
L-foot/bolt, fasteners and bonding components. Remove RAIL-COMPAT and "or equivalent."
Reconcile 3/8 lag, 5/16 × 4 lag and two 3.5-inch wood-screw instructions to one
verified product installation.

## 11. Code authority
Extend V11 to all body text, BOM cells, label schedules, certification paragraphs and
notes. Remove IBC 2021 and IFC 2021 literals while those editions are pending. Do not
make IFC setback compliance claims until the applicable authority record is verified.

## 12. Equipment identity
Resolve exact IQ8A SKU inconsistency: IQ8A-72-2-US versus IQ8A-72-M-US. Do not
automatically resolve production REC 405W versus Qcells 400W; use the operator
reconciliation workflow.

## 13. BOM topology
Three branches must not automatically create four terminators/caps. Remove
string-system DC home-run wire and DC label materials from the microinverter design
unless canonical physical objects require them. Categorize Enphase Q Cable as AC branch
equipment.

## 14. Project authority
Verify legal address, APN, municipal boundary, AHJ and fire authority from official
sources. Do not assume Madison County or Granite City by postal address alone.

## 15. Quality gates
Reject mojibake sequences. Print the human utility name, not il-ameren-illinois. Do not
populate an installation date before installation. Block production issue state when
project name still contains TEST or designer is blank.

## Acceptance evidence
Updated full 19-sheet package; cross-sheet truth matrix with zero electrical,
structural, equipment, code, issue-state or BOM disagreement; attachment/reaction
reconciliation artifact; exact canonical segment report; zero undefined/NaN/null/
mojibake; no affirmative certification without an approved digest-bound review; full
tests, typecheck and production build. Dev only. Do not modify MFA or migration
governance. Do not patch generated HTML.
