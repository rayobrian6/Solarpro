# Unified Mount-Type Structural + NEC Engine — Design Spec

**Status:** DESIGN — spec first, no implementation. **Date:** 2026-06-20
**Owners:** SolarPro engineering. **Resolves audit findings:** C3 (3 structural engines), C8 (3 NEC paths), RC‑1 (fabricated defaults), RC‑2 (single source of truth), RC‑6 (silent-swallow), plus the 14 unified-engine requirements in `GROUND-FENCE-ACCURACY-AUDIT-2026-06-20.md`.

> **PE GATE (read first).** Ground foundation/embedment and fence post-overturning are PE-stamped structural engineering. The formulas specified here (IBC 1807.3 lateral embedment, soil bearing, freestanding-wall overturning) are **design targets, not approved math**. They must be validated by a licensed structural PE before any ground/fence structural output is presented as "engineered." Until then the existing **"ESTIMATE — not engineered" guardrail** (`page.tsx` ~10320) stays up for `systemType !== 'roof'`. This spec is explicitly sequenced so the unification work (interfaces, routing, NEC) ships *without* unblocking the PE-gated geotech output.

---

## 1. Goal

Collapse the duplicated, divergent engines into **one structural engine of record** and **one NEC engine of record**, both **mount-type first-class** (roof / ground / fence), so the same project produces the same numbers on every tab, and ground/fence stop silently receiving a roof stamp.

Two diseases, one cure each:
- **C3 — three structural engines** (V1 `structural-calc.ts`, V3 `structural-engine-v3.ts`, V4 `structural-engine-v4.ts`) give different PASS/FAIL for the same input.
- **C8 — divergent NEC paths** (`computeSystem` in `computed-system.ts`, the `/calculate` route's separate `runElectricalCalc`, and historically the SLD route) compute OCPD/Voc/wire differently per tab.

---

## 2. Current state (grounded 2026-06-20, corrected vs. the stale audit)

The audit was written before several fixes landed. Verified current reality:

### 2.1 Structural — genuinely three engines, one already mount-aware
| Engine | File / entry | Called by | Mount types | Notes |
|---|---|---|---|---|
| **V1** | `lib/structural-calc.ts:232` `runStructuralCalc` | `/api/engineering/structural` | `systemType` field is **vestigial** (roof math only) | Header marks DEPRECATED. Interior-zone wind only. |
| **V3** | `lib/structural-engine-v3.ts:726` `runStructuralCalcV3` | `/api/engineering/structural-v2` (the live engineering **tab**) | **Roof only** | C2 fix landed: `roofZone='corner'` (`:769`). Auto mount-spacing, rail+rafter, racking BOM. |
| **V4** | `lib/structural-engine-v4.ts:927` `runStructuralCalcV4` | `/api/engineering/calculate` | roof_residential/commercial, commercial_ballasted, **ground_mount**, tracker, carport | C2 fix landed (`:970`). **Has real ground branches** (`analyzeGroundMount :655`, `analyzeBallast :588`, `analyzeTracker :735`) — but they are **dead from the app** (§2.3). No `fence`. |

**Key correction:** ground is **not** net-new — V4 already models pile count / embedment / per-pile uplift-downward-lateral. It is (a) unreachable and (b) flawed (roof wind fed in, fake lateral = `uplift×0.3`, unsourced pile literals, frost default 36"). **Fence is genuinely net-new** — `'fence'` is absent from `InstallationType` (`lib/structural/types.ts:46-52`) and no engine has a fence branch.

### 2.2 NEC — already mostly unified around `computeSystem`
- `computeSystem` (`lib/computed-system.ts:871`) is the **canonical engine**. It computes 690.7 Voc temp-correction (`:937`), max panels/string (`:942`), 690.8 string/AC OCPD (`:1006/:1164`), the **705.12 120% rule correctly** (`:1185-1187`, uses `panelBusRating×1.2`, sums battery backfeed — C1/C9 fixed), wire/EGC/conduit/Vdrop.
- The **SLD route** (`/api/engineering/sld`) calls `computeSystem` **once** (v25 single-source) and the renderer only *mirrors* the 120% result for display (`sld-professional-renderer.ts:2227`) — it no longer recomputes. **So the SLD path is already consuming the engine of record.**
- The **`/calculate` route** is the real remaining fork: it uses a **separate** `runElectricalCalc` (`lib/electrical-calc.ts:348`) + `generateStringConfig` for the Compliance tab, with its own fabricated panel fallbacks (`calculate/route.ts:96-99` → `Voc ?? 49.6`, `Isc ?? 10.18`, etc.).

**Key correction:** C8 is effectively **two** NEC engines of record now (`computeSystem` vs `electrical-calc`), not three. Unification = retire `electrical-calc`'s overlapping math, make `/calculate` consume `computeSystem`.

### 2.3 The one-line dead-code root cause
`installationType` is **set nowhere** in `app/engineering/page.tsx` (grep: 0 matches). The structural payload omits it, so `calculate/route.ts:291` does `installationType: structural.installationType ?? 'roof_residential'` → **every ground/fence job runs the roof path**, even though V4 could branch. This is the single highest-leverage unlock.

### 2.4 Silent-swallow (RC-6) confirmed live
`calculate/route.ts:318-322`: any V4 crash is caught and converted to `{status:'WARNING'}`; downstream reads `?? 'PASS'`. A thrown engine = a passing stamp. Must fail closed.

### 2.5 What's already good (do not rebuild)
BOM mount handling is mature: RSD suppression for ground/fence (`bom-engine-v4.ts:429`, 690.12(B)(2)), trench PVC vs above-ground split (`:394-408`, 300.5), grounding-electrode dedup (`bom/route.ts:36`), ground pile/beam + fence post/rail/grounding profiles (`bom-system-profiles.ts`). `trenchRunLengthFt` is wired UI→BOM. Brand `supportedSystemTypes` already gates fence (Enphase, EcoFlow) vs ground (11 brands). **The BOM is not part of this unification beyond consuming the new engine's geometry.**

---

## 3. Target architecture

```
                         ┌─────────────────────────────────────────┐
   config (systemType,   │   resolveMountContext(config)            │
   groundData, fenceData)│   systemType → MountContext              │
        ────────────────►│   (installationType, soil, frost,        │
                         │    rowSpacing/GCR, fenceHeight/line,      │
                         │    trenchRunFt, brand caps)               │
                         └───────────────┬─────────────────────────┘
                                         │  one typed context, every consumer
              ┌──────────────────────────┼──────────────────────────┐
              ▼                                                      ▼
   ┌─────────────────────┐                            ┌──────────────────────────┐
   │ STRUCTURAL of record│                            │   NEC of record          │
   │  runStructural() V5 │                            │   computeSystem()        │
   │  branch: roof|ground│                            │   + mount rules          │
   │        |fence       │                            │   (RSD, 300.5, runs)     │
   └──────────┬──────────┘                            └────────────┬─────────────┘
              │ StructuralResult (discriminated by mount)          │ ComputedSystem
              ▼                                                    ▼
   tab + /calculate + report  ◄── one result ──►  SLD + BOM + equipment schedule
```

**Two engines of record, one shared mount context.** Every tab/route/renderer *consumes* their output; no layer recomputes (RC‑2).

### 3.1 Structural engine of record = V5 (evolve V4, retire V1 + V3)
V4 is the only engine with mount branches and the cleanest types, so **V5 is V4-lineage**, not a rewrite. Steps:
- **Retire V1** (`/api/engineering/structural`): redirect the route to V5; delete `structural-calc.ts` after no callers remain.
- **Retire V3** (`/api/engineering/structural-v2`, the tab): the tab is the most-used path, so this is the careful one. Point the tab at V5; preserve V3's tab-facing output fields (arrayGeometry, mountLayout spacing, rackingBOM) by carrying them in the V5 result.
- **V5 = V4 + `fence` branch + geotech/wind fixes** (§4).

### 3.2 NEC engine of record = `computeSystem` (retire `electrical-calc` overlap)
- Make `/calculate` build a `ComputedSystemInput` and call `computeSystem` for all overlapping quantities (Voc/OCPD/wire/120%), keeping only `electrical-calc`'s *compliance-report shaping* on top.
- Delete the fabricated panel fallbacks at `calculate/route.ts:96-99`; resolve real specs from equipment-db or surface "unresolved equipment" (RC‑1 — gated on Ray's pending decision; spec stays compatible with either banner-or-fail).
- Parameterize the 240 V divisor → `systemVoltageAC` from service config (240/208/277) so 3‑phase/208 V isn't silently wrong (H11). Default 240 V single-phase.

---

## 4. Mount-type branching design

`MountContext.kind ∈ { roof, ground, fence }` discriminates every load case. Add `'fence'` to `InstallationType` (or introduce a parallel `MountKind` and map). Each branch:

### 4.1 Roof (no behavior change — already correct)
ASCE 7‑22 roof C&C zones (corner-governing, C2), Kz at mean roof height, rafter/lag/rail. Keep as-is; it's the validated path.

### 4.2 Ground (fix the existing V4 branch — PE-GATED math)
- **Wind:** exposed-terrain Kz at **array height** (not roof height), open-structure / ground-solar coefficients with **row-position + GCR** (front row governs), not Fig 29.4‑7 roof-solar GCp.
- **Foundation:** embedment from **lateral load + soil class per IBC 1807.3** (non-constrained post formula), real `soilType` (no unsourced 8000/12000/5000 pile literals), frost depth **jurisdiction-derived** not defaulted 36".
- **Lateral:** real lateral from wind on the tilted plane, not `uplift×0.3`.
- **Snow:** tilted-basis with drift, **added to pile downward demand** (currently omitted).
- **Gate rafter analysis OFF** for ground (no rafters).

### 4.3 Fence — `analyzeFence` (NET-NEW — PE-GATED math)
- **Wind:** ASCE 7‑22 Ch. 29 **freestanding-wall** (full-sail face), solid-sign coefficients, height/aspect factors.
- **Posts:** cantilever post **overturning + bending**, embedment vs (moment + frost + soil), panel-as-infill load transferred to posts.
- **Inputs:** `fenceHeight`, `fenceLine` length, post spacing, infill type.

### 4.4 NEC mount rules (in `computeSystem`)
- **RSD:** suppress for ground/fence (690.12(B)(2)) — already in BOM; make the **engine** assert it too so the schedule/SLD agree.
- **Underground:** 300.5 burial + PVC for the trench subset; **250.32** aux electrode at detached structure; direct-burial conductor allowance.
- **Run lengths:** DC/AC from real array-to-service distance (`trenchRunLengthFt` + CAD), not roof 50/60 ft literals.

### 4.5 HYBRID / MULTI-MOUNT — mount type is PER-SECTION, not per-project (REQUIRED)
**Current limitation (must fix):** `config.systemType` is a single project scalar (`app/engineering/page.tsx` `ProjectConfig.systemType`). One property cannot today carry a roof array **and** a ground array **and** a fence simultaneously — every panel is stamped with the one chosen mount type; the other sections get wrong structural/NEC/BOM. The `MountContext` in §5.1 as first drafted is also singular and inherits this. A real property (e.g. roof + ground + fence) needs all three at once.

**Target model — a project is N sub-arrays, each with its own `MountContext`:**
- **Data model:** introduce a `sections: ArraySection[]`, each `{ id, mountContext: MountContext, panels/strings, geometry }`. `systemType` becomes a per-section field, not a project scalar. Inverters/strings reference the section they sit on. (Migration: a legacy single-`systemType` project = one section.)
- **Structural:** run the engine **per section** — each gets the correct branch (roof zones / ground geotech / fence overturning). No single stamp for the whole property. Output is a per-section result list; the tab/permit show each section + an overall roll-up.
- **BOM:** aggregate per-section hardware — roof rails+flashing for the roof section, piers+concrete for the ground section, posts+footings for the fence — then merge. (`bom-engine-v4` already takes `groundData`/`fenceData`; extend it to take **a list** keyed by section, not a single mount branch.)
- **NEC:** RSD/300.5/run-length rules apply **per section** (roof section keeps RSD; ground/fence sections are exempt + get trench conduit), but the **interconnection (705.12), main panel, AC OCPD, and the single point of common coupling are SHARED** — that aggregation is the part that must NOT be split. One POI, summed backfeed across all sections.
- **Sizing/layout:** per-section tilt/azimuth/rowSpacing/fenceLine; one system kW roll-up.

**Why the engine-of-record work enables this:** once ONE structural engine and ONE NEC engine run per section and the views aggregate, hybrid falls out naturally — it's a loop over sections, not a fork in every consumer. Building per-section now (vs retrofitting) is the difference between a clean loop and re-touching every tab. **This is a larger data-model change (config schema + UI for adding sections + per-section structural display) — sequence it after the single-mount unification lands, but design the `MountContext`/engine signatures to take a section list from the start so it's not a rewrite.**

---

## 5. Interface contracts (the spec's core)

### 5.1 `MountContext` (new — the shared discriminator)
> **One `MountContext` describes ONE section.** A project carries a `MountContext[]` (one per sub-array), not a single context — see §4.5. Single-mount projects are just a one-element list. Engine entry points take the section (or the list), never the project `systemType` scalar.
```ts
type MountKind = 'roof' | 'ground' | 'fence';

interface MountContext {
  kind: MountKind;
  installationType: InstallationType;        // roof_*/ground_mount/tracker/fence_*
  // geometry (single source = CAD, not UI literals)
  arrayHeightFt: number;                      // ground/fence: above grade; roof: mean roof height
  tiltDeg: number;
  rowSpacingFt?: number;                      // ground
  gcr?: number;                               // ground
  fenceHeightFt?: number; fenceLineFt?: number; // fence
  // site (jurisdiction-derived, like wind/snow already are)
  soilClass?: SoilClass;                      // IBC 1807.3 classes
  frostDepthIn?: number;                      // derived, not 36 default
  // electrical mount params
  trenchRunLengthFt: number;                  // 0 for roof
  rsdRequired: boolean;                       // false for ground/fence (690.12(B)(2))
}
```
`resolveMountContext(config, cad, jurisdiction)` is the **single** producer; structural + NEC + BOM all read it. No path defaults to `roof_residential` for ground/fence (kills C3-payload-omission + 2.3).

### 5.2 Structural result (discriminated union)
```ts
type StructuralResultV5 =
  | { kind: 'roof';   status: Status; wind; snow; rafter; rail?; rackingBOM; ... }
  | { kind: 'ground'; status: Status; wind; snow; foundation: GroundFoundation; overturning; ... }
  | { kind: 'fence';  status: Status; wind; posts: FencePostAnalysis; overturning; infill; ... };
// every variant carries: status, issues[], arrayGeometry, totals, `engineered: boolean`
```
**`engineered: boolean`** is mandatory: `true` only for roof (and ground/fence *after* PE sign-off). The guardrail banner keys off `engineered === false`. This is how unification ships without un-gating PE math.

### 5.3 NEC: unchanged `ComputedSystem`, fed `MountContext`
`ComputedSystemInput` gains `mount: MountContext`. `computeSystem` branches RSD/run-length/burial on it. Output shape unchanged → SLD/BOM/schedule consumers untouched.

---

## 6. Migration order (each step independently shippable + verifiable)

Ordered by leverage and risk. **Steps 1–5 contain zero PE-gated math** — they unify plumbing and can ship now. Steps 6–8 are the PE-gated build.

1. **Fail-closed the swallow** (`calculate/route.ts:318-322`): engine crash → `status:'FAIL'` with the error, never WARNING→PASS. *(RC‑6; tiny, high-value, no math.)*
2. **`resolveMountContext` + thread `installationType`**: map `systemType→installationType` in the structural payload so V4's ground branch is at least *reached*. **Keep `engineered:false` for ground/fence** so output is still labeled ESTIMATE. *(Unlocks §2.3 without un-gating math.)*
3. **NEC unification**: `/calculate` consumes `computeSystem`; delete `electrical-calc` overlap + the `:96-99` fabricated fallbacks; parameterize `systemVoltageAC`. *(C8, H11. Verify Compliance tab == SLD numbers on the same project.)*
4. **Structural single entry — retire V1**: redirect `/api/engineering/structural` → V5; delete `structural-calc.ts`. *(Lowest-traffic engine first.)*
5. **Structural single entry — retire V3**: point the engineering tab → V5, carrying V3's tab output fields. *(C3 closed for plumbing; highest-traffic, do last + verify the tab renders identically for roof.)*
6. **Ground branch fix** (PE-GATED): real exposed wind + IBC 1807.3 embedment + lateral + snow-to-pile. Flip `engineered:true` for ground **only after PE validation**.
7. **`analyzeFence`** (PE-GATED, NET-NEW): add `'fence'` to `InstallationType`, freestanding-wall wind + post overturning. Flip `engineered:true` for fence **only after PE validation**.
8. **Geometry from CAD**: pile/post counts/spacing/embed/tilt from CAD via the engine, not UI literals (#10 in the requirements).

After 1–5: one structural engine, one NEC engine, mount-context-driven, **ground/fence still honestly labeled ESTIMATE**. After 6–8 + PE: ground/fence become engineered output.

---

## 7. Test matrix

Every engine change verified by **running the engine on real numbers**, not just `tsc` (lesson from prior sessions — runtime races/oscillation passed unit tests).

| Dimension | Cases |
|---|---|
| Mount kind | roof_residential, roof_commercial, commercial_ballasted, ground_mount, fence |
| Brand × mount | Tesla/EcoFlow/Enphase/SolarEdge × {roof, ground}; EcoFlow/Enphase × fence |
| NEC parity | Compliance tab vs SLD vs computeSystem on the **same project** → identical OCPD/Voc/wire/120% |
| 120% rule | down-rated bus (busbar < main breaker) must be able to FAIL; battery backfeed included |
| Fail-closed | force an engine throw → overall status FAIL, never PASS |
| `engineered` flag | ground/fence pre-PE → `false` + banner; roof → `true` |
| Regression | full sizing suite (1662+) green; SLD/BOM/schedule snapshot unchanged for roof |
| Real-number harness | per mount: feed Ray's live projects, assert no fabricated default reaches output |

---

## 8. Non-goals / risks

- **Not** re-deriving roof structural — it's validated; V5 preserves it byte-for-byte.
- **Not** shipping ground/fence as engineered without PE sign-off — `engineered:false` + banner is the contract until then.
- **Risk:** the tab (V3→V5) migration touches the most-used surface; do it last, behind a parity test, as its own commit.
- **Risk:** combining a routing change with a math change in one deploy caused an oscillation before — **keep plumbing steps (1–5) and math steps (6–8) in separate commits**, each verified live.
- **Open dependency:** RC‑1 (fabricated-fallback → banner vs hard-fail) is Ray's pending decision; the `resolveMountContext` + `engineered` flag design is compatible with either.

---

## 9. Audit-requirement traceability

The 14 unified-engine requirements (`GROUND-FENCE-ACCURACY-AUDIT-2026-06-20.md` §4) map to this spec:
1 mount-type first-class → §5.1 `MountContext`; 2 single entry/no dead engines → §3.1/§6.4-5; 3 wind by mount → §4; 4 ground foundation → §4.2 (PE); 5 fence net-new → §4.3 (PE); 6 snow by mount → §4.2; 7 jurisdiction frost/soil → §5.1; 8 single NEC w/ mount rules → §3.2/§4.4; 9 real run lengths → §4.4; 10 single geometry from CAD → §6.8; 11 mount-aware BOM → already done (§2.5), consumes V5 geometry; 12 single grounding → already done (§2.5); 13 sizing/layout feedback → §5.1 context fields; 14 brand coverage → already gated (§2.5).
