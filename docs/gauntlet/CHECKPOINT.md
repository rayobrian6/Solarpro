# Gauntlet checkpoint

Internal running state. Not a report — see `NEEDS-RAY.md` for anything that
actually requires Ray.

Last updated: 2026-09-25, after the version-history panel.

---

## Live acceptance

| Item | Status |
|---|---|
| Tree drag-to-size | ✅ **PASS** (Ray, 2026-09-25). Regression held: `e2e/drag-to-size-tree.spec.ts` (12 cases incl. the falsifiability control), `tests/pointerGestureAuthority.test.ts` |
| Tree visible shadow | ✅ **PASS** (Ray, 2026-09-25). Regression held: `e2e/tree-casts-shadow.spec.ts`, `tests/treeCastsShadow.test.ts` |
| Hand-placed obstruction → plan set | ✅ **ALL NINE STEPS PROVEN.** Step 3 was the one owed, and it passes in a real browser against real PostgreSQL: real `o` keypress, real Chimney chip, real click on a real Melvin face, 30 modules down to 26, both read back through the real GET handler, and after a reload the chimney returns bound to the same `planeId`, within 0.05 m, dimensions intact, and the array returns BY ID with no survivor inside the clearance. **It found a live product defect on its first run** — see below. |
| Move roof corner | ⚠️ **Never exercised on a real roof.** Unit- and source-proven only; handles cannot be picked under software WebGL. |

---

## Shipped on `dev` this campaign

| Commit | What |
|---|---|
| `8ae1195e` | Contractor metrics stopped claiming a confident 0%; `first_contact_at` got its first writer; a dead admin endpoint revived |
| `31289978` | Hand-placed obstructions reach the plan set |
| `9d573792` | All eleven research lanes CONSUMED, with nine refutations |
| `b6006387` | A repealed 30% residential ITC stopped reaching customer-facing payback |
| `6acb46dd` | A destructive save cannot report success unless the tombstone persisted |
| `c3df7c77` | One thermal design basis per package (app == SLD == plan set) |
| `ffb9de9a` | A reshaped roof face reports the area it actually has |
| `6dedcc6d` | One string-sizing authority — the page's Auto button stopped applying Voc×N to optimizers |
| `d7d1b55d` | The portal shows the install date; an invalid micro-stage written raw; email stopped reporting success when nothing was sent |
| `b8b6cd7f` | Survey readiness reaches the crew before they leave — and refuted the lane's premise |
| `5419cf69` | The installer's margin on the design screen; raw stack traces stopped reaching toasts |
| `81f24c71` | Wire-gauge dropdown annotated with the voltage drop each option causes |
| `296c78e1` | Admin pricing page shows the rate the engine will actually charge |
| `691b33ac` | Entering "inspection" no longer announces that it passed |
| `8aaa8a2d` | The design temperature says whose it is |
| `39f700cb` | An executed contract stops being editable — and stops being signable by a stranger |
| `64368a24` | Moving a project back a stage no longer deletes the crew's completed checklist |
| `1fe6b36b` | A layout save can state the version it was based on; a stale one is refused before anything is written |
| `c91a286c` | Drag one corner of a standalone roof face — move-vertex increment one |
| `1d332e8e` | The studio's autosave states the version it was editing — two tabs stop silently overwriting each other |
| `36ddfe35` | The owed obstruction browser leg, written |
| `dcff3d4b` | A drifted site key no longer disarms the sub-system wipe guard |
| `0c451d43` | Undo of a roof reshape puts the modules back where the user put them — they were 0.30 m out, and a grown face tore the array into two pieces with modules overlapping |
| `0026fbd5` | Lane A cannot acquire before the deletion ledger hydrates — closed, ordering pinned, and the `'unknown'` enum member REFUTED as worse than the bug |
| `1c2bf89e` | Archiving a signed contract files it instead of erasing that it was signed — and the filing survives a reload |
| `c81ba096` | The local-PostgreSQL harness survives `next dev`, and refuses to boot unless it is really intercepting |
| `14703f08` | A hand-placed chimney is no longer discarded by the server's own second write; an undo stops orphaning modules in silence |

---

## ✅ HARNESS BLOCKER — CLOSED, and the cause was not what any of us guessed

`next dev`'s hot reloader was taking `globalThis.fetch` BACK on every recompile.
`router-server.js` captures the pristine fetch *before* `instrumentation.register()`
runs and hands a `resetFetch` closure to the reloader, which calls it from its
`done` hook. So the first time anything recompiled, the bridge was deleted —
permanently, in the same process — and every query after that went to the network.

All three hypotheses I handed the worker were REFUTED with evidence: the driver
does pass the header in `init`; `neon()` late-binds `fetch` so no singleton
snapshots it; and `next dev` works fine once the seam survives, so a production
build was never needed.

The fix makes `globalThis.fetch` an accessor whose setter re-wraps whatever is
assigned, so `resetFetch` and Next's own `patchFetch` both end up underneath. And
it now **refuses to boot** unless a real query through `@neondatabase/serverless`
comes back from the in-process database — because the old failure looked armed,
which is the worst property a harness can have.

### What it looked like, kept as the record

**It looked armed and was not.**

Observed first-hand, with `DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1
SOLARPRO_LOCAL_PG=1 npx next dev -p 3011`:

- the bridge logs five confident success lines — DATABASE_URL pointed at the
  in-process database, 88/120 migrations applied, 317 inline route DDL
  statements, the seeded project, and "global fetch intercepts Neon requests";
- `GET /api/health` answers `database: connected` **within about one second of
  server start**, i.e. apparently before those migrations finished, so that
  "connected" is a signal of unknown value;
- `POST /api/projects` returns **503**, and the server log shows the Neon driver
  failing at the transport layer: `getaddrinfo ENOTFOUND api.invalid`. That host
  is the driver's endpoint derived from the harness connection host, so the host
  is expected — the request reaching DNS at all is not.

A reader hitting this would naturally diagnose a missing database credential —
**which is the exact wrong conclusion the ledger already had to correct once.**

`e2e/persistence-join.spec.ts` now runs 2 passed / 2 failed. The two failures are
a **false fixture premise**, not a product defect: they pin a project to one
coordinate while giving it a different address, and the studio's documented v52.1
rule re-geocodes on mount and PUTs the result over the pin, leaving the seeded
roof 2.8 km from the active site. Being repaired. The mechanism it exposed —
`geocodeAddressForFlyTo` has no guard at all where its sibling has one — is
NEEDS-RAY R6.

---

## In flight

| Worker | Lane |
|---|---|
| Unsafe source stripper | `stripCommentsAndStrings` blanks real code in `.tsx` — a lone apostrophe in JSX text opens a string it never closes. Auditing which existing guards are reading whitespace and therefore prove nothing. |
| Persistence fixture + production obstructions | Repair the false fixture premise in `persistence-join`; and establish with real SQL whether either `/api/production` write path loses obstructions, measurements or siteArchives. |
| Migration directory split | The homeowner-stage / micro-stage schema may live in a directory the migration runner does not scan, while `lib/migrations/027` creates an incompatible table of the same name. Investigation only — no migration is to be written or run. |

⚠️ A **peer session** also works in this worktree; its Enphase branch-count work
is committed (`73404a66`, `73b2d8f5`, `a0e5e9f2`). Not mine; left alone.

⚠️ **The machine sits near its Windows COMMIT limit**, not its RAM limit — 40 GB
of 48 GB with the pool active, while 11 GB of RAM is free. That is why `tsc` OOM'd
at a 62 MB heap and why PGlite suites die mid-run. `--maxWorkers 1 --pool=threads`
survives where `--pool=forks` does not. **A crash of that kind is not a test
failure, and reading one as the other has already cost time today.**

---

## Queue, ranked

1. **Move-vertex on a real roof** — the undo interaction is fixed and proven at
   model level, but handles cannot be picked under software WebGL, so first
   real-browser use is still the first end-to-end exercise of the gesture.
   NEEDS-RAY R5 says what to try.
2. **`/api/production` should state the version it was based on, not only return
   the new one.** It now hands the new version back and the studio adopts it, so
   the reported defect is closed — but the route writing the row without a
   precondition means a genuine two-tab conflict still resolves last-write-wins on
   that path.
3. **Disposition-only write schedules no save** — same class as the
   ledger/autosave dependency bug, but it is the provider decision rather than
   deletion authority.
4. **`DealDecisionModal` posts a `milestones` array that `update-status` never
   reads** — silently discarded on every use. Blocked on NEEDS-RAY R4.
5. **`project_versions` has no retention policy** — snapshots are full-fidelity
   and written on every save. The list route caps at 50; the table does not. Now
   that the history is reachable from the UI, this will grow.
6. **`updateStatus` in `app/proposals/page.tsx` has no callers** — its only one was
   repointed at the bulk archive action. Corrected and guarded rather than
   deleted, following the precedent of the zero-caller transition route.

---

## Standing rules this campaign keeps re-learning

- **Pin the requirement, not the literal.** Forbidding one spelling of a
  computation does not stop the computation.
- **Never a fixed-length slice.** `stripComments` blanks comments to whitespace,
  so a comment above the assertion pushes real code out of the window.
- **A guard's own prose can trip it.** If a test forbids a literal, the comment
  explaining the fix must not quote it. Five occurrences so far.
- **A defaulted-away null is an unreachable guard.** `?? 30` upstream made a
  correct `?? 0` downstream dead code.
- **A wrong comment outlives a wrong number.**
- **Verify the worker — and expect the escape to be in the load-bearing part.**
  Three deliverables integrated today, three escapes found by re-proving them
  independently, and every one was in the detail the worker itself had
  identified as central: the millisecond truncation, the byte-for-byte plan
  record, the two-writer version token. A worker's own mutation set tests the
  thing it was thinking about; it cannot test the thing it was *assuming*.
- **A fixture can hide the bug it was built for.** PGlite's `now()` resolves to
  milliseconds, so a precondition comparing microsecond timestamps could be
  broken in production and green in every test. Write the value the real clock
  would produce instead of waiting for a clock that never will.
- **A test fixture that defaults to the unsafe shape makes the hole invisible.**
  `makeProposal` defaulted `share_token` to null, so every success-path case
  modelled an unshared proposal — the one shape that must not be signable.
  Fixture and hole agreed with each other and neither was visible.
- **The most important mutation is the one you will aim badly.** Four escapes
  today were my own mis-aimed mutations — renaming a declaration instead of the
  paint site, disabling a log line instead of a throw, cutting a slice before the
  code under test. Check what the mutation actually changed before recording an
  escape, and check what it *failed* to change before recording a catch.
- **A token in a type annotation is not the rule consulting it.** A guard on a
  shared predicate passed while the predicate ignored the field, because the
  PARAMETER TYPE named it. Scope the assertion to the expression that computes the
  answer. This escaped three separate guards today.
- **`tsc` catches what a source-scanning test cannot.** `orphaned` is a list of
  ids, not a count; `['p0'] > 0` is false, so the notice could never fire, and
  where it did it printed an id where a number belonged. The phrase-only assertion
  passed on all of it.
- **A crash is not a failure.** Under commit-limit pressure vitest reports
  "Worker exited unexpectedly" and PGlite fails to initialise. Three agents
  reported those as test failures today and attributed them to peers' work.
