# DATA AUTHORITY AUDIT — single-source-of-truth register

**Date:** 2026-07-19 · **Trigger:** Ray — "We can not have multi sets of data flowing
through the pipeline. If I am to send these plans to a stamping agency, we must be
accurate." · **Method:** 4 parallel audits (client intake, server heal layers, live DB
truth on Stowell `4d720c49` + fleet sweep, sheet-level consumers), all findings cited
to file:line or actual DB values. Reference project state: 88 panels (54 roof REC-405
micro / 16 ground LONGi-580 Solis / 18 fence PS-440 EcoFlow).

This is a STANDING register. Fixes check items off with the commit hash; new
contradictions get appended. Do not delete resolved entries — strike them through.

---

## THE DOCTRINE — field → one owner

| Value | ONE owner | Everyone else |
|---|---|---|
| Sub membership / geometry | `layouts.panels` placement stamps (§1.1) | derived |
| Equipment (panel/inverter/mount per sub) | `engineering_config.subSystems[key]` → equipment-db | stamps NEVER own wattage/specs |
| Panel electrical + physical specs (W, Voc, Isc, dims, weight) | equipment-db record resolved via the map, PER SUB | `project.panel*` scalars must die or be per-sub resolved server-side |
| totals (DC kW, AC kW, panel count) | per-sub nameplate Σ (subScopedInput math), tri-synced to `system`/`cad`/`canonical.electrical` | client math forbidden |
| Conductors / OCPD / EGC / tap | `conductorAuthority` (+ `poi` block) | zero inline `×1.25`/rounding in sheets |
| Standard OCPD/fuse/rating ladder | `necNextStandardOcpd` (helpers) / `nextStdRating` (integratedBos) | 13 duplicated arrays must be deleted |
| backfeedBreakerA | electrical engine (705.12) result | kill the 690.8 pre-seed |
| systemType | derived from `partitionSubSystems(panels)`; scalars are labels | 3 stored scalars disagree today |
| Wind / snow / seismic / pitch | resolved once onto `canonical.site`; print AND analysis read it | dual chains today |
| Planset DATE | generation timestamp, server-side | `config.date` is a design label only |
| Engineer of Record | blank fill-in, everywhere | no vendor-name defaults |

---

## P0 — STAMPED-PLAN ACCURACY (fix first)

- [x] (88fa4f07) **P0-1 backfeedBreakerA engine value permanently discarded.** `generatePermit.ts:231-239`
  seeds from a 690.8 inverter-output basis; the electrical engine's 705.12 result at
  `:823-828` is guarded `if (!project.backfeedBreakerA)` — always false. Cover +
  `sldAdapter.ts:104-105` print the estimate, never the engine value. Fix: delete the
  pre-seed; engine owns it unconditionally.
- [x] (88fa4f07) **P0-2 Fire-setback coverage from the FENCE panel's dims.** `page.tsx:8055-8056`
  puts `inverters[0].strings[0]` (fence) dims on `project.panelLengthIn/WidthIn`;
  `arrayPages.ts:459,481` × ALL panels → decides the 18"-vs-36" band (fireSetback.ts:41).
  Fix: per-roof-sub dims resolved server-side.
- [x] (88fa4f07) **P0-3 Structural dead load from the fence panel's weight.** `page.tsx:8054` →
  `arrayLayout.ts:85` → `structuralInput.ts:93` → V4 engine + APP-A
  (`compliancePages.ts:790,835`). Understated gravity load = highest-liability class.
- [x] (88fa4f07) **P0-4 Module datasheet page prints one (fence) module for the whole hybrid.**
  `compliancePages.ts:774-795` — Voc/dims/weight/efficiency all panel0-based.
  Fix: per-sub datasheet rows.
- [x] (88fa4f07) **P0-5 Three OCPD rounding laws.** (a) `electricalPages.ts:1300-1305`
  `Math.ceil(x/5)*5` — not the NEC 240.6 ladder (52A → prints 55A vs authority 60A);
  (b) `structuralPages.ts:1407-1408` prints RAW `Isc×1.25×1.25` ("19.2A" — nonexistent
  fuse); (c) ladder duplicated ~13× with different contents — `accessory-resolver.ts:331`
  OMITS 110 (105A → 125A there, 110A everywhere else); bom-engine STD_FUSE stops at 200
  vs helpers 1200. Fix: all callers → `necNextStandardOcpd`/authority values.
- [x] (88fa4f07 (studio+mig 110)) **P0-6 Stamp wattage poisoning at the SOURCE.** Ground 16/16 stamped 405 (truth
  LONGi 580 — 43% error, 6.48 vs 9.28 kW); fence 18/18 stamped 430 from hardcoded
  `SolarEngine3D.tsx:5007` (truth 440, equipment-db:493). SYSTEMIC: 430-stamps in 4 more
  projects; single-system Braidon 31/31 stamped 440 vs map 405 (8.6% oversell in
  `layouts.system_size_kw`). Fix: studio stamps from equipment-db via the map (never
  literals); re-stamp on save; idempotent normalizer migration for existing rows.
- [x] (88fa4f07 (nameplate fn + mig 111)) **P0-7 Four contradictory stored system sizes for one project.**
  `layouts.system_size_kw` 36.09 (stamp Σ) / `projects.system_size_kw` 37.251 (provenance
  unknown — matches nothing) / `engineering_runs` 39.07 (truth) / permit-input 38.72
  (panel0 flat math). Fix: ONE exported nameplate function used by layout save, projects
  write, runs, and permit input; backfill migration.
- [x] (88fa4f07) **P0-8 E-1 defaults Engineer-of-Record to "SolarPro Engineering".**
  `electricalPages.ts:1513` `${project.designer||'SolarPro Engineering'}` — contradicts
  route.ts:1171-1173's deliberate no-vendor-EOR rule. Fix: blank fill-in.
- [x] (88fa4f07) **P0-9 Planset DATE = stale `config.date`.** 2026-06-16 printed on sheets
  generated 07-19 (`titleBlock.ts:103,111`, `peLetter.ts:50`, `sldAdapter.ts:165`).
  Fix: generation timestamp server-side; config.date is a design label.
- [x] (88fa4f07) **P0-10 Hybrid recompute syncs 1-of-3 owners for panel count.**
  `generatePermit.ts:217-220` sets only `system.totalPanels`; `cad.totalPanels` +
  `canonical.electrical.totalPanels` (read by validationPage, bomForPermit, structural,
  sitePlan) go stale. DC branch does it right — mirror it. (Introduced 352bfb20.)
- [ ] **P0-11 design_electrical mirror contradicts the equipment map on EVERY sub**
  (all three subs cloned `{string, rec-alpha-pure-405, ironridge-xr100}`) AND its string
  composition differs (fence 10+8 vs engineering 9+9 → ~51V string-Voc delta). It is a
  route BACKFILL SOURCE (`route.ts:552-564`) — a stale mirror can win. Fix: regenerate
  mirror from engineering on save, or mark derived + never backfill-eligible.
- [x] (88fa4f07) **P0-12 `type:'ecoflow'`** stored as an inverter *type* (not micro/string/hybrid) —
  every `type==='micro'` fork works by luck. Normalize enum on write + intake.

## P1 — CROSS-SHEET CONSISTENCY

- [x] (88fa4f07) **P1-1** `project.panelVoc/Isc` (panel0) back compliance/electrical fallbacks
  (`compliancePages.ts:539` chain, `electricalPages.ts:1018-1019`, `fieldLabels.ts:118`)
  + hardcoded `||41.6`/`||12.26` guesses (`arrayPages.ts:339-340`). Fix: engine writes
  DB-resolved specs back onto `strings[]`; delete project scalars.
- [x] (88fa4f07) **P1-2** SLD renderer re-derives lane OCPD/EGC/amps (`sld-professional-renderer.ts`
  ~8 sites) in parallel to conductorAuthority. Route adapter values through authority.
- [x] (88fa4f07) **P1-3** `bomForPermit.ts:677` DC OCPD from `firstStr` (fence) — use per-sub
  `dcStrings[].ocpdAmps`.
- [x] (88fa4f07) **P1-4** Two cold-Voc laws: β-based (`compliancePages.ts:544-573` + designTemps)
  vs blanket ×1.25 (`fieldLabels.ts:125-127`, `compliancePages.ts:579`). Pick β-based.
- [ ] **P1-5** systemType scalars: `projects`/`layouts` say roof, config says fence,
  stamps say hybrid; route crowns projects.system_type. 6 projects have mixed stamps
  with single-valued scalars. Fix: partition-derived; scalars = display labels.
- [ ] **P1-6** Pitch: config.roofPitch=20 vs roof_planes 27.5° vs stamps 27.6 — three
  sources, and cover/arrayPages/structural resolve differently (documented 4:12 vs
  3.6:12 vs 4/12 case at coverSheet.ts:63-66). Fix: planes → canonical.site → all.
- [ ] **P1-7** Wind/snow/seismic: AHJ-DB-wins (route) vs canonical fill-only
  (generatePermit:294-315) — printed value and V4-analyzed value resolve via different
  chains. Fix: one resolution onto canonical.site before both.
- [x] (88fa4f07) **P1-8** `wireLength` fill-only heal: stale client scalar BLOCKS the CAD-derived
  run length (`generatePermit.ts:268,279`); `wireGauge` never healed. CAD wins.
- [ ] **P1-9** Sub-tag resolution exists 3×: route self-heal (gated, can partially
  no-op), subScopedInput map-by-id, conductorAuthority majority-string. One resolver.
- [x] (88fa4f07) **P1-10** dcAcRatio: three derivations (system, engine summary, sldAdapter:232).
- [ ] **P1-11** Fictional per-module W: `totalDcKw/totalPanels` (electricalPages:1016,
  arrayPages:316) yields ~418W matching no real panel on mixed-wattage hybrids.
- [ ] **P1-12** Singles not tri-synced: `cad.totalDcKw` vs `system.totalDcKw` divergence
  possible outside hybrids (sheet owner split documented in consumer audit C2).
- [x] (88fa4f07 geometry resolver) **P1-13** Ground stamps tilt 25°/az 181° vs layout columns 40.16°/121.6° — both
  ride the permit input. **NEEDS RAY'S RULING on which is the real design.**
- [x] (mig 112 written — RAY RUNS) **P1-14** `layouts.fence_line = []` while 18 collinear fence panels exist (wipe
  recovery restored panels, not the line). Reconstruct + save-time invariant.
- [ ] **P1-15** topology/mounting/wireGauge single project-wide values on hybrids
  (client #6/#7/#8); busbar/main `||200` defaults duplicated cover vs engine.

## P2 — HYGIENE / LATENT

- [ ] **P2-1** String-color palette ×3 byte-identical (arrayPages/drawing/fence) — export one.
- [x] (88fa4f07) **P2-2** STD_ENCLOSURES + nextEnclosure duplicated twice inside bom-engine-v4.
- [ ] **P2-3** M→FT / IN→M constants at differing precision across 8+ files — one units module.
- [ ] **P2-4** `rec-alpha-pure-405` id collision: HJT Alpha Pure-R (equipment-db:357) vs
  TwinPeak 5 PERC (lib/db.ts:80) — finish the mig-101 unification; db.ts re-exports.
- [ ] **P2-5** engineering_runs: unscoped 4.00 kW run interleaved with 39.07 runs —
  add scope column or exclude partial runs.
- [x] (mig 109 written — RAY RUNS) **P2-6** 5 stamp-hybrid projects have NO subSystems map (Carpenter, Sol Fence
  quote, Scam Likley, New Client, Markulis) — the §1.1 stamp-inference backfill
  migration should stop being optional. **RAY runs via Admin → System Tools.**
- [ ] **P2-7** subSystems map trusted from the client POST; DB row should win (route
  already restores when missing — make it always-DB).
- [ ] **P2-8** 144.8A vs 145A formatting split (PV-5 precise vs E-1 rounded) — one formatter.
- [ ] **P2-9** VAL-1 prints `N × single-wattage = mixed-total` — self-contradictory
  arithmetic on hybrids.
- [ ] **P2-10** `subSystemSheets.ts:216-217` fallback multiplies and divides by the same
  count — yields project total as "sub total" when counts coincide.

## NEW (found during the attack, 2026-07-19 PM)

- [ ] **N-1** `lib/drafting/templates/roof.ts:149-150,1443` — PV-1 "NEW ARRAY AREA (ACTUAL)"
  stat still from panel0 scalars ||66x40 (true REC-405 => ~1,124 ft2 vs printed 990). Route
  through panelSpecs (verify-lead F3).
- [ ] **N-2** hybrid SCHED DC-string rows print "—" for Isc/OCPD when payload strings lack isc —
  conductorAuthority dcStringRow should backfill from the sub's resolved panel spec (verify F4).
- [ ] **N-3** `buildPermitCoverSheet.ts:50` still computes its own backfeed estimate — fold into
  authority (w1 flag).
- [ ] **N-4** PermitInput should formally carry `generatedAtIso?` (types.ts; local cast used).
- [ ] **N-5** MIGRATIONS 109-112 WRITTEN, NOT RUN — Ray runs in order 109→110→111→112.
- [ ] **N-6** 112 leaves 17 multi-segment fence layouts empty on purpose — studio re-trace list
  in the migration header.

- [ ] **N-7** Bare-vs-healed authority OCPD basis: buildConductorAuthority on an
  un-healed input falls back to panel-watts for per-micro amps (missing
  acOutputKw), landing large branches on a different breaker step (30 vs 25 A)
  than the healed pipeline. Engine should write resolved per-device AC back
  onto the input (P1-1 family) so both bases are identical.
- [ ] **N-8** SVG id collisions across sheets (CLASS): clipPath/pattern/gradient ids
  repeat in every embedded sheet svg; the document-global first-definition wins.
  Fixed for roof.ts clips (sbclip*/pv2site-clip namespaced by mode, 2026-07-20 —
  PV-1B's rafters/fire-bands were being clipped by PV-1's plane geometry). AUDIT
  the other templates (fence/ground/SLD) for the same class.

## FIX WAVES (proposed)

1. **Wave INTAKE-1 (code, no DB):** P0-1, P0-2/3/4 (per-sub panel spec resolution
   server-side), P0-5, P0-8, P0-9, P0-10, P0-12, P1-1..P1-4.
2. **Wave INTAKE-2 (studio + save path):** P0-6 stamp-from-db + re-stamp-on-save,
   P0-7 one nameplate function, P0-11 mirror regeneration, P1-5..P1-9.
3. **Wave INTAKE-3 (migrations, Ray runs):** stamp normalizer, system_size backfill,
   subSystems inference backfill (P2-6), fence_line reconstruction (after P1-13/14 rulings).
