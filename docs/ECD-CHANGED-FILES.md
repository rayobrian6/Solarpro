# ECD — CHANGED FILES

Final Planset Engine Closure pass (`docs/ENGINE-CLOSURE-DIRECTIVE.md`), one commit
on `dev` over baseline `8cf77c8e`. Every entry states WHAT changed and WHY, in the
directive's section terms. Nothing in `_tmp_*`, `.claude/` or
`scripts/render-cad-preview.ts` is part of this commit.

Acceptance: 24/24 rendered gates and 24/24 anti-vacuity probes in all three modes
(fixture `PDS-76C0C5B56CEF` / insufficient `PDS-4B328A574DB9` / identity
`PDS-949E2B4125A5`), 24 sheets, 48 BOM rows, 7 gates / 0 advisories in every mode.

---

## New engine modules

| File | Why |
|---|---|
| `lib/bom/bomLineId.ts` | **§1 prerequisite.** The stable, CONTENT-derived BOM row identity (`BOM-<CATEGORY>-<FNV1a32 of stage:category:unit:partNumber>`, ordinal-suffixed on collision) plus the ONE stamping pass and the multiset audit. Before this there was no stable row identity at all — only an optional ordinal `bom-v4-NNNN` with a gap and two rows carrying no id — so §1's "rendered == evidence == export" reconciliation was not implementable. |
| `lib/permit/snapshot/supplySideTap.ts` | **§5.** `SupplySideTapConnectionAuthority`: what the existing service-entrance conductor IS (honestly null — not surveyed), the connector's listed range, the enumerated unresolved facts, and the mandated CANDIDATE label. Replaces a "Verify lug range…" caveat that lived as prose inside the BOM row's own description. |
| `lib/permit/snapshot/rackingBonding.ts` | **§7.** `RackingBondingAuthority`: the bonding REQUIREMENT (always true, code) separated from the bonding METHOD (three outcomes; `METHOD_PENDING_ASSEMBLY_SELECTION` until an exact verified assembly with a listing source and an applicable document exists). |
| `lib/permit/snapshot/equipmentListingConclusion.ts` | **§8.** The registry-derived APP-A conclusion. Replaces the bare literal "All equipment is CEC Listed, UL Listed, and approved for grid interconnection." Fail-closed: no registry means nothing is established. |

## Engine changes

| File | Why |
|---|---|
| `lib/bom-types-v4.ts` | **§2.** `ProcurementAuthorityState` (the five states) + labels, `BomQuantitySource`, `ProcurementVerificationStatus`, and `ProcurementAuthorityRecord` — the ONE per-row authority record, including `producerNonOrderable` / `producerQuantityState` so the classifier can never read its own projections back as producer facts. |
| `lib/bom-engine-v4.ts` | **§3/§4/§5.** Emitters declare FACTS, not states: `quantitySource` + `affectedRouteIds` on every route-derived row (`emitRacewayConduitBom`, `emitAcConductorBom`); the `?? 30` fabricated one-way length default is DELETED at all four sites; the Q-CONN connector rows and the IPLD350-3 tap row carry producer candidate hints instead of prose caveats; the "Verify lug range…" literal is gone from BOTH emitters. |
| `lib/permit/utils/bomForPermit.ts` | **§1/§2/§3/§4/§5/§10 — the load-bearing file.** `PermitBOMItem` gains `bomLineId` + `procurement` + the producer-fact fields. ONE classifier `classifyProcurementAuthority(row, ctx)`; `isOrderableForProcurement` becomes fail-CLOSED (`state === 'VERIFIED_ORDERABLE'`); `nonOrderable` / `quantityState` become back-compat PROJECTIONS written by `applyProcurementAuthority`; `producerViewOf()` makes re-classification idempotent; `ProcurementApproval` gains the six canonical counters, the row-id multisets and the state-derived statement; `orderableProcurementExport` / `nonOrderableProcurementExport` partition the population. The supply-side-tap post-pass is two-way (a VERIFIED authority clears the pre-snapshot engine's candidate hint). |
| `lib/permit/snapshot/types.ts` | The combined additive types commit both workstreams branched from: the §2 row fields, `CableExtensionSolution`, `SupplySideTapConnectionAuthority`, `RackingBondingAuthority`, and the `GroundingSegment` identity fields (`identityKind`, `groundingAuthorityGroupId`, `memberGroundingIds`, `branchScope`, `bomLinePartNumber`). |
| `lib/permit/types.ts` | `PermitInput.bom` row-shape passthrough for the new fields. |
| `lib/permit/snapshot/build.ts` | Constructs the tap, cable-extension and racking-bonding authorities and stores them on the canonical snapshot. |
| `lib/permit/snapshot/electricalProjection.ts` | **§6, both collapse sites.** The grouped branch-EGC node gets its OWN id (`gnd-branch-egc-authority`) instead of borrowing `gnd-br-1`; each E-1 branch section carries ITS OWN physical grounding id instead of one id stamped on all three; `GroundingSegment.bomLineId` becomes a real content-derived BOM row id (the part number moves to `bomLinePartNumber`). |
| `lib/permit/snapshot/procurementSufficiency.ts` | `CableExtensionSolution` threading for the §4 promotion contract. |
| `lib/permit/snapshot/structuralAuthority.ts`, `structuralProjection.ts` | Racking-bonding + fastener authority plumbing for the drafting stack. |
| `lib/manufacturer-assets-db.ts` | **§8.** `DocumentApplicability` widens from a binary to the SEVEN-state model (`ARCHIVED` / `APPLICABLE` / `VERIFIED` / `AUTHORITATIVE` / `SUPERSEDED` / `NOT_APPLICABLE` / `PENDING_APPLICABILITY`), with `DocumentRegistryFacts` as a PURE argument (never guessed), `applicabilityVerified` bit-for-bit equal to the old `state === 'verified'`, and `authoritative` requiring a real archived + hash-bound record. `ARCHIVED` is a companion availability chip and never a verdict. |
| `lib/permit/utils/fieldLabels.ts` | **§9, site 1 of 2.** The `705.12(A) -> 'supply'` special case is DELETED; every 705.12 subdivision is load-side for labelling, so a supply-side design drops it. |
| `lib/data/placards/field-placards-research.json` | **§9, site 2 of 2.** The NEC-2020 `line-side-tap-warning` codeRef no longer carries `705.12(A)`. Both sites, or it regresses through the other path. |

## Rendering changes

| File | Why |
|---|---|
| `lib/permit/sections/structuralPages.ts` | **§1/§10.** SCHED: every row tagged `data-bom-line-id` / `data-bom-authority-state` / `data-bom-quantity-source` / `data-bom-blocking-requirements`; the quantity cell prints the row's ONE state (including the new `EST — FIELD VERIFY` label); the population row states `N shown here + M scheduled above` and names the scheduled-above row ids; the AUTHORITATIVE PROCUREMENT EXPORT row and the state-derived PROCUREMENT AUTHORITY SUMMARY replace the three retired renderer-local claims. `SCHED_BOM_ROWS_CONT` 21 -> 14 because the state labels add a second line per estimated row (measured; 21 clipped by 108px). Consequence: 24 sheets, not 23 — pagination, not content loss. |
| `lib/permit/sections/electricalPages.ts` | **§6/§7.** E-1 renders per-branch physical grounding ids and the group-authority reference; the grounding/bonding SVG detail states the general NEC 250.134 / 690.43 requirement and the PENDING method from the authority instead of `MODULE RAIL — BONDED (UL 2703)`. |
| `lib/permit/sections/compliancePages.ts` | **§7/§8/§9.** APP-A: `Bonding Method` + `Bonding Requirement` rows from the authority (retiring a fail-OPEN `UL 2703` default); the green tick is GONE and each document row renders its state chips, with applicability evaluated for EVERY row; the blanket approval sentence is replaced by the registry-derived conclusion with its open codes. PV-5 placard code-ref cells are machine-tagged (`data-label-nec-ref` / `data-label-side` / `data-label-required`) so the topology gate can reach them. |
| `lib/drafting/templates/roof.ts` | **§7.** The PV-3 hardware schedule BONDING row consumes the authority in BOTH branches — it previously asserted `UL 2703 INTEGRATED` in the assembly-PENDING branch, three rows below `FASTENER ASSEMBLY: PENDING VERIFIED SELECTION`. |
| `lib/drafting/sheetComposition.ts` | **§7.** PV-3 callout 7 no longer says `BONDING JUMPER`; it degrades with its siblings to the pending-method label. |
| `lib/permit/sections/datasheetAppendix.ts` | **§8.** The DS applicability banner fires on `!applicabilityVerified` rather than on the retired binary `state === 'unverified'`. |

## Harnesses, generators and tests

| File | Why |
|---|---|
| `scripts/planset-evidence-ecd.mjs` | **NEW — the 24 permanent §12 gates** against the RENDERED package, in three modes, each gate paired with an anti-vacuity probe. Refuses to run if the model evidence describes a different snapshot. Exits 2 on any violation or any failed probe. |
| `scripts/ecd-model-evidence.ts` | **NEW — the canonical model evidence** the rendered gates are compared against (row records, the approval object, both export sets, the route/cable/tap/grounding/bonding/document/topology authorities) plus ONE anti-vacuity probe per gate. Probes are synthetic PURE-FUNCTION calls; no snapshot is patched and no authority is written back. |
| `scripts/ecd-artifacts.ts` | **NEW — the 13 deliverable artifacts** in `docs/evidence/`, all three modes. AFTER numbers are read from canonical objects or the rendered package; BEFORE numbers are quoted from the Phase-0 forensic measurement with the source line cited. |
| `scripts/ppc-artifacts.ts` | Extended with the §6 physical-vs-group grounding invariants. |
| `tests/planset/ecd-ws1-procurement-authority.test.ts` | **NEW.** WS-1 regression set: row identity, the five states, fail-closed classification, route reclassification, Q-CONN, the tap authority, the counters. |
| `tests/planset/ecd-ws2-authority-identity.test.ts` | **NEW.** WS-2 regression set: grounding identity, bonding requirement-vs-method, the seven document states, the topology/citation fix. |
| `tests/planset/ppc-ws1-projection-procurement.test.ts`, `ppc-ws2-structural-language.test.ts`, `ep-closeout-co-c.test.ts`, `snapshot-w1.test.ts` | Updated to the new state model / identities. Every prior assertion is preserved or strengthened; none is removed. |

## Documentation and evidence

| File | Why |
|---|---|
| `docs/ENGINE-CLOSURE-DIRECTIVE.md` | Ray's directive, committed with the work it governs. |
| `docs/ECD-ROOT-CAUSE-MAP.md` | The Phase-0 forensic audit plus the **AFTER column**, the final state matrix, the before/after arithmetic, corrections to the audit's own numbers, the two additional defects the probes found, and the honest gaps carried forward. |
| `docs/ECD-CHANGED-FILES.md` | This file. |
| `docs/evidence/braidon-ecd-*.json` (13 new) | The directive's deliverables: BOM row inventory, procurement-state matrix, population arithmetic, route-dependency map, Q-Cable connector selection, tap connector compatibility, grounding identity reconciliation, bonding authority, APP-A document states, topology/citation, BOM summary before/after, and the two partitioning export artifacts. |
| `docs/evidence/braidon-*` (existing sets, regenerated) | EP / PPC / BAR / BAR-WSE / CO / W3 / W4 generators and rendered-truth harnesses re-run at the FINAL state, so every digest stamp matches the final HTML. The evidence moved twice during the pass (WS-1 and WS-2 each shifted the digest via the two new snapshot fields); these are the final values. |

## Deliberately NOT changed

* `lib/proposal/renderProposalHTML.ts` — the proposal-side twin of the APP-A
  approval sentence. Sales collateral, out of planset scope, flagged in Phase 0
  so a future sweep does not fix the wrong emitter.
* The release-gate architecture — 7 root gates, the requirement-to-gate mapping,
  RS-1/.1/.2, the cover block, the readiness axes, the registry, unknown-code
  fail-closed. §11 freeze. Verified unchanged by gate 20 in all three modes.
* `docs/evidence/braidon-live-rp.planset-evidence.json` — left at its committed
  value. `scripts/planset-evidence-rp.mjs` is superseded (RGM's 17 gates and this
  pass's 24 cover the same ground) and 3 of its 20 gates no longer match the
  current sheet architecture: gate 2 false-positives on the honest NEGATED
  wording "route length is a CAD-derived estimate (not field-verified…)" (present
  at `8cf77c8e`), and gates 13/14 predate the RGM redesign (RS-1 continuation
  sheets; the `ACTIVE RELEASE BLOCKERS` heading no longer exists). Committing a
  failing artifact would be worse than leaving the stale one and saying so. Its
  gate 18 — the only one this pass actually broke, by passing an equipment-db
  scalar as the APP-A inverter identity — is fixed.
* MFA / migration governance. Untouched.
