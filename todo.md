# Production Stability — v47.3

## Root Cause (resolved)
The true root cause of "users logged out minutes after login":
- `refreshUser()` fired on every window focus / visibilitychange event
- After Neon cold start (~5 min idle), `fetchUserWithRetry()` exhausted all retries
- The old code unconditionally called `setUser(u)` where `u` could be `null` on retry exhaustion
- Result: user sees logout screen purely because of a transient DB connection failure

## Fix Applied — contexts/UserContext.tsx
- Replaced complex discriminated union `FetchResult` type with simple `FetchStatus` string enum
- `fetchUserFromDb()` now returns `{ status: FetchStatus; user: AppUser | null }`
- `fetchUserWithRetry()` returns `AppUser | null | 'transient'`
  - `null` ONLY on HTTP 401 (JWT invalid/expired) — the only true logout signal
  - `'transient'` on ALL other failures (500, 503, network, retry exhaustion)
- `refreshUser()` ONLY calls `setUser(null)` when result is `null` (401)
  - On `'transient'`: preserves existing user state, never logs out
- Periodic poll: 5 minutes (was 30s — too aggressive for Neon cold-start recovery)
- Retry config: 10 retries, exponential backoff 1s→15s cap

## Tasks
- [x] Identify root cause: setUser(null) called on retry exhaustion in refreshUser()
- [x] Rewrite UserContext retry/fetch logic with FetchStatus string enum approach
- [x] Verify: 401 → logout, 503/500/network → preserve session (never logout)
- [x] TypeScript check — zero errors
- [x] Bump version to v47.3
- [x] Git commit and push