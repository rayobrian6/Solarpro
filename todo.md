# SolarPro Contractor Network Canonical Marketplace Audit

## Audit
- [x] Verify repo state and branch before changes.
- [x] Inspect contractor Network UI components/tabs and claim button wiring.
- [x] Inspect Discover, My Claims, and claim APIs against canonical inventory/assignment model.
- [x] Identify specific visibility/status/count/profile mapping mismatches.

## Fixes
- [x] Align Discover API/UI with released eligible canonical marketplace inventory.
- [x] Align My Claims API/UI with canonical opportunity_assignments claims.
- [x] Ensure claim route/status behavior keeps claimed records visible after refresh.
- [x] Add or update targeted tests for canonical Discover, claims, claim creation, legacy isolation, and counts.

## QA
- [x] Run targeted contractor/network tests.
- [x] Run TypeScript type-check.
- [x] Run ESLint.
- [x] Run broader regression if practical.

## Delivery
- [x] Review final diff and summarize exact mismatch found.
- [x] Commit and push changes on an audit branch or dev as appropriate.
- [x] Provide post-audit report with files changed, canonical claim source, and remaining UI limitations.
