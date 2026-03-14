# v47.57 — Dev Auth Bypass

## Plan
- [x] Read all auth files (lib/auth.ts, middleware.ts, /api/auth/me, /api/auth/login)
- [ ] Create lib/dev-auth.ts — single source of truth for dev bypass logic
- [ ] Patch middleware.ts — check dev bypass before JWT decode
- [ ] Patch lib/auth.ts getUserFromRequest() — check dev bypass
- [ ] Patch app/api/auth/me/route.ts — return dev user response
- [ ] Update .env.example with DEV_AUTH_BYPASS docs
- [ ] Update lib/version.ts to v47.57
- [ ] tsc --noEmit (must be 0 errors)
- [ ] Commit and push