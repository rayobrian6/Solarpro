# ELECTRICAL AUTHORITY TABLE — one writable owner per semantic fact

Ray's RULE ONE: *"I do not care how many physical stores ultimately remain. I care that each
semantic fact has exactly one writable owner. If two current stores can both write the same semantic
fact, the architecture is still wrong."*

> 🚨 **This document is a CLAIM, not an observation.** It is transcribed from a verified audit on
> 2026-10-02. The runtime answer for a given project is
> `GET /api/dev/electrical-state?projectId=…`, which computes `mirrorsThatCouldWin` from the raw
> columns. **Where the two disagree, the endpoint is right and this file is stale.** A document that
> cannot be wrong at runtime can only be out of date, silently — which is how three competing stores
> got here in the first place.

Status key — **OWNED**: one writable owner, mirrors provably disarmed · **CONTESTED**: a second
store can still write it · **OPEN**: not yet collapsed.

| # | Fact | ONE writable owner | Legacy mirrors | Current production readers | Status |
|---|---|---|---|---|---|
| 1 | **PV architecture / solarCoupling** | `projects.service_topology → topology.solarCoupling`, writable by the service-topology PUT (records `provenance.architecture`) and by the architecture-resolution endpoint | `engineering_config.inverters` (a fleet implies an architecture); `selected_equipment.inverter` | SLD, SLD-PDF, BOM, permit, calculate, engineering page — all via `loadElectricalProject` | **OWNED** |
| 2 | **External inverter identity** | `projects.selected_equipment.inverter` + `.inverterId` | `engineering_config.inverters[].inverterId`; `engineering_runs.config_snapshot` | canonical model only | **CONTESTED** — see note A |
| 3 | **External inverter quantity** | `engineering_config.inverters[]` length | `selected_equipment.inverter.quantity` | sizing / BOM | **OPEN** |
| 4 | **Battery model** | `projects.service_topology → storage[].productId` | `selected_equipment.batteries[0].id` | canonical model | **CONTESTED** |
| 5 | **Battery quantity** | `service_topology → storage[]` instance count | `selected_equipment.batteryCount` | canonical model (raises a conflict on disagreement, never averages) | **OWNED** |
| 6 | **Gateway quantity** | `service_topology → domains[].gateway` | — | canonical model | **OWNED** |
| 7 | **Generation panel quantity** | `service_topology → aggregationPanels[]` with `domainId` | — | canonical model | **OWNED** |
| 8 | **Service rating** | `service_topology → service.ratedAmps` — **the graph, and nothing else** | `engineering_config.mainPanelAmps`; `engineering_runs.main_panel_rating` | SLD / BOM / PDF project the graph over the posted scalar; the engineering page now displays and computes from the graph | **CONTESTED** — see note B |
| 9 | **MSP quantity** | `service_topology → service.panels[]` | — | canonical model | **OWNED** |
| 10 | **Interconnection method** | `service_topology → pointsOfInterconnection[]`, projected by `interconnectionMethodScalar` | `engineering_config.interconnectionMethod` (`DEFAULT_CONFIG` asserts `'LOAD_SIDE'`); `preliminary` route hardcodes it | SLD / BOM; **the permit route does not project it** | **OPEN** — see note C |
| 11 | **Utility isolation arrangement** | `service_topology → interconnection.externalDerIsolationRequired` + the disconnect roles | — | canonical model | **OWNED** |
| 12 | **PW3 → panel assignment** | `service_topology → aggregationPanels[].inputs[]` and `domains[].storageUnitIds` | — | canonical model | **OWNED** |
| 13 | **PV string assignment** | `engineering_config.inverters[].strings[]` (the committed layout) | `computeSystem` re-derives an even division when that is absent; `string-generator` packs its own | SLD (now carries the whole `stringPanelCounts` array), calculate | **CONTESTED** — see note D |

## Notes — what is NOT yet collapsed, stated plainly

**A. External inverter identity has three key spellings.** `selected_equipment` holds
`inverter.id`, `inverterId` and (on some rows) a nested `inverter` object, with disjoint writer sets:
the Design Studio equipment route, the engineering save-config reconcile, and the production route.
The canonical model reads `inverter?.id ?? inverterId`. **Collapse step:** one writer, one spelling,
and a migration that folds the others.

**B. The service rating's real competitor was invisible until this audit.**
`engineering_config.serviceRatedAmpsOverride` was read by the model, declared in its interface, and
**written by nothing** — no route, no page, no migration, no seed. The authority inspector and the
re-audit document both advertised it as the way `engineering_config` could outrank the graph, and it
could not be reached. It is now **deleted**, and the store that actually competes — the
`mainPanelAmps` scalar the engineer's own control edits — is named here and reported by
`mirrorsThatCouldWin` when it disagrees. **Still open:** the control writes
`engineering_config.mainPanelAmps` rather than the graph. If an override is ever wanted it is a
DECISION and must carry a recorded provenance, exactly as the coupling now does.

**C. Interconnection method is still inferred in three places.** `DEFAULT_CONFIG` asserts
`'LOAD_SIDE'` as initial React state; `app/api/engineering/preliminary/route.ts` hardcodes
`MICROINVERTER` + `LOAD_SIDE` and **persists** them; the permit route loads the canonical model but
never projects `interconnectionMethodScalar`, so the sealed package can state a method the graph does
not. **Not fixed in this pass.**

**D. `maxPanelsPerString` is a constraint, not an assignment.** `string-generator` packs 37 modules
as `[9,9,9,8,2]` — correct — but `(totalStrings, panelsPerString, lastStringPanels)` cannot encode a
non-uniform layout, and three call sites collapse `strings[]` to first + last. The SLD now carries the
whole array and prints the real lengths; `computeSystem` still derives its own even division when no
committed layout is supplied, so the same project can report 7 or 9 panels per string depending on
which engine answered.

## The rule this table exists to enforce

> A projection may be regenerated. **A projection may never repair, fill or override its owner.**

The 2026-10-02 failure was exactly that violation: `persistElectricalCanonicalization` wrote a
*derived* coupling into the owner's slot, and from then on it was indistinguishable from a designer's
decision. The model now re-tests a recorded value that carries no recorded decision, and every write
path that represents a human records one.
