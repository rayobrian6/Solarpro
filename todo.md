# SolarPro Event-First Operational Workflow Engine

## Guardrails
- [x] Stay on `dev` and do not create a feature branch for this project-specific delivery
- [x] Preserve immutable `intake_events` history and append-only `operator_review` events
- [x] Do not create duplicate lead records, disconnected queue tables, or a separate CRM system
- [x] Keep current operational state projected through existing event-first architecture

## Implementation
- [x] Centralize Lead Operations queue definitions and routing in `lib/intake/operationalQueues.ts`
- [x] Refactor lifecycle summary projection to call the centralized operational queue resolver
- [x] Add regression-safe workflow actions for qualification, financing, callbacks, documents, dormancy, reactivation, and return-to-queue
- [x] Add callback intelligence with `callback_at`, urgency buckets, countdowns, overdue routing, and callback history
- [x] Add dormant/reactivation intelligence with dormant metadata, dormant history, and reactivation history
- [x] Expose workflow memory through projected summary fields and admin API response shape
- [x] Update Admin Lead Operations UI labels, queue definitions, action modal metadata, and timeline memory rendering

## QA
- [x] Run TypeScript type-check after reconstruction
- [x] Run focused workflow-engine and event-first tests
- [x] Verify changed files are limited to intended workflow-engine source/test/todo files

## Delivery
- [x] Commit reconstructed workflow-engine changes locally
- [x] Push `dev` to GitHub
- [x] Verify latest commit and branch status
