# SolarPro Upgrade Roadmap — Starting v47.399
**Owner:** Ray
**Scope:** Equipment database health, ecosystem coverage, new brands
**Guiding principles:**
1. Every stage is small enough to fit in one commit.
2. Every stage is independently shippable — if we stop after any stage, the app still works.
3. No stage deletes existing equipment rows that are referenced by brand profiles, BOM, or proposals.
4. No fabrication — if I can't verify a datasheet URL or real spec, the entry doesn't get added.
5. Every stage ends with: build passes → deploy → you see the change live → we move on.

---

## Stage 0 — Baseline Truth Report (READ-ONLY)
**Goal:** Know exactly what we have before we touch anything.
**Risk:** Zero. No code changes.
**Version bump:** None.
**Commit:** No (local artifact only until we decide to ship the report).

**Deliverables:**
- `docs/equipment-inventory-v47.399.csv` — every row from every DB file
- `docs/equipment-inventory-v47.399.md` — human-readable summary:
  - Row counts per file
  - Datasheet coverage % per manufacturer
  - Duplicates across files (same model ID in 2+ places)
  - Orphan rows (defined in DB but never imported anywhere)
  - Manufacturer list — what's already in, what's missing

**Exit criteria:** You read the summary, we agree on what stages 2–6 should actually touch.

---

## Stage 1 — Add Sol-Ark (ONE brand, fully verified)
**Goal:** Prove the "add a brand cleanly" pattern with a brand you specifically called out.
**Risk:** Low. Pure additive — no existing rows touched.
**Version bump:** v47.399.
**Commit:** Yes.

**Scope:**
- Add 3–4 Sol-Ark hybrid inverter rows to `equipment-db.ts` with real datasheet URLs:
  - Sol-Ark 8K
  - Sol-Ark 12K
  - Sol-Ark 15K
  - Sol-Ark 30K (if verifiable)
- Tag each with `ecosystemBrand: 'Sol-Ark'`.
- Create `lib/system/brandProfiles/solArk.ts` brand profile.
- Register in brand profile index.
- Validate: Sol-Ark appears as a chip in the EcosystemPicker on the engineering page.

**Exit criteria:** You open engineering page, see Sol-Ark chip, click it, see the inverter options, apply works.

---

## Stage 2 — Tag the 16 Untagged Inverters
**Goal:** Close the ecosystem coverage gap my audit already found.
**Risk:** Low. Metadata-only update on existing rows.
**Version bump:** v47.400.
**Commit:** Yes.

**Scope:** Add `ecosystemBrand` to:
- EcoFlow — 3 inverters
- Fronius — 4 inverters
- Sungrow — 4 inverters
- SMA — 3 inverters
- GoodWe — 2 inverters

**Exit criteria:** EcosystemPicker now shows 11 brand chips instead of 6. Audit script reports 0 untagged inverters for brands that have profiles.

---

## Stage 3 — Datasheet URL Backfill Pass 1 (Tier-1 brands only)
**Goal:** Get verified datasheet URLs on the top brands first, leave fringe brands for later.
**Risk:** Low. Only adds/corrects the `datasheetUrl` field.
**Version bump:** v47.401.
**Commit:** Yes.

**Scope:** For these brands, every row gets a verified datasheet URL:
- Tesla, Enphase, SolarEdge, Generac, APsystems, Hoymiles (the 6 already in EcosystemPicker)
- Sol-Ark (added in Stage 1)

**Process:**
1. For each row missing `datasheetUrl`, I search the manufacturer site.
2. I `curl -I` the URL to confirm it returns 200.
3. If no verifiable URL found, I leave the field empty and flag it in the report — NEVER fabricate.

**Exit criteria:** Tier-1 brands show ≥95% datasheet coverage. Report lists any gaps with reason.

---

## Stage 4 — Datasheet URL Backfill Pass 2 (Tier-2 brands)
**Goal:** Same as Stage 3, for the newly-tagged brands.
**Risk:** Low. Same mechanism as Stage 3.
**Version bump:** v47.402.
**Commit:** Yes.

**Scope:**
- EcoFlow, Fronius, Sungrow, SMA, GoodWe
- Any manufacturer that appears in brand profiles but has <50% datasheet coverage

**Exit criteria:** All brands referenced by any brand profile show ≥90% datasheet coverage.

---

## Stage 5 — Add Remaining Requested Brands
**Goal:** Fill out the catalog with the brands you asked for, one at a time.
**Risk:** Low. Pure additive.
**Version bump:** v47.403, v47.404, v47.405… one per brand.
**Commit:** One per brand.

**Order (each is its own mini-release):**
1. Growatt (hybrid inverters)
2. Solis (hybrid inverters)
3. Schneider Electric (XW Pro, Conext)
4. Victron Energy (MultiPlus, Quattro)
5. OutBack Power (Radian, SkyBox)

**Rules per brand:**
- Every row has a verified `datasheetUrl`. No exceptions.
- Brand profile created in `lib/system/brandProfiles/`.
- Brand registered in the profile index.
- Brand appears in EcosystemPicker.
- Build passes, deploy succeeds, chip visible before moving to next brand.

**Exit criteria:** All 5 brands visible in EcosystemPicker. Each one kit-buildable.

---

## Stage 6 — Racking/Mounting Surface-Up
**Goal:** Make the racking brands we already have (K2, IronRidge, Unirac, etc.) visible in the UI.
**Risk:** Low-Medium. Touches UI but not core equipment rows.
**Version bump:** v47.406.
**Commit:** Yes.

**Scope:**
- Audit `racking-database.ts` and `mounting-hardware-db.ts` — what rows are there, what's imported where.
- Either:
  - (a) Add a "Racking" section to EcosystemPicker, OR
  - (b) Add a racking dropdown to the engineering page Config tab.
  - (Decision made based on Stage 0 inventory.)

**Exit criteria:** You can see and select a racking brand on the engineering page.

---

## Stage 7 — Consolidation Assessment (READ-ONLY)
**Goal:** Decide if DB consolidation is actually worth the risk.
**Risk:** Zero. Report only.
**Version bump:** None.

**Scope:**
- For each secondary DB file (`mounting-hardware-db.ts`, `racking-database.ts`, `equipment-registry-v4.ts`, `equipment-registry.ts`, `equipment-extras.ts`):
  - List every import site in the codebase
  - Count referenced vs. unreferenced rows
  - Propose: KEEP / MERGE / DEPRECATE

**Exit criteria:** You get a written recommendation. We choose what Stage 8 actually does.

---

## Stage 8 — Consolidation Execution (CONDITIONAL)
**Goal:** Only if Stage 7 says it's worth doing.
**Risk:** Medium. Touches import sites.
**Version bump:** v47.407+.

**Process (if we proceed):**
- One DB file merged at a time.
- Old file becomes a re-export shim for one release cycle (nothing breaks).
- After one clean release, shim is removed.

**Exit criteria:** Equipment lives in fewer files, with no broken imports and no lost data.

---

## Stage 9 — Cleanup + Documentation
**Goal:** Lock it in.
**Risk:** Zero.
**Version bump:** v47.410.
**Commit:** Yes.

**Scope:**
- Write `docs/equipment-db-guide.md` — how to add a new row, how to add a new brand, where the source of truth lives.
- Remove dead code flagged across earlier stages.
- Final audit: every brand profile's `supportedInverterModels` resolves to real rows; every ecosystem-tagged row is reachable from a brand profile.

**Exit criteria:** Audit shows 0 mismatches across the board.

---

## Cross-cutting rules for every stage

1. **Pre-flight:** `npx tsc --noEmit` passes.
2. **Post-flight:** `npm run build` passes locally before push.
3. **Every push:** Wait for Vercel "Ready" + verify BUILD badge updated in UI before calling the stage done.
4. **If anything breaks:** Revert that stage's commit, don't pile fixes on top.
5. **Fabrication check:** Before any new row lands, I must show you the datasheet URL source. If I can't, the row doesn't land.
6. **I do not move to stage N+1 without your sign-off on stage N.**

---

## Where we are right now

- [x] Stage 0 planning (this document)
- [x] Stage 0 execution — inventory complete (234 rows, 62 manufacturers, 163 missing datasheet URLs, 36 duplicate IDs across files). CSV: `docs/equipment-inventory-v47.399.csv`.
- [x] Stage 1 — Sol-Ark ✓ `v47.399` commit `026a662`
      4 verified inverter rows + brand profile + ECOSYSTEM_BRANDS registration.
- [x] Stage 2 — Tagged 13 inverters (EcoFlow/Fronius/Sungrow/SMA/GoodWe) ✓ `v47.399` commit `026a662`
      EcosystemPicker now shows 11 brand chips (was 6).
- [~] Stage 3 — Datasheet backfill Tier-1 (in progress)
      - [x] Stage 3A — Tesla/Enphase/SolarEdge/APsystems/Hoymiles ✓ `v47.400`
            17/18 URLs verified and applied. 1 SKIP: solaredge-monitoring-gateway (no verifiable source).
            Coverage: 71/234 → 92/238 rows with datasheetUrl.
      - [x] HOTFIX v47.401 — Tesla (battery-only) Apply button fix.
            Bug: Apply was disabled when brand had no inverter in kit. Tesla/Generac both affected.
            Fix: Apply enables for battery-only ecosystems when any non-inverter component is selected.
            Hint banner added. No pipeline changes. Parent handler already preserved existing inverter.
      - [x] Stage 3B — Generac (11 rows: Guardian generators + PWRcell + ATS) ✓ `v47.402`
            8 unique URLs verified HTTP 200, Option A approved (includes 2 install/owner manuals as fallback).
            Coverage: 92/238 → 103/238 rows with datasheetUrl.
- [~] Stage 4 — Datasheet backfill Tier-2 (in progress)
      **Audit finding:** All 16 pre-existing Tier-2 datasheetUrl values were HTTP 404 product pages, not verified PDFs.
      - [x] Stage 4A — Fronius Primo (4) + SMA Sunny Boy 5.0/7.7 (2) ✓ `v47.403`
            6 URL replacements with verified manufacturer PDFs.
            Fronius: shared `fronius.com/~/downloads/.../SE_DS_Fronius_Primo_UL_EN_CA.pdf` (309KB, covers 3.8-11.4).
            SMA: shared `files.sma.de/downloads/SBxx-US-DS-en-41.pdf` (673KB, covers 3.0-7.7).
      - [x] Stage 4B-1 / 4C — Sungrow + EcoFlow deactivation + GoodWe/SMA10 fixes ✓ `v47.404`
            **Full DB audit finding (89 rows with datasheetUrl):** 37 verified PDFs,
            18 HTML pages (product pages), 34 hard-broken URLs.
            This release: 3 URL fixes (goodwe-gw5000-ns, goodwe-gw10k-ms, sma-sb-10.0)
            + 7 deactivations (4 Sungrow SG-RS, 3 EcoFlow PowerOcean — both have no US catalog).
            `active: false` is metadata-only for now (no runtime filtering yet — flagged as follow-up).
      - [x] Stage 4B-2 — SolarEdge x10 + Hoymiles x2 = 12 rows ✓ `v47.405`
            11 URL fixes: 5 HD-Wave inverters → nwsolar.com distributor PDF (1.25MB);
            5 P-series optimizers → Krannich Solar IND distributor PDF.
            1 Hoymiles HMS-800W-2T → CED Electrical Supply official HMS-2T-NA PDF (content verified via pdftotext).
            1 deactivation: hoymiles-hm800 (EU-only balcony product, no US distributor).
            Verified PDFs: 37 → 51. Broken URLs: 34 → 12.
      - [x] Stage 4B-3 — Panels x7 + Racking x4 + misc cleanup ✓ `v47.406` ⭐ **STAGE 4 COMPLETE**
            11 URL fixes: all verified HTTP 200 application/pdf manufacturer or distributor PDFs.
            Panels: SunPower Maxeon 6/7, Jinko (US SKU is Eagle 72, not Tiger Neo), REC Alpha Pure 2 US,
                    Canadian Solar HiKu7 CS7L-MS, Silfab SIL-430-QD (Krannich), Qcells Peak Duo (CED).
            Racking: Unirac SolarMount (direct), SnapNrack 100 (CED), Roof Tech Mini II (direct),
                    QuickMount Classic (IronRidge — successor company).
            1 deactivation: panel-fence-ps1 (philadelphiasolar.com unreachable).
            **FINAL AUDIT: 0 broken URLs, 62 verified PDFs, 18 HTML pages remaining.**

**Stage 4 final tally:**
- Started: 37 verified PDFs, 34 broken URLs
- Finished: 62 verified PDFs, 0 broken URLs (+25 verified, -34 broken)
- 9 rows deactivated (no US market): 4 Sungrow, 3 EcoFlow, 1 Hoymiles HM-800, 1 Philadelphia Solar
- 18 HTML responses remain (product pages, not PDFs) — scheduled for incremental cleanup during Stage 5+
- [~] Stage 5 — Growatt (v47.420) / Solis + Tesla + Tigo (v47.426) shipped; Schneider / Victron / OutBack deferred (user pivoted to Stage 6 after v47.426 batch)
- [x] Stage 6 — Racking visibility (shipped v47.429 — Racking Ecosystem Smoke Suite + compatibleRacking in EcosystemPicker + 174 CI-blocking tests)
- [x] Stage 7 — Consolidation assessment (shipped v47.431 — docs/STAGE7_CONSOLIDATION_ASSESSMENT.md. Recommends Stage 8.1 BOM dead-code deletion -2,228 lines + Stage 8.2 drift-fence CI tests; defer 8.3/8.4)
- [~] Stage 8 — Consolidation execution: **8.1 shipped v47.432** (BOM dead-code deletion: 7 files / -3,278 lines, 0 API changes), **8.2 shipped v47.432** (drift-fence CI tests: rackingDatabaseDriftGuard +45 tests, brandProfileDriftGuard +228 tests with overridesEquipmentDb opt-out). **8.4 shipped v47.433** (brand-profile centralization: 6 drift corrections across 4 profiles — SMA SB-7.7 mpptCount 2→3, SMA SB-10.0 maxParallel 1→6, GoodWe GW10K-MS 10/15/2→9.6/14.4/3, Sungrow SG15RS maxParallel 1→2, SolarEdge generic-string SE-7600H/SE-10000H mpptCount 2→1; all 6 overridesEquipmentDb flags removed; drift-guard audit log now reports zero overrides). **8.3 deferred** (racking unification).
- [~] Stage 9 — Survey app integration + cleanup: **9.1 shipped v47.434** (survey ingest schema + HMAC verifier + admin webhook log: migration 011 adds projects.origin/survey_external_id/survey_meta + webhook_deliveries table; POST /api/webhooks/survey-complete verifies HMAC-SHA256 + logs every delivery + returns 501 INGEST_NOT_IMPLEMENTED; GET /api/admin/survey-webhook-log + POST replay stub; contract frozen at schemaVersion '1.0' with thin-event default; +26 tests: 18 HMAC + 8 contract drift-guard). **9.2 shipped v47.435** — ingest pipeline skeleton: `runIngestPipeline()` wired into POST `/api/webhooks/survey-complete`; 202 `INGEST_OK` on project upsert success or 202 `INGEST_FAILED_BUT_LOGGED` on pipeline error; 4 new modules in `lib/survey/ingest/`; +91 tests; 2291/2291 pass. **9.2b–9.4 pending** (handoff JWT minter, photos/notes async fetch worker, drift-guard doc + replay impl).

**Next action:** Stage 4B-3 (v47.406) — Panels (SunPower/Jinko/REC/CS/Silfab/Qcells) + Racking (Unirac/SnapNrack/Roof-Tech/QuickMount) + misc. Final broken-URL cleanup before Stage 5.

---

### 🔧 Inter-stage hotfix: v47.407 — Compliance Tab MPPT Allocation Message Honesty

**Filed from user-reported production screenshot** (`docs/v47.407-compliance-bug-notes.md`).

**Bug:** Compliance tab showed misleading remedy text when an infeasible inverter
was user-selected:
- `MPPT_ALLOCATION_INVALID` message suggested `"(c) increase string count using shorter strings (lower current per string)"` — factually wrong. Per-string design current = panel Isc × 1.25 is a **panel-level property**, independent of string length.
- A contradictory `"DC/AC ratio 0.95. System may be undersized. Add panels"` warning fired simultaneously with the "too many strings, 2 unplaced" error. Add-panels vs. remove-panels advice at the same time.

**Root cause (diagnosis preserved for reference):**
The compliance tab code path (`POST /api/engineering/calculate` → `generateStringConfig`) does NOT run through `sizeInverters` / `applyFeasibilityHardGate`. The hard gate runs **only** during the UI sizing recommendation. When the user has edited inverter selection (`userHasEditedInverters === true`), auto-apply is disabled by design — so an infeasible user selection reaches the allocator unchanged and produces honest-but-confusing errors.

**Scope (Option A + C):**

- **C (audit):** Verified all panels in `equipment-db.ts` have complete `isc` + `tempCoeffVoc` — no missing specs. The hard gate is not being silently skipped due to data gaps. Verified the screenshot's panel was **`qcells-peak-duo-400`** (Isc=12.26A → design=15.32A ≈ 15.3A in the UI).
- **A-1:** `lib/system/mpptAllocator.ts` — `MPPT_ALLOCATION_INVALID` message rewritten:
  - Removed "(c) shorter strings" (factually wrong).
  - Added capacity clause: `"Required X.XA total design current vs. Y.YA total channel capacity (N ch × Z.ZA)"`.
  - New remedies: (a) accept the Sizing Recommendation panel's inverter, (b) add a second inverter unit (with computed minimum channel count), (c) switch to a panel with lower Isc.
- **A-2:** `lib/system/string-generator.ts` — DC/AC ratio warnings ("recommended min 1.0", "recommended max 1.5") now suppressed when `MPPT_CURRENT_EXCEEDED` or `MPPT_ALLOCATION_INVALID` is present. Eliminates contradictory advice.

**Tests added:**
- `lib/system/mpptAllocator.test.ts` — 2 new tests (506/506 total, +2).
  1. 4×15.3A-on-2×15A scenario: verifies the capacity clause, absence of "shorter strings", presence of Sizing Recommendation pointer, remedies (a)(b)(c), "lower Isc".
  2. 6×18A-on-2×20A scaling: verifies `minChannelsAtCurrentRating` math emits "6 channels total".

**Deferred follow-up (out of scope):**
The deeper architectural gap remains: users who ignore the Sizing Recommendation panel and manually pick an infeasible inverter still get errors (now with honest messages, but no auto-substitution in the compliance path). Future work: wire `applyFeasibilityHardGate` (or a read-only variant) into the `/api/engineering/calculate` code path so the compliance tab can surface "recommended alternative: X" inline in the error. Tracked separately from Stage 5.---

### 🔧 Inter-stage hotfix: v47.408 — Topology-Aware String Current + Layout-Drift Warning

**Filed after v47.407 user feedback:** "I am still seeing the error." v47.407 fixed the **messages**, but the underlying MPPT_CURRENT_EXCEEDED was a legitimate math bug — the string-generator applied `Isc × 1.25` to SolarEdge HD-Wave (optimizer topology) where string current is actually capped by the optimizer output.

**User warning acknowledged:** *"Just to be aware this will hit any inverter utilizing optimizers!!"*

**True root cause:**
`lib/string-generator.ts` computed `designCurrentPerString = iscCorrected × 1.25` (NEC 690.8(A)(1) panel method) for ALL non-micro topologies. For **optimizer systems** (SolarEdge HD-Wave + P-series, Tigo TS4) the string conductor carries the optimizer's **regulated output current** (NEC 690.8(A)(2)), capped at ~15.0 A for all shipping SolarEdge P-series + Tigo TS4-A-O SKUs — panel Isc is irrelevant upstream of the optimizer output. Qcells Q.Peak Duo 400 W (Isc=12.26 A → panel method = 15.32 A ≈ 15.3 A) exceeded a 2×20 A SolarEdge MPPT budget in the user's screenshot; the optimizer method would have correctly reported 15.0 A per string.

**Scope — user directive:**
> *"Clicking Auto-Apply is just a diagnostic — but we need both fixes. Proceed with v47.408 including: topology-aware current for optimizer systems, UI warning when config layout ≠ sizing recommendation. Do not auto-sync config yet."*

**Fix 1 — Topology-aware string current (2 files):**

- `lib/string-generator.ts` — Extended `StringGeneratorInput` with optional `topology?: 'string' | 'optimizer' | 'hybrid'` and `optimizerMaxOutputCurrent?: number`. When `topology === 'optimizer'`, `designCurrentPerString = optimizerCap` (default 15.0 A, overridable). When `'string'` / `'hybrid'` / undefined (backwards-compat default), keeps legacy `iscCorrected × 1.25`.
- `app/api/engineering/calculate/route.ts` — Detects `topologyFamily` from `firstInv.type` (`'optimizer' | 'hybrid' | 'string'`) and passes through `optimizerMaxOutputCurrent` when supplied by the client. SolarEdge brand profile sets `inverterType: 'optimizer'` on all SE models so this wires up automatically for existing users.

**Fix 2 — Layout-drift warning (1 file):**

- `components/engineering/SizingRecommendation.tsx` — Added a dedicated prominent rose banner that fires whenever `diff.stringLayoutMismatch === true`. Copy: *"Current strings: X/Y/Z → Recommended: A/B/C. Compliance & electrical calculations below evaluate the CURRENT layout — not the recommendation — so any MPPT / current / DC-AC warnings may reflect the stale config rather than a real design issue."* Adds an optimizer-specific clarifier *("string current is regulated by the optimizer output (not panel Isc)")* for optimizer topology, micro-specific copy for micro topology. Independent of the smaller "Differences from recommended" diff table below. **No auto-sync** (per user directive).

**Tests added:**
- `lib/string-generator.test.ts` — 5 new tests using a high-Isc separating geometry (17.0 A panel + 20 A MPPT channel) that cleanly distinguishes the two NEC methods:
  1. `'optimizer'` topology with default 15 A cap → passes allocation.
  2. `'string'` topology same geometry → fails with `21.3A` per string (confirms panel method).
  3. topology omitted → defaults to string (backwards-compat guard).
  4. Custom `optimizerMaxOutputCurrent: 10.5` honored.
  5. `'hybrid'` topology falls through to string semantics (hybrid ≠ optimizer).
- Full suite: **511/511 pass** (+5). TC=0, build clean.

**Coverage of optimizer inventory:**
- SolarEdge P-series (P320/P401/P505/P730/P850) — all 15.0 A max output → default cap covers all.
- Tigo TS4-A-O — 15.0 A max → default cap covers.
- Tigo TS4-A-2O — 30.0 A dual-module → requires `optimizerMaxOutputCurrent: 30` in client payload (future UI work).

**Deferred follow-up:**
- Per-optimizer SKU selection in System Config UI (currently topology = 'optimizer' always uses 15.0 A default, which is correct for all single-module SKUs).
- The deeper architectural gap from v47.407 remains: `/api/engineering/calculate` still doesn't run `applyFeasibilityHardGate`. Tracked separately.

**Next:** Return to **Stage 5 — Growatt** brand addition.---

### 🔧 Inter-stage hotfix: v47.409 — Optimizer-System Merge Hint (Compliance Tab)

**Filed after v47.408 deployed.** User confirmed v47.408 was working (error now correctly reports **15.0 A / 60.0 A** per optimizer cap, not 15.3 A / 61.2 A per panel method) but the current layout was genuinely infeasible: 4 strings × 15 A = 60 A vs. 2 MPPT × 20 A = 40 A capacity.

**User directive:**
> *"Go C, but keep it small: no auto-apply, no auto-collapse. Add an optimizer-specific merge suggestion in compliance and keep the existing apply/layout-drift banner. Reuse the sizing recommendation if available rather than building separate merge logic."*

**Fix (3 files, pure advisory):**

- **NEW** `lib/system/optimizerMergeHint.ts` — Pure helper `composeOptimizerMergeHint()` that gates on
  `topology === 'optimizer' && hasCurrentExceeded && recommendedStringPanelCounts.length < currentStringPanelCounts.length`,
  then composes a plain-English advisory. Filters invalid entries from client input before gating. Returns `null` when preconditions aren't met.
- `app/api/engineering/calculate/route.ts` — After `generateStringConfig`, calls the helper with allocator state + optimizer cap + client-sent `recommendedLayout`, appends non-null result to `stringConfig.warnings`. No separate sizing engine call on the compliance path.
- `app/engineering/page.tsx` — `buildCalcPayload` now forwards `sizingRecommendation.strings` as `recommendedLayout { topology, stringPanelCounts }` in the calc API payload. `sizingRecommendation` added to `useCallback` deps.

**No UI changes.** Existing compliance-tab warning rendering (amber row above red errors) picks up the new hint automatically.

**Message shape** (production scenario, 10/10/10/6 → 18/18 @ 15 A cap):
```
OPTIMIZER_LAYOUT_SUGGEST_MERGE: Current layout 10/10/10/6 draws 60.0A
across 4 strings, but only 40.0A of MPPT capacity is available. The
Sizing Recommendation panel above suggests 18/18 (2 longer strings × 15.0A
= 30.0A) which fits the existing hardware. Click "Apply Recommended
Configuration" above to sync — string length does not change per-string
current on optimizer systems (each optimizer caps output at 15.0A
regardless of string length), so the only way to reduce total current
is to reduce the string count.
```

**Tests — 20 new in `lib/system/optimizerMergeHint.test.ts`:**
- Gating decision tree: string/hybrid/non-exceeded/no-rec/empty-rec/same-count/more-count/zero-perString all return `null`.
- Content shape for the production scenario: violation code prefix, both layout descriptions, all three current values (60A/30A/40A), "Apply Recommended Configuration" pointer, plain-English "string length does not change per-string current" explanation.
- Custom per-string cap (10.5 A) honored.
- Input sanitization: filters `NaN` / negative / zero from `recommendedStringPanelCounts`.

Full suite: **531/531 pass** (+20). TC=0, build clean.

**Scope discipline (user directive respected):**
- NO auto-apply.
- NO auto-collapse / auto-sync.
- NO separate merge solver — the sizing recommendation is the source of truth.
- The existing v47.408 layout-drift banner + Apply button flow is unchanged.

**Next:** Return to **Stage 5 — Growatt** brand addition.
---

## v47.410 — Topology-Aware Downstream Propagation (completes v47.408)

**Trigger.** User screenshot after v47.408/v47.409 deployed showed the DC Wire
Ampacity compliance card still printing **15.3 A** for a SolarEdge optimizer
system where the regulated output is 15.0 A per NEC 690.8(A)(2). User directive:
*"stop patching, audit this issue and fix it in its entirety."*

**Audit.** Full grep of all consumers of the four string-generator fields
(`stringIsc`, `totalDcCurrentMax`, `ocpdPerString`, `dcWireAmpacity`) found
**29+ read-sites across 15 files** still using the panel-Isc method, plus a
**second parallel pipeline in `lib/computed-system.ts`** that independently
computes `stringIsc` and was also not topology-aware. v47.408 had only fixed
the allocator's per-channel comparison — downstream numbers were still wrong.
Audit document: `docs/v47.410-optimizer-topology-audit.md`.

**Fix (5 files, one release, source-to-sink correction):**

1. **`lib/string-generator.ts`** — Per-string `stringIsc` now reflects
   `designCurrentPerString` (topology-aware) instead of `iscCorrected`
   (panel method). `ocpdPerString` and `dcWireAmpacity` now both derive
   from `designCurrentPerString × 1.25` per NEC 690.8(B) / 690.9(B).
   `totalDcCurrentMax` auto-corrects via its existing `sum(stringIsc)` reduce.

2. **`lib/computed-system.ts`** — Added optional `optimizerMaxOutputCurrent`
   to `ComputedSystemInput`. The `stringIsc` block inside `if (isString)`
   now branches `isOptimizer ? optimizerCap : iscCorrected × 1.25`,
   mirroring `string-generator.ts` so both pipelines produce matching
   numbers. `ocpdAmps` auto-corrects via its `stringIsc` dependency.

3. **`app/engineering/page.tsx`** — Plumbs
   `firstInv.optimizerMaxOutputCurrent` into `ComputedSystemInput`.

4. **`app/api/engineering/sld/route.ts`** — Distinguishes `OPTIMIZER` from
   `STRING_INVERTER` topology (previously collapsed both to `'string'`),
   forwards `optimizerMaxOutputCurrent` from request body.

5. **`app/api/engineering/plan-set/route.ts`** — Forwards
   `optimizerMaxOutputCurrent` from request body.

All 29+ downstream read-sites (SLD renderer, permit electrical sheet, wire
autosizer, engineering page compliance cards) now get topology-correct numbers
without per-consumer branches.

**Tests — 9 new in `lib/string-generator.test.ts` (v47.410 describe block):**
Uses a feasible-both-paths geometry (13.5 A panel, 20 A channel) so the four
fields can be asserted numerically without allocator-failure noise:
- `stringIsc` = 15.0 A (optimizer) vs ~16.9 A (string, Isc × 1.25).
- `ocpdPerString` ≤ 20 A (optimizer) vs ≥ 25 A (string).
- `dcWireAmpacity` = 18.75 A (optimizer) vs ~21 A (string).
- `totalDcCurrentMax` sums the topology-aware per-string values.
- Custom per-string cap (12.0 A) propagates to every string.

Full suite: **540/540 pass** (+9). TC=0, `npm run build` passes clean.

**Follow-up (deferred):** per-optimizer SKU selection in System Config UI
(currently defaults to 15.0 A which covers all shipping SolarEdge P-series +
Tigo TS4-A-O SKUs).

**Next:** Return to **Stage 5 — Growatt** brand addition.

---

### 🔧 Inter-stage hotfix: v47.430 — SolarEdge Inverter Allocation Regression Fix (Optimizer-Topology Voltage-Clamp Bypass)

**Trigger.** User-reported regression after v47.429 deployed: SolarEdge projects
auto-generated 4 inverters where Sol-Ark correctly sized 2 inverters for the
same panel count. User quote:

> *"Sol-Ark produces correct allocation: → 2 inverters, 4 strings, 18 panels each.
> SolarEdge produces: → 4 inverters, 1 string each ❌. So this is a SolarEdge-specific
> allocation issue. Root cause: The allocator is using mpptCount as the string
> capacity, but SolarEdge requires: → maxStringsPerInverter = mpptCount ×
> maxParallelStringsPerMppt. Please audit wherever strings are assigned to inverters
> (likely in sizeInverters or string allocation layer) and ensure parallel string
> capacity is included in the packing logic."*

**Root cause.** `voltageAwarePanelsPerUnit()` in `lib/system/sizingEngine.ts`
applied the NEC 690.7 cold-Voc clamp unconditionally across all topologies. For
SolarEdge HD-Wave SE7600H with 400 W panels (Voc 41.6 V, tempCoeff −0.29 %/°C,
−10 °C design low), cold Voc per panel = 45.8 V, which clamps per-string panel
count to `floor(480 × 0.99 / 45.8) = 10` — reducing `panelsPerUnit` from
`1 × 2 × 25 = 50` to `1 × 2 × 10 = 20`. For 72 panels this forced `ceil(72/20) = 4`
inverters when the physically correct answer was `ceil(72/50) = 2`: SolarEdge
optimizers regulate string voltage to a fixed ~400 V bus, so panel Voc does
**not** stack at the inverter input, and NEC 690.7 is inapplicable.

The same optimizer bypass had **already** been added to
`feasibilityEvaluator.ts` (in v47.411) and to the inner `voltageAwareMaxPPS`
closure used for slot allocation. It was **missed** in the top-level
`voltageAwarePanelsPerUnit()` — the function called by `vaPPU` inside
`sizeInverters()` to determine unit count during auto-sizing.

**Fix (1 file, minimal surface):**

- `lib/system/sizingEngine.ts`:
  1. `voltageAwarePanelsPerUnit()` gains an optional `topology` parameter;
     when `topology === 'optimizer'`, the NEC 690.7 clamp is bypassed and the
     function returns `mpptCount × maxParallelStringsPerMppt × brandMaxPPS`
     — the physically-correct hardware ceiling for optimizer inverters.
     String/hybrid/micro topologies retain the voltage clamp unchanged.
  2. The `vaPPU` closure inside `sizeInverters()` captures `brand.topology`
     from the resolved brand profile and forwards it at every call site
     (`minRequiredPanelsPerUnit`, `unitsRequired`, slot-allocation probes,
     `attemptDownsize`, tier-selection loops).
  3. No changes to the inner `voltageAwareMaxPPS` closure or to
     `feasibilityEvaluator.ts` — both were already correct.

**Test fix (test incompleteness exposed by the sizing fix):**

- `lib/system/brandOnboardingSmoke.test.ts` — Stage 5 smoke
  `inverterSpecsFromRegistry()` call was omitting `nominalDcVoltage`. Pre-fix
  this was masked because sizing produced `qty = 2` for solaredge +
  sp-maxeon3-400 × 18 p (one string per inverter, 10.6 A < 20 A cap fine).
  Post-fix `qty = 1` (correct: 18 p fits on one SE7600H at 2 parallel strings
  × 9 p) and the two 9 p strings land on the single MPPT channel. Without
  `nominalDcVoltage` forwarded, the string generator used `mpptCenter =
  (200 + 480) / 2 = 340 V` instead of the real 400 V bus, computing operating
  current as `9 × 400 / 340 = 10.6 A` instead of `9 × 400 / 400 = 9.0 A` — two
  strings × 10.6 A = 21.2 A > 20 A cap → false `MPPT_CURRENT_EXCEEDED`.
  Real runtime callers already pass this field; only the test was incomplete.

**Tests — 4 new regression locks in `lib/system/sizingEngine.test.ts`
("v47.430: Optimizer voltage-clamp bypass" describe block):**

1. **REGRESSION-LOCK-1** — 52 panels + SE-7600H selected (optimizer) →
   exactly 2 units × 2 strings each, NOT 4 × 1.
2. **REGRESSION-LOCK-2** — 72 panels + SolarEdge auto-tier → ≤ 3 units
   (prior buggy path produced 4+).
3. **INVARIANT** — non-optimizer brands (string/hybrid) STILL apply the
   voltage clamp — no regression for Sol-Ark / Growatt / Enphase PCS / SMA /
   GoodWe / Solis / Tesla / Tigo.
4. **CEILING** — optimizer bypass respects the brand-profile
   `maxPanelsPerString = 25` ceiling (does not unbound the string length).

Full suite: **1808/1808 pass** (+4 regression-locks) across 47 test files.
TC=0, `npm run build` clean.

**Brand-agnostic:** any future optimizer-topology brand (a second SolarEdge
family, Huawei FusionSolar optimizers, Tigo TS4-O retrofit modelled as
optimizer) automatically inherits the correct hardware-ceiling sizing without
per-brand code.

**Zero API changes** — `voltageAwarePanelsPerUnit()` `topology` parameter is
optional; omitting it preserves the legacy voltage-clamp behaviour.

**Next:** Return to **Stage 5** brand additions (Schneider / Victron / OutBack).


---

### 📋 Stage 7 — Consolidation Assessment (READ-ONLY, shipped v47.431)

Full deliverable: `docs/STAGE7_CONSOLIDATION_ASSESSMENT.md`.

**Three audit areas:**

1. **BOM engine proliferation (LOW RISK, RECOMMENDED FOR STAGE 8.1)** —
   Identified ~2,228 lines of dead code: `bom-engine.ts` (630 lines, zero
   production imports), `bom-v2-engine.ts` (597 lines, only used by the dead
   `/api/engineering/bom-v2` route), `bom-unified.ts` (684 lines, only a type
   import in the dead `bom-merge.ts`), `bom-merge.ts` (317 lines, zero
   consumers), `app/api/engineering/bom-v2/route.ts`. One live engine:
   `bom-engine-v4.ts` (989 lines). Recommended action: atomic delete of the
   5 orphan files, rewrite ~10 comment pointers in `bom-system-profiles.ts`.
   Effort 1-2 hrs, risk LOW, savings −2,228 lines.

2. **Racking DB duality (MEDIUM RISK, CONDITIONAL)** —
   `racking-database.ts` (14 rows, structural math, 1 consumer:
   `structural-engine-v3`) coexists with `mounting-hardware-db.ts` (42 rows,
   UI/BOM/permit/smoke, 8 consumers including `structural-engine-v4`). All
   14 rows in the smaller DB have ID counterparts in the larger one, but
   fields differ (structural vs UI). Both routes are live:
   `/api/engineering/structural-v2` (v3) and `/api/engineering/calculate`
   (v4). Three options documented; **recommended Option B**: keep both +
   add drift-fence CI test (2-3 hrs, zero behavioural risk).

3. **equipment-db vs brandProfiles spec duplication (MEDIUM-HIGH RISK,
   DEFER)** — `BrandInverterModelRef` duplicates 6 fields per SKU from
   `STRING_INVERTERS` → ~360 drift points. v47.425 smoke suite catches
   absence, NOT value drift. But profiles intentionally deviate in some
   cases. **Recommended**: add drift-fence CI test with
   `overridesEquipmentDb` opt-out flag rather than full refactor.

**Recommended Stage 8 scope:**

- **8.1** — BOM dead-code deletion (Area 1 — LOW risk, HIGH hygiene value)
- **8.2** — Drift-fence CI tests for both Areas 2 and 3 (LOW risk,
  eliminates silent drift without architectural change)
- **8.3** — (DEFERRED) Racking DB unification via Option C strangler-fig,
  opportunistic
- **8.4** — (DEFERRED) Brand-profile spec centralization, only if drift-
  fence tests flag real regressions

**Stage 7 exit criteria met** — written recommendation delivered. User
chooses Stage 8 scope.

**Stage 8.1 + 8.2 shipped in v47.432** per user directive: pure deletion + additive tests only.
Stage 8.3 (racking unification) and Stage 8.4 (brand-profile centralization) remain deferred.

---

### 🔧 Stage 8.1 + 8.2 — BOM Dead-Code Deletion + Drift-Fence CI Tests (shipped v47.432)

**Scope:** low-risk execution of the two RECOMMENDED items from the Stage 7 assessment. No racking unification, no brand-profile refactor. Per user directive: "Keep this release low-risk: pure deletion + additive tests only."

**Deliverables:**

1. **Stage 8.1 — BOM dead-code deletion** (7 files, -3,278 lines total):
   - `lib/bom-engine.ts` (630 lines, v1 legacy engine, zero production imports)
   - `lib/bom-v2-engine.ts` (597 lines, only consumed by the dead bom-v2 route)
   - `lib/bom-unified.ts` (684 lines, only imported by the also-dead bom-merge.ts + 2 test files)
   - `lib/bom-merge.ts` (317 lines, only imported by its own test file)
   - `app/api/engineering/bom-v2/route.ts` (orphan API route with no client callers)
   - `lib/bom-merge.test.ts` (454 lines, tested only dead code)
   - `lib/bom-unified.test.ts` (571 lines, tested only dead code)

   The one live engine remaining is `lib/bom-engine-v4.ts`, consumed by `bom-system-profiles.ts`, `ecoflow-bom.ts`, `app/api/engineering/bom/route.ts`, and `app/api/engineering/preliminary/route.ts` — unchanged. 16 dangling comment references in `bom-system-profiles.ts` + 4 in `app/engineering/page.tsx` + 1 in `bom-engine-v4.ts` were rewritten as v47.432-tagged historical attribution so grep still finds the legacy-pattern lineage.

2. **Stage 8.2 — Drift-fence CI tests** (+273 tests, 2 new files):

   **`lib/system/rackingDatabaseDriftGuard.test.ts` (45 tests)** — for all 14 IDs overlapping between `racking-database.ts` and `mounting-hardware-db.ts`, enforces manufacturer match, systemType coarse-bucket consistency via an explicit taxonomy bridge (mh-db finer vocab → racking-db coarse 4-value vocab), and compatibleRoofTypes shared-overlap after roof-type vocabulary normalization. `EXPECTED_DIVERGENCES` allowlist documents 2 pre-existing divergences: `ecofasten-rockit` (racking says rail_based with full rail spec, mh-db says rail_less — product-model disagreement) and `esdec-flatfix` (coarse `ballasted` vs fine `ballasted_flat` — already bridged through the coarse-bucket map).

   **`lib/system/brandProfileDriftGuard.test.ts` (228 tests across ~57 brand/SKU pairs)** — for every `BrandInverterModelRef` in `BRAND_PROFILES`, asserts `acKw === acOutputKw`, `dcKwMax === dcInputKwMax`, `mpptCount === mpptChannels`, and `maxParallelStringsPerMppt` matches when both sides declare a value. New `overridesEquipmentDb: true` opt-out flag added to `BrandInverterModelRef` type. Test emits self-documenting CI audit log listing every overridden SKU. 5 SKUs tagged on first run with in-code justification:

   - `sungrow-sg15rs` (maxParallel 1 vs 2) — INTENTIONAL design-rule override
   - `sma-sb-10.0` (maxParallel 1 vs 6) — INTENTIONAL (no external combiner for residential)
   - `sma-sb-7.7` (mpptCount 2 vs 3) — STALE, TODO(Stage 8.4)
   - `goodwe-gw10k-ms` (acKw 10 vs 9.6, dcKwMax 15 vs 14.4, mpptCount 2 vs 3) — STALE, TODO(Stage 8.4)
   - `generic-string :: se-7600h` / `se-10000h` (mpptCount 2 vs 1) — STALE, TODO(Stage 8.4)

**Test arithmetic:** v47.431 = 1808 tests across 47 files. Deleted 2 dead test files (-67 tests, -2 files). Added 2 drift-guard files (+273 tests, +2 files). Net v47.432 = **2075 tests across 47 files** (+267 drift-fence coverage). TC=0, `npm run build` clean (46/46 pages).

**Stage 8.3 / 8.4 backlog (deferred):**

- **Stage 8.3** — Racking DB unification (reconcile the 2 divergences in EXPECTED_DIVERGENCES, retire `structural-engine-v3` via adapter, delete `racking-database.ts`)
- **Stage 8.4** — Brand-profile spec centralization (reconcile the 3 stale profile drifts flagged by the drift-guard: sma-sb-7.7, goodwe-gw10k-ms, and the 2 SolarEdge catch-alls in generic-string; optionally remove the duplicated fields from `BrandInverterModelRef` so profiles read from `equipment-db` directly)

### 🔧 Stage 8.4 — Brand-Profile Centralization (shipped v47.433)

**Scope:** close the brand-profile drift backlog surfaced by the v47.432 drift-guard. Fix the 3 stale profile drifts, align the 2 "intentional" overrides to registry, leave zero `overridesEquipmentDb=true` flags remaining. Per user directive: "fix the 3 stale brand-profile values, remove overridesEquipmentDb flags where no longer needed, ensure drift-guards pass clean with no intentional overrides remaining."

**Deliverables:**

1. **`lib/system/brandProfiles/generic-string.ts`** — SolarEdge HD-Wave catch-all corrections:
   - `se-7600h` mpptCount: **2 → 1** (HD-Wave is single-MPPT per optimizer inverter; dedicated `solaredge.ts` profile already had mpptCount=1)
   - `se-10000h` mpptCount: **2 → 1** (same rationale)

2. **`lib/system/brandProfiles/sma.ts`** — SMA inverter corrections:
   - `sma-sb-7.7` mpptCount: **2 → 3** (v47.417 US-41 datasheet: SB 6.0/7.0/7.7 all have 3 MPPT trackers)
   - `sma-sb-10.0` maxParallelStringsPerMppt: **1 → 6** (TL-US datasheet: 6 parallel strings via external DC Combiner Box; SKU is `active: false` so zero live-project impact)

3. **`lib/system/brandProfiles/goodwe.ts`** — GoodWe MS-US correction:
   - `goodwe-gw10k-ms` acKw/dcKwMax/mpptCount: **10.0/15.0/2 → 9.6/14.4/3** (v47.417 remap: the equipmentDbId resolves to GoodWe GW9600-MS-US; canonical spec per MS-US datasheet)

4. **`lib/system/brandProfiles/sungrow.ts`** — Sungrow correction:
   - `sungrow-sg15rs` maxParallelStringsPerMppt: **1 → 2** (SG15RS datasheet; SKU is `active: false` so zero live-project impact)

**Opt-out flag disposition:** all 6 `overridesEquipmentDb=true` flags REMOVED. The drift-guard audit log now reports zero overrides on every CI run. The `overridesEquipmentDb?: boolean` field on `BrandInverterModelRef` in `types.ts` is RETAINED so future legitimate overrides have a documented mechanism (must carry in-code justification per test comment), but no SKU currently uses it.

**BOM accuracy impact:** this release directly improves sizing accuracy for three live-brand SKUs:
- SMA SB-7.7 projects now correctly distribute strings across 3 MPPT trackers instead of 2
- GoodWe GW10K-MS projects now use the correct 9.6 kW AC / 14.4 kW DC / 3 MPPT spec instead of the stale 10.0/15.0/2
- SolarEdge catch-all projects via `generic-string` now correctly treat HD-Wave as 1-MPPT

Every BOM, string-allocation, and compliance path downstream of `BRAND_PROFILES` inherits the fix automatically (no code-logic changes).

**Verification:** 2075/2075 tests pass (same count as v47.432 — the drift-guard tests pass cleanly on the corrected values, confirming the corrections ARE the canonical registry values). TC=0, `npm run build` clean (46/46 pages).

**Stage 8.3 remains deferred** (racking unification): retire `structural-engine-v3` via adapter to `mounting-hardware-db.ts`, reconcile the 2 racking divergences in `EXPECTED_DIVERGENCES`, delete `racking-database.ts`.


### 🔧 Stage 9.1 — Survey Integration Schema + HMAC Verifier + Admin Log (shipped v47.434)

**Scope:** first release of the in-house survey tool integration pipeline. v1 is inbound-only (survey backend → SolarPro), thin-event webhook architecture per partner doc. This release ships the contract + auth skeleton and defers the ingest pipeline to v47.435 (blocked on survey-team thin-event body confirmation + sample POST).

**Architecture locked:**

- **Thin-event default.** Survey tool POSTs minimal envelope `{ event, schemaVersion, event_id, survey_id, completed_at, survey_url? }`. SolarPro verifies + logs + (in v47.435+) fetches full payload via `survey_url` or `${SURVEY_BACKEND_URL}/api/surveys/{survey_id}`.
- **HMAC-SHA256** over `${timestamp}.${rawBody}` with secret = `SURVEY_WEBHOOK_SECRET` env var. Constant-time compare via `crypto.timingSafeEqual`. 5-minute timestamp tolerance.
- **`X-Survey-Event-Id` is the idempotency key.** Duplicate deliveries → 200 no-op. Enforced via partial-unique index `idx_projects_survey_external_id_user`.
- **`projects.origin` is a closed enum** `{ manual, bill_upload, survey, api }` locked by drift-guard.
- **Single-tenant v1.** `SURVEY_INGEST_DEFAULT_USER_ID` env var will own survey-origin rows in v47.435.

**Deliverables (7 new files + 1 modified):**

1. **`migrations/011_survey_ingest.sql`** — canonical SQL doc. Adds: `projects.survey_external_id TEXT`, `projects.origin TEXT NOT NULL DEFAULT 'manual'`, `projects.survey_category TEXT`, `projects.survey_meta JSONB`; `project_files.external_id TEXT`, `project_files.status TEXT NOT NULL DEFAULT 'ready'`; `webhook_deliveries` table (13 columns + 4 indexes + 2 partial-unique indexes for idempotency). All `ALTER TABLE` use `IF NOT EXISTS` guards.
2. **`app/api/migrate/route.ts`** (modified) — inline migration block 011 added; idempotent on re-run.
3. **`lib/survey/types.ts`** — frozen v1.0 type contract: `SchemaVersion = '1.0'`, `CURRENT_SCHEMA_VERSION`, `SurveyEventType = 'survey.completed'`, `SUPPORTED_SURVEY_EVENT_TYPES`, `SurveyCompletedEvent`, `WebhookSignatureVerification` (5 reason codes: `MISSING_SIGNATURE_HEADER`, `MISSING_TIMESTAMP_HEADER`, `TIMESTAMP_OUT_OF_TOLERANCE`, `SIGNATURE_MISMATCH`, `MALFORMED_TIMESTAMP`), `WebhookDeliveryStatus` 6-member union (`received|verified|duplicate|ingested|failed|replayed`), `WebhookDelivery` row mirror, `ProjectOrigin`, `PROJECT_ORIGIN_VALUES`.
4. **`lib/survey/verifyWebhookSignature.ts`** — pure-function HMAC verifier. `TIMESTAMP_TOLERANCE_SECONDS = 300`. Injectable `nowSeconds` for deterministic testing. Length-mismatch short-circuit before `timingSafeEqual`. No DB/network side-effects — caller decides what to persist.
5. **`app/api/webhooks/survey-complete/route.ts`** — POST receiver. Reads raw body (bytes-exact), verifies HMAC, narrow envelope validator, idempotency check against `webhook_deliveries`, inserts delivery row (valid OR invalid — logs everything), returns 501 `INGEST_NOT_IMPLEMENTED` on success path. Missing secret → 500 with no DB side-effect.
6. **`app/api/admin/survey-webhook-log/route.ts`** — GET endpoint. Admin-only via `requireAdminApi`. Filters: `?status`, `?source`, `?limit` (default 100, max 500). Rows ordered DESC by `received_at`.
7. **`app/api/admin/survey-webhook-log/[id]/replay/route.ts`** — POST stub. Admin-only. Returns 501 `REPLAY_NOT_IMPLEMENTED`. Endpoint shape locked for admin UI to wire; full semantics ship in v47.437.

**Tests (+26 across 2 new files):**

- **`lib/survey/verifyWebhookSignature.test.ts`** (18 tests) — valid signatures (exactly-now, within-window back/forward); all 5 failure reason codes; length-mismatch short-circuit; replay defence (sig computed over different timestamp); byte-exactness (whitespace in body changes signature); determinism; custom tolerance window.
- **`lib/survey/contractDriftGuard.test.ts`** (8 tests) — value-level snapshot of v1.0 contract constants. Locks `CURRENT_SCHEMA_VERSION='1.0'`, `SUPPORTED_SURVEY_EVENT_TYPES=['survey.completed']`, `PROJECT_ORIGIN_VALUES=['manual','bill_upload','survey','api']` (exact order + no duplicates + lowercase snake_case DB-text invariant), `WebhookDeliveryStatus` 6-member union snapshot. Bumping any of these forces touching this test = conscious contract-change review.

**Verification:** 2101/2101 tests pass across 49 test files (+26 new over v47.433's 2075). TC=0, `npm run build` clean (46/46 pages + 3 new API routes registered).

**Blocked on survey team (v47.435 gate):**

- Confirmation of the thin-event body shape (schemaVersion + event_id + survey_id + completed_at envelope — or a fat-event variant).
- Sample webhook POST (captured bytes + signature) to validate end-to-end against a real survey deployment.
- Access credentials / endpoint URL for `GET /api/surveys/{id}` on the survey backend.

**Remaining 9.x backlog:**

- **Stage 9.2b** (v47.436) — Handoff JWT minter: mint HS256 JWT with `jti` + `project_id` claims for outbound deep-link to partner survey launcher. Depends on Q4 launch URL shape confirmation from partner.
- **Stage 9.3** (v47.436) — Photos + notes + checklist full ingest. Async photo fetch worker (`project_files.status` lifecycle: pending → ready / failed). Depends on Q3 photo URL scheme confirmation from partner.
- **Stage 9.4** (v47.437) — Contract doc `docs/SURVEY_INTEGRATION_CONTRACT_v1.md`, replay admin action (re-run transform against stored `raw_body`), end-to-end drift-guard test (mock webhook → logged delivery → project rows).



---

### 🔧 Stage 9.2 — Ingest Pipeline Skeleton (shipped v47.435)

**Version:** v47.435 | **Status:** ✅ Shipped | **Tests:** +91 new, 2291/2291 pass (59 files)

#### Architecture decisions

| Decision | Choice | Rationale |
|---|---|---|
| Both ingest paths return 202 | `INGEST_OK` and `INGEST_FAILED_BUT_LOGGED` both return 202 | Partner\'s retry queue treats 2xx as \"stop retrying\"; pipeline failure ≠ delivery failure |
| Pipeline never throws | `runIngestPipeline()` catches all errors internally | Route always returns cleanly; ops replay via v47.437 is the recovery path |
| Clean IngestContext | deliveryId + ownerId + event passed in; no env reads inside pipeline | Fully testable with `vi.mock` DB |
| Idempotency | `INSERT ... ON CONFLICT (user_id, survey_external_id) WHERE survey_external_id IS NOT NULL DO UPDATE` | Retry-safe; `xmax=0` detects created vs updated |
| Q8 abstraction | `SURVEY_PROJECT_LINK_STRATEGY` env var (CREATE_ORPHAN default) | Defers the \"which project does this survey belong to\" decision until Q8 answered |
| Pluggable transformer | Registry pattern (`registerTransformer` / `getTransformer`) | v1.0 scaffold ships now; real field mapping drops in post-Q3 without changing the orchestrator |

#### New modules (`lib/survey/ingest/`)

- **`types.ts`** — `IngestContext`, `IngestResult`, `IngestStatus`, `IngestErrorCode` (6-member), `SurveyProjectLinkStrategy` enum, `LinkResolution` discriminated union, `TransformInput/Output/Summary/File`, `SurveyRawPayload` opaque type
- **`projectLinkResolver.ts`** — `resolveProjectLink()` pure function; reads `SURVEY_PROJECT_LINK_STRATEGY` env; three strategies: `ATTACH_TO_EXISTING` / `CREATE_ORPHAN` / `TRIAGE_QUEUE`; case-insensitive env parsing with `console.warn` on unknown value
- **`transformLayer.ts`** — pluggable transformer registry; built-in v1.0/`survey.completed` transformer; all field mappings are Q3 stubs; defensive candidate-key scan when `rawPayload` non-null
- **`ingestPipeline.ts`** — `runIngestPipeline()` orchestrator (6 steps: validate owner → resolve link → fetch stub → transform → DB upsert → update delivery status); never throws; file failures non-fatal

#### Migration 012 (`migrations/012_survey_ingest_v2.sql`)

Added columns: `webhook_deliveries.ingest_version TEXT`, `webhook_deliveries.ingest_summary JSONB`, `projects.survey_triage_reason TEXT`, `project_files.fetch_error TEXT`, `project_files.fetch_attempts INTEGER DEFAULT 0`, `project_files.mime_type TEXT`; 3 new indexes.

#### Route update

`app/api/webhooks/survey-complete/route.ts` now calls `runIngestPipeline()` synchronously after delivery INSERT. Returns:
- `202 INGEST_OK { projectId, created, transformSummary }` on success
- `202 INGEST_FAILED_BUT_LOGGED { ingestError, ingestErrorCode }` on pipeline failure

#### Test coverage

| File | Tests | Notes |
|---|---|---|
| `lib/survey/ingest/types.test.ts` | 14 | Enum/union integrity locks |
| `lib/survey/ingest/projectLinkResolver.test.ts` | 21 | All 3 strategies, ATTACH→triage fallback, env parsing |
| `lib/survey/ingest/transformLayer.test.ts` | 37 | Registry, v1.0 stub path, rawPayload field extraction |
| `lib/survey/ingest/ingestPipeline.test.ts` | 17 | MISSING_OWNER_ID, happy path, DB failure, never-throws |
| `lib/survey/webhookResponseContract.test.ts` | 18 (updated) | INGEST_OK/INGEST_FAILED locks, pipeline wired guard |
| `lib/survey/producerVersionContract.test.ts` | 12 (updated) | runIngestPipeline import guard, producerVersion on both paths |

#### Blocked (carried to next versions)

- **Q2** — `GET /api/surveys/{id}` bearer auth (rawPayload=null stub until resolved)
- **Q3** — Final field mapping (projectName/address/lat/lng/photos all stubs)
- **Q8** — `partnerProjectId` from thin event (strategy defaults to CREATE_ORPHAN)
- **v47.436** — Async photo fetch worker
- **v47.436** — Handoff JWT minter
