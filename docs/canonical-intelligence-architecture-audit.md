# SolarPro Canonical Intelligence Architecture Audit + Expansion Proposal

**Scope:** Architecture audit only. No implementation approval assumed.  
**Branch inspected:** `dev`  
**Directive:** Extend canonical infrastructure. Do not create duplicate systems or new sources of truth.

---

## 1. Existing Systems Map

SolarPro already has several mature canonical domains. The next intelligence layer must orchestrate across these domains rather than create replacements.

### Core Project + Engineering System

The project system is anchored by `projects`, `clients`, `layouts`, `project_versions`, and `productions` from `lib/migrations/001_initial_schema.sql`. The richer operational lifecycle is centered on `projects.project_status`, not the legacy `projects.status`. The canonical project pipeline is defined in `lib/operations/pipeline.ts` as:

`lead → site_assessment → design_complete → proposal_sent → contract_signed → engineering → permit_submitted → permit_approved → install_scheduled → installation → inspection → pto → complete`

Supporting lifecycle/operations systems include `project_tasks`, `project_milestones`, `project_activity`, `command_center_actions`, crew/schedule infrastructure, homeowner stage synchronization, and deal transition logic in `lib/deals/transitions.ts`. This is the canonical project lifecycle; no new project lifecycle should be created.

### Opportunity + Marketplace System

The marketplace/opportunity system has two layers. `opportunities` is the older/shareable opportunity object used for contractor-shared or source-stage opportunities. `network_opportunities` is the canonical enriched marketplace opportunity object. It is explicitly described as the canonical Network Intelligence OS opportunity object and is source-agnostic across contractor-shared, homeowner-direct, Google Ads, Meta, TikTok, SEO, referral, and partner sources.

Supporting tables include `opportunity_claims`, `opportunity_sources`, `opportunity_screening_queue`, `opportunity_intelligence`, `opportunity_assignments`, `campaign_analytics`, `network_events`, `intake_events`, `enrichment_queue`, `webhook_ingestion_log`, `intake_funnels`, and `acquisition_campaigns`.

### Intake + Webhook System

The intake system already includes canonical pipeline code under `lib/intake`: `intakePipeline.ts`, `intakeValidator.ts`, `duplicateDetector.ts`, `enrichmentQueue.ts`, and `webhookVerifier.ts`. Public intake routes already exist for canonical and webhook-specific intake: `/api/intake`, `/api/intake/webhook/generic`, `/api/intake/webhook/google`, and `/api/intake/webhook/meta`. These should remain the entry points for acquisition and partner lead ingestion.

### Enrichment System

The enrichment engine exists under `lib/enrichment`: `enrichmentOrchestrator.ts`, `propertyEnricher.ts`, `solarEnricher.ts`, and `utilityEnricher.ts`. The canonical queue table is `enrichment_queue`, with provider statuses for property, solar, utility, AHJ, demographics, and satellite. This is the canonical enrichment orchestration layer for opportunities.

### Utility Intelligence System

There is already a substantial utility architecture. `lib/utilityNormalizer.ts` defines `CanonicalUtility` and `CANONICAL_UTILITIES`, including canonical IDs, names, states, average rates, NEM flags, and TOU flags. `lib/utilityMatcher.ts` performs DB-backed and fuzzy utility matching against `utility_policies`, with fallback and auto-discovery behavior. Related systems include `utilityDetector.ts`, `utilityPrograms.ts`, `utilityInterconnection.ts`, `lib/proposal/utilityTruthEngine.ts`, and `lib/incentives/incentiveEngine.ts`. The DB-backed policy layer includes `utility_policies` and `incentive_overrides` from the inline migration route. No new `utility_v2`, `utility_master`, `utility_profiles`, or parallel utility scoring table should be created.

### AHJ + Jurisdiction System

AHJ intelligence exists in `lib/jurisdictions/ahj.ts`, `lib/jurisdictions/ahj-national.ts`, and `lib/jurisdictions/ahjOverlays.ts`. Existing AHJ outputs are also embedded into opportunity intelligence through `ahj_name`, `ahj_complexity_score`, and `ahj_notes`, and into engineering/permit workflows through permit generation modules. AHJ intelligence should be extended through canonical observations and enrichment outputs, not a separate jurisdiction platform.

### Contractor System

The canonical contractor identity is `users`, with contractor-specific intelligence in `contractor_profiles`. Matching logic exists in `lib/network/contractorMatcher.ts`, using geographic coverage, size fit, services, performance, and capacity. Assignment/claim outcomes live in `opportunity_assignments` and `opportunity_claims`. Future contractor intelligence should update or observe `contractor_profiles` and assignment history, not create a parallel contractor registry.

### Homeowner System

Homeowners are primarily represented through `clients`, portal OTP/session infrastructure, homeowner portal routes, and project homeowner stages. Opportunity intake also stores homeowner-derived fields on `network_opportunities`. Behavioral intelligence should attach to `clients`, `projects`, `network_opportunities`, `intake_events`, and event logs, not create a separate CRM-style homeowner database.

---

## 2. Existing Sources of Truth

| Domain | Canonical source of truth | Notes |
|---|---|---|
| Project | `projects` + `projects.project_status` | `status` is legacy 5-stage compatibility. `project_status` is canonical operational lifecycle. |
| Project lifecycle definitions | `lib/operations/pipeline.ts`, `lib/deals/transitions.ts` | Defines valid stages and transition decision model. |
| Client/homeowner | `clients` | Portal stages and homeowner-facing projections derive from project/client state. |
| User/contractor identity | `users` | Base identity and auth object. |
| Contractor capability intelligence | `contractor_profiles` | Extend this and derive from `opportunity_assignments`, projects, and outcomes. |
| Marketplace opportunity | `network_opportunities` | Canonical enriched marketplace object. |
| Source/shared opportunity | `opportunities` | Feeder/source object, not the final canonical intelligence object. |
| Opportunity score | `opportunity_intelligence` | Explainable score breakdown and score history. |
| Opportunity lifecycle/event audit | `network_events` | Append-only Network Intelligence event log. |
| Intake lifecycle events | `intake_events` | Immutable intake-specific event log. Should propagate selected events into `network_events`. |
| Webhook audit | `webhook_ingestion_log` | Raw webhook receipt, replay, verification, idempotency. |
| Enrichment queue | `enrichment_queue` | Canonical queue for opportunity enrichment providers. |
| Utility canonical registry | `lib/utilityNormalizer.ts` + `utility_policies` | In-memory canonical IDs plus DB-backed policy/matching layer. |
| Incentives | `lib/incentives/*`, `incentive_overrides`, state datasets | Extend these, do not duplicate. |
| AHJ | `lib/jurisdictions/*` + project/opportunity AHJ fields | AHJ outputs should attach to project/opportunity intelligence. |
| Campaign attribution | `acquisition_campaigns`, `campaign_analytics`, UTM columns | Already established. |

---

## 3. Existing Lifecycle Flows

### Opportunity Lifecycle

Canonical opportunity lifecycle is on `network_opportunities.status`:

`intake → screening → enriching → scored → routed → live → claimed → closed_won / closed_lost / expired / rejected / withdrawn`

Supporting sub-lifecycles exist as subordinate state machines:

- `screening_status`: `pending`, `in_review`, `approved`, `rejected`, `escalated`
- `enrichment_status`: `pending`, `processing`, etc.
- `opportunity_assignments.status`: offered/claimed/contacted/appointment/proposal/won/lost-like states
- `opportunity_claims.status`: pending/active/closed/released/expired

These are not separate opportunity lifecycles. They are subordinate dimensions of the one canonical opportunity lifecycle.

### Project Lifecycle

Canonical project lifecycle is `projects.project_status`, defined in `lib/operations/pipeline.ts`. Legacy `projects.status` maps to broader buckets: lead/design/proposal/approved/installed. Homeowner-facing portal stages are projections of project lifecycle, not independent lifecycle authority.

### Intake Flow

Webhook/raw intake → `webhook_ingestion_log` → validation/normalization/dedup in `lib/intake` → `network_opportunities` row → `intake_events` → `enrichment_queue` → enrichment/scoring/routing. This is canonical and should be preserved.

### Engineering/Design Flow

Projects flow through layout, production, survey, BOM, permit, structural, SLD, and AHJ-aware engineering modules. These outputs attach to `projects`, `layouts`, `productions`, project files, permit systems, and project physical data. Intelligence should observe these systems rather than fork them.

---

## 4. Existing Queue/Orchestration Systems

1. `enrichment_queue`: canonical queue for opportunity enrichment providers.
2. `opportunity_screening_queue`: step-by-step screening pipeline with step statuses and validation details.
3. `project_tasks` / `project_milestones`: project operations task orchestration.
4. `command_center_actions`: action/recommendation layer for project operations.
5. `webhook_ingestion_log`: replayable webhook intake audit and replay source.
6. `project_activity` and `network_events`: event-like activity and audit logs.

Recommendation: do not add pipeline-specific queue tables unless there is a hard operational reason. Prefer extending `enrichment_queue` for opportunity enrichment, project tasks/actions for project operations, and event/observation records for derived intelligence.

---

## 5. Existing Intelligence Systems

### Opportunity Intelligence

`opportunity_intelligence` is already explainable: it stores score version, score dimensions, weights, factors JSON, market price, match summary, risk flags, highlights, summary, score history, and timestamps. It is the right extension point for Opportunity Intelligence Pipeline outputs.

### Contractor Matching Intelligence

`contractorMatcher.ts` calculates geo, size fit, service, performance, and capacity scores with reasons and concerns. `contractor_profiles` stores self-reported and eventually auto-enriched contractor capability data. Future contractor learning should update contractor_profiles or write intelligence observations tied to contractor/user IDs.

### Utility Intelligence

Utility truth is split into canonical normalization, DB policy matching, proposal truth, incentive engine, interconnection, and utility programs. The extension strategy must consolidate outputs around canonical utility IDs and policy records rather than duplicate utility tables.

### AHJ Intelligence

AHJ records, overlays, permit checklists, and AHJ complexity outputs already exist. Future AHJ intelligence should be attached as observations to AHJ identifiers, opportunities, and projects.

### Engineering Intelligence

Irradiance, production, layout, roof, BOM, SLD, permit, structural, and survey ingestion systems already exist. These are domain intelligence engines. The canonical orchestration layer should receive events from them and attach derived intelligence to projects/opportunities, not replace them.

---

## 6. Duplicate-Risk Analysis

| Risk | Severity | Why it matters | Safe path |
|---|---:|---|---|
| Creating a new utility master table | Critical | Would fragment canonical utility matching/rates/NEM/TOU and break proposal/engineering truth | Extend `utility_policies`, `CANONICAL_UTILITIES`, or attach observations referencing canonical utility ID |
| Creating a second opportunity lifecycle | Critical | Would split lead, intake, marketplace, routing, and close states | Use `network_opportunities.status` as the one lifecycle; use subordinate statuses only for dimensions |
| Creating separate lead/homeowner CRM tables | High | SolarPro is not a CRM; duplicates `clients`, intake, and project portal state | Attach behavior to `clients`, `projects`, `network_opportunities`, and event logs |
| Creating separate contractor reputation table prematurely | High | Duplicates `contractor_profiles`, assignments, claims, and users | Derive reputation from `opportunity_assignments`, claims, project outcomes; store summary on profile or observations |
| Creating new enrichment queues per pipeline | High | Breaks replay/orchestration consistency | Extend `enrichment_queue` where opportunity-related; use project task/action systems for project ops |
| Creating AHJ v2 database | High | Duplicates `lib/jurisdictions` and permit/AHJ systems | Add canonical AHJ IDs/observations only after mapping existing AHJ records |
| Mixing project lifecycle and marketplace lifecycle | Medium | A claimed opportunity can become a project, but they are not the same state machine | Define explicit transition event from `network_opportunity` to `project`; keep lifecycle authority separate |
| Storing scores without derivation | Critical | Violates explainability directive | All scores must store source, confidence, timestamp, version, and factor breakdown |

---

## 7. Recommended Extension Points

### Primary Extension Pattern: Canonical Intelligence Observations

Instead of building separate domain-specific mini-platforms, add one generic, canonical observation model after approval. The model should attach intelligence to canonical entities and support confidence/source/timestamp/derivation.

Conceptual shape:

- `entity_type`: `opportunity`, `project`, `contractor`, `client`, `utility`, `ahj`, `campaign`, `assignment`
- `entity_id`: UUID or canonical string reference
- `observation_type`: typed event/score/fact category
- `source_system`: module or provider that produced it
- `confidence`: 0-1
- `observed_at`: timestamp
- `valid_from`, `valid_until`: optional temporal validity
- `derivation`: JSON explaining formula, inputs, model version, and upstream event IDs
- `payload`: JSON output
- `is_current`: optional projection helper

This should not replace existing tables. It should be a cross-domain intelligence ledger that references existing canonical entities.

### Event Propagation

Use `network_events` for marketplace/opportunity events. For project events, evaluate whether `project_activity` should remain project-local and whether a unified event envelope should be introduced. A unified event architecture can be implemented as an adapter layer that emits to existing logs first, then optionally to a broader canonical event ledger after approval.

### Scoring Projections

Keep current domain-specific score tables/projections:

- Opportunity score: `opportunity_intelligence`
- Contractor capability summary: `contractor_profiles`
- Utility/policy outputs: canonical utility/policy modules and existing DB tables
- Project operational stage: `projects.project_status` and project activity/actions

Use observations for raw/replayable calculation evidence, then update canonical projection fields/tables.

---

## 8. Canonical Intelligence Layer Proposal

The next layer should be **Canonical Intelligence Orchestration**, not another dashboard or database cluster.

### Proposed Architecture

1. **Event ingestion adapters** listen to existing systems: intake, webhook replay, screening, enrichment, scoring, assignment, claim, project transition, survey ingestion, permit generation, utility matching, AHJ lookup, production calculation, BOM/structural checks.
2. **Canonical event envelope** normalizes events without taking ownership away from existing logs.
3. **Observation writer** records explainable intelligence facts against canonical entities.
4. **Pipeline orchestrators** consume events/observations and update existing projection tables.
5. **Projection updaters** write derived state back to canonical tables such as `opportunity_intelligence`, `contractor_profiles`, `network_opportunities`, and `projects`.
6. **Replay tools** can rebuild projections from webhook logs, intake events, network events, project activity, and observations.

### Required Pipelines Mapped to Existing Canon

| Required pipeline | Canonical attachment | Initial extension point |
|---|---|---|
| Opportunity Intelligence | `network_opportunities`, `opportunity_intelligence`, `network_events` | Add observations for each score dimension and update `opportunity_intelligence` projection |
| Contractor Intelligence | `users`, `contractor_profiles`, `opportunity_assignments`, `opportunity_claims`, projects | Derive performance/reputation observations; project summary back into `contractor_profiles` |
| AHJ Intelligence | existing AHJ modules, `projects`, `network_opportunities` AHJ fields | Attach AHJ observations by AHJ ID/name + project/opportunity context |
| Utility Intelligence | `CANONICAL_UTILITIES`, `utility_policies`, project/client/opportunity utility fields | Store observations referencing canonical utility ID/policy row; do not create utility clone |
| Homeowner Behavioral | `clients`, `projects`, portal activity, intake events | Attach behavior observations to client/project/opportunity |
| Financing/Lender | project financial/proposal fields, opportunity financial fit | Start as observations; only add lender canonical model after audit of existing finance fields |
| Operational Failure Learning | `project_activity`, project stages, permit/inspection/task outcomes | Event adapter from project activity/tasks into failure observations |
| Revenue Intelligence | assignments, claims, payments, campaign analytics | Observations + projections into campaign/assignment analytics |
| Marketplace Reputation | contractor profile + assignments/outcomes | Derive reputation from claims, response time, close/win/loss, disputes/refunds |
| Event Intelligence | `network_events`, `intake_events`, `project_activity` | Unified event adapter/envelope; do not replace logs initially |

---

## 9. Event Architecture Proposal

### Principle

Prefer event propagation over tight coupling. Existing logs remain authoritative for their domains. A canonical event envelope standardizes how intelligence pipelines consume them.

### Event Envelope

Recommended fields:

- `event_id`
- `event_type`
- `event_category`
- `entity_type`
- `entity_id`
- `actor_type`
- `actor_id`
- `source_system`
- `occurred_at`
- `correlation_id`
- `causation_id`
- `idempotency_key`
- `payload`
- `from_state`
- `to_state`
- `schema_version`

### Existing Logs to Bridge

- `network_events` for opportunity/marketplace events
- `intake_events` for intake pipeline events
- `webhook_ingestion_log` for raw/replayable webhook ingress
- `project_activity` for project lifecycle activity
- `admin_activity_log` for admin actions

The first implementation should be an adapter library, not necessarily a new table. If a table is approved, it should be a canonical event ledger, not domain-specific event silos.

---

## 10. Migration Impact Analysis

Minimum safe migration after approval would likely be one canonical observation table and possibly one canonical event bridge table. However, implementation can begin with TypeScript event-envelope adapters and no database migration, using existing event logs.

If adding a table, the table must not duplicate domain state. It should store derived, replayable, explainable observations only. Projection fields remain on canonical tables.

Potential migration risks:

- Existing `lib/migrations/*.sql` and inline `app/api/migrate/route.ts` are not fully synchronized. This has already caused System Tools failures. Future migrations should be generated once and mirrored intentionally.
- Some canonical utility DB tables are inline-only. Before adding utility intelligence migrations, extract or document the canonical utility schema path.
- `network_opportunities` now exists in both 047 and 054 files due to recovery work. Future cleanup should consolidate migration strategy but avoid destructive changes.

---

## 11. Scalability Risk Analysis

1. **JSONB-heavy intelligence can become hard to query.** Use JSONB for derivation and raw factors, but keep searchable projection fields on canonical tables.
2. **Event volume can grow quickly.** Index by entity, event type, occurred_at, and correlation ID. Avoid writing noisy low-value events.
3. **Replay can become expensive.** Store projection versions and support scoped replay by entity/correlation/time window.
4. **Utility/AHJ intelligence freshness matters.** Observations need validity windows and source timestamps.
5. **Multiple lifecycle systems require adapters.** Project and opportunity lifecycle should remain separate but bridgeable through explicit conversion events.
6. **Scoring drift requires versioning.** Every scorer must store `score_version`, source, factor inputs, weights, confidence, and timestamp.

---

## 12. Proposed Approval Gates

Before implementation, I recommend approving these architectural decisions:

1. Confirm `network_opportunities` is the canonical marketplace opportunity object.
2. Confirm `projects.project_status` is the canonical project lifecycle.
3. Confirm `users + contractor_profiles` is the canonical contractor model.
4. Confirm utility intelligence must extend `CANONICAL_UTILITIES` / `utility_policies`, not new utility tables.
5. Approve or reject a generic `intelligence_observations` pattern.
6. Decide whether canonical event envelope starts as TypeScript-only adapter or DB-backed ledger.
7. Decide whether first implementation should target Opportunity Intelligence replay, Contractor Reputation, or Utility/AHJ observation normalization.

---

## 13. Recommended First Implementation After Approval

The safest first implementation is **not** a new dashboard. It is a small canonical orchestration foundation:

1. `lib/intelligence/events.ts`: typed canonical event envelope and adapter helpers.
2. `lib/intelligence/observations.ts`: typed observation model and writer interface.
3. Optional migration: `061_intelligence_observations.sql` only if DB-backed observations are approved.
4. Bridge existing `intake_events` and `network_events` into observation-producing handlers.
5. Update `opportunity_intelligence` writer to include confidence/source/timestamp/derivation consistently.
6. Add tests that prove no duplicate source-of-truth tables are introduced.

This preserves the one-source-of-truth rule while enabling adaptive learning and replayable intelligence.
