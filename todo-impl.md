# Phase 1 Implementation: Fix & Pre-Fill

## Quick Wins
- [x] QW-1a: Fix setback default: 0 → AHJ-computed value in DesignStudio.tsx (4h)
- [x] QW-1b: Fix rowSpacing default: 0.02 → latitude-computed shadow formula in DesignStudio.tsx (6h)
- [x] QW-1c: Fix usableRoof % default: 70% → computed from geometry (4h)
- [x] QW-2: Verify/ensure JWT claims pre-fill all Survey Step 1 fields
- [x] QW-3: Verify auto-generate project name (may already be done)
- [x] QW-4: Make annual kWh always computed — remove standalone input (3h)
- [x] QW-5: Default offset target to 100% (1h)
- [x] QW-6: Remove energy usage input mode selector (2h)
- [x] QW-7: Auto-select client when only 1 exists in projects/new/page.tsx (1h)
- [x] QW-8: Add ITC toggle confirmation guard in proposals/page.tsx (2h)
- [x] QW-9: Add "(recommended — 80% of homeowners choose this)" label to Finance mode (1h)
- [x] QW-10: Replace Calculate Production button with reactive debounced computation (4h)
