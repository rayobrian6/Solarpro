# SolarPro Intelligence Pipelines — Detailed Handoff for New Session

## Critical Session Context

The current working branch is `dev`. Do **not** push to `master` unless explicitly instructed by the user. The user has been very clear that dev is auto-deployed through Vercel preview and is the working branch for this phase.

Latest relevant commit on `dev` at time of this handoff:

```text
d587422 feat: add manual admin-safe intelligence runner endpoint
```

Recent commit chain:

```text
d587422 feat: add manual admin-safe intelligence runner endpoint
9b6daea fix: harden intelligence orchestration before endpoint exposure
2fe3c74 docs: audit intelligence orchestration foundation before endpoint exposure
be16f43 feat: add intelligence producer orchestration foundation
90a69c5 fix: harden intelligence producers before orchestration
0834034 docs: audit canonical intelligence producers before orchestration
8ce5807 feat: add canonical intelligence producers
1da6d23 chore: mark canonical intelligence foundation todo complete
db3f290 feat: canonical intelligence orchestration foundation
fb3c996 feat: Phase G + Campaign Infrastructure — overnight build
1b41d3b fix: migrations 054-057 — self-contained, no broken FK deps, trailing semicolons
b0a4e85 feat: add SQL migration files 054-059 to lib/migrations for System Tools dropdown
```

Repository path in the previous session:

```text
/workspace/solarpro-live
```

The previous session had severe interaction-speed/user-trust problems. The user wants systematic, thorough work, but not slow micro-step behavior. Use **Fast Thorough Mode**: batch file edits, use visible shell scripts/patches where reasonable, group QA commands, avoid excessive progress chatter, do not do unnecessary todo-only amend commits unless needed.

---

# Absolute User Rules / Architecture Rules

These rules came directly from the user across multiple master directives. They must be preserved.

## Branch / Deployment Rules

1. Work on `dev` unless explicitly told otherwise.
2. Do **not** push to `master` unless explicitly instructed.
3. User expects dev branch changes to show in Vercel preview.
4. If asked whether changes landed, verify via git, route availability, and relevant tests; do not guess.

## No Duplicate Source-of-Truth Rules

Before adding tables, schemas, utility datasets, scoring systems, event systems, queues, or intelligence systems, audit the existing canonical systems first.

Do **not** create duplicate:

- utility systems
- utility_v2 / utility_master / utility_profiles / utility scoring silos
- opportunity lifecycle systems
- lead lifecycle systems
- contractor systems
- project lifecycle systems
- event ledgers
- marketplace state systems
- enrichment systems
- AHJ systems
- scoring systems
- CRM-like homeowner systems
- intelligence_v2 architectures

The intelligence layer is additive, not authoritative.

## Canonical Systems Approved by User

The following are canonical and must not be bypassed or duplicated:

### Marketplace Opportunity Authority

```text
network_opportunities
```

### Project Lifecycle Authority

```text
projects.project_status
lib/operations/pipeline.ts
```

### Contractor Authority

```text
users
contractor_profiles
```

### Utility Authority

```text
CANONICAL_UTILITIES
utilityNormalizer
utilityMatcher
utility_policies
incentive engines
proposal utility truth engines
```

### Existing Event-Like Systems

```text
network_events
intake_events
webhook_ingestion_log
project_activity
admin activity systems
```

### Existing Intelligence Layer

```text
intelligence_observations
lib/intelligence/events.ts
lib/intelligence/observations.ts
lib/intelligence/bridges.ts
lib/intelligence/producers.ts
lib/intelligence/runner.ts
```

## Observation-Driven Intelligence Rules

The platform does **not** learn by mutating truth tables.

The platform learns by:

1. observing outcomes
2. storing observations
3. detecting patterns
4. proposing corrections
5. influencing future workflows only after review/approval

All observations must include:

- `entity_type`
- `entity_id`
- `observation_type`
- `source_system`
- `confidence`
- `observed_at`
- `derivation` / factor breakdown
- `payload`
- `schema_version`
- replay-safe `idempotency_key` where used through orchestration

No black-box scoring. Every score must be explainable.

## No Mutation Rules

The intelligence producers, orchestration, and endpoint must **not** mutate:

- `projects.project_status`
- `projects` lifecycle state
- `network_opportunities.status`
- marketplace lifecycle state
- `contractor_profiles` projections
- utility canonical systems
- AHJ canonical systems
- `opportunity_intelligence` projections
- scoring projections
- lifecycle state generally

Observations are append-only. No observation overwrite. No hidden mutation.

## Non-Goals Repeated by User

Do **not** build unless explicitly asked:

- dashboards
- admin UI pages
- schedulers
- cron jobs
- background runners
- queue workers
- projections
- projection writers
- recommendation engines
- automatic rule mutation
- automatic scoring writes
- automatic self-learning loops
- new event ledgers
- generic automation systems

## Endpoint Rules

The manual endpoint must remain:

- admin-authenticated
- dry-run by default
- selected producers only
- bounded scope required
- replay-safe
- deterministic
- no projections
- no lifecycle mutation
- no scheduled execution
- no dashboard
- returns structured summary

---

# What Was Built in This Segment

## 1. SQL Migration Files 054–061

### Context

The user showed the System Tools migration dropdown did not include 054–058. The root issue was that inline migrations existed in `app/api/migrate/route.ts`, but the System Tools dropdown reads files from `lib/migrations/*.sql`.

### Files added/fixed

```text
lib/migrations/054_alter_network_opportunities_intake_columns.sql
lib/migrations/055_intake_events.sql
lib/migrations/056_enrichment_queue.sql
lib/migrations/057_webhook_ingestion_log.sql
lib/migrations/058_intake_funnels.sql
lib/migrations/059_acquisition_campaigns.sql
lib/migrations/060_campaign_seeds.sql
lib/migrations/061_intelligence_observations.sql
```

### Important migration details

- `054` was rewritten to be self-contained: creates `network_opportunities` if missing, then adds intake/enrichment columns.
- `055`, `056`, `057` had missing trailing semicolon fixes.
- `058` creates/seeds intake funnels.
- `059` creates acquisition campaigns.
- `060` seeds platform-specific funnels and sample campaigns.
- `061` creates append-friendly `intelligence_observations`.

### Run order in System Tools

```text
054 → 055 → 056 → 057 → 058 → 059 → 060 → 061
```

The user previously reported 058 and 059 succeeded while 054–057 failed; that was fixed by `1b41d3b`.

---

## 2. Campaign Infrastructure / Phase G Work

Commit:

```text
fb3c996 feat: Phase G + Campaign Infrastructure — overnight build
```

### Added

```text
app/api/admin/network/campaigns/route.ts
docs/campaign-brief-2025.html
lib/migrations/060_campaign_seeds.sql
```

### Modified

```text
app/admin/network/page.tsx
```

### Functionality

- Added Campaigns tab to Network Control Center.
- Campaigns API supports GET/POST/PATCH/DELETE soft archive.
- Campaign seeds include Google, Meta, TikTok, SEO campaign definitions.
- Campaign brief created as polished HTML.

### Caveat

This was built before the stricter intelligence architecture audit directives. It is separate from the later canonical intelligence producer work.

---

## 3. Canonical Intelligence Architecture Audit

Commit:

```text
db3f290 feat: canonical intelligence orchestration foundation
```

Audit document:

```text
docs/canonical-intelligence-architecture-audit.md
```

### Key approved conclusions

- `network_opportunities` is canonical marketplace opportunity object.
- `projects.project_status` is canonical project lifecycle authority.
- `users + contractor_profiles` is canonical contractor intelligence anchor.
- Existing utility architecture must be reused/extending, not duplicated.
- Event adapters should initially be TypeScript-only, not a new DB event ledger.
- `intelligence_observations` table approved because observations are not lifecycle authority.

---

## 4. Intelligence Event Adapters / Observations Foundation

Commit:

```text
db3f290 feat: canonical intelligence orchestration foundation
```

Files added:

```text
lib/intelligence/events.ts
lib/intelligence/observations.ts
lib/intelligence/bridges.ts
lib/intelligence/intelligenceArchitecture.test.ts
lib/migrations/061_intelligence_observations.sql
```

Modified:

```text
lib/network/opportunityScorer.ts
```

### events.ts

TypeScript-only canonical event envelope adapters for existing logs:

- `network_events`
- `intake_events`
- `webhook_ingestion_log`
- `project_activity`
- `admin_activity_log`

These do not create a new event source of truth.

### observations.ts

Defines:

- approved entity types
- `IntelligenceObservationDraft`
- validation helpers
- `NeonObservationWriter`
- event-to-observation helpers
- opportunity score observation helper

### bridges.ts

Converts existing log rows into observation drafts.

### opportunityScorer.ts

Added helper:

```ts
createOpportunityScoreObservation(...)
```

This preserves `opportunity_intelligence` as a projection and uses observations for replayable derivation evidence.

---

## 5. Intelligence Producers

Initial commit:

```text
8ce5807 feat: add canonical intelligence producers
```

Hardening commit:

```text
90a69c5 fix: harden intelligence producers before orchestration
```

Files:

```text
lib/intelligence/producers.ts
lib/intelligence/producers.test.ts
docs/intelligence-producers-audit.md
docs/intelligence-producers-implementation-audit.md
```

### Producers implemented

1. `produceContractorPerformanceObservations`
2. `produceHomeownerEngagementObservations`
3. `produceAhjCorrectionObservations`
4. `produceUtilityBehaviorObservations`
5. `produceOpportunityLifecycleObservations`
6. `produceFailureIntelligenceObservations`

### Producer guarantees

- Return `IntelligenceObservationDraft[]`
- No DB writes
- No canonical mutations
- No lifecycle authority
- Attach to approved entities
- Include confidence/derivation/payload/schema/version/idempotency

### Hardening fixes

- Stable idempotency for lifecycle producer.
- Centralized `deriveConfidence(...)` helper.
- Secondary classifier matches:
  - `secondary_matches`
  - `matched_patterns`
  - `classification_notes`
- Tests for idempotency, confidence bounds, ambiguous classifications, no DB imports, no homeowner entity leakage.

---

## 6. Intelligence Orchestration Foundation

Initial commit:

```text
be16f43 feat: add intelligence producer orchestration foundation
```

Hardening commit:

```text
9b6daea fix: harden intelligence orchestration before endpoint exposure
```

Files:

```text
lib/intelligence/executionContext.ts
lib/intelligence/replay.ts
lib/intelligence/registry.ts
lib/intelligence/runner.ts
lib/intelligence/runner.test.ts
```

Modified:

```text
lib/intelligence/observations.ts
lib/intelligence/bridges.ts
```

### executionContext.ts

Provides deterministic execution context:

- stable `run_id`
- deterministic `observed_at`
- dry-run state
- scope
- window
- source event ID

### replay.ts

Provides replay boundary helpers:

- source event ID
- replay window
- entity scope
- opportunity scope
- project scope
- deterministic hash fallback

### registry.ts

Canonical producer registry:

```text
contractor_performance
homeowner_engagement
ahj_corrections
utility_behavior
opportunity_lifecycle
inspection_failures
```

Each has metadata:

- name
- version
- description
- supported entity types
- replay capabilities
- dry-run support
- observation-only flag

### runner.ts

Runs producers and returns structured summaries.

Capabilities:

- dry-run execution
- non-dry-run writer integration
- single/multi producer jobs
- scoped replay context
- validation failure isolation
- producer failure isolation
- writer failure isolation
- in-run idempotency dedupe
- DB-level collision reporting through writer status
- registry entity enforcement
- missing idempotency rejection
- structured missing-writer failure

### observations.ts writer contract updated

Writer statuses now:

```ts
'inserted' | 'skipped_existing' | 'failed'
```

`NeonObservationWriter` uses `ON CONFLICT DO NOTHING` and reports `skipped_existing` instead of mutating existing observation rows.

---

## 7. Admin Integration Audit

No commit specifically for this audit unless in docs from prior steps. The audit concluded:

Best route for manual runner endpoint:

```text
app/api/admin/network/intelligence/runner/route.ts
```

Do **not** put it in System Tools.

Reason: intelligence runner is marketplace/network-centric and belongs under existing `app/api/admin/network/*` pattern.

System Tools remains for migrations/db/platform maintenance, not domain intelligence execution.

---

## 8. Manual Admin-Safe Intelligence Runner Endpoint

Commit:

```text
d587422 feat: add manual admin-safe intelligence runner endpoint
```

Files added:

```text
app/api/admin/network/intelligence/runner/route.ts
tests/intelligence-runner-route.test.ts
```

### Endpoint

```text
POST /api/admin/network/intelligence/runner
```

### Auth

Uses:

```ts
requireAdminApi(req)
```

Behavior:

- unauthorized → 401
- non-dry-run by non-super_admin → 403

### Request body

```json
{
  "producer_names": ["opportunity_lifecycle"],
  "dry_run": true,
  "entity_type": "opportunity",
  "entity_id": "uuid",
  "project_id": "uuid",
  "opportunity_id": "uuid",
  "source_event_id": "event-id",
  "window": {
    "start": "2025-01-01T00:00:00.000Z",
    "end": "2025-01-31T00:00:00.000Z"
  },
  "preview_limit": 10
}
```

### Validation

Rejects:

- missing `producer_names`
- empty `producer_names`
- unknown producers
- missing bounded scope
- invalid replay window timestamps
- `window.end < window.start`
- replay window over 31 days
- `dry_run=false` unless caller is `super_admin`

### Dry-run behavior

- Default if omitted.
- Does not pass a writer.
- Does not persist observations.
- Returns summary and bounded preview.

### Non-dry-run behavior

- Requires `super_admin`.
- Uses `NeonObservationWriter`.
- Logs admin action via `logAdminAction`.
- Writes only append-only observations.
- No projections or lifecycle mutation.

### Response shape

```ts
{
  success: boolean,
  dry_run: boolean,
  summary: { ...runnerSummary },
  observations_preview: [
    {
      entity_type,
      entity_id,
      observation_type,
      confidence,
      observed_at,
      idempotency_key
    }
  ]
}
```

Preview default: 10. Max: 50.

### Important route behavior / limitations

The route includes limited job hydration from canonical DB tables:

- `opportunity_lifecycle` requires `opportunity_id` or `entity_type=opportunity + entity_id`.
- `contractor_performance` requires `entity_type=contractor + entity_id`.
- project-based producers use `project_activity` when `project_id` or `entity_type=project` is provided:
  - `homeowner_engagement`
  - `ahj_corrections`
  - `utility_behavior`
  - `inspection_failures`

This is intentionally simple and bounded. No broad full-system replay is implemented.

---

# QA Status

## Targeted tests after final endpoint

Ran:

```bash
npx vitest run \
  lib/intelligence/intelligenceArchitecture.test.ts \
  lib/intelligence/producers.test.ts \
  lib/intelligence/runner.test.ts \
  tests/intelligence-runner-route.test.ts \
  --reporter=verbose
```

Result:

```text
4 test files passed
37 tests passed
```

## Targeted TypeScript after final endpoint

A targeted TypeScript check was run by grepping `npx tsc --noEmit` output for modified route/intelligence files after fixing route narrowing errors. It was clean for modified files.

Important: this was **not** a full clean repo type-check report. It was a targeted check.

## Targeted ESLint after final endpoint

Ran targeted ESLint on modified route/test/intelligence files. It was clean.

## Full regression status

Very important: after the final endpoint commit, full repo regression was **not** run.

The user specifically asked whether full regression had been run. The honest answer is:

- Targeted Vitest: yes.
- Targeted TypeScript/ESLint: yes for modified files.
- Full `npm run test`: **not run after final endpoint commit**.
- Full `npm run type-check`: **not fully confirmed clean after final endpoint commit**.
- Full `npm run lint`: **not run after final endpoint commit**.

Known previous full-regression context from earlier session: there was a prior full regression with 108 test files / 4,612 tests passing and no new TypeScript/lint errors, but that was **before** the later intelligence endpoint/orchestration work.

## Full regression commands recommended immediately in next session

Run from repo root:

```bash
npm run test
npm run type-check
npm run lint
```

If time is a concern, at minimum run:

```bash
npx vitest run \
  lib/intelligence/intelligenceArchitecture.test.ts \
  lib/intelligence/producers.test.ts \
  lib/intelligence/runner.test.ts \
  tests/intelligence-runner-route.test.ts \
  --reporter=verbose

npm run type-check
npm run lint
```

Be transparent with the user about full regression status.

---

# Known Concerns / Caveats for Next Session

## 1. Session speed / trust issue

The user is extremely frustrated by slow session behavior and incorrect/unhelpful responses. Do not waste time. Use systematic batching and clear answers.

Do not say full regression was run if only targeted checks were run.

## 2. Endpoint exists but no UI

There is no admin UI button/page for this runner yet. That was explicitly a non-goal.

## 3. Endpoint is manual only

No scheduler, cron, background automation, dashboard, or projection mutation exists.

## 4. Non-dry-run writes observations

Non-dry-run uses `NeonObservationWriter` to write append-only `intelligence_observations`. It does not update projections.

## 5. Hydration is intentionally bounded and minimal

The endpoint builds jobs from existing canonical tables for scoped requests. It does not support unbounded broad replay. It may need more producer-specific hydration logic later, but do not overbuild without user approval.

## 6. Potential route TypeScript union issue was fixed

Initial TypeScript complained about union narrowing in the endpoint. Fixed by using explicit `ok === false` checks.

## 7. Admin route authorization distinction

The endpoint enforces:

- `admin` can dry-run.
- `super_admin` can non-dry-run.

This was a recommendation in earlier audit and was implemented.

---

# Exact Next Steps Recommended

## Step 1 — Full regression

Run full QA immediately and report exact results.

Commands:

```bash
npm run test
npm run type-check
npm run lint
```

If any fail, fix only issues related to recent changes unless user approves broader cleanup.

## Step 2 — Verify endpoint route compiles/deploys

After Vercel dev deploy, verify route exists. Since it requires auth, expected unauthenticated response is 401.

Example:

```bash
curl -i https://solarpro-dev.vercel.app/api/admin/network/intelligence/runner \
  -X POST \
  -H 'content-type: application/json' \
  --data '{"producer_names":["opportunity_lifecycle"],"opportunity_id":"test","dry_run":true}'
```

Expected without session:

```text
401 Unauthorized
```

Do not try non-dry-run in production/dev unless explicitly approved.

## Step 3 — System Tools migrations

If not already done, user should run migrations through System Tools in order:

```text
054 → 055 → 056 → 057 → 058 → 059 → 060 → 061
```

The user previously said `intelligence_observations` migration already ran successfully, but verify if needed.

## Step 4 — Dry-run manual endpoint test with admin session

Once user is logged in as admin/super_admin, test dry-run only.

Example body:

```json
{
  "producer_names": ["opportunity_lifecycle"],
  "dry_run": true,
  "opportunity_id": "<real-network-opportunity-id>",
  "preview_limit": 5
}
```

Expected:

- no writes
- structured summary
- observations preview
- `observations_written = 0`

## Step 5 — Only after dry-run confidence, test non-dry-run as super_admin

Only if user explicitly approves.

Example:

```json
{
  "producer_names": ["opportunity_lifecycle"],
  "dry_run": false,
  "opportunity_id": "<real-network-opportunity-id>",
  "preview_limit": 5
}
```

Expected:

- append-only observation writes
- idempotency prevents duplicates on replay
- admin action logged
- no projection/lifecycle mutation

## Step 6 — Future possible UI (not yet approved)

A future UI may be added under Network Control Center or admin System Tools as a button/form, but user explicitly did not ask for dashboard/UI yet. Do not implement without permission.

---

# Files of Interest

## Intelligence core

```text
lib/intelligence/events.ts
lib/intelligence/observations.ts
lib/intelligence/bridges.ts
lib/intelligence/producers.ts
lib/intelligence/executionContext.ts
lib/intelligence/replay.ts
lib/intelligence/registry.ts
lib/intelligence/runner.ts
```

## Tests

```text
lib/intelligence/intelligenceArchitecture.test.ts
lib/intelligence/producers.test.ts
lib/intelligence/runner.test.ts
tests/intelligence-runner-route.test.ts
```

## Endpoint

```text
app/api/admin/network/intelligence/runner/route.ts
```

## Docs

```text
docs/canonical-intelligence-architecture-audit.md
docs/intelligence-producers-audit.md
docs/intelligence-producers-implementation-audit.md
docs/intelligence-orchestration-foundation-audit.md
docs/HANDOFF_INTELLIGENCE_PIPELINES_NEXT_SESSION.md
```

## Migrations

```text
lib/migrations/054_alter_network_opportunities_intake_columns.sql
lib/migrations/055_intake_events.sql
lib/migrations/056_enrichment_queue.sql
lib/migrations/057_webhook_ingestion_log.sql
lib/migrations/058_intake_funnels.sql
lib/migrations/059_acquisition_campaigns.sql
lib/migrations/060_campaign_seeds.sql
lib/migrations/061_intelligence_observations.sql
```

---

# Summary for New Agent

The system is now in a canonical intelligence pipeline phase. The architecture is deliberately conservative:

- canonical entities remain authoritative
- observations are append-only derived facts
- producers generate observations only
- runner orchestrates producers only
- endpoint triggers runner only
- dry-run is default
- write mode is super_admin only
- no dashboards/projections/schedulers/lifecycle mutations

The next agent should **not** invent new systems. The immediate job should be to run full regression and report honestly.

If the user asks to continue implementation, the likely next safe step after full QA is either:

1. test the endpoint in dev with a real authenticated dry-run request, or
2. add a minimal admin UI trigger only if explicitly approved, or
3. improve endpoint job hydration for additional producer/entity combinations, still bounded and dry-run-first.

Do not skip full regression again if the user asks about it.
