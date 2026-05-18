# SolarPro Intelligence Producers Audit

This audit precedes the first real intelligence producers. The implementation must be additive, replayable, append-only, and non-authoritative.

## Canonical event/data sources by producer

### Contractor Performance Intelligence

Sources: `opportunity_assignments`, `opportunity_claims`, `project_activity`, `projects`, `proposal_signatures`. Canonical attachment: `contractor` / `user`, where IDs are existing `users.id` / contractor IDs already referenced by assignments and profiles. Replay boundary: assignment/outcome window per contractor. Idempotency: `producer:contractor_performance:{contractor_id}:{window_start}:{window_end}:{metric}`. Confidence: grows with sample size and quality of timestamps/outcomes.

### Homeowner Engagement Intelligence

Sources: `project_activity`, proposal send/signature fields, `proposal_signatures`, `bills`, survey ingestion/webhook signals, portal events when represented as project activity. Canonical attachment: `client`, `project`, and optionally `opportunity`. Replay boundary: homeowner/project engagement window. Idempotency: `producer:homeowner_engagement:{entity}:{id}:{window}:{metric}`. Confidence: based on observed event diversity, recency, and event count.

### AHJ Correction Intelligence

Sources: `project_activity` redline/correction/permit/inspection events, permit modules, existing AHJ modules, opportunity/project AHJ fields. Canonical attachment: `ahj` and `project`. Replay boundary: AHJ/project permit or inspection event window. Idempotency: `producer:ahj_correction:{ahj_id_or_name}:{project_id}:{pattern}:{event_id}`. Confidence: based on repeated pattern frequency and explicit correction language.

### Utility Behavioral Intelligence

Sources: canonical utility infrastructure (`CANONICAL_UTILITIES`, `utilityMatcher`, `utility_policies`, utility truth engines), `project_activity` PTO/interconnection events, opportunity utility fields. Canonical attachment: `utility` and optionally project/opportunity. Replay boundary: utility/project interconnection and PTO events. Idempotency: `producer:utility_behavior:{utility_id}:{project_id}:{pattern}:{event_id}`. Confidence: based on explicit utility event type, timestamp completeness, and repeated pattern count.

### Opportunity Lifecycle Intelligence

Sources: `network_opportunities`, `opportunity_assignments`, `network_events`, `intake_events`. Canonical attachment: `opportunity`. Replay boundary: one opportunity lifecycle snapshot or event sequence. Idempotency: `producer:opportunity_lifecycle:{opportunity_id}:{observed_at}:{metric}`. Confidence: based on lifecycle completeness and availability of assignment/outcome data.

### Inspection / Failure Intelligence

Sources: `project_activity`, assignment disputes/refunds/lost reasons, permit/inspection failure events, utility rejection/correction events. Canonical attachment: `project`, `opportunity`, `utility`, `ahj`, and/or `contractor` depending on failure context. Replay boundary: individual failure event and project lifecycle context. Idempotency: `producer:failure:{entity}:{id}:{failure_type}:{event_id}`. Confidence: based on explicit failure type, root-cause terms, and supporting metadata.

## Shared producer rules

All producers generate `IntelligenceObservationDraft` only. They do not mutate canonical tables, do not update lifecycle state, and do not replace existing logs. Every observation includes source system, observed_at, confidence, derivation with factors, payload, schema version, and replay-safe idempotency.
