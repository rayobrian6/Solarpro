# EP Closeout — Changed Files (grouped by engine / authority / snapshot / projection / renderer / BOM / blocker-registry / layout / validator / tests)

Closeout of `docs/ELECTRICAL-PROCUREMENT-CLOSEOUT-DIRECTIVE.md` (§1–§19 + 20 permanent
rendered gates). Single commit on `dev`, baseline `903e14cd` (framing gate preserved,
unchanged). Every file below is object-source; no HTML patching, no hand-edited evidence.

## Engine (canonical physical objects)
- `lib/structural-engine-v4.ts` — §11 racking BOM taxonomy: confirmed mount-base vs
  assembly-dependent (rails/splices/clamps/T-bolt/L-foot/bonding) vs unselected; the
  assembly-dependent rows carry `pending:true / orderable:false / partNumber:null /
  description:"PENDING RACKING ASSEMBLY SELECTION"` while `railSku` is unpinned (qty geometry
  preserved).
- `lib/bom/deriveRunLengths.ts` — §7 geometry-derived per-branch Q-Cable cable-path lengths
  (drop count = 1/micro; designed-installed = Σ geometric path; procurement = Σ drops × pitch ×
  waste), retiring the plane-width 3×68 heuristic.

## Authority records (equipment / document / spacing / fire / code)
- `lib/manufacturer-assets-db.ts` — §12 `evaluateDocumentApplicability` (SKU↔document product-
  version gate; RT-MINI vs RT-MINI II ⇒ unverified unless a verified alias record clears it).
- `lib/permit/snapshot/structuralAuthority.ts` — §14 canonical spacing-authority object
  (design spacing / maximum-verified spacing / source doc / roof zone / verification state).
- `lib/permit/utils/fireSetback.ts` — §15 `resolveFireSetbackBasis` (PROVISIONAL vs ADOPTED,
  keyed on AHJ + IFC edition verification; never "per AHJ" while unverified).

## Snapshot (types + build)
- `lib/permit/snapshot/types.ts` — §6 `ListedCableAssembly`/`QcableSegment`; §10 length taxonomy
  fields (geometric/calc/procurement + wasteFactor + lengthProvenance + verificationState);
  §16 `interconnectSide` on field labels; §12/§13 registry codes.
- `lib/permit/snapshot/build.ts` — populates the listed cable assembly + branch cable paths +
  length taxonomy + spacing authority + document-applicability state from the canonical engine.
- `lib/permit/snapshot/projectAuthority.ts` — issue-state carriage (unchanged semantics).

## Projection (read-only sheet accessors)
- `lib/permit/snapshot/electricalProjection.ts` — `projectE1PhysicalSchedule` (§1 sectioned
  E-1: BRANCH_RUN / BRANCH_HOMERUN_RUN / COMBINER_TO_DISCO_RUN / svc-tap-conductors, each with
  compliance state); `projectSharedBranchRaceway` / `projectRacewayDescriptor` (§2/§3 canonical
  raceway accessor, no `|| EMT`).
- `lib/permit/snapshot/complianceState.ts` — NEW §2 single shared tri-state result object
  (`evaluateCompliance` → PASS / FAIL / PENDING-REVIEW-REQUIRED; fail-closed on blank/NaN/pending).
- `lib/permit/snapshot/structuralProjection.ts` — §13 fastener authority sourced from the
  registry (`FASTENER-ASSEMBLY-UNVERIFIED`); §14 spacing projection.

## Renderer (sheet HTML)
- `lib/permit/sections/electricalPages.ts` — §1/§5 E-1 physical schedule + PV-4A option-B rating
  summary (no fabricated #12→combiner conductor); §4 PV-4A consumes the canonical registry
  multiset (`TAP-CONDUCTOR-LENGTH-PENDING` exact); §6 listed Q-Cable on PV-4B/E-1; §9 supply-side
  method SELECTED + install compliance PENDING (no bare COMPLIES); §10 per-cell length labels.
- `lib/permit/utils/sldAdapter.ts` + `lib/sld-professional-renderer.ts` — §1/§2 E-1 SVG shared
  home-run prints the canonical current-carrying inventory (`6#10 THWN-2`), never the OCPD-derived
  #12.
- `lib/drafting/sheetComposition.ts` — §3 `canonicalConduitType` (delete the renderer-local `'EMT'`
  default; route through the raceway accessor); §15 provisional fire-setback suffix.
- `lib/permit/sections/structuralPages.ts` — §8 remove the unbacked module DC wire+run row on a
  micro topology; §11 SCHED-3 pending-racking rows; §14 PV-3/PV-4C design-spacing + pending.
- `lib/permit/sections/compliancePages.ts` / `certPages.ts` — §13 fastener registry label; §14
  APP-A/PE-1 spacing; §17 basis split.
- `lib/permit/sections/coverSheet.ts` — §17 cover CALC BASIS vs AHJ-ADOPTED split; §19 ENGINEERING
  SUMMARY line-height recompaction (address-wrap headroom).
- `lib/permit/sections/arrayPages.ts` — §15 PV-1B provisional fire basis; §16 PV-5 topology labels.
- `lib/permit/sections/datasheetAppendix.ts` — §12 DS-3 non-authoritative marking; DS-4 omission
  while rail unpinned.
- `lib/permit/sections/reviewStatus.ts` — §18 RS-1 legibility (8.7px) + continuation scaffolding.
- `lib/permit/utils/titleBlock.ts` — snapshot-id / digest projection (report-equals-rendered).

## Field labels (topology)
- `lib/permit/utils/fieldLabels.ts` — §16 `selectFieldLabels` gates the back-fed-breaker and
  line-side-tap placards by `isSupply`; splits the merged 705.10/705.11/705.12 codeRefs so a
  load-side-only 705.12 clause never renders on a supply-side set.

## Blocker registry / severity policy / validator
- `lib/permit/snapshot/severityPolicy.ts` — §12/§13 register `EQUIPMENT-DOCUMENT-APPLICABILITY`
  and `FASTENER-ASSEMBLY-UNVERIFIED` as blocking (`validateSeverityPolicy()` self-consistent).

## Layout / geometry validator
- `lib/permit/generatePermit.ts` — §17 cover basis-split CSS; §19 cover-compact + cert-compact
  component-level recomposition (the live long-address wrap that clipped CONSTRUCTION NOTES ~10px
  and the CERT footer ~3px inside their hidden-overflow boxes — resolved at the component level,
  no global tolerance).
- `scripts/planset-pagefit.mjs` — §19 sub-sheet internal-clip scan (every hidden-overflow container
  vs its own non-SVG descendants, scale-invariant layout metrics) + `--json` report.

## Harness / artifacts (new)
- `scripts/planset-evidence-ep.mjs` — NEW: the 20 permanent EP rendered gates (both fixture + live
  modes); fails closed.
- `scripts/ep-artifacts.mjs` — NEW: EP-specific object-derived reports (length taxonomy, electrical
  cross-sheet matrix, racking candidate-vs-selected, document applicability, label topology).
- `scripts/closeout-artifacts.mjs` — extended for the EP snapshot fields.

## Tests
- `tests/planset/electrical-closeout-0723.test.ts` — WS-A §1–§5 rendered gates (E-1 sectioned
  schedule / tri-state / registry / SVG inventory).
- `tests/planset/ep-closeout-co-c.test.ts` — NEW: WS-C §11–§14 (racking taxonomy, document
  applicability, severity policy).
- `tests/planset/ep-closeout-wsd.test.ts` — NEW: WS-D §15–§17 (fire basis, label topology, code basis).
- `tests/planset/pagination-w9.test.ts` — §18/§19 RS-1 legibility + Chromium internal-clip assertion.
- `tests/planset/wave5b-sheets.test.ts`, `tests/planset/wave6-golden-hybrid.test.ts` — updated
  expectations for the new projections.
- `test-fixtures/golden/golden.json` — regenerated: WS-A adapter added `homerunConductorGauge` +
  `homerunCurrentCarryingCount` to `sld-input-roof` (the only two added keys; documented).

## Docs / evidence
- `docs/ELECTRICAL-PROCUREMENT-CLOSEOUT-DIRECTIVE.md`, `docs/EP-CLOSEOUT-ROOT-CAUSE-MAP.md` (AFTER
  column), `docs/EP-CLOSEOUT-CHANGED-FILES.md`.
- `docs/evidence/braidon-*.json` — regenerated object-derived artifacts (both original + live modes).

## Boundaries honored
Dev only; single commit; no HTML patching; no hand-edited evidence; no second engine; no
MFA/migration-governance changes; no auto-reconciling Braidon (live regen is read-only SELECTs);
all blockers preserved; framing-authority gate `903e14cd` unchanged (7 tests green).
