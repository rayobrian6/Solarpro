# SolarPro Intelligence Producers + Self-Learning Pipelines

## 1. Pre-Implementation Producer Audit
- [x] Audit event/log/data sources for Contractor Performance producer
- [x] Audit event/log/data sources for Homeowner Engagement producer
- [x] Audit event/log/data sources for AHJ Correction producer
- [x] Audit event/log/data sources for Utility Behavioral producer
- [x] Audit event/log/data sources for Opportunity Lifecycle producer
- [x] Audit event/log/data sources for Inspection / Failure producer
- [x] Identify canonical attachment points for all producers
- [x] Identify replay boundaries, confidence strategy, and idempotency strategy
- [x] Write producer audit document

## 2. Producer Foundation
- [x] Create producer shared types and helpers
- [x] Create replay-safe observation generation utilities
- [x] Ensure all producers output IntelligenceObservationDraft only

## 3. Required Producers
- [x] Contractor Performance Intelligence producer
- [x] Homeowner Engagement Intelligence producer
- [x] AHJ Correction Intelligence producer
- [x] Utility Behavioral Intelligence producer
- [x] Opportunity Lifecycle Intelligence producer
- [x] Inspection / Failure Intelligence producer

## 4. Tests
- [x] Tests for canonical attachments
- [x] Tests for replay-safe idempotency
- [x] Tests for explainability and confidence derivation
- [x] Tests proving producers do not mutate lifecycle/source-of-truth systems

## 5. QA + Commit
- [x] Run targeted producer tests
- [x] Run TypeScript/lint targeted checks
- [x] Commit and push dev only
