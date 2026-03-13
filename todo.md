# v47.24 — Production Environment Fix + Runtime Declarations

## Phase 1 — Investigation (COMPLETE ✅)
- [x] Confirm production commit is 65fd7cb (correct)
- [x] Confirm ALL env vars missing in production (DATABASE_URL, JWT_SECRET, OPENAI_API_KEY, GOOGLE_MAPS_API_KEY all false)
- [x] Identify root cause: Vercel not injecting encrypted env vars into Git-push-triggered deployment (v47.16 pattern)
- [x] Identify secondary issue: 89 routes missing `export const runtime = 'nodejs'` including bill-upload and system-size

## Phase 2 — Fix (IN PROGRESS)
- [ ] Fix 2a: Add `export const runtime = 'nodejs'` to app/api/bill-upload/route.ts
- [ ] Fix 2b: Add `export const runtime = 'nodejs'` to app/api/system-size/route.ts
- [ ] Fix 2c: Add `export const runtime = 'nodejs'` to all other critical DB/native routes (auth, debug, health, etc.)
- [ ] Fix 2d: Bump version to v47.24, commit + push runtime fixes
- [ ] Fix 2e (user action required): Redeploy from Vercel dashboard to force env var re-injection

## Phase 3 — Verification (NOT STARTED)
- [ ] Confirm production deployment picks up env vars after redeploy
- [ ] Test /api/health/auth returns healthy
- [ ] Test /api/health/database returns healthy
- [ ] Confirm full pipeline works: bill upload → OCR → parse → sizing