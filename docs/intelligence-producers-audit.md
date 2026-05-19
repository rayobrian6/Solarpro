# SolarPro Intelligence Producers Audit

This audit precedes the first real intelligence producers. The implementation must be additive, replayable, append-only, and non-authoritative.

## Canonical event/data sources by producer

### Contractor Performance Intelligence

Sources: `opportunity_assignments`, `opportunity_claims`, `project_activity`, `projects`, `proposal_signatures`. Canonical attachment: `contractor` / `user`, where IDs are existing `users.id` / contractor IDs already referenced by assignments and profiles. Replay boundary: assignment/outcome window per contractor. Idempotency: `producer:contractor_performance:{contractor_id}:{window_start}:{window_end}:{metric}`. Confidence derives from sample size, source reliability, explicitness, metadata richness, classification strength, and corroborating signals.

### Homeowner Engagement Intelligence

Sources: `project_activity`, proposal send/signature fields, `proposal_signatures`, `bills`, survey ingestion/webhook signals, portal events when represented as project activity. Canonical attachment: `client`, `project`, and optionally `opportunity`. Do not introduce `homeowner` as a separate entity type; `client` is the canonical homeowner identity. Replay boundary: homeowner/project engagement window. Idempotency: `producer:homeowner_engagement:{entity}:{id}:{window}:{metric}`. Confidence derives from event count, event diversity, signal explicitness, and metadata richness.

### AHJ Correction Intelligence

Sources: `project_activity` redline/correction/permit/inspection events, permit modules, existing AHJ modules, opportunity/project AHJ fields. Canonical attachment: `ahj` and `project`. Replay boundary: AHJ/project permit or inspection event. Idempotency: `producer:ahj_correction:{ahj_id_or_name}:{project_id}:{primary_pattern}:{event_id}`. Confidence derives from classifier strength, source reliability, explicitness, metadata richness, and corroborating matched patterns. Repeated-pattern aggregation across many events is future work and should be implemented in orchestration/aggregation, not in the per-event producer.

### Utility Behavioral Intelligence

Sources: canonical utility infrastructure (`CANONICAL_UTILITIES`, `utilityMatcher`, `utility_policies`, utility truth engines), `project_activity` PTO/interconnection events, opportunity utility fields. Canonical attachment: `utility` and optionally project/opportunity. Replay boundary: utility/project interconnection and PTO event. Idempotency: `producer:utility_behavior:{utility_id}:{project_or_opportunity_id}:{primary_pattern}:{event_id}`. Confidence derives from classifier strength, explicit utility evidence, metadata richness, source reliability, and corroborating matched patterns. Repeated-pattern aggregation across many utility events is future work and should not create duplicate utility tables.

### Opportunity Lifecycle Intelligence

Sources: `network_opportunities`, `opportunity_assignments`, `network_events`, `intake_events`. Canonical attachment: `opportunity`. Replay boundary preference order: source event ID, explicit replay window, canonical opportunity `updated_at`, assignment source IDs, then deterministic snapshot hash. Idempotency no longer uses wall-clock `observed_at` as the primary component. Confidence derives from lifecycle completeness, assignment sample size, timestamp availability, score availability, metadata richness, and outcome evidence.

### Inspection / Failure Intelligence

Sources: `project_activity`, assignment disputes/refunds/lost reasons, permit/inspection failure events, utility rejection/correction events. Canonical attachment: `project`, `opportunity`, `utility`, `ahj`, and/or `contractor` depending on failure context. Replay boundary: individual failure event and project lifecycle context. Idempotency: `producer:failure:{entity}:{id}:{primary_root_cause}:{event_id}`. Confidence derives from classifier strength, explicitness of failure language, metadata richness, and corroborating matched patterns.

## Shared producer rules

All producers generate `IntelligenceObservationDraft` only. They do not mutate canonical tables, do not update lifecycle state, and do not replace existing logs. Every observation includes source system, observed_at, confidence, derivation with factors, payload, schema version, and replay-safe idempotency.

Classifier producers preserve a single primary observation type for v1, but include `secondary_matches`, `matched_patterns`, and `classification_notes` in payload and derivation so ambiguous/multi-signal evidence remains explainable.
