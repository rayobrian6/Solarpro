# HANDOFF — v64 3D Blocks feature (2026-08-25)

**Date:** 2026-08-25
**Branch:** `james-dev`
**Status:** Local commits ready, all 5 stages green on the gauntlet, **NOT PUSHED — awaiting James's "ship it" per §7**
**Author:** JAMES (per AGENTS.md R6 — feat: commits attributed to JAMES)

---

## TL;DR

Built a 5-stage feature to close the Aurora parity gap for addresses where
Google 3D Tiles has no coverage. The user can now:

1. **Drop a Block** (white extruded walls, 2 corners + 6m default height)
2. **Drag the orange handle on top** to set the block height anywhere 1m–30m
3. **Drop a Gable or Hip roof** on top of the block (2 eave corners, real geometry)
4. **Drop decorative trees** (green sphere + brown trunk)
5. **Mark planes on the roof** + Auto Fill to place solar panels

This matches the user's reference screenshots:
- Aurora screenshot: white extruded walls + multi-segment roof + panels
- 3D-After-at-Noon: 2-section roof + measurements + green sphere trees

## Commits (in order, all on james-dev)

| SHA | Stage | What it adds |
|---|---|---|
| `9f2e0e4d` | 1 | Block primitive (drop 2 corners, 6m white box) |
| `fa9b517f` | 2 | Gable roof primitive (2 eave corners, 2 sloped faces meeting at ridge) |
| `d28fcf96` | 3 | Block drag-to-resize handle + Hip roof variant |
| `14ae4d59` | 4 | Extract math to `lib/3d/blockMath.ts` + 23 unit tests |
| (this handoff) | 5 | Tree primitive + this handoff doc |

## Files changed

| File | Lines | Notes |
|---|---|---|
| `components/3d/SolarEngine3D.tsx` | +706 | Block / Gable / Hip / Tree primitives + resize drag |
| `lib/3d/blockMath.ts` | +157 NEW | Pure math: footprint dims, ridge geometry, height clamp |
| `tests/block3d.test.ts` | +260 NEW | 23 unit tests for the math |

## Gauntlet results (final, all 5 stages)

| Stage | tsc | lint | vitest |
|---|---|---|---|
| 1 (Block MVP) | 0 | 0 | 10075/10566 |
| 2 (Gable) | 0 | 0 | 10075/10566 |
| 3 (Resize + Hip) | 0 | 0 | 10075/10566 |
| 4 (Extract + tests) | 0 | 0 | 10098/10589 |
| 5 (Tree) | 0 | 0 | 10098/10589 |

The 1 pre-existing fail is `tests/planset/pagination-w9.test.ts` — a
font-pack artifact flagged in the test's own self-documentation, not
caused by any of this work.

## Tooling additions in SolarEngine3D

Four new tools in the left toolbar (Tools group):

| Tool | Icon | What it does |
|---|---|---|
| Block | 🧱 | 2 clicks → 6m white box + orange drag handle on top |
| Gable | 🏠 🏗 | 2 clicks → gable roof (2 sloped faces + 2 triangular ends) |
| Hip | 🏗 🏠 | 2 clicks → hip roof (2 trapezoid slopes + 2 triangle ends, ridge shorter than eave) |
| Tree | 🌳 | 1 click → green sphere + brown trunk |

## Workflow to match the screenshots

1. **Open design** at `solarpro-dev.vercel.app/design`, type address
2. **Drop a Block** — click 🧱, click 2 corners over the satellite drape
3. **Set height** — drag the orange handle up/down (1m–30m)
4. **Drop a Gable or Hip** on top — click 🏠🏗 or 🏗🏠, click 2 eave corners at the block's top
5. **mark_plane** on the roof slopes — outlines the roof segments
6. **Auto Fill** — drops panels on the marked planes
7. **Drop trees** around the house — click 🌳 for each tree

This produces the schematic 3D house in the user's reference images:
white walls + multi-segment roof + solar panels + green sphere trees.

## What's deferred (intentionally, not in scope of v64)

| Feature | Why deferred |
|---|---|
| Save/load blocks+gables+hips with the project | Needs DB schema work, separate task |
| Block color picker | UI polish, v65 |
| Roof pitch slider (currently hardcoded 22°) | UI polish, v65 |
| Auto-detect eave height when gable is placed on a block | Math, can ship in v65 |
| Skylight/vent primitives on roofs | Not in user's reference images |
| Wire block heights to the placePanelsControlled planeHeightAtCenterMeters | The block's height is currently local to the 3D viewer; doesn't flow back to the panel placement engine yet. v65. |

## How to verify in the browser

1. Push the 5 commits to `origin/james-dev` (need James's "ship it")
2. Wait for Vercel to build + deploy (solarpro-v31-8waysnnzh-...)
3. Open the deployed URL, go to /design
4. Try each tool in the left toolbar
5. Verify: Block renders as white box, Gable renders as 2 sloped faces, Hip renders as 4 faces, Tree renders as green sphere on trunk

## Standing rules check (per AGENTS.md)

- R1 (never push master): ✓ only `james-dev` touched
- R2 (tsc + lint + vitest before push): ✓ all 5 stages green
- R6 (feat: attributed to JAMES): ✓ all 4 feat: commits authored as JAMES
- R7 (only push to james-dev): ✓ no master/dev pushes
- §6 (handoff doc committed in same push): ✓ this file is the handoff
- §7 (JAMES magic word for push): **awaiting "ship it" from James**
- §9 stop-and-ask paths: ✓ no edits to `app/api/auth/`, `app/api/webhooks/`, `lib/survey/`, `lib/auth/`, `db/`, or `migrations/`

## What's next (per the gauntlet list)

- Material DB audit (highest-leverage: plan-set route bug with hardcoded `roofWidthFt=30, roofLengthFt=20` + `CanonicalBuildingModel` built but never persisted)
- Logo work
- Full UI/UX audit
- Apply migration 121 in `/admin/system-tools/migrations` (James — once Vercel preview is confirmed green from this push)
- Test the dog toggle
