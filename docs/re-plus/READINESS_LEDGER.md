# SolarPro — RE+ Readiness Ledger

**Permanent execution truth source.** Closed defects are never deleted.

RE+ is **2026-11-16** (57 days from 2026-09-20).

## 🚨 REVISION BASIS — read before quoting any finding

There are **three** different code states in play. Confusing them produces false refutations.

| Name | SHA | What it is |
|---|---|---|
| `origin/master` | `5d89d4dc` | **What production runs.** Phase 2 site-ownership merged. |
| `origin/dev` | `63f7954e` | Content-identical to master for this workstream. |
| `fix/phase2-post-merge-regressions` | `6aa5ea0a` | **LOCAL ONLY — on no remote.** A peer session committed it at 11:43 today. |

> A second Claude session (**"SolarPro Phase 2 recovery and verification"**, started ~10:00) is
> **actively working in this same working tree**. It checked out the fix branch and committed
> `6aa5ea0a` *during* this session. I have sent it a coordination message and have **not modified
> any tracked file**. See [Coordination](#coordination) at the end.

Measure commit counts against `origin/`, never local `master`.

## Status vocabulary

| Status | Meaning |
|---|---|
| `OPEN` | Root cause identified, not yet fixed **on a shared branch**. |
| `FIXED_LOCAL_UNPUSHED` | Fixed only on `6aa5ea0a`, which is on no remote. Production still broken. |
| `FIXED_PENDING_VERIFICATION` | On a shared branch + tests pass. **Not** proven on a deployed build. |
| `VERIFIED` | Proven on a deployed build at a known SHA, by executing the real user workflow. |

A workstream is **COMPLETE: NO** unless every line of the Definition of Done is true.

## Method

Findings below come from a 115-agent read-only audit (8 ownership dimensions → adversarial
refutation of every claimed defect). **107 defects were claimed; 50 were refuted and discarded.**
Only survivors are recorded. Each was re-checked by me against the correct revision.

---

# WORKSTREAM 1 — DESIGN STATE + GEOMETRY RELIABILITY

Owner-reported production failures:

- **Failure A — Pick House.** Melvin (52 panels) → pick neighbour → re-pick Melvin → panels gone,
  while the UI shows *52 panels* (top bar), *52 panels* (System Summary),
  *"Layout loaded from DB · 0 panels"*, and *"Saved for another address"* **simultaneously**.
- **Failure B — Auto Layout.** Generated panels visually intersect / sink into the roof surface.

Both are now fully root-caused. **Neither is fixed on any branch production can reach.**

---

## Failure A — root causes

### WS1-001 — Property identity is minted from the raw clicked pixel, so re-picking the same house mints a new property

| | |
|---|---|
| **Severity** | **P0** |
| **Status** | `FIXED_LOCAL_UNPUSHED` (fix exists only on `6aa5ea0a`) |
| **Explains** | **Failure A — primary root cause** |

`SolarEngine3D` derives the pick coordinate from `viewer.scene.pickPosition(screenPos)` —
the **raw ray-cast hit point under the cursor**
([components/3d/SolarEngine3D.tsx:5951](components/3d/SolarEngine3D.tsx:5951)) — and passes it
unchanged to `onLocationPick` ([:5962](components/3d/SolarEngine3D.tsx:5962)). The reverse
geocode at `:5959` supplies only the address *string*; no centroid or footprint snap is ever
applied.

`siteKeyFromCoords` then truncates to `SITE_KEY_PRECISION_DP = 5`
([lib/siteIdentity.ts:51](lib/siteIdentity.ts:51)). That is **quantisation onto a grid, not a
tolerance**: at 38.7 °N one cell is ~**1.11 m** (lat) × ~**0.87 m** (lng). The archive lookup is
exact string equality — `archives[toKey] ?? emptyBundle()` — with no proximity fallback.

**The repo records the live production trace.** Three identities for one house in 43 seconds at
3 Melvin Drive, 2026-09-20:

```
v202 16:11:53  …@38.70615,-90.04625
v204 16:13:46  …@38.70630,-90.04620   (~17 m)
v205 16:13:57  …@38.70613,-90.04627   (~19 m)
```

**Revision status — this is the important part.** `resolveSiteKey` / `SITE_MATCH_RADIUS_M` are
**entirely absent from `origin/master`** (verified: `git show origin/master:lib/design/siteDesignModel.ts`
contains neither symbol, and `git grep` over `origin/master` finds no caller). They exist **only**
on `6aa5ea0a`, which is on **no remote**. So the production build Ray tested has **no proximity
snap of any kind**, and every re-pick more than ~1 m from the first mints a new property.

For a ~12 m × 10 m roof, two independent clicks share a cell about **0.8 %** of the time — the
failure is the rule, not the exception.

**Fix on `6aa5ea0a`:** `resolveSiteKey` snaps a pick to the nearest known site within
`SITE_MATCH_RADIUS_M = 8`, wired into `changeSite` via `site.resolveKeyFor`
([DesignStudio.tsx:1517](components/design/DesignStudio.tsx:1517)). The radius is **measured, not
guessed** — the same trace bounds it: 2.8 m accidental duplicate must be absorbed, 17.3 m real
neighbour must not. An earlier 25 m radius swallowed the neighbour.

---

### WS1-002 — On reload, identity is re-derived from a *different* coordinate than the one that minted it — and the destructive-write guard is disarmed by exactly that condition

| | |
|---|---|
| **Severity** | **P0** |
| **Status** | `OPEN` — **not fixed on any branch, including `6aa5ea0a`** |
| **Explains** | Failure A across reloads; silent design destruction |

This is independent of WS1-001 and **survives the proximity fix**.

- **Mint:** `handleLocationPick` sets the active key from the **pick point**, and PUTs that
  lat/lng to `/api/projects/{id}` ([DesignStudio.tsx:1899-1905](components/design/DesignStudio.tsx:1899)).
- **Re-derive:** on mount the key comes from `mapCenterRef`
  ([DesignStudio.tsx:1422-1424](components/design/DesignStudio.tsx:1422)), which is seeded from
  `projects.lat/lng` ([:546](components/design/DesignStudio.tsx:546)).
- **Drift:** the mount effect is documented *"street-level geocode always wins over stored
  coords"* and re-geocodes whenever the address starts with a digit — true of every picked
  address. It then overwrites `projects.lat/lng` with the **geocoder's** point and never calls
  `changeSite`.

A 3D roof-click point and a geocoder rooftop point essentially never agree to 1.1 m, so the keys
differ. `hydrate()` therefore returns `active: emptyBundle()` with `needsAdoptionSave: true`,
which forces a save writing `panels: []` — **and the `LAYOUT_SUBSYSTEM_WIPE` guard relaxes
precisely when the incoming key differs from the stored one**, so the destructive write is
permitted. The design is destroyed by the very mechanism meant to protect it.

🚨 **The answer is already on the row and the client ignores it.** `layouts.map_center` is written
on every save ([:1154](components/design/DesignStudio.tsx:1154)) and by the unload beacon
([:1318](components/design/DesignStudio.tsx:1318)).

> **Correction (peer session, verified).** An earlier draft said it is "never read back". That is
> wrong: it *is* read server-side — [lib/db/core.ts:372](lib/db/core.ts:372) uses it in
> `activeSitePlanes()` to derive the active key when `site_archives` has none, and
> [:433](lib/db/core.ts:433) surfaces it as `Layout.mapCenter`. The precise defect is narrower and
> survives that correction: the **client restore path never uses it to re-derive identity**. It
> uses `mapCenterRef` — seeded from `projects.lat/lng`, which the re-geocode overwrites — so the
> coordinate that minted the key is sitting on the row, reaches the browser, and is not consulted.

Identity should be re-derived from the coordinate that minted it.

> Note: PR #19 changes `map_center` to `COALESCE` (absence keeps the stored value), which alters
> this path — re-verify against #19, not master.

---

### WS1-003 — With migration 123 absent, placing ONE panel at a new property overwrites the previous property's 52

| | |
|---|---|
| **Severity** | **P0** |
| **Status** | `OPEN` (production: migration 123 unapplied) |

The wipe guard compares **`systemType` bucket membership, not site identity or count**
([lib/db/projects.ts:944-948](lib/db/projects.ts:944)). A stored `{roof: 52}` bucket is flagged
only if `'roof'` is *absent* from the incoming set. One roof panel at the new property puts
`'roof'` in `incoming`, the guard passes, and `panels = ${panelsJson}::jsonb` — **with no
`COALESCE`**, unlike the adjacent `roof_planes` and `map_center` writes — replaces 52 rows with 1.

The archive that should have held the 52 is written at
[lib/db/projects.ts:1109-1119](lib/db/projects.ts:1109) inside a `try/catch` whose only handler is
`console.warn('[upsertLayout] site_archives not persisted (run migration 123)')`. Without the
column the UPDATE throws, is **swallowed**, and the route returns **HTTP 200**. The studio branches
on `res.ok` alone and shows **"saved"**.

> This is "the guard is luck, not architecture" made concrete: it only ever protected the
> `panels: []` case, never the normal roof→roof case.

> **Prior art (peer session).** This is already analysed in `PHASE2-SITE-OWNERSHIP-CLOSEOUT.md`
> line 34 on master — "place one panel at the new property and the guard passes". It was
> documented as the reason Melvin survived by luck and deliberately not fixed. So it is **open but
> not unseen**; the derivation is already written down.

---

### WS1-004 — `layouts.roof_planes` has no wipe guard, and an *omitted* `roofPlanes` becomes SQL NULL

| | |
|---|---|
| **Severity** | **P0** |
| **Status** | `FIXED_LOCAL_UNPUSHED` |

On `origin/master`, [lib/db/projects.ts:939](lib/db/projects.ts:939) is an unconditional
`roof_planes = ${roofPlanesJson}::jsonb`, and the `LAYOUT_SUBSYSTEM_WIPE` block reads **`panels`
only** — nothing in it touches `roofPlanes`. Worse than "an empty array clears it":
`roofPlanesJson = data.roofPlanes ? JSON.stringify(...) : null`, so an **omitted** field becomes
SQL NULL and destroys the column.

`6aa5ea0a` changes it to `COALESCE(...)`. That fix is **not on `dev` or `master`**, so production
still carries it.

> 🚨 Reading the working tree here produces a **false refutation** — the tree is on the fix branch.
> Verify with `git show origin/master:lib/db/projects.ts | sed -n 939p`.

---

### WS1-005 — Four panel readouts, four independent sources (the contradictory UI)

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `OPEN` |
| **Explains** | Failure A's "52 and 0 at once" |

The app can hold at least **11 independent answers to "how many panels"**, with **6 independent
writers of the panel set**. The four on Ray's screen:

| Readout | Source |
|---|---|
| Top bar "52 panels" | `panels.length` ([DesignStudio.tsx:4326](components/design/DesignStudio.tsx:4326)) |
| System Summary "52" | `panels.length` ([:5054](components/design/DesignStudio.tsx:5054)) |
| "Layout loaded from DB · **0** panels" | `restoredPanelCount` ([:4431](components/design/DesignStudio.tsx:4431)) — **not derived from `panels`** |
| "Saved for another address" | `site.archivedEntityCount` ([:5038](components/design/DesignStudio.tsx:5038)) |

Plus the 3D engine's **own** `panelCount` state
([SolarEngine3D.tsx:1682](components/3d/SolarEngine3D.tsx:1682)), written from **19 call sites**,
driving a HUD kW figure computed by a **different formula** than the top bar's
([:1843](components/3d/SolarEngine3D.tsx:1843)), reconciled with the prop only by a **lagging
`useEffect`** ([:2008](components/3d/SolarEngine3D.tsx:2008)). Engine logic reads
`panelsRef.current`, never the prop.

`layoutLoadedFromDB` ([:945](components/design/DesignStudio.tsx:945)) is a **write-once latch** —
set `true` at [:1437](components/design/DesignStudio.tsx:1437) inside
`if (restoredPanels.length > 0)` and **never set false anywhere**. That is the literal
"Layout loaded from DB · 0 panels" string.

---

### WS1-006 — The snap fix and the staleness guard disagree about what a site is

| | |
|---|---|
| **Severity** | **P0** |
| **Status** | `FIXED_PENDING_VERIFICATION` — found by this session, fixed by the peer in **PR #19** |

`onRoofPlanesDetected` drops a detection whose stamped site differs from the active site
([DesignStudio.tsx:4693-4700](components/design/DesignStudio.tsx:4693)):

```
coordsKeyNow = coordKeyOf(activeSiteKeyRef.current)   // after a snap: the ORIGINAL click's coords
emittedFor   = coordKeyOf(plane.siteKey)              // SolarEngine3D stamps the NEW click's coords
```

`resolveKeyFor` **deliberately** makes `activeSiteKey` differ from the current click's coordinate
key — that is the whole point of the snap. So after any snapped re-pick the two never match and
**every detected roof plane is dropped**.

Root cause: `SolarEngine3D` still derives identity with raw `siteKeyFromCoords`
([:958](components/3d/SolarEngine3D.tsx:958), [:2594](components/3d/SolarEngine3D.tsx:2594),
[:2604](components/3d/SolarEngine3D.tsx:2604), [:10792](components/3d/SolarEngine3D.tsx:10792))
and has no access to the resolver. **One fact, two implementations.**

**Fix (PR #19).** `sitesAreSameProperty(a, b)` in `lib/design/siteDesignModel.ts` — exact-equal
first, then distance ≤ `SITE_MATCH_RADIUS_M` using the same metric `resolveSiteKey` uses — and the
guard calls it instead of `!==`. One definition of "same property", so the resolver and the
staleness guard can no longer disagree. The engine deliberately still reports *where it detected*;
DesignStudio reconciles. Pinned by four tests including one asserting it agrees with
`resolveSiteKey`.

---

### WS1-007 — No test derives a site key from click coordinates

| | |
|---|---|
| **Severity** | **P0** (test integrity) |
| **Status** | `OPEN` |

`tests/designStudioSiteSwitch.component.test.tsx` mounts the real DesignStudio and drives the real
`onLocationPick` — a good layer — but every call replays the **same two constants**
`MELVIN.lat/lng` and `NEIGHBOUR.lat/lng`
([:177-269](tests/designStudioSiteSwitch.component.test.tsx:177)). Replaying an identical
coordinate tests exact-equality against a trivially equal key. The production failure is precisely
that **a human cannot reproduce a coordinate**.

Also confirmed: **no test anywhere asserts panel elevation above the roof surface**, and the two
Playwright specs are the only browser layer.

---

## Failure B — Auto Layout panels sink into the roof

One sentence: **there are two different, unshared definitions of "the roof surface" on either side
of the render boundary.** Six independent confirmed defects.

**Fixed in this session** on branch `fix/ws1-autolayout-panel-elevation` — **PR #20**, commits
`b0e04146` and `6a681d12`: WS1-008, WS1-009, WS1-010, WS1-011 (+ WS1-014). Still open: WS1-012,
WS1-013, which are coupled to each other.

> 🚨 **A stacked PR gets NO CI.** `.github/workflows/ci.yml` triggers on
> `pull_request: branches: [master]` only, so PR #20 based on `fix/phase2-post-merge-regressions`
> ran **2 checks instead of 10**, both trivial, and looked fine. Retargeting to `master` is not
> enough either — a base change fires `edited`, which is **not** in the default
> `pull_request` types (`opened`, `synchronize`, `reopened`). Close-and-reopen fires `reopened`.
> **A PR showing few checks is not a PR that passed.**

### The invariant that was missing

No test anywhere asserted a panel's elevation relative to its roof. Counting panels and testing
point-in-polygon are both satisfied perfectly by an array buried a storey underground.
`tests/panelSurfaceClearance.test.ts` (new, 11 tests) asserts one thing:

```
for every placed panel:  (panelECEF − plane.origin3D) · plane.normal  ==  PANEL_OFFSET_ECEF
```

A **signed** distance, so it goes negative exactly when a panel is inside the roof.

🚨 **Proven able to fail.** With the library fix reverted (`git stash`), the suite fails by
**5.33 m** (Set Origin — the array at ground level), **4.11 m** (Set Direction — off-plane drift
along the row) and on panel height above ground, against a 1 cm tolerance — 400–530× the
tolerance. The 8 positive tests still pass on the old code, which is correct: they describe
behaviour that was already right.

🚨 **The tolerance is measured, not chosen.** Panels are stored with `lat`/`lng` **rounded to 7
decimal places** while `height` keeps full precision
([lib/surfaceGeometry3D.ts:1138-1139](lib/surfaceGeometry3D.ts:1138)). At this latitude 1e-7° is
1.11 cm (lat) and 0.87 cm (lng), so reconstructing the point from what was stored moves it up to
~0.7 cm horizontally, which tips into the plane normal as `sin(tilt)·error` — about 3.5 mm on a
30° face. Observed spread: 47.3–51.8 mm against a 50 mm target, **on every fill including the
default**. The precision floor is the stored representation, not the geometry. An earlier 1 mm
tolerance was below that floor and failed for a reason that was not a defect.

### WS1-008 — The restore path re-lifts the roof polygon, so panels render *below* the visible roof — `FIXED_PENDING_VERIFICATION`

`SURFACE_OFFSET_M = 0.12 m` is applied **unconditionally** by `computePlaneFromPoints3D`
([lib/roofPlane3D.ts:410-413](lib/roofPlane3D.ts:410)); callers must opt out. `polygon3D` is
already lifted. The v64 restore effect feeds `plane.polygon3D` **straight back in with no options**
([SolarEngine3D.tsx:2136-2139](components/3d/SolarEngine3D.tsx:2136)), lifting it a second time.

Panels are placed at `origin3D + n·PANEL_OFFSET_ECEF` where `PANEL_OFFSET_ECEF = 0.05`.
So the drawn roof sits at `P + 0.12` and the panels at `P + 0.05` — **panels render 0.07 m below
the roof surface the user sees.** That is Ray's sentence, exactly.

🚨 **This is the one that most likely matches what Ray actually saw.** The other elevation defects
need Set Origin, Set Direction, or the per-plane relayout button to trigger. This one needs only a
reload.

🚨 **The codebase already knew the rule.** `ComputePlaneOptions.surfaceOffsetM`'s own docstring
says, in capitals: *"PASS 0 WHEN RE-FITTING POINTS THAT WERE ALREADY LIFTED BY A PREVIOUS FIT…
Stitch did exactly that… so each press floated the roof, and every panel on it, 12 cm higher."*
**Stitch was fixed. The restore path does the same thing and never was.**

**Fix (`6a681d12`).** The `polygon3D` branch of the restore effect now passes
`{ surfaceOffsetM: 0 }`, because `polygon3D` *is* a fitted, already-lifted plane. The two legacy
branches deliberately keep the default lift — `computeEcefFrameForLegacyPlane` fits points built
from lat/lng and pitch, which have not been lifted, so for them the offset is the first one, not a
second.

**Tests** (3 added, pure math, no Cesium): the re-fit is idempotent with `surfaceOffsetM: 0`
(every point within 1e-6 m); **without** it the polygon lifts by *exactly* `SURFACE_OFFSET_M`
again — the defect asserted rather than described, so making the lift conditional later reports
itself; and the user-visible invariant — against the fixed deck every clearance is positive,
against the old one every panel is between **−0.05 and −0.09 m**.

🚨 **NOT VISUALLY VERIFIED.** This moves a rendered surface and I have not put eyes on it in a
browser. The math is pinned; the look is not.

**Still coupled:** WS1-012 and WS1-013 share the lifted/unlifted split and remain open. They want
one change with both consumers in view plus a visual check.

### WS1-009 — `relayoutPlane` runs the 2D engine in 3D mode and drops panels to the ellipsoid — `FIXED_PENDING_VERIFICATION`

The "don't run the 2D engine in 3D" defence is a **hand-copied `if (show3D) {...} return;` block at
each call site** rather than a chokepoint. It exists at `autoLayoutAll`
([:3762](components/design/DesignStudio.tsx:3762)), `fillRoof` ([:3840](components/design/DesignStudio.tsx:3840))
and `optimizeLayout` ([:3905](components/design/DesignStudio.tsx:3905)). **`relayoutPlane`
([:3558-3578](components/design/DesignStudio.tsx:3558)) — wired to the per-plane "↺ Update Panel
Layout" button — never got it.** A fourth path, `relayoutWithOrientation`, has a guard that **fails
open**.

`generateRoofLayoutOptimized` never writes an elevation. `addPanelEntity` does
`const h = panel.height ?? 0` and `isValidCoord` accepts 0, so the array is placed on the
**WGS-84 ellipsoid** — metres below the building. The two helpers written to prevent this,
`panelWorldPosition` and `panelHeightFromCADOffset`, have **zero callers**.

🚨 **The fail-open guard could never self-correct.** `relayoutWithOrientation` routed to 3D only
`if (show3D && panels.some(p => (p.height ?? 0) > 0))`. Panels at height 0 *are* the symptom, so
once the 2D engine had sunk an array, the guard that would have prevented it could never fire
again — the condition was the disease.

**Fix.** One chokepoint, `routeLayoutTo3D(beforeRoute?)`, replacing the hand-copied block at all
five sites. A rule that must hold at N call sites belongs at one. The `height > 0` clause is gone:
the **mode alone** decides which engine is correct. `relayoutPlane` in 3D now re-lays the whole
roof (the same trade the three siblings already make) and says so in a toast — a visible surprise
beats a silent burial.

**Follow-up (not done):** wiring `panelWorldPosition` / `panelHeightFromCADOffset` would let the 2D
engine emit correctly-elevated panels instead of being routed away from. That is the real repair;
routing is the containment.

### WS1-014 — The test that existed to prevent WS1-009 pinned a spelling and covered 3 of 5 sites

| | |
|---|---|
| **Severity** | **P1** (test integrity) |
| **Status** | `FIXED_PENDING_VERIFICATION` |

`tests/layoutActions3dRouting.test.ts` was written for exactly this defect — its docstring opens
*"It says 62 panels and 27.28 kW, and there are no panels in sight."* It asserted the literal text
`if (show3D)` inside **three** named callbacks. Two problems:

1. It pinned an **implementation spelling**, so consolidating the rule into a chokepoint broke it
   while strictly improving the behaviour.
2. It enumerated three of the **five** layout actions. The two it omitted — `relayoutPlane` and
   `relayoutWithOrientation` — are precisely the two that shipped broken. The test was green
   throughout.

**Rewritten** to assert the invariant over all five: each action must consult `routeLayoutTo3D()`
**before** any 2D-engine call and return before reaching one; the chokepoint must test the mode and
hand off to `auto_roof`; and — pinning the fail-open bug directly — the chokepoint must not
reference `panels` or `.height` at all.

🚨 **It reads its own prose.** The first rewrite failed because the guard comment inside `fillRoof`
*names* `generatePanelGridCAD`, so a naive search reported the 2D engine appearing ~500 bytes
before the routing check that actually precedes it. Comments are now blanked (preserving byte
offsets) before any positional assertion, and engine matches require a trailing `(` — the
difference between invoking a function and mentioning it. **A source-level test that reads its own
comments is worse than no test.**

Proven to fail: with `DesignStudio.tsx` reverted, **11 of 17 fail**, including all five actions.

### WS1-010 — Set Origin puts the grid origin at GROUND elevation — `FIXED_PENDING_VERIFICATION`

`buildRoofPlane3D` hardcodes `planeHeightAtCenterMeters: 0.0`
([lib/roofPlane3D.ts:610-613](lib/roofPlane3D.ts:610)) while setting `origin3D` at the real roof
height. **`0.0` is not nullish**, so `?? LEGACY_PLANE_HEIGHT_M` can never fire and the height
collapses to `groundElevM`. Verified numerically: a 25° plane 5 m above 120 m ground yields 18
panels at **124.22–125.68 m** normally and the same 18 at **119.26–120.72 m** with the override —
a clean ~5 m drop to ground level. Reproduced independently here at **5.33 m**.

**Fix.** A lat/lng is two numbers and a point on a plane needs three. Rather than guess the third
from a stored scalar that is a sentinel, take the height from the plane already resolved and
**project the point onto the plane along its normal**. The result is on the plane by construction
— tilted, flat or legacy — and no longer depends on `planeHeightAtCenterMeters` at all.

### WS1-011 — Set Direction leaves the grid u-axis non-orthogonal, driving panels off-plane along each row — `FIXED_PENDING_VERIFICATION`

[lib/surfaceGeometry3D.ts:688-699](lib/surfaceGeometry3D.ts:688) installs a user-supplied
**horizontal** ENU vector as `ef.u` verbatim, re-deriving only `v`. A horizontal vector is not in a
tilted plane, so `u` retains a normal component `-sin(T)·sin(θ)` and every panel is driven off the
plane by `uC·sin(T)·sin(θ)` **along the row** — panels sink progressively further as the row
extends. `polyUV` is built from the same skewed axis, so the containment test is a sheared
projection and **cannot detect the error**. Compounding it, `customLayoutDirRef` is a **single ref
applied to every plane**, cleared only on address change. Reproduced independently at **4.11 m** on
a 30° face with a 45° direction.

**Fix.** Project the picked direction into the plane, then re-derive **both** in-plane axes:
`u = normalize(newU − n(newU·n))`, `v = normalize(n × u)`. Only `v` was re-derived before, which
made the triad consistent but not orthonormal. A direction parallel to the normal has no in-plane
part, so that case now leaves the plane's own frame alone rather than installing a degenerate axis
— pinned by a test.

**Follow-up (not done):** `customLayoutDirRef` being one ref for every face is still live. One eave
direction picked correctly for one face is the wrong direction on every other face.

### WS1-012 — Square Up renders the face unlifted but places panels on the lifted plane — `OPEN`

`squareUpTracedFaces` derives two geometries from the same points: `frame` with
`{ surfaceOffsetM: 0 }` (correct) for the **rendered** surface, and `buildRoofPlane3D(pts3D)`
(which silently re-applies 0.12 m) for the **placement** geometry
([SolarEngine3D.tsx:4529-4549](components/3d/SolarEngine3D.tsx:4529)). The two go to different
consumers with no guard anywhere on the path.

### WS1-013 — `renderRoofRails` assumes an offset that does not exist — `OPEN`

Its comment asserts `panel.height = roofDeckAlt + stackH`; **`roofDeckAlt` is not a variable
anywhere in the file** — it appears only in that comment. For the default IronRidge XR100 mount the
rail centre lands 0.069 m **below** the deck polygon and its top reaches −0.006 m, so the entire
rail run renders under the near-opaque deck fill.

---

---

## 🚨 CORRECTION — I said the roof datum was "not permit-grade". That was wrong.

Earlier in this programme I measured the 0.12 m lift on a **single isolated face** and found `area`,
`pitch` and `azimuth` invariant to 1e-14. That measurement was correct. The **inference from it was
not**: I concluded the whole datum problem was confined to the 3D viewport.

Two things falsify that, both found by the transitive re-audit:

1. **The lift moves each face in its OWN azimuth direction.** Per face it is a rigid translation, so
   per-face area and pitch are untouched — but two faces of a gable have *opposite* azimuths, so
   their shared ridge **splits in plan view** by `2 × 0.12 × sin(pitch)`: **0.107 m (4.2 in) at 6:12,
   0.154 m (6.0 in) at 10:12**. `plane.vertices` is what `lib/cad/buildCADFromSurvey.ts` hands to
   `geoPolygonToLocal` and what `lib/cad/roof/roofCAD.ts` uses for plan polygons and setback bands,
   so the split is **drawn on the permit site plan**. `joinSharedCorners` has a 1.5 m tolerance, so
   nothing catches it.
2. **Square Up destroys pitch outright** — see WS1-015 below. That is permit-grade by any measure.

**Why the analysis failed, and what changed.** I tested one face in isolation and generalised to a
system. An invariant that holds per-object says nothing about the *relationships between* objects.
The repair is in the method, not just the code: geometry invariants must be asserted **between
faces** (shared edges, ridge continuity), not only within one. That is now a named gap below, and it
is the reason the Definition of Done carries a "visual check" row that is still red.

---

## WS1-015 — Square Up flattens every roof face it touches

| | |
|---|---|
| **Severity** | **P0 — permit-grade** |
| **Status** | `FIXED_PENDING_VERIFICATION` |
| **Reaches** | PVWatts, ASCE 7-22 wind + snow, sloped-area basis, fire setback, the planset |

`squareUpTracedFaces` rebuilt every corner of a face at the **mean of its corner heights** — a
horizontal ring — while the comment directly above the code said *"Rebuild each face from its
squared ring at the heights it already had"*:

```js
const meanH = old.reduce((acc, g) => acc + g.height, 0) / old.length;
const pts3D = ring.map(v => engLatLngToECEF(v.lat, v.lng, meanH));
```

Square Up is a **plan-view** tool — the eyeballed clicks are wrong in plan, not in slope — so it has
no business touching pitch. It flattened it, and pushed the flattened `pitch`/`azimuth` into
`updates`, which DesignStudio persists.

🚨 **0.19° is more dangerous than 0°.** The rebuilt face does not measure as exactly flat: the engine
measures tilt against the **geocentric** radial while the ring sits at constant **geodetic** height,
and the angle between them is the deflection of the vertical — ~0.19° here, peaking near 45° lat. A
clean zero would have been caught by the `t > 0` filter in `lib/pvwatts.ts` and the `pitch > 0` gate
in `applyToSystemDefinition`. **0.19 slips past both**, so a flattened roof was silently treated as a
real, almost-flat one. Below 0.5° the engine also **hard-codes azimuth to 180** — the real azimuth is
destroyed, not approximated.

Recomputed downstream consequences for a 25° face:

| Consumer | Before | After | Effect |
|---|---|---|---|
| PVWatts annual kWh | 25° | 0.19° | **−8 to −12 %** — reaches the customer proposal |
| ASCE 7-22 wind (7° threshold) | 25 > 7 ✓ | 0.19 > 7 ✗ | **binary flip** — applicability disclosure dropped from the permit |
| ASCE 7-22 snow `Cs`, slippery roof | 0.692 | 1.000 | `ps` overstated **+44.5 %** |
| `cos(pitch)` sloped-area basis | 0.9063 | 1.0000 | **−9.4 %** area, shifting `arrayCoverageFrac` and the resolved fire setback |

**Fix.** A new pure helper, `projectOutlineOntoPlane` in `lib/roofPlane3D.ts`, solves for the one
height that puts each squared corner on the plane the face already had (intersecting the geodetic
vertical with that plane). The outline squares up; the plane does not move. It returns `null` for a
vertical plane rather than inventing a height.

**Second half of the same defect.** Square Up drew the deck from a frame built with
`{ surfaceOffsetM: 0 }` but stored a plane built with the **default** lift, because
`buildRoofPlane3D` took only points — it was *structurally impossible* to ask it for an unlifted
plane. Deck and placement geometry therefore sat exactly `SURFACE_OFFSET_M` apart on every press,
and the gap **compounded across save/reload cycles**. `buildRoofPlane3D` now takes the same
`ComputePlaneOptions` as `computePlaneFromPoints3D`, and Square Up passes `0` to both.

**Tests** — `tests/squareUpPreservesPitch.test.ts`, 12 tests, pure math, no Cesium. Pitch and azimuth
preserved at 15/25/30/45°; the outline genuinely squares; projection is idempotent; degenerate input
declined. And the defect is **asserted, not described**: the old mean-height rebuild is reproduced
verbatim and shown to collapse 25° → <0.5° with azimuth exactly 180, with the residual pinned to
0.1–0.3° so the "not zero, therefore invisible to the guards" property is itself a test.

---

## WS1-016 — Every reshape emitted a new origin on a stale frame

| | |
|---|---|
| **Severity** | **P1 — reaches panel count, kW and BOM** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

The `onRoofPlanesStitched` contract carried `vertices`, `localFrame3D`, `polygon3D`, `origin3D`,
`normal3D`, `pitch`, `azimuth` — but **not `ecefFrame3D`**. `buildSurfaceGrid` places panels from
`ecefFrame3D`, *not* `localFrame3D`. So every reshape handed the placer a **new origin on the old
triad**.

With the plane rotated by Δ about the eave axis, clearance above the drawn deck is
`d = PANEL_OFFSET_ECEF·cos(Δ) − v·sin(Δ)` — negative once `tan(Δ) > 0.05/v`, i.e. **~0.48° at 6 m up
the slope**, deepening linearly along the row. Not merely cosmetic: `polyUV` projects the new polygon
onto the stale `u`/`v`, foreshortening the usable extent by **cos²(Δ)** — an 18 % loss of measured
roof on a 25° face, which removes whole rows and therefore changes **panel count, kW and BOM**.

**Fix.** `ecefFrame3D` added to the contract, emitted at all three reshape sites, applied by the
studio handler.

🚨 **The shape was declared FOUR times** — once on the prop and once inside each of the three
functions that fill it — so a field added in one place never reached the others. Collapsed to one
exported `RoofPlaneReshapeUpdate`, and the test now asserts no inline re-declaration exists.

**Test repair.** `tests/reshapeKeepsPitch.test.ts` matched `updates.push` blocks with a **420-character
cap**. Adding one field pushed two of three blocks past it, so it matched one and failed
"expected 1 to be 3" — *a test that breaks when the thing it guards is correctly extended*, and whose
failure reads like a regression. Now matched by **brace balance**, and it asserts `ecefFrame3D` too.
Mutation-checked: removing one emit fails with the offending block named.

---

## Also confirmed (P1/P2) — carried forward, not yet detailed

`SolarEngine3D` applies restored obstructions to the wrong site · obstructions/measurements are
signed but not owned · `changeSite` never applies the arriving bundle's electrical · an undeclared
**fourth** client writer to the layout row (Calculate) and a **hidden fifth** (auto production calc,
3 s after every panel change) · `projects.lat/lng` is the input to every site decision and is
written by three unrelated paths · the Phoenix placeholder coordinate `{33.4484, -112.074}` becomes
a real `mapCenter` in `buildLayoutFromDefinition` · Gable and Hip tools emit **no** roof plane ·
2D-traced planes never get `planeHeightAtCenterMeters` · `layouts` has no
`UNIQUE(project_id, user_id)` · the operator has no way to see that a migration is unapplied ·
`scope()`/`isCurrent()` — the documented stale-response defence — has **zero production callers**.

---

## Definition of Done — Workstream 1

| Gate | State |
|---|---|
| Source of truth identified | ✅ for panels, roof planes, site identity, panel elevation |
| All writers audited | ✅ 6 panel-set writers, 11 panel counts, 5 layout-row writers enumerated |
| All readers audited | ✅ |
| DB / migration verified | ❌ **migration 123 unapplied in production** |
| Positive tests pass | ✅ 11/11 new clearance + 17/17 rewritten routing |
| Negative tests pass | ✅ |
| Mutation tests pass | ✅ proven to fail by **5.33 m / 4.11 m** with the lib fix reverted; **11/17** routing tests fail with the component fix reverted |
| E2E passes | ❌ **not run by me** — see below |
| Full suite passes | ✅ **564 files, 12,140 tests, 0 failures**, 490 skipped |
| tsc passes | ✅ exit 0 |
| Lint passes | ✅ 0 errors (29 pre-existing warnings) |
| Build passes | ✅ Build Gate green in CI |
| CI passes | ✅ **10/10 green on `a754a4ec`**, incl. `CI Complete`, Unit Tests, tsc, ESLint, secret guard, page-fit |
| Staging deploy verified | ❌ |
| Exact tested SHA verified | ✅ `a754a4ec` (a docs-only commit may follow it) |
| **Visual check in a browser** | ❌ **NOT DONE — the fixes move rendered geometry** |
| No known P0/P1 in workstream | ❌ WS1-002, WS1-003, WS1-012, WS1-013 open |

**WORKSTREAM 1 COMPLETE: NO.**

🚨 **I have not yet executed Ray's workflow end to end.** The programme's standard is that he is
asked to confirm only after I have run the exact human workflow myself on a deployed build. I have
not. What I have is: the defects root-caused with citations, three fixed with tests that provably
fail without the fix, and the rest specified. **Ray should not be asked to acceptance-test this
yet.**

## Owner actions required (cannot be done from here)

1. **Run migration 123** (`layouts.site_archives`) via **Admin → System Tools → Migrations**.
   Until then the archive never persists and WS1-003 destroys designs silently at HTTP 200.
   Verify against `schema_migrations`, never a UI message.
2. **Delete the pinned `NEXT_PUBLIC_BUILD_VERSION`** from the Vercel project so `/api/health`
   stops reporting a false version.

---

## Coordination

A peer Claude session — **"SolarPro Phase 2 recovery and verification"** — is working in this same
tree and committed `6aa5ea0a` at 11:43 today, mid-session. I have **not modified any tracked file**
and sent it a coordination message covering scope, in-flight files, and the WS1-006 regression.
No reply at time of writing.

**Nothing in `6aa5ea0a` is on a remote.** Production remains on `5d89d4dc` with WS1-001, WS1-004
and every Failure B defect live.

---

# WORKSTREAMS 2–8

Not started. Workstream 1 owns the session until its dependency chain is exhausted.

| # | Workstream | Status |
|---|---|---|
| 2 | Security / authorization P0 closure | NOT STARTED |
| 3 | Engineering authority / determinism | NOT STARTED |
| 4 | Permit integrity + cross-consumer validator | NOT STARTED |
| 5 | Phase 3 roof UX | NOT STARTED — deferred until WS1 is trustworthy |
| 6 | Roof material → BOM | NOT STARTED |
| 7 | Shade + accuracy harness | NOT STARTED |
| 8 | Governed AHJs / Sol Fence / RE+ commercial polish | NOT STARTED |

**WORKSTREAM 1 COMPLETE: NO.**
