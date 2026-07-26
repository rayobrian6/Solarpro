# BAR — Blocker & Authority Reconciliation: changed files

Single commit on `dev`, baseline `9ea52f22`. Grouped per convention: schema/authority →
projection → render → BOM → harness → tests → evidence. Directive:
`docs/BLOCKER-AUTHORITY-RECONCILIATION-DIRECTIVE.md`. Forensics:
`docs/BAR-ROOT-CAUSE-MAP.md`.

## Schema / canonical authority

| File | § | Change |
|---|---|---|
| `lib/permit/snapshot/environmentalAuthority.ts` **(new)** | §2 | The `EnvironmentalLoadAuthority` gate: `buildEnvironmentalLoadAuthority`, `environmentalSourceVerified` (verified ⇔ verified + archived + sha256 + covers wind/snow/exposure-risk + project-applicable + currency-reviewed), per-field `EnvironmentalLoadBasis`, operator-override recording, and the render helpers `environmentalBasisLabel` / `environmentalStateTag` / `environmentalSourceLabel`. Pure — no DB. |
| `lib/permit/snapshot/types.ts` | §2, §7 | `EnvironmentalLoadAuthority`, `EnvironmentalLoadBasis`, `EnvironmentalVerificationStatus` on `StructuralEnv`; connector/cap/terminator object fields. |
| `lib/permit/snapshot/structuralAuthority.ts` | §2 | `buildEnv` now sources wind/snow/exposure label + verification state FROM the authority record; `windSpeedSource` can no longer say "canonical project/AHJ wind authority" for a bare operator entry. Single blocker emitter renamed `WIND-SNOW-AUTHORITY-UNRESOLVED` → `ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED`, subsuming BOTH the null/code-default branch and the operator-entered-without-provenance branch. |
| `lib/permit/snapshot/build.ts` | §2, §5 | `windValuePresent` / `snowValuePresent` replace the old "non-null field ⇒ authoritative" test; `opts.environmentalSource` threaded into `buildStructuralAuthority`; branch-EGC grounding objects. |
| `lib/permit/snapshot/severityPolicy.ts` | §2 | Severity + domain wiring for the renamed code (blocking / structural). |
| `lib/permit/snapshot/projectAuthority.ts` | §1, §2 | Domain classification for the renamed code; registry/issue-state surfaces. |
| `lib/permit/snapshot/authorityInputs.ts` | §2 | `environmentalSource` on `SnapshotAuthorityInputs`, resolved via `resolveClimateHazardDocument` with the SAME project-applicability key the pure gate checks; fail-soft `null` when the DB is unavailable. |
| `lib/documents/registry.ts`, `lib/documents/types.ts` | §2 | `resolveClimateHazardDocument` + the climate-hazard document class. |
| `lib/permit/utils/canonical.ts` | §2 | `canonicalSite.groundSnowLoad` now falls back to `project.ahjGroundSnowPsf` → `project.groundSnowPsf`, symmetric with `windSpeed`. Without it an operator/AHJ 20 psf was silently replaced by an engine 0 psf while the authority record still called that field an OPERATOR OVERRIDE. |

## Projection

| File | § | Change |
|---|---|---|
| `lib/permit/snapshot/electricalProjection.ts` | §4, §5, §7, §8 | Full `AmpacityAdjustmentResult` per section (was a lone `deratingFactor` scalar); `OpenAirBranchGroundingAuthority`; connector/cap/terminator topology; canonical open-air wiring method. **Projection layer by design** — every input already lives on the snapshot, so persisting the derived result would create a second authority that can drift. Exported on the sheet as the `data-bar-wse` stamp so the harness compares rendered-vs-canonical without re-deriving. |
| `lib/permit/snapshot/structuralProjection.ts` | §6 | `projectFastenerAssembly` suppresses manufacturer / SKU / diameter / length / coating / capacity while unverified and marks the quantity non-orderable. |
| `lib/computed-system.ts` | §4 | Exposes the count-adjustment + ambient-correction factors, bases and terminal-temperature cap the ampacity result itemizes. |

## Render

| File | § | Change |
|---|---|---|
| `lib/permit/sections/structuralPages.ts` | §2, §3, §6 | PV-4C / PV-4C.1 / PE-1 environmental state tags + source lines (`data-env-source`); the SCHED page conclusion + `VERIFIED` badge are now DERIVED from the registry / issue state ("DESIGN REVIEW PACKAGE / COMPLIANCE NOT YET ESTABLISHED / SEE RS-1 FOR ACTIVE RELEASE BLOCKERS" while any blocker is active); fastener rows carry `data-fastener-orderable="false"` + the non-orderable design-quantity label; PV-4C continuation strip tightened to keep the sheet page-fit clean after the new provenance content. |
| `lib/permit/sections/electricalPages.ts` | §4, §5 | E-1 / PV-4A / PV-4B render the itemized ampacity chain (no bare `derate 0.96`) and the open-air branch EGC with its footage. |
| `lib/permit/sections/compliancePages.ts`, `certPages.ts`, `arrayPages.ts`, `reviewStatus.ts` | §1, §2, §3 | Registry/blocker surfaces, cover banner + RS-1 rows for the renamed code, no global compliance language while blockers exist. |
| `lib/permit/utils/sldAdapter.ts` | §5, §8 | `branchEgcGauge`, `homerunEgcGauge`, `openAirBranchWiringLabel` into the SLD input. |
| `lib/sld-professional-renderer.ts` | §8 | The E-1 legend is generated from the canonical wiring-method objects present on the sheet; the hardcoded `Open Air — PV Wire/THWN-2` literal is gone. |
| `lib/permit/sections/reviewStatus.ts` | §1, §13 | RS-1 legibility under the longer code name: the CODE cell wraps inside its fixed-layout column instead of overrunning the ISSUE column (`ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED` is 39 chars vs the retired code's 30), and the STATUS column is wide enough for the severity badge, which was bleeding over the first character of every code. |
| `lib/permit/generatePermit.ts` | §13 | `.sld-page` reserves the same 1.72in title-block strip `.page` does. That override was harmless when E-1 held only the centred SLD, but the E-1 physical schedule, the ampacity chain and the grounding note ran the full 17in and slid under the title block, where the COMPLIANCE column was unreadable. |
| `lib/permit/utils/titleBlock.ts` | §14 | Snapshot id / digest stamping. |
| `lib/permit/generatePermit.ts` | §2 | Threads `snapshotAuthority.environmentalSource` into the snapshot build (same shape as `capacityDocument` / `framingCapacityDocument`). |

## BOM

| File | § | Change |
|---|---|---|
| `lib/permit/utils/bomForPermit.ts` | §5, §6, §7 | `GRN-OPENAIR-12` open-air branch EGC row (Σ branch-cable-path geometry × documented waste); attachment/screw quantities excluded from procurement totals while unverified; caps/terminators sourced from topology objects instead of `branchCount`. |
| `lib/bom-engine-v4.ts` | §6, §7 | Non-orderable design-quantity stage handling; cap/terminator quantities no longer multiplied by branch count. |

## Harnesses

| File | Change |
|---|---|
| `scripts/planset-evidence-bar.mjs` **(new)** | The 14 permanent gates. Owns 1, 2, 3, 8, 12, 13, 14; CHAINS 4, 5, 6, 7, 9, 10, 11 to `bar-wse`; gate 13 invokes the true geometry validator `scripts/planset-pagefit.mjs`. Exit 2 on any violation. |
| `scripts/planset-evidence-bar-wse.mjs` **(new)** | 33 WS-E electrical checks behind gates 4/5/6/7/9/10/11, read from the package's own `data-bar-wse` canonical stamp. Exit 1 on any failure. |
| `scripts/planset-evidence-ep.mjs` | New gate 22 chains `bar-wse` into the EP closeout invocation in BOTH modes; gate 2's `#12` ban scoped to the CCC-bundle form (BAR §5 legitimately introduces a `1×#12 GRN EGC` branch label); gate 3's no-PASS scan excludes the ampacity chain's own verdict (a specific calculation gates 4/5 require to be shown) so it still tests the SECTION verdict. |
| `scripts/planset-evidence-w3.mjs` | Renamed blocker pinned in `STRUCTURAL_BLOCKER_CODES` + `EXPECTED_ORIGINAL_BLOCKERS`. Two staleness fixes: the sheet-wrapper split now matches any modifier class, and V30's "omitted" test is resolved against the UNION of placement manifests (a rail drawn on the structural sheet was being counted omitted from the roof-plan manifest once a second manifest existed). |
| `scripts/planset-evidence-w4.mjs` | Renamed blocker pinned in `EXPECTED`; sheet-wrapper split fixed the same way (it counted 19 of 21 sheets and reported a false `authority.sheet-index` disagreement). |

## Tests

| File | Change |
|---|---|
| `tests/planset/environmental-load-authority-bar.test.ts` **(new)** | §2 — verified source, operator override, missing source, stale source (recorded date without currency review). |
| `tests/planset/bar-electrical-wse.test.ts` **(new)** | §4/§5/§7/§8 — ampacity chain completeness + PENDING-on-hole, grounding result B, EGC route/BOM agreement, topology-derived caps/terminators, generated legend. |
| `snapshot-w1`, `structural-correction-w`, `structural-closeout-co-c`, `governance-quality-gates-0722`, `direct-mount-authority`, `equipment-document-authority-w5`, `electrical-closeout-0723`, `trunk-cable` | Renamed blocker code + new authority records + EGC/cap/terminator expectations. |
| `tests/goldens/__snapshots__/wave0-bom-legacy.golden.test.ts.snap` | Open-air EGC row + topology-derived cap/terminator quantities. |
| `test-fixtures/golden/golden.json` | `sld-input-roof.topLevelKeys` + `branchEgcGauge`, `homerunEgcGauge`, `openAirBranchWiringLabel` (regenerated via `npm run golden:generate`; only those 3 keys changed). |

## Evidence / docs

`docs/BLOCKER-AUTHORITY-RECONCILIATION-DIRECTIVE.md`, `docs/BAR-ROOT-CAUSE-MAP.md`
(+ AFTER column), `docs/BAR-CHANGED-FILES.md`, and in `docs/evidence/`:
`bar-blocker-registry-before-after.json`, `bar-wsg-rendered-verification.json`,
`braidon-environmental-load-authority.json`,
`braidon-shared-raceway-ampacity.json`,
`braidon-qcable-grounding-authority.json`,
`braidon-fastener-procurement-authority.json`,
`braidon-connector-cap-terminator-topology.json`,
`braidon-e1-legend-reconciliation.json`,
`braidon-bar-rendered-truth-matrix.json`,
`braidon-bar-report-equals-rendered.json`,
`braidon-bar-evidence-{original,live}.json` (+ `.wse.json`), and the regenerated
`braidon-ep-evidence-{original,live}.json` /
`braidon-{original,live}-w3.planset-evidence.json` /
`braidon-{original,live}-w4.planset-evidence.json`.
