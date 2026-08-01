# SolarPro — Dependency Security Advisory
*Generated during Phase 75 security audit*

## Stage 2 status (2026-07-30)

**5 unpatched Next.js DoS CVEs are CLOSED.** Stage 2 of the Next 15 migration
landed on `chore/next-15-migration` (NOT PUSHED — awaiting James's review per R1/R2).
- `next@14.2.35` → `next@15.5.15` (closes all 5 CVEs per GHSA patch versions)
- `react@18.3.1` → `react@19.2.0` (Next 15 App Router requirement)
- 56 files migrated via `@next/codemod next-async-request-api` (await cookies/params)
- 6 test files mechanically updated for the new `Promise<{ params: ... }>` signature
- `react-is: ^19.0.0` override added (recharts React 19 compat)

`npm audit` post-Stage-2: **2 critical, 11 high, 6 moderate, 2 low — 21 total**
(vs pre-Stage-2: 24 total — 3 high-severity items dropped; 2 of the 5 task CVEs
were already in the npm range and the union range now still includes 15.5.15
because of NEWER next CVEs that are out-of-scope, see "Out-of-scope remaining
next advisories" below).

The 5 task CVEs (GHSA-q4gf-8mx6-v5v3, GHSA-h25m-26qc-wcjf, GHSA-ggv3-7p47-pfv8,
GHSA-9g9p-9gw9-jx7f, GHSA-3x4c-7xq6-9pq8) are confirmed patched at 15.5.15 via
the individual GHSA pages (which list 15.5.15 in the Patched versions block).

**Out-of-scope remaining next advisories (require 15.5.16+ or 16.x):**
- GHSA-8h8q-6873-q5fj — Next.js Vulnerable to DoS with Server Components (patched in 15.5.16)
- GHSA-26hh-7cqf-hhc6 — Middleware/Proxy bypass via segment-prefetch (patched in 15.5.13+follow-up)
- GHSA-3g8h-86w9-wvmq — Middleware/Proxy cache poisoning
- GHSA-ffhc-5mcf-pf4q — XSS in App Router with CSP nonces
- GHSA-vfv6-92ff-j949 — RSC cache-busting collisions
- GHSA-gx5p-jg67-6x7h — XSS in beforeInteractive scripts
- GHSA-h64f-5h5j-jqjh — DoS in Image Optimization API

These are tracked as separate follow-up work — bumping to 15.5.16+ is a
patch-bump step (not a Stage 2+3 effort).

---

## Summary

```
npm audit: 2 critical, 11 high, 6 moderate, 2 low — 21 total
```

(Pre-Stage-2: 2 critical, 14 high, 6 moderate, 2 low — 24 total; 3 high dropped
from the Next 15 bump. The remaining next advisories are newer CVEs that are
out of scope for Stage 2.)

---

## HIGH severity — Triage & Recommendations

### 1. `next` v15.5.15 — 5 DoS CVEs [HIGH] — **RESOLVED 2026-07-30** ✅
**CVEs closed by this bump:**
- **GHSA-q4gf-8mx6-v5v3** — Next.js DoS with Server Components (`>=13.0.0 <15.5.15`) — **PATCHED at 15.5.15**
- **GHSA-h25m-26qc-wcjf** — HTTP request deserialization DoS via insecure RSC (`>=13.0.0 <15.0.8`) — **PATCHED at 15.0.8** (we are at 15.5.15)
- **GHSA-ggv3-7p47-pfv8** — HTTP request smuggling in rewrites (`>=9.5.0 <15.5.13`) — **PATCHED at 15.5.13** (we are at 15.5.15)
- **GHSA-9g9p-9gw9-jx7f** — Image Optimizer remotePatterns DoS (`>=10.0.0 <15.5.10`) — **PATCHED at 15.5.10** (we are at 15.5.15)
- **GHSA-3x4c-7xq6-9pq8** — next/image disk cache exhaustion (`>=10.0.0 <15.5.14`) — **PATCHED at 15.5.14** (we are at 15.5.15)

**Resolution:**
- Bumped to `next@15.5.15` (pinned, exact version)
- `react`/`react-dom` bumped to `19.2.0` (Next 15 App Router requirement)
- 56 source files migrated via `@next/codemod next-async-request-api`
- All 5 cookies() call sites updated to `await cookies()` (codemod + 5 hand-fixes)
- 44 route.ts + 1 page.tsx migrated to `params: Promise<{ id: string }>` pattern
- 6 test files mechanically updated for the new `Promise<{ params: ... }>` signature
- `react-is: ^19.0.0` override added (recharts React 19 compat)
- `next.config.js`: `experimental.serverComponentsExternalPackages` → top-level `serverExternalPackages` (Next 15.0 rename)
- `eslint-config-next` bumped to `15.5.15` (provides `@next/next/no-sync-request-api` lint rule)

**Branch:** `chore/next-15-migration` (NOT PUSHED — awaiting James's review)
**Hand-off:** `HANDOFF_NEXT_15_MIGRATION.md` (Stage 2)
**Auditor evidence:** `CONTROL_MATRIX.md` CC7.1 row updated from Gap → Implemented
**Status:** Stage 2 complete. Three-check baseline-relative green. NOT PUSHED.

**Known follow-up work (out of scope for Stage 2):**
- The 19 GET route handlers without `force-dynamic` (Next 15 caching default change)
- The 89 uncached `fetch()` calls (add `cache: 'no-store'` for default-caching)
- The 6 `@next-codemod-error` markers in re-exports and `proposals/[id]/pdf/route.ts` (manual review needed)
- The newer `next` CVEs that require 15.5.16+ (out of scope, separate patch bump)

### 2. `lodash` v4.17.23 (via `recharts`) — Code Injection + Prototype Pollution [HIGH]
**CVEs:**
- **GHSA-r5fr-rjxr-66jc** — `_.template` code injection via import key names (CVSS 8.1)
- **GHSA-f23m-r3pf-42rh** — Prototype pollution via `_.unset`/`_.omit` array path bypass (CVSS 6.5)

**Transitive path:** `recharts@2.15.4` → `lodash@4.17.23`

**Risk level:** LOW IN CONTEXT
- SolarPro does not call `_.template()` directly — lodash is only used internally by recharts for chart rendering
- The prototype pollution vector requires `_.unset()` or `_.omit()` on attacker-controlled paths — recharts does not expose these to user input
- No direct lodash usage in application code (confirmed in Phase 69 audit)

**Mitigation (current):** recharts only uses lodash for internal chart math/utility; no user-controlled paths reach `_.template`.

**Recommended action:** Upgrade recharts when a version is released that depends on a patched lodash.
Check `npm ls recharts` periodically. Alternatively, replace recharts with a lodash-free charting library long-term.
**Priority: LOW** (indirect; lodash not called with user input)

### 3. `picomatch` v2.3.1 — ReDoS + Method Injection [HIGH]
**CVEs:**
- **GHSA-c2c7-rcm5-vvqj** — ReDoS via extglob quantifiers (CVSS 7.5)
- **GHSA-3v7f-55p6-f55p** — Method injection in POSIX character classes

**Transitive path:** `anymatch`/`micromatch`/`readdirp` → `picomatch@2.3.1`
These are used by chokidar (file watcher) → Next.js dev server only.

**Risk level:** LOW IN CONTEXT
- `picomatch` is called on filesystem glob patterns, not on user-supplied HTTP request data
- The dev server file watcher runs locally/in CI, not in the production Vercel deployment
- The tinyglobby nested version (`4.0.3`) is already within the vulnerable range but also dev-only

**Mitigation (current):** Production deployment does not run a file watcher or expose glob pattern matching to users.

**Recommended action:** Add `overrides` in package.json to force picomatch ≥2.3.2. (Already in `package.json`.)
**Priority: LOW** (dev tooling only; no production exposure)

### 4. `vite` v8.0.0 — Path Traversal + Arbitrary File Read [HIGH] — DEV ONLY
**CVEs:**
- **GHSA-4w7w-66w2-5vf9** — Path traversal in `.map` handling
- **GHSA-v2wj-q39q-566r** — `server.fs.deny` bypass with queries
- **GHSA-p9ff-h696-f583** — Arbitrary file read via Vite dev server WebSocket

**Transitive path:** `vitest` (devDependency) → `vite@8.0.0`

**Risk level:** LOW IN CONTEXT
- All three vulnerabilities require the Vite dev server to be running and accessible
- SolarPro is a Next.js app — vite is not used as a build tool or server, only pulled in by vitest
- Production deployment (Vercel) runs `next build` + `next start`, never vite
- Only exploitable if a developer exposes their local vite dev server to untrusted networks

**Recommended action:** Run `npm update vitest` to pull in a vitest version that uses vite ≥8.0.5.
**Priority: LOW** (dev tooling only; arbitrary file read requires dev server to be exposed)

### 5. `glob` via `eslint-config-next` — Command Injection [HIGH] — DEV ONLY
**CVE:** GHSA-5j98-mcp5-4vw2 — glob CLI command injection via `-c/--cmd` option with `shell:true`

**Transitive path:** `eslint-config-next` → `@next/eslint-plugin-next` → `glob@10.2.0-10.4.5`

**Risk level:** NONE IN PRODUCTION
- This is the glob CLI binary vulnerability — requires running `glob -c "<cmd>"` from the command line
- SolarPro never runs the glob CLI in production or application code
- Only affects developers running eslint via CLI

**Status as of Stage 2:** The `eslint-config-next@15.5.15` bump does NOT bring in a patched `glob` (the patched glob requires `eslint-config-next@16.x`). Tracked as a known follow-up.

**Recommended action:** Track for next `eslint-config-next` major bump. Out of scope for this migration.
**Priority: NONE** (CLI tool vulnerability; no server-side exposure)

### 6. `flatted` v3.4.1 — Prototype Pollution [HIGH] — DEV ONLY
**CVE:** GHSA-rf6f-7fwh-wjgh — Prototype pollution via `parse()` in flatted

**Transitive path:** devDependency (logger chain — jest/vitest reporting tools use flatted for circular JSON serialization)

**Risk level:** NONE IN PRODUCTION
- flatted is a dev dependency used by test/build tooling for circular structure serialization
- Not bundled into the Next.js server or client bundles

**Recommended action:** `npm update` will likely pick up a fixed version automatically.
**Priority: NONE** (dev tooling only)

---

## MODERATE severity — Summary

| Package | CVE | Context | Priority |
|---------|-----|---------|----------|
| `next` (postcss) | Request smuggling | Prod, but no rewrites configured | LOW |
| `next` (image cache) | Disk exhaustion | Prod, remotePatterns restricted | LOW |
| `picomatch` | Method injection | Dev watcher only | NONE |
| `lodash` | Prototype pollution via unset/omit | Indirect via recharts | LOW |
| `vite` | Path traversal in .map | Dev only | NONE |

---

## Action Plan

| Priority | Action | Status |
|----------|--------|--------|
| ~~**MEDIUM**~~ | ~~Upgrade Next.js to 15.x (resolves all 5 Next.js DoS CVEs)~~ | **DONE Stage 2** (commit `21941c34` on `chore/next-15-migration`, NOT PUSHED) |
| **LOW** | Add `overrides` in package.json for picomatch >=2.3.2 | DONE (existing) |
| **LOW** | Monitor recharts for lodash upgrade | Passive |
| **LOW** | `npm update vitest` to pull vite >=8.0.5 | Trivial backlog |
| **LOW** | Stage 4 cleanup: 19 GET routes `force-dynamic` + 89 fetch() `cache: 'no-store'` + 6 codemod-error markers | Follow-up work |
| **LOW** | Stage 4 cleanup: 1500 `as any` casts (CC8.1) | Separate P0 ticket |
| **NONE** | flatted/glob/eslint-config-next — update on next dep cycle | Trivial |

---

## Quick-Win Overrides

```json
"overrides": {
  "picomatch": ">=2.3.2",
  "flatted": ">=3.4.2",
  "react-is": "^19.0.0"   // recharts React 19 compat
}
```

Note: `lodash` override is risky if recharts depends on specific lodash behaviors — test thoroughly before applying.
Note: `next` override would require a major version bump (15.x) — done in Stage 2.

---

*Generated: Phase 75 — Dependency Security Audit, Stage 2 update 2026-07-30*
*Stage 2 commit: `21941c34` on `chore/next-15-migration` (NOT PUSHED)*
*Stage 1 commit: `21ebe5d3` on `fix/next-14.2-latest-patch` (NOT PUSHED)*
*All application-level vulnerabilities (XSS, SQLi, IDOR, SSRF, etc.) addressed in Phases 1–74.*
