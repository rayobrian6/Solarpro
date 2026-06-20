# SolarPro Engineering Audit — 2026-06-19

Full read-only multi-agent audit of the engineering system, triggered by Ray's report: **"bad engineering logic… buttons not working… string sizes not sizing properly."** 7 parallel auditors covered: string-sizing, BOM, system-config UI, structural/PV-4C, SLD/electrical, brand-profiles/MPPT, and config→engine data flow. ~59 findings. Criticals verified against source.

---

## EXECUTIVE SUMMARY — 5 cross-cutting root causes

The specific bugs almost all trace to five systemic patterns. Fix the patterns, not just the instances.

1. **Silent failure (failures masquerade as success).** Engines are wrapped in `try/catch` that swallow the error and return HTTP 200 with `null`/`0`/`'—'`/defaults. So a broken calc *looks* like a working one with blank fields — exactly "it's broken but no error." Instances: structural V4 (`generatePermit.ts:361-364`), `/api/engineering/calculate` (`:231,314`), `/api/engineering/plan-set` (returns 200 `fallback`), `save-outputs` (success on partial save), BOM formula eval (returns 0 on parse fail).
2. **Multiple divergent engines for the same job.** Two string sizers (`string-generator.ts` vs `layoutCandidateGenerator.ts`) disagree on hot/cold Vmp; two permit pipelines (`generatePermit.ts` vs `plan-set`); two SLD systems (live `sld-professional-renderer.ts` vs **dead** `sld-wiring-engine.ts`/`sld-emblem-contracts.ts`, never imported); **three** DC/AC floors (0.9/1.0/1.0); **two** parallel-strings-per-MPPT defaults (1 vs 2); two snow sources; two wind-Kz models. Same input → different output depending on path.
3. **UI inputs that go nowhere.** Captured (sometimes even persisted) but never consumed by the engines: DesignStudio inverter/battery selection, per-string wire gauge/length, batteryBrand/Model. User changes it, nothing happens downstream.
4. **Fabricated data rendered as engineered fact.** Missing values silently default and print on the permit as if real: battery 5 kWh / 20 A, #10 AWG EGC, 200 A busbar, 0 A backfeed breaker, generic wood species, 2×6 / 24" / 115 mph. Strict validators don't check them.
5. **Single-source-of-truth violations.** Same datum (windSpeed, ground snow, busbar rating, OCPD) read from different fields on different sheets, so they diverge.

---

## CRITICAL findings (verified)

### C1 — String min-length uses COLD Vmp instead of HOT Vmp ✓VERIFIED — *"string sizes not sizing properly"*
`lib/string-generator.ts:198,204,245` — `deltaT = designTempMin − 25` (cold) → `vmpCorrected` is cold Vmp (higher than STC) → `minPanelsPerString = ceil(mpptMin/vmpCold)` **understates** the minimum. Worst case for dropping below MPPT-min is a HOT day. `layoutCandidateGenerator.ts:296` does it correctly (75 °C). The two engines disagree on the same array. **Fix:** compute min from Vmp at hot design temp; unify with layoutCandidateGenerator.

### C2 — DesignStudio inverter/battery selection silently discarded — *"buttons not working"*
`components/design/DesignStudio.tsx:4924,4969,5019` set local state; `buildLayout()`/`buildSystemDefinition()` (`:3038,:3132`) and the `/api/production` POST (`:3160`) never include `selectedInverter`/`selectedBattery`/`batteryCount`. Pick an inverter, hit Save & Calculate → choice is dropped. **Fix:** add them to the layout payload + persist (mirror `DesignTab.savePicker`).

### C3 — PV-4C structural gated + silent-catch ⇒ "— mph" / 0 moments
`lib/permit/generatePermit.ts:286,361-364` — V4 mapping gated on `needsCalc && roof`, wrapped in silent catch. Skipped/failed → partial `rafter` survives (util 69%, moments 0); `wind.windSpeed` never backfilled → "— mph". **Fix:** all-or-nothing mapping; read windSpeed from authoritative `canonical.site.windSpeed`; surface failure instead of rendering 0.

### C4 — 120% busbar rule structurally cannot fail (permit liability)
`lib/permit/utils/sldAdapter.ts:48`, `electricalPages.ts:346`, `sld-professional-renderer.ts:2401` — `mainPanelAmps` overloaded as both main breaker AND busbar; 200/200/40 → `240≥240` PASS; a 225 A main on a 200 A bus never caught. **Fix:** add real `busbarAmps`; test `busbarAmps×1.2 ≥ mainBreaker + ΣbackfeededOCPD`.

### C5 — BOM topology gating drops entire inverter line for AC_MODULE
`lib/bom-engine-v4.ts:300,353` — micro predicate is `MICRO||AC_COUPLED_BATTERY` (omits `AC_MODULE`, wrongly includes AC-coupled battery). AC_MODULE system → no microinverters, no trunk cable, no Stage-3 inverter. **Fix:** one shared `isMicro = MICRO||AC_MODULE`; handle AC_COUPLED_BATTERY separately.

### C6 — Shared rate-limit bucket + `anonymous` fallback ⇒ intermittent 429 that reads as dead buttons
`lib/rateLimiter.ts:53,248` — 10 req/30s on one `engineering` bucket across 24+ routes incl. reads; debounced auto-save/recalc drains it; `x-forwarded-for` absent → all users share one global bucket. 429 → client shows generic failure → "button did nothing." **Fix:** per-endpoint/per-user buckets; exclude GETs; surface 429 distinctly.

---

## HIGH findings (by surface)

**String sizing** — `string-generator.ts`
- H: `recommendedPanelsPerString` uses STC Vmp (`:249`) while the valid window uses temp-corrected → recommended length off-window.
- H: remainder redistribution emits a below-min string as a *warning* (`:400-418`, `:624`) instead of rebalancing across more strings.
- H: `configStringPanelCounts` override (`:461-469`) bypasses all min/max voltage validation.
- M: three DC/AC floors (feasibility 0.9 / sizing 1.0 / string-gen 1.0) → same array passes one path, fails another.

**Brand profiles / MPPT** — `lib/system/brandProfiles/*`, `sizingEngine.ts`, `mpptAllocator.ts`
- H: **Tesla panel Isc 13.03 A > Tesla inverter `maxInputCurrentPerMppt:13 A`** (`equipment-db.ts:245` vs inverter rows) → `MPPT_CURRENT_EXCEEDED` on Tesla's own kit. (Surfaced by the Phase-1 Tesla panel add — likely the inverter input-current value is too low vs the real datasheet.) **Verify inverter datasheet, then fix.**
- H: parallel-strings-per-MPPT default diverges — `panelsPerUnit ?? 2` (`sizingEngine.ts:567`) vs allocator/string-gen `?? 1` → spurious `MPPT_PARALLEL_CAP_EXCEEDED` on unbranded designs.
- H: Tesla battery never sizes — `sizeBattery()` only implements `modular_stack`; Tesla is the only `single_pack` brand → `return null` (`sizingEngine.ts:1854`). (Blocks Phase-5 Powershare battery sizing.)
- M: Tesla tiers exceed model `dcKwMax`/ratio (`tesla.ts:39-44`); non-EcoFlow modular_stack batteries return `equipmentDbId: undefined` (`:1841`); Tesla racking not in `recommendedRackingBrands` (`:78`).

**Structural / PV-4C** — `generatePermit.ts`, `structuralPages.ts`, `structural-engine-v4.ts`
- H: lag SF 1.91 rendered FAIL — page hard-codes a 2.0 ultimate threshold against an ASD/mount-derived 1.5 SF; `lagBoltCapacity = uplift × SF` is a tautology (`generatePermit.ts:351`, `structuralPages.ts:683`). **Fix:** use real `mountCapacityLbs`; align threshold to 1.5 ASD.
- H: `woodSpecies: 'douglas_fir_larch'` matches no `WoodSpecies` enum key → V4 falls back to generic Fb 1000 psi for **every** project (`generatePermit.ts:307`).
- H: snow per-attachment field never populated (`structuralPages.ts:617`) → "— lbs"; cover-sheet vs PV-4C snow read from different sources (`coverSheet.ts:218`).

**SLD / electrical** — `electricalPages.ts`, `sldAdapter.ts`, `sld-professional-renderer.ts`
- H: placeholder OCPD (30 vs 40 across paths) feeds the 120% check; fallback `buildSLD()` conductor schedule + callouts entirely hardcoded (`#10 AWG`, 20/30/25 ft) regardless of system; AC EGC hardcoded `#10` even after a larger EGC computed.

**BOM** — `bom-engine-v4.ts`, `bomForPermit.ts`
- H: DC OCPD never capped at panel `maxSeriesFuseRating`; no per-string fuses generated for ≥3 parallel strings (NEC 690.9). 
- H: 120% backfeed can emit a **0 A** breaker as a real part when `bus×1.2 − main ≤ 0` (`:898`).
- M: fuzzy model match via bidirectional substring → wrong SKU; plan-set V4 enrichment keeps base qty (panels show "Qty 1").

**Data flow** — `app/engineering/*`, `app/api/engineering/*`
- H: `/api/engineering/generate` "up-to-date" branch omits `panelCount`/`systemSizeKw`/`reportId` → display doesn't refresh after Generate (looks like no-op).
- H: `/api/engineering/calculate` swallows structural + string-gen failures, returns 200 with fake WARNING/null → stays stale, no error.
- H: permit gated on panel **model name** (`helpers.ts:222`, `canonical.ts:146`) — watts/Voc present but blank name → hard 500 → dead Permit button.
- H: `/api/engineering/plan-set` is a 2nd divergent permit pipeline that never calls `generatePermit.ts`; returns 200 placeholder permit on engine failure (no staleness guard).
- M: per-string wire gauge/length persisted but overridden by auto-sizing (never consumed); permit electrical recompute *replaces* (not merges) `compliance.electrical`, discarding UI fields; fabricated battery/structural defaults rendered as real.

---

## RECOMMENDED FIX ORDER (Phase 0)

**Cluster A — the two reported symptoms (do first, highest user impact):**
1. String sizing: C1 + recommended-length + DC/AC-floor + parallel-default unification (collapse the two sizers' disagreement). 
2. Buttons: C2 (persist inverter/battery selection) + data-flow H's (generate shape, calculate error surfacing, permit-name 500, 429 bucket).

**Cluster B — permit correctness / liability:**
3. PV-4C: C3 + lag-SF false-fail + woodSpecies enum + snow single-source.
4. SLD: C4 (120% busbar) + OCPD placeholders + hardcoded conductor schedule.
5. BOM: C5 (micro gating) + DC OCPD cap/string fuses + 0 A breaker guard.

**Cluster C — systemic hardening:**
6. Kill silent-failure catches (surface errors); retire/merge the duplicate engines (plan-set, dead SLD subsystem); stop rendering fabricated defaults (render "TBD" + extend strict validation).

**Cluster D — Phase-1 Tesla follow-ups:**
7. Tesla inverter `maxInputCurrentPerMppt` (verify datasheet) + add `'tesla'` to `recommendedRackingBrands` + implement `single_pack` battery sizing (also unblocks Powershare).

Each structural/electrical fix must be verified by running the engine with a real project's numbers (vitest/tsx), not just `tsc`.
