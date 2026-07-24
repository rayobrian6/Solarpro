# Final Closeout Pass — Changed Files (grouped by role)

Single commit on `dev`, baseline `3a06cc80`. Objective: make SolarPro incapable of
generating the audited Braidon contradictions/clipped sheets — canonical sources
fixed so every future project inherits the correction. Excludes `_tmp_*`, `.claude/`,
`scripts/render-cad-preview.ts` (never staged).

Verification of the change set: `npx tsc --noEmit` clean · `vitest run tests/planset`
688/688 · `vitest run tests/goldens` 254/254 · `planset-evidence-co` **20/20 both
modes** · geometry page-fit 21/21 sheets, 0 clipped · package 21 sheets == manifest ==
PDF 21 pages.

---

## Engine (canonical objects — no renderer may calculate)
- **`lib/computed-system.ts`** — §3/§4: split the merged `BRANCH_RUN` into the open-air
  Q-Cable trunk (`FREE_AIR`/`NONE`, `isOpenAir:true`) and the shared jbox→combiner
  conduit home-run `BRANCH_HOMERUN_RUN` (`physicalRacewayId`, `sharedCircuitCount`,
  `minimumCodeRacewaySize`); first-class `physicalRaceways[]` objects (per-raceway
  fill/derating/CCC); `racewayNecArticle()` type→article map (PVC→352, EMT→358…).
- **`lib/computed-multi-system.ts`** — carries the sectioned runs + physical raceways
  through the multi-subsystem aggregation.
- **`lib/bom-engine-v4.ts`** — §5/§6/§7: per-raceway BOM iteration (retires the
  `— all runs` roll-up); branch conductor feet derived from route segments × shared
  circuit count (not a merged scalar); NEC article from the raceway type; deletes the
  double-billed flat structural EGC row.

## Snapshot (authority projection surface)
- **`lib/permit/snapshot/build.ts`** — §9 service-topology graph (8 objects, dual-purpose
  fused-ocpd; separate utility disconnect only when the project specifies one); §17
  severity promotions wired into the registry; framing/racking authority threading.
- **`lib/permit/snapshot/types.ts`** — schema for `physicalRaceways[]`, sectioned route
  segments, service-topology device fields (dualPurposeListing/utilityRole/upstream/
  downstream), fastener assembly, severity.
- **`lib/permit/snapshot/severityPolicy.ts`** *(new)* — §17/§19 the declarative severity
  policy (`SEVERITY_POLICY`, `classifyBlockerSeverity`, `validateSeverityPolicy`): permit-
  critical missing inputs classify BLOCKING; advisory only when the fact cannot affect
  safety/code/procurement/approval/acceptance.

## Projection (read-only sheet accessors)
- **`lib/permit/snapshot/electricalProjection.ts`** — `projectCanonicalFeeder`,
  `projectSharedBranchRaceway`, `projectRacewayDescriptor` (one route accessor — §2),
  `projectCanonicalBranch`, route provenance/verification labels.
- **`lib/permit/snapshot/structuralProjection.ts`** — `projectFastenerAssembly` (§12 one
  fastener object, `PENDING VERIFIED FASTENER ASSEMBLY` when unverified), structural
  banner + review-required gating.
- **`lib/permit/snapshot/equipmentProjection.ts`** — §17 `MODULE-EXACT-DATASHEET-PENDING`
  promoted; equipment/document projection.

## Validator (fail-closed invariants)
- **`lib/permit/snapshot/validate.ts`** — branch-raceway coverage / raceway-segment
  conflict / device-role duplicate (V43) / severity-policy invariants.

## Renderer (project only — no local calc/selection/issue decision)
- **`lib/permit/sections/electricalPages.ts`** — §1 PV-4A busbar N/A + PENDING (no
  synthesized PASS, legacy rules-detail table retired); §2/§3 raceway descriptor;
  §5 conductor schedule from conductor authority; §15 PV-4B conclusion recompose.
- **`lib/permit/sections/structuralPages.ts`** — §12 fastener projection on PV-4C;
  §13 capacity/adequacy gated on `_reviewRequired`; §14 envelope statement; §15 PV-4C.1
  continuation (reaction rows → continuation sheet).
- **`lib/permit/sections/certPages.ts`** — §12 PE-1 fastener projection + PENDING gate;
  §15 CERT footer recompose.
- **`lib/permit/sections/coverSheet.ts`** — §16 issue-state accessor
  ("DESIGN REVIEW PACKAGE — NOT FOR PERMIT SUBMISSION"), no local "Issued for permit review".
- **`lib/permit/sections/compliancePages.ts`** — §12 APP-A fastener projection.
- **`lib/permit/sections/datasheetAppendix.ts`** — §10 DS-4 omitted while `railSku` unpinned.
- **`lib/permit/sections/reviewStatus.ts`** — §14/§17 RS-1 registry rendering (14 blocking).
- **`lib/permit/utils/titleBlock.ts`** — §2/§7 route accessor instead of
  `project.conduitType || 'EMT'`.
- **`lib/permit/utils/sldAdapter.ts`** — §3 E-1 shared home-run + open-air branch (no merged run).
- **`lib/sld-professional-renderer.ts`** — §8 DC-conductor legend gated on `!isMicro`.
- **`lib/drafting/sheetComposition.ts`** — §11 RT-MINI label from canonical `mountTopology`
  (`RAIL-PAIRED ROOF ATTACHMENT BASE`, name-regex retired).
- **`lib/permit/generatePermit.ts`** — package assembly threading.
- **`lib/engineering-helpers.ts`** — *(closer)* retired the stale hardcoded `IronRidge
  XR100 rail` string in the `ROOF_TYPES` shingle helper to a rail-PENDING-SELECTION note
  (no external consumer read `.hardware`; app/engineering uses its own local table).

## Layout (pagination + continuations)
- **`lib/permit/plansetManifest.ts`**, **`lib/permit/sheetManifest.ts`** — §15/§17
  PV-4C.1 / SCHED-2 / SCHED-3 continuation sheets with title block + manifest entry +
  continuation title; SCHED continuation count derives from final BOM rows.

## BOM
- **`lib/bom-engine-v4.ts`** — (see Engine) per-raceway objects, article-by-type, no orphan wire row.

## Tests
- *(new closeout)* `tests/planset/electrical-closeout-0723.test.ts`,
  `bom-closeout-0723.test.ts`, `structural-closeout-co-c.test.ts`,
  `severity-policy-gate19.test.ts`, `blocker-preservation-s18.test.ts`.
- *(updated)* `pagination-w9.test.ts`, `bom-racking-scope.test.ts`,
  `electrical-correction-0722.test.ts`, `equipment-document-authority-w5.test.ts`,
  `wave6-legacy-sweep.test.ts`.
- *(golden regen — expected)* `tests/goldens/__snapshots__/wave0-bom-legacy.golden.test.ts.snap`,
  `wave0-computed-system.golden.test.ts.snap` — sectioned branch + physical-raceway objects
  change the computed-system/BOM shape; regenerated + reviewed.

## Harness + artifact generators (scripts)
- **`scripts/planset-evidence-co.mjs`** *(new)* — the 20-gate closeout rendered-truth
  harness (fixture + live), gate 15 invokes the page-fit validator; exits non-zero on any
  violation.
- **`scripts/planset-pagefit.mjs`** *(new)* — §15 TRUE geometry page-fit gate; `--png`/`--json`.
- **`scripts/closeout-artifacts.mjs`** *(new)* — object-derived deliverable artifacts
  (branch-conductor reconciliation, physical-raceway/electrical-segment/service-device
  graphs, racking-fastener/framing-authority/screening-envelope/blocker-registry/truth-matrix).

## Docs + evidence
- `docs/CLOSEOUT-PASS-DIRECTIVE.md`, `docs/CLOSEOUT-ROOT-CAUSE-MAP.md` (+ AFTER column),
  `docs/CLOSEOUT-CHANGED-FILES.md`.
- `docs/evidence/braidon-{live,original}-co.planset-evidence.json` (20/20 truth matrix),
  `braidon-{live,original}-w4.planset-evidence.json` (refreshed), `braidon-page-fit-report.json`,
  and the eight object-derived reconciliation/graph artifacts.
