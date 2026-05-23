# Full System Regression + Architecture Audit v1

## Setup
- [x] Confirm repository state and recent commits on dev
- [x] Identify audit-relevant files and scripts

## Validation
- [x] Run npm run type-check
- [x] Run npm test
- [x] Run npm run build
- [x] Run npm run lint if available
- [x] Run full prohibited-boundary scan

## Architecture Searches
- [x] Search TODO/FIXME/HACK/temp bypasses in recently touched files
- [x] Search raw survey/photo count usage outside audit/history/debug contexts
- [x] Search direct evidenceManifest usage where canonicalManifest should be preferred
- [x] Search document generation paths without provenance guards
- [x] Search decision/state outputs without dependency lineage
- [x] Check imports, exports, circular dependencies, duplicated types, and stale fields

## Findings and Fixes
- [x] Classify issues by severity with root cause
- [x] Fix blocker/high issues surgically if found
- [x] Add regression tests for every fixed issue
- [x] Re-run affected and full validation after fixes

## Reports and Delivery
- [x] Create full-system regression audit report
- [x] Create failures report
- [x] Create validation report
- [x] Commit and push if code/report changes are made
- [x] Final summary with results, findings, fixes, deferred issues, files changed, tests added, safety status, and push status
