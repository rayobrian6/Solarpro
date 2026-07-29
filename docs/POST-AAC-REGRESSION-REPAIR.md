# POST-AAC REGRESSION REPAIR — root-cause report (2026-07-29)

Corrective pass over the regenerated live artifact
`PermitPackage-BRAIDON M PILLA — Solar TEST (10).html` (snapshot
`PDS-09C1A0EE7178`, generated from dev @ `c01e9293` + `a9d79203`). Seven
findings; every repair is at source (no generated-HTML patching), the
automation-authority architecture, the seven-gate model and the fail-closed
controls are untouched.

Evidence artifacts (this pass): `docs/evidence/post-aac-rr-registry-diff.json`
(the machine-produced 14-vs-15 diff), `post-aac-rr-live-regeneration-summary.json`
(three-profile live regeneration), `post-aac-rr-live-pagefit.json` (rendered
clipping report incl. the new sheet-specific gates, screen + print),
`post-aac-rr-document-registry-audit.json` (live `manufacturer_document_registry`
rows, verbatim).

---

## §1 — E-1 SLD severely clipped

**Root cause (three independent layers, all source-level):**
1. `pageSingleLineDiagram` had no `.page-content`: the SLD wrapper was a plain
   flex child of the fixed-height `.page` column with default `flex-shrink:1`.
   As the physical conductor/raceway schedule + ampacity chain + grounding note
   stacked beneath it, the wrapper flex-shrank to ~267px while the SVG kept its
   natural ~993px rendered height, was vertically centered, and the page's
   `overflow:hidden` severed most of the diagram
   (`lib/permit/sections/electricalPages.ts`, `.sld-page` CSS in
   `lib/permit/generatePermit.ts`).
2. The SLD canvas is a fixed 2304×1728 with an in-SVG CONDUIT & CONDUCTOR
   SCHEDULE band occupying its bottom ~25% (`lib/sld-professional-renderer.ts`)
   — a SECOND derivation of the same canonical section objects the HTML
   schedule renders, and an aspect ratio E-1's landscape drawing box can never
   fit without letterboxing.
3. The page-fit harness excludes ALL svg content as "intentional bleed" (a rule
   built for the PV-1 aerial sheets), so the clipped SLD passed every prior run.

**Fix:**
- E-1 is the dedicated SLD sheet again. The canonical physical section
  schedule, the full shared-raceway ampacity chain and the open-air branch
  grounding note render ONCE, on the new **PV-4B.1** sheet
  (`pageConductorScheduleCont`), immediately after PV-4B — never under the
  diagram, never duplicated between E-1 and the PV-4B family. PV-4B's compact
  same-object ampacity reference and PV-4A's keep their cross-labels
  (`SAME OBJECT AS PV-4B.1 / PV-4A`). Sheet manifest + page assembly gate
  PV-4B.1 through the ONE topology predicate (`hasPhysicalSectionSchedule`).
- Deterministic drawing viewport: `.sld-wrap { flex:1 1 auto; min-height:0 }`
  is always the full remaining page height; the SVG fills it via
  `width/height:100%` + `viewBox` + `preserveAspectRatio="xMidYMid meet"` —
  whole bounding box inside the wrapper, aspect preserved, nothing distorted.
- Embedded mode (`generateLiveSLD { embedded:true }`) now also sets
  `suppressScheduleBand`: the in-SVG schedule band is not emitted and the
  canvas is cropped (`viewBox 0 0 1994 1320`) — blank canvas removed at the
  generator, no drawing content hidden. The schematic, calc panels, callouts
  and legend all render; the legend now WRAPS long data-driven wiring-method
  labels (the old fixed box silently overflowed the listed Q-Cable label past
  the canvas — caught by the new harness gate, fixed at the legend renderer).
- Title-block reservation unchanged (`.sld-page` keeps the 1.72in right strip).

## §2 — PE-1 output-profile regression

**Root cause:** AAC WS-10 defined only `permit` / `full`. The artifact default
was `permit`, which drops the unsigned PE-1 — correct for a submittal, but the
route emitted it silently for a package still pending engineering review, and
no profile carried PE-1 as a review document.

**Fix (`lib/permit/plansetProfile.ts` + manifest + assembly + route):**
- Three explicit profiles: **DESIGN_REVIEW** (`design-review`) — the compact
  set ENDING on PE-1 as the final engineer-review sheet: pending-review
  language, `NO CERTIFICATION ASSERTED — NOT FOR PERMIT SUBMISSION`,
  project-specific structural results, blank engineer/signature/seal fields,
  digest-bound. **FULL_INTERNAL** (`full`) — unchanged: current PE-1 state +
  full registry/evidence. **PERMIT_SUBMISSION** (`permit`) — CERT/PE-1 only
  under a digest-bound approved `EngineeringReviewRecord`
  (`certificationIsCompleted`, engineer identity/license enforced by the
  migration-116 store + `certificationApproved`); while the review is pending
  the output is an explicitly-marked **NON-SUBMITTABLE PREVIEW**
  (`data-permit-submission-preview="1"`, "NON-SUBMITTABLE PREVIEW (ENGINEERING
  REVIEW PENDING)").
- The profile distinction is EXPLICIT on the artifact: the release-status
  block prints `OUTPUT PROFILE: …` and stamps
  `data-release-status-profile="<profile>"`.
- The permit ARTIFACT default is now `design-review`
  (`PERMIT_ARTIFACT_PROFILE`); the GET self-heal path pins the same default
  (it used to fall back to `full` — GET/POST profile parity).
- Nothing fabricates approval/signature/seal; the registry and requirement
  counts are byte-identical across all three profiles (tested).

## §3 — Manufacturer structural document accounting (audit)

Live registry rows verbatim in `post-aac-rr-document-registry-audit.json`:
- **Stamped structural letter EXISTS in the live registry**:
  `doc-rooftech-rtmini2-pe-letter-73a74973091c`, class `structural_pe_letter`,
  product/version **RT-MINI II** (ASCE 7-16, Starling Madison Lofquist),
  sha256 `73a74973091ca698…3535c27`, status `current`, verification_state
  **`unverified`** (awaiting Ray's verify-click), `extracted_claims` **NULL**.
  The 613.2 lb ASD figure exists as PROSE in the row's notes and in
  `mounting-hardware-db` provenance (stored allowable = rounded 600 lb) — it is
  NOT a machine-extracted claim yet, so `pickVerifiedDocument`'s
  `requireStructuralCapacity` gate cannot cite it even after verification until
  claims are extracted.
- **It is included in NO output profile.** There is no code path from
  `manufacturer_document_registry` into package pages — DS-n pages come only
  from the static `MANUFACTURER_ASSETS` image table. Only the RT-MINI II
  installation-manual page image is appended (DS-3), explicitly bannered
  `applicability to selected RT-MINI is unverified`
  (EQUIPMENT-DOCUMENT-APPLICABILITY). That banner is CORRECT and retained: the
  letter covers RT-MINI II, the selected mount is RT-MINI, and no manufacturer
  cross-reference exists — nothing may append the letter as authoritative until
  Ray confirms applicability or switches the selection.
- **The closure's "fetched, hashed and archived" claim is substantively true
  but its run recorded an archival FAILURE**: the aac6 evidence shows both
  archival attempts dying on `23505 duplicate key` — the rows already existed
  from a prior run, and the resolver treated already-archived as failure with a
  misleading "run migration 113" operator action. Fixed:
  `rackingDocumentRetrievalResolver` now checks `getDocument(docId)` first
  (content-derived id) and treats already-archived-with-matching-hash as
  archival success; `ARCHIVE_FAILURE_ACTION` names its failure class.
- Also fixed in the same accounting class: `projectFastenerAssembly` still
  carried the `capacityGated` echo AAC WS-8 deleted from the blocker emission,
  so PV-5's general note printed `WITHHELD — FASTENER-ASSEMBLY-UNVERIFIED (see
  RS-1)` while the registry (correctly) contained no such requirement — a
  rendered reference to a nonexistent registry row. ONE predicate now (element
  verified + source document, independent of the rail-capacity document);
  PV-3's fastener status line is state-derived
  (`VERIFIED — EXACT INSTALLATION INSTRUCTIONS PENDING DOCUMENT/SKU AUTHORITY`)
  and exact installation instructions stay gated on the unchanged five-condition
  authority (document applicability, SKU, hash-binding, digest).

## §4 — 14-vs-15 requirement count

**Machine diff:** `docs/evidence/post-aac-rr-registry-diff.json` — 15 rows,
one per requirement, with gate / closure-run status / artifact status /
regeneration status / resolver / evidence. Result: the live set = the closure
run's 14 **plus exactly `PROJECT-NAME-NONPRODUCTION`** (gate RG-1, already
open, so gates stay 6). The closure headline (6/14) was measured against the
RENAMED `projects.name` ("… — Solar"); the artifact was generated from the
POSTED input whose `projectName` is still "… — Solar TEST" (printed on its own
title block), which the `\bTEST\b` detector correctly flags. Not an engine
defect — the closure REPORT's number was conditional on the rename and did not
say so crisply. Clears when Ray regenerates from the app with the renamed
project. Regression-pinned by test (§4 of
`tests/planset/post-aac-regression-repair.test.ts`).

## §5 — Seismic B-vs-D

**Root cause (the field-name-mismatch disease class, four layers):**
1. The API route seeded `project.seismicCategory` from the unprovenanced
   curated `ahj-national` row ('B') — the ONE hazard field of the three whose
   retrieval override was never wired.
2. The resolver write-back wrote `p.seismicDesignCategory` — a field nothing in
   production reads (the cover reads `seismicCategory`) — and fill-if-empty, so
   it lost to the table seed even if the name had matched. (A green test
   asserted the dead write.)
3. On regeneration the archived climate-hazard document DEFERS live retrieval
   (`climate-hazard-document@v1` → SKIPPED/cleared), so no
   `EnvironmentalRetrievalRecord` exists — and the archived-evidence contract
   (`EnvironmentalLoadSourceEvidence`) carried NO seismic fields, so the 'D'
   the closure retrieved never reached the regeneration.
4. `canonical.ts` hardcoded `|| 'D'` while the fixtures carry `'B'` — two
   invented defaults feeding different sheets.

**Fix — ONE canonical resolved seismic result (`resolveSeismicAuthority`,
`lib/permit/snapshot/environmentalAuthority.ts`):** hazard-retrieval record
wins; else a VERIFIED + archived + hash-bound climate-hazard document carrying
seismic claims (the evidence type + both adapters now carry
SDC/Ss/S1/site-class; the registry adapter reads both the `environmental` and
archived `values` claim bags); else **NOT ESTABLISHED — nothing substitutes
'B' or 'D'** (table seed deleted at the route; `|| 'D'` deleted; the resolver
write-back now writes the field the sheets read, unconditionally, like
wind/snow). When established, the ONE value stamps every surface (canonical →
structural engine, `project.seismicCategory` → cover,
`compliance.structural.seismic.sdc` → CERT/PE-1) with a machine-readable
source stamp (`data-seismic-source`/`-source-ref`); unresolved prints
`PENDING — NOT ESTABLISHED`. The wind/snow verification gate and the
environmental requirement are UNCHANGED (seismic coverage never clears or
blocks it).

**Live result:** the cover now prints **SEISMIC DESIGN CAT. CAT. D** sourced
`archived-climate-document` `cedb14f7-917a-539b-a68a-f08f08b64d13`
(sha256 `cedb14f7917ad39b…`, USGS asce7-22 designmaps @ site class D, Ss 0.61,
S1 0.18) — the same document whose extracted claims the closure's retrieval
archived. The closure report was RIGHT about the data and WRONG that the
correction had propagated: it never reached any rendered surface.

## §6 — PV-4C clipping

**Root cause:** the §8 reaction-reconciliation block was the last
data-dependent stack on PV-4C; the live design renders one more distinct
load-case group than the frozen fixture, pushing the continuation strip 26.4px
past the `page-content` clip box. The closure documented-but-did-not-fix it to
preserve full-profile byte-identity with an old baseline — a constraint this
pass retires.

**Fix:** the reconciliation renders DETERMINISTICALLY on PV-4C.1 (with the
load-combination/conclusion material that already continues there);
`renderReactionSchedule` cross-references it and the continuation strip names
it. PV-4C's fit margin no longer depends on the data-driven group count. Live:
strip fully visible, `contentClipY=0`, screen + print.

## §7 — page count

Not a target. Live results: design-review 16 pages (compact set + PV-4B.1 +
PE-1 final), permit preview 15, full 26. Content and profile rules drive the
count.

---

## Harness + tests added

- `scripts/planset-pagefit.mjs` — sheet-specific gates (screen AND print
  media): E-1 `.sld-wrap` no hidden overflow, svg bounding box inside the
  wrapper, valid viewBox/preserveAspectRatio, contain-fit fills an axis (no
  letterboxed strip), svg content bbox inside the viewBox (nothing cropped by
  the canvas), SLD landmarks present (LEGEND/UTILITY/GROUNDING); PV-4C
  continuation strip fully visible + zero content clip. The blanket
  svg-as-bleed exclusion stays ONLY for the map sheets and is now documented as
  such. Exit non-zero on any failure.
- `tests/planset/post-aac-regression-repair.test.ts` — 21 tests: §1 E-1/PV-4B.1
  composition + single-rendering; §2 profile sheet matrices (design-review ends
  on PE-1; permit pending = marked preview without PE-1; permit approved
  manifest carries CERT/PE-1; digest-equality predicate; registry identical
  across profiles; profile printed); §3 RT-MINI II cannot satisfy RT-MINI +
  appendix-index/emitted-page parity + no registry-only inclusion claims;
  §4 PROJECT-NAME-NONPRODUCTION ±1-at-constant-gates; §5 seismic resolution
  precedence + fail-closed branches + one-value propagation + no substitution.
- Harness staleness fixed (proven pre-existing at HEAD via a clean-baseline
  worktree run): `planset-evidence-rp.mjs` page-split missed the
  cover/cert-compact pages (23-vs-25 on every run), its RS-1 anchor predated
  the RGM gate-led sheet, and its gate 2 false-positived on the honest
  "(not field-verified" phrasing. `planset-evidence-bar.mjs` gate 8 +
  `planset-evidence-ppc.mjs` gate 5 updated to the WS-8-aligned fastener
  predicate (gate 5 gains the instructions-gated second arm so it never goes
  vacuous). E-1 slicing in `planset-evidence-ep.mjs` /
  `planset-evidence-bar-wse.mjs` retargeted to the svg itself.

## Validation (all run, actual results)

1. Targeted E-1 layout tests — in the new suite + harness E-1 gates: PASS.
2. Rendered clipping harness — fixture design-review 16 sheets, live
   design-review 16 sheets, full 25/26 sheets: 0 clipped, 0 internal-clipped,
   0 horizontal, 0 sheet-specific fails (screen + print).
3. Profile sheet-list tests — PASS (21/21 new suite;
   `aac-ws10-planset-profile` intact).
4. PE-1 state tests — PASS.
5. Environmental propagation tests — PASS (unit + rendered).
6. Manufacturer-document inclusion tests — PASS.
7. Gate/requirement count reconciliation — machine diff artifact + §4 test:
   PASS.
8. `npx tsc --noEmit` — clean.
9. Planset suite — **1318 passed / 0 failed** (89+1 files).
10. Harness suites — RGM 17/17 ×3 modes · EP 22/22 (chained bar-wse 40/40) ·
    BAR 14/14 · CO 20/20 · PPC 18/18 · ECD 24/24 + anti-vacuity ×3 modes ·
    W3.1 exit 0 · W4 15/15 · RP 20/20 · base evidence 14/14.
11. `npm run build` — production build succeeds.
12. Live Braidon regeneration (stored posted input + ONE live resolver
    lifecycle, route-faithful) — summary artifact; 6 gates / 15 reqs (the name
    row), seismic D from the verified archived document, all three profiles.
13. Screen render inspection — per-sheet PNGs (before/after) reviewed.
14. Print/PDF media pass — harness gates re-run under print emulation: PASS.
15. Full repo suite — 378 files passed; the only failures are the 4 KNOWN
    pre-existing local-Windows files (migration-governance fs ×2 quarantine
    class, weekStart tz, metadata/ocrRuntimeAdapter spawnSync) — the exact
    documented baseline set.

## Operator notes (Ray)

- Migrations 115/116: **confirmed applied in production** (ledger 2026-07-29
  00:33/00:34Z); `personnel_roles` and `engineering_review_records` exist with
  0 rows — designer assignment and the digest-bound review remain the open
  actions.
- The two Roof Tech registry documents still await your verify-click; the
  RT-MINI vs RT-MINI II applicability confirmation (or a mount reselection) is
  unchanged.
- Regenerating from the app after the project rename drops
  PROJECT-NAME-NONPRODUCTION → 6 gates / 14 requirements.
- The stored posted input still carries the old "… Solar TEST" name; the next
  in-app generation replaces it.
