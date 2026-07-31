# W4 §6 — Permanent Resolution of `lib/plan-set/*`

Status: implemented 2026-07-21 (uncommitted; the W4 closer phase commits all of W4).
Scope confined to this workstream's boundary: `lib/plan-set/**`,
`app/api/engineering/plan-set/route.ts`, `app/engineering/page.tsx`,
`app/admin/topography/page.tsx`, and `tests/planset/*`. Snapshot core, permit
sections, drafting, `buildPermitCoverSheet`, `artifactBuilders`, jurisdictions,
and migrations were NOT touched.

## Decision: DELETE (option B)

The interim W3.1 §3 "LEGACY PATH — NOT FOR PERMIT" containment is **replaced by
permanent deletion**. The canonical generator `lib/permit/generatePermit.ts`
(reached via `POST /api/engineering/permit` → `PermitDesignSnapshot`) is the
single production planset authority and already produces the full permit package
(cover, SLD/electrical, equipment, structural, site, mounting, compliance, and
more) with real snapshot identity, validators, title-block digest, and blockers.

The `lib/plan-set/*` path was a **second, snapshot-blind planset generator**: it
built its own G-1/E-1/E-2/S-1/A-1/M-1/C-1 sheets and independently declared
`structuralStatus` / `overallCompliance` without ever consuming or validating a
snapshot. Converting it (option A) would have created a second permanent
snapshot-consumer surface to maintain — exactly what §6 forbids ("Do not retain
two production planset generators"). It rendered a strict *subset* of the
canonical package with **no unique non-authority visualization** worth migrating
(every sheet type it drew is produced by the canonical generator). Therefore:
delete, and repoint its one UI caller at the canonical generator.

## Caller inventory (exhaustive)

Enumerated via `grep` of imports of `@/lib/plan-set/*` and fetches of
`/api/engineering/plan-set` across `app/ lib/ scripts/ tests/ components/`
(the sibling `repo-bisect/` tree is a separate checkout, out of scope).

| Consumer | What it used | Disposition |
|---|---|---|
| `app/api/engineering/plan-set/route.ts` (the route) | Imported all 7 sheet builders + `title-block` + `permit-system-model` + `legacy-path-guard`; ran `computeSystem` and emitted a PDF/HTML permit artifact | **Deleted** → replaced with an HTTP **410 Gone** tombstone pointing to `/api/engineering/permit`. |
| `app/engineering/page.tsx` — `handleGeneratePlanSet()` → `fetch('/api/engineering/plan-set')` | The only live in-app fetch of the route. Triggered by the sidebar "Generate Plan Set" quick-action button (rows section "Generate Outputs"). It just downloaded the returned file; the `planSetResult`/`planSetError`/`planSetPreviewSheet` state it set was **never rendered** (write-only dead UI). | **Migrated**: `handleGeneratePlanSet` now delegates to the existing canonical `handleGeneratePermitPackage()` (`/api/engineering/permit`). Dead state removed. Button retained (same UX slot), relabeled "Generate Plan Set", driven by `permitLoading`. |
| `app/admin/topography/page.tsx` (line ~679) | A **static architecture-registry string** listing `/api/engineering/plan-set` in an `evidence: [...]` array of the "Engineering & Documents" node. Not a fetch — documentation only. | **Updated**: dropped `/api/engineering/plan-set` from the evidence list; retitled node "Engineering, SLD, BOM, Permit Package" and noted the W4 §6 retirement + canonical route in its detail text. |
| `app/api/engineering/sld/route.ts` | Imports **only** `buildPermitSystemModel` / `PermitSystemModel` from `@/lib/plan-set/permit-system-model` — a pure `ComputedSystem → flat view` bridge with **no** structural/compliance/PASS decision. Outside this workstream's edit boundary. | **Untouched**; `permit-system-model.ts` is therefore **retained**. |
| `tests/planset/legacy-path-containment.test.ts` | Exercised the interim containment (guard + S-1/C-1 banner). | **Rewritten** as a retirement/reachability proof (see Tests). |
| `scripts/planset-evidence-w3.mjs` | W3 evidence harness. Only `import`s `node:fs`; it **replicates** the guard logic inline and references the route/guard as *strings*, so deleting the modules does not break it at runtime. This is the closer-owned evidence harness. | **Untouched** — flagged for the closer: its string references to the retired route/guard are now stale and its §3 emission should be updated to reflect deletion (not containment). |

## What was deleted vs migrated

**Deleted** (snapshot-blind, PASS-capable — no remaining importers):
- `lib/plan-set/legacy-path-guard.ts` (interim containment — superseded)
- `lib/plan-set/cover-sheet.ts`
- `lib/plan-set/electrical-sheet.ts`
- `lib/plan-set/structural-sheet.ts`
- `lib/plan-set/equipment-schedule.ts`
- `lib/plan-set/site-layout-sheet.ts`
- `lib/plan-set/mounting-details-sheet.ts`
- `lib/plan-set/compliance-sheet.ts`
- `lib/plan-set/title-block.ts`
- The entire generator body of `app/api/engineering/plan-set/route.ts` (compute
  + 7-sheet build + PDF + `project_files` persistence + `structuralStatus` /
  `overallCompliance` emission) → now a 410 tombstone.

**Migrated / retained:**
- `lib/plan-set/permit-system-model.ts` — kept (external consumer: SLD route;
  no authority decisions).
- `handleGeneratePlanSet` in `app/engineering/page.tsx` — repointed to the
  canonical `/api/engineering/permit` generator (no functionality lost; the
  canonical package is a superset). No independent `structuralStatus` /
  compliance decision survives anywhere on this path.

No `structuralStatus` / `overallCompliance` / permit-ready declaration is made
by any surviving code under `lib/plan-set/*` or by the retired route.

## How the two pages behave now

- **Engineering page**: the sidebar "Generate Plan Set" button now generates the
  **canonical permit package** (same code path as the prominent "Permit Package
  Generator" on the Permit tab). Users get the snapshot-authoritative package;
  the legacy download flow is gone. The now-prominent Permit Package generator is
  unchanged.
- **Admin topography page**: the architecture map no longer advertises
  `/api/engineering/plan-set`; it points at the canonical `/api/engineering/permit`
  and states the retirement. Purely a documentation string; no behavior change.

## Reachability proof

Method — `grep` for both the imports and the fetch, over `app/ lib/ tests/`
(excluding the retirement test itself):

```
grep -rn "plan-set/{cover-sheet,electrical-sheet,structural-sheet,equipment-schedule,\
site-layout-sheet,mounting-details-sheet,compliance-sheet,title-block,legacy-path-guard}" \
  --include="*.ts" --include="*.tsx" app lib tests
  → NONE (only the retirement test, which asserts the files are absent)

grep -rn "engineering/plan-set" --include="*.ts" --include="*.tsx" app lib
  → only: app/admin/topography/page.tsx (doc string noting the retirement)
           app/engineering/page.tsx (a code comment)
     i.e. ZERO functional imports or fetches remain.
```

Runtime proof (in the test suite): `GET`/`POST` of the retired route return
**HTTP 410** with `code: "PLAN_SET_ROUTE_RETIRED"`; a dynamic `import()` of the
deleted `legacy-path-guard` **rejects**; every deleted file `existsSync === false`.

## Tests / typecheck

- `tests/planset/legacy-path-containment.test.ts` — rewritten to W4 §6:
  proves the route is a 410 tombstone (no artifact, no `STRUCTURAL_PASS`,
  no `permitReady`), the route source contains no builder/compute/PDF/PASS
  tokens, all 9 legacy builders are deleted and non-importable, and
  `permit-system-model.ts` is retained. **14/14 pass.**
- `npx tsc --noEmit` — **clean (exit 0)**.
- `npx vitest run tests/planset` — **51 files / 388 tests pass**.
- `npx vitest run tests/solardog.test.ts` (covers the engineering + topography
  pages) — **464 tests pass**. (`tests/engineering-intelligence-navigation.test.ts`
  is in the pre-existing vitest quarantine/exclude list — not run by the suite.)
