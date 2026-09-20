# Phase 2 — site ownership closeout

2026-09-20. Written after Ray's first real acceptance test of Phase 2 failed on
the first click.

---

## 1. What happened, and what the database actually says

**The report.** 3 Melvin Drive was open with its panel layout. Ray picked the
house next door; the app re-flew and Melvin's panels disappeared. He picked
Melvin again; **the panels did not come back.**

**The forensics** (read-only queries against the live Neon instance —
`project 4030b664-bebe-433b-a11c-cda05ead2f7d`, layout `9d4d9ff5`):

| Question | Answer |
|---|---|
| Melvin panels persisted as cleared | **NO** |
| Original panel data recoverable | **Not required — never lost** |
| Panel count before | 52 (version 199, 14:14:24) |
| Current panel count | **52** |
| Recovery source | none needed; `project_versions` holds 201 versions and no version has 0 panels |

The layout row still holds 52 panels, 13 roof planes and a full version history.
Nothing was destroyed.

**It survived by accident.** The `LAYOUT_SUBSYSTEM_WIPE` guard in
`lib/db/projects.ts` — written in July for a different bug — refuses any single
save that makes an entire ≥4-panel sub-system vanish. Every `panels: []` write
the address change produced was rejected with a 500. That is luck, not
architecture:

* it only fires when the incoming array has **no** panels of that `systemType`.
  Place one panel at the new property and the guard passes — and the first
  property's 52 panels are overwritten for real;
* a design of fewer than 4 panels is exempt entirely.

**Timeline reconstructed from `project_versions`:**

```
v197  09-19 13:56   31 panels, 4 planes, no siteKeys        (pre-ownership)
v198  09-20 14:12   31 panels, 4 planes, siteKey stamped    (the one adoption save — as designed)
v199  09-20 14:14   52 panels, 13 planes, THREE site keys   (re-layout + the A→B→A test)
v201  09-20 14:18   52 panels, 13 planes                    (last save)
```

No zero-panel version exists at any point.

---

## 2. The defects

### D1 — only the roof was site-owned (the reported failure)

`lib/siteIdentity.ts` gave **roof planes** an owner and nothing else. Panels,
placed obstructions and measurements were cleared outright by
`handleLocationPick` (`setPanels([])`) and never restored, because the only code
that repopulates them is the mount-time DB restore — which does not re-run when
the address changes inside a live session.

A property change — navigation — behaved as a **delete** for every site-bound
entity except the roof.

### D2 — the archive leaked into every engineering consumer (permit-grade)

The roof-plane implementation kept archived planes by **merging them back into
`layouts.roof_planes`**. `rowToLayout()` hands that column, unfiltered, to:

* `lib/pvwatts.ts` — `roofPlanes[0].pitch` **is** the array tilt
* `lib/multiArrayEngine.ts`
* `/api/production`
* `lib/engineering/syncPipeline.ts`
* the permit CAD path

Melvin's row held **13 planes from three different properties**, and which one
sorted first decided the production model's tilt. A permit combining one
property's roof with another's jurisdiction is the exact defect
`lib/siteIdentity.ts` was written to prevent; it had moved, not gone.

### D3 — panning the map archived the design

The archive ran from a `useEffect` keyed on `[mapCenter.lat, mapCenter.lng]`.
`mapCenter` is also written by the 2D map's **pan** and **wheel-zoom** handlers,
on every pointer move, and the site key resolves to ~1.1 m. **One drag of the
map archived the whole design and activated an empty site**, then accumulated a
junk archive entry per gesture.

### D4 — `applyDesignElectrical` silently skipped every design entity

Found by the new route-level PostgreSQL test, not by inspection:

```js
if (!data.designElectrical) return saved;   // ← returned BEFORE applyDesignEntities
```

`applyDesignEntities` was a tail call of `applyDesignElectrical`, so that early
return skipped it. DesignStudio builds the electrical design as
`panels.length > 0 ? buildDesignElectrical() : undefined`, therefore:

* a design with **no panels yet** never stored its obstructions or measurements
  — trace a roof, place a vent, reload, the vent is gone. Migration 122 had
  shipped, the columns existed, the route accepted the field, the DB layer wrote
  it, and it still never ran;
* worse, the save that follows a **property change** sends `panels: []`, so the
  site archive would have been dropped on the floor **in exactly the case
  migration 123 exists for**.

Both returned HTTP 200. Nothing anywhere said a field had been discarded.

### D5 — the mirror refs lagged the state every save path reads

`panelsRef2`, `roofPlanesRef`, `placedObstructionsRef` and `measurementsRef`
were maintained by `useEffect(() => { ref.current = state }, [state])`, so they
trailed the state until React flushed effects. The autosave, the beacon and the
Save button all read them. A save landing in that window persisted the previous
value — during a property change, the previous **property**.

### D6 — the fence line was not site-bound

`fenceLine` is a list of lat/lng points. Carrying it to another property draws a
fence at the old address, reaching the same BOM and planset as a stale roof.

### D7 — the "your design was kept" message was inside a collapsed accordion

The one message that answers "where did my panels go?" sat inside the
`Roof Analysis` section, which is `defaultOpen={false}`. Correct behaviour still
read as data loss.

### D8 — `/api/production` is the THIRD writer and dropped three fields

The Save button lands there, not on the layout route. It never forwarded
`obstructions`, `measurements` or `siteArchives`; `undefined` reads as KEEP
STORED in `upsertLayout`, so the row silently kept its older value while the
user was told the design had saved.

---

## 3. The architecture now

`lib/design/siteDesignModel.ts` owns the whole site-bound design as **one
bundle** — panels, roof planes, obstructions, measurements, electrical, fence
geometry. Exactly one bundle is ACTIVE; every other property is ARCHIVED whole
under its own key. Changing property **moves bundles**; it never empties one.

`components/design/useSiteDesign.ts` is the React owner. It holds the four
entity arrays and their refs, so a write can only ever reach the active
property: **wrong-site data is unreachable by construction**, not by every
consumer remembering to filter.

Three rules that are load-bearing:

1. **Only the active property reaches the layout columns.** Archived properties
   live in `layouts.site_archives` (migration 123), a column nothing
   engineering-facing reads. `rowToLayout` additionally repairs an
   already-merged legacy row on read — it fires only when a row is genuinely
   ambiguous (more than one distinct `siteKey`), so a single-site row whose
   `map_center` drifted a metre keeps its whole roof.
2. **The switch is driven by intent, not by coordinates.** `changeSite` is
   called from Pick House, the address search and the address suggestion list,
   and nowhere else. Passive camera movement can no longer archive anything.
3. **The archive is bounded by properties DESIGNED at, not VISITED.** A bundle
   with no entities, no electrical design and no fence is pruned — `site_archives`
   rides on every autosave, so an entry per house toured would bloat every
   request for ever. An empty archive and an absent archive both come back empty,
   so a deliberate clear still round-trips cleared.

Deleted on purpose: `mergeForPersistence`, `stampSite`, `hasForeignSiteItems`.
Merging archived geometry into an active array **is** D2.

---

## 4. Verification

| Layer | File | Result |
|---|---|---|
| Model | `tests/siteDesignModel.test.ts` | 38 |
| Hook, through React | `tests/siteDesignIntegration.test.tsx` | 27 |
| DesignStudio, in jsdom | `tests/designStudioSiteSwitch.component.test.tsx` | 8 |
| Real route + real PostgreSQL (PGlite) | `tests/siteDesignRoute.postgres.test.ts` | 14 |
| Real browser (Playwright/Chromium) | `e2e/site-switch.spec.ts` | 6 |

Every round-trip assertion compares **entity IDs**. "52 panels came back" is
satisfied by 52 of the neighbour's panels.

Full gates: `tsc --noEmit` clean · `next lint` no errors · `next build` exit 0 ·
vitest **12,0xx passing, 0 failing** · Playwright 10 passed / 3 pre-existing
skips.

### Tests that were removed, and why

`tests/siteOwnership.test.ts` was **green throughout the failure Ray hit**. It
proved `lib/siteIdentity.ts`, a helper that only ever governed roof planes, and
its `describe('the full site-change state machine')` block contained a local
`changeSite()` that **reimplemented the transition inside the test**. A test
that rebuilds the feature proves the test, not the product. That block and the
blocks covering the three deleted helpers are gone;
`tests/helpers/siteRoundTrip.ts` now routes every "save and reload" assertion
through the real model.

The browser spec's first version let Google Solar acquire the roof, and **four
of its five tests skipped** on a machine with no `GOOGLE_MAPS_API_KEY`. A spec
that skips when the network is quiet proves nothing. It seeds a known design
through the studio's own setters instead; everything after that is the real
path.

---

## 5. Open items

### 5.0 The merge is safe in either order — but 123 should go first

Relaxing the subsystem-wipe guard to count archived panels is safe **exactly as
long as the archive reaches the database**. On a deployment where 123 has not
run, `applyDesignEntities` catches the missing column, warns, and drops the
archive — so a guard that had already counted those panels as present would have
let `panels: []` through and **deleted the layout it exists to protect**. The
guard would have disarmed itself.

`upsertLayout` therefore probes for `layouts.site_archives` and, when it is
absent, applies the original check unchanged: the property-change save is
**refused**, the studio shows its save-failed badge, and nothing is lost. Both
halves are pinned in `tests/siteDesignRoute.postgres.test.ts` — refused without
123, allowed with it.

So deploying before the migration cannot destroy data; it only means property
switching does not persist yet. Running 123 first avoids the refusals entirely.

### 5.1 🚨 Migration 123 has NOT been run in production

Verified against `schema_migrations`, not a UI message:

| Migration | Ledger status | Column/table present |
|---|---|---|
| 121 `app_feature_flags` | `applied` 2026-09-20 13:38:19, human operator, env `production` | yes |
| 122 `layouts.obstructions/measurements` | `applied` 2026-09-20 14:10:18 | yes |
| **123 `layouts.site_archives`** | **no row** | **no** |

Until it runs the code degrades safely — `upsertLayout` catches the missing
column and warns, and the studio takes the legacy path — but **the archive does
not survive a page reload**. A→B→A works within a session and is lost on
refresh. Run it from **Admin → System Tools → Migrations → "Run migration 123…
(other properties are kept, not deleted)"**.

### 5.2 The gable and hip tools emit no roof plane

Both draw real roof faces with a pitch and an eave height, and both stop at
Cesium entities plus a `vertexSpec`. `onRoofPlaneCreated` is called from exactly
one place (`finalizePlane3D`), so a gable a user places never reaches the Roof
Planes sidebar, the panel layout, the BOM or the planset, and is gone on
unmount.

It is **not** a Phase 2 correctness defect: with no outbound callback, nothing
downstream can read it, so no artifact can be wrong because of it. Closing it is
roof-UX work — Phase 3. Pinned by a test so it cannot start emitting silently.

### 5.3 Dormant entities, classified

| Entity | Reachable | Editable | Design-affecting | Read back | Persistence required |
|---|---|---|---|---|---|
| `vertexSpecs` | yes | yes | no — no consumer | no | no (UX gap) |
| trees | yes | yes | no — visual only | no | no (UX gap; revisit with shade, Phase 5) |
| blocks | yes | yes | no — no consumer | no | no (UX gap) |
| gable/hip helpers | yes | yes | no — see 5.2 | no | Phase 3 |
| `markOnly` | — | — | yes | **derived** | **no** — it is `!planeHasPanels`, and panels persist, so it round-trips by construction |
| ground tilt / azimuth / row spacing / height / bifacial | yes | yes | yes | yes | yes, project-wide — they are an installer's preferences, not facts about a parcel |
| `fenceLine` / `fenceHeight` | yes | yes | yes | yes | **yes, site-bound** — lat/lng geometry |
