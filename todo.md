# SAM 2 CPU Optimization — Deploy to Render

## Pre-Commit Checks
- [x] Run TypeScript check: `npx tsc --noEmit` (0 errors)
- [x] Run ESLint check: `npx eslint . --ext .ts,.tsx` (0 errors)
- [x] Run Vitest: `npx vitest run` (all pass)

## Commit & Push
- [ ] Stage and commit updated main.py with CPU optimizations
- [ ] Push to dev branch

## Deploy to Render
- [ ] Trigger new deploy on Render via API
- [ ] Monitor build logs for success
- [ ] Verify /health endpoint responds with model_loaded=true
- [ ] Test /segment endpoint with real image
- [ ] Verify inference completes without OOM/restart

## End-to-End Verification
- [ ] Verify graceful degradation when SAM2 is unavailable
