# The legacy service scalars: who still reads them, and what each one is now

**Status: classification, not a migration. Nothing was removed.**

Ray's instruction:

> "Audit remaining consumers of `mainPanelAmps` / `mainPanelBusAmps` / `mainBreakerAmps` /
> `batteryCount`. They may temporarily remain for legacy compatibility, but **they cannot remain
> independent engineering authorities.** Each remaining consumer must be classified as
> `DERIVED COMPATIBILITY PROJECTION` or `MUST MIGRATE TO ServiceTopology`. Do not perform another
> huge discovery sweep; this is a bounded grep/consumer migration around the known fields."

So this is the bounded grep, classified. It is a ledger to work from, not a claim that the work is
done.

## The rule these four fields now live under

`ServiceTopology` is the authority for the service, its branches, its panels, its backup domains and
its storage. Where one of these scalars survives it is either:

- **DERIVED COMPATIBILITY PROJECTION** — it may be *read* by a legacy surface, and when a topology
  exists its value must be *derived from* the topology's primary panel (or its storage), never
  entered independently. A projection that can disagree is not a projection.
- **MUST MIGRATE TO ServiceTopology** — it is making an engineering decision the scalar cannot
  carry, and it will be wrong on any job with more than one service branch, more than one panel,
  more than one gateway, or storage that includes a DC expansion.

## `mainPanelAmps` / `mainPanelBusAmps` / `mainBreakerAmps`

| Consumer | Class | Why |
|---|---|---|
| `lib/nec/rule705_12.ts` (via `maxLoadSideBackfeedA`) | **DERIVED PROJECTION** | Already takes bus + main as arguments. `serviceTopology` calls it per panel. Nothing to migrate — this is the canonical calculator and it is correctly parameterised. |
| `lib/engineering/types.ts` (`ElectricalEngineering`) | **MUST MIGRATE** | The three scalars are declared here. They are the shape everything else copies. |
| `lib/electrical-calc.ts` | **MUST MIGRATE** | Performs the busbar decision from one panel. On a two-MSP job it answers about one of them and does not know the other exists. |
| `lib/computed-system.ts`, `lib/computed-multi-system.ts`, `lib/computed-plan.ts` | **MUST MIGRATE** | The computed model's single service. This is the largest consumer and the real migration. |
| `lib/permit/types.ts` (`PermitInput.project.mainPanelAmps`) | **DERIVED PROJECTION** | Required by the type, so it stays. `PermitInput.project.serviceTopology` is now beside it and the equipment schedule reads the graph. When a topology is present this field is the primary panel's rating. |
| `lib/permit/sections/coverSheet.ts`, `compliancePages.ts`, `sitePlan.ts` | **DERIVED PROJECTION** | They print a service rating on a sheet. Correct for a single-service job; on a multi-branch job they must print the aggregate and the branches — follow-up. |
| `lib/permit/utils/sldAdapter.ts`, `computedRuns.ts`, `bomForPermit.ts` | **MUST MIGRATE** | These build the drawing and the runs from the single service. `lib/sld/serviceTopologyGraph.ts` is the replacement for the service part of the drawing. |
| `lib/permit/snapshot/build.ts` | **MUST MIGRATE** | The snapshot is the immutable record of what was released. It must carry the topology, or a released package cannot prove which of two MSPs it was about. |
| `lib/engineering/reportGenerator.ts`, `artifactBuilders.ts` | **MUST MIGRATE** | The engineering report's service section. |
| `lib/segment-model.ts`, `lib/segment-builder.ts`, `lib/equipment-extras.ts` | **DERIVED PROJECTION** | They size a conductor against the main breaker they were handed. Correct per branch; they need the branch's number rather than the site's. |
| `lib/system/electricalFromSurvey.ts`, `lib/survey/ingest/transformLayer.ts` | **DERIVED PROJECTION** | A survey records what the surveyor saw at one panel. That is an observation, and observations are inputs to the topology, not a competing authority. |
| `lib/plan-set/permit-system-model.ts` | **MUST MIGRATE** | Builds the permit's system model. |
| `components/engineering/EngineeringTab.tsx`, `app/api/engineering/sld/route.ts` | **MUST MIGRATE** | UI + SLD route. The new `ServiceTopologyPanel` is the replacement surface. |
| `lib/engineeringDecisionProvenance/*` | **DERIVED PROJECTION** | Records which fields a decision depended on. It should record the topology too — additive. |
| `lib/engineering-golden-tests.ts`, `lib/engineering-helpers.ts` | **DERIVED PROJECTION** | Fixtures and helpers around the legacy shape. |

## `batteryCount`

🚨 **This is the field that produces a wrong number, not just an incomplete one.**

On Ray's job the graph holds two Powerwall 3 and two Powerwall 3 Expansion. `batteryCount = 4` fed
to `resolveBatteryBranch` resolves four *inverting* units: four backfeed breakers, twice the AC
contribution, and 54 kWh attributed to four Powerwalls rather than two plus two expansions.

| Consumer | Class | Why |
|---|---|---|
| `lib/equipment-db.ts` `resolveBatteryBranch(id, unitCount)` | **MUST MIGRATE** | Takes one product and one count. It cannot express a fleet with two roles. The replacement input is `acSourcesFromTopology` + `summariseStorage`. |
| `lib/nec/loadSideBackfeed.ts` | **MUST MIGRATE** | Reads `resolveBatteryBranch(...).busbarContributionA`. On a two-domain job each panel sees only its own domain's contribution — the graph knows that and the scalar cannot. |
| `lib/bom-engine-v4.ts` | **MUST MIGRATE** | Buys batteries by count. `lib/bom/topologyBom.ts` is the replacement for the topology's instances. |
| `lib/computed-system.ts`, `lib/electrical-calc.ts` | **MUST MIGRATE** | Same doubled-contribution exposure. |
| `lib/db/core.ts`, `lib/db/production.ts` | **DERIVED PROJECTION** | Persistence of the legacy field. `projects.service_topology` is the durable graph; these stay until every reader has moved. |
| `lib/permit/*` (`generatePermit`, `coverSheet`, `sitePlan`, `snapshot/*`) | **DERIVED PROJECTION → MIGRATE** | They print and snapshot a battery count. Correct for a fleet of identical inverting units; wrong the moment an expansion is in it. The equipment schedule already reads the graph. |
| `lib/engineering/designSnapshot.ts`, `reportGenerator.ts` | **MUST MIGRATE** | |
| `lib/ecoflow-bom.ts` | **DERIVED PROJECTION** | Brand-specific, no expansion product in that ecosystem today. Re-check if one appears. |
| `lib/db/serviceTopology.ts` | *(not a consumer)* | It mentions the field only to explain why the topology is **not** stored in `selected_equipment`. |

## Order of migration

1. **`batteryCount` → `acSourcesFromTopology` in the busbar path** (`loadSideBackfeed`,
   `computed-system`). This is the one that is *wrong*, not merely narrow.
2. **`computed-system` / `computed-plan`** — the single service. Everything on the sheet flows from
   here.
3. **`permit/snapshot/build.ts`** — a released package must carry the graph it was released against.
4. **`sldAdapter` / `computedRuns`** — the drawing's service half, now that
   `lib/sld/serviceTopologyGraph.ts` exists.
5. The printing surfaces (cover sheet, site plan, compliance) — aggregate + branches instead of one
   number.

Nothing in this list is scheduled here. It is the ledger the next slices work from.
