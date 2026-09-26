# NEEDS RAY — decisions and actions only Ray can take

**A check-in is not a stop.** Everything here is recorded so the gauntlet can
keep moving. Each entry states what is blocked and — more importantly — what is
**not**, so no item here is ever a reason to pause an unrelated lane.

Last updated: 2026-09-25.

---

## Read in this order

| # | One line | What it blocks |
|---|---|---|
| **R8** | A migration file can never apply, and the batch runner stops there — so 028–123 are unreachable; a whole feature's schema sits in a directory the runner never scans | Persisting homeowner/micro-stage state; any batch migration run |
| **R1** | A committed Google API key needs rotating — only you have the account | Nothing in code |
| **R2** | How approximate should an UNCLAIMED lead's map pin be? Currently house-level | The marketplace pin only |
| **R4** | Four milestone checkboxes are POSTed and silently discarded — the product says it recorded something it did not | Persisting those four |
| **R10** | R4's shape on three more fields — including a five-state **Permit Status** dropdown nothing reads, while the real issue state lives elsewhere | Those three fields only |
| **R9** | 🚨 The permit's wind analysis was hardcoded to a 15 ft building — **fixed**, but the fix raises loads 10–22 %, and prior PE approvals were granted on the lower number | Nothing — the decision is what to do about packages already approved |
| **R3** | Two engineering repairs would move the permit digest, which retires live PE approvals | Those two only |
| **R6** | A geocoder overwrites a coordinate a human deliberately set — **measured at 2.79 km and 28 m** — and that coordinate decides which property owns the design | Nothing, but it has been silently breaking things |
| **R7** | The roof has no building-elevation sheet, so modelled wall and ridge heights reach no drawing | A roof elevation sheet only |
| **R5** | **Three things to try in Dev** — not a decision, but live acceptance overrides tests. The GHOST MODULE PREVIEW is first: its riskiest property could not be measured here at all | Nothing |

**R9 is the one that touches a sealed engineering number**, and it is already fixed —
what is left is what to do about packages approved on the old value. **R8 and R1 are the
two that matter most operationally.** R8 because a batch migration run cannot
get past file 027 today, and R1 because rotation is the only remedy for a leak.
Everything else has a safe default already applied or recorded.

---

## R8 — 🚨 One migration file permanently halts the batch runner, and a whole feature's schema is unreachable

**The most operationally serious thing found today.** Two separate facts, both
verified against a real database; full detail and the exact DDL in
`docs/gauntlet/stage-schema-reachability.md`.

### 🚨 CORRECTION, 2026-09-26 — I NAMED THE WRONG FILE. The halt is at **003**.

Everything below about 027 is still true, and the conclusion (*028–123 unreachable
by `run-pending`*) is still true. But the **cause** was wrong, and it matters,
because a fix aimed only at 027 would have moved the halt by exactly one file and
looked like it worked.

Executed against real PostgreSQL in-process (`tests/migrationRunnerHaltAndRecovery.postgres.test.ts`
— PGlite, no credential, nothing run against any real database):

> **Exactly TWO files apply. 001, 002. The third one stops it.**

`lib/migrations/003_productions_enhancements.sql` declares

```sql
ALTER TABLE productions
  ADD CONSTRAINT IF NOT EXISTS productions_project_id_unique UNIQUE (project_id);
```

**PostgreSQL has that form in no version** — `IF NOT EXISTS` exists for `ADD
COLUMN`, `IF EXISTS` for `DROP CONSTRAINT`. And the file's own header comment
asserts the opposite: *"ADD CONSTRAINT IF NOT EXISTS and ADD COLUMN IF NOT EXISTS
(Postgres 9.1+)"*. A wrong comment is why it survived — the same way a wrong
changelog hid the hardcoded 15 ft building height in R9. `042_utility_unique_site_aliases.sql`
carries the same construct.

So `run-pending` is not "blocked at 027 with 26 files of headroom". **It is dead
after 002**, and every file from 003 onward — 027 included — has only ever been
reachable through the per-identifier targeted path. That is why 107 and 113–123
each needed their own hand-built action. **027 is never even attempted.**

### (a) `lib/migrations/027` can never run either

It declares `project_id TEXT` / `user_id TEXT` while `projects.id` and `users.id`
are `UUID`, so PostgreSQL refuses the foreign key and the file rolls back — the
table is not created at all. All four database states are now executed:

| State | What 027 does |
|---|---|
| prerequisites absent | fails, creates nothing |
| UUID keys, no table | the FK is refused; no table in any shape |
| **the correct table already present** — what production is believed to hold | fails, and **the good table SURVIVES** (`micro_stage` intact, `stage` never added). **027 cannot corrupt an already-migrated environment.** |
| TEXT keys | 027 **applies** — and creates `stage`/`substage`, which **no shipped query reads**. So "make 027 runnable" is not a fix; it would produce a table the product cannot use. |

027 sits below the historical baseline, which is why the governance suite's parity
check never flagged it.

| | |
|---|---|
| **Decision required** | The disposition of **003 first, then 027**. 003 is what actually blocks the batch. Its unique constraint can be expressed idempotently (`CREATE UNIQUE INDEX IF NOT EXISTS productions_project_id_unique ON productions(project_id)`), which `ON CONFLICT (project_id)` accepts — but see the row below. |
| **🚨 Why I did NOT just fix 003** | Editing an applied migration changes its checksum, and `CHECKSUM_CONFLICT` then halts the batch for every environment where 003 is recorded applied — the exact "corrupting already-migrated environments" your brief rules out. There is no way to repair the file that is safe for both a fresh database and one that already ran it, without a ledger decision. That decision is yours. |
| **Why it is yours** | Deleting or rewriting a migration file is a governance act on the schema ledger, and your standing rule is that you run migrations. |
| **Already fixed, needing nothing from you** | The batch no longer steps over an **interrupted** migration (`f15aa257`). A crash between `markMigrationRunning` and `recordMigrationResult` leaves a row `running` for ever — nothing clears it — and `running` was excluded from `pending`, so the batch walked past the crashed file and applied later-numbered ones **on top of an indeterminate schema**. That is the out-of-order application the halt exists to prevent, through the one door the halt did not watch. It now refuses, names every stuck identifier, and applies nothing. |
| **A second gap this exposed** | Nothing can clear a `running` row — no API action, no startup sweep. So an interrupted run is now *loudly* stuck instead of *silently* dangerous, which is the right direction, but an operator still needs a supported way to reconcile one. That is a new governed action, i.e. yours. |
| **A real gap worth knowing** | `superseded` is the correct terminal ledger status for a file like this, and **no API action can set it.** Baselining it `NOT_APPLICABLE` writes only the baseline table, not `schema_migrations`, so 027 stays `pending` and `run-pending` still halts. So there is currently no supported way to retire it. |

### (b) The homeowner-stage / micro-stage schema is in the directory the runner does not scan

`projects.homeowner_stage`, `project_homeowner_stage_history` and
`project_micro_stages.micro_stage` are created only by `migrations/019`, `021` and
`022` — while the manifest reads only `lib/migrations`. Against a database built
from the scanned set, running the shipped code: `resolveHomeownerStage()` throws,
the admin project list fails entirely, `PATCH …/homeowner-stage` returns **503
"try again in a moment"** for a permanent schema defect — and `writeMicroStage()`
**silently records nothing**, because it catches, retries once, logs, and resolves.
The internal truth layer just stops recording.

| | |
|---|---|
| **Decision required** | Whether to write the two migrations. The spec is complete: `124_homeowner_stage_tables.sql` (create-table shape) and `125_projects_homeowner_stage.sql` (add-column shape) — it must be **two files**, because the static gate admits three mutually exclusive shapes and bans `ALTER` in one and `CREATE TABLE` in the other. All seven registrations are listed in the doc; missing any one makes a migration discoverable and unrunnable, which is the failure mode migration 121 already had. |
| **Settle production READ-ONLY first** | The `generate-baseline-evidence` action introspects the live catalog. 027's own index names are the signature: table present + those indexes absent means production carries the correct shape from the now-dead inline runner, and only 125 is needed. |
| **Blocked** | Persisting homeowner/micro-stage state on any deployment built from the scanned set. |
| **NOT blocked** | Everything else. A named expected-failure guard (`tests/stageSchemaReachability.postgres.test.ts`) goes red the day the schema becomes reachable, so this cannot quietly persist. |

---

---

## R1 — Committed Google API key needs rotation

| | |
|---|---|
| **Severity** | HIGH — credential exposure |
| **Where** | `components/3d/Google3DViewer.tsx:19` — a literal key as the fallback for `NEXT_PUBLIC_GOOGLE_MAPS_KEY` |
| **Decision required** | Rotate the key in Google Cloud. Only Ray has the account. |
| **Why code cannot fix it** | Deleting the literal does **not** un-leak it — it remains in git history. Rotation is the only remedy. |
| **Mitigation already true** | The file has **no importers**, so it is not in any client bundle. Exposure is repo/history-scoped, not public-web-scoped. |
| **Blocked** | Nothing in code. |
| **NOT blocked** | Everything. Provider-protection work, 3D, permit, research all continue. |
| **Safe default taken** | None applied — removing the literal without rotating would create a false sense of closure. Left visible on purpose. |

Secondary, same file: it reads `NEXT_PUBLIC_GOOGLE_MAPS_KEY` while the engine
reads `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — two names for one credential, so
setting one does not configure the other. That half **is** safe to fix in code
and is queued separately.

---

---

## R2 — Marketplace pre-claim coordinate precision

| | |
|---|---|
| **Severity** | HIGH — homeowner privacy |
| **Where** | `app/api/network/opportunities/route.ts` selects `no.lat, no.lng` in the **pre-claim** discovery feed |
| **Evidence** | The sibling detail route deletes `address`/`lat`/`lng` for non-entitled callers; migration 047 comments "Full address only accessible to assigned contractor post-claim"; the column is `NUMERIC(10,7)` ≈ 1 cm |
| **Decision required** | How approximate should an **unclaimed** lead's pin be? County centroid, ZIP centroid, ~1 km jitter, or no pin at all. |
| **Why it is Ray's** | It trades homeowner privacy against marketplace utility — a contractor judges drive distance from that pin. Not a technical call. |
| **Blocked** | The marketplace map/pin UX only. |
| **NOT blocked** | CRM, proposal, engineering, delete/lifecycle, permit, survey, research — all continue. |
| **Safe default available** | Round to 2 dp (~1.1 km) server-side for non-entitled rows, keeping the map usable while removing house-level precision. **Not applied** pending Ray, because it changes a live marketplace behaviour. |

---

---

## R4 — Milestone checkboxes that record nothing

| | |
|---|---|
| **Severity** | MEDIUM — the product tells an operator it recorded something it did not |
| **Where** | `components/deals/DealDecisionModal.tsx` — four toggles (`proposal_accepted`, `contract_signed_confirmed`, `engineering_approved`, `install_scheduled_confirmed`) are POSTed to `/api/projects/update-status`, which never reads them. The code comment says so out loud: *"non-breaking — update-status ignores unknown fields"*. |
| **The harm** | An operator ticks "Engineering drawings approved" and believes it is on the record. It is not, anywhere. |
| **Decision required** | Do these four milestones mean the same as existing micro-stages, or are they distinct facts? None of the four ids exists in the 34-value vocabulary. The nearest matches are `proposal_approved`, `contract_signed`, `engineering_completed`, `install_scheduled` — but whether "accepted" is "approved", and whether "confirmed" adds anything over the base stage, is a semantic question about your process. |
| **Why not just map them** | Guessing would create a **fifth** status vocabulary on a row that already carries four, which a research pass explicitly rejected for that reason. |
| **Blocked** | Persisting these four milestones. |
| **NOT blocked** | Everything else — the stage machine, micro-stages, the portal, permits, design. |
| **Safe default NOT applied, deliberately** | Removing the toggles would delete a feature you may want; silently mapping them would invent meaning. The interim state is a known lie and is recorded here rather than quietly changed. Say which way and it is a small change. |

---

---

## R3 — Digest rulings for two engineering repairs

| | |
|---|---|
| **Severity** | MEDIUM — process, not defect |
| **Context** | Changing permit-snapshot-visible content moves the snapshot digest and **retires live PE approvals**. |
| **Decision required** | Whether to proceed on two candidates that would move it: one resistance basis for the permit path, and org-level electrical standards. |
| **Blocked** | Those two candidates only. |
| **NOT blocked** | The thermal-design-basis unification — verification found it has **zero** digest impact, so it proceeds without a ruling. |
| **Safe default** | Neither digest-moving candidate is being implemented. |

---

---

## R9 — 🚨 The permit's wind analysis was hardcoded to a 15 ft building. It is fixed — and the fix RAISES loads

**This one is already implemented** (`a1963540`), because your standing
OUTPUT-CONSISTENCY LAW rules the principle: *"if the user draws physical reality in
SolarPro, every downstream consumer must either consume it or explicitly say why it
does not."* A 2-storey building modelled in 3D producing a 15 ft permit calculation
is the prohibited hidden parallel world. What needs **you** is the consequence, not
the principle.

| | |
|---|---|
| **Severity** | 🚨 HIGH — a stamped structural number, wrong in the UNSAFE direction |
| **Where** | `lib/permit/utils/structuralInput.ts` carried `meanRoofHeight: 15,` — a bare literal, no fallback chain, no comment, between two canonical-site-sourced fields and a span whose own nominal is NAMED so it cannot pass for authority. |
| **What it drove** | `heightFt → Kz → qz → net uplift → uplift per attachment → attachment count and spacing` on PV-4C and PE-1. |
| **Measured** | Exposure C at 115 mph: qz **24.46 psf at 15 ft, 27.05 at 25 ft, 29.93 at 35 ft**. Every building over one storey was analysed **10–22 % low**. On the Braidon fixture with a 23.1 ft building, uplift per attachment goes **453 → 500 lbs**. |
| **Why nothing caught it** | Every structural fixture in the repo pins 15 ft. And `lib/version.ts` already claims *"meanRoofHeight wired to ASCE 7-22 Kz calc (was hardcoded 15 ft)"* — true of the engineering page, false of the permit. A wrong changelog had talked the fix out of existence. |
| **🚨 DECISION REQUIRED** | **Any PE approval already granted was granted on the lower number**, and the attachment schedule moves with it. Whether those packages are reissued, re-stamped or left alone is yours. |
| **Also yours** | It moves the permit digest for any design that has a building model on file — the R3 question, now with a concrete case. |
| **Blocked** | Nothing. The fix is in and the full structural/digest suite is green (271 tests). |
| **NOT blocked** | Designs with no building model are **unchanged**: they still analyse at 15 ft, deliberately, so this did not silently re-price everything. What changed for them is that PV-4C now *says* the height is assumed, in the same amber the unverified-slope row uses. |
| **Safe default applied** | A height that is an assumption reports itself as one; an out-of-range estimate is rejected with its reason rather than clamped. |

### Two smaller things found alongside it — BOTH NOW CLOSED

- ~~The operator's own Structural-tab height cannot reach the permit at all.~~
  **CLOSED (`5c11c143`).** The peer session committed its files, so the wiring
  landed: `meanRoofHeight` is on `PermitInput['project']`, both permit payloads
  carry it, and the operator's entry now OUTRANKS the modelled estimate — the same
  order `rafterSpan || _geomSpanFt || NOMINAL` already used. PV-4C prints “as
  entered for this building” so a reviewer can tell an entry from a derivation.
- ~~`project.stories` is printed on the cover sheet and nothing populates it.~~
  **CLOSED (`b3a0918d`).** It now falls back to the canonical building model's
  `metadata.stories`. Correction to the original note: the row was never *blank*,
  it was ABSENT — `infoRow` drops an empty value — which is why a missing field
  read as no field at all.

---

## R10 — Three engineering-page fields are persisted, reach no output, and one of them is a STATUS

Same shape as **R4** (the four DealDecisionModal milestones POSTed and discarded),
on different fields, and R4's harm statement applies verbatim: *the product tells an
operator it recorded something it did not.* Found by enumerating all 43 fields with a
real `updateConfig({…})` writer in `app/engineering/page.tsx` and testing each against
the concatenated source of `lib/permit` + `lib/drafting` + `lib/cad` +
`app/api/engineering`. Exactly three have **zero** occurrence in any of them.

| Field | Where | What it looks like to the operator |
|---|---|---|
| `designNotes` | page.tsx:11960 | A second free-text box headed "Design Notes" — "Add design assumptions, site notes, AHJ requirements, special conditions". Written with an `as any` cast, because the field is not even in the `ProjectConfig` type. |
| `installDays` | page.tsx:11971 | "Est. Install Days", 1–30. |
| `permitStatus` | page.tsx:11980 | A five-state dropdown: Not Started / In Progress / Submitted / Approved / Issued. |

All three are persisted, because the save writes the whole config object. None is read
by any output, any route under `app/api/engineering`, or any status machine.

| | |
|---|---|
| **Severity** | MEDIUM — no wrong number reaches a sheet; the harm is a false record |
| **🚨 Why `permitStatus` is the sharp one** | An operator sets "Submitted" or "Approved" and **nothing in the product records it.** The real issue state is `projectAuthority.issueStatus`, which knows nothing about this dropdown. Two disagreeing notions of whether a permit was submitted, one of which is invisible. |
| **Decision required** | Whether `permitStatus` should drive `projectAuthority.issueStatus`, be read-only from it, or be removed. That is a status-machine ruling, not a rendering one — which is why I have not guessed. The same question decides whether `designNotes` merges with ENGINEERING NOTES or is removed as a duplicate box. |
| **Blocked** | These three fields only. |
| **NOT blocked** | The **ENGINEERING NOTES** box in the same class is FIXED (`df75ea85`) — its text was threaded into the permit generator and read by no sheet, while the cover printed generated boilerplate in the place the engineer's own notes should have been. It now renders as its own first bucket, PROJECT-SPECIFIC (ENGINEER OF RECORD). |
| **Safe default applied** | Nothing invented. The three fields keep persisting and still reach no output — unchanged, now written down. |

---

## R6 — A geocoder silently overwrites a coordinate a human set

| | |
|---|---|
| **Severity** | MEDIUM–HIGH — placement authority |
| **Where** | `components/design/DesignStudio.tsx` — `geocodeAddressForFlyTo` re-geocodes the project's address on studio mount and **unconditionally PUTs the geocoded position back over the stored coordinates.** Its sibling `geocodeAddress` guards with `if (!project.lat || !project.lng)`; this one has no guard at all. |
| **How it surfaced** | Two `e2e/persistence-join.spec.ts` tests were failing. Not a product defect in the test's sense — the fixture pinned a coordinate and gave it a different address, the geocode won, and the seeded roof ended up 2.8 km from the active site, so autosave honestly wrote nothing. The fixture is wrong and is being repaired. But the mechanism it exposed is real. |
| **Why it is yours** | The v52.1 rule is documented on purpose: *"street-level geocode always wins over stored coords"*, and for a project created from a typed address that is right — a geocoder beats a placeholder. But **it also beats a coordinate a person deliberately placed**, on every studio load, with no record that it happened. Your standing placement rules say where the user pointed is authoritative. These two disagree, and only you can say which wins when. |
| **🚨 MEASURED, so the ruling has numbers** | For `1010 Franklin Ave, St Louis, MO` it moved a deliberately pinned coordinate **2.79 km**. For `3 Melvin Drive, Granite City, IL 62040` it moved it **28 m**. Both were measured against a live geocode with the dev server logging the result. |
| **Why 28 m is not "close enough"** | Ownership of a design is decided from that coordinate via `siteKeyFromCoords` at 5 decimal places — about **1.1 m**. So a 28 m move makes the design belong to a DIFFERENT PROPERTY, and the restore then finds nothing and the autosave honestly writes an empty design. That is how two `persistence-join` tests came to look like a persistence defect for months. |
| **Extra fact worth knowing** | With no `GOOGLE_MAPS_API_KEY` set, the geocode falls through to live Census/Nominatim — so on a machine without that key, where a design thinks it is depends on whether an external service answers, and it can land mid-session. |
| **And it is not only the test fixture** | `app/design/page.tsx`'s quick-launch demo mints `makeDemoProject('1010 Franklin Ave, St Louis, MO', 38.6657, -90.2266)` — the same mismatched pair, 2.79 km apart. Anything built on Quick Design inherits it. |
| **Blocked** | Nothing. |
| **NOT blocked** | Everything continues. |
| **Safe default NOT applied, deliberately** | Adding the sibling's guard (`only geocode when there are no stored coordinates`) is a two-line change and would probably be right — but it silently changes which authority wins for every existing project, and that is a ruling, not a patch. Left visible. |

---

---

## R7 — The roof has no building-elevation sheet, so wall and ridge heights reach nothing

| | |
|---|---|
| **Severity** | MEDIUM — a permit-package scope question, and the permit package is the wedge |
| **How it surfaced** | A systematic sweep of your output-consistency law: every kind of thing a person can place or shape in the studio, checked for a consumer that carries it into an output. Panels, roof faces and hand-placed obstructions are all consumed (the chimney end-to-end, in a browser, today). Measurements are a ruler — two picked points and a computed distance, no user-entered value — so propagating them would be circular. Ground and fence scalars are placement inputs, and the rows they produce are what reaches the sheets. **One entry came back with no consumer and no good reason: the building-section model's wall, eave and ridge heights.** |
| **The finding** | Not that the data is unused — that **no roof sheet draws a building elevation.** The fence gets `SOLAR FENCE ELEVATION & PLAN`. The roof gets `SITE & ROOF PLAN — MODULE LAYOUT & FIRE SETBACKS` (top-down) and `ATTACHMENT DETAIL — MOUNTING & CROSS-SECTION` (the mount stack on a rafter, not the building). So a person can model a 10 ft 6 wall and a ridge height, see it in 3D, and no drawing in the package shows either. |
| **Decision required** | Does the package need a roof building-elevation sheet? Many AHJs ask for one showing the array against the building, and you know which ones you submit to — I am not going to guess an AHJ requirement. |
| **Why it is yours, not a bug to fix** | Adding a sheet is a feature with real scope: a new sheet id in the manifest, a drawing routine, a page-fit pass, and it MOVES THE PERMIT SNAPSHOT DIGEST, which retires live PE approvals (see R3). None of that should start on my judgement of what an inspector wants. |
| **What is already true, and cheap if you say yes** | The section model already carries the heights, and the vertical datum work is done. The missing piece is the sheet, not the data. |
| **Blocked** | A roof elevation sheet only. |
| **NOT blocked** | Everything else. The gap is recorded in a machine-checked ledger (`tests/outputConsistencyLedger.test.ts`), which fails if anyone wires the section into an output without promoting the entry — so it cannot rot into a hidden parallel world while it waits. |

---

---

## R5 — Three things to try in Dev (live acceptance, not a decision)

Not a blocker and nothing waits on it — but **live acceptance overrides tests**, so none
of these is finished until you have used it. Ordered by how likely I think they are to be
wrong, worst first.

---

### 🚨 1. The ghost module preview — START HERE, it has the riskiest unproven property

Arm the module tool and move the cursor over a roof. A translucent module should follow
it, already lying on the plane of the face beneath, amber-outlined when no traced face
owns that surface.

**The single thing to watch: does the ghost HOLD STILL under the cursor?** If it creeps
toward the camera as you move the mouse — one mount-stack per move — then the fix for a
self-referential pick did not take effect on the browser's pinned Cesium 1.114, and the
ratchet is live. The mechanism: the engine renders the scene with translucent depth
included in picks, so a translucent ghost is picked as the surface that positions it. The
resolve turns that off for its one read and restores it; that was verified by reading the
installed Cesium source, **not** by measurement, because software WebGL does not
rasterise the scene here — screenshots come back blank and picks return nothing.

Nothing about how it LOOKS is proven: not that it renders at all, not its size, pitch or
heading on screen, not that it sits above the roof rather than inside it, and not the
frame cost. First real use is the first end-to-end exercise.

Also worth one deliberate try: **click a module that sits within about 4 m of a tree.** It
should select the MODULE now. Before today a tree's 4.0 m bounding sphere took the click
in any direction — even from behind a module — and the handler then cleared the
selection, so modules near a tree were unselectable, unmovable and undeletable.

---

### 2. Move a roof corner

Press `V`, or pick Move Corner in the tool palette,
then drag one corner of a traced roof face. One vertex, one *standalone* face,
in-plane only; a face owned by a building section refuses with a reason on
screen, which is deliberate.

What to watch for, because these are the parts no harness can reach — handles
cannot be picked under software WebGL, so first real use is the first
end-to-end exercise:

- does the handle land under the cursor, or beside it;
- does the corner follow the pointer smoothly, or jump on the first move;
- press Undo afterwards. **Do the modules come back where you put them?** A
  culled panel returning even 30 cm off is the failure mode being investigated
  right now — `applyRestoredGeometry` uses a rigid-centroid map on undo that the
  forward path deliberately refuses;
- check the plan set afterwards: the three corners you did *not* drag must be
  byte-identical in the permit record. That is guarded, but the guard is a unit
  test and you are the roof.

### 3. Design history

There is now a **History** button beside Save. A snapshot
has been written on every save for a long time and nothing in the product could
reach one — so a bad save had no way back. The list shows each version's module
count and system size, not just a date, and restoring asks first.

Worth trying specifically: open the design in **two tabs**, save in one, then
save in the other. The second should now refuse with a message saying nothing was
written and to reload — rather than silently overwriting the first, which is what
it used to do. Then use History to get the earlier state back.

| | |
|---|---|
| **Blocked** | Nothing. |
| **NOT blocked** | Everything continues. |

---

---

## Resolved — no longer blocking

| Item | Outcome |
|---|---|
| **Tree drag-to-size** | ✅ **LIVE ACCEPTANCE PASS** (Ray, 2026-09-25). Regression coverage preserved: `e2e/drag-to-size-tree.spec.ts` (12 cases incl. the camera control), `tests/pointerGestureAuthority.test.ts`. |
| **Tree visible shadow** | ✅ **LIVE ACCEPTANCE PASS** (Ray, 2026-09-25). Coverage preserved: `e2e/tree-casts-shadow.spec.ts`, `tests/treeCastsShadow.test.ts`. |
