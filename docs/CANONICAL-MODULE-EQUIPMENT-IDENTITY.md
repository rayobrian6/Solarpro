# CANONICAL MODULE EQUIPMENT IDENTITY — CLOSURE

**Branch:** `dev` · **Base:** `1b959295`

> **Which single function/object must every future subsystem use to obtain the
> selected module identity?**
>
> **`resolveModuleIdentity(source)`** in `lib/equipment/moduleIdentity.ts`,
> returning a `CanonicalModuleIdentity`. Use the shape-specific wrappers where
> they fit — `resolveStringModuleIdentity(string)`,
> `resolveSubsystemModuleIdentity(entry)`, `resolveFleetModuleIdentities(system)`
> — all of which are thin adapters over the same function. There is no second
> answer, and no consumer may re-derive identity from a model string.

---

## 1 · The rule

`panelId` — the stable catalogue id — **is** the module identity. `manufacturer`,
`model` and `watts` are **projections** of it, read off the catalogue row. They
are never independent identity authorities.

Three states, and no fourth:

| state | meaning |
|---|---|
| `CANONICAL` | a stable `panelId` is present and resolves. Authoritative. |
| `LEGACY_DERIVED` | no `panelId`, but the persisted attributes produce exactly **one deterministic exact** catalogue match. Authoritative, and `repinnable` for the existing self-heal. |
| `NOT_ESTABLISHED` | ambiguous, partial, substring or fuzzy. **Fail closed.** |

---

## 2 · What was wrong

`applyCanonicalEquipmentToInput` re-pins the canonical selection onto every
string, so a single source of truth existed. Two things defeated it:

**(a) The id was undeclared on the type** (fixed in `1b959295`), so ~26 consumers
identified the module by its model string and re-derived the catalogue row with
two-way substring matching. **Four independent copies** of the same matcher
existed —

```ts
list.find(e => e.model.includes(m) || m.includes(e.model))
```

— one of them inside `PRODUCTION_EQUIPMENT_CATALOG.byModel`, i.e. **inside the
canonical picker's own catalogue**, underneath the whole tier lattice. "REC 400"
resolved to "REC 400AA Pure-R". In the BOM that is ordered hardware.

**(b) The re-pin was not unconditional — and my previous commit said it was.**
`applyCanonicalEquipmentToInput` has exactly two call sites
(`resolvers.ts:582`, `:683`), **both inside divergent branches**. The ordinary
no-divergence branch (`:520-534`), `SKIPPED` and `OPERATIONAL_CONFIRMATION` all
return without re-pinning. So on most real projects `panelId` was written only if
the posted body already carried it. Every conversion would have failed closed on
the normal path. That comment has been corrected in place.

---

## 3 · The architecture

`lib/equipment/moduleIdentity.ts` — deliberately outside `lib/permit` so CAD,
computed-system and the BOM engines can consume it without depending on the
permit layer.

- **`resolveModuleIdentity`** — the one accessor. Pure, total.
- **`materialiseModuleIdentity`** — the boundary. Resolves and writes
  `panelId` + the projected attributes onto every fleet string, **unconditionally
  and idempotently**, closing gap (b). Reports `changed`, `bridged` (eligible for
  the existing reconciliation/self-heal persistence) and `refused`. It writes only
  to the in-memory input; this module never touches a database.
- **`searchModulesForDisplay`** — the *only* place approximate matching survives.
  It returns **many** candidates precisely so nothing can mistake it for a
  resolution, and a guard asserts no authority path imports it.

### The legacy bridge (one place, fail-closed)

1. **Stable id present** → `CANONICAL`. A *dangling* id is a hard failure — the
   model text is deliberately **not** consulted as a substitute, because a
   catalogue/record disagreement is exactly when guessing is most dangerous.
2. **No id** → exactly one path: a unique deterministic **exact** match. Every
   supplied attribute must match exactly; a disagreeing manufacturer or wattage
   *eliminates* a candidate rather than being ignored. An exact catalogue **id**
   sitting in the model field is admitted as a stable clue (older bodies persist
   it there; `generatePermit` has long called `getPanelById(str.panelModel)`).
3. **0 or >1 candidates** → `NOT_ESTABLISHED`, with the reason named.

Normalisation is case + surrounding space + internal run-length only. No token
dropping, no punctuation stripping, no prefix logic.

---

## 4 · Sites converted

| file | was | now |
|---|---|---|
| `resolution/equipmentSelection.ts` | `byModel` two-way substring — **inside the canonical picker** | delegates to `resolveModuleIdentity` |
| `resolution/resolvers.ts` | model-string keying + a false "already re-pinned" premise | `materialiseModuleIdentity` + `resolveFleetModuleIdentities` |
| `snapshot/equipmentProjection.ts` | `fuzzPanel`, `fuzzMicro` | accessor / exact-only |
| `snapshot/build.ts` | `fuzz` | exact-only |
| `sections/datasheetAppendix.ts` | `fuzz` | exact-only |
| `sections/compliancePages.ts` | 4 sites (incl. cold-Voc β) | accessor / exact-only |
| `utils/fieldLabels.ts`, `utils/panelSpecs.ts`, `utils/sldAdapter.ts` | substring | accessor |
| `utils/bomForPermit.ts` | `resolveRegistryEntry` substring for the **panel** row; `resolvePanelIdFromNames` sweep | identity-resolved |
| `equipment/specSheets.ts` | 4 finders, OR of four substring tests (an empty model matched everything) | exact-only |

---

## 5 · The proofs

`tests/planset/cmei-canonical-module-identity.test.ts` — **22 tests**.

| # | proof | test |
|---|---|---|
| 1 | `panelId` wins over conflicting model text | 1, 1b |
| 2 | canonical conflict detection still works | full suite: `aac-ws2` 53/53 |
| 3 | exact unique legacy identity resolves through the one bridge | 3, 3b |
| 4 | ambiguous legacy model fails closed | 4 |
| 5 | substring-only cannot establish identity | 5, 5b, 5c |
| 6 | BOM/CAD/CMDA/snapshot/renderer share one identity | 6 |
| 7 | changing `panelId` propagates without rematching | 7 |
| 8 | no consumer can substitute a fuzzy registry match | 8 |
| 9 | old posted bodies remain readable | 9, 9b |
| 10 | reconciliation/self-heal intact | full suite + `repinnable` |

Plus the **architectural guard**: scans every source under `lib/permit`,
`lib/cad`, `lib/drafting`, `lib/equipment`, `lib/system` for the construction,
classifies each hit as module vs non-module from its surrounding context, fails
on any module hit, and **pins** the non-module residue so the debt cannot grow.
An anti-vacuity case proves the detector catches the real shipped form.

---

## 6 · Scope boundary — what was deliberately NOT done

**Inverters and accessories keep the substring tiers in
`bomForPermit.resolveRegistryEntry`.** Removing them blind broke **37 tests**
across procurement, grounding, BOM reconciliation and sheet pagination — i.e. it
silently changed *which hardware is ordered* and *how many sheets print*. Those
are their own identity domains (`inverterId`, accessory SKUs) with no canonical
accessor yet. The module call site no longer reaches that function; the residue
is pinned by the guard and named as a follow-up.

**CAD geometry defaults were not touched.** The audit found `roofCAD.ts:78-79`
(and the ground/fence equivalents) take panel dimensions from
`project.panelLengthIn ?? 66in` / `panelWidthIn ?? 40in` — **every design is
drawn at 66×40**, with no `panelId` involvement. Fixing it is correct and is the
single largest remaining item, but it changes array fill, setback encroachment,
row pitch and therefore **panel counts on some roofs**, and re-baselines every
persisted `exportHash`. Ray judges plansets visually and has a standing rule that
design panels are never silently rearranged, so this needs an explicit decision
and a before/after on the real planset — not a side effect of an identity phase.

---

## 6b · Adversarial review

A 4-lens review (contract, fail-closed, regression, guard) produced **26
candidate findings**; each was then handed to an independent agent instructed to
**refute** it. **2 survived refutation**, both real, both fixed with a regression
test naming them:

1. **Identity from manufacturer alone.** The candidate filter degraded to `true`
   when no model was supplied, so a brand with exactly one catalogue row resolved
   from the brand name — making `watts` an independent identity authority. In the
   production catalogue **9 of 17 manufacturers are single-row**, so this was the
   common case, and it violated monotonicity: *deleting* the model upgraded a
   refusal into a pinned SKU. A model is now mandatory for the bridge.
2. **The `'—'` blank marker matched as a real manufacturer.** `ResolvedEquipment`
   prints `'—'` for an absent field and hands that record straight to the
   accessor, so every candidate was eliminated and a per-subsystem BOM panel line
   vanished — a refusal caused by a placeholder glyph rather than by ambiguity.
   Blank markers are now treated as absence.

Three further findings were caught and fixed **before** the review completed: the
id-in-model clue ignoring contradicting attributes, `build.ts` leaving
`catalogId: null` and firing a **false permit-blocking**
`EQUIPMENT-IDENTITY-CONFLICT`, and the guard's laundering gap.

`generatePermit.ts` — which passed a **model string into an id lookup**, then
slugified it and retried, then fell through to hardcoded temperature
coefficients for the server-side electrical calculation — was also converted.

---

## 7 · Verification

| gate | result |
|---|---|
| new targeted tests | **22 / 22 pass** |
| full suite | **444 files, 10015 tests pass**, 17 files / 490 skipped, **0 failed**, exit 0 |
| `npx tsc --noEmit` | **exit 0** |
| production build | **exit 0** |

---

## 8 · Remaining risks

1. **Exact-only matching can now MISS where substring used to hit.** That is the
   point, but it means a sheet or datasheet page can degrade to "not established"
   for a body whose model text does not exactly match the catalogue. The suite is
   green and the live Braidon model matches exactly; other stored projects may
   differ. `materialiseModuleIdentity`'s `refused[]` is the diagnostic.
2. **`materialiseModuleIdentity` mutates the input** (as `applyCanonicalEquipmentToInput`
   already did). It writes catalogue-projected attributes, so a body whose posted
   `panelWatts` disagreed with its catalogue row will now carry the catalogue
   value — and the digest moves once for those projects. Posted Voc/Isc are
   treated as observations and never overwritten.
3. **Non-module identity is still substring-matched** (§6), pinned at 2 sites.
4. **CAD geometry is still 66×40 for every design** (§6) — the largest open item.
5. **The PURE build does not materialise identity.** `materialiseModuleIdentity`
   runs at the resolver boundary, so on the pure-build path a stale model string
   still reaches labels and therefore the digest, even with `panelId` pinned. The
   identity itself is unaffected — asserted in `snapshot-w3-structural`. Moving
   materialisation into the pure build would make it non-pure and is a separate call.
6. **`resolveFleetModuleIdentities` keys unresolved strings by model text**
   (`unresolved:<model>`), so two different unidentifiable modules with the same
   text collapse to one entry. Intentional — they are indistinguishable — but it
   means the count of *distinct unknown* modules is a lower bound.
