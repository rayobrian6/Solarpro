# v61.7 Config Overwrite Kill Switch

## Root Cause Analysis
- DEFAULT_CONTROL_MODE = 'guided' ✓ (shouldn't fire auto-apply)
- sizingAutoApply starts as FALSE ✓ (but UI has auto-apply checkbox)
- AUTO-APPLY useEffect fires when sizingAutoApply=true AND mismatch detected
- HARD DC/AC AUTO-HEAL useEffect fires UNCONDITIONALLY overriding userHasEditedInverters
- CAD SYNC setConfig fires unconditionally overriding strings even when user edited
- Smart Defaults fires once per project but can be confused
- The screenshot shows: 44 CAD panels → config shows 1 string of 10 (OVERWRITTEN)

## The Core Bugs
1. CAD sync (line ~5258) rewrites ALL strings via sizeSystemFromBrand even when user has edited
2. HARD DC/AC AUTO-HEAL (line ~2921) unconditionally overrides userHasEditedInverters
3. sizingAutoApply checkbox defaults to false but can be toggled to true silently
4. detectStringLayoutMismatch triggering AUTO-APPLY on string layout diff

## Phases

### Phase 1 — Add `isUserControlled` flag to config type [x]
### Phase 2 — CAD sync MUST NOT overwrite config when isUserControlled=true [ ]
### Phase 3 — Disable HARD DC/AC AUTO-HEAL unconditional override [ ]
### Phase 4 — AUTO mode: only suggestion panel, never mutate [ ]
### Phase 5 — Add config lock + guardrail logging [ ]
### Phase 6 — Fix applySizingRecommendation (explicit Apply only) [ ]
### Phase 7 — Tests [ ]
### Phase 8 — TypeScript check + commit [ ]