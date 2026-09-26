# Gauntlet checkpoint

Internal running state. Not a report — see `NEEDS-RAY.md` for anything that
actually requires Ray.

Last updated: 2026-09-25, after the parser-backed source stripper.

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
| `6d497f1a` | Deciding "my own model governs this roof" survives a reload — a disposition-only change could not schedule a save |
| `164ebe7c` | A save that changes nothing no longer writes a snapshot (five identical saves wrote five) |
| `c49003e4` | The output-consistency law is machine-checked; the sweep found one real gap (NEEDS-RAY R7) |
| `894cd4f6` | `lib/migrations/027` can never apply, and the batch runner STOPS THERE — 028–123 unreachable (NEEDS-RAY R8) |
| `46cf12c1` | A coverage probe pinned the return's spelling, not the coverage |
| `59389dd6` | The source stripper is parser-backed — six assertions were unfalsifiable, two passed by luck |
| `b90164a1` | A backspace byte where a word boundary was meant made one of my own guards vacuous |
| `55e87dab` | A guard weakened around the stripper bug is restored, now the bug has a name |
| `9e5f868f` | A vacuous guard says so, and announces if its own detector breaks |
| `5cb4060d` | The design history in a real browser — written, then run: 5/5, and it found a live defect (below) |
| `64415977` | NEEDS-RAY reordered by severity with a read-first index |
| `a56c96b7` | Escape closes the dialogs — and does not reach the 3D tool behind them |
| `f7e9d74d` | The output-consistency ledger derived from the engine's own placement modes, which found one it had missed |
| `ef563e57` | The version dedupe compares the DESIGN, not the snapshot's wrapper (the two writers have different key sets) |
| `10508223` | Absence reaches the writer as absence — a fabricated `false` was switching bifacial off |
| `40016c69` | persistence-join 4/4 — the fixture raced the restore, and its address named a place 2.79 km from its pin |
| `542de4a6` | Calculate and Save state the version they were based on, on BOTH write paths |
| `3c02c432` | The autosave can no longer be starved, and there is a 15 s bound on how long work is held |
| `58d474fa` | The third guard anchored on a dependency array's last member |
| `63f010dd` | A module preview follows the cursor, pre-oriented to the face beneath it; a tree stops eating the module's click |
| `1bd22b95` | 🚨 A restored design stopped silently undoing itself — the reload's own beacon was writing the design it replaced |
| `483f3b3b` | 🚨 One browser at a time locally, no video — Ray's fix after the e2e suite rebooted his machine twice |

**The peer session shipped alongside, in its own lane** (Envoy / CT / branch counting):
`73404a66`, `73b2d8f5`, `a0e5e9f2`, `b63b944e`, `1f32d5eb`, `4b7a99e7`, `1a9f4c6f`,
`3146bcb3`. Not mine; listed so the history reads honestly.

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
| Persistence fixture + production obstructions | Repair the false fixture premise in `persistence-join`; establish with real SQL whether either `/api/production` write path loses obstructions, measurements or siteArchives. |
| Ghost module preview + pick priority | The top-ranked competitor win. A module preview on the cursor, pre-oriented to the face beneath it, calling the SAME snapper the commit calls — Ray's word is that the ghost preview is contractual. Plus site objects no longer intercepting panel picks. |

## 🚨 HOW TO RUN THINGS ON THIS MACHINE — read before any test command

**THE FULL E2E SUITE REBOOTED THE MACHINE TWICE, both times mine.** Every spec renders a
Cesium scene through `chromium-software-webgl` — SwiftShader, so WebGL on the CPU — and
Playwright defaulted to half the cores' worth of workers, i.e. EIGHT software-3D browsers
locally. Two agent sessions each running the suite pinned it at 100% until it had to be
rebooted. `video: 'retain-on-failure'` compounded it: it RECORDS every test and only
deletes the passing ones afterwards.

Ray capped local workers at 1 and turned video off (`483f3b3b`). **Keep it. Never pass
`--workers` or raise `PW_WORKERS`. Run SMALL TARGETED BATCHES — the one spec that answers
the question in front of you — never the whole suite. Never start a browser run while a
peer session might also be running one.** Memory:
`e2e-swiftshader-freezes-the-machine`.

Warm `/design` with one `curl` first, or the first compile eats a test's mount budget and
looks like a mount failure. And a browser run needs a STILL worktree: a peer recompiling
mid-run invalidates the chunk and reads exactly like a product failure.

**Vitest has the mirror problem**: the limit is the Windows COMMIT charge, not free RAM
(`tsc` has OOM'd at a 62 MB heap with 11 GB free). Use `--maxWorkers 1 --pool=threads`
with `NODE_OPTIONS=--max-old-space-size=2048`; `--maxWorkers 3` dies. But
`tests/utility-bill-attachment.test.ts` needs `--pool=forks` because it calls
`process.chdir()`, which the thread pool does not support — **that is a pool artefact,
not a failure.** A crash is not a failure either; both mistakes were made today.

---

⚠️ A **peer session** shares this worktree and is working the Envoy / CT /
interconnection lane (`lib/permit/snapshot/build.ts`, `lib/permit/utils/sldAdapter.ts`,
`lib/permit/utils/bomForPermit.ts`, `lib/equipment/sldCombinerFields.ts`,
`app/api/engineering/sld/route.ts`, new `lib/permit/utils/interconnectionRule.ts`). Its
committed work is `73404a66`, `73b2d8f5`, `a0e5e9f2`, `b63b944e`, `1f32d5eb`, `4b7a99e7`,
`1a9f4c6f`, `3146bcb3`. **Leave its files alone and commit with explicit paths, never
`-A`.**

---

## Verification state, today

A single full-suite run OOMs while the pool is active, so it was done in BATCHES
by filename pattern and the numbers added up:

| Batch | Files | Result |
|---|---|---|
| proposal / signature / archive | 23 | 475 passed |
| version / layout / siteDesign / 3D / undo | 43 | 971 passed (1 real break, mine, fixed) |
| stage / task / obstruction | 15 | 338 passed + 1 expected fail |
| permit / planset / cad / sld / engineering | 198 | 2,788 passed |
| remainder, three chunks | 231 | 3,837 passed, 472 skipped |
| every `stripSource` importer | 49 | 767 passed |

Two red herrings resolved rather than attributed:
- **10 failures in `tests/utility-bill-attachment.test.ts` were MY POOL CHOICE.**
  It calls `process.chdir()`, unsupported on `--pool=threads`. 10/10 on
  `--pool=forks`. A pool choice is not a failure, the same way a crash is not.
- **1 failure in `tests/sourceControlBytes.test.ts` WAS MINE** — a literal
  backspace byte where `` was meant, making my own guard vacuously true. It was
  the only control byte in 2,410 files. Fixed at the byte level, because a text
  edit cannot match an invisible byte.

---

## Queue, ranked

**My unblocked queue is drained; the two workers hold the two live lanes.**

1. **Move-vertex and the history panel on a real roof** — NEEDS-RAY R5 says what to
   try. Handles cannot be picked under software WebGL, so first real-browser use is
   the first end-to-end exercise of the gesture.
2. ~~`/api/production` should state the version it was based on~~ — **DONE**
   (`542de4a6`). Both callers send it and the route hands it to the writer on BOTH
   paths, including the wholesale-spread path a top-level field never reached.
3. **Full e2e suite against the now-working harness.** The local-PostgreSQL bridge
   was disarmed by the hot reloader all along, so several specs had never run. Held:
   a worker currently owns the dev-server/playwright path.
4. **`DealDecisionModal` milestones** — silently discarded on every use. Blocked on
   NEEDS-RAY R4 (what a milestone checkbox means).
5. **`project_versions` retention** — the non-destructive half is done (a save that
   changes nothing writes no snapshot). How long a person's history is worth keeping
   is Ray's.
6. **`tests/laneAAcquisitionOrdering.test.tsx`'s post-commit case is vacuous** and now
   says so. If it should prove something today it needs a different formulation.
7. ~~The autosave's debounce restarts on every state change~~ — **DONE**
   (`3c02c432`). The churn source was `saveLayoutToDB` itself sitting in the
   dependency array while being a `useCallback` over nine values; it is reached by ref
   now, and `AUTOSAVE_MAX_DEFER_MS = 15_000` bounds how long work is held, measured
   from the FIRST change in a burst.
8. **`reactStrictMode: true` runs every restore TWICE in dev**, and the second
   `hydrateFromStored` replaces the active bundle. Harmless in production, but it will
   bite any future browser test that places geometry early — it already cost one.
9. **The drawn ground-array boundary (`groundArea`) is session-only, and the path IS
   live.** Verified: React state in DesignStudio alone, zero references in the 3D
   engine, absent from the persistence payload and from every output — and `show3D`
   defaults to true but there is a **user toggle**, so a person can switch to the 2D
   canvas and draw one. Not dead legacy code. Draw a boundary, save, reload, and the
   boundary is gone while its panels remain, so Auto Layout cannot be re-run without
   redrawing it. What is left is a product call plus a constraint: persisting it needs
   a column of its own, the way `fenceLine` (the identical lat/lng-array shape) has
   one — so it needs a migration, which is Ray's. In the output-consistency ledger.
10. **Seven `components/design/*` components have no importer** (`DesignHeader`,
   `DesignSidebar`, `DesignToolbar`, `ProductionPanel`, `RoofEditPanel`,
   `ShadeAnalysisPanel`, `ViewOptionsMenu`) — an extraction from the 7,700-line
   DesignStudio that was never adopted. Dead code, not a broken feature, but it makes
   the monolith look smaller than it is.
   🚨 A sweep for this found `components/ui/ErrorBoundary.tsx` unimported too and I
   nearly wrote it up as a robustness gap — REFUTED: the app uses Next's own
   per-route `error.tsx` convention (admin, auth, clients, dashboard, design,
   engineering all have one), so the component is redundant rather than missing. And
   the first version of that sweep reported nine false positives because it matched
   only single-quoted imports.

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
