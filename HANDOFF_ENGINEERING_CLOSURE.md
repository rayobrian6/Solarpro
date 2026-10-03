# HANDOFF — Engineering closure gauntlet (2026-10-03)

## Standing Rules
- Push target for this work: `dev` (Ray's instruction). Never `master`.
- Three checks before a push: `tsc --noEmit` 0 errors, eslint 0 errors on changed files, affected vitest green.
- Never default a fact to make a calculator run. A string partition is an engineering conclusion: it
  needs a receiving endpoint. System Config is the authoring surface; the SLD is the visualization of
  the service graph; no new questionnaire, no new permanent rows.

## What Was Done (Ray's closure brief §1–§7)
1. **Service Topology left the Engineering tab bar.** Every installer decision that lived only there now
   lives in an existing card: generation / combiner panel part + busbar + SCCR (Battery card,
   [Select Equipment]), a panelboard's SCCR (Service card panel row, once the fault current is known),
   the PW3 commissioned output setting (Battery card), "how does the new solar connect" (readiness
   dialog). The advanced graph editor is reachable only from Review Engineering and saves through the
   page's one write path. The internal model, writers, evaluators and consumers are unchanged.
2. **No premature stringing (the fresh-job 20 / 17).** Root cause was a chain: pre-hydration Smart
   Defaults wrote a blank-inverter fleet entry → load-time even split → a stale-closure panel-count
   branch → `electricalNormalize` "repaired" it at 20 → 20/17 → autosave resurrected it. Now: no
   endpoint ⇒ no partition written, stored, drawn or billed; the card reads
   "37 modules · Stringing pending equipment selection".
3. **One canonical string engine:** `lib/electrical/canonicalStrings.ts` (`resolveStringEndpoint`,
   `canonicalStringPartition` with NEC 690.7 cold-Voc / hot-Vmp-vs-MPPT-minimum / Isc / MPPT-count
   validity gate) + `lib/system/fleetStringWriters.ts` (the only fleet string writers). Page writers,
   computed-system, SLD / SLD-PDF / BOM / permit routes consume it. Ray's job keeps 9/9/9/8/2 — every
   string inside the PW3 published window (cold Voc 527 V ≤ 550 V; 2-module hot Vmp 72.8 V ≥ 60 V).
4. **Existing or new service equipment is three persisted states:** UNANSWERED / EXISTING / NEW
   (`service.existingOrNew`, parsed in `lib/db/serviceTopology.ts`; an old row with no field reads as
   UNANSWERED, never invented as NEW). Unanswered is a required readiness answer; the SLD / permit say so.
5. **120% remedies:** suggestions until an explicit [Apply] on the Service card, which writes
   `PanelBoard.remedy` (proposed work, separate from installed readings). The engine evaluates the
   post-work rating; a derate keeps the NEC 220 load calculation as a required item; SLD draws (E)→(N)
   NEW WORK; the BOM lists a non-orderable requirement line; the permit carries the scope. [Remove]
   undoes it. A legacy `MAIN_BREAKER_DERATE` / `PANEL_UPGRADE` scalar is shown as "earlier remedy note —
   not applied" and is never migrated automatically (it names no panel or rating).
6. Live acceptance (production build, real routes, PGlite): `e2e/system-config-interview.spec.ts`
   "CLOSURE · fresh project" and "CLOSURE · Ray's Tesla job" (module conflict → resolved → strings →
   Accept → reload → SLD → BOM). 8/8 green.

## Current State
- Branch `dev`. Integrated from four slice branches (each implemented, reviewed by two adversarial
  reviewers, fixed) plus integration commits.
- tsc 0; eslint 0 errors on changed files; 105 affected test files: 2551/2551 after aligning two tests
  that still encoded the pre-1c2fb44 LOAD_SIDE default (both mutation-proved); e2e 8/8.

## Files Modified (main)
| File | Role |
|---|---|
| `lib/electrical/canonicalStrings.ts`, `lib/system/fleetStringWriters.ts` | the one string engine and its writers |
| `lib/computed-system.ts`, `lib/system/electricalNormalize.ts` | no partition / no PV AC without an endpoint |
| `app/api/engineering/{sld,sld/pdf,bom,permit}/route.ts` | consume the canonical partition; remedy-aware sizing |
| `lib/electrical/serviceTopology.ts`, `lib/db/serviceTopology.ts` | `existingOrNew`, `PanelBoard.remedy` |
| `lib/electrical/systemConfig{Answers,Interview,Placement,GenerationPanels}.ts` | writers / items for moved decisions |
| `components/engineering/systemConfig/**` | cards' new controls (no new rows) |
| `app/engineering/page.tsx` | tab removed; writers gated; Advanced editor in Review Engineering |

## Pending Work (reported by the slice authors, not hidden)
- Hybrid multi-subsystem fleet builders ("⚡ Build fleet", per-sub "+ Inverter") still size from
  `sizeSystemFromBrand`, not the canonical engine.
- "+ String Inv." on a project that already has a fleet appends a placeholder entry the installer edits.
- 120% remedy reaches computeSystem / BOM backfeed sizing / PV-4B only for the primary panel; a remedy
  on MSP #2 reaches the graph check, SLD, schedule and topology BOM only. No field for the replacement's
  interrupting rating.
- Gateway SCCR has no writer anywhere; no writer registers the multi-gateway manufacturer document.
- `tests/liveSldFailure.postgres.test.ts` / `liveAcceptanceEvidence.postgres.test.ts` write scratch files
  into the repo root on every run (not gitignored).

## Architecture Notes
- A fleet entry without a receiving endpoint is never strung (`fleetEntryHasEndpoint`); stored
  partitions without one are dropped on hydration and never consumed by a route.
- `service.existingOrNew` is the authority; `existingEquipment` details exist only when EXISTING.
- `PanelBoard.remedy` is proposed work; installed readings stay in `mainBreakerA` / `busbarRatingA`.

## Next Steps
Per Ray, the Engineering configuration gauntlet stops here. Next workstream: Design geometry (house from
nothing → connected roof sections → five-point gable → canonical planes/edges → placement → Design
facts). Slice 1 of that plan is on branch `design-s1-gable-house-fix` (not merged).
