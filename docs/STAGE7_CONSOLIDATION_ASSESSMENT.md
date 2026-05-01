# Stage 7 — Consolidation Assessment (READ-ONLY)

**Build:** v47.431 (read-only release)
**Author:** Stage 7 of UPGRADE_ROADMAP_v47.399.md
**Status:** COMPLETE — produces Stage-8 scope recommendation
**Mandate from roadmap:**

> *"Decide if DB consolidation is actually worth the risk."*
> *"You get a written recommendation. We choose what Stage 8 actually does."*

This document is strictly **read-only**. No code has been modified. Every
finding is backed by `grep`/`find`/file-size evidence captured inline.

---

## Executive Summary

Consolidation **is worth doing.** Three concrete targets were identified with
differing risk profiles:

| Area | Target | Scope | Risk | Recommended for Stage 8? |
|---|---|---|---|---|
| **1** | Dead BOM engines | Delete ~2,228 lines (3 orphan files + 1 orphan API route) | **LOW** | ✅ **YES** |
| **2** | Racking DB duality | Unify `racking-database.ts` (14 rows) into `mounting-hardware-db.ts` (42 rows) via adapter, port `structural-engine-v3` to v4 | **MEDIUM** | ⚠️ **CONDITIONAL** — depends on whether `structural-v2` API is still user-facing |
| **3** | Brand-profile spec duplication | Derive inverter specs (`acKw, dcKwMax, mpptCount, maxParallelStringsPerMppt`, etc.) from `equipment-db.ts` at profile-resolution time instead of copying them into each `supportedInverterModels[]` entry | **MEDIUM-HIGH** | ⚠️ **DEFER** — net benefit marginal, risk of mass regression is real |

**Headline recommendation:** Do **Area 1** in Stage 8 (pure deletion, 1-2 hour
task, 0 behavioural risk). **Defer Areas 2 and 3** until a concrete business
case emerges (e.g., a datasheet-driven bulk-edit workflow, or a decision to
retire `structural-v2`). Full rationale below.

---

## Area 1 — BOM Engine Proliferation ✅ **STAGE 8 CANDIDATE (LOW RISK)**

### Finding

**Four** BOM engines currently coexist in `lib/`:

| File | Lines | Status | Read-sites (non-test) |
|---|---:|---|---|
| `lib/bom-engine.ts` | 630 | 💀 **DEAD** | 0 |
| `lib/bom-v2-engine.ts` | 597 | 💀 **DEAD** | 1 (the dead route, below) |
| `lib/bom-unified.ts` | 684 | 💀 **DEAD** | 1 (only as a type import in the dead `bom-merge.ts`) |
| `lib/bom-engine-v4.ts` | 989 | ✅ **LIVE** | 5 files + `/api/engineering/bom/route.ts` |

Plus one dead supporting file:

| File | Lines | Status | Notes |
|---|---:|---|---|
| `lib/bom-merge.ts` | 317 | 💀 **DEAD** | Imports `bom-unified` and `bom-engine-v4`; no external consumers. |

And one dead API route:

| Route | Status | Evidence |
|---|---|---|
| `app/api/engineering/bom-v2/route.ts` | 💀 **DEAD** | Only the route file itself references `/api/engineering/bom-v2`; the engineering page calls `/api/engineering/bom` (v4). |

**Total dead code surface: ~2,228 lines across 3 orphan `lib/` files + 1 orphan API route.**

### Evidence

```console
$ grep -rln "from '@/lib/bom-engine'\|from '\./bom-engine'" --include="*.ts" --include="*.tsx" | grep -v "\.test\.\|node_modules\|\.next"
(empty — zero production consumers)

$ grep -rln "bom-v2" --include="*.ts" --include="*.tsx" | grep -v "\.test\.\|node_modules\|\.next"
app/api/engineering/bom-v2/route.ts        ← self-reference
app/api/engineering/bom-v2/route.ts        ← self-import of bom-v2-engine

$ grep -rln "bom-unified" --include="*.ts" --include="*.tsx" | grep -v "\.test\.\|node_modules\|\.next"
lib/bom-merge.ts                           ← only a type import
(plus a handful of comments in other files referencing logic PATTERNS, not imports)

$ grep -rln "bom-merge" --include="*.ts" --include="*.tsx" | grep -v "\.test\.\|node_modules\|\.next"
lib/bom-merge.ts                           ← self-reference
lib/bom-engine-v4.ts:813:                  ← COMMENT only
```

The live graph is simple:

```
app/engineering/page.tsx
   └→ /api/engineering/bom      (route)
         └→ lib/bom-engine-v4.ts                 ← the ONE live engine
               ├→ lib/bom-system-profiles.ts     ← live
               ├→ lib/ecoflow-bom.ts             ← live (only via bom route)
               ├→ lib/equipment-db.ts
               └→ lib/pricingEngine.ts + lib/companyPricing.ts
```

### Recommended Stage 8 action

**DELETE** the following files in a single atomic commit:

1. `lib/bom-engine.ts` (630 lines)
2. `lib/bom-v2-engine.ts` (597 lines)
3. `lib/bom-unified.ts` (684 lines) — after converting the 1 type import in `bom-merge.ts` to inline types
4. `lib/bom-merge.ts` (317 lines)
5. `app/api/engineering/bom-v2/route.ts` (orphan route)

### Risk

**LOW — effectively zero:**

- No production code imports any of these files.
- The only `bom-unified.ts` reference is a TypeScript type import in `bom-merge.ts` (which is itself dead) — trivially resolved by inlining the 2 type aliases (`BOMResult`, `BOMItem`) into `bom-merge.ts` before deletion, or by deleting both together.
- The comment references to `bom-unified.ts` in `bom-system-profiles.ts` are **documentation pointers** (lines 8, 134, 159, etc.) — they document *where the logic pattern came from*. These can be left alone (historical context) or rewritten to reference `bom-engine-v4.ts` directly.
- Tests: none of the dead files have corresponding `.test.ts` fixtures that would break.
- TypeScript: `tsc --noEmit` will pass unchanged — dead-file imports don't exist.

### Suggested Stage 8 scope (pure cleanup)

```
Stage 8.1 — BOM Dead-Code Deletion
• Delete 5 orphan files (-2,228 lines)
• Rewrite 5-10 comment pointers in bom-system-profiles.ts
• Verify: full test suite pass, npm run build pass, bom API smoke-tested
• Effort: 1-2 hours
• Risk: LOW
```

---

## Area 2 — Racking Database Duality ⚠️ **CONDITIONAL STAGE 8 CANDIDATE**

### Finding

**Two** racking databases coexist with significant overlap:

| File | Lines | Entries | Purpose | Consumers |
|---|---:|---:|---|---|
| `lib/racking-database.ts` | 819 | **14** | Structural engineering math (rail span, moment capacity, fastener shear/uplift) | `lib/structural-engine-v3.ts` (1 file) |
| `lib/mounting-hardware-db.ts` | 2,598 | **42** | UI picker, brand-profile `recommendedRackingBrands` resolution, BOM line-item generation, permit document generation, smoke suites | 8 files including `lib/structural-engine-v4.ts`, `resolveBrandEquipment.ts`, `bom-system-profiles.ts`, `permit/utils/canonical.ts`, `app/engineering/page.tsx`, `rackingEcosystemSmoke.helpers.ts` |

### ID overlap (direct collision)

Both files contain independently-maintained entries for the same physical products:

| ID | In `racking-database.ts` | In `mounting-hardware-db.ts` |
|---|:---:|:---:|
| `ironridge-xr100` | ✓ | ✓ |
| `ironridge-xr1000` | ✓ | ✓ |
| `unirac-solarmount` | ✓ | ✓ |
| `unirac-sme` | ✓ | ✓ |
| `rooftech-mini` | ✓ | ✓ |
| `snapnrack-100` | ✓ | ✓ |
| `quickmount-classic` | ✓ | ✓ |
| `quickmount-tile` | ✓ | ✓ |
| `s5-pvkit` | ✓ | ✓ |
| `k2-crossrail` | ✓ | ✓ |
| `ecofasten-rockit` | ✓ | ✓ |
| `dpw-powerrail` | ✓ | ✓ |
| `schletter-classic` | ✓ | ✓ |
| `esdec-flatfix` | ✓ | ✓ |

**14/14 rows in `racking-database.ts` have a counterpart in `mounting-hardware-db.ts`.** The smaller DB is a strict subset **by ID** but stores different fields (structural engineering numbers vs UI/BOM metadata).

### Why the duality exists (historical inference)

- `racking-database.ts` is older and purpose-built for structural calcs (`rail span`, `moment capacity`, `uplift per fastener`, ICC-ES ESR references).
- `mounting-hardware-db.ts` was built later for the ecosystem picker + BOM, adding UI-facing fields (images, descriptions, recommended brand pairings, part numbers).
- Engine v3 (`structural-engine-v3.ts`) was built against `racking-database.ts` and is still wired to `/api/engineering/structural-v2`.
- Engine v4 (`structural-engine-v4.ts`) was built later against `mounting-hardware-db.ts` and is wired to `/api/engineering/calculate`.

### Live routes both exist

```console
$ grep -rn "engineering/structural-v2\|engineering/calculate" --include="*.ts" --include="*.tsx" | grep -v test | grep "fetch"
app/engineering/page.tsx:2552:     fetch('/api/engineering/structural-v2', …)   ← LIVE (rules tab)
app/engineering/page.tsx:3545:     fetch('/api/engineering/structural-v2', …)   ← LIVE (structural tab)
app/engineering/page.tsx:2535:     fetch('/api/engineering/calculate', …)       ← LIVE (compliance tab)
```

**Both engines are called by the engineering page today.** Removing v3 would require porting the two `structural-v2` callers to `/api/engineering/calculate` or to a new `structural-v3` wrapper on top of engine v4.

### Recommended Stage 8 action (CONDITIONAL)

**Option A — Unify, retire v3 (HIGHER VALUE, HIGHER RISK):**
1. Add the missing structural fields (rail span, moment capacity, fastener capacities, ICC-ES references) to the 14 overlapping entries in `mounting-hardware-db.ts`.
2. Refactor `lib/structural-engine-v3.ts` to read from `mounting-hardware-db.ts` via a new adapter (same public API).
3. Verify parity against the existing 14-row fixtures.
4. Delete `lib/racking-database.ts`.
5. `/api/engineering/structural-v2` keeps working; its internals now use the unified DB.
6. Effort: 1-2 days. Requires regression testing of every rules-tab + structural-tab user flow.

**Option B — Status quo (LOWER RISK):**
1. Leave both DBs in place.
2. Add a CI test that enforces the **14 overlapping IDs must match on manufacturer + model + attachment-method** (prevents silent drift).
3. Document the boundary in a header comment in each file.
4. Effort: 2-3 hours. Zero behavioural risk.

**Option C — Strangler-fig (MEDIUM RISK, PROGRESSIVE):**
1. Do Option B first (drift fence).
2. Later, when touching structural-engine-v3 for a feature change, port the changed surface over to v4 one subsystem at a time.
3. Racking-database retires gradually rather than in one cut.

### Risk rating

**MEDIUM.** The 14-row DB powers active structural calcs on the `rules` and `structural` tabs of the engineering page. A regression in rail-span or fastener-capacity math could produce incorrect structural reports (a safety-critical output). Option A is the right endgame but should be behind a feature flag or parity-test gate.

### Stage 8 decision needed from you

- **Option A** (retire v3 + racking-database.ts)
- **Option B** (drift-fence CI test; defer consolidation)
- **Option C** (progressive strangler-fig)

My recommendation: **Option B** for Stage 8 (cheap, eliminates the drift risk without touching structural math), then Option C when organic feature work touches v3.

---

## Area 3 — `equipment-db.ts` vs `brandProfiles/*` Spec Duplication ⚠️ **DEFER**

### Finding

Each `BrandProfile.supportedInverterModels[]` entry duplicates 6 fields that
already exist in the canonical `STRING_INVERTERS` table in `equipment-db.ts`:

```ts
// lib/system/brandProfiles/types.ts — BrandInverterModelRef
interface BrandInverterModelRef {
  equipmentDbId: string;                    // pointer to equipment-db.ts
  acKw: number;                             // ← duplicated from acOutputKw
  dcKwMax: number;                          // ← duplicated from dcInputKwMax
  mpptCount: number;                        // ← duplicated from mpptChannels / numberOfMPPT
  minPanelsPerString?: number;              // ← duplicated from recommendedStringRange.min (loosely)
  maxPanelsPerString?: number;              // ← duplicated from recommendedStringRange.max (loosely)
  maxParallelStringsPerMppt?: number;       // ← duplicated from equipment-db
  modulesPerDevice?: number;                // ← new; micro-topology only
}
```

### Surface

- **15 brand profiles** × **avg 4 inverter SKUs per brand** = ~60 `BrandInverterModelRef` rows.
- Each row duplicates 6 fields → **~360 potential drift points**.
- The v47.425 brand-onboarding smoke suite (Stage 2 — Registry Integrity) catches *complete field absence* (registry resolution fails if `equipmentDbId` doesn't resolve) but does **NOT** catch *value drift* (e.g., if brand-profile `mpptCount: 2` but equipment-db `mpptChannels: 3`).

### Historical rationale (inferred)

- `BrandInverterModelRef` carries fields used by the **sizing engine** (`lib/system/sizingEngine.ts`) for tier selection. Keeping them on the profile made sizing decisions fast (no second table lookup).
- Some brand profiles use **sizing-specific** values that differ from datasheet values — e.g., `maxPanelsPerString` on a profile can intentionally be smaller than the datasheet ceiling to enforce a brand-recommended design.
- The v47.420 Growatt profile explicitly notes some of its `supportedInverterModels` values are *profile-declared* overrides, not datasheet copies.

### Recommended Stage 8 action

**DEFER.** Three reasons:

1. **Drift hasn't bitten us yet.** The 3 hotfixes in the v47.418-v47.430 window (slot-aware generator, MPPT-current-aware length, optimizer voltage-clamp bypass) were all *algorithmic* bugs, not value-drift bugs. No production regression has been traced to brand-profile vs equipment-db mismatch.

2. **Profiles intentionally deviate.** Converting to a pure-lookup model would force every brand to declare when it's intentionally overriding a datasheet value (e.g., a stricter `maxPanelsPerString` for a brand-enforced design standard), adding ceremony for what today is a simple single-value override.

3. **The v47.425 smoke suite gives us 80% of the protection already.** Every brand is validated at registry-resolution time. Adding a drift-fence test (equal-value assertion across the 6 duplicated fields per brand/SKU) is a much smaller investment than a full architectural refactor.

### Safer alternative: drift-fence CI test

In a future Stage 8.2 (or as part of Area 2 Option B), add a **CI-blocking test** that iterates every `BRAND_PROFILES[*].supportedInverterModels[*]`:

```ts
for each { equipmentDbId, acKw, dcKwMax, mpptCount, maxParallelStringsPerMppt } in profile:
  const dbEntry = STRING_INVERTERS.find(i => i.id === equipmentDbId);
  expect(dbEntry.acOutputKw).toBeCloseTo(acKw, 2);
  expect(dbEntry.dcInputKwMax).toBeCloseTo(dcKwMax, 2);
  expect(dbEntry.mpptChannels).toBe(mpptCount);
  expect(dbEntry.maxParallelStringsPerMppt).toBe(maxParallelStringsPerMppt);
```

- Test file: `lib/system/brandProfileDriftGuard.test.ts`
- ~60 asserts across all brands, expected runtime < 200 ms.
- Flags genuine drift without forcing a refactor.
- Allows intentional-override opt-out via an explicit `overridesEquipmentDb: true` flag on the brand-profile entry.
- Effort: 2-3 hours. Risk: LOW.

### Risk rating

**MEDIUM-HIGH for a full refactor** (touching 15 brand profiles × sizing engine call sites × possibly inverter auto-selection logic — the risk surface is large). **LOW for a drift-fence test**.

---

## Additional Observations (out-of-scope but worth logging)

### Legacy `structural-engine-v3` has 1 consumer tagged `/api/engineering/structural-v2`

Named "v2" but uses engine "v3" — suggests a prior refactor that renamed the engine without renaming the route. This is cosmetic drift; the safest time to rename the route is during Stage 8 Area 2 work.

### `lib/mounting-hardware-db.ts` has both `RoofType` (12-variant union) and `RoofTypeId` (via `racking-database.ts`, 9-variant union)

Different naming scheme (`asphalt_shingle` vs `shingle`) and different variant sets (`wood_shake`, `slate`, `any` exist only in mounting-hardware-db). If Area 2 Option A happens, this is the field-level migration to resolve.

### `lib/pricingEngine.ts` (464 lines) and `lib/companyPricing.ts` (85 lines) are healthy

No duplication, single consumer each, clean API. **No Stage-8 action recommended.**

### `lib/equipment-db.ts` is 3,518 lines

A candidate for **file-level splitting** (not logical consolidation) in a future stage — e.g., split into `equipment-db/string-inverters.ts`, `equipment-db/micro-inverters.ts`, `equipment-db/panels.ts`, `equipment-db/batteries.ts`, `equipment-db/racking.ts`. This is an editorial improvement, not a correctness issue. **Out of Stage 8 scope.**

---

## Recommended Stage 8 Scope

Based on the full audit, I recommend **Stage 8** be scoped to the **LOWEST-RISK, HIGHEST-HYGIENE action**:

### Stage 8.1 — BOM Dead-Code Deletion (Area 1)

- Delete `lib/bom-engine.ts`, `lib/bom-v2-engine.ts`, `lib/bom-unified.ts`, `lib/bom-merge.ts`, `app/api/engineering/bom-v2/route.ts`
- Rewrite ~10 comment pointers in `lib/bom-system-profiles.ts` to reference `bom-engine-v4.ts`
- Verify: 1808+/1808+ tests pass, `npm run build` clean, engineering page BOM tab renders correctly
- **Effort:** 1-2 hours
- **Risk:** LOW
- **Value:** -2,228 lines, zero ambiguity about which BOM engine is canonical

### Stage 8.2 — Drift-Fence CI Tests (Areas 2 + 3 hybrid)

- `lib/system/rackingDatabaseDriftGuard.test.ts` — 14 IDs × 3 fields (manufacturer, model, attachment method) must match across `racking-database.ts` and `mounting-hardware-db.ts`
- `lib/system/brandProfileDriftGuard.test.ts` — ~60 brand/SKU pairs × 4 fields (acKw, dcKwMax, mpptCount, maxParallelStringsPerMppt) must match `STRING_INVERTERS` entries unless flagged `overridesEquipmentDb: true`
- **Effort:** 2-3 hours
- **Risk:** LOW (adds tests only)
- **Value:** Eliminates silent drift risk without architectural change

### Stage 8.3 — (DEFERRED) Racking Database Unification — Option C (Strangler-Fig)

- Do opportunistically when organic feature work touches `structural-engine-v3`
- Track as a separate roadmap milestone

### Stage 8.4 — (DEFERRED) Brand-Profile Spec Centralization

- Revisit only if drift-fence tests from Stage 8.2 start flagging real regressions in practice
- Track as a separate roadmap milestone

### What to SKIP

- `lib/equipment-db.ts` file-split — editorial, not correctness
- `lib/pricingEngine.ts` / `lib/companyPricing.ts` — healthy, no action needed
- Immediate retirement of `structural-engine-v3` — too much UI surface hits `structural-v2` today

---

## Stage 7 Exit Criteria

Per the roadmap:

> *"Exit criteria: You get a written recommendation. We choose what Stage 8 actually does."*

**This document is the written recommendation.** The user chooses which of Stage 8.1 / 8.2 / 8.3 / 8.4 to execute in Stage 8.

**My recommendation:** Execute **Stage 8.1 + Stage 8.2** in a single v47.432 release. Defer 8.3 and 8.4.

---

## Appendix — File Sizes at Stage 7 Snapshot

```
  2598 lib/mounting-hardware-db.ts    ← KEEP (live, 42 rows)
   819 lib/racking-database.ts        ← Area 2 target
  3518 lib/equipment-db.ts            ← KEEP (canonical, editorial split only)

   989 lib/bom-engine-v4.ts           ← KEEP (the live BOM engine)
   630 lib/bom-engine.ts              ← DELETE (dead)
   597 lib/bom-v2-engine.ts           ← DELETE (dead)
   684 lib/bom-unified.ts             ← DELETE (dead)
   317 lib/bom-merge.ts               ← DELETE (dead)
   570 lib/bom-system-profiles.ts     ← KEEP (live, rewrite comments only)
   176 lib/ecoflow-bom.ts             ← KEEP (live)

   464 lib/pricingEngine.ts           ← KEEP (healthy)
    85 lib/companyPricing.ts          ← KEEP (healthy)
```

**Dead-code total:** 2,228 lines across 4 `lib/` files + 1 API route.
**Savings if Stage 8.1 executes:** ~2,228 lines removed, 1 API route retired.

---

**Document prepared:** 2026-04-22
**Build:** v47.431
**Next action:** User decides Stage 8 scope.