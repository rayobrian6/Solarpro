# Audit & Fix Todo — v61.9 Post-Audit

## Status
- [x] Repo cloned and dev branch checked out
- [x] TypeScript: 0 errors
- [x] Tests run: 2 failing test files, 24 failing tests

## Failures to Fix

### Fix 1: hydrationLock.test.ts — jest.spyOn → vi.spyOn (3 tests)
- [ ] Replace `jest.spyOn` with `vi.spyOn` + add `import { vi } from 'vitest'` in hydrationLock.test.ts

### Fix 2: brandOnboardingSmoke.test.ts — Sungrow all-inactive inverters (21 tests)
- [ ] Activate sungrow-sg5rs, sungrow-sg7.6rs, sungrow-sg10rs in equipment-db.ts
- [ ] Keep sungrow-sg15rs as active: false (not in US residential catalog)

## Verification
- [ ] All tests passing after fixes
- [ ] TypeScript 0 errors
- [ ] Commit to dev branch