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
| Hand-placed obstruction → plan set | Steps 1–2 browser-proven, 4–9 proven through the real CAD chain. **Step 3 written (`e2e/obstruction-survives-reload.spec.ts`), NOT YET PASSING — blocked on the harness, see below.** |
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
| `36ddfe35` | The owed obstruction browser leg, written (unrun — harness blocked) |

---

## 🚨 HARNESS BLOCKER — the local-PostgreSQL e2e bridge is not intercepting

This is the only thing standing between the obstruction fixture and a complete
browser proof, and it is worse than a plain failure because **it looks armed.**

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

**`e2e/persistence-join.spec.ts` fails the same way, on its first test.** That
file is recorded in `docs/re-plus/READINESS_LEDGER.md` as a CLOSED cell. So
either the ledger is stale, or that suite only ever passed under a run mode
nobody wrote down.

A reader hitting this would naturally diagnose a missing database credential —
**which is the exact wrong conclusion the ledger already had to correct once.**
Delegated with three hypotheses to test (headers carried on a `Request` object
rather than in `init`; a `neon()` singleton snapshotting `fetch` before the
bridge boots; `next dev` per-route bundling versus a production build). The
required deliverable is not just a fix but a LOUD self-check, so the harness can
never again report five successes while intercepting nothing.

---

## In flight

| Worker | Lane |
|---|---|
| Lane A ordering | Can Lane A fire before `geometryLifecycleRef` hydrates? If not, close it and pin the ordering. If so, an explicit `'unknown'` that refuses. |
| Micro-stage + proposal client gaps | `installation_complete` is not one of the 34; the proposals page swallows the new 409; bulk `archive` has the status path's old hole |
| Vertex undo fidelity | `applyRestoredGeometry` calls `repositionPanelsForPlanes` on undo — the map the forward path refuses. Does a culled panel come back where the user put it? |
| Local-PG harness | The blocker above |

⚠️ A **peer session** is also editing this worktree: `lib/computed-system.ts`,
`lib/permit/utils/branching.ts`, `lib/segment-schedule.ts` and
`tests/enphaseBranchLimit.test.ts` appeared unassigned by any of my workers.
Not mine; left alone.

⚠️ **The machine is memory-saturated** — 37 node processes, 5.6 GB free of 32.
`tsc` itself OOM'd at a 62 MB heap, which is contention and not a code fault.
Heavy gates wait for the workers to finish.

---

## Queue, ranked

1. **Obstruction browser leg** — spec written; run it the moment the harness is fixed.
2. **Move-vertex on a real roof** — the undo interaction is delegated, but first real-browser use is still the first end-to-end exercise of the gesture itself.
3. **`switchingProperty` key drift** — a same-property key drift reads as a property change and *relaxes* the wipe guard. Narrow, deliberately untouched rather than risk the guard.
4. **Disposition-only write schedules no save** — same class as the ledger/autosave dependency bug, but it is the provider decision rather than deletion authority. Held: `useSiteDesign.ts` is taken this round.
5. **`DealDecisionModal` posts a `milestones` array that `update-status` never reads** — silently discarded on every use. Blocked on NEEDS-RAY R4 (what a milestone checkbox means).
6. **`project_versions` has no retention policy** — snapshots are now full-fidelity and accumulate on every save. The list route caps at 50; the table does not.

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
