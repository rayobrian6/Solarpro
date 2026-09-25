# DELETE / LIFECYCLE ADVERSARIAL AUDIT

**Date:** 2026-09-25
**Stance:** read-only forensic. Looking for (a) the product losing the user's work,
(b) the product keeping something the user deleted. (b) is worse: a deleted thing
that survives into a permit package or a proposal is a lie with the user's name on it.
**Nothing in this document was fixed.** No product source was edited.

Notation: **FOUND** = I read the code that does this. **ABSENT** = I searched the
named places and found no such code; that is an absence of evidence, stated as such.

---

## 0. The doctrine still holds — at the core

The three doctrines in the brief are **FOUND and intact** in the modules that own them:

- **Tombstone ledger + one-shot authorization** — `lib/design/deletionAuthority.ts`
  (939 lines). `DeletionLedger` per `siteKey`, `admitFaces` / `admitObstructions` as
  the one filter, `DestructiveAuthorization` minted only by `applyDelete`
  (`components/design/useSiteDesign.ts:918`) and consumed only on a **successful**
  save (`components/design/DesignStudio.tsx:1359`).
- **Archive, never clear** — `lib/design/siteDesignModel.ts:517-522` archives the
  leaving bundle rather than wiping it; `switchSite` re-admits through the ledger at
  `:547-548`; `hydrate` wraps *every* branch through `admitAfterHydrate` at `:800-863`.
- **Multiple writers to the layout row** — still **THREE**, enumerated in §5.

The defects below are all at the **edges** the authority does not reach: the 3D
engine's own panel deletes, render-only primitives, derived state that is never
re-derived, and — the most serious of them — the transport between client and server.

One correction to the mental model before reading on: **the ledger has no column of
its own.** It rides inside `layouts.site_archives` as a field
(`siteDesignModel.ts:668`), written by a separate statement from the one that removes
the geometry, in a `try` whose `catch` is a `console.warn`
(`lib/db/projects.ts:1304-1311`). Everything in §R1 follows from that.

---

## 1. Delete-path inventory

Every reachable delete gesture, what it removes, and whether a tombstone is written.

| # | Gesture | Entry point (file:line) | Goes through `planDelete`/`applyDelete`? | Tombstone | Undo entry | Authorization |
|---|---|---|---|---|---|---|
| 1 | Delete roof face (3D, Delete key on selected face) | `SolarEngine3D.tsx:11071-11081` → `onRequestDelete('face'\|'section')` | **yes** | yes | yes | yes |
| 2 | Delete section (inspector) | `SolarEngine3D.tsx:17790-17798` → `onRequestDelete(scope,target)` | **yes** | yes | yes | yes |
| 3 | Delete obstruction / tree (inspector button) | `SolarEngine3D.tsx:17723` | **yes** | yes | yes | yes |
| 4 | Delete obstruction (Delete key) | `SolarEngine3D.tsx:11065-11068` | **yes** | yes | yes | yes |
| 5 | Clear all obstructions | `SolarEngine3D.tsx:16924` → `'obstructions'` | **yes** | yes | yes | yes |
| 6 | Clear panels | `SolarEngine3D.tsx:15876` → `'panels'` | **yes** | n/a (panels aren't tombstoned) | yes | yes |
| 7 | Clear custom building | `SolarEngine3D.tsx:15878` → `'customBuilding'` | **yes** | yes | yes | yes |
| 8 | Start Over | `SolarEngine3D.tsx:15880` → `'design'`; also `DesignStudio.tsx:4726` `clearAll` | **yes** | yes + `clearedAt` | yes | yes |
| 9 | **Delete selected panels, 3D (Delete key)** | `SolarEngine3D.tsx:11061-11064` → `deleteSelectedPanels()` `:10821` | **NO** | no | **NO** | **NO** |
| 10 | **Delete selected panels, 3D (toolbar trash)** | `SolarEngine3D.tsx:16398` → `deleteSelectedPanels()` | **NO** | no | **NO** | **NO** |
| 11 | Delete selected panels, 2D (Delete key) | `DesignStudio.tsx:3619-3628` | no — `notePanelRemoval` only | no | **NO** | yes |
| 12 | Delete selected panels, 2D (toolbar trash) | `DesignStudio.tsx:5227-5232` | no — `notePanelRemoval` only | no | **NO** | yes |
| 13 | **Clear placed blocks** (white massing prisms) | `SolarEngine3D.tsx:16970` → `clearPlacedBlocks()` `:12511` | **NO** | no | **NO** | n/a |
| 14 | Fence line / ground area | only cleared by #8 (`DesignStudio.tsx:4684-4685`) | via #8 only | no | no | via #8 |
| 15 | Measurements | only cleared by #8 (`plan.clearsMeasurements`) | via #8 only | no | yes (snapshotted) | n/a |
| 16 | Keep-out zones from Nearmap AI | only cleared by #8 (`DesignStudio.tsx:4690`) | via #8 only | no | no | n/a |
| 17 | `clearPanels()` in the engine | `SolarEngine3D.tsx:15052` | **DEAD CODE — zero callers** (grep: only the definition and comments) | — | — | — |

### Project / proposal level

| # | Gesture | Entry point | Kind | Children | Audit row |
|---|---|---|---|---|---|
| 18 | Delete project (user) | `app/api/projects/[id]/route.ts:82-104` → `softDeleteProject` `lib/db/projects.ts:631-643` | **soft** (`deleted_at = NOW()`) | none touched — layouts, proposals, planset files all survive | **none** |
| 19 | Bulk delete projects | `app/api/projects/bulk-delete/route.ts:35` → `bulkSoftDeleteProjects` `:645-662` | **soft** | same | **none** |
| 20 | Admin "Hard delete (permanent)" | `app/api/admin/projects/route.ts:136-138` (`DELETE FROM projects WHERE id = ${id}`), UI `app/admin/projects/page.tsx:189-191` | **HARD**, no ownership scoping beyond `requireAdminApi` | cascades `layouts`, `project_versions`, `productions` (`001_initial_schema.sql:68,97,115`); **orphans** `proposals` (no FK) and `project_files`; `field_route_measurements` has a `NO ACTION` FK (`118_…:95,206`) so the delete may simply **error** | **none** |
| 21 | Delete proposal | `app/api/proposals/[id]/route.ts:453-479` | **HARD**, owner-scoped | `proposal_signatures` cascade (`040_…:13`) | **none** |
| 22 | Bulk delete / "clear test" proposals | `app/api/proposals/bulk/route.ts:64-68`, `:34-39` | **HARD** — `clear_test` removes every proposal of the user with `viewCount = 0` | same | **none** |
| 23 | "Archive" a proposal | `app/api/proposals/bulk/route.ts:79` (`jsonb_set(data_json,'{status}','"archived"')`) | status flag only, no column | — | **none** |

See **A8** for why #18 and #23 are the dangerous ones.

### Notes on the inventory

- **#9/#10 are the headline.** `deleteSelectedPanels` (`SolarEngine3D.tsx:10821-10843`)
  splices `panelsRef.current`, removes the Cesium entities, and calls
  `onPanelsChange(newPanels)`. In `DesignStudio.tsx:5257` that prop is wired to a raw
  setter: `onPanelsChange={(p) => setPanels(p as any)}`. **No `notePanelRemoval`, no
  `recordPanelCull`, no history push.** The 2D equivalents (#11/#12) *do* call
  `site.notePanelRemoval(...)`; the 3D ones do not, and 3D is where the demo happens.
- **#13**: `clearPlacedBlocks` deletes Cesium entities, `blockHeightOverridesRef`
  and the vertex specs. The canonical `sec-block-*` roof face the block created
  (`SolarEngine3D.tsx:11673-11700`) is **NOT** removed. Pressing "clear blocks"
  leaves the flat roof face, its panels, its BOM contribution and its planset sheet.
- **#17**: `clearPanels()` at `:15052` is unreachable — grep over the file finds only
  the definition and two comments referring to it. Harmless, but it is 40 lines of
  delete logic nobody has audited because nobody can reach it.

---

## 2. The asymmetries — where a deleted thing survives

Columns are the nine places an object can live. ✔ = the delete reaches it.
✖ = **the object survives the delete there**.

| Deleted thing | 3D scene | Canonical state | Persistence | Shade scene | Panel keep-out | BOM / SLD | Planset snapshot | Proposal |
|---|---|---|---|---|---|---|---|---|
| Roof face / section (#1,#2) | ✔ `:2911` | ✔ | ✔ | ✔ (rebuilt per run) | ✔ | ✔ | ✔ (next POST) | ✔ |
| Roof face that came from a **Block** | **✖ prism stays** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Obstruction / tree (#3,#4,#5) | ✔ `:2913` | ✔ | ✔ | ✔* | ✔ | n/a | **✖ never reached it — A6** | **✖ stale derate — A2** |
| Panels deleted in 3D (#9,#10) | ✔ | ✔ | **✖ 409, see §5** | n/a | n/a | **✖ second count — A7** | ✖ if save refused | ✖ if save refused |
| Panels deleted in 2D (#11,#12) | ✔ | ✔ | ✔ | n/a | n/a | **✖ stale override — A4/A7** | ✔ | ✔ |
| Placed block (#13) | ✔ | **✖ face stays** | **✖ face stays** | **✖ face stays** | ✖ | ✖ | ✖ | ✖ |
| Nearmap-detected obstruction | n/a | n/a | n/a | n/a | **✖ no delete path exists — A3** | n/a | **✖ it IS the planset's source — A6** | n/a |
| Anything, after the planset is issued | — | — | — | — | — | — | **✖ immutable by design** | — |
| A whole project (soft delete) | n/a | n/a | n/a | n/a | n/a | n/a | ✖ files orphaned | **✖ share link still live — A8** |

\* shade scene is rebuilt from live refs on every run
(`DesignStudio.tsx:4766-4772`), so the geometry is correct — but see A2.

### A1 — **The worst asymmetry: a block's roof face outlives the block**

`SolarEngine3D.tsx:11673-11700`. Finalising a Block builds a real `flat` building
section through `buildSectionRoofPlanes` and emits it via `onRoofPlaneCreated`. That
face is canonical: it takes panels, it is persisted, it reaches the BOM and the
planset. The "clear blocks" control at `:16970` calls `clearPlacedBlocks`
(`:12511-12521`), which removes **only** the Cesium prism, the handles, the height
overrides and the vertex specs.

Consequence: the installer presses the button that says the blocks are gone, the
screen agrees, and a flat roof deck with its modules stays in the design, in the
save, in the BOM and on the permit sheet — invisible in 3D because nothing draws it
once the prism is gone and the plane entity map entry has been orphaned. **This is a
delete that leaves work behind with the user's name on it.**

The mirror of it: deleting the *face* (#1/#2) removes the canonical object but
`clearPlacedBlocks` is only invoked when `deletion.resetEditor` is true
(`SolarEngine3D.tsx:2919-2928`), and `resetEditor` is set only for
`clearsProperty || scope === 'customBuilding'` (`DesignStudio.tsx:4674`). So deleting
one block section leaves its prism, its grab handle and its vertex handles on screen —
and `blockResizeDown` (`:7256`) can still grab that handle and "resize" a building
that is no longer in the design.

### A2 — A deleted tree's shade loss survives the tree

`runShadeAnalysis` (`DesignStudio.tsx:4748-4811`) writes `annualShadeFactor` onto
every panel and that number is **persisted with the panel**. The auto-rerun effect
(`SolarEngine3D.tsx:3277-3282`) fires on `[obstructions, showShadeLocal, stage]` and
**returns immediately if `showShadeLocal` is false**:

```
useEffect(() => {
  if (!showShadeLocal) return;          // nothing is being shown; nothing to keep true
  if (stage !== 'done') return;
  onRunShadeAnalysis?.();
}, [obstructions, showShadeLocal, stage]);
```

So: run Shade (factors written), turn the Shade layer **off**, delete the tree. The
tree is gone from the scene, from state, from persistence and from the next shade
scene — but every panel keeps the derate the tree caused, and
`lib/proposal/buildCanonicalProposal.ts:139-145` computes the system shade derate
from exactly those per-panel factors. **The proposal quotes production reduced by a
tree the customer was told had been removed.**

The same effect does **not** watch `roofPlanes` (**ABSENT** — I checked every
`onRunShadeAnalysis` call site: `SolarEngine3D.tsx:3281` and `:17198`, and neither
depends on roof geometry). Deleting a shading garage face never re-runs shade, even
with the layer on.

### A3 — Nearmap keep-out zones cannot be deleted at all

`DesignStudio.tsx:944` declares a **second** obstruction array —
`const [obstructions, setObstructions] = useState<NearmapObstruction[]>([])` — fed
only by the aerial detect at `:2107`, converted to `keepOutZones` at `:2108`, and
consumed by `filterPanelsByObstructions` at `:4250`, `:4327`, `:4397`. There is **no
delete path for it**: `planDeletion` searches `placedObstructionsRef` only
(`useSiteDesign.ts:853`), and `setKeepOutZones([])` appears once, at `:4690`, inside
`if (plan.clearsProperty)`. An aerial false positive therefore blocks panel placement
for the life of the design unless the user presses Start Over.

### A4 — A deleted panel keeps its string override in the electrical design

`stringOverrides` (`DesignStudio.tsx:810`) is `Record<panelId, stringIndex>`, written
by `handlePanelPaint` at `:866`, and is **never pruned when a panel is deleted**
(`resetStringOverrides` at `:868` clears all or nothing). `buildDesignElectrical`
(`:874-901`) passes it straight through as `overrides`, and that block is persisted in
`layouts.design_electrical` and read by Engineering. `stringAssignment` itself *is*
derived from live `panels` (`:821-830`), so the on-screen SLD is correct — but the
persisted handoff carries ghost panel ids for ever.

### A6 — The planset's obstructions come from a source the user cannot delete, and the ones the user CAN delete never reach it

This is the second-worst finding in the document and it inverts the expected failure.

The permit route builds `project.roofObstructions` **only** from Nearmap AI and a
Claude aerial-vision sweep: `app/api/engineering/permit/route.ts:1575-1580` (aerial),
canopy filter `:1597-1603`, vision append `:1630-1633`. Those obstructions are drawn
on the roof plan (`lib/cad/roof/roofCAD.ts:154`,
`lib/drafting/templates/roof.ts:1468`, `lib/permit/sections/sitePlan.ts:413`,
`:890-921`, `:1038`).

`grep -i "obstruct" app/engineering/page.tsx` returns **zero hits**. The engineering
page never forwards `layouts.obstructions` — the migration-122 array holding every
chimney, vent and tree the installer placed and can delete — to the permit route.

So both halves are wrong at once:

- an obstruction the installer **placed and then deleted** was never on the planset to
  begin with, so the deletion is invisible there; and
- an obstruction the installer **cannot delete** (the Nearmap/vision one, §A3) is the
  one that gets drawn on the permit sheet.

Migration 122's own header (`lib/migrations/122_layout_obstructions_measurements.sql`
lines 6-16) asserts these entities feed "the BOM, the production model and the permit
drawing". The production model and the keep-out engine are wired; **the permit drawing
is not.**

### A7 — The BOM and SLD read a second panel count, not the geometry

`lib/permit/utils/sldAdapter.ts:108` — `const totalPanels = system?.totalPanels ?? 0`.
The permit route gates on the same copy: `app/api/engineering/permit/route.ts:638`
`const guardPanels = body.system?.totalPanels ?? 0`, and reports `layoutPanels` and
`engineeringPanels` as two separate facts at `:646-647` under the name
`ENGINEERING_MODEL_STALE`. So the system already knows the two can diverge.

Consequence for deletion: a panel deleted in the studio leaves the geometry array
immediately, but the BOM and the single-line diagram keep counting it until the
engineering model is re-derived. Combined with A4 (the stale `stringOverrides` on the
persisted `design_electrical`), a deleted module can appear as a string member on the
SLD with a live count behind it.

### A8 — Deleting a project does not take its proposal offline

`DELETE /api/projects/[id]` is a **soft** delete —
`app/api/projects/[id]/route.ts:82-104`, `softDeleteProject` at
`lib/db/projects.ts:631-643` (`UPDATE projects SET deleted_at = NOW()`). Proposals are
a hard-delete table with **no foreign key to `projects` anywhere in the repo** (the
agent searched `lib/migrations/*.sql`, `migrations/*.sql`, `db/*.sql` and
`app/api/migrate/route.ts`; only `ALTER TABLE proposals` statements exist).

`authorizeProposalRead` (`lib/proposalAccess.ts:98-134`) checks ownership or
token + expiry and **never consults `projects.deleted_at`**; `GET /api/proposals/[id]`
(`app/api/proposals/[id]/route.ts:23-26`) loads the row with no join at all. Tokens
minted without an expiry never expire (`lib/proposalAccess.ts:54-62`).

**So a proposal for a deleted project stays publicly readable at
`/proposals/view/{id}?token=…` indefinitely**, and
`app/api/cron/proposal-expiry/route.ts:92,107,121` will keep emailing the customer
about it. That is a priced offer, with the installer's name on it, for a job the
installer has deleted.

Two smaller leaks in the same family:

- `GET /api/proposals` (`app/api/proposals/route.ts:61-72`) returns archived proposals
  with no status filter; they are hidden client-side only
  (`app/proposals/page.tsx:533`).
- `app/api/portal/dashboard/route.ts:173-185` lists proposals with a live token and
  **no status filter**, so an archived proposal still renders the homeowner's
  "View & Sign" call to action. (The same route *does* filter dead projects at `:71`.)

Also **no audit row is written on any delete.** The agent grepped
`writeAuditLog|appendAuditLog|insertAuditLog` across `app/` and `lib/`: neither
`app/api/projects/[id]/route.ts`, nor `app/api/admin/projects/route.ts`, nor
`app/api/proposals/[id]/route.ts` writes one. The `audit_log` table exists
(`lib/migrations/100_compliance_audit_mfa_consent.sql:15-30`) and these paths do not
use it. There is a hard delete in the product — `PATCH /api/admin/projects` with
`action:'delete'`, `app/api/admin/projects/route.ts:136-138`, a bare
`DELETE FROM projects WHERE id = ${id}` with no ownership scoping beyond
`requireAdminApi`, surfaced in the UI as "Hard delete (permanent)"
(`app/admin/projects/page.tsx:189-191`) — and it leaves no record that it happened.

### A9 — Measurements are persisted and never drawn again

`onMeasurementsChange={setMeasurements}` (`DesignStudio.tsx:5303`) publishes them and
`persistencePayload` saves them. There is **no `initialMeasurements` prop on
SolarEngine3D** — grep over the file returns nothing. So a measurement survives a
reload in the database and in the layout row, and is invisible in the 3D scene: the
user cannot see it, cannot select it, and therefore **cannot delete it** except by
Start Over. Data that cannot be deleted because it cannot be seen.

---

## 3. Undo / redo coverage

### 3.1 Which actions record an undo entry

`recordGeometry` has exactly **three** producers in the whole product
(`DesignStudio.tsx:5382` "Add roof face", `:5469` section edits via
`onRoofGeometryReplaced`, `:5499` "Reshape roof"), plus `applyDelete`'s own push
(`useSiteDesign.ts:880-891`) and `recordPanelCull` (`:957-969`).

Every other writer of `roofPlanes` records nothing. From `grep -n "setRoofPlanes("`
on `DesignStudio.tsx`:

| Writer | Line | Records undo? |
|---|---|---|
| Aerial adoption — **replaces the whole roof** | `2095` | **NO** |
| Auto Fill detection merge | `5454` | **NO** |
| 2D roof draw | `3858` | **NO** |
| Sidebar "confirm all planes" | `6849` | **NO** |
| Sidebar per-plane pitch slider | `7071` | **NO** |
| Sidebar per-plane azimuth buttons | `7086`, `7109` | **NO** |

The file's own comment at `:5371-5380` states the rule ("EVERY WRITER PUSHES, OR UNDO
SKIPS OVER THE OTHERS") and describes the exact failure it produces. Six writers still
violate it. The sidebar pitch slider is the sharpest: adjust a pitch, then press Undo,
and the history replays a snapshot taken before the *previous* action — silently
reverting geometry the user did not ask to revert, under a label naming something else.

### 3.2 CONFIRMED — the block-height drag is not undoable, and not saved either

The reported case is real, and worse than reported.

`blockResizeDown` / `blockResizeMove` / `blockResizeUp`
(`SolarEngine3D.tsx:7256`, `:7316`, `:7359`) are the product's only live geometry
drag. Between them they write exactly two things:

- `r.blockEntity.polygon.extrudedHeight = new C.ConstantProperty(newHeightM)` (`:7344`)
- `blockHeightOverridesRef.current.set(r.blockEntity.id, finalHeightM)` (`:7373`)

Neither is canonical. `grep -n "blockHeightOverridesRef"` returns `:7352`, `:7373`,
`:10202`, `:10205`, `:11643`, `:12518`, `:16585` — six writes/reads and one UI
readout. **Nothing ever copies that height back into the `sec-block-*` roof face**
(also true of `setBlockHeight` at `:10189-10246`, the numeric-input path).

So dragging a block's height:
1. **is not undoable** — no `recordGeometry`, no `onGeometryAboutToChange` prop exists
   on this component at all;
2. **is not persisted** — reload restores the face at its original `eaveHeightM`;
3. **makes the picture disagree with the design** — the prism on screen is 20 m tall,
   the canonical face the planset, the BOM, the shade scene and pvwatts all read is
   still 6 m.

This is the product's headline direct-manipulation gesture and it writes to nothing
that survives the session.

### 3.3 CONFIRMED — placing a site object is undoable only if it ate a panel

`commitPlacedObstruction` (`SolarEngine3D.tsx:13505-13537`):

```
const filtered = removeObstructedPanels(panelsRef.current, [obs]);
const removed  = panelsRef.current.length - filtered.length;

if (removed > 0) {
  onPanelsAboutToBeCulled?.(`Mark ${preset.label.toLowerCase()}`);
  ...
} else {
  // status message only — NO history push
}
```

`onPanelsAboutToBeCulled` is the **only** wire from this file to
`site.recordPanelCull` (`DesignStudio.tsx:5486`), and it sits inside the
`removed > 0` branch. Placing a chimney on a bare roof, a vent between rows, or **a
tree in the yard** (a tree is `space: 'site'` and by design occupies no roof area —
`lib/3d/panelKeepOut.ts:69-77` — so it can *never* cull a panel) records **no history
entry at all**.

The consequence is not merely "undo does nothing". Undo is enabled because earlier
steps exist, so pressing it consumes a **different** step: the user places a tree,
presses Undo, the tree stays, and an earlier roof edit is silently reverted. The
codebase already documented this exact failure mode for obstruction *deletion*
(`lib/3d/geometryHistory.ts:107-118`) and fixed it there; the placement side still has it.

`duplicateSelectedObstruction` (`:13617`) and the drag-to-size placement (`:13762`)
both route through `commitPlacedObstruction`, so they inherit it.

### 3.4 What undo does cover well

`applyDelete` snapshots planes + disposition + ledger + panels + obstructions +
measurements (`useSiteDesign.ts:880-891`), `undoGeometry` restores all six and
narrows the pending authorization (`:462-493`), and `redoGeometry` re-mints one from
the ledger delta **and** the panels the step left behind (`:495-551`). That path is
genuinely sound. The gap is everything that never reaches it.

---

## 4. Resurrection paths

Ranked by how demonstrable they are from the code.

### R1 — A refused save resurrects everything, including the tombstone (DEMONSTRABLE)

`lib/db/projects.ts:1118-1128`: when an unauthorized sub-system wipe is detected the
guard **throws**, aborting the whole upsert:

```
throw new Error(
  `LAYOUT_SUBSYSTEM_WIPE: this save would remove the entire ${desc} sub-system in one step — ...`
);
```

Nothing else in that request is written — not `roof_planes`, not `obstructions`, and
critically **not `site_archives`, which is where the deletion ledger lives**
(`siteDesignModel.ts:656-669`). So a refused save means the tombstone is also not
persisted, and the next reload hydrates against an **empty** ledger and re-admits
every face, obstruction and panel the user deleted.

The atomicity here is **by ordering, not by transaction**: the `throw` at `:1120`
precedes the only `UPDATE` (`:1151`), and every later writer runs after that UPDATE
returns — `applyDesignElectrical` at `:1196`, which calls `applyDesignEntities` at
`:1272`, which is what writes `site_archives` (`:1304`), `obstructions` (`:1315`) and
`measurements` (`:1323`). The refusal surfaces as HTTP **409** via
`LAYOUT_REFUSAL_CODES` in `lib/db/core.ts:120-134` and `handleRouteDbError` at `:156`.

The guard is a decision that protects work; its failure mode is that a *single*
refusal undoes the user's entire deletion. And the refusal is permanent: the client
keeps retrying with the same payload (`DesignStudio.tsx:1384-1401` deliberately shows
the badge for ever), so there is no state from which it recovers.

Three ways to reach it:

**R1a — delete the last 4+ roof panels in 3D.** Path #9/#10 in §1 mints no
authorization. `allWiped` (`projects.ts:1086-1087`) flags any stored sub-system with
`n >= 4` that is absent from the incoming set; `authorised` is empty; the save is
refused for ever. Reload → every panel back.

**R1b — the authorization's site key and the payload's site key are computed
differently.** `applyDelete` mints with `ledgerKeyOf()` (`useSiteDesign.ts:862`),
which is `resolveLedgerKey(...)` — a **property-resolved** key that deliberately
returns an *existing* ledger key when the current spelling drifted
(`deletionAuthority.ts:149-162`). The payload carries
`siteArchives.activeSiteKey = state.activeSiteKey` — the **raw** key
(`siteDesignModel.ts:658`). The server compares them with exact string equality:

```
if (auth.siteKey !== siteKey) return false;          // deletionAuthority.ts:662
```

Whenever a property has a tombstone filed under a drifted twin key — the exact
condition this codebase documents as routine (`deletionAuthority.ts:134-147` records
2.8 m, 17 m and 19 m for one address inside 43 seconds) — every authorized deletion
at that property is refused by the server, permanently, and resurrects on reload.
The ledger was taught to match by property; the authorization was not.

**R1c — delete, then close the tab.** The beacon (`DesignStudio.tsx:1444-1508`) does
carry `destructive`, but `sendBeacon` returns no status. If the server refuses for
*any* reason the user never learns it, and `hydrateFromStored` clears
`pendingDestructiveRef` on the next load (`useSiteDesign.ts:640-644`), so the
authorization is gone too.

### R1d — The tombstone write is a *separate, silently swallowed* statement (DEMONSTRABLE, and the highest-value finding in §4)

The ledger has **no column of its own**. It travels as a field of the
`site_archives` JSONB (`siteDesignModel.ts:668`, `deletions: state.deletions`) and is
written by `applyDesignEntities`:

```
lib/db/projects.ts:1304-1308   UPDATE layouts SET site_archives = …
lib/db/projects.ts:1311        catch { /* swallowed */ }
```

The panels and roof planes were already committed **300 lines and one statement
earlier**, by the main `UPDATE` at `:1151-1195`. So the deletion is not one write; it
is two, in order, with the second one's failure ignored:

1. `UPDATE layouts SET panels = '[]', roof_planes = '[]' …` — **commits.**
2. `UPDATE layouts SET site_archives = … (containing the tombstones)` — **fails, and
   the error is caught and discarded at `:1311`.**

The client receives `200 OK` (nothing re-throws), calls `clearPendingDestructive()`
(`DesignStudio.tsx:1359`), and shows "Saved". The user has a persisted empty roof and
**no persisted record that they deleted anything.**

(The same `try`/`catch` also swallows the `obstructions` and `measurements` writes at
`:1313-1329` — one `catch` for all three at `:1330`.)

On the next load, `lifecycleFor` reads the empty ledger and the zero plane count and
returns `'untouched'` rather than `'cleared'` (`deletionAuthority.ts:384-393`), which
is exactly the state that `acquisitionPermittedByLifecycle` **permits automatic native
acquisition in** (`:404-406`). Lane A re-acquires the Google roof the installer threw
away, and `admitFaces` has nothing to refuse it with.

This is the precise failure the whole deletion-authority module was written to close
(`deletionAuthority.ts:14-27`), reachable through a `catch {}` on the statement that
carries the only evidence. Note the same swallow guards `design_electrical` at
`:1269`.

**And the pre-check that exists to stop exactly this does not look at the ledger.**
`LAYOUT_ARCHIVE_UNSTORABLE` (`lib/db/projects.ts:942-965`) fires *before* any write
when `site_archives` is missing, so that nothing is lost silently. But it inspects
only the archived *bundles*:

```ts
const lossy = ... Object.entries(sites).filter(([, bundle]) =>
    !!bundle && ['panels', 'roofPlanes', 'obstructions', 'measurements']
      .some(k => Array.isArray(bundle[k]) && (bundle[k] as unknown[]).length > 0))
```

Four entity arrays inside `sites`. It never reads `deletions`, and it never reads
`nativeGeometry` — the two payloads in that column that are pure *decisions* rather
than entities. The comment directly above it states the rationale:

> "An archive with no entities round-trips identically whether it is stored or not,
> so an empty one is allowed through"

That is true of the entity bundles and **false of the ledger**. A single-property
project that has deleted a face carries `sites: {}` and a populated `deletions`; the
pre-check sees no entities, waves it through, `applyDesignEntities` swallows the
column error, and the tombstone is discarded without trace — which is the precise
sentence the refusal message uses to describe what it exists to prevent. On any
deployment where migration 123 has not run, **every deletion is a one-session fact and
the product says "Saved".**

The same swallow guards `design_electrical` at `:1269`.

### R2 — Fence and ground panels come back from a drifted archive twin (DEMONSTRABLE)

`switchSite` (`siteDesignModel.ts:534-561`) prunes the leaving archive by **exact**
key (`delete archives[state.activeSiteKey]`) but looks the arriving one up by
**property** (`nearestSamePropertyKey`). The file's own comment at `:541-548` names
this and says the tombstones catch it. They catch faces and obstructions. They do not
catch panels:

```
panels: (arriving.panels ?? []).filter(p => !(p?.planeId && goneArrivingFace[p.planeId])),
```

The identical filter is in `admitAfterHydrate` (`:846`). A panel is filtered **only**
if it names a tombstoned `planeId`. But `deletionAuthority.ts:878-884` states plainly
that *"A FENCE OR GROUND PANEL HAS NO `planeId` AT ALL"*, and
`SolarEngine3D.tsx:15040` confirms free-click roof panels also carry
`planeId: undefined`.

So after Start Over at property A, a switch to B and back to A re-admits every fence
panel, ground panel and free-click roof panel held in the drifted twin archive — onto
a property whose ledger says it was deliberately emptied. `clearedAt` is consulted by
`lifecycleFor` only; **neither `admitFaces` nor the panel filter ever reads it**.

The clean fix shape (not applied): when `ledgerSite(...).clearedAt > 0` and the
arriving bundle predates it, admit no panels at all.

### R3 — Measurements are never filtered on arrival

`plan.clearsMeasurements` empties them in state (`useSiteDesign.ts:909`) but there is
no measurement tombstone and neither `switchSite` nor `admitAfterHydrate` filters
`arriving.measurements`. A→B→A restores them. Low severity; noted for completeness.

### R4 — localStorage holds a full copy of every deleted design, for ever

`localSaveLayout(project.id, payload)` is called on **every** autosave
(`DesignStudio.tsx:1326`) and on every manual save (`:4568`), writing the full panel
array into `localStorage`. `localGetLayout` (`lib/clientStorage.ts:114`) has **zero
consumers** — grep across the repo returns only its own definition. So it is not a
resurrection path in the product today, but it is an un-deletable copy of deleted
customer geometry sitting in the browser with no eviction and no clear path. If
anyone ever wires a "restore from local cache" fallback, R4 becomes the worst entry
on this list.

---

## 5. Save races

### The writers

**THREE from the studio**, as the brief expects, and they do not share a queue:

| # | Writer | Route | Trigger |
|---|---|---|---|
| 1 | `saveLayoutToDB` | `POST /api/projects/:id/layout` | 3 s debounce on `[panels, roofPlanes, placedObstructions, measurements, fenceLine, fenceHeight, tilt, azimuth, rowSpacing, groundHeight, bifacialOptimized]` (`DesignStudio.tsx:1410-1442`) |
| 2 | `handleBeforeUnload` beacon | `POST /api/projects/:id/layout` via `sendBeacon` | `beforeunload` (`:1444-1508`) |
| 3 | `handleSave` | `POST /api/production` with `{ layout, destructive }` | Save button (`:4560-4600`) |

**Nine writers reach the `layouts` row in total**, and the last three bypass every
guard in §5:

| # | Writer | What it writes |
|---|---|---|
| 1-2 | `lib/db/projects.ts:1152-1195` / `:1200-1226` | `upsertLayout` UPDATE / INSERT |
| 3 | `lib/db/projects.ts:1262-1266` | `design_electrical` — error swallowed `:1269` |
| 4-6 | `lib/db/projects.ts:1304`, `:1315`, `:1323` | `site_archives` / `obstructions` / `measurements` — errors swallowed `:1311`, `:1330` |
| 7 | `lib/db/projects.ts:618-622` | electrical mirror re-alignment, rewrites `design_electrical` panelIds; swallows everything `:624-628` |
| 8 | `app/api/projects/[id]/repair-system-type/route.ts:74-80` | `UPDATE layouts SET system_type` — **bypasses `upsertLayout` and all guards** |
| 9 | `app/api/admin/system-tools/route.ts:392` | bulk `UPDATE layouts l SET system_type` — **bypasses all guards** |

There is **no `DELETE` route and no `DELETE FROM layouts` in product code** — a layout
row dies only via `ON DELETE CASCADE` on the admin hard-delete of the project
(`lib/migrations/001_initial_schema.sql:68`). "Deleting a design" is expressed as
writing `panels: []` through a save, which is exactly why the guard in §R1 sits where
it does and why its failure mode is total.

### S1 — No in-flight guard, no sequencing (FOUND)

`saveLayoutToDB` is `async` with **no** re-entrancy guard and **no** `AbortController`.
Grep for `savingRef|inFlightRef|saveInFlight|AbortController` in `DesignStudio.tsx`
returns only the unrelated geocode controller at `:1798` and `:2304`. Two POSTs to the
same row can therefore be in flight simultaneously; whichever commits last wins.

**The race:** a pre-delete save A is in flight when the user deletes. Save B fires 3 s
later with the post-delete payload. If A commits **after** B, the row is restored to
the pre-delete panels *and* — because `siteArchives` carries the ledger — to the
**pre-delete tombstone set**. On reload `admitAfterHydrate` filters against a ledger
that no longer contains the tombstone, and everything comes back with nothing to
explain it.

### S2 — Any successful save consumes the authorization, even one that never carried it (FOUND)

`DesignStudio.tsx:1356-1361`:

```
if (res.ok) {
  site.clearPendingDestructive();
```

`clearPendingDestructive` is `() => { pendingDestructiveRef.current = null; }`
(`useSiteDesign.ts:986`) — it does not compare against what the responding request
actually sent. So:

1. save A leaves with the pre-delete payload and **no** `destructive` token;
2. the user deletes at t₀, minting the authorization;
3. A's `200 OK` lands at t₀+1s → **the authorization is cleared**;
4. B fires at t₀+3s, reads `site.pendingDestructive()` → `null`;
5. B is refused with `LAYOUT_SUBSYSTEM_WIPE`, permanently → **R1**.

The comment above that line correctly argues the authorization must be consumed on
*success* rather than on *send*; the missing half is that it must be consumed by the
success of **the save that carried it**.

### S3 — The manual Save button writes a slightly different payload

`buildLayout()` (`:4520-4558`) calls `site.storedArchives()` **with no `scalars`
argument**, so the active bundle's `scalars` (fence line, fence height) are taken from
whatever `stateRef.current.active.scalars` last held rather than from the live refs —
unlike the autosave (`:1259`) and the beacon (`:1472`), which both pass them. A Save
immediately after a fence edit can therefore archive a stale fence line for the active
property. Minor relative to the above, but it is a third payload shape for one row.

---

## 6. What the tests actually guard

Files read: `tests/deletionAuthority.test.ts`, `tests/deletionLifecycleRound7.test.ts`,
`tests/deletionNoResurrection.test.ts`, `tests/undoSystem.test.ts`,
`tests/geometryHistory.test.ts`, `tests/canonicalShade.test.ts`.

### Genuinely load-bearing

- `deletionAuthority.test.ts` — pure unit tests over `planDeletion`, the ledger, and
  `authorizesSubsystemRemoval`. These would catch a regression in the *domain*.
  `:203` even pins that an authorization with an empty `siteKey` is refused.
- `deletionLifecycleRound7.test.ts:160-175` — the delete → undo → redo round trip,
  including that redo re-mints. Real behaviour, real coverage.
- `deletionNoResurrection.test.ts:71-171` — drives `hydrate` and `switchSite` with a
  populated ledger and asserts the deleted face does **not** come back, *with mutation
  proofs* (`:112`, `:151`: "without the tombstone the same row restores everything").
  This is the strongest test in the set and it is the reason R2 is a panel-only
  resurrection rather than a total one.

### Coverage that looks stronger than it is

- **`tests/undoSystem.test.ts` — 45 tests over a store the product does not use.**
  It exercises `createHistoryStore` / `sceneReducer` from `lib/state`. Grep for those
  symbols across product source returns **four hits, all of them comments saying it is
  dead**: `SolarEngine3D.tsx:666`, `:1372`, `:15366` and `useSiteDesign.ts:325`
  ("Nothing ever dispatched to it — zero call sites — so the buttons were inert").
  Forty-five green tests about a ring buffer that no gesture in the product reaches.
- **Roughly a third of `deletionNoResurrection.test.ts` is source-text regex.**
  `:181`, `:187`, `:261-272`, `:282-288`, `:318-337`, `:442-458`, `:485-499` all do
  `expect(FILE_CONTENTS).toMatch(/.../)`. These pin the *shape of the code*, not its
  behaviour. They would not have caught any defect in this document, because every one
  of these defects lives in a call site the regex does not name. Specifically:
  - `:442` asserts "'Delete selected' mints an authorization — both the key and the
    button". It matches `DesignStudio.tsx` only. **The 3D `deleteSelectedPanels` path
    (#9/#10) is not covered by it, and that is the path a 3D user takes.**
  - `:476` asserts "a step that removes nothing carries nothing", which is the rule
    §3.3 shows being applied one level too high — the *placement* records nothing at all.
- **No test exercises the save race.** There is no test that issues two overlapping
  saves, and none that asserts `clearPendingDestructive` is scoped to the responding
  request.
- **No test covers the block height drag or the block/face lifetime mismatch.**
  Searched `tests/` for `blockResize`, `blockHeightOverrides`, `clearPlacedBlocks` —
  **ABSENT**, no matches.
- **No test covers `annualShadeFactor` staleness after a delete.**
  `tests/canonicalShade.test.ts` proves the *scene* is correct when built from a given
  obstruction list (`:200-201` even diffs with and without the tree); nothing asserts
  that the factors written onto the panels are re-derived when the tree goes.

---

## 7. Ranked by the RE+ demo path

The demo is: address → roof → objects → shade → panels → equipment → planset → proposal.

| Rank | Defect | Where in the demo it bites | Likelihood on stage |
|---|---|---|---|
| 1 | **R1d** the tombstone write is a separate statement whose failure is swallowed, and the pre-check that guards that column never looks at the ledger → "Saved", then Lane A re-acquires the roof the user threw away | any delete, on any deployment missing migration 123 | **Certain** where 123 has not run; silent everywhere. |
| 2 | **§3.3** placing a tree/chimney that culls nothing records no undo — Undo then reverts an *earlier* roof edit | "objects" | **Very high.** A tree can never cull a panel (it occupies no roof area), so every tree placement hits it. |
| 3 | **§3.2** block-height drag is neither undoable nor saved; prism and canonical face disagree | "roof" | **Very high** if the block tool is shown at all — it is the no-3D-coverage fallback. |
| 4 | **A6** user-placed obstructions never reach the planset; the planset's obstructions come from a source the user cannot delete | "objects" → "planset" | **High.** Every demo that marks a chimney and then opens the permit set. |
| 5 | **R1a** deleting the last 4+ roof panels in 3D → permanent 409, design stops saving, everything back on reload | "panels" | **High.** 3D Delete is the natural gesture; the badge says "Save refused" and never clears. |
| 6 | **A2** deleted tree keeps its derate in the proposal when the Shade layer is off | "shade" → "proposal" | **High.** The layer is off by default; the number is the one the customer sees. |
| 7 | **A1** "clear blocks" leaves a real roof face, its panels and its planset sheet | "roof" → "planset" | Medium. Needs the clear-blocks control, but the survivor is invisible. |
| 8 | **A7** BOM/SLD count `system.totalPanels`, not the geometry — a deleted module keeps its slot until engineering re-derives | "equipment" | Medium; the product already names this `ENGINEERING_MODEL_STALE`. |
| 9 | **R1b** authorization site key vs payload site key computed differently → every deletion refused at a drifted property | anywhere after a second visit | Medium. Requires a pre-existing tombstone under a twin key. |
| 10 | **S2** an unrelated in-flight save consumes the authorization → feeds R1 | any delete on a slow link | Medium. Conference wifi is exactly the trigger. |
| 11 | **S1/R1** two overlapping saves; the loser restores the pre-delete ledger | any burst of edits | Medium-low, but silent and total when it fires. |
| 12 | **§3.1** six `setRoofPlanes` writers record no undo (sidebar pitch/azimuth, Auto Fill, aerial adoption) | "roof" | Medium; the symptom is a *wrong* undo, which reads as flakiness. |
| 13 | **R2** fence/ground/free-click panels resurrect from a drifted archive twin after Start Over | "address" (property switch) | Low in a scripted demo, high in real multi-site use. |
| 14 | **A8** a deleted project's proposal stays live on its share link, and the expiry cron keeps emailing it | after the demo | Low on stage, **highest reputational cost off it**. |
| 15 | **A3** Nearmap keep-out zones have no delete path | "panels" | Low — only after an aerial detect. |
| 16 | **A4/A9** stale string overrides in the persisted SLD handoff; invisible undeletable measurements | "equipment" | Low severity, but both are "kept something the user deleted". |

---

## 8. Explicit absences of evidence

Things I looked for and did **not** find. Stated as absence, not as a claim.

- **An `onGeometryAboutToChange` (or equivalent) prop on `SolarEngine3D`.** Searched
  the component's prop interface (`:426-720`) and every `onGeometry*` /
  `onPanelsAboutTo*` identifier. The only undo wires into the component are
  `onPanelsAboutToBeCulled` (`:706`), `onUndoGeometry` / `onRedoGeometry`
  (`DesignStudio.tsx:5488-5489`) and the `meta.label` carried on
  `onRoofGeometryReplaced`. There is no general "I am about to change geometry" hook,
  which is why §3.2 has nowhere to call.
- **Any write-back from `blockHeightOverridesRef` to a `RoofPlane`.** Searched all
  seven occurrences plus `setBuildingOverrides` and `onSectionEdited` in both files.
  Not found.
- **Any tombstone for panels, fence lines, ground areas or measurements.**
  `DeletionLedgerSite` (`deletionAuthority.ts:100-116`) has exactly three id arrays
  plus `clearedAt`. By design — but it is what makes R2 possible.
- **Any consumer of `clearedAt` other than `lifecycleFor`.** Searched the module and
  all importers. `admitFaces`, `admitObstructions` and both panel filters ignore it.
- **An `initialMeasurements` prop.** Not present on `SolarEngine3D`.
- **A soft-delete / `deleted_at` on `layouts`, `project_versions` or `productions`.**
  Not present — `lib/migrations/001_initial_schema.sql:66-127`. Only `clients`
  (`:34`), `projects` (`:56`), `organizations`
  (`lib/migrations/105_organization_authority_foundation.sql:44`) and
  `network_opportunities`
  (`lib/migrations/072_marketplace_inventory_claim_v1.sql:22-23`) carry one. No
  `is_deleted` column exists anywhere.
- **A dedicated `deletion_ledger` column or table.** Not present. The ledger is a
  field inside the `site_archives` JSONB (`siteDesignModel.ts:668`) — which is what
  makes R1d possible.
- **A foreign key from `proposals` to `projects`.** Not present in
  `lib/migrations/*.sql`, `migrations/*.sql`, `db/*.sql` or `app/api/migrate/route.ts`
  — there is no `CREATE TABLE proposals` in the repo at all, only `ALTER TABLE`
  statements. This is what makes A8 possible.
- **An audit row on any delete.** Not written by
  `app/api/projects/[id]/route.ts`, `app/api/admin/projects/route.ts` or
  `app/api/proposals/[id]/route.ts`, despite `audit_log` existing
  (`lib/migrations/100_compliance_audit_mfa_consent.sql:15-30`).
- **A regeneration-on-read of an issued planset.** Deliberately removed —
  `app/api/engineering/permit/route.ts:288-342` serves the stored artifact unchanged,
  404s rather than rebuilding (`:319-328`), and reports staleness in headers
  (`:331-341`). This is correct, and it means deletions after issuance never reach the
  issued set; that is a property to state to a customer, not a defect.

---

## 9. The three sentences that matter

**The deletion authority is sound and its transport is not.** Every tombstone the
studio writes is carried to the server as one field inside one JSONB column, written
by its own statement, whose failure is caught and turned into a `console.warn`
(`lib/db/projects.ts:1304-1311`) — and the pre-flight check that exists to stop that
column being lost silently inspects the archived entity bundles and never the ledger
(`:942-965`). A deletion can therefore be fully applied, fully saved, reported as
saved, and leave no record that it was ever a decision.

**The product loses work** most reliably through the block-height drag, which writes
to a Cesium entity and a `Map` and to nothing that survives the session — the only
live geometry gesture in the product, non-undoable and non-persistent.

**The product keeps deleted things** most dangerously in the two documents that carry
the user's name: the planset, which draws obstructions from an aerial source the user
cannot delete and ignores the ones they can (`app/api/engineering/permit/route.ts:1575-1633`
vs. zero `obstruct` hits in `app/engineering/page.tsx`); and the proposal, which keeps
a deleted tree's derate in its production figure (`buildCanonicalProposal.ts:139-145`)
and stays live on its share link after the project it belongs to has been deleted
(`lib/proposalAccess.ts:98-134`).
