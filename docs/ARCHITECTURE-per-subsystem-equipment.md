# SolarPro Per-Subsystem Equipment Architecture — FROZEN CONTRACT v1.0

Synthesis base: **Tag-and-Aggregate (P1)** wave-coupling + hash/gating semantics, grafted with **SSE (P3)** deterministic mirror + provenance + flat consumer wave, **First-Class (P2)** dedicated verification wave, and fixes for every judge-verified fatal flaw (including the two shared ones no proposal addressed: the old-client whitelist-strip hole and per-inverter breaker rounding in 705.12(B)).

---

## 1. THE CONTRACT

### 1.1 Vocabulary

```ts
// lib/permit/utils/subSystems.ts — ALREADY the partition primitive; export its key type.
export type SubSystemKey = 'roof' | 'ground' | 'fence';
```

**Authority hierarchy (frozen — resolves every stamp/tag disagreement):**
1. **Membership authority** = `layouts.panels[].systemType` stamps → `partitionSubSystems()`. Panels never guess membership from equipment.
2. **Equipment authority** = the `subSystems` map (below). Survives inverter regeneration.
3. **Inverter/string `subSystemKey` tags** = derived cache, re-stampable from (1) at every hydration. On disagreement after a CAD re-import, tags are re-derived from panel stamps; equipment choices are NOT lost because they live in (2), keyed by `SubSystemKey`, not on the inverter objects.

### 1.2 The per-subsystem equipment record (one shape, reused at every layer)

```ts
interface SubSystemEquipment {
  key: SubSystemKey;
  // Equipment — ALL OPTIONAL. A fence drawn in CAD before equipment is picked is representable.
  // (P2's required fields rejected: they force placeholder ids — the 'qcells-peak-duo-400' contamination class.)
  panelId?: string;
  inverterId?: string;                 // ecosystem root; topology implied via equipment-db registry
  topology?: 'string' | 'micro' | 'optimizer';
  ecosystemBrand?: string;             // 'enphase' | 'ecoflow' | 'solis' | 'apsystems' | ...
  optimizerId?: string;
  mountingId?: string;                 // IronRidge roof / SolFence fence / ground racking
  batteryId?: string | null;
  batteryCount?: number;
  batteryKwhPerUnit?: number;          // RENAMED, per-unit ONLY — structurally kills the battery-reverts ratchet
  bosDeviceIds?: string[];             // per-sub integrated BOS brains (extends project.bosDeviceIds precedent)
  roofType?: string;                   // roof only
  trenchRunLengthFt?: number;          // ground/fence only
  env?: { rooftopTempAdderC: number;   // 30 roof / 0 ground+fence
          conduitType?: string; wireLengthFt?: number };
  rsdRequired?: boolean;               // DERIVED: key==='roof' && !inverter.rsdIntegrated (NEC 690.12 scopes to buildings)
  source: 'design' | 'engineering' | 'defaults' | 'migration';
  updatedAt: string;                   // ISO — Frankenstein interleaves become diagnosable, not forensic
}
```

### 1.3 Storage — three JSONB homes, one flow direction, ZERO SQL migrations

| Home | Role | Additive field |
|---|---|---|
| `layouts.design_electrical` | **Design truth** (Design Studio authors it) | `subSystems?: Array<{key, topology, panelId, rackingId, microModelId?, optimizerModelId?, strings, byPanelId}>` split via `classifyPanel` on panel stamps; flat legacy fields = primary mirror |
| `projects.engineering_config` | **Electrical authority** (permit consumes it) | `ProjectConfig.subSystems?: Partial<Record<SubSystemKey, SubSystemEquipment>>` + `defaultsAppliedBySubSystem?` + `schemaVersion: 2` on the envelope. Declared in BOTH ProjectConfig copies (page.tsx:220 + engineering-helpers.ts — reunify/re-export in Wave 1). `InverterConfig.subSystemKey?`, `StringConfig.subSystemKey?` (inherits parent inverter) |
| `projects.selected_equipment` | **Cross-app sync mirror** | `subSystems?: Partial<Record<SubSystemKey, SubSystemEquipment>>` + `schemaVersion: 2`. Top-level panelId/inverterId/mountingId/batteryId REMAIN = primary mirror |

**Permit carriage:** `PermitInput.system.inverters[].subSystemKey?`; `cad.hybrid.sections[].equipment?` (panelModel, panelWatts, voc, isc, inverterMfr, inverterModel, topology, **acKwPerDevice** — per-device kW contract explicit); `RunSegment.subSystem?`; `BOMLineItemV4.subSystem?`; `SLDProfessionalInput.sources?: SLDSourceBranch[]`; `ElectricalCalcInput.InverterInput.subSystemKey?` + per-inverter env overrides.

**Non-negotiable tag-survival rule:** `subSystemKey` lands in BOTH field whitelists — `normalizeRawInverter` (lib/system/buildInverterConfig.ts:335) and `normalizeToPermitInverters` (lib/system/designToEngineering.ts:129) — in the same commit as the tag, and **the round-trip tag-survival test is commit #1, before the tag is used anywhere** (judge fix: convention → mechanical guard; a rebase dropping one whitelist edit fails CI, not prod).

**Old-client write protection (judge-added; no proposal had it):** `engineering_config` envelope gains `schemaVersion: 2`. The save-config route, on receiving a payload with `schemaVersion < 2` (or absent) for a project whose stored config has `schemaVersion >= 2`, **server-side re-normalizes**: re-tags inverters and re-synthesizes `subSystems` from `layouts.panels` stamps + the stored map before persisting. A pre-deploy browser tab can no longer strip every tag via its stale whitelist and auto-save the collapsed config. Same guard on `upsertSelectedEquipment`.

**`upsertSelectedEquipment` (lib/db/projects.ts:436):** per-key **deep merge** for the `subSystems` block (`jsonb_set` per subsystem key) — a fence write can never clobber the roof entry. Top-level keys keep shallow merge for legacy clients; their writes are detected via `schemaVersion` and re-mirrored, not interleaved.

### 1.4 Primary-mirror rule (DETERMINISTIC — P3, replaces P1's panel-count vote)

> **Primary subsystem = first present key in fixed order `roof > ground > fence`.**

Never a panel-count majority (a CAD edit shifting the majority must not flip proposal/pricing/resolveEquipment mid-migration). Every legacy flat mirror — `selected_equipment` top-level, ProjectConfig scalars, DesignElectrical flat block, `conductorAuthority` top-level, `PermitSystemModel` flat fields, `ElectricalCalcResult` aggregate — is **always derived from the map by this rule, single writer per store, never computed in parallel**. Enforced mechanically (Invariant I-5): a save-time assertion `mirror === deriveMirror(map)` runs in save-config and upsert paths; violation logs + repairs from the map.

### 1.5 Legacy collapse rule (one rule, every hydration boundary)

```
effectiveSubSystems = stored.subSystems
  ?? { [config.systemType ?? cad.systemType ?? 'roof']: synthesizeFromLegacyScalars(config) }
```

- Untagged inverter/string/InverterInput inherits `config.systemType` — **NEVER a bare `'roof'` default** (a saved fence-only project default-tagged roof flips its structural/BOM/RSD authority).
- Implemented as one idempotent `ensureSubSystemShape()` helper called from: `normalizeInverterConfig` (DB load), page.tsx:1544 savedConfig hydration, localStorage restore (page.tsx:1918 — can resurrect pre-migration snapshots), seed/no-seed/design-handoff paths, permit-route backfill, BOM/SLD route ingestion.
- **Pure and in-memory** — the DB row is untouched until the user saves (P1). Serialization is a superset of today's shape; every legacy reader sees identical values.
- No bulk backfill required. Optional idempotent backfill for existing hybrid rows via Admin → System Tools (per migrations-runner memory), inferring `subSystems` from panel stamps + design_electrical. Single-system rows never need it.

### 1.6 designVersionId rule (P1's degenerate-map rule, hardened against the rename)

Hash the **legacy shape** whenever the `subSystems` map is **absent OR degenerate** — degenerate = exactly one entry whose **canonical id-tuple** `(panelId, inverterId, topology, mountingId, batteryId)` equals the mirror's id-tuple. Comparing the id-tuple (not raw field equality) makes the test immune to the `batteryKwh → batteryKwhPerUnit` rename and to provenance fields (judge 1's fragility ding). The extended hash kicks in only for genuinely hybrid equipment. Result: no mass hash flip, no creeping fleet rebuild from auto-save write-back (P2's fatal flaw), no false-DO-NOT-ISSUE recurrence.

### 1.7 POI aggregation rule

**NEW `lib/computed-multi-system.ts`:**

```ts
computeMultiSystem(
  subInputs: Array<ComputedSystemInput & { subSystemKey: SubSystemKey }>,
  poi: { mainPanelAmps, busRating, interconnectionMethod, batteryBackfeedA }
): { subSystems: Array<{ key, cs: ComputedSystem, bomQuantities }>,
    aggregate: ComputedSystem /* -compatible flat view */ }
```

- Runs `computeSystem()` per sub **UNCHANGED** — own topology/panel/inverter-acKw-**per-device**/runLengths/`rooftopTempAdderC` (30 roof, 0 ground+fence).
- Run ids namespaced `${key}:${RunSegmentId}` **ONLY when N>1**; N=1 keeps bare ids (protects ~15 page.tsx `runs.find()` sites, permit-system-model fixed ids, stored artifacts, 5 SLD suites).
- Shared service runs (`DISCO_TO_METER_RUN`, `MSP_TO_UTILITY_RUN`) emitted **exactly once**, sized at Σ acOutputCurrentA — structurally kills the tributary double-count class.
- **Aggregator OWNS NEC 705.12(B)**, per-sub passes suppressed. **Breaker granularity fix (judge shared flaw):** backfeed = Σ over **each physical inverter's** `nextStandardOCPD(inverterAmps × 1.25)` within each sub, then summed across subs + battery — never one combined rounded breaker per sub, so the check matches the actual breaker schedule an AHJ reviews. SLD lane labels (PV-R/PV-G/PV-F) may draw one feeder breaker per lane, with the 120% panel computed from the physical per-inverter set and the assumption noted on PV-4A/E-1.
- Equipment tags suffixed `PV-R1/INV-G1/COMB-F1` only at N>1.
- **All deliberate NEC behavior changes gate strictly on N>1 subsystems present** — never on tag presence (tag-presence gates are defeated by migrate-on-load + auto-save: P3's verified fatal flaw). Summed-backfeed for legacy single-sub multi-inverter projects ships behind an explicit Ray-approved recompute flag.

**Downstream per-sub contracts:** `ElectricalCalcResult.subSystems[]` (Step 1–7 AC block extracted to a helper, run per sub + once at POI; the average-per-inverter breaker at electrical-calc.ts:671–674 deleted on the N>1 path; RSD + rooftop adder + 690.15 scoped per sub). `conductorAuthority.subSystems[key]` = {topology, microBranches, dcStrings, egc, governingOcpd, acSubFeeder} with **all top-level fields DERIVED from the set**; `perMicroA` from the sub's own AC kW / deviceCount, never totalAcKw/totalPanels (fixes today's live Stowell-class mis-sizing). `planMicroBranches` grouping key prefixed with sub key + non-Enphase capability profiles (APsystems/Hoymiles/NEP/EcoFlow). `resolveEquipmentBySubSystem(input, cad) → Partial<Record<SubSystemKey, ResolvedEquipment>>`; `getEquipmentContext` becomes the derived primary view. `BOMGenerationInputV4.subSystems?[]`: Stages 1–3 per sub (topology from the SUB's inverterId; RSD inside the loop, roof + non-integrated only), Stage 4 service gear + labels/truck-stock/tools run ONCE on summed amps; trunk resolver per micro sub; integrated BOS grouped by brand with real summed branchCount (replaces hardcoded 0); micro-strip and EcoFlow injection scoped to the owning sub's tag. `SLDSourceBranch[]`: absent ⇒ legacy renderer path byte-for-byte.

---

## 2. INVARIANTS (every consumer must satisfy; each is a pinned test)

- **I-1 N=1 byte identity.** For any single-subsystem project: `computeMultiSystem([x]) ≡ computeSystem(x)` run-for-run; run ids unprefixed; equipment tags unsuffixed; `generateBOMV4` without `subSystems` takes the exact old code path (identical `nextId()` sequence ⇒ byte-identical CSV/SCHED); SLD without `sources[]` untouched; electrical-calc parity unchanged; designVersionId unchanged (degenerate-map rule); planset PDF/SLD SVG byte-identical on the legacy corpus sweep.
- **I-2 Tag round-trip survival.** `subSystemKey` survives `buildInverterConfig → save → normalizeRawInverter → normalizeToPermitInverters → PermitInput`. Commit #1 test.
- **I-3 Any-system × any-manufacturer × hybrid-or-solo.** Each sub's topology, string sizing, trunk plan, RSD, BOS, racking BOM, and wire schedule derive from **that sub's own** `inverterId`/`panelId`/`mountingId` — never from a project-wide winner, `inverters[0]`, or a dominant vote. Golden fixture: Enphase micro roof + Solis string ground + SolFence **OPTIMIZER** fence (per SolFence data) proves fence topology comes from its own equipment.
- **I-4 No cross-sub bleed.** `planMicroBranches` leftover-merge cannot join fence panels onto roof branches (sub-prefixed grouping key); `applyPanelToEngineeringConfig(config, panelId, subSystem)` never re-pins another sub's strings; a fence `selected_equipment` write never clobbers the roof entry (deep-merge test); micro-strip never removes another sub's string items.
- **I-5 Mirror = f(map), single writer.** Every flat legacy field equals `deriveMirror(map)` under the fixed `roof > ground > fence` rule; asserted at save time; never authored independently (kills the EL-2/EL-4 divergence class).
- **I-6 Aggregator-owned POI.** Exactly one 705.12(B) check (Σ per-physical-inverter rounded OCPDs + battery), exactly one emission of each shared service run, exactly one AC disco/ground rod/POI label set in BOM Stage 4 — regardless of N.
- **I-7 Code-scope correctness at N>1.** RSD required only for roof sub without integrated RSD; rooftopTempAdderC 30/0; 690.15 per non-micro sub; ground/fence conductors never carry roof derates.
- **I-8 No silent collapse.** A fence-only project loads, computes, saves, and regenerates as `fence` (never default-`roof`); an old-schema client write cannot strip tags (server re-normalization, I-2 corollary); E-1 at N>1 **never** renders the stored single-system SVG or the inline buildSLD fallback — banner, never a plausible-wrong permit sheet.
- **I-9 Hash stability.** No legacy project's designVersionId changes from deploy, load, auto-save, or migrate-on-load synthesis; it flips only on genuine hybridization or map/mirror drift.
- **I-10 Behavior-change quarantine.** Summed backfeed and adder/RSD de-scoping observable only when N>1 (or the Ray flag is explicitly set). CI feeds a tagged-but-single-sub fixture (post-normalizer, not raw — closes P3's green-tests-wrong-prod hole) and asserts zero diff.

---

## 3. IMPLEMENTATION WAVES

**Wave 0 — Goldens + tag-survival test (½ day, 1 worker).** Files: `tests/*` only. Pin BEFORE any code: BOM legacy snapshot (nextId sequence), computeSystem run-id set, electrical parity, SLD suites baseline, save-config write-back snapshot, I-2 round-trip test (red until Wave 1), I-10 tagged-single-sub no-diff fixture. *Locks: the entire regression bar.*

**Wave 1 — Contract & tag survival (1–1.5 days, 1 worker; atomic).** Files: `lib/permit/utils/subSystems.ts`, `lib/system/buildInverterConfig.ts` (+ whitelist :335), `lib/system/designToEngineering.ts` (whitelist :129), both ProjectConfig copies (reunify), `types/index.ts`, `lib/permit/types.ts`, `lib/cad/types.ts`, `lib/bom-types-v4.ts`, `lib/db/projects.ts`, save-config route. Ships: all types; `ensureSubSystemShape`; engineering_config + selected_equipment `schemaVersion: 2` + server-side re-normalization of old-client writes; deep-merge upsert; deterministic mirror derivation (**applied only when a map with N>1 exists** — single-entry maps mirror identically to today, so Wave 1 has zero live behavior change, fixing P3's Wave-1 flaw); degenerate-map hash rule; I-5 save-time assertion; 256KB payload-size logging. *Locks: I-2, I-5, I-9, deep-merge non-clobber, mirror determinism.*

**Wave 2 — Engines (2–3 days, 4 parallel workers, disjoint pure-lib files; exit gate = I-1 green).**
- **2a Compute:** new `lib/computed-multi-system.ts`; `lib/computed-system.ts` (RunSegment.subSystem, emitSharedServiceRuns flag, per-device-kW assertion); `computedRuns`/`deriveRunLengths` take explicit systemType + panel subset (kills hardcoded 33 °C).
- **2b Electrical:** `lib/electrical-calc.ts` — AC helper extraction, per-inverter-rounded summed backfeed (N>1 path), delete :671–674 fork, RSD/adder/690.15 scoping, `result.subSystems[]`, EngineeringModel honesty fix.
- **2c BOM:** `lib/bom-engine-v4.ts`, `lib/equipment/trunkCable.ts`, `lib/equipment/integratedBos.ts` — per-sub Stages 1–3 inner fn, single Stage-4 pass, brand-grouped BOS with real branchCount, genericized truck-stock spares, `BOMLineItemV4.subSystem` stamped in addItem.
- **2d Permit authority:** `lib/permit/utils/helpers.ts` (`resolveEquipmentBySubSystem`), `lib/permit/utils/conductorAuthority.ts` (per-sub set, derived top-level, per-sub perMicroA), `planMicroBranches` fencing + capability profiles, `generatePermit` fallback per-sub InverterInputs.
*Locks: I-1, I-3 (engine half), I-6, I-7, hybrid engine fixtures.*

**Wave 3 — Engineering page atomic trio + sync + memo (2–3 days, 1 worker, serialized; riskiest wave, cannot be split — mutually protective).** Files: `app/engineering/page.tsx` + `lib/db/projects.ts` consumers. (1) Tags at every hydration source (:1365/:1466/:1494/:1918/:1544) via `ensureSubSystemShape`; (2) staleness gates re-keyed per sub **first** (:1551 count gate discards only the mismatched sub, with equipment preserved in the map per §1.1 — a fence CAD edit can never nuke roof engineering); (3) all 7 watchers scoped to one sub's fleet (:2312, :3603, :3749, :3821, :3858, :6106, :6232); (4) per-sub smartDefaults (`sizeSystemFromBrand` × present subs, `getDefaultBrand(key)`, `defaultsAppliedBySubSystem`); (5) selected_equipment reconcile per key with composite ref-guards; (6) battery-reverts fix (per-unit write, hydration-complete gate — it's a watcher, so it belongs here); (7) memo → `computeMultiSystem` with cs=aggregate alias + migrate ~15 `runs.find()` sites **+ versioned client-passthrough recompute guard on the SLD/plan-set routes in the same wave** (recompute-on-miss for `${sub}:`-prefixed ids — closes the interim Diagram-tab break; the Diagram tab shows the hybrid banner, never a silent failure, until Wave 5). Locks stay global-MVP (subKey threaded through `shouldAllowOverride`; per-sub locks are a fast-follow — no persisted-lock shape migration under deadline). *Locks: I-4 (page half), I-8, I-10; N=1 goldens re-run after every commit in this wave.*

**Wave 4 — UI + design-side writers (1.5–2 days, 2 parallel lanes, disjoint files).**
- **Lane A — Design Studio + routes, coupled (writer and shape ship together — P2's dead-sync window is structurally excluded):** `equipmentBySubsystem` state replaces the single selection (:619–631); ~12 generator call sites read their own sub's panel; `buildDesignElectrical` emits per-sub blocks + mirror; layout route stops project-wide panelId promotion **in the same deploy**; `/equipment` + production routes accept `systemType` scope; hardcoded `qcells-peak-duo-400` fallback → per-sub resolution + loud warn.
- **Lane B — Engineering System Config tab UI** (per-sub sections: inverter groups by tag, battery/mounting/EcosystemPicker per section — pure rendering over Wave-3 state) + calculate route (per-inverter topology guard, `generateStringConfig` per sub group, `stringConfigs` keyed by sub + legacy mirror) + BOM route (`body.subSystems[]`, per-sub micro-strip/EcoFlow, dominant-sub legacy response fields).
*Locks: I-3 (authoring half), I-4 (writer half), studio→engineering round-trip test.*

**Wave 5 — SLD multi-lane + planset sheets (2–3 days, 2 parallel lanes; ONE worker owns all page.tsx edits — P3's Wave-5 conflict excluded).**
- **Lane A — SLD:** `renderSourceLane(branch, laneY)` refactor of NODE 1–5; lanes join vertical POI bus into shared MSP→Meter→Grid tail; multi-backfeed MSP + summed 120% panel **land atomically with the lanes** (never multi-lane visuals over one-breaker math); per-branch contamination guard/calc panels; auto-scale k<1; adapter partitions via Wave-2 authority; `sources[]` in all four input builders; artifact version stamp; stored-SVG hybrid skip.
- **Lane B — Sheets:** PV-4A/4B kill the MICRO-else fork (per-sub AC-branch AND DC-string schedules; feeder rows SUM into one POI calc; adder wording roof-only); PV-1B per-sub sections (RB1/GS1/FS1); SCHED sub-system column; cover per-sub summary lines; datasheet appendix distinct panels/batteries per sub (manifest mirrored); E-1 guards; secondary sweep (certPages, compliancePages, validationPage, fieldLabels, titleBlock, bomForPermit, rules-engine, computed-plan) to the map or explicit `getPrimaryEquipment`.
*Locks: SLD legacy-path suites unchanged + new sources-path suites; I-8 E-1 guard test; real build for template-literal sheet edits (memory rule).*

**Wave 6 — Verification, Ray decisions, cutover (1–2 days, 1 worker + Ray).** End-to-end Stowell-class golden planset (Enphase micro roof + Solis string ground + SolFence optimizer fence): both run families, single service feeder, summed 120%, roof-only RSD, three datasheet panels, three-lane E-1. Legacy-corpus byte-identity sweep (regenerate real single-system projects; diff planset/BOM CSV/SLD SVG — must be identical). Harness render-verify E-1/PV-1B/PV-4A/4B/SCHED **before Ray tests** (memory rule). Optional Admin → System Tools backfill. **Ray decisions REQUIRED BEFORE banner retirement (not after):** (a) shared-raceway fence+ground trench rule — v1 emits an explicit warning + "shared raceway unsupported" note whenever ground+fence coexist; (b) summed-backfeed recompute flag for legacy single-sub multi-inverter projects. Then retire the Phase-0 DO-NOT-SUBMIT banner (gate flips to "per-sub authority present + fixture green"). Profile worst-case 3× optimizer allocation once.

Total: ~10–14 worker-days; critical path Wave 0→1→2→3; Waves 4–5 fan out.

---

## 4. TOP RISKS & MITIGATIONS

1. **Old-client tag stripping (the last silent hybrid-collapse path).** A pre-deploy tab hydrates through its stale whitelist, strips every tag, auto-saves. → `schemaVersion: 2` on engineering_config + selected_equipment; save routes re-normalize/re-tag from `layouts.panels` stamps server-side; I-2 round-trip test is commit #1.
2. **Wave 3 regression concentration (13k-line page.tsx, 7 watchers, 3 gates).** Unsplittable by design (tags/gates/reconciler are mutually protective). → Slimmed to only the coupled set (UI moved to Wave 4); N=1 goldens run per-commit; DO-NOT-SUBMIT banner keeps every intermediate deploy prod-safe for hybrids; gates re-keyed before anything else in the wave.
3. **Mirror drift / Frankenstein recurrence.** → Deterministic `roof>ground>fence` derivation, single writer per store, save-time `mirror === f(map)` assertion (I-5), per-entry `source`/`updatedAt` provenance turning interleaves into logged events.
4. **Fleet-wide report invalidation via hash flip.** → Degenerate-map rule on the canonical **id-tuple** (immune to migrate-on-load synthesis, lazy write-back, and the batteryKwhPerUnit rename); I-9 pinned.
5. **NEC behavior changes leaking to issued plansets.** → Strict N>1 gate (never tag presence); I-10 CI fixture is post-normalizer tagged-single-sub; legacy summed-backfeed behind an explicit Ray flag with a decision memo.
6. **CAD re-import stamp/tag disagreement nuking equipment.** → Authority hierarchy (§1.1): stamps own membership, the map owns equipment, tags are re-derived cache; per-sub count gate discards only the disagreeing sub's inverters and re-seeds from `subSystems[key]` before defaults.
7. **Shared-raceway undersizing (only non-conservative failure mode in the program).** → Not solved in v1; explicit warning emitted when ground+fence coexist; Ray decision gates banner retirement (Wave 6), not deferred past it.
8. **705.12(B) undercount vs physical breaker schedule.** → Per-physical-inverter OCPD rounding within each sub before summing (§1.7); assumption printed on PV-4A/E-1.
9. **Interim hybrid Diagram-tab break (namespaced run ids before Wave 5).** → Versioned passthrough + recompute-on-miss lands in Wave 3 with the memo migration; hybrid Diagram tab shows the banner, never a silent resolve-to-nothing.
10. **256KB save-config ceiling.** → Payload-size logging in Wave 1 with alert threshold at 200KB (panelCoordinates-heavy configs are already near it; the map adds <2KB).

**Explicit v1 non-goals (documented on PV-4A/E-1):** per-panelboard/sub-panel 705.12(B), PCS (2023 NEC 705.13), per-sub interconnection methods, mixed micro+optimizer within one subsystem, per-sub field locks, deletion of the inline E-1 buildSLD duplicate (guarded, not deleted — fast-follow after the live renderer is proven).
---

## Addendum A — Roof mounting is a PAIRING, not a single id (Ray ruling, 2026-07-11)

> "RT Mini gets a rail. We personally pair with IronRidge. The added L-foot has many different pairings."

The roof mounting axis decomposes into **attachment × rail system**: the attachment
(RT-MINI flashed pad, lag-into-rafter foot, S-5! clamp, …) and the rail system
(IronRidge XR, Unirac SM, …) are separately chosen, composable products joined by
an L-foot whose pairing varies. Consequences for this contract:

- `SubSystemEquipment.mountingId` remains the single resolved id for v1, but the
  equipment registry's `requiredAccessories` on an attachment-type entry represent
  the DEFAULT pairing (RT-MINI → IronRidge XR set is Ray's real install method,
  not a template error). Quantities must always scale to the subsystem's module
  basis.
- A future minor revision may split `mountingId` into
  `{ attachmentId, railSystemId }` for roof subsystems so pairings become explicit
  user choices; the BOM engine's rail-formula categories are already isolated
  (RAIL_FORMULA_CATEGORIES) making that split mechanical.
- `RAIL_LESS_ROOF_RACKING` (bom-engine-v4) exists for genuine direct-attach
  systems and is intentionally EMPTY until one is cataloged.

---

## Addendum B — Ray rulings (2026-07-12), Wave-6 gates resolved early

1. **Shared trench, separate conduits.** "They won't share a raceway. But we can
   combine a trench and share conduit space." → When ground + fence (or any two
   sub-systems) run toward the POI along combinable paths, the BOM may emit ONE
   shared trench-footage line but MUST keep per-subsystem conduits (no shared-
   raceway conductor derating scenario in v1). Trench dedup is an optimization,
   never a merge of raceways.
2. **Legacy backfeed recompute: always recompute.** "No one has a working hybrid
   project. So regenerating will be fine." → No freeze flag; regeneration always
   recomputes summed backfeed / 120% busbar math from the current sub-system set.
3. **Pricing basis confirmed** — SolFence quantities/prices per the 2026-06-21
   distributor sheet remain authoritative until Ray issues a revision.
4. **Fire-setback geometry** (found during the campaign, fix in flight): setbacks
   are measured ALONG THE ROOF SURFACE; plan-view drawing/checking must foreshorten
   fall-line dimensions by cos(pitch), and the ≤33% coverage test must use one
   consistent area basis. Stowell's design (top edge exactly 36" along-slope) is
   compliant; the 16 flags were phantom.
