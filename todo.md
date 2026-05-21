# Solarpro Marketplace Revenue Intelligence UI

## Audit
- [x] Inspect repository state and create/confirm a feature branch for marketplace revenue intelligence UI work.
- [x] View uploaded reference image and extract applicable visual direction.
- [x] Audit current marketplace card/detail components and opportunity payload shape.
- [x] Audit existing release readiness, bill intelligence, qualification, and reusable marketplace helpers.

## Architecture
- [x] Design centralized deterministic marketplace intelligence projection helpers with no fabricated data.
- [x] Implement `lib/network/marketplaceBadges.ts` for real-data badge derivation.
- [x] Implement `lib/network/marketplaceNarratives.ts` for deterministic opportunity story generation.
- [x] Implement `lib/network/marketplaceConfidence.ts` for confidence scoring from evidence.

## UI Implementation
- [x] Transform marketplace cards into mini deal rooms with strong revenue/intelligence hierarchy.
- [x] Add evidence-separated detail drawer/breakdown for homeowner, bill, qualification, financing, operator, and release readiness data.
- [x] Preserve existing claim flow and graceful degradation for missing data.

## Verification
- [x] Add or update targeted tests for badge, narrative, confidence, and UI projection behavior.
- [x] Run targeted Vitest, `npm run type-check`, and build validation.
- [x] Review diff for fake metrics, silent overwrites, placeholder economics, and claim-flow regressions.
- [x] Commit and push the feature branch.
