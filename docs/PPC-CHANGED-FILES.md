# PPC Changed Files — Projection / Procurement Authority Corrective Pass

Directive: `docs/PROJECTION-PROCUREMENT-CORRECTIVE-DIRECTIVE.md`
Root-cause map: `docs/PPC-ROOT-CAUSE-MAP.md`
Baseline: dev `41225032`. Grouped as the directive requires: canonical objects /
snapshot / projections / renderers / BOM / blocker components / issue-state language /
tests + harnesses.

---

## 1. Canonical objects (schema)

| file | + / − | what changed |
|---|---|---|
| `lib/permit/snapshot/types.ts` | +59 / −0 | `GroundingSegment` (§7) — id, from/to device, circuit/segment, size, insulation/type, `physicalRacewayId`, length + `lengthSource`, NEC basis, `authorityState`, `installedConductorAsserted`, `bomRowState`, `bomLineId`. `E1PhysicalSection.groundingSegmentId` / `.bondingPendingAuthority`. |
| `lib/bom-types-v4.ts` | +30 / −0 | §5 ROOT FIX — `BOMLineItemV4` gains `nonOrderable` / `nonOrderableReason` (§5/§9) and `quantityState` / `quantityStateLabel` (§8). Before this the type had no orderability field at all, which is why `calcRackingBOM`'s flags died at the boundary. |
| `lib/permit/types.ts` | +15 / −0 | `PermitInput['bom']` declares the same four fields — retires the renderer cast `(item as { nonOrderable?: boolean })`, the smell that marked the lost state. |
| `lib/structural-engine-v4.ts` | +86 / −1 | §5 — `ProcurementClass` A/B/C/D + `PROCUREMENT_CLASS_LABEL`; `RackingBOMRow` gains `procurementClass` / `manufacturerDisplayAllowed` / `skuDisplayAllowed`. The `railUnpinned` gate now also gates the MOUNT BASE, and every row leaves the engine classified. |
| `lib/permit/snapshot/procurementSufficiency.ts` | +35 / −6 | `QCableServiceLoopAllowance` — a DOCUMENTED service-loop allowance, STRICTER-ONLY (it raises the threshold and can never clear a deficit). Absent ⇒ byte-identical to before, so an unchanged design keeps its digest. |
| `lib/permit/snapshot/authorityInputs.ts` | +11 / −1 | `SnapshotAuthorityInputs.qcableServiceLoopAllowance`; the resolver returns `null` (no in-repo allowance authority). |

## 2. Snapshot build

| file | + / − | what changed |
|---|---|---|
| `lib/permit/snapshot/build.ts` | +13 / −1 | threads `opts.qcableServiceLoopAllowance` into `buildProcurementSufficiency`. |
| `lib/permit/generatePermit.ts` | +8 / −1 | threads `snapshotAuthority.qcableServiceLoopAllowance` into the pure build. |

## 3. Projections

| file | + / − | what changed |
|---|---|---|
| `lib/permit/snapshot/electricalProjection.ts` | +205 / −5 | **§1 root fix** — `projectE1PhysicalSchedule()`'s branch section consumes `projectOpenAirBranchGrounding()`; the bonding cell renders the AUTHORITY's outcome (PENDING / listed-integrated / honest additional EGC) and every row carries a `groundingSegmentId`. **§7** — new `projectGroundingSegments()` builds the canonical grounding object graph. |
| `lib/permit/snapshot/groundingAuthority.ts` | +16 / −3 | `GROUNDING_PENDING_BONDING_CELL_LABEL` (Ray's exact two-clause cell) + the candidate label's four mandated clauses. |
| `lib/permit/snapshot/structuralProjection.ts` | +177 / −2 | **§3/§4** — `projectAttachmentInstallationAuthority()`: ONE object carrying SpacingAuthority + FastenerAssembly + document applicability + the five verified conditions, `exactInstructionsAllowed`, `pendingLines`, `REFERENCE_DETAIL_BANNER`. |
| `lib/permit/snapshot/structuralBom.ts` | +103 / −2 | **§5** — `classifyStructuralBomRows()` + `STRUCTURAL_PROCUREMENT_CLASS_LABEL`; every canonical structural row carries its class, orderability and display permissions, with the full authority in hand. |
| `lib/permit/snapshot/projectAuthorityProjection.ts` | +74 / −0 | **§10** — `projectIssueStateLanguage()`: THE one issue-state language accessor (`packageLabel`, `computedFromLabel`, `deviationReferenceLabel`, `stateTag`). Approved-design wording is producible ONLY here and only on a digest-bound approval with zero open blockers. |

## 4. Renderers

| file | + / − | what changed |
|---|---|---|
| `lib/permit/sections/electricalPages.ts` | +185 / −29 | §1b E-1 grounding notes 2 + 3 authority-gated and DOMAIN-SCOPED (they printed the FEEDER gauge as a project-wide EGC minimum, and asserted a RACEWAY method for a FREE-AIR section). §7 the legacy PV-4B project-level EGC `<tr>` DELETED, replaced by `renderGroundingSegmentRows()`. PV-4A's "Grounding Conductor" summary row renamed to its domain and tagged with its object id; the EGC-sizing METHOD row tagged `data-grounding-code-basis`. PV-4A blocker rows compacted (page-fit). |
| `lib/permit/sections/structuralPages.ts` | +208 / −36 | §6 `AMPACITY / DEVICE-RATING RESULT` column + `PASS — ELECTRICAL RATING ONLY` + the `BRANCH RELEASE STATUS` matrix (schedule-level authorities stated once, per-branch facts per branch, no deficit apportionment). §6 topology-driven NEC 705 article. §5/§9 the computed `AUTHORITATIVE PROCUREMENT TOTAL` row + enumerated exclusions replacing prose. §8 the quantity cell renders `quantityState`. §4 PV-4C.1 note 5's diameter-keyed torque gated. |
| `lib/permit/sections/compliancePages.ts` | +29 / −6 | §10 PV-5 routes through the issue-state language accessor. §4/gate 6 the "Manufacturer Data Sheets — On File" racking citation now states APPLICABILITY beside availability (a ✓ presented the RT-MINI II manual as the applicable authority for the selected RT-MINI). |
| `lib/permit/sections/certPages.ts` | +18 / −5 | §10 the CERT liability clause and the THREE unreached PE-letter variants (fence / ground / roof) route through `deviationReferenceLabel`. |
| `lib/permit/sections/validationPage.ts` | +12 / −2 | §3/§4 latent — VAL-1's `attachSpacingIn` reads (default `|| 48`) replaced by the canonical spacing authority. |
| `lib/permit/utils/fieldLabels.ts` | +21 / −2 | §6 the topology SANITIZER BYPASS — the fallback returned `codeRefs[0]` UNFILTERED when the filter stripped the only NEC clause, printing load-side `705.12(D)(2)(3)(b)` on a supply-side design. |
| `lib/permit/utils/titleBlock.ts` | +7 / −2 | §6 PV-0 notes 17/18's unconditional 705.12 references gated on topology. |
| `lib/drafting/sheetComposition.ts` | +89 / −36 | **§3/§4 THE headline fix** — the drafting descriptor now carries the AUTHORITIES. `attachSpacing` (sourced from a legacy field literally named `maxAllowedSpacing`) retired; `lagSpec`/`embedSpec` replaced by the attachment-installation authority. Also the `sheetId: 'PV-2'` mis-attribution. |
| `lib/drafting/templates/roof.ts` | +128 / −43 | §3 every spacing emitter renders `designLabel` + `statusLabel` (no `O.C. MAX`, no hardcoded rail-less `48"`, one unit). §4 PV-3 prints NO exact diameter / length / embedment / torque / pilot / coating / sealant / screw-count; the two FABRICATED diameter-keyed derivations (`_torque`, `_pilot`) are DELETED; the detail is bannered NON-AUTHORITATIVE, not deleted. |

## 5. BOM

| file | + / − | what changed |
|---|---|---|
| `lib/bom-engine-v4.ts` | +128 / −29 | §5 `emitRackingBOMInto` PROPAGATES `pending`/`orderable` (and withholds the manufacturer on a pending row) instead of discarding them; `addItem` accepts the orderability/quantity-state block (conditionally spread, so untouched rows serialize byte-identically). §8 sealing caps carry `quantityState:'pending'` (both single-system and per-sub). NEW `_rackingLotState()` gates the registry racking LOT line — `RT-MINI-01` is no longer rendered as a selected SKU while the assembly is unpinned. |
| `lib/permit/utils/bomForPermit.ts` | +202 / −1 | §9 post-pass stamping the trunk-cable row with STATUS / REASON / DESIGNED-INSTALLED / ALLOWANCE / THRESHOLD / CURRENT BASE / DEFICIT / EXTENSION SOLUTION NOT SELECTED (selected cable identity kept). §5/§9 NEW `buildProcurementApproval()` / `orderableProcurementExport()` / `isOrderableForProcurement()` — the AUTHORITATIVE PROCUREMENT TOTAL and the orderable export subset, which did not exist anywhere in `lib/` before. |

## 6. Blocker-detail components

| file | + / − | what changed |
|---|---|---|
| `lib/permit/sections/reviewStatus.ts` | +177 / −20 | §2 — `BLOCKER_PAYLOAD_SCHEMA` (36 codes) + `blockerPayloadSchema()` + `renderBlockerPayload()` dispatching on the canonical schema; a grounding-authority component with Ray's full field list; a GENERIC component that renders only the fields a payload actually carries; the hardcoded literal `null` removed; every box machine-tagged `data-blocker-payload-schema`. The retired predicate was "payload is a non-null object" — no code-based selection at all. |

## 7. Issue-state language

Covered above: `projectAuthorityProjection.ts` (the accessor), `compliancePages.ts`
(PV-5), `certPages.ts` (CERT + 3 PE-letter variants).

## 8. Tests + harnesses

| file | + / − | what changed |
|---|---|---|
| `tests/planset/ppc-ws1-projection-procurement.test.ts` | NEW (671 lines) | §1/§2/§7/§8/§9 + the §5 propagation. Carries the assertion-CLASS scanner and the PROCUREMENT-INSUFFICIENT test input (audit §0 non-vacuity). |
| `tests/planset/ppc-ws2-structural-language.test.ts` | NEW (357 lines) | §3/§4/§5/§6/§10 gates, incl. the synthetic all-five-conditions-verified case and the synthetic verified racking regeneration. |
| `scripts/planset-evidence-ppc.mjs` | NEW | THE 18 permanent gates against the RENDERED package, class-based, with non-vacuity probes on gates 1, 10 and 17. Exits 2 on any violation. |
| `scripts/braidon-ppc-regen.ts` | NEW | emits BOTH acceptance packages (frozen fixture + the procurement-insufficient variant) through the public API. |
| `scripts/ppc-artifacts.ts` | NEW | emits the 11 `docs/evidence/braidon-ppc-*.json` deliverables. |
| `scripts/planset-pagefit.mjs` | +102 / −14 | gate 17 — the HORIZONTAL twin of both passes (page-level rightmost non-SVG descendant, plus every horizontal clip container by `scrollWidth − clientWidth`). Exits non-zero on either axis. |
| `scripts/planset-evidence-bar.mjs` | +75 / −5 | gate 1's phrase-list check replaced by the assertion-CLASS scanner; grounding-row segment-id + legacy-row checks. |
| `scripts/planset-evidence-bar-wse.mjs` | +13 / −4 | the candidate-EGC label asserted by its three required clauses (class, not one sentence). |
| `scripts/planset-evidence-ep.mjs` | +17 / −2 | gate 16 updated: with the `fieldLabels` sanitizer bypass fixed, the load-side-only clause is ABSENT rather than present-and-N/A. The gate accepts the stronger outcome and still fails if the clause is cited as a requirement. |
| `tests/planset/conductor-authority.test.ts` | +27 / −8 | the retired assertion required ONE project-wide EGC value on two surfaces — that premise WAS the defect (both read the feeder object). Re-based on domain scoping: the two IN-RACEWAY surfaces must agree, and no surface may print a project-wide EGC minimum. |
| `tests/planset/qcable-procurement-sufficiency.test.ts` | +42 / −8 | the retired assertions targeted a standalone SCHED note that duplicated the row's own state; re-based on the trunk BOM ROW itself (the stronger §9 outcome) plus the primary sheet's per-branch status. |
| `tests/planset/rtmini-attach-spacing.test.ts` | +28 / −15 | spacing/fastener assertions re-based on the canonical authority labels. |
| `tests/planset/ep-closeout-co-c.test.ts` | +22 / −3 | racking/fastener orderability assertions re-based on the classification. |
| `tests/planset/structural-correction-w.test.ts` | +6 / −2 | spacing-label assertions re-based on the authority. |

## 9. Deliverables written

`docs/evidence/braidon-ppc.planset-evidence.json` (18/18, frozen fixture) ·
`braidon-ppc-insufficient.planset-evidence.json` (18/18, procurement-insufficient) ·
`braidon-ppc-page-fit-report.json` + `-insufficient.json` (H+V) ·
`braidon-ppc-e1-grounding-rows-before-after.json` ·
`braidon-ppc-grounding-object-graph.json` ·
`braidon-ppc-blocker-schema-reconciliation.json` ·
`braidon-ppc-spacing-language-scan.json` ·
`braidon-ppc-pv3-authority-before-after.json` ·
`braidon-ppc-racking-bom-orderability.json` ·
`braidon-ppc-branch-status-matrix.json` ·
`braidon-ppc-grounding-segment-bom-reconciliation.json` ·
`braidon-ppc-cap-terminator-topology.json` ·
`braidon-ppc-qcable-orderability.json` ·
`braidon-ppc-issue-state-language-scan.json` ·
`docs/PPC-CHANGED-FILES.md` (this file) ·
`docs/PPC-ROOT-CAUSE-MAP.md` (AFTER column).

## 10. Not changed (deliberately)

- `tests/fixtures/braidon-original-audit-fixture.ts` — the frozen acceptance fixture
  is never modified.
- Live-DB evidence artifacts — NOT regenerated. The BRAIDON project still has 3+
  duplicate rows and they remain un-disambiguated; a live regen would silently pick
  one. Every artifact in this pass is fixture-derived and says so.
- MFA / migration governance — out of scope by the directive's boundaries.
