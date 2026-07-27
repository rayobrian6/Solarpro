# Final Planset Engine Closure — Procurement Authority and Stale Projection Patch

Status: ACTIVE 2026-07-26. Baseline dev @ `8cf77c8e` (release-gate architecture,
registry, 7-gate mapping, RS-1/.1/.2 structure, cover design ALL APPROVED — do not
redesign). Artifact: `PermitPackage-BRAIDON M PILLA — Solar TEST (8).html`
(PDS-2BA7FB9D0E2D, 23 sheets, 7 gates / 19 requirements / 0 advisories). This is the
FINAL bounded software-correction pass; after it the engine is declared
SOFTWARE-COMPLETE FOR DESIGN-REVIEW RELEASE (§13).

## §1 BOM population arithmetic
Rendered totals contradict: "47 total / 12 excluded / 36 authoritative" + "36 of 48"
vs actual row metadata 47 total / 35 orderable / 12 excluded. Invariant: TOTAL ROWS =
ORDERABLE + ESTIMATED + CANDIDATE + PENDING + EXCLUDED; no double-count; no
disappearance; no renderer-local totals. Canonical fields: totalRowCount,
verifiedOrderableCount, estimatedFieldVerifyCount, candidateNonOrderableCount,
quantityPendingCount, excludedCount. Row-ID multiset reconciliation gate: state counts
sum to total AND rendered row IDs == evidence row IDs == export row IDs. Remove every
hardcoded "36 of 48"-class count.

## §2 ProcurementAuthorityState (exactly one per row)
A VERIFIED_ORDERABLE (exact identity + exact/approved qty + verified authority + no
blocking requirement affects the row + in export) · B ESTIMATED_FIELD_VERIFY (qty
depends on unresolved routed geometry/field measurement; budgeting only; excluded from
export; labeled FIELD VERIFY) · C CANDIDATE_NON_ORDERABLE (not selected/verified;
excluded; no SKU as selected authority) · D QUANTITY_PENDING (may be required, qty
unknown; excluded) · E EXCLUDED_NOT_APPLICABLE. Fields: bomLineId, itemIdentity,
quantity, quantityUnit, authorityState, orderable, exportable, quantitySource,
authoritySource, verificationStatus, blockingRequirementCodes, affectedRouteIds,
affectedEquipmentIds, resolutionAction, evidenceReferences, snapshotId,
snapshotDigest. Never call estimated rows "authoritative orderable".

## §3 Route-dependent reclassification
While ROUTE-LENGTH-ESTIMATE is open, any row whose quantity materially depends on
unresolved route geometry cannot be VERIFIED_ORDERABLE: conduit/conductor/EGC footage,
couplings, straps, bushings, sweeps, elbows, pull boxes, roof penetrations, rough-in
bend allowances, route-dependent fittings; rows with "rough-in allowance / exact bend
count pending / estimated length / CAD-derived route / field verify" language →
ESTIMATED_FIELD_VERIFY unless a verified route object establishes procurement qty.
Keep design quantities visible; exclude from authoritative totals/exports. Dependency
gate: ROUTE-LENGTH-ESTIMATE open → affected route-derived rows not VERIFIED_ORDERABLE.

## §4 Q-CONN-10M / Q-CONN-10F non-orderable
No CableExtensionSolution is selected; classify both CANDIDATE_NON_ORDERABLE; exclude
from totals/exports; never imply they solve the 14.5 ft deficit; no installation
locations; not selected equipment. Enforce CableExtensionSolution (solutionId, type,
selected, manufacturer, exact SKUs, listed compatibility, cable segment IDs, connector
locations, installed length contribution, manufacturer document, applicability,
verification state, BOM line IDs). Only a verified selected solution promotes them.

## §5 Polaris tap connector non-orderable
IPLD350-3 qty 3 rows says "Verify lug range against actual service conductor size" —
not verified authority. SupplySideTapConnectionAuthority (existing service conductor
material/size/insulation/count, tap conductor material/size, connector mfr/SKU, listed
conductor range, ports, enclosure compatibility, installation space, connection
method, tap length + authority, manufacturer document, listing evidence, verification
status). Until verified: CANDIDATE_NON_ORDERABLE, out of totals/exports, labeled
"CANDIDATE CONNECTOR — VERIFY EXISTING SERVICE CONDUCTOR AND LUG COMPATIBILITY". Keep
on the design-review schedule; never selected/orderable.

## §6 Grounding segment identity
The three Q-Cable branch rows reuse gnd-br-1 (also in the grouped PV-4B projection).
Preferred model: branch-specific unique route/segment objects (gnd-br-1/2/3 bound to
B1/B2/B3) all referencing ONE GroundingAuthorityResult; a grouped authority object is
never rendered/counted as physical segments. Tests: physical GroundingSegment IDs
unique; grouped authority not counted physical; every E-1/PV-4B grounding row
reconciles to one canonical object; rendered count == evidence count.

## §7 Bonding requirement vs method
PV-3 "BONDING UL 2703 INTEGRATED" — requirement valid, METHOD not established (assembly
unselected, bonding non-orderable, RT-MINI II applicability open). While pending:
"BONDING REQUIRED / METHOD PENDING VERIFIED RACKING ASSEMBLY". RackingBondingAuthority
(bondingRequired, bondingMethod, selectedAssemblyId, selectedBondingComponents, UL 2703
listing source, manufacturer document, applicability, compatible module frame,
compatible rail/mount, verification state, BOM line IDs); results
INTEGRATED_LISTED_BONDING_VERIFIED / SEPARATE_BONDING_COMPONENTS_VERIFIED /
METHOD_PENDING_ASSEMBLY_SELECTION. Never "UL 2703 integrated" / "bonding jumper
required" / "bonding hardware selected" without the verified exact assembly. Preserve
the general NEC bonding requirement.

## §8 APP-A false global approval
"All equipment is CEC Listed, UL Listed, and approved for grid interconnection" is
false with open equipment/document/review requirements. Replace with registry-derived:
"EQUIPMENT LISTING AND DOCUMENT APPLICABILITY NOT YET ESTABLISHED FOR THE COMPLETE
SELECTED ASSEMBLY — SEE RS-1". Document states: ARCHIVED, APPLICABLE, VERIFIED,
AUTHORITATIVE, SUPERSEDED, NOT_APPLICABLE, PENDING_APPLICABILITY (archived ≠
applicable). Remove positive check marks implying applicability for on-file-only
documents. RT-MINI II: ARCHIVED yes (if true), APPLICABLE-TO-RT-MINI pending,
AUTHORITATIVE no. Gate: no blanket approval statement while related requirements open.

## §9 PV-5 load-side citation
A supply-side label cites NEC 705.11 / 705.12(A); topology is 705.11 supply-side.
Apply the existing topology-driven code-reference projection to PV-5; load-side-only
citations don't render; no renderer-local code strings. Package-wide topology/citation
gate over E-1, PV-4A, PV-4B, PV-5, SCHED, warning labels, evidence JSON.

## §10 BOM summary from row states
Current summary claims "44 items required / all quantities derived / no manual
estimates" — incompatible with rows. Replace with the state-derived PROCUREMENT
AUTHORITY SUMMARY (total; the five state counts; authoritative export count;
PROCUREMENT READY: NO; open procurement-impact gates). Never "all required / no
estimates / complete procurement package / authoritative total" unless row states
prove it.

## §11 Architecture freeze (absolute)
Preserve exactly: 7 root gates, 19 requirements, mapping, RS-1/.1/.2 layout, cover
block, readiness axes, registry, unknown-code fail-closed. Procurement corrections may
change procurement readiness + row-state counts; they must not remove blockers, clear
gates without evidence, modify mapping, create root gates, reduce the 19, or mark
permit-ready.

## §12 Final software-closure gates (24, all with anti-vacuity probes)
1 BOM total == unique final row IDs; 2 exactly one state per row; 3 counts sum to
total; 4 no double-count; 5 no disappearance from evidence/exports; 6 estimated
route-derived rows never VERIFIED_ORDERABLE; 7 open ROUTE-LENGTH-ESTIMATE affects
dependent rows; 8 Q-CONN non-orderable without verified selected solution; 9
connectors don't silently resolve the deficit; 10 IPLD350-3 non-orderable without
verified compatibility; 11 physical grounding IDs unique; 12 grouped authority not
counted physical; 13 pending racking cannot assert integrated UL 2703; 14 APP-A cannot
globally approve; 15 archived ≠ applicable; 16 supply-side cannot render
load-side-only citations; 17 summary counts derive from row states; 18 exports include
only VERIFIED_ORDERABLE; 19 non-orderable rows visible in review but never in order
exports; 20 cover + RS-1 still 7/19/0; 21 snapshot ID/digest consistent across 23
sheets; 22 horizontal clipping zero; 23 vertical clipping zero; 24
report-equals-rendered zero mismatches.

## §13 Hard closure
After this commit declare: PLANSET ENGINE SOFTWARE-COMPLETE FOR DESIGN-REVIEW RELEASE.
No new broad campaign unless a future artifact demonstrates: incorrect rendered
calculation; cross-sheet contradiction; unverified-as-verified; non-orderable-as-
orderable; missing/duplicated canonical object; gate/evidence mismatch; page clipping;
omitted required content; incorrect topology/code projection. NOT engine defects:
wording/visual preference, unresolved project selection, missing field measurement,
missing engineer approval, missing manufacturer document, genuine project release
requirements.

## Deliverables
Root-cause report (9 findings); final BOM row inventory w/ unique IDs;
procurement-state matrix; before/after population arithmetic; route-dependency map;
Q-Cable connector selection report; tap connector compatibility report; grounding
identity reconciliation; bonding authority report; APP-A document-state report;
topology/citation report; before/after BOM summary; authoritative procurement-export
artifact; excluded/non-orderable export artifact; updated 23-sheet HTML; full PDF;
per-sheet PNGs; H+V page-fit; report-equals-rendered; focused tests; full-suite
baseline; typecheck; production build; separate commit pushed to dev; explicit closure
statement.

## Boundaries
Dev only; separate commit; no HTML patching; no release-gate redesign; no mapping
changes; no requirement removal; no fabricated routes/extension solutions/conductor
compatibility/bonding authority/equipment approval/engineering approval; no
MFA/migration-governance changes; preserve every existing safety/authority/page-fit/
evidence gate.
