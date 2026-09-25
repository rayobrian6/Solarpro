# Gauntlet checkpoint

Internal running state. Not a report — see `NEEDS-RAY.md` for anything that
actually requires Ray.

Last updated: 2026-09-25, after the string-sizing authority landed.

---

## Live acceptance

| Item | Status |
|---|---|
| Tree drag-to-size | ✅ **PASS** (Ray, 2026-09-25). Regression held: `e2e/drag-to-size-tree.spec.ts` (12 cases incl. the falsifiability control), `tests/pointerGestureAuthority.test.ts` |
| Tree visible shadow | ✅ **PASS** (Ray, 2026-09-25). Regression held: `e2e/tree-casts-shadow.spec.ts`, `tests/treeCastsShadow.test.ts` |
| Hand-placed obstruction → plan set | Steps 1–2 browser-proven, 4–9 proven through the real CAD chain. **Step 3 (browser save/reload) still owed.** |

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
| *pending* | One string-sizing authority — the page's readout stopped applying Voc×N to optimizers |

---

## In flight

| Worker | Lane |
|---|---|
| Proposal integrity | Terminal-state guards; the guarded signing route is dead code while the unguarded one is live |
| Survey readiness | Expose the existing requirement registry on the device, before the truck leaves |
| Competitor failure hunt | The one gap every lane recorded — operator pain, via routes the first pass did not try |

---

## Queue, ranked

1. **Obstruction browser leg** — place chimney → panels clear → save/reload. Owed.
2. **Move vertex, increment 1** — architected in `VERTEX-MOVE-ARCHITECTURE.md`. One vertex of one *standalone* face, in-plane only; section faces refused with a reason, which is what keeps "rebuild one section, keep the rest" true. The likeliest place to be subtly wrong is `applyRestoredGeometry` racing the panel-cull snapshot on undo — exercise that on a real roof first.
3. **`laneA.ts`: UNKNOWN and UNTOUCHED are the same value.** Flagged by the delete
   worker as a fail-open default; investigating it showed the real shape is
   narrower and worse. There are TWO stacked `?? 'untouched'` — one in the gate
   (`lib/3d/laneA.ts`, in `shouldRunLaneA`) and one at the production call site
   (`components/3d/SolarEngine3D.tsx`, `lifecycle: geometryLifecycleRef?.current
   ?? 'untouched'`). The call site's is the operative one.

   The gate cannot distinguish two different facts:
   - `'untouched'` because the design genuinely has no deletions — acquisition
     SHOULD be permitted;
   - `'untouched'` because the ref has not populated yet — acquisition must NOT
     be, because the answer is not known.

   So flipping the default to fail-closed is the wrong fix: it would block Lane A
   on every legitimately fresh design. The right fix adds an explicit UNKNOWN
   state to the lifecycle and refuses on it — which touches the deletion-authority
   enum that was just hardened, so it gets its own pass rather than being
   squeezed in beside unrelated work. **Not yet verified that the ref can in fact
   be unpopulated at fire time; that is step one.**
4. **`switchingProperty` key drift** — a same-property key drift reads as a property change and *relaxes* the wipe guard. Narrow, deliberately untouched rather than risk the guard.
5. **Disposition-only write schedules no save** — same class as the ledger/autosave dependency bug, but it is the provider decision rather than deletion authority.
6. **Homeowner: render the install date.** Two live writers exist (`operations/route.ts`, `ScheduleInstallModal`); the portal route selects neither. This is the single most-asked support question and it is pure surfacing.
7. **`homeowner-stage/route.ts` raw-INSERTs an invalid micro-stage name** — `installation_complete` is a deal-action name, not one of the 34; TEXT column, no CHECK, so `tsc` cannot catch it and the UNIQUE makes the junk row permanent.
8. **`DealDecisionModal` posts a `milestones` array that `update-status` never reads** — silently discarded on every use.

---

## Standing rules this campaign keeps re-learning

- **Pin the requirement, not the literal.** Forbidding one spelling of a
  computation does not stop the computation. Cost a mutation escape today.
- **Never a fixed-length slice.** `stripComments` blanks comments to whitespace,
  so a comment above the assertion pushes real code out of the window. Cost two
  failures today.
- **A guard's own prose can trip it.** If a test forbids a literal, the comment
  explaining the fix must not quote it. Five occurrences so far.
- **A defaulted-away null is an unreachable guard.** `?? 30` upstream made a
  correct `?? 0` downstream dead code.
- **A wrong comment outlives a wrong number** — someone had already tried to fix
  the ITC and been talked out of it by a paragraph asserting the repeal never
  happened.
- **Verify the worker.** Two of the three deliverables integrated today had
  never reported; both were correct, but one mutation escape and one coverage
  question only surfaced because they were re-proved independently.
