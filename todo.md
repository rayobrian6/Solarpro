# v47.36 — Infrastructure Stabilization

## Phase 1: URL Consolidation
- [x] Fix lib/email.ts — remove private getAppUrl(), use getBaseUrl() from lib/env.ts, change from address
- [x] Fix lib/stripe.ts — replace process.env.NEXT_PUBLIC_BASE_URL direct access with getBaseUrl()
- [x] Fix lib/billOcrEngine.ts — remove local getBaseUrl(), use lib/env.ts getBaseUrl()
- [x] Fix app/api/proposals/[id]/share/route.ts — replace origin||NEXT_PUBLIC_APP_URL||solarpro.app with getBaseUrl()

## Phase 2: New Endpoint
- [x] Create /api/system/health route

## Phase 3: Finalize
- [ ] Update .env.example — consolidate NEXT_PUBLIC_APP_URL guidance, remove NEXT_PUBLIC_BASE_URL duplication
- [ ] TypeScript check
- [ ] Commit + push
- [ ] Output deployment readiness report