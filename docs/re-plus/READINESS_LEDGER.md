# SolarPro — RE+ Readiness Ledger

**Permanent execution truth source.** Closed defects are never deleted.

RE+ is **2026-11-16** (57 days from 2026-09-20).

## 🚨 REVISION BASIS — read before quoting any finding

| Name | SHA | What it is |
|---|---|---|
| `origin/master` | `5d89d4dc` | **What production runs.** Phase 2 site-ownership merged. Every Workstream 1 fix is still ABSENT here. |
| `origin/fix/ws1-autolayout-panel-elevation` | branch head | **All of Workstream 1.** Pushed. This is what the findings below describe. A SHA is deliberately not pinned here: this file is part of the commit, so any SHA written in it is always one commit stale. Test-run SHAs are recorded where a result is quoted. |
| `origin/fix/phase2-post-merge-regressions` | `e3a60e9a` | PR #19. **A strict SUBSET** — both its commits are ancestors of the branch above. |

> **PR sequencing is not a hazard here.** `git log HEAD..origin/fix/phase2-post-merge-regressions`
> is **empty**: the Workstream 1 branch already contains every commit in PR #19. Merging the
> Workstream 1 PR alone delivers both; merging #19 first also works. There is no order that loses
> anything, and no dependency for the owner to manage.

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
| **Status** | `FIXED_PENDING_VERIFICATION` |
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

**Fix.** `hydrate` now asks *"is this the same **property**"* (`sitesAreSameProperty` — the same
predicate `resolveSiteKey` and the detection staleness guard use, so there is one definition in the
codebase, not a third) instead of *"is this the same **string**"*. The key that survives is
`parsed.activeSiteKey`, **not** the drifted `siteKeyNow`: archives are filed under the stored key
and roof planes are stamped with it, so adopting the geocoder's key would orphan both.

**The class, eliminated — not the instance.** A re-audit after the fix found *four* places asking
the identity question, and fixed all of them: `hydrate`'s match, `hydrate`'s archive reactivation,
`switchSite`'s "already here" early return, and `switchSite`'s arriving-bundle lookup. `isSameSite`
(exact string) now survives only as the primitive `sitesAreSameProperty` is built on. The two
`switchSite` cases were reachable by any caller that had not pre-resolved a key — and that function
is exported, so correctness depended on a caller remembering.

🚨 **The first fix was incomplete, and the test caught it.** Correcting the `matched` comparison
left its sibling untouched: the reactivation branch still did `archives[siteKeyNow]`, an **exact**
lookup, so a user returning to a property the archive genuinely held *missed it* and fell into the
same empty + `needsAdoptionSave` branch. Archive lookup is a property question, not a string
lookup. Added `nearestSamePropertyKey` — **nearest** match, not first, because two real houses can
both sit inside the radius of a point between them and first-match would make one permanently
unreachable (the same rule `resolveSiteKey` already follows).

**Tests** — `tests/restoreIdentityDrift.test.ts`, 11 tests. The fixture is asserted honest first
(the click and geocode keys genuinely differ, are genuinely the same property, and are 1.2–8 m
apart). Then: the design stays active, `needsAdoptionSave` is false, panels return **by id**, the
stored key survives, archives carry through, a genuinely different property is still archived, and
a drifted return still reactivates its archive.

---

### WS1-003 — With migration 123 absent, placing ONE panel at a new property overwrites the previous property's 52

| | |
|---|---|
| **Severity** | **P0** |
| **Status** | `FIXED_PENDING_VERIFICATION` — **migration 123 is applied in production** (owner-confirmed 2026-09-20), so the archive now persists; the fail-closed refusal remains as the guard for any environment where the column is absent |

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
> documented as the reason Melvin survived by luck and deliberately not fixed.

**Fix — fail closed, before any write.** `upsertLayout` now refuses when `siteArchives` carries an
archived property that **would actually be lost**: the column is absent and at least one archived
bundle has entities. It runs before the first `UPDATE`, and deliberately **outside** the wipe
guard's `try/catch` — that block re-throws only `LAYOUT_SUBSYSTEM_WIPE` and swallows everything
else, so a refusal raised inside it would have been discarded.

It refuses only on real loss: an archive with no entities round-trips identically whether stored or
not, so a single-property project keeps working normally on a pre-123 deployment. All four entity
kinds count — refusing only when *panels* would be lost would silently discard a traced roof, which
is just as much work.

**Tests** — in `tests/siteDesignRoute.postgres.test.ts`, against **real PostgreSQL** (PGlite,
in-process, no credentials), with migration 123 deliberately absent: one panel at the new property
is refused **409 `LAYOUT_ARCHIVE_UNSTORABLE`** and *nothing is written*; an empty archive is still
allowed through; a roof-plane-only archive is refused too; and the same save **succeeds** once 123
has run, with the 52 panels readable back out of `site_archives`.

🚨 **Mutation-proven.** With the check reverted, that test returns **HTTP 200** — the save
succeeds, the 52 panels become 1, and the archive is discarded. That is the defect, reproduced.

---

## WS1-017 — A deliberate refusal was reported as a transient database error

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

Every throw in the layout route went through `handleRouteDbError`, which classifies anything that
is not a `DbConfigError` as **503 `DB_STARTING`** — a status its own comment describes as transient
and self-resolving on retry ([lib/db/core.ts:137-141](lib/db/core.ts:137)).

Both data-protection guards are the opposite of transient: they are permanent, deliberate refusals
to destroy the user's work, and they stay refused until a human acts. Reporting them as 503 cost
twice over — the studio showed a **generic save-failed badge that cleared itself after five
seconds**, so the user saw a blink and no reason and carried on designing into a layout that was
not being saved; and the operator saw a transient-DB warning for a condition that actually means
*run migration 123*.

**Fix.** The route maps `LAYOUT_SUBSYSTEM_WIPE` and `LAYOUT_ARCHIVE_UNSTORABLE` to **409 Conflict**
with a distinct `code` and `refused: true`, carrying the message the guard already wrote. The
studio surfaces that message in a toast and **leaves the error badge up** rather than clearing it,
because the condition is permanent. It speaks **once per distinct reason** — the autosave retries
every few seconds, and repeating the same toast forever is how a real warning becomes wallpaper —
and resets on the first successful save.

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
| **Status** | `FIXED_PENDING_VERIFICATION` |
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

**Fix.** The two parallel counters are **deleted**. The badge counts `panels.length` and
`roofPlanes.length` — the canonical source the top bar and System Summary already used — so the
three readouts cannot disagree. `layoutLoadedFromDB` now answers only the question it is named for,
provenance, and is **updated on every property change** instead of latching once on mount.

**Test** — `tests/designStudioSiteSwitch.component.test.tsx`: after moving to a property with
nothing stored, the rendered DOM must not contain `"Layout loaded from DB · 0 panels"`, nor any
`loaded from DB … · 0 panels` variant. 🚨 **Mutation-proven**: restore the latch and drop the badge
guard, and the test fails with **Ray's exact string** in the assertion message.

> Still outstanding as a *fourth* source, deliberately not changed here: `SolarEngine3D` keeps its
> own `panelCount` state (19 writers) driving the 3D HUD, reconciled with the prop by a lagging
> `useEffect`. It is inside the 3D viewport, it did not participate in the contradiction Ray saw
> (top bar, summary and badge are all DesignStudio), and collapsing 19 call sites wants its own pass.

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
| **Status** | `FIXED_PENDING_VERIFICATION` |

`tests/designStudioSiteSwitch.component.test.tsx` mounts the real DesignStudio and drives the real
`onLocationPick` — a good layer — but every call replays the **same two constants**
`MELVIN.lat/lng` and `NEIGHBOUR.lat/lng`
([:177-269](tests/designStudioSiteSwitch.component.test.tsx:177)). Replaying an identical
coordinate tests exact-equality against a trivially equal key. The production failure is precisely
that **a human cannot reproduce a coordinate**.

**Fix.** Added to the same file: **A1 → neighbour → A2, 2.8 m from A1** — the same distance as the
accidental duplicate in the live trace — driven through the real `onLocationPick`. The fixture
asserts up front that the two clicks genuinely mint different keys, then that the panel,
roof-plane, obstruction and measurement **entity IDs** all return, and that the surviving key is the
one the design was **filed under** rather than the new click's.

🚨 **Mutation-proven**: disable the proximity snap in `changeSite` and this test fails while the
other eight in the file still pass — which is precisely the blindness that let the defect ship.

Also confirmed at the time: **no test anywhere asserted panel elevation above the roof surface** —
now closed by `tests/panelSurfaceClearance.test.ts` — and the two Playwright specs remain the only
browser layer.

---

## Failure B — Auto Layout panels sink into the roof

One sentence: **there are two different, unshared definitions of "the roof surface" on either side
of the render boundary.** Six independent confirmed defects.

**Fixed in this session** on branch `fix/ws1-autolayout-panel-elevation` — **PR #20**:
WS1-008, WS1-009, WS1-010, WS1-011, WS1-012, WS1-014, WS1-015, WS1-016. Still open: **WS1-013**
only, at P2, and it needs a visual judgement rather than more analysis.

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

### WS1-012 — Square Up renders the face unlifted but places panels on the lifted plane — `FIXED_PENDING_VERIFICATION` (closed by the WS1-015 fix: both calls now pass the same offset)

`squareUpTracedFaces` derives two geometries from the same points: `frame` with
`{ surfaceOffsetM: 0 }` (correct) for the **rendered** surface, and `buildRoofPlane3D(pts3D)`
(which silently re-applies 0.12 m) for the **placement** geometry
([SolarEngine3D.tsx:4529-4549](components/3d/SolarEngine3D.tsx:4529)). The two go to different
consumers with no guard anywhere on the path.

### WS1-013 — There was no authority for "how high a module sits above the deck" — `FIXED_PENDING_VERIFICATION`

| | |
|---|---|
| **Severity** | **P1** — viewport only, but it made the single-panel tool non-idempotent |
| **Reaches engineering output** | **No.** Re-audited: the only non-3D readers of `PlacedPanel.height` are `lib/3d/ground/groundMountRealityEngine.ts` (ground mounts) and one finiteness check in `lib/3d/controlLayer.ts`. Every `panel.height` under `lib/permit/**`, `lib/cad/**` and `lib/engineering/**` is a module DIMENSION (`heightM`/`heightIn`), not an elevation |

🚨 **I previously recorded this as "a product choice between two equally valid behaviours, needing
a visual judgement". That was wrong, and the error was in the counting.** I compared two numbers —
`PANEL_OFFSET_ECEF = 0.05` against `getRoofPanelOffset = 0.14` — and called them 9 cm apart. They
are not comparable at all, because **they are measured from different datums.** Follow each path
back to what it measures FROM and there are not two conventions but four, and one of them is not a
height:

| Path | Measured from | Adds | Above the deck |
|---|---|---|---|
| `buildSurfaceGridECEF`, `placeSinglePanel`, `addRow`, `extendRow` | `origin3D` — the fitted plane, itself lifted `SURFACE_OFFSET_M` | 0.05 | **0.17** |
| `panelPositionFromCAD`, `panelHeightFromCADOffset` | `groundElev + planeHeightAtCenterM` — raw deck | 0.18 | **0.18** |
| Google-segment fill ([:11289](components/3d/SolarEngine3D.tsx:11289)) | `segElev` — raw deck | 0.14 | **0.14** |
| Grid fill ([:11433](components/3d/SolarEngine3D.tsx:11433)) | `originCart` at `segElev` — raw deck | 0.14 | **0.14** |
| Single panel on a marked plane ([:6406](components/3d/SolarEngine3D.tsx:6406)) | `rp.origin` from `collectRoofRenderables` | 0.14 | **see below** |

**The fourth is a ratchet, not an offset.** `collectRoofRenderables`
([:4204](components/3d/SolarEngine3D.tsx:4204)) has three branches. For a plane traced in this
session it takes the real frame; for a legacy 2D plane it derives one. For a plane **restored from
the database** no frame survives, so it rebuilds one from a panel sitting on the plane — and takes
that panel's position as the plane ORIGIN:

```ts
origin = safeCartesian3(C, rp.lng, rp.lat, rp.height ?? 0);   // rp is a PANEL
```

`handleRoofClick` then projects the click onto that "plane" and lifts by the mount stack again. So
after a reload every hand-placed module lands one stack height above its neighbours — and the next
reload measures from the raised one. **14 cm per turn, compounding.** Nothing in the suite could
see it: every elevation test placed panels within a single session.

**A fifth instance of the same double-add.** `showGhostPanel` is handed the height of the module
just placed and adds the stack to it again ([:9284](components/3d/SolarEngine3D.tsx:9284)), so the
preview of the next module was drawn one stack above where that module would land — on every roof
click.

### Why this is not a product choice

Two facts settle it without an eye.

1. **The module stack is a manufacturer fact, not a preference.** A module's underside sits
   `standoff + rail` above the deck. `lib/mounting-hardware-db.ts` already carries the rail sections
   with an `engineeringDataSource` for each (XR100 1.66", XR1000 2.00", SolarMount 1.75"), and the
   renderer was restating three of them from memory while drawing no rails at all for the 16 other
   systems that publish one.
2. **`PANEL_OFFSET_ECEF = 0.05` was never a height.** Its own comment gives the derivation:
   *"origin3D already lifted 0.12m … Total above mesh: 0.12 + 0.05 = 0.17m — correct, z-fight-free"*.
   It is a physical quantity with a **z-fighting constant subtracted out of it**. `SURFACE_OFFSET_M`
   translates the entire roof assembly — deck, modules, rails — by one vector, so it cancels from
   every relative measurement. Letting it into the mount stack is the defect.

### The fix — `lib/roofMountDatum.ts`

One module, one answer, and its inverse beside it:

```
moduleStackHeightM(mountId)      deck → module underside
railCrossSectionM(mountId)       rail section, read from the manufacturer record
modulePointFromDeck(...)   /   deckPointFromModule(...)
```

The pair exists because the bug was an **unpaired application**: anything that recovers a plane from
a module must invert the datum before anything else re-applies it. `collectRoofRenderables` now
calls `deckPointFromModule`, so all three of its branches return the same thing — the deck.

`getRoofPanelOffset` and `getRailSpec` are gone from the component. Every value they returned is
**preserved exactly** — this change is about having one datum, not about choosing new numbers — and
systems they did not list now derive a stack from the database's own `systemType` and rail section
instead of collapsing to a single 0.12. Where a rail-based record publishes no rail section
(RT-MINI), a named `COMPANION_RAIL_IN` entry keeps the rail the viewport has always drawn, labelled
as a viewport assumption rather than a manufacturer claim.

**Rails now hang from the module underside.** The old rule was `inwardM = stackH − railH/2`,
justified by a comment reading *"panel.height = roofDeckAlt + stackH"* — and `roofDeckAlt` is not a
variable anywhere in the file. It also centred the rail as though the rail were `railH` tall while
the box is **drawn at `railH × 3`** (a deliberate visibility exaggeration), sinking the run `railH`
into the deck. A rail's top face carries the module, so `centre = module − normal · drawnHeight/2`
needs no deck datum at all and stays correct whatever the stack height and exaggeration are.

### Proof

`tests/roofMountDatum.test.ts` (11 tests) asserts that all four ECEF paths put a module at the same
height on the same plane, that the datum round-trips, that applying it twice without the inverse
drifts by exactly one stack height, and that the clearance actually changes with the racking — a
`mountingSystemId` that is threaded but ignored is indistinguishable from one that is honoured until
someone changes racking.

🚨 **Mutation-proven, three ways:**

| Reverted | Failure |
|---|---|
| `placeSinglePanel` back to `0.05` | *"panel … sits 0.0489 m above the plane, expected 0.14"* |
| datum ignores `mountingSystemId` | *"expected 0.12 to be less than 0.12"* — the racking no longer moves anything |
| XR100 stack set below the drawn rail | *"expected 0.126492 to be less than 0.1"* — the rail no longer fits in the gap |

And in a real browser, through the real Auto Layout button — see **WS1-025**.

### Two consequences the ledger must not gloss over

- **`tests/panelSurfaceClearance.test.ts` had a test tuned to the old number.** Its adversarial case
  pushed a panel 0.10 m along −n and asserted the result was below the roof. That only sank a panel
  while the clearance was 0.05 m; at the real mount stack the "sunk" panel was still 4 cm clear, and
  the adversarial test was asserting something that could no longer happen. The push is now measured
  from the datum.
- **The WS1-008 double-lift no longer buries modules — and the test now says so honestly.** It used
  to assert modules sat ~0.07 m BELOW a re-lifted deck. At a 0.144 m stack, a 0.12 m over-lift leaves
  +0.024 m instead. The restore defect is not gone; what it costs now is the **rail**, which is
  0.127 m drawn and cannot fit in 0.024 m. The test asserts that, rather than keeping a number that
  stopped being the symptom.

### Two more leaks, found by re-auditing after the fix rather than before

Doctrine: after implementing, audit again assuming you missed something. Searching for the
*arithmetic* rather than the *names* turned up two more places that answer the same question:

- **`components/3d/CesiumViewer.tsx:461`** — `panelElev = seg.elevation + 0.05`. A **sixth** datum,
  and the same z-fighting constant. The file has **zero importers** (verified across every `.ts`,
  `.tsx`, `.js` and `.json` in the repo), so it cannot drift anything at runtime — but reviving it
  would reintroduce the split. It now reads the authority, with a comment saying so. The file is
  left in place; deleting someone's component is not this workstream's call.
- **`placePanelsMultiPlane`** — imported by `SolarEngine3D` and **never called**. It wraps
  `placePanelsControlled` with `mode: 'auto_roof'` and passed no mounting system, so wiring it up
  later would have silently placed modules at the conservative default. Threaded.

Neither was reachable. Both were how the original four became four.

### Transitive consequence, checked rather than assumed

`collectRoofRenderables` has seven consumers, and correcting branch 2's origin changes what all of
them see **for restored planes only** (branches 1 and 3 were already returning a deck). Each was
audited:

| Consumer | Uses `origin` for | Effect of the correction |
|---|---|---|
| `planeRenderableAtClick` | in-plane projection + a `|dn| > 3.0` proximity window | the intended fix; 0.14 m is far inside a 3 m window |
| `renderFireSetbackZones` | a UV reference the bands are rebuilt from | bands move from the panel plane down to the **deck**, where a no-panel zone belongs |
| `snapTracedPoint`, `renderBuildingExtrusion`, `renderRoofWireframe` | corners only — no `origin` reference | none |
| `squareUpTracedFaces`, `applyBuildingShape` | traced faces (branch 1) | none |

Every one of those consumers was previously handed a **module's position as a roof plane** on any
restored design. They were not compensating for it; they were inheriting it.

**Still open in the same family:** 2D-traced planes carry `planeHeightAtCenterMeters: 0.0`, so
`computeEcefFrameForLegacyPlane` places them at `LEGACY_PLANE_HEIGHT_M` above ground. That is a
plane-height question, not a mount-datum one, and it is now the only part of this item left.

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

## WS1-019 — Stitch was a FOURTH reshape path, and it emitted nothing about the plane

| | |
|---|---|
| **Severity** | **P1 — reaches the planset, structural and production** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

**I claimed to have eliminated this class and had not.** WS1-016 added `ecefFrame3D` to "all three
reshape emitters" — but there are **four**. Stitch fills an array called `stitchUpdates`, so both a
name-based search and my own new test missed it entirely, and it carried `vertices`,
`localFrame3D`, `polygon3D`, `origin3D` and `normal3D` — and **no `pitch`, no `azimuth`, no
`ecefFrame3D`**.

Stitch is not a cleanup. Ray uses it deliberately to pull separate planes into a peak — a modelling
move that **changes the plane**. So `plane.pitch` kept its pre-stitch value while the 3D roof
changed underneath it (read by the planset, the structural engine and the production model), and
`buildSurfaceGrid` kept placing panels on the pre-stitch triad while clipping them to the stitched
outline — the wedge and the cos²(Δ) row loss of WS1-016, on the one path that was still exposed to
them.

It also held a **fifth** inline copy of the reshape shape. Collapsed to `RoofPlaneReshapeUpdate`
like the rest; pitch and azimuth are derived exactly as `buildRoofPlane3D` derives them, so a
stitched face and a traced one report the same numbers for the same geometry.

🚨 **The test had the same blindness twice.** Version one enumerated three named callbacks and
missed the two that shipped broken. Version two searched for `updates.push({` and missed
`stitchUpdates`. It now discovers emitters from the **channel** — every array passed to
`onRoofPlanesStitched?.(…)` — because a guard that enumerates by name is always one rename behind.
It asserts four emitters, each carrying all three fields, and that all four arrays use the shared
type. Mutation-proven: drop `pitch` from the stitch push and it fails naming the block.

---

## WS1-020 — Two more site-bound facts that never moved with the property

| | |
|---|---|
| **Severity** | **P1** (both) |
| **Status** | `FIXED_PENDING_VERIFICATION` |

**Obstructions were restored through a one-shot latch, and the engine never remounts.**
`appliedInitialObstructions` was set `true` the first time a non-empty `initialObstructions`
arrived and was **never reset**. `<SolarEngine3D>` carries no `key` and `changeSite` does not touch
`show3D`, so the component survives every property change: after site A's obstructions were applied,
switching to B changed the prop and the effect returned on its first line, leaving
`obstructionsRef.current` holding **A's keep-outs while standing on B**. Two silent consequences —
`removeObstructedPanels` culls B's panels using A's vent footprints in the plane3d and
surface-select auto-fills, and placing one obstruction at B appends to A's list, so the outbound
effect persists A's obstructions onto B. Replaced with a sync on the array's **identity**, so an
empty array is a real answer ("this property has none") — which the old guard could not express at
all, because it declined to apply empty.

**`changeSite` never applied the arriving property's electrical design.** The bundle stores
`designElectrical` precisely so "returning to a property restores its topology/string paint, not the
other property's" — and `res.arriving.designElectrical` had **no reader** in DesignStudio. Topology,
racking, modules-per-string and the manual string paint carried straight across, and
`buildDesignElectrical()` folded them into the layout persisted for the **new** property. The string
paint is the worst of it: panel ids are index-based (`panel_${n}`), so A's override **keys** collide
with B's panels and `stringAssignment` repaints them rather than skipping them.

🚨 **My first test for this was vacuous and the mutation test caught it.** The studio only builds
`designElectrical` when panels exist, so an empty neighbour posts none at all and every assertion
compared against `undefined` and passed for the wrong reason. The test now places a panel at the
neighbour first — which is also exactly when a real user meets the bug. Mutation-proven: revert the
fix and it fails with `expected 'micro' to be 'string'`.

---

## WS1-021 — A read-only calculation was writing invented facts into the layout

| | |
|---|---|
| **Severity** | **P1** — includes unconditional data loss |
| **Status** | `FIXED_PENDING_VERIFICATION` |

`/api/production` routes a **read-only production calculation** into the layout **save** chokepoint:
it picks `buildLayoutFromDefinition` whenever the body carries a `systemDefinition` and no `layout`,
which is exactly what the studio's Calculate button sends. That function was written to satisfy
`upsertLayout`'s *type*, not to describe a real layout, so it invented values and `upsertLayout`
persisted them as fact:

- **`mapCenter: { lat: 33.4484, lng: -112.074 }` — Phoenix, hardcoded.** `map_center` *is*
  COALESCE'd, but COALESCE only protects against **absence**, and this supplied a confident wrong
  answer instead. Every project that pressed Calculate had its map centre overwritten with Arizona.
  **A fabricated value defeats a guard that a missing one would have satisfied.**
- `rowSpacing: 1.5` and `groundHeight: 0.6` — literals with no source, overwriting user settings.

And the writer's own column semantics were **unevenly applied**: `roof_planes` and `map_center`
were COALESCE'd while the seven fields between them were not. `fence_line` was written
unconditionally from a value that is null whenever the caller omits a fence — so **any** write
without one **set the stored fence to NULL**.

**Fix.** The invented values become `undefined`, which the writer now reads as "keep what is
stored"; and `fence_line`, `fence_azimuth`, `fence_height`, `ground_tilt`, `ground_azimuth`,
`row_spacing`, `ground_height` are all COALESCE'd. An explicit empty array still clears a fence —
only genuine absence keeps.

FIRST TEST WAS VACUOUS, AND THE MUTATION TEST CAUGHT IT AGAIN. It went through `POST /layout`,
which already merges every absent field against the stored row. That route shields the writer, so
the defect can never be observed through it. The tests now call `upsertLayout` **directly** — the
only way to assert the writer's own semantics rather than one caller's politeness, and the
production path does no such merge. Mutation-proven: revert and they fail with "the fence was
erased by a write that never mentioned it" and "expected 20 to be 27".

## WS1-022 — The Phoenix placeholder could mint a site key and own a design forever

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

Two definitions of "are these coordinates real". DesignStudio's `hasValidCoords` rejected the
un-geocoded placeholder; `siteKeyFromCoords` — the **only** thing that decides ownership — had no
placeholder concept and minted `"<projectId>@33.44840,-112.07400"`. The restore path resolves
ownership from `mapCenterRef`, seeded with exactly the value the same file had just declared
untrustworthy.

The active key is decided once and never revised — only two writers, and a later geocode re-centres
the map without re-keying. So a design adopted under Phoenix **stayed owned by Phoenix for the whole
session**, and the real pick ~2,400 km away could never reclaim it, because `resolveSiteKey` only
snaps within `SITE_MATCH_RADIUS_M`.

**Fix.** `isPlaceholderCoords` and the constants move to `lib/siteIdentity.ts` as the single
authority, and `siteKeyFromCoords` returns `UNRESOLVED_SITE_KEY` for the placeholder — the safe
answer, because `hydrate` on an unresolved key keeps the stored design **active** and archives
nothing. Exact equality is deliberate, and a test pins that one ten-thousandth of a degree away is
still a real coordinate.

## WS1-023 — Save & Calculate persisted a phantom roof plane

| | |
|---|---|
| **Severity** | **P2** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

`buildSystemDefinition` synthesised a fake plane whenever there were panels but no traced roof, as a
"convenience" for pvwatts. **It was never even that:** both pvwatts call sites read
`roofPlanes[0].pitch` only when `panels.length === 0`, and this was only built when
`panels.length > 0`. Mutually exclusive — dead on arrival, and redundant anyway.

Its only observable effect was **persistence**: it reached `layouts.roof_planes` as a geometry
record with `vertices: []` and a fabricated `area` of `panels x 1.134 x 1.722` — the exact aggregate
module area, asserting 100% packing density with zero setbacks, row gaps or walkways. Not
approximate; incoherent. Deleted, which changes no production number.

---

## WS1-024 — Obstructions and measurements were signed but could not trigger a save

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

Migration 122 added obstructions and measurements to the persisted payload **and** to the save
signature (`SIGNED_DESIGN_PARAMS`), which is why this looked finished. But signing only
**suppresses the early return** once something else has already scheduled a save — **it cannot
schedule one.** Both were missing from the autosave effect's dependency array, so placing a vent or
drawing a measurement started no timer, and the work persisted only if the user happened to touch a
panel afterwards.

🚨 **The same trap, twice.** The v66 comment sitting directly above that dependency array describes
exactly this failure mode for `roofPlanes` — *"They were persisted but could not TRIGGER"* — and two
migrations later the identical mistake was made for the entities 122 introduced. Signing a field and
watching a field are different jobs; doing the first does not do the second.

**Tests** — two added: an obstruction change and a measurement change must each schedule a save on
their own, and the saved payload must contain the new entity **by id**. Mutation-proven: remove them
from the deps and both fail with *"expected 0 to be greater than 0"* — zero saves scheduled.

---

## WS1-018 — The render lift reached the permit site plan and split every gable ridge

| | |
|---|---|
| **Severity** | **P1 — permit-visible** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

This is the defect behind the correction above, now measured and closed.

`buildRoofPlane3D` derived `plane.vertices` from `frame.projectedPts` — the points **after** the
`SURFACE_OFFSET_M` render lift. That lift is applied along the plane **normal**, and a normal is not
vertical, so it carries a horizontal component of `offset·sin(tilt)` pointing **down-slope, along
that face's own azimuth**.

`vertices` carry no height. They are the plan-view engineering record — what
`lib/cad/buildCADFromSurvey.ts` hands to `geoPolygonToLocal` and what `lib/cad/roof/roofCAD.ts`
draws as plan polygons and setback bands. So every face slid down-slope in plan, and because the
two halves of a gable have **opposite azimuths** they slid *apart*:

| pitch | ridge split (measured) | = 2·offset·sin(tilt) |
|---|---|---|
| 4:12 (18.43°) | **7.63 cm** | 7.59 cm |
| 6:12 (26.57°) | **10.79 cm** | 10.73 cm |
| 10:12 (39.81°) | **15.43 cm** | 15.36 cm |

Up to six inches of open ridge on the permit site plan. `joinSharedCorners` has a **1.5 m**
tolerance, so nothing downstream ever noticed.

**Fix.** The plan-view record is taken **before** the lift. `polygon3D`, `origin3D` and the frame
keep it, so rendering and panel placement are untouched; only `vertices` and the centroid are
derived from the unlifted points. Area, pitch and azimuth are unaffected either way — a translation
along the normal is rigid, and area is measured in the plane's own UV basis relative to an origin
that moved with it.

**Tests** — `tests/ridgeContinuity.test.ts`, 15 tests. The fixture is asserted to be a real gable
with opposed azimuths first. Then both ridge corners coincide to sub-millimetre at 4:12, 6:12 and
10:12, for a flat roof, and with the lift opted out. An adversarial block reads the ridge out of
`polygon3D` — which is *supposed* to stay lifted — and asserts the separation equals
`2·offset·sin(tilt)`, so the assertions are proven load-bearing rather than vacuously true of any
two rectangles. A final block pins that area, pitch, azimuth and the `origin3D` lift are unchanged.

🚨 **Mutation-proven**: with the fix reverted the ridge tests fail by **7.63 / 10.79 / 15.43 cm**
against a 1 mm tolerance — 76× to 154× — matching the independent measurement exactly.

**Method repair.** The reason this survived is that *every* geometry invariant in the suite was
asserted **within** a single face and none **between** faces. That is why a correct per-face
invariance result was generalised into a wrong "not permit-grade" conclusion. This file is the first
between-face invariant; ridge continuity is now a standing assertion.

---

## WS1-025 — The browser gate was never blocked, and the guard that should have caught Failure B reported a pass while asserting nothing

| | |
|---|---|
| **Severity** | **P1** (test integrity) + the correction of a false blocker in this ledger |
| **Status** | `FIXED_PENDING_VERIFICATION` |

🚨 **First, a correction to this document.** The Definition of Done recorded the visual/browser
verification as **"Owner-blocked — no `DATABASE_URL` in this checkout"**. That was wrong. I had
reasoned from `/api/health` returning 503 to "the Design Studio cannot load a project, so there is
no roof to look at", and never tried it. The Playwright harness runs the whole Design Studio with
**no database at all**:

```
15 passed, 0 skipped, 0 failed   (production build, no DATABASE_URL)
```

The unauthenticated API calls do 401, and nothing under test depends on them. I recorded a blocker
I had inferred rather than measured, and it cost the workstream its most important gate.

### What was actually wrong: three ways for a browser test to pass without testing anything

**1. A conditional assertion.** `e2e/design-studio.spec.ts`'s *"panels sit ON the roof"* — the named
guard for Ray's *"Auto Layout generated panels visually intersect / disappear into the roof"* — put
its entire body inside:

```ts
if (planesWithVertices.length > 0 && panelsWithGps.length > 0) { ... }
```

The quick-launch demo project has no roof geometry, and acquiring one needs a Google Solar key. With
no key there are no planes and no panels, the condition is false, and the test reports **ok**. Two
sibling tests in the same file skipped *honestly* in that state (*"No panels placed"*); this one did
not. It has been reporting a pass since it was written.

**2. `isVisible({ timeout })` does not wait.** Every canvas-gated test used:

```ts
const hasCanvas = await canvas.isVisible({ timeout: 45_000 }).catch(() => false);
test.skip(!hasCanvas, 'No WebGL canvas — skipping ...');
```

`Locator.isVisible()` is an **instantaneous predicate**; the options bag is accepted and ignored. So
the check asked "is the canvas up *right now*", got `false` because Cesium had not mounted yet, and
skipped — with a message that reads like a machine limitation. Against a production build **five of
the seven** Design Studio guards skipped this way. `waitFor({ state: 'visible' })` actually waits.

**3. The E2E hook outlived the component.** `window.__solarE2E` was assigned in an effect and never
torn down. The `/design` page **does** unmount — an unauthenticated `/api/projects` call redirects to
`/auth/login` — after which a spec goes on reading a frozen snapshot of a dead component: clicks land
on nothing, counts never change, and every assertion passes against numbers that no longer can. I hit
this myself while probing in a browser, and mistook it for the app ignoring `seedDesign`. The effect
now returns `() => { delete window.__solarE2E; }`.

### The fix

`e2e/support/seedRoof.ts` seeds a **real** `buildRoofPlane3D` output on the active property, waits
until the 3D ENGINE has it (not merely the studio — see below), presses the real Auto Layout button
and waits for panels. Every guard that used to depend on Google answering now runs on every machine.

| | before | after |
|---|---|---|
| Design Studio + site ownership specs | 9 passed, **6 skipped** | **15 passed, 0 skipped** |
| *"panels sit ON the roof"* | passed while asserting nothing | asserts, on real panels |

### And a new one that asserts the thing nothing ever asserted

`e2e/panel-elevation.spec.ts` — the elevation invariant, asked of the **running application**:

```
for every panel Auto Layout placed:
    (panelECEF − plane.origin3D) · plane.normal  ==  moduleStackHeightM(racking)
```

The library-level test (`tests/panelSurfaceClearance.test.ts`) cannot see React state, the control
layer, the mounting-system prop or the 3D engine. The browser guard only ever checked
point-in-**polygon** — a horizontal test, satisfied perfectly by an array buried a storey
underground. Nothing anywhere asserted a panel's HEIGHT in the running app.

🚨 **Mutation-proven in the browser.** With `buildSurfaceGridECEF` reverted to `PANEL_OFFSET_ECEF`:

> *panel 04a2f8c9… sits **0.0478 m** above its roof plane; every panel must sit **0.14 m** above it
> (ironridge-xr100). Negative means the panel is INSIDE the roof — Ray's "panels disappear into the
> surface".*

and the second test: *"after a second Auto Layout, panel … sits 0.0481 m above the roof instead of
0.14 m — the array drifted"*.

### A harness readiness signal, because the gap is where the defects live

`engineRoofPlaneCount` joins the diagnostics: how many roof planes the **3D engine** holds, as
distinct from `roofPlanes`, which is what the **studio** holds. Pressing a placement button in the
gap between them places nothing, silently — a harness artefact that reads exactly like a product
defect, and the same gap where stale-frame defects (WS1-016, WS1-019) live.

---

## WS1-026 — Auto Layout did nothing, silently, on any building Google has no data for

| | |
|---|---|
| **Severity** | **P1** — user-facing, and it is the second-most-likely thing Ray would hit at the booth |
| **Status** | `FIXED_PENDING_VERIFICATION` |

Found by running the workflow rather than reading it. The effect that starts a 3D auto-fill
([SolarEngine3D.tsx:1988](components/3d/SolarEngine3D.tsx:1988)) was:

```ts
if (placementMode === 'auto_roof' && prevMode !== 'auto_roof') {
  const viewer = viewerRef.current;
  const C = (window as any).Cesium;
  if (viewer && C && twinRef.current) {        // ← the Google Solar building twin
```

`twinRef.current` is the Google Solar twin. **The user traces a roof, presses Auto Layout, and
nothing happens** — no toast, no status line, no log entry. The button looks broken.

The guard was not protecting the code after it. The branch it gates **already** handles an absent or
empty twin by polling for up to eight seconds and then filling from `roofPlanesRef` regardless. The
outer condition was not a precondition; it was preventing that code from ever running.

🚨 **It is also why the same click worked on one run and did nothing on the next.** `buildDigitalTwin`
*rejecting* versus *resolving with zero segments* is a network outcome, and it decides whether
`twinRef.current` is an object or null. I chased that as test flake for two runs before reading the
guard.

**Fix.** A roof the user drew is all the geometry this needs:

```ts
} else if (hasTracedRoof) {
  addLog('AUTO', `auto_roof: filling ${roofPlanesRef.current!.length} traced plane(s) — no twin needed`);
  setTimeout(runAutoFill, 100);
}
```

`handleAutoRoof` already reports honestly when it finds nothing to fill
(*"No roof detected — use Pick House …"*), so removing the outer guard restores the message too.

**Measured:** the browser suite went from flaking on Auto Layout to 15/15 stable, and the elevation
spec dropped from 58 s to 22 s — the eight-second wait for a twin that was never coming.

---

## WS1-027 — The production E2E gate, executed

The programme's standard is that Ray is asked to confirm only after I have run the exact human
workflow myself. Against a **production build** (`next build` + `next start`, `NEXT_PUBLIC_E2E=1`,
no `DATABASE_URL`):

```
15 passed, 0 skipped, 0 failed   (2.5 min, software WebGL)
```

covering: the Melvin A → B → A sequence and A → B → C → A, the archived-design banner, panning not
archiving, re-picking the same house, stitch continuity, adding panels not un-stitching, setback
bands hugging edges, panel-move smoothness, planset geometry, panels inside their polygon, **panels
at exactly one mount stack above the roof**, and **a second Auto Layout not lifting the array**.

🚨 **Dev-server runs are not this gate.** The same suite against `next dev` failed three tests with
`page.goto: Timeout 45000ms exceeded` — fifteen cold compiles, not a product defect. The gate runs
against a build.

### And I looked at it

Numbers are not the same as a look, and Ray judges this work by how it looks. So, on the production
build, with the roof seeded at the ground elevation the app itself reports for the site:

- The face renders with its edges correctly classified and coloured — **red ridge, cyan eave, two
  yellow rakes** — matching the status line *"Roof model — 1 face · 1 ridge · 0 hip · 0 valley ·
  1 eave · 2 rake"*.
- **55 modules** tile the face in flush rows, aligned to the eave, entirely inside the setback
  boundary. None outside the polygon, none sunk into the deck fill.
- The top bar reads **55 panels · 24.2 kW**, the System Summary agrees, and the engine log reports
  *"entities added: 55/55"* — the four-readout contradiction of WS1-005 does not reappear.

The ground is bare terrain rather than a building because there is no `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
in this checkout, so Photorealistic 3D Tiles do not load. That affects the backdrop, not the roof
model or the array.

**Not visually confirmed:** the rails. They are sub-centimetre at any framing that shows the whole
array, and their geometry is asserted numerically instead (`tests/roofMountDatum.test.ts` — the drawn
rail fits inside the mount gap for every railed system). A close-in rail check is worth doing the
next time someone is in front of the app with a Google key.

**What still needs a database**, and is therefore still owner-blocked, is narrower than this ledger
previously claimed: only the *persistence leg in a browser* — loading a saved project, the
"Layout loaded from DB" badge, and the 409 refusals end to end. The route side of all of that is
already proven against **real PostgreSQL** in `tests/siteDesignRoute.postgres.test.ts` (PGlite,
in-process, no credentials), so what is missing is the browser's half of a path whose server half is
tested.

---

## WS1-028 — The last "owner-blocked" gate was not owner-blocked either

| | |
|---|---|
| **Severity** | Verification coverage, and a second false blocker recorded by me |
| **Status** | `FIXED_PENDING_VERIFICATION` |

I closed the previous revision of this ledger saying one cell of the coverage matrix — the real
client against the real route against real PostgreSQL, in a browser — needed a database credential
and nothing else, and that I had *proven* no workaround existed. I had not proven it. I had
considered **one** workaround (stubbing the route inside Playwright), correctly rejected it as
redundant, and stopped there. That is not a proof; it is one candidate.

The workaround was in the repository already.

### The seam the driver provides

`tests/siteDesignRoute.postgres.test.ts` runs the real route handlers against real PostgreSQL with
no credential and no daemon — **PGlite**, Postgres compiled to WebAssembly, in-process. What it
could not do is reach the running Next server, because it swaps the driver with `vi.mock`, which
exists only inside vitest.

`@neondatabase/serverless` supplies its own seam. The driver speaks a small HTTP protocol, and
`neonConfig.fetchFunction` replaces the transport with any function taking `fetch`'s arguments. So
the database can be answered **in-process**, and every layer above it is untouched production code.

The wire contract was **measured, not assumed** — captured by replacing `fetchFunction` with a
recorder and running one query through the real driver:

```
POST  {"query":"select $1::int as n","params":["7"]}
      Neon-Raw-Text-Output: true   Neon-Array-Mode: true
←     {command, rowCount, rowAsArray:true, fields:[{name,dataTypeID,…}], rows:[["42"]]}
```

`lib/dev/pgliteNeonBridge.ts` answers that, `instrumentation.ts` installs it when
`SOLARPRO_LOCAL_PG=1`, and nothing loads unless that flag is set.

### What this is and is not

**It is real PostgreSQL.** The SQL is really parsed, planned and executed; `COALESCE` semantics,
`jsonb` casts, `ON CONFLICT` and constraints behave as they do in production, and
`lib/db-ready.ts`, `lib/db/projects.ts`, `upsertLayout` and `rowToLayout` are untouched.

**It is not the owner's database.** It does not prove production's schema matches — that is what
migrations and `schema_migrations` are for. It proves the **join**: that the shapes the client sends
and expects are the shapes the route actually reads and returns against a real column set. A stub on
either side cannot prove that, because a stub matches whichever side you were looking at when you
wrote it.

### Three things this immediately exposed

- **The dev auth bypass needs a HEADER, not just the env var.** `getDevSessionUser` AND-gates
  `DEV_AUTH_BYPASS=true` with `X-Dev-Auth: bypass`, deliberately, so a signed-in user is never
  silently replaced. Every browser spec had been running unauthenticated, every `/api/projects` call
  401'd, and the page redirected to `/auth/login` mid-spec — which is what left a dead component's
  `window.__solarE2E` on the page for specs to keep reading (WS1-025).
- **The quick-launch demo project can never persist.** `makeDemoProject` mints
  `id: 'demo-' + Date.now()` and `userId: 'demo'`; the layout route requires UUIDs. So no browser
  test could ever have exercised persistence through `?e2eQuickDesign=1`, whatever the database
  said. The harness opens a real project row instead.
- **Two bundling facts, both of which fail the server at boot rather than at the call site.**
  `if (process.env.NEXT_RUNTIME !== 'nodejs') return;` does **not** fold at build time — only the
  positive `=== 'nodejs'` form does — so the edge bundle followed the import and failed on
  `node:fs`. And PGlite must be in `serverExternalPackages`: webpack bundling it breaks its WASM
  loader, and the instrumentation hook then takes the whole server down with
  *"The 'path' argument must be of type string … Received an instance of URL"*.

### And the harness had to satisfy the security guard, not be excused from it

The first version documented a literal connection string carrying an inline password for a user
named `local`, and `tests/security/secret-guard.test.ts` failed the tracked tree for it:

> *Connection string embeds a password for user … @ pglite.invalid. Load it from the environment
> instead.*

The password was invented and the host cannot resolve, so it would have been easy to add an
exception. **The guard was still right:** a connection string with an embedded password in a
tracked file is the shape it exists to catch, and a guard with a carve-out for "but this one is
fine" catches nothing later. (It caught this write-up too, when the offending string was quoted
back into the ledger to explain the episode — which is the guard behaving correctly twice.) The harness now needs no password at all — it sets `DATABASE_URL`
itself, to a user-only URL on a host in the reserved `.invalid` TLD, so nobody has to supply one
and there is nothing to exempt.

🚨 **The `.invalid` host is load-bearing.** If the interception ever fails, the query fails loudly
instead of quietly reaching something real.

### The tests

`e2e/persistence-join.spec.ts` — skipped, loudly, when the harness is not armed:

1. the database is reachable and the project row is real (guards the guard — everything else is
   vacuous against a 503);
2. **a design survives a reload**, asserted **by panel id**, not by count;
3. the restored badge reports the same number as the array it describes (WS1-005, against a real
   restore rather than a seeded array);
4. **the Melvin sequence through the database** — A → B → A, with the archive proven to be in the
   persisted layout row, not merely in memory. That is the exact shape of the production failure,
   and `layouts.site_archives` from migration 123 is what carries it.

---

## 🚨 WS1-029 — FAILURE A WAS STILL LIVE. A RELOAD ARCHIVED THE DESIGN AND EMPTIED THE SCREEN.

| | |
|---|---|
| **Severity** | **P0** — Ray's original report, on every page load, with no user action |
| **Status** | `FIXED_PENDING_VERIFICATION` — fixed, mutation-proven, and verified in a real browser against real PostgreSQL |

I closed Failure A earlier in this workstream. It was not closed. The first time
anyone actually pressed F5 in a browser attached to a database — which is the thing this ledger
had recorded as owner-blocked — the design vanished:

```
before reload   activeSiteKey …@38.66570,-90.22660   panels 55   archived 0
after  reload   activeSiteKey …@38.64062,-90.22621   panels  0   archived 1 (56 entities)
```

Nobody touched the project. Nobody picked a house. **The panels never came back**, which is Ray's
sentence, reproduced on demand.

### Why the earlier fix was not enough

WS1-002 found that identity is re-derived on mount from a coordinate other than the one that minted
it, and repaired the comparison from exact-string equality to `sitesAreSameProperty` — a proximity
match within `SITE_MATCH_RADIUS_M = 8 m`. That removed the *string* sensitivity and left the
*mechanism* in place, and the mechanism is the defect:

```ts
const siteKeyNow = siteKeyFromCoords(mapCenterRef.current?.lat, mapCenterRef.current?.lng, project.id);
```

`mapCenter` is **the camera position**. The mount effect points it with a fresh geocode of the
address — *"street-level geocode always wins over stored coords"*, which is deliberate and stated.
A camera position is not a property identity, and a geocoder's answer is not the point the user
clicked.

🚨 **And widening the tolerance can never fix it.** This codebase's own comment records that
*"3 Melvin Dr geocodes ~17m onto the next house"* — 17 m against an 8 m radius. The measured case
above drifted **2.8 km**. Any radius wide enough to absorb a bad geocode also swallows the
neighbour's roof, which is precisely what the radius exists to keep out. **The tolerance is not the
lever.**

### What made it destructive rather than cosmetic

Falling through reached `stored-active-archived`, which activates an **empty** bundle and sets
`needsAdoptionSave` — forcing a save of `panels: []`. The `LAYOUT_SUBSYSTEM_WIPE` guard relaxes
*precisely when the incoming key differs from the stored one*, so that write is permitted. **The
design was destroyed by the mechanism built to protect it.**

### The fix — a page load is not a property change

`hydrate` now answers in three steps, and only one of them consults the camera:

| Row says | Decision |
|---|---|
| no `activeSiteKey` (legacy / pre-geocode) | adopt the derived key — an absent claim is not a claim about somewhere else |
| the derived key matches an **archived** property | reactivate it — a *positive* match is information: the camera is demonstrably at a property this row holds |
| anything else | **keep what the row says is active** |

The distinction that matters is between a **positive match** and a **mere mismatch**. Reactivating
on a positive match is intentional and is retained. Archiving on a mismatch was the bug: a key 17 m
away is either the neighbour's house or a geocode of your own, and a restore has no way to tell.
With the discrimination impossible, the non-destructive answer is the only defensible one.

Changing property is `switchSite`, reached through Pick House, and it still decides by proximity —
from a point the user actually clicked. That path is untouched.

### Three of my own tests were asserting the defect

`tests/restoreIdentityDrift.test.ts` and `tests/siteDesignModel.test.ts` — both written by me
earlier in this workstream — asserted `stored-active-archived` on hydrate for a "genuinely
different" key. One of them was even **named for picking a house and called `hydrate`**:

```
it('picking the neighbour archives this design rather than keeping it active', () => {
  const r = hydrate(storedOf(s), KEY_NEIGHBOUR);      // picking is switchSite
```

That conflation *is* the defect, written down and pinned. The tests now assert the behaviour they
were named for — `switchSite` archives, `hydrate` does not — and the measured browser numbers are a
test of their own.

🚨 **Changing a test because it failed is the exact failure mode to avoid, so the justification is
recorded rather than assumed:** there is a reproduction, in a browser, against a real database,
where the old assertion's behaviour destroyed a design with no user action; and the discrimination
it relied on is not available at that point in the code.

**Mutation-proven.** Restoring the archive-on-mismatch branch fails 7 tests, including
*"expected [] to deeply equal [ 'melvin-0', 'melvin-1', …(50) ]"* — the design vanishing, as a
number. And in the browser, before the fix: 55 → 0 panels; after: 55 → 55, same key, nothing
archived.

---

## WS1-030 — A refusal was still reported as a transient database error, on three routes and one code

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

WS1-017 closed "a deliberate refusal is reported as a transient DB error" by naming
`LAYOUT_SUBSYSTEM_WIPE` and `LAYOUT_ARCHIVE_UNSTORABLE` in the layout route's catch block. **That
fixed the two instances I had found and left the class open.** `upsertLayout` throws a *third*
refusal, and four routes call it:

| Route | codes handled |
|---|---|
| `app/api/projects/[id]/layout` | 2 of 3 — `LAYOUT_COORDS_MISMATCH` fell through to **503 DB_STARTING** |
| `app/api/production` | none |
| `app/api/engineering/preliminary` | none |
| `app/api/admin/system-tools` | none |

It surfaced in a browser, not in a test:

```
[DB_TRANSIENT_ERROR] route=[POST /api/pr LAYOUT_COORDS_MISMATCH:
design geometry is 16.3 km from the project address
```

A permanent refusal, logged as transient, on a save the user would retry forever.

**Fix.** The codes and the predicate now live in `lib/db/core.ts` beside `handleRouteDbError`, and
that handler — which every route already delegates to — returns **409 + `refused: true` + the
guard's own sentence**. A new route cannot forget it, and the layout route's local copy is deleted.
Mutation-proven: removing the code from the list fails with *"expected 503 to be 409"*.

---

## WS1-031 — The migration directory cannot build a working database

| | |
|---|---|
| **Severity** | **P1** — provisioning / disaster recovery, outside the design path |
| **Status** | `OPEN` — recorded, not fixed; it is not this workstream's system |

Building a database from `lib/migrations/*.sql` produces a schema the application cannot run on.
`updateProject` writes `projects.no_itc`; **no `.sql` migration creates it**, so a plain project
save answers

```
column "no_itc" of relation "projects" does not exist   →   503 "Service temporarily unavailable"
```

Same for `projects.engineering_config`, which three migrations *reference* and none creates.

The rest of the schema lives as inline `sql` templates inside **`app/api/migrate/route.ts`**
("Migration 013: projects.no_itc") — a second migration system, applied by an API route rather than
the runner. 371 static DDL statements are in that file.

Also measured: of 120 `.sql` migrations, **32 do not apply to a clean database** (proposals, crews,
leads, site-survey jobs — each failing on a dependency an earlier failure never created), and 001
itself fails without the `pgcrypto` extension, cascading to 74 failures and no `layouts` table at
all.

**Consequence:** nobody can stand up a new environment from the repository, and a disaster recovery
would not produce a working database. Recorded here with evidence; fixing it is a migration-system
workstream, not a design-state one.

---

## 🚨 WS1-032 — I INTRODUCED A FLIP-FLOP WHILE FIXING WS1-029

| | |
|---|---|
| **Severity** | **P0** — a live design replaced by a stale archive, forced to disk, on every reload |
| **Status** | `FIXED_PENDING_VERIFICATION` |
| **Found by** | an adversarial audit of my own commit, not by the suite |

Fixing WS1-029 also **reordered** `hydrate`'s branches, putting the archive lookup ahead of the
stored-active check. When the camera key is within `SITE_MATCH_RADIUS_M` of **both** the stored
active key and an archived key — one building whose row holds two identities a few metres apart —
the archive wins. Executed against the real module:

```
same property?  active/now true   arch/now true
RELOAD 1 -> reactivated-archive | panels 3  (was 55) | needsAdoptionSave true
RELOAD 2 -> reactivated-archive | panels 55          | needsAdoptionSave true
```

A 55-panel live design replaced on screen by a 3-panel archive with no user action, **forced to
disk** (`needsAdoptionSave`), and swapped back on the next load: a permanent alternation, one write
each time. The subsystem-wipe guard does not stop it — `switchingProperty` is true precisely because
the key changed.

🚨 **The precondition is not exotic.** `changeSite`'s own comment records Ray's live row having
*"three identities for one building inside 43 seconds, ~17 m and ~19 m apart"*. And the
`adopted-legacy` branch manufactures exactly this row shape — it adopts `siteKeyNow` as the active
key while leaving `parsed.sites` untouched, with no check that an archive sits inside the radius —
then force-saves it.

**Fix.** The stored-active check goes back in front of the archive lookup. A camera that matches the
row's *own* active key is not evidence of a property change, so there is nothing to reactivate and
nothing to archive. The WS1-029 repair is untouched: what changed there was the **fall-through**,
which no longer archives on a mere mismatch.

**Why no test caught it.** Every fixture pair in the suite is kilometres apart, so
`tests/autosaveAdversarial.test.ts`'s *"an archived site cannot reappear as the active one"* — the
exact invariant this violates — passed **vacuously** for the ambiguous case. The new test asserts
the fixture really is ambiguous before asserting anything else.

Mutation-proven: restoring the bad order fails with *"expected 'reactivated-archive' to be
'matched'"* and *"expected true to be false"* on the forced save.

---

## 🚨 WS1-033 — A PANEL WITH NO ELEVATION WAS DRAWN AT SEA LEVEL

| | |
|---|---|
| **Severity** | **P1** — user-visible, and it is the shape of Ray's report |
| **Status** | `FIXED_PENDING_VERIFICATION` |

Ray: *"the panels are not all rendering above the roof when I do an auto layout to fill the roof."*

**"Not ALL" is the whole clue.** A defect that affects every panel is a datum error; a defect that
affects *some* is a per-panel property. This is one:

```ts
lib/3d/controlLayer.ts   if (!isFinite(p.height ?? 0)) reject      // undefined ?? 0 -> 0 -> finite -> KEPT
SolarEngine3D            const h = panel.height ?? 0               // then drawn at h = 0
```

`undefined ?? 0` is `0`, and `isFinite(0)` is **true** — so the guard written to catch bad
elevations waved through the worst case, and `isValidCoord` accepts 0. Ellipsoidal zero is roughly a
hundred metres below any real roof. The panel count is right, nothing errors, and part of the array
is underground.

`PlacedPanel.height` is a required `number` in the type, which is why every guard around it was
written as defensive noise — but runtime data can lack it whatever the type says: `layouts.panels`
is JSONB, designs predate the column, and the 2D layout engine (`generateRoofLayoutOptimized`)
never writes an elevation at all.

**Fix.** One predicate, `hasUsableElevation`, used by the validator and the renderer. Absence and
`NaN` are rejected; a real elevation of `0` is still real, because **absence is the thing being
rejected, not the number**. The renderer now refuses to draw rather than drawing underground — a
missing panel is noticed and reported; a buried one looks like a rendering bug and gets chased in
the wrong place.

Same distinction as `COALESCE` in the layout writer and `planeHeightAtCenterMeters ?? 3.5`. Three
times in one workstream, `?? 0` has turned "we don't know" into "zero".

The test pins the old expression's behaviour directly: `oldGuard(undefined) === true`,
`oldGuard(null) === true`, `oldGuard(NaN) === false` — it caught only the case that never happens.

### 🚨 What this does NOT establish

**I have not proven this is what Ray is looking at.** Three things are true and should not be
blurred:

1. A defect of exactly that shape existed, and is fixed.
2. **Every Failure B fix in this workstream is on a branch and unmerged.** `origin/master` contains
   no `moduleStackHeightM`, no routing chokepoint, no Square Up repair. If Ray is using the deployed
   app, he is looking at the original defects, none of which have shipped.
3. The placement library itself is now correct on every fixture I can run — a hand-traced face, a
   gable, and three archived **real Google Solar payloads** (`tests/detectedPlaneElevation.test.ts`,
   13 tests). So whatever remains is not in the grid arithmetic.

### One thing I could not test, stated plainly

Panels sit a fixed height above a **fitted plane**. What Ray sees is the **photogrammetry mesh**,
which is not planar — it carries ridge caps, vents and ±10–20 cm of noise. A panel correctly placed
above the plane can still be swallowed where the mesh rises above it, and that is a per-location
property, so it would look like "some panels".

`SolarEngine3D.tsx:2010` claims *"clampToHeightMostDetailed handles height correction at render
time"*. **`clampToHeightMostDetailed` appears nowhere in the file except that sentence.** Nothing
samples the mesh under a panel. That is another comment describing a mechanism that does not exist,
like `roofDeckAlt` before it — and closing it needs Google 3D tiles, which needs an API key this
checkout does not have.

---

## WS1-034 — WS1-030 WAS A FALSE CLOSURE: THE SAVE BUTTON NEVER GOT THE FIX

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `FIXED_PENDING_VERIFICATION` |

WS1-030 moved refusal recognition into `handleRouteDbError` and claimed *"a new route cannot forget
it"*. **Two of the five routes never reach that handler for a refusal**, and one of them is the one
that matters most:

- **`app/api/production`** — its catch delegates only for a `DbConfigError` or six network
  substrings, then returns a bare **500** with no `code` and no `refused`.
  🚨 **The Design Studio's Save button posts here**, not to the layout route — the route's own
  comment says so. So the studio's refusal handling, which keys on `code`, never fired, and the user
  was told *"Production calculation failed"* for a save deliberately blocked to protect another
  property's design.
- **`app/api/engineering/preliminary`** — an inner `try/catch` logged a warning and answered
  **HTTP 200** with `'layout'` merely missing from `savedFiles`. The caller reads `success` only, so
  the user was told the design saved when the database had refused to write it. **Silence is worse
  than the 503 it replaced.**

And the enumeration was wrong: **five** routes call `upsertLayout`, not four.

**Fix.** Both routes consult `layoutRefusalCode` before their own classification. The preliminary
route reports `layoutRefusal` in its response body rather than swallowing it — transient failures
stay warnings, a refusal is stated.

**Why the suite said nothing.** `handleRouteDbError` is `vi.mock`ed to a flat 500 in six test files.
A mocked chokepoint cannot demonstrate that a route reaches it.

### 🚨 And my first attempt at the guard was itself vacuous

I wrote a structural test asserting every `upsertLayout` caller handles refusals, accepting "the
catch delegates unconditionally to `handleRouteDbError`" as evidence. **`/api/production` has
several catch blocks**, one of which matched that shape while the one wrapping `upsertLayout` did
not — so deleting the fix left the test **green**. The mutation step caught it; nothing else would
have.

A regex over source cannot tell which catch will see a throw. The test now claims only what a scan
can honestly check — that the code list is complete, that prefixes match only the real codes, and
that the routes catching `upsertLayout` themselves consult the authority — and the behavioural proof
stays where it belongs, in `tests/siteDesignRoute.postgres.test.ts` against real PostgreSQL.

---

## WS1-035 — A SIXTH ANSWER, WITH A PASSING TEST CALLING IT CANONICAL

| | |
|---|---|
| **Severity** | P2 — read by nothing at runtime |
| **Status** | `FIXED_PENDING_VERIFICATION` |

`lib/3d/controlLayer.ts` exported `CANONICAL_PANEL_OFFSET_M = 0.05` — a sixth answer to the question
`lib/roofMountDatum.ts` now owns, **exported from the very file that threads `mountingSystemId`
through to the placement engines**, and pinned green by

```ts
it('CANONICAL_PANEL_OFFSET_M is 0.05m above the plane surface', () => {
  expect(CANONICAL_PANEL_OFFSET_M).toBe(0.05);
```

Its comment claimed *"the control layer post-processes height when needed"*. It does no such
post-processing. Nothing read the constant at runtime — only the test did — so it changed no number.
It was a wrong answer sitting in the open, under the most inviting name in the file, with a test
asserting it was canonical.

WS1-013's re-audit searched for the *arithmetic* and found `CesiumViewer` and
`placePanelsMultiPlane`; it walked straight past a constant whose name contains the word CANONICAL.
Deleted, and the test now asserts the export is **gone**.

---

## WS1-036 — THE PLANE KNEW ITS OWN FRAME AND WE GUESSED ANYWAY

| | |
|---|---|
| **Severity** | P1 — silently bakes a 9 cm error into a saved plane |
| **Status** | `FIXED_PENDING_VERIFICATION` |

`collectRoofRenderables` rebuilt a restored plane's frame from a panel sitting on it, justified by
*"the only surviving record of the plane's frame is a panel"*. **That premise is false.** Round-
tripping a plane through `upsertLayout` and `getLayoutByProject` against real PostgreSQL returns
`origin3D`, `ecefFrame3D`, `polygon3D` and `createdFrom3D` **intact** — measured, not assumed.

And the guess is not sound. Recovering a deck from a module means subtracting a mount stack;
`PlacedPanel` records no mounting system, so it had to assume the **currently selected** racking.
For a design saved before the mount datum existed — panels at the old `+0.05` — that recovers an
origin **9 cm below** the true plane, and `squareUpTracedFaces` then **persists** it. Same error if
the racking selector changed since placement.

The plane's own frame is now preferred; the panel-derived path remains only for a plane that carries
none.

---

## WS1-037 — Documentation that describes code which no longer exists

| | |
|---|---|
| **Severity** | P2 — but it is how the next person gets it wrong |
| **Status** | `FIXED_PENDING_VERIFICATION` |

Three comments in this workstream described mechanisms that were not there, and each one cost real
time:

| Comment | Reality |
|---|---|
| `panel.height = roofDeckAlt + stackH` | `roofDeckAlt` is a variable that exists **nowhere** — only in that sentence (WS1-013) |
| *"the control layer post-processes height when needed"* | it does no such post-processing (WS1-035) |
| *"clampToHeightMostDetailed handles height correction at render time"* | that identifier appears **nowhere in the file except that sentence** (WS1-033, still open) |

So after changing the datum, the comments that named the deleted constants were swept too:
`hydrate`'s own contract still listed the two cases WS1-029 removed and did not mention the case it
added; six comments across `lib/roofPlane3D.ts` and `components/3d/SolarEngine3D.tsx` still gave
`PANEL_OFFSET_ECEF (0.05m)` as the placement formula. Both corrected, and `LAYOUT_REFUSAL_CODES` is
re-exported from `lib/db-neon.ts` — the entry point `lib/db/projects.ts` tells callers to use — so a
route does not have to reach past the sanctioned import to find the refusal authority.

🚨 **A stale comment is worse than no comment**, because it is evidence. Each of the three above was
read as a statement of fact and believed; two of them were repeated into this ledger before being
checked.

---
---

## 🚨 WS1-038 — THERE WAS NO ROOF UNDER THE ARRAY

| | |
|---|---|
| **Severity** | **P0** — user-visible, and it is the mechanism behind Ray's report |
| **Status** | `FIXED_VERIFIED` (browser-measured, mutation-proven) |
| **Found by** | reading the live Cesium entity collection, which no test had ever done |

Ray: *"the panels are not all rendering above the roof when I do an auto layout to fill the roof."*

WS1-033 found a defect of that shape and fixed it. It was not the whole answer. The first run of a
new browser gate that reads the **scene** rather than the app's own state reported:

```
55  [PANEL]
 1  [PLANE3D-OUTLINE]
 0  [PLANE3D-BASE]
```

`renderPlane3DEntity` has two branches. The `outlineOnly` branch draws a polyline and returns. The
branch it skips draws the thing the entire mount datum exists to put a module above — an opaque base
coat whose own comment states its job:

> *"Dark base coat — suppresses wavy mesh waviness beneath panels."*

**A face carrying fifty-five panels was drawn as a bare outline.** With no deck, what is under the
array is Google's photogrammetry mesh, which is not planar: ridge caps, vents, ±10–30 cm of noise. A
panel placed a fixed height above a **fitted plane** is swallowed wherever the mesh rises above it —
and that is a per-location property, so *some* panels look wrong and others do not.

### Why every face Auto Layout fills was affected, and freshly traced ones were not

The decision was made once and latched:

```ts
const planeHasPanels = panelsRef.current.some(p => p.planeId === plane.id);
const isMarkOnly = !planeHasPanels;
if (isMarkOnly) markOnlyPlaneIdsRef.current.add(plane.id);   // nothing ever removes
```

The plane-restore effect runs **before** Auto Layout has placed anything, so every face that arrives
from state — a reload, a restored design, and **every face Lane A detects from Google Solar** — was
recorded as "no panels" permanently. Filling it with fifty-five panels did not change the answer. A
face traced in the same session takes the other code path and gets its deck.

**Traced faces right, detected and reloaded faces wrong, on the same roof, in the same session.**
That is "not ALL", mechanically.

### The fix

*Mark Plane* is an **intent** — the user traced a face and asked for no panels on it — and stays
latched, with exactly one writer. *Having no panels* is a **state** and is now read fresh every time
a face is drawn (`planeRendersOutlineOnly`). And the plane redraw keys on which faces carry panels,
so a face gains its deck the moment Auto Layout fills it; reading fresh is useless if nothing
re-renders.

### The gate that found it, and why nothing before it could have

`e2e/panel-above-deck.spec.ts`. Every elevation assertion written before it — three vitest files and
one browser spec — computes `(panelECEF − plane.origin3D) · plane.normal` and compares it to
`moduleStackHeightM`. **That is the placement library checking its own arithmetic.** None of them can
see either of the two things a person actually looks at:

```
the BOX Cesium draws for a panel        addPanelEntity
the POLYGON Cesium draws for the deck   renderPlane3DEntity
```

Different functions, different inputs, living in a 12,000-line React component that no unit test
reaches. The new spec takes the drawn deck's own corners, fits a plane to them with Newell's method,
and measures each drawn panel box against it — **0.14 m, every panel, on a single face, on a gable,
and across a reload**, which is `moduleStackHeightM('ironridge-xr100')` exactly.

`window.__solarViewerE2E` exposes the raw viewer and nothing else, under the same build-time flag as
the studio's hook. Handing out a ready-made clearance number would have put the measurement back
inside the component under test.

**Mutation-proven.** Re-introducing the latch as a single line and rebuilding makes all three fail
with *"the scene never drew a roof deck polygon"*.

### 🚨 AND MY OWN FIX LEFT THE HOLE OPEN — FOUND BY RE-AUDITING IT AN HOUR LATER

The first version of this fix kept `markOnlyPlaneIdsRef` as *"the user's intent"* beside the derived
*"does this face carry panels"*, on the reasoning that Mark Plane is a decision and should stay
latched. That reasoning is fine and the code was still wrong, because **`handleAutoRoof` does not
skip marked faces.** `eligiblePlanes` is built from confirmed planes and detected segments with no
reference to the mark, so Auto Layout fills a marked face — and the latched intent would then have
drawn it as a bare outline with fifty-five panels over it. The whole defect, reachable again,
through the feature I had just protected.

The two facts never disagree except in that case: a marked face has no panels, so the derived rule
already answers "outline". The moment it *does* have panels it needs a deck under them, whatever was
intended when it was traced. So the set is **deleted**, and one question has one answer.

Whether Auto Layout ought to respect a Mark Plane intent is a separate product question about
PLACEMENT. The renderer does not decide it, and I have not decided it either.

### And `origin/master` has a second, independent disagreement

Verified against `origin/master`, not inferred. The restore path there re-fits an **already lifted**
`polygon3D` through `computePlaneFromPoints3D`, which applies `SURFACE_OFFSET_M` again:

```
deck drawn at   fitted + 0.24 m     (0.12 lift, applied twice)
panels sit at   fitted + 0.17 m     (origin3D + PANEL_OFFSET_ECEF 0.05)
```

Every panel on a restored or auto-detected face renders **7 cm below** the deck it sits on, while a
face traced in the same session renders 5 cm above it. Fixed earlier on this branch; the new spec is
what keeps it fixed.

---

## 🚨 WS1-039 — ONE MISSING FIELD DISCARDED THREE GOOD ONES, AND PUT THE ARRAY ON THE GROUND

| | |
|---|---|
| **Severity** | **P1** — 34 m of error, silently; no producer of the input shape found in current code |
| **Status** | `FIXED_VERIFIED` |

`buildSurfaceGrid` resolved a plane's geometry with one all-or-nothing test: `createdFrom3D &&
origin3D && ecefFrame3D && polygon3D.length >= 3`, else fall wholesale to
`computeEcefFrameForLegacyPlane`. That fallback rebuilds the frame from
`planeHeightAtCenterMeters ?? LEGACY_PLANE_HEIGHT_M` — and `buildRoofPlane3D` writes **0.0** there
deliberately, as a *"don't read me, read origin3D"* sentinel, which `??` keeps.

Measured on the demo roof, ground 128 m, eave 160 m:

```
WITH polygon3D      55 panels at 163.79 m
WITHOUT polygon3D   55 panels at 129.58 m      <- 34.22 m below the roof
```

Correct panel count, no error, whole array underground. The fourth appearance of
absence-becomes-a-number in this workstream.

🚨 **And the file disagreed with itself.** `placeSinglePanel`, `extendRow` and `addRow` ask only for
`ecefFrame3D && origin3D`. The same face therefore got panels on the roof from one tool and
underground from another — two answers to *"does this face have a usable 3D frame?"* inside one file,
which is the condition `lib/roofMountDatum.ts` exists to end for the mount stack.

**Fix.** The frame and the outline are separate facts and are resolved separately: the plane's own
frame is used whenever it has one, and only the polygon is synthesised, by dropping each plan-view
vertex **vertically** onto the plane. (Projecting along the normal instead moves the point
horizontally by `distance·sin²(tilt)` — 0.8 m at 25° — which shrinks the outline and silently costs
a row of panels. Measured: 44 panels instead of 55, before that was corrected.)

**Honestly stated:** I could not find a path in the current code that produces a 3D plane without a
`polygon3D`. The restore path has an explicit branch for it commented *"pre-stitch or older save"*,
and `buildSurfaceGrid` had the fallback, so the shape was believed to exist; the round trip through
real PostgreSQL preserves all four fields. This is fixed as an inconsistent authority with a proven
34 m failure mode, not as a defect I can currently trigger end to end.

---

## 🚨 WS1-040 — THE HYBRID FILL DROPPED THE MOUNTING SYSTEM

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `FIXED_VERIFIED` |
| **Found by** | an independent worker, verified by reading the code myself |

`buildSurfaceGrid`'s mixed / portrait-first / landscape-first branch recurses through a
`commonOpts` object that did not carry `mountingSystemId`:

```ts
const commonOpts = { plane, groundElevM, …, layoutId, wattage,
                     customOriginLat, customOriginLng, customDirX, customDirY };
const primaryPanels   = buildSurfaceGrid({ ...commonOpts, orientation: primaryOri });
const secondaryPanels = buildSurfaceGrid({ ...commonOpts, orientation: secondaryOri });
```

So both fills resolved `moduleStackHeightM(undefined)` → `DEFAULT_MODULE_STACK_M` = 0.12 m. A face
set to *hybrid* orientation got 0.12 m while its portrait neighbours got their racking's real stack
— **two module heights on one roof, reintroduced inside the file that threads the id through** — and
the per-plane orientation override is not collapsed to `portrait` the way the global one is, so the
path is live. TypeScript could not catch it: the field is optional.

No elevation test passes `layoutStrategy`, so the recursive branch was never entered by anything
that asserts a clearance.

---

## 🚨 WS1-041 — THE DRAWN RAIL WENT THROUGH THE DECK FOR FOUR SYSTEMS, AND MY TEST CHECKED THREE IDS

| | |
|---|---|
| **Severity** | **P2** — visual only; no exported number reads the draw scale |
| **Status** | `FIXED_VERIFIED` |

The earlier fix hung the rail from the module underside, which is the right datum, and left
`RAIL_DRAW_SCALE = 3` — a rendering constant multiplying a real manufacturer dimension — with
nothing checking the product against the space it hangs in. Measured across all 45 catalogue
systems:

```
s5-pvkit           stack 0.088   drawn 0.1143   -26 mm
dpw-powerrail      stack 0.159   drawn 0.1714   -12 mm
renusol-vs-plus    stack 0.170   drawn 0.2042   -34 mm
mse-rapid-rail     stack 0.170   drawn 0.2042   -34 mm
k2-crossrail       stack 0.153   drawn 0.1524   +0.4 mm    (z-fighting, not clearance)
schletter-classic  stack 0.153   drawn 0.1524   +0.4 mm
```

🚨 **And the test that claimed to exclude this checked three hardcoded ids** — `ironridge-xr100`,
`ironridge-xr1000`, `unirac-solarmount`, the three that happen to fit — and called the class closed.
A rule that must hold for every product has to be checked against every product; three chosen
examples is the same vacuum as a fixture that cannot exhibit the condition.

The exaggeration is now clamped to the space available, so IronRidge, Unirac and SnapNRack are
unchanged and the six above are bounded. The test iterates the catalogue and is mutation-proven:
removing the clamp from its model surfaces all six.

---

## 🚨 WS1-042 — THE CHOKEPOINT HAD TWO CALLERS THAT NEVER REACHED IT (AGAIN)

| | |
|---|---|
| **Severity** | **P1** — and the second half is a regression my own guard introduced |
| **Status** | `FIXED_VERIFIED` |

`routeLayoutTo3D` was introduced as *"the one place that decides this layout cannot run in the 2D
engine"*. The claim was checked against the four sites that already had the rule pasted in, not
against the callers. **`confirmPendingPlane`** (confirm a traced plane) and **`autoPlacePanels`**
(auto-place on a drawn zone) called `generateRoofLayoutOptimized` directly.

The 2D engine emits panels with **no elevation**. Before `hasUsableElevation` they were drawn on the
ellipsoid, ~100 m under the building. After it they are refused by the renderer and **not drawn at
all, while still counting towards system size** — so my own fix converted a buried array into an
invisible one at two entry points I had not found.

This is the same shape as WS1-034 (`handleRouteDbError`, *"a new route cannot forget it"*, two of
five routes never reached it). **Twice now I have built a chokepoint and not proven every caller
reaches it.** `tests/layoutEngineRoutingIsComplete.test.ts` now discovers the callers from source,
resolves the enclosing function of each call, and requires the guard ahead of it — mutation-proven by
deleting one guard.

---

## 🚨 WS1-043 — THE VERSION SNAPSHOT DROPPED THE PANEL ELEVATION

| | |
|---|---|
| **Severity** | **P1** — a regression my own gate turned from wrong into invisible |
| **Status** | `FIXED_VERIFIED` |

`app/api/projects/[id]/layout` trims per-panel fields before storing a version snapshot, on the
stated premise that everything omitted is *"re-computed at render time"*. That is true of the ECEF
vectors and the pixel coordinates. It is **false of `height`**: nothing downstream derives it.

So restoring a version produced an array with no elevations — drawn at sea level before
`hasUsableElevation`, and **not drawn at all** after it. Either way the snapshot was never a
restorable record of the design. `height`, `heading` and `pitch` are kept now.

---

## 🚨 WS1-044 — THE ENGINE FABRICATED A ZERO ELEVATION, DEFEATING THE GUARD ADDED FOR IT

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `FIXED_VERIFIED` |

Three emit sites in `lib/surfaceGeometry3D.ts` stamped

```ts
height: isFinite(panelH) ? panelH : 0
```

`hasUsableElevation` deliberately **accepts a real 0** — absence is the thing being rejected, not the
number — so it cannot tell a fabricated zero from a measured one. A degenerate frame (a NaN anywhere
in u/v/n or the origin) therefore produced panels at ellipsoidal zero that passed every guard
written for exactly that symptom.

A panel whose elevation did not compute is not a panel at sea level. All three sites now refuse to
emit it, and the caller sees a shortfall. The same substitution is removed from the rail paths and
from `collectRoofRenderables`, where `rp.height ?? 0` would have put a **persisted** plane origin on
the WGS-84 ellipsoid — Square Up writes that origin back.

---

## 🚨 WS1-045 — A REQUEST BODY COULD CHOOSE WHOSE LAYOUT ROW IT WROTE

| | |
|---|---|
| **Severity** | **P0** — cross-project / cross-user write |
| **Status** | `FIXED_VERIFIED` |

```ts
upsertLayout({ projectId, userId: user.id, ...rawLayout })
```

`rawLayout` is `body.layout` verbatim on the legacy path, and **the spread is last**. A request
carrying `layout.projectId` or `layout.userId` replaced both, so the row written was not the row
`getProjectById(projectId, user.id)` had authorised a moment earlier. The ownership check ran,
passed, and was then overwritten by the thing it was checking. `upsertLayout` is not an
authorisation boundary and does not claim to be — it writes `WHERE project_id = … AND user_id = …`
with whatever it is handed.

The authenticated identity now goes last. `tests/layoutWriteIdentity.test.ts` discovers every
`upsertLayout({…})` argument literal under `app/api`, balances the braces so a nested object cannot
hide a key, and requires `projectId`/`userId` to appear after any spread. Mutation-proven.

---

## 🚨 WS1-046 — A PRODUCTION CALCULATION OVERWROTE PARAMETERS IT WAS TOLD NOTHING ABOUT

| | |
|---|---|
| **Severity** | **P1** |
| **Status** | `FIXED_VERIFIED` |

```ts
groundTilt:    rawLayout.groundTilt    ?? 20,
groundAzimuth: rawLayout.groundAzimuth ?? 180,
rowSpacing:    rawLayout.rowSpacing    ?? 1.5,
groundHeight:  rawLayout.groundHeight  ?? 0.6,
```

`upsertLayout` writes these four with `COALESCE(value ?? null, column)` **specifically so that
`undefined` keeps what is stored**. Fabricating a value at the call site turned *"this request says
nothing about row spacing"* into *"set row spacing to 1.5"*, overwriting a user's ground-array
parameters on every save that did not restate them. The INSERT path already supplies exactly these
defaults for a genuinely new row, so the call-site defaults were redundant where they were harmless
and destructive everywhere else.

---

## 🚨 WS1-047 — THE COORDINATE GUARD SKIPPED EXACTLY THE GEOMETRY THAT BELONGS NOWHERE

| | |
|---|---|
| **Severity** | **P0** |
| **Status** | `FIXED_VERIFIED` |

`assertLayoutCoordsMatchProject` exists to stop one project's geometry landing on another. It
computes a centroid with `_coordCentroid`, which drops any point with `|lat| <= 0.001`, and then:

```ts
if (!ctr || _isPhoenix(ctr.lat, ctr.lng)) return; // nothing to validate against
```

An array in which **every** panel is at (0, 0) yields `null`, and the guard returned without looking
at anything. `/api/engineering/preliminary` sends exactly that: `generateSyntheticPanels` emits
`lat: 0, lng: 0` for every panel, and `panels` is the one column in the UPDATE with **no COALESCE**.
So a preliminary calculation — reached from the bill-upload modal — replaced a real design with
unplaced scaffold panels. The sub-system wipe guard does not catch it either: the synthetic panels
are `systemType: 'roof'`, so `'roof'` is present in `incoming` and nothing looks wiped.

*"Nothing to validate against"* and *"nothing is anywhere"* are not the same sentence. Unplaced
geometry is now refused — as `LAYOUT_COORDS_UNPLACED`, through the existing refusal authority — but
**only when it would destroy placed geometry**, so a brand-new project, which is the route's actual
purpose, still works.

---

## 🚨 WS1-048 — THREE MORE OF MY OWN TESTS WERE VACUOUS

| | |
|---|---|
| **Severity** | test honesty |
| **Status** | `FIXED_VERIFIED` |

1. **`tests/detectedPlaneElevation.test.ts`** — *"the control layer drops it rather than passing it
   to the renderer"* drove `placePanelsControlled` in `surface_select` mode, which **re-places from
   the plane**, so the tampered panel never reached the validator; and `.every()` is true on an
   empty array either way. Deleting `hasUsableElevation` from the validator left it green. The
   validator is now exported — a validator nothing can call cannot be tested — and the test calls it
   with the exact input the defect requires. Mutation-proven.

2. **`e2e/panel-elevation.spec.ts`** — the measurement loop `continue`s over any plane with no 3D
   frame, and `worst.dev` starts at 0, so skipping every panel passed on the initial value. It now
   asserts that every panel was actually measured.

3. **`tests/autosaveAdversarial.test.ts`** — *"markOnly needs no persistence — it is DERIVED from the
   panels"*. The reasoning was exactly right. The assertion was
   `expect(ENGINE).toMatch(/const isMarkOnly = !planeHasPanels;/)` — **and the defect satisfied it**,
   because the latch sat two lines below the line it pinned. A test that asserts a token instead of
   the property it means. It now requires the derivation to read the current panels, the latch to
   have exactly one writer (the Mark Plane tool), and the redraw to key on which faces carry panels.
   Mutation-proven.

And two E2E `test.skip`s were removed: `isVisible()` — an instantaneous predicate whose options bag
is accepted and ignored, the trap this harness already documents for the Cesium canvas — meant the
Zones overlay was never toggled, so no setback bands rendered, so the test *skipped* rather than
reporting the rendering failure it was written for.

---

## WS1-049 — Two archives for one property, and no way to tell which is newer

| | |
|---|---|
| **Severity** | P2 — **no data is lost**; a stale design can surface instead of the current one |
| **Status** | `RECORDED, DELIBERATELY NOT GUESSED` |

`hydrate`'s adoption branches take `siteKeyNow` as the active key while leaving the archive map
untouched. If an archive already holds a key for the **same physical property** — within
`SITE_MATCH_RADIUS_M`, the shape Ray's live row has — the row ends up with two entries for one
building. Reproduced against the real module:

```
adopt         -> active 55 panels; archive holds a same-property key with 3
switch to B   -> archives: {kA2: 3 panels, kA: 55 panels}      two keys, one house
return to A   -> reactivated-archive, 55 panels                (nearest wins, correctly here)
```

Nothing is lost, and the selection is deterministic: `nearestSamePropertyKey` picks the
geometrically nearest. But a camera closer to the stale key surfaces the stale design, and the user
has no UI for archives to get the other one back.

🚨 **I did not guess a resolution, and this is why.** Reconciling two same-property bundles requires
knowing which is newer, and **an archive bundle carries no timestamp**. Keeping both leaves a decoy;
dropping either destroys work; merging duplicates entities. Every available rule is a heuristic
replacing a heuristic — the condition this workstream exists to remove. The correct fix is to give
each bundle a `savedAt` (the column is JSONB, so no migration) and make "newest wins" a fact rather
than a guess. That is a contained change and it is **not owner-blocked** — it is scoped out of this
pass deliberately, and named here rather than attempted late in a session that has already changed
this function twice.

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

**Added by the six-pipeline adversarial re-audit (24 independent workers, findings verified by me
before acceptance).** Outside Workstream 1's boundary, recorded so they are not rediscovered:

- 🚨 **P0 — `lib/pvwatts.ts` falls back to PHOENIX coordinates** when the client row has no geocode.
  Silently wrong kWh, savings and payback, persisted as if measured.
- 🚨 **P1 — a due-north array is excluded by an `a > 0` filter and re-reported as SOUTH-facing**,
  overstating production by roughly half.
- 🚨 **P0 — `lib/drafting/templates/roof.ts` decides railed vs rail-less by a name regex that matches
  ZERO catalogue products**, so PV-1 and PV-3 draw rails for every rail-less system.
- **P1 — a second racking BOM** with its own hardcoded rail span and attachment spacing is written
  into `projects.canonical_snapshot`, ignoring the mounting-hardware database.
- **P1 — `app/api/engineering/bom` turns an ABSENT attachment count and rail-section count into the
  literals 12 and 4**; the CSV export hardcodes `IronRidge XR100` regardless of the racking chosen.
- **P1 — the permit's fence embedment PASS/FAIL is computed from fabricated defaults** (absent
  embedment becomes 3.5 ft, absent soil resistance a constant).
- **P1 — a per-sub-system structural FAIL never reaches `overallStatus`**, so a hybrid design reports
  PASS while its ground array failed.
- **P2 — `upsertLayout` writes `map_zoom` with no COALESCE**, so a save that omits it nulls the
  column; `rowToLayout` substitutes `{lat: 0, lng: 0}` for an absent `map_center`, and the layout
  route writes that confident wrong answer back.
- **P2 — no UI signal tells the user which property the on-screen design belongs to.** The accepted
  trade of the WS1-029 fix, still accepted, still unaddressed.

---

## Definition of Done — Workstream 1

| Gate | State |
|---|---|
| Source of truth identified | ✅ panels, roof planes, site identity, panel elevation, **module mount datum** |
| All writers audited | ✅ 6 panel-set writers, 11 panel counts, 5 layout-row writers, **7 roof placement paths**, 3 reshape emitters, 5 `buildRoofPlane3D` callers, 3 `collectRoofRenderables` branches |
| All readers audited | ✅ incl. a re-audit of every `panel.height` reader outside the 3D engine |
| DB / migration verified | ✅ **migration 123 applied in production** (owner-confirmed 2026-09-20) |
| Positive tests pass | ✅ |
| Negative tests pass | ✅ |
| Mutation tests pass | ✅ see the table below |
| **E2E passes** | ✅ **23 passed, 0 skipped, 0 failed** against a production build, in four passes (see `e2e/README.md`) — including four against **real PostgreSQL** and three that measure the **Cesium entities themselves** |
| Full suite passes | ✅ **573 files, 12,248 tests, 0 failures** (490 skipped, pre-existing — almost all `*-postgres` and migration-governance files gated on a credential; see the note below) |
| tsc passes | ✅ exit 0 |
| Lint passes | ✅ 0 errors; the changed files add no new warnings |
| Build passes | ✅ `next build` exit 0, clean `.next` |
| CI passes | ⏳ pending push |
| Staging deploy verified | ❌ — not mine to do |
| **Browser verification of the real workflow** | ✅ **EXECUTED**, and then deepened — see WS1-027, and **WS1-038**, which measures what Cesium DREW rather than what the library computed, and found a P0 that every prior gate passed over |
| Between-face geometry invariants | ✅ `tests/ridgeContinuity.test.ts` |
| No known P0/P1 in workstream | ✅ every P0 and P1 closed, or named below with the reason it is open. **WS1-049 is open by decision, not by blockage** — it needs a timestamp on archive bundles, and guessing a reconciliation rule would destroy user work. |

### Mutation record — every fix proven able to fail

| Reverted | Failure |
|---|---|
| roof-plane library fix | 5.33 m (Set Origin), 4.11 m (Set Direction) against a 1 cm tolerance |
| Square Up mean-height rebuild | 30° → **0.188°**, azimuth destroyed |
| render lift into plan vertices | ridge splits **7.6 / 10.8 / 15.4 cm** at 4:12 / 6:12 / 10:12 |
| `ecefFrame3D` dropped from one emitter | fails naming the block |
| fence absence-keep | *"the fence was erased by a write that never mentioned it"* |
| autosave deps | *"an obstruction change scheduled no save at all: expected 0 to be greater than 0"* |
| `placeSinglePanel` → `0.05` | *"panel … sits 0.0489 m above the plane, expected 0.14"* |
| datum ignores `mountingSystemId` | *"expected 0.12 to be less than 0.12"* |
| XR100 stack below the drawn rail | *"expected 0.126492 to be less than 0.1"* |
| **`buildSurfaceGridECEF` → `0.05`, in a real browser** | *"panel … sits **0.0478 m** above its roof plane; … Negative means the panel is INSIDE the roof"* |
| **the mark-only latch restored, one line, rebuilt** | all three deck gates fail: *"the scene never drew 1 roof deck polygon — with nothing under the panels this spec cannot measure anything"* |
| `routeLayoutTo3D` deleted from one caller | *"autoPlacePanels (line 3764)"* — the discovery test names the caller, not a count |
| the rail clamp removed from the test's model | six systems surface, incl. *"s5-pvkit: stack 0.088 m, drawn rail 0.1143 m, bottom -0.0262 m"* |
| the validator back to `!isFinite(p.height ?? 0)` | *"the validator must drop exactly the tampered panel: expected 9 to be 8"* |
| identity moved back in front of the spread | *"a spread at 38 comes after projectId(10)/userId(21) — the body can replace the authenticated identity"* |
| the mark-only latch restored, in vitest | *"Mark Plane is the only thing that may latch this: expected [ …(2) ] to have a length of 1"* |

### What remains, and why

| Item | Why it is not closed |
|---|---|
| ~~The real client, against the real server, against real PostgreSQL, in a browser~~ | ✅ **CLOSED — and it was never owner-blocked.** `SOLARPRO_LOCAL_PG=1` runs PostgreSQL in WebAssembly inside the Next server; `e2e/persistence-join.spec.ts` drives the real studio through save → reload → restore and the Melvin A→B→A sequence against it. It found **WS1-029**, a P0 that was still live. |
| **2D-traced planes carry `planeHeightAtCenterMeters: 0.0`** | A plane-HEIGHT question, not a mount-datum one. `computeEcefFrameForLegacyPlane` falls back to `LEGACY_PLANE_HEIGHT_M` (3.5 m), which is a guess about the building, not about the racking. Deciding it needs a real roof height source — the same input Phase 3 will supply. |
| **Gable / Hip tools emit no roof plane** | **Owner-deferred.** Phase 3 roof UX; the instruction was explicitly *"do not start Phase 3 roof-generation algorithms yet"*. Viewport only. |
| **The mount effect re-geocodes and overwrites `projects.lat/lng`** | **Mitigated, not removed.** WS1-002 makes the system tolerant of the drift. The code states *"street-level geocode always wins over stored coords"* as intent; reversing a stated product intent is the owner's call, and nothing now breaks because of it. |
| **The photogrammetry MESH itself** | Still not measured. What IS now proven is that a paneled face draws its opaque deck — the surface whose stated job is to hide the mesh — and that every drawn panel clears it by `moduleStackHeightM`. The residual is narrow and real: the deck sits `SURFACE_OFFSET_M` = 0.12 m above the fitted plane, so where the mesh rises more than that (ridge caps, vents, chimneys) it still wins the depth test and pokes through. Closing it needs Google 3D tiles, which needs a Maps API key this checkout does not have. **`clampToHeightMostDetailed` still appears nowhere in the repo except the comment claiming it handles this.** |
| **WS1-049 — two archives for one property** | Open by decision. Needs a `savedAt` on each archive bundle so "newest wins" is a fact; every rule available without it is a guess that can destroy work. No data is lost today. |
| **490 skipped unit tests** | Almost all `*-postgres.test.ts` and migration-governance files gated on a real `DATABASE_URL`. That gate is now questionable: `SOLARPRO_LOCAL_PG` proves PostgreSQL can run in-process with no credential, and `tests/siteDesignRoute.postgres.test.ts` already does exactly that. Re-arming them is migration/test-infra work (WS1-031's neighbourhood), not this workstream. |
| **Staging deploy verification** | Requires a deploy. Not mine. |

### The matrix, completed

| | mocked server | real route + real PostgreSQL |
|---|---|---|
| **client in jsdom** | ✅ `tests/designStudioSiteSwitch.component.test.tsx` | — |
| **no client** | — | ✅ `tests/siteDesignRoute.postgres.test.ts` (PGlite, no credential) |
| **client in a real browser** | *(deliberately not written — it would re-prove the top-left cell)* | ✅ **`e2e/persistence-join.spec.ts`** |

🚨 **I argued myself out of the bottom-right cell once.** The previous revision of this document
reasoned that a browser adds nothing to a persistence path that uses no Cesium and no geometry, and
recorded the cell as owner-blocked on a credential I had *proven* could not be worked around. The
proof was one rejected candidate, not a proof. The cell was reachable, and filling it found
**WS1-029** — a P0 that emptied the screen on every reload, which every other cell had passed
straight over.

The lesson is not "write more tests". It is that **a coverage argument is not coverage**, and an
untested path is untested however convincing the reason.

### Standing corrections to this document

Four entries here were wrong when written, and all are corrected in place rather than quietly
edited, because a ledger that hides its own errors is worth less than no ledger:

1. **"The roof datum is not permit-grade."** Measured on a single isolated face, then generalised. A
   per-object invariant says nothing about relationships BETWEEN objects — each face translates
   along its own azimuth, so a gable's halves move apart. Closed by `tests/ridgeContinuity.test.ts`.
2. **"Visual/browser verification is owner-blocked on `DATABASE_URL`."** Inferred from a 503 on
   `/api/health` and never attempted. The whole Design Studio runs in Playwright with no database.
   See **WS1-025**.
3. **"The remaining candidate for Ray's report is the photogrammetry mesh, and closing it needs a
   Google Maps key."** Half right, and the half that was wrong mattered more. A paneled face was
   being drawn as a bare OUTLINE, so the opaque deck — the thing whose entire job is to stand
   between a module and the wavy mesh — was never drawn at all. That needed no key to find: it
   needed a test that read the entity collection instead of the app's own state. I had reasoned
   about the mesh for two rounds while the surface in front of it was missing. See **WS1-038**.
4. **"A rule that must hold at N call sites belongs at one"** — stated twice, and both times the
   claim that every caller REACHED the one place was asserted rather than measured. `WS1-034`
   (two of five routes) and `WS1-042` (two layout entry points). The rule is right; the missing
   half is that a chokepoint has to be proven reachable from each caller, by discovery, not by
   reading the sites that already looked correct.

Both are the same mistake: reasoning to a conclusion that a five-minute measurement would have
settled, and recording the conclusion as a finding.

**WORKSTREAM 1 COMPLETE: NO.**

Not because a gate is blocked — every gate is now executed — but because **this revision found a
P0 that the previous revision had attested as closed**, and one honest pass does not establish that
the next one will be clean. `WORKSTREAM COMPLETE: YES` is a claim about what is *not* there, and
this workstream has now twice discovered that the thing not there was only not looked at.

What changed since the last attestation, which claimed the remaining gate could not be reached
without a credential:

- The gate **was** reachable. PostgreSQL compiled to WebAssembly runs inside the Next server, the
  real route handlers answer against it, and a real browser drives the real studio. No credential.
- Filling that one cell immediately found **WS1-029**: a reload archived the design and emptied the
  screen, on every page load, with no user action. That is Ray's original report, still live, after
  I had recorded Failure A as closed.
- It also found **WS1-030** (a refusal still reported as a transient database error, on three routes
  and one code I had missed) and **WS1-031** (the migration directory cannot build a working
  database).
- Three of my own tests were asserting the WS1-029 behaviour. One was named for picking a house and
  called `hydrate`.

Every one of those was found by *executing the workflow*, not by reading it. The remaining risk is
not a named open item — it is that the same thing is true again somewhere I have not yet run.

| Gate | State |
|---|---|
| Defects closed in this workstream | **29**, incl. 7 P0 |
| Every fix mutation-proven | ✅ |
| Full suite | ✅ see the run record above |
| tsc / lint / build | ✅ / 0 errors / ✅ |
| **Browser + real PostgreSQL** | ✅ **19/19, 0 skipped** |
| Visual confirmation | ✅ (rails numerically only) |
| Known unverified affected paths | **none named** |
| Known P0/P1 open | **WS1-031**, recorded, and outside this behavioural system |

## Owner actions

Nothing here blocks the workstream. Both items are operational.

1. **Delete the pinned `NEXT_PUBLIC_BUILD_VERSION`** from the Vercel project so `/api/health` stops
   reporting a false version. Until then "did it ship?" has no trustworthy answer.
2. **Decide whether WS1-031 becomes a workstream.** The migration directory cannot provision a
   working database; the rest of the schema lives in an API route. That is a disaster-recovery
   exposure, not a design-state one, so it is recorded rather than fixed here.

> No database credential is required. The previous revision of this document asked for one; that
> request is withdrawn, and the reason it was wrong is written up under **WS1-028**.

> **Done:** migration 123 (`layouts.site_archives`) is applied in production, confirmed by the owner
> on 2026-09-20. WS1-003's fail-closed refusal therefore no longer fires in normal operation; it
> remains as the guard for any environment where the column is absent.


---

## Coordination

A peer Claude session (**"SolarPro Phase 2 recovery and verification"**) was working in this same
tree earlier and committed `6aa5ea0a` mid-session. Ray's ruling was that this session takes over; it
did, and the peer's two commits are carried forward intact as ancestors of the branch above.

One correction from that handover is worth keeping: the peer reported `resolveSiteKey` as "fixed and
merged". It is **absent from `origin/master`** entirely — the symptom fix lives only on the branch.
Verify a claim of "merged" against `origin/`, not against a local branch.

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
