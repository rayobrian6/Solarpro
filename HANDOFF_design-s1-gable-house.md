# HANDOFF — Design geometry Slice 1: a Block becomes a visible five-point gable house

**Date:** 2026-10-03
**Branch:** `design-s1-gable-house-fix`, made from `design-s1-gable-house` (`aea2440`) because another worktree holds that branch
**Commits:** `aea2440` feat(3d) (the slice), `d152008` fix(3d) (review fixes), plus this docs commit
**Status:** Local commits only. Nothing is pushed. The branch needs Ray's review before it goes into `james-dev`.

---

## Standing Rules (relevant to this slice)

Per `AGENTS.md` and `AI-AGENT-README.md`:

- **R1 / R7 / §7.** No push from an agent. `master` is banned. The only push target is `james-dev`, and only after JAMES signs off in chat.
- **R2.** Three checks before any push: `tsc`, lint, vitest. Results are below.
- **R5.** Section faces are **user-authored** geometry (`source: 'user-traced'`). Nothing in this slice calls them CAD-ready, authoritative or permit-grade. The derived-artifact envelope is untouched.
- **R6.** `feat:` commits are authored and committed by JAMES. Both code commits are JAMES / JAMES.
- **v66 doctrine (SolarEngine3D):** absence is not intent. The renderer never removes a face because it went missing from a prop. The new Undo redraw follows that rule: the owner names the ids at the user's own action (see Architecture Notes).
- **Hard limits for this workflow:** no edits to `app/engineering/page.tsx` or `lib/electrical/**`. No new dependencies and no new env vars.

---

## What Was Done

### Slice 1 (`aea2440`)
1. **Roof-type control.** `SectionInspector` has a Flat / Shed / Gable / Hip row. It sends one edit through `onEdit → editSection → applySectionEdit({ kind, pitchDeg })`, with one label and one coalesce key, so it is one undo step. A 0° deck takes the studio's new-roof pitch (22° by default). The authority's own refusals are shown for a non-4-corner gable or hip and for a shed with no direction.
2. **The "New block eave" input works.** `finalizeBlock` reads `newBlockEaveHeightMRef`, the same pattern Gable and Hip use.
3. **Walls come on** when a section is created or changes kind (`showBuildingWalls`). This is a view change only.
4. **The Block prism steps aside** while its section's walls are drawn.

### Review fixes (`d152008`)
1. **Blocking. The orphan notice and the selection survive a kind change.** Gable removes the `::deck` the user selected. The "selection cannot outlive its face" effect then cleared the selection, which closed the inspector and wiped the notice "N panels sat on a roof face that this change removed" about 57 ms after it appeared. `adoptGeometryOutcome` now moves the selection to a surviving face of the same section (`selectionAfterRebuild`) before it raises the notice.
2. **Undo/Redo redraw what they changed.** `useSiteDesign` publishes `geometryRestore {token, removedFaceIds, reshapedFaceIds}` (`restoreRedrawFor`) on every Undo and Redo. `DesignStudio` passes it to the engine. The engine takes those pictures down (rails kept, maps never pruned), and the restore pass redraws the reshaped faces in the same commit. That redraw does not switch the Roof Model view on.
3. **The status line belongs to the action.** `renderBuildingExtrusion` writes its summary only when the 🏚 Building button was pressed (`announceBuildingRef`). Faces that are level by design (a flat section or a 0° shed, see `isLevelByDesign`) are no longer flagged ⚠ FLAT.
4. **A deleted section's prism stays hidden** (`blockPrismHidden`). Undoing the delete brings the section back, and the prism follows the toggle again.
5. **The view rules are pure and behaviour-tested** in `lib/3d/sectionViewRules.ts`. `kindBefore` now goes through `sectionFromPlanes`, the authority's own lookup.

---

## Current State

- **Branch:** `design-s1-gable-house-fix`, which is `design-s1-gable-house` plus the review fixes and this doc
- **Three checks:**
  - `npx tsc --noEmit --skipLibCheck -p tsconfig.json`: **0 errors**
  - `npx eslint` on every changed file: **0 errors** (43 warnings, none of them on a line this fix added or changed)
  - vitest, **101 affected files** (every test that references SolarEngine3D, useSiteDesign, DesignStudio, geometryHistory, sectionViewRules, sectionInspector or buildingExtrusion): **1936 / 1936 pass**. The full suite was not run, because other agents share the 4 CPUs.
- **Mutation proofs:** 15 source mutations each turn the unit tests red and pass again once restored (md5 checked). Production mutant builds:
  - With all defects put back, the browser probes reproduce every review finding.
  - With only the selection move removed, the e2e goes red at the notice step.
  - With only the undo prop removed, the e2e goes red at the Undo step.
- **Browser acceptance:** run on a production build served at :3013 with real PostgreSQL. All pass:
  - a 4 m Block gives a section at eave 4
  - Roof → Gable gives two faces with one section id and no `::deck`
  - six walls with pentagon ends, without pressing Building
  - the notice and the inspector stay on screen
  - Undo/Redo draw exactly what the design holds
  - after a reload, the same 2-face gable at eave 4
  - `e2e/design-house-from-nothing.spec.ts` passes, and skips loudly without `SOLARPRO_LOCAL_PG`

---

## Files Modified

| File | Role |
|------|------|
| `components/3d/inspector/SectionInspector.tsx` | Roof-type row (slice) |
| `components/3d/SolarEngine3D.tsx` | block eave ref, walls on, prism sync (slice); selection move, undo redraw effect, announce-only Building status, level-by-design count (fix) |
| `components/design/useSiteDesign.ts` | `geometryRestore` token published on Undo/Redo (fix) |
| `components/design/DesignStudio.tsx` | passes `geometryRestore` to the engine (fix) |
| `lib/3d/sectionEditing.ts` | a shed by name needs a direction (slice) |
| `lib/3d/geometryHistory.ts` | `restoreRedrawFor`, pure (fix) |
| `lib/3d/sectionViewRules.ts` | NEW. `sectionKindOf`, `editChangedRoofKind`, `blockPrismHidden`, `selectionAfterRebuild`, `isLevelByDesign` (fix) |
| `tests/sectionViewRules.test.ts` | NEW, behaviour tests of the rules on real section faces |
| `tests/undoRedrawsWhatItChanged.test.tsx` | NEW. Diff, hook and engine wiring |
| `tests/sectionToolWiring.test.ts`, `tests/sectionInspector.test.tsx`, `tests/buildingExtrusion.test.ts` | slice guards, updated to the helpers |
| `e2e/design-house-from-nothing.spec.ts` | real tool clicks: Block → Fill Roof → Gable → notice stays → walls → Undo/Redo → reload |

---

## Pending Work (priority order)

1. **Ray's review of this branch**, then promotion into `james-dev` (R8) after JAMES signs off.
2. **Orphaned modules are reported but stay where they are.** After Block → Gable, the modules that stood on the deck remain at deck height, inside the attic, until the user deletes them or re-runs Fill Roof. That is the existing rule ("never silently rehomed"). The notice now stays on screen, but the modules are still drawn inside the house. Offering a one-click "re-run Fill Roof on this section" would be the next step.
3. **Undo selection.** An Undo that removes the selected face still clears the selection (the old behaviour). Only a forward kind change moves it.
4. **The Building summary is announced only when the button is pressed.** A traced face that comes out flat while Building is already on is no longer flagged on the status line until Building is pressed again. This is deliberate (the redraw used to overwrite every action's message), but a dedicated non-status indicator for an accidental flat face would be better.
5. Slice 2+ per `design-plan.md`: unify prism and section heights, wall ground, overhang, joins.

---

## Architecture Notes

- **Undo redraw is owner-minted, not inferred.** `restoreRedrawFor(before, after)` runs inside `undoGeometry` / `redoGeometry` on the two canonical arrays that the action swapped. A face that is in neither array is never named. The engine effect is declared before the restore effect, so in the same commit it takes the faces down and the restore pass redraws them (`tests/undoRedrawsWhatItChanged.test.tsx` checks the order). It never prunes `plane3DEntityMap` and friends (the v66 ban stands).
- **Selection follows the section.** `selectionAfterRebuild` is called in `adoptGeometryOutcome` before the orphan notice, because `selectRoofFace` clears `sectionRefusal`. If you move either line, the notice disappears again.
- **Status ownership.** `renderBuildingExtrusion(viewer, C, { announce })` only writes the status line when `announce` is true. Only the 🏚 Building button sets `announceBuildingRef`.
- **Prism rule.** A refused section (`__sectionId` unset) shows its prism. A section in the design hides it only while Building is on. A section that is gone keeps it hidden.

---

## Next Steps

1. Ray: review `aea2440..HEAD` on `design-s1-gable-house-fix` (or fast-forward `design-s1-gable-house` to it).
2. JAMES: sign off, then push to `james-dev`. Agents do not push.
3. Before a push, run the R2 suite on the merged result, and run the e2e against a production build: `NEXT_DIST_DIR=… DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 SOLARPRO_LOCAL_PG=1 npx next build`, start the server, then `E2E_BASE_URL=… SOLARPRO_LOCAL_PG=1 npx playwright test design-house-from-nothing`.
