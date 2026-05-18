# SolarPro Canonical Intelligence Orchestration Foundation

## 1. Intelligence Event Adapters
- [x] Create lib/intelligence/events.ts with typed canonical event envelope
- [x] Add adapter helpers for network_events, intake_events, webhook_ingestion_log, project_activity, admin_activity_log
- [x] Ensure adapters do not write logs or own lifecycle state

## 2. Intelligence Observations
- [x] Create lib/intelligence/observations.ts with typed observation model
- [x] Add validation helpers enforcing entity/source/confidence/timestamp/derivation/schema_version
- [x] Add writer interface for DB-backed append-friendly observations

## 3. Migration
- [x] Add lib/migrations/061_intelligence_observations.sql
- [x] Ensure table is append-friendly and not lifecycle authority
- [x] Add required indexes: entity_type/entity_id, observation_type, source_system, observed_at

## 4. Event-to-Observation Bridge
- [x] Create bridge handlers for existing intake/network events to observation drafts
- [x] Ensure bridge attaches observations to canonical entities only

## 5. Opportunity Scoring Explainability
- [x] Audit opportunityScorer current output/write path
- [x] Add observation-compatible score derivation helpers or writer integration
- [x] Preserve opportunity_intelligence as projection, not duplicate lifecycle

## 6. Tests
- [x] Add tests proving no duplicate utility source of truth introduced
- [x] Add tests proving no duplicate opportunity lifecycle introduced
- [x] Add tests proving observations attach to existing canonical entities
- [x] Add tests proving event adapters do not replace existing logs
- [x] Add tests proving scoring remains explainable

## 7. QA + Commit
- [x] Run targeted tests
- [x] Run TypeScript check / lint as feasible
- [ ] Commit and push dev only
