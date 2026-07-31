# Final Electrical / Procurement Authority Closeout — Directive

Status: ACTIVE 2026-07-23. Baseline `903e14cd` (framing gate APPROVED — must remain
unchanged). Audit target: `PermitPackage-BRAIDON M PILLA — Solar TEST (4).html`
(PDS-D673915D8021, 21 sheets, DESIGN REVIEW PACKAGE — NOT FOR PERMIT SUBMISSION).
Final objective: make SolarPro incapable of producing electrical section mismatches,
unreconciled Q Cable quantities, premature compliance verdicts, or unselected
procurement authority on any future planset.

Flow: NORMALIZED PROJECT INPUTS → VERSIONED EQUIPMENT AUTHORITY → COMPUTESYSTEM /
CANONICAL PHYSICAL OBJECTS → VALIDATED PermitDesignSnapshot → READ-ONLY SHEET
PROJECTIONS → OBJECT-DERIVED BOM → RENDERED-EVIDENCE VERIFICATION. No renderer may
calculate, infer, select, merge, override, rename, or repair engineering truth.

## §1 E-1 consumes the sectioned branch model
E-1 must render the canonical section objects directly (BRANCH-QCABLE-B1/B2/B3,
BRANCH-TRANSITION-B1/B2/B3, SHARED-BRANCH-HOMERUN-RACEWAY, COMBINER-FEEDER,
FUSED-DISCONNECT-TO-TAP, TAP-CONDUCTORS), each showing: segment ID, from/to device
IDs, cable/conductor type, conductor count, size, grounding/bonding method,
physicalRacewayId, raceway type/size, operating current, continuous current, OCPD,
length + source, fill, derating, VD, verification status, compliance state. Current
defects: branch rows read micro→combiner as #12 THWN-2 OPEN AIR; shared home-run row
says 3×[#10] (must show SIX current-carrying conductors: 2×#10 per branch × 3);
graphic labels parts of the shared run #12; blank fill cells render PASS. Never merge
Q Cable / THWN / shared raceway / feeder / tap conductors into one row. Test: E-1
conductor counts == physical-raceway conductor inventory exactly.

## §2 Fail closed on E-1 pending values
One shared tri-state compliance projection (PASS / FAIL / PENDING-REVIEW-REQUIRED):
required blank values never PASS; null/undefined/NaN/blank/non-finite fail closed;
pending route length, fill, equipment, or authority → PENDING. E-1, PV-4A, PV-4B,
RS-1, SCHED, evidence JSON use the same result object. Rendered test: no PASS while a
required projected field is blank/pending.

## §3 Remove the last EMT literals
PV-1 "CONDUIT RUN — … — EMT" and PV-3 "EMT CONDUIT — SEE CONDUCTOR SCHEDULE" are
stale. Delete renderer-local EMT defaults; every conduit description routes through
the physical-raceway projection accessor; same physicalRacewayId → identical type,
size, article, support rule, verification state, route description. Semantic gate: no
two raceway types/sizes anywhere for one physicalRacewayId.

## §4 PV-4A uses the RS-1 blocker registry
RS-1 shows 14 blocking; PV-4A shows 3 blocking + 2 pending, counts the equipment
conflict as electrical, duplicates conduit fill, downgrades tap length. PV-4A must
consume the canonical registry (domain/sheet filter allowed; no severity re-creation,
no synthetic duplicates, no downgrades, no cross-domain miscounts). Rows reference
blocker code, canonical severity, authority path, affected segment/device, resolution
action, registry object ID. RS-1, PV-4A, cover banner, evidence, issue gate report
identical codes+severities. Test: blocker multisets equal across projections.

## §5 PV-4A branch conductor honesty
No "#12 AWG THWN-2 → IQ Combiner" implication. Either (A) sectioned physical schedule
(Q Cable / transition / shared raceway) or (B) electrical rating summary (device
count, operating current, continuous current, OCPD, manufacturer branch limit) WITHOUT
conductor/raceway fields.

## §6 Q Cable as a listed cable assembly
PV-4B labels free-air Q Cable "#12 AWG THWN-2" — wrong authority. Canonical
QcableSegment/ListedCableAssembly: manufacturer, exact model/SKU, conductor
construction/count/gauge, insulation/listing, connector/drop spacing, max branch
current, compatible micro models, cable length, unused-drop caps, terminators, source
document, verification status. PV-4B, E-1, SCHED, BOM, APP-A, datasheets project it.
Never translated into generic THWN-2 rows.

## §7 Reconcile Q Cable lengths
PV-4B 3×95=285 ft vs SCHED-2 ~152 ft / 31 drops — impossible. Derive geometry from
module/micro coordinates, branch assignments, cable path, drop spacing, start/end,
jumpers, service loops, documented waste. Separate designed installed length, drop
count, procurement length, waste. Per-branch cable-path objects; BOM sums them;
evidence independently recomputes. PV-1B geometry, PV-4B lengths, SCHED, BOM, evidence
all reconcile.

## §8 Remove the unbacked module DC wire row
SCHED module table "Wire #10 AWG / Run 14 ft" has no canonical DC object. Pure 1:1
micro: show factory leads, connector type, lead length from the verified module
record, micro compatibility — never a generic field-installed DC gauge/length without
a canonical DC segment. Topology gate.

## §9 No supply-side COMPLIES while the tap rule is pending
PV-4B marks supply-side "COMPLIES" while tap-conductor length unknown. Separate
selected method / topology validity / installation compliance / tap-rule
verification. Render: "INTERCONNECTION METHOD: SUPPLY-SIDE TAP — SELECTED" +
"INSTALLATION COMPLIANCE: PENDING — TAP-CONDUCTOR LENGTH NOT VERIFIED". COMPLIES only
with verified inputs + passing results.

## §10 Normalize design vs procurement lengths
Canonical fields: geometricDesignLength, estimatedFieldLength, verifiedFieldLength,
calculationLength, procurementLength, wasteFactor, lengthSource, verificationState.
Calc sheets print calculationLength; route drawings print design/estimated/verified w/
status; BOM prints procurementLength; evidence shows derivation; every printed length
references a segment/raceway ID. No unlabeled mixing.

## §11 Unselected racking parts are not BOM authority
SCHED-3 lists apparent selected components (RT-MINI clamps, Bond Clip, L-Foot,
T-BOLT-38, rail candidates) while the rail assembly is pending. Separate confirmed
mount-base equipment / assembly-dependent components / unselected candidates. Until
selection: no orderable mfr/SKU rows for clamps, rail, splice, L-foot, T-bolt, bonding;
render PENDING RACKING ASSEMBLY SELECTION; exclude from procurement totals; candidates
live in operator UI, not the permit BOM. On selection: regenerate rails, spans,
clamps, splices, bonding, fasteners, BOM, datasheets, digest. Test: no unselected
candidate as an orderable BOM line.

## §12 RT-MINI vs RT-MINI II document applicability
Selected mount = RT-MINI; DS-3/APP-A cite the RT-MINI II Installation Manual. Require
exact selected SKU, product family/version, applicable document record,
revision/date, manufacturer cross-reference/alias evidence, applicability
verification. Until verified: EQUIPMENT-DOCUMENT-APPLICABILITY blocker; DS-3
non-authoritative or omitted; no RT-MINI II values in calcs/BOM.

## §13 Fastener authority explicit in RS-1
"PENDING VERIFIED FASTENER ASSEMBLY" is visible but not a registry entry (report said
15 blockers, RS-1 shows 14). Choose: child requirement of
PENDING-RACKING-ASSEMBLY-SELECTION or its own FASTENER-ASSEMBLY-UNVERIFIED blocker;
encode explicitly, show the relationship on RS-1, deterministic counts; cover, RS-1,
PV-3, PV-4C.1, SCHED, PE-1, evidence agree. No visible pending authority outside the
registry.

## §14 Remove unsupported "maximum spacing"
PV-3/PV-4C/APP-A call 48" O.C. the maximum allowed while capacity/rail/applicability
are unverified. Render "DESIGN ATTACHMENT SPACING: 48 IN. O.C." + "PENDING STRUCTURAL
VERIFICATION"; MAXIMUM ALLOWED only with a verified source for the selected assembly
and conditions. Canonical spacing-authority object: design spacing, maximum verified
spacing, source document, applicable roof zone, load conditions, verification state.

## §15 Provisional fire-setback language
PV-1 says "per AHJ" while AHJ identity/IFC adoption unverified. Render "PROVISIONAL
FIRE SETBACK BASIS — PENDING AHJ / IFC VERIFICATION". Separate modeled geometry /
assumed design-review basis / verified adopted requirement. Never describe an
unverified assumption as an AHJ requirement.

## §16 No load-side labels on supply-side systems
PV-5 carries NEC 705.12 load-side labels; topology is 705.11 supply-side. Label
applicability is topology-driven; load-side-only labels must not render; shared
general labels stay where applicable. Test fixtures: supply-side tap, load-side
breaker, line-side adapter, service replacement — label sets differ appropriately.

## §17 Computational basis vs adopted code authority
Cover says prepared per "IBC PENDING". Two projections: computational/analysis basis
(NEC 2020, ASCE 7-22, mfr calcs, assumptions) vs adopted jurisdictional authority
(IBC/IRC/IFC PENDING + amendments). Cover wording: "ELECTRICAL CALCULATION BASIS: NEC
2020 / STRUCTURAL COMPUTATIONAL BASIS: ASCE 7-22 / AHJ-ADOPTED IBC-IRC-IFC EDITIONS:
PENDING VERIFICATION". Never claim compliance with a pending edition.

## §18 RS-1 legibility
Preserve every blocker; increase effective printed text size; RS-1.1 continuation as
needed (full title blocks, sheet IDs, digest, index entries); never abbreviate away
authority paths/resolution actions; page-fit stays strict.

## §19 Eliminate the residual cover overflow
Left column ~4 CSS px taller than its hidden-overflow container. Find the exact
element; recompose spacing at component level; no global tolerance that hides real
clipping. Geometry validation reports element ID, bbox, printable box, overflow
amount, meaningful/visible; require zero meaningful overflow.

## Permanent regression gates (rendered output)
1 E-1 canonical section IDs; 2 E-1 conductor counts == raceway inventory; 3 E-1 no
PASS w/ blank-pending; 4 no live EMT literal without an EMT raceway object; 5 PV-4A
blocker codes/severities == RS-1 domain subset; 6 Q Cable never generic THWN-2; 7 Q
Cable route lengths == BOM cable quantities; 8 no module DC wire row without canonical
DC segment; 9 supply-side never COMPLIES while tap rule pending; 10 every printed
length identifies design/calc/procurement meaning; 11 no unselected racking candidate
as orderable BOM authority; 12 equipment-document applicability verified; 13 every
visible pending authority in the registry; 14 unverified spacing never "maximum
allowed"; 15 unverified fire basis never "AHJ requirement"; 16 no load-side-only
labels on supply-side; 17 pending adopted codes never compliance authority; 18 RS
continuation pagination complete; 19 zero meaningful overflow; 20 evidence JSON ==
re-extracted rendered values.

## Acceptance deliverables
Root-cause map (19 findings); changed files by engine/authority/snapshot/projection/
renderer/BOM/blocker-registry/layout/validator/tests; regenerated HTML; full PDF;
per-sheet screenshots; geometry page-fit report; branch-section graph;
physical-raceway conductor inventory; Q Cable geometry + BOM reconciliation;
design/calc/procurement length report; E-1/PV-4A/PV-4B/SCHED cross-sheet matrix;
racking candidate-vs-selected report; equipment-document applicability report; blocker
registry + severity reconciliation; label-topology applicability report; cross-sheet
truth matrix; report-equals-rendered; focused tests; full repo tests vs baseline;
typecheck; production build. Harness exits non-zero for: stale electrical projection,
conductor-count mismatch, Q Cable quantity mismatch, hidden pending PASS, unselected
procurement authority, code/topology label mismatch, omitted blocker, clipping,
evidence/rendered mismatch.

## Boundaries
Dev only; separate commit; no HTML patching; no hand-edited evidence; no second
engine; no MFA/migration-governance changes; no auto-reconciling Braidon; no
fabricated route geometry/AHJ authority/equipment documents/racking selections/
fastener evidence/engineering approval; no blocker/validator weakening; PRESERVE the
framing-authority gate (`903e14cd`); fix canonical sources for all future plansets.
