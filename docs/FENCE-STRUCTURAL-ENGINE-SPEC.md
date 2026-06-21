# Fence Structural Engine (`analyzeFence`) — Design Spec

**Status:** DESIGN — spec first, no implementation. **Date:** 2026-06-21
**Scope:** the SolFence (Sol Fence LLC) vertical bifacial solar fence. Net-new structural engine; fence has **zero** structural representation today (Ground/Fence audit C6/C7).

> **⚠️ PE GATE — read first.** Cantilever post overturning, embedment, and freestanding-wall wind are **PE-stamped structural engineering**. The formulas below (ASCE 7-22 Ch. 29 freestanding wall, IBC 1807.3.3 non-constrained embedded post) are **design targets for the implementation, not approved math.** A licensed structural PE must validate them before any `analyzeFence` output is presented as "engineered." Until then the result carries `engineered: false` and the Structural tab keeps the **"ESTIMATE — not engineered"** banner. This spec is sequenced so the *engine wiring* can land while the *numbers* stay gated.

---

## 1. Why fence is different (and why roof/ground math doesn't apply)

A SolFence is a **freestanding vertical wall of solar panels** — not a roof array, not a tilted ground array:

- **Orientation:** panels mount **90° vertical** on 4x4 posts in 8-ft-wide sections (bifacial, both faces active).
- **Governing load = WIND on the full face.** The fence is a **solid barrier** → full sail area, ASCE 7-22 **Ch. 29 freestanding wall / solid sign** (`Cf` for solid signs), *not* roof C&C (Fig 29.4-7) and *not* the tilted open-structure coefficients used for ground mounts.
- **Snow does NOT govern.** Snow can't accumulate on a vertical surface — the product's "113 PSF snow" rating is a capacity claim, not a gravity demand on the face. The dead load is just the panels + aluminum self-weight (vertical, carried axially by the posts — trivial).
- **Load path:** wind on the panel area between two posts → transfers to the **posts as a cantilever** → **overturning moment at the post base** → resisted by **post embedment** in a (locally-sourced) steel post + concrete footing. This is the **opposite** of roof (uplift on fasteners) and different from ground (pile uplift + downward + frame).

So `analyzeFence` is its own load case: **freestanding-wall wind → per-post cantilever overturning → embedment + post bending check.**

---

## 2. Real SolFence parameters (the engine's defaults)

From the Sol Fence LLC GOLD datasheet + sheets (see `[[solfence-equipment-data]]`):
- **Section:** **7'11" long**, 2 panels/section, up to 860 W. Heights: 6 ft (2 panels) or 4 ft (1 panel). Fence height 5'10" metal-to-metal, 6' max, 2" ground clearance.
- **Posts:** 4x4, **6061-T6 aluminum, 121-mil (0.121") wall**; hot-dip galvanized steel foundation posts. Lengths 6.5 / 4.5 / 9 ft.
- **System wind rating:** **115 mph.** Snow: 113 PSF (capacity claim — does not govern a vertical face).
- **Foundation (SolFence-specified, §3.3):** concrete-set posts **min 3 ft deep, 6" below frost line** — or **driven steel 2⅜" posts, 4 ft min**. Steel post + concrete sourced locally; the engine OUTPUTS the required Ø × depth.
- **Power electronics:** Tigo TS4-A-O optimizer (per datasheet) or Enphase IQ8 micro, installer-supplied — irrelevant to structural.

The engine must **flag when the site design wind exceeds the 115 mph product rating** (a hard limit regardless of the embedment calc).

---

## 3. Load cases & formulas (PE-GATED)

### 3.1 Wind pressure on the fence face — ASCE 7-22 §29.3 (freestanding wall/solid sign)
```
qz  = 0.00256 · Kz · Kzt · Kd · V²                 (velocity pressure at fence height)
F   = qz · G · Cf · As                              (design wind force on a section)
```
- `Kz` at the **fence mean height** (not roof, not array-at-height — the fence is ground-level), exposure B/C/D.
- `G` = 0.85 (gust). `Kd` = 0.85.
- `Cf` = solid-sign/freestanding-wall force coefficient (ASCE 7-22 Fig 29.3-1), a function of the wall **aspect ratio B/s** (length/height) and clearance ratio (fence sits ~on grade → low clearance). For a long low wall `Cf ≈ 1.2–1.8`; **corner/end sections get higher `Cf`** (the end-zone amplification) — must compute the governing (end) section, mirroring the roof corner-zone lesson.
- `As` = solid area of one section's tributary face = `postSpacingFt × fenceHeightFt`.
- **Bifacial note:** wind is a pressure on the barrier regardless of which face — bifaciality doesn't change the structural load.

### 3.2 Per-post cantilever overturning
Each post carries the wind from half the section on each side (interior post = full `As`; end post = half):
```
F_post     = F (tributary)                          (lateral force at the panel centroid)
h_c        = fenceHeightFt / 2 + groundClearanceFt  (centroid height above grade)
M_ot       = F_post · h_c                            (overturning moment at grade)
```

### 3.3 Required embedment — match SolFence's spec, validate with IBC 1807.3.3
> **★ SolFence specifies the embedment directly (GOLD datasheet) — this IS their engineered basis, so the engine MATCHES it rather than free-deriving.** Two foundation options:
> - **Concrete-set:** posts buried **min 3 ft deep**, concrete within 6" of surface, **extends 6" below the frost line**.
> - **Driven steel:** 2⅜" steel posts **driven 4 ft minimum**.
>
> The engine's required embedment = **max( SolFence minimum [3 ft concrete / 4 ft driven], frostDepth + 6", IBC 1807.3.3 calc for site wind+soil )**. For typical sites the SolFence minimum + frost-line rule governs and **matches their stamp**; the IBC calc only deepens it for extreme wind/poor soil (and flags if it exceeds what SolFence rates). Below is the IBC check used for that site-specific validation:

**IBC 1807.3.3** (non-constrained embedded post, no surface constraint):
```
d  = 0.5 · A · ( 1 + sqrt( 1 + (4.36 · h_c) / A ) )
A  = 2.34 · P / (S1 · b)
```
- `P` = lateral force, `b` = footing diameter (concrete), `S1` = allowable lateral soil-bearing pressure (psf/ft) by **soil class (IBC Table 1806.2)** — **real `soilClass`, not a default**.
- `h_c` = height of the lateral load above grade.
- Output `d` = **required embedment depth**; compare to the proposed footing depth (and **frost depth** — embedment must also clear the jurisdiction frost line).

### 3.4 Post bending (the 4x4 post as a cantilever)
```
M_post   = F_post · h_c
σ        = M_post / S_post                           (S = section modulus of the 4x4 post)
check:   σ ≤ F_allow_aluminum   (and post capacity per SolFence rating)
```
- Aircraft-grade aluminum allowable bending stress (6061-T6 ≈ 21 ksi allowable, **verify the actual SolFence post alloy/temper with the vendor** — the sheet says "aircraft-grade," card said 6063-T6; reconcile).

### 3.5 Panel-as-infill → connection to post
The panel/section transfers its wind reaction into the post at the rail/channel connections — check the section-to-post connection capacity (SolFence sections include side channels + rails; the connection is a vendor-rated detail → **request the SolFence connection allowable from Sarah**, else flag as unverified).

---

## 4. Interface contract

```ts
interface FenceStructuralInput {
  // geometry (from layout.fenceLine / fenceHeight + SolFence section model)
  fenceHeightFt: number;          // 6 or 4 (vertical panel height)
  fenceLengthFt: number;          // total run
  postSpacingFt: number;          // 8 (section width)
  groundClearanceFt: number;      // bottom of panels above grade
  postSize: string;               // '4x4'
  postLengthFt: number;           // 6.5 / 4.5 / 9
  // site (jurisdiction-derived, like roof wind/snow already are)
  windSpeedMph: number; windExposure: 'B'|'C'|'D';
  soilClass: SoilClass;           // IBC Table 1806.2 — REQUIRED, not defaulted
  frostDepthIn: number;           // jurisdiction-derived
  footingDiameterIn?: number;     // proposed concrete footing Ø (default per post size)
  // product limits
  ratedWindMph: number;           // 115 (SolFence)
}

interface FenceStructuralResult {
  kind: 'fence';
  status: 'PASS'|'WARNING'|'FAIL';
  engineered: false;              // HARD false until PE-validated (§ PE GATE)
  wind: { qzPsf: number; cf: number; forcePerSectionLbs: number; governingSection: 'interior'|'end'; };
  perPost: { overturningMomentFtLbs: number; lateralForceLbs: number; requiredEmbedmentFt: number; postBendingStressPsi: number; postBendingAllowablePsi: number; sf: number; };
  embedment: { requiredFt: number; frostDepthFt: number; governs: 'overturning'|'frost'; };
  exceedsRatedWind: boolean;      // site wind > 115 mph product rating
  issues: StructuralIssue[];
  notes: string[];                // incl. "local steel post + concrete required: Ø x depth"
}
```

`analyzeFence` is a sibling of V4's `analyzeGroundMount` / `analyzeBallast` / `analyzeTracker`, dispatched when `MountContext.kind === 'fence'`.

---

## 5. Integration (with the unified-engine + mount-type work already shipped)

1. **Add `'fence'` to the mount type model.** Today `systemTypeToInstallationType()` (`lib/structural/types.ts`) maps fence → `'roof_residential'` with a TODO. Add a `fence` `InstallationType` (or `MountContext.kind === 'fence'`) and route to `analyzeFence` — the slot the unified-engine spec (§4.5) already reserves.
2. **Gate OFF roof/ground analysis for fence** — no rafters, no piles, no roof zones. `analyzeFence` is the only structural path for a fence.
3. **Wind/frost/soil come from the same jurisdiction services** roof wind/snow already use — `analyzeFence` consumes them, doesn't re-default.
4. **BOM already consumes the fence geometry** (the real SolFence section BoM shipped `b7fa0722`). The engine's embedment output adds the **footing concrete volume** + steel post spec to the local-sourcing advisory line (currently `LOCAL-STEEL-POST-CONCRETE`, unsized) — turning it from a placeholder into a real "Ø X × Y ft deep" requirement.
5. **`engineered: false`** keeps the ESTIMATE banner until PE sign-off (the banner already fires for `systemType !== 'roof'`).

---

## 6. Build sequence

1. **Types + routing** (zero PE-math): add `fence` to the mount model, `FenceStructuralInput/Result`, dispatch `analyzeFence` stub returning `engineered:false` + "not yet implemented." Wire fence geometry (height/length/spacing) from `layout` → input.
2. **Wind module** (PE-gated): freestanding-wall `qz·G·Cf·As`, interior vs end `Cf`.
3. **Overturning + embedment** (PE-gated): per-post moment + IBC 1807.3.3 `d`, frost governing-check.
4. **Post bending + connection** (PE-gated): 4x4 aluminum cantilever stress; vendor connection allowable.
5. **BOM coupling:** embedment → footing concrete volume + steel post into the BoM.
6. **PE validation:** licensed PE reviews §3 formulas + the SolFence post alloy/connection allowables → flip `engineered: true`.

Steps 2–4 each verified by running the engine on real numbers (a known SolFence section at 115 mph) and **cross-checking against SolFence's own rated capacity** — if our calc says a section fails at a wind below 115 mph, either our `Cf`/soil is too conservative or their rating needs its basis (ask Sarah for the SolFence PE stamp / load tables, which would be the ideal validation source).

---

## 7. Open items — mostly RESOLVED by the GOLD + panel datasheets (2026-06-21)
- ✅ **Post alloy/temper:** 6061-T6 aluminum, 121-mil wall → use 6061-T6 allowable bending stress (~21 ksi, confirm with the structural-properties table).
- ✅ **Embedment/footing basis:** SolFence specifies min 3 ft (concrete, 6" below frost) / 4 ft (driven 2⅜" steel) — §3.3 matches this.
- ✅ **Optimizer:** Tigo TS4-A-O (specific).
- ⏳ **Section-to-post connection allowable** (the 4-screw middle-rail detail) — still need the vendor number; until then flag the connection check as unverified.
- ⏳ **The full SolFence stamped PE letter / load tables** — would be the ideal end-to-end validation (the engine should reproduce their 115 mph rating). Ask Sarah if a stamped letter exists; if so it *is* the PE sign-off for `engineered: true`.

See `[[solfence-equipment-data]]`, `[[tesla-integration]]` (fence recognition + equipment done), and `UNIFIED-ENGINE-DESIGN-SPEC.md` §4.5 (the mount-type slot this fills).
