# SolarPro — Dependency Security Advisory
*Generated during Phase 75 security audit*

## Summary

```
npm audit: 0 critical, 8 high, 7 moderate — 15 total
```

---

## HIGH severity — Triage & Recommendations

### 1. `next` v14.2.35 — Multiple DoS CVEs [HIGH]
**CVEs affecting current version:**
- **GHSA-q4gf-8mx6-v5v3** — Next.js DoS with Server Components (`>=13.0.0 <15.5.15`)
- **GHSA-h25m-26qc-wcjf** — HTTP request deserialization DoS via insecure RSC (`>=13.0.0 <15.0.8`)
- **GHSA-ggv3-7p47-pfv8** — HTTP request smuggling in rewrites (`>=9.5.0 <15.5.13`)
- **GHSA-9g9p-9gw9-jx7f** — Image Optimizer remotePatterns DoS (`>=10.0.0 <15.5.10`)
- **GHSA-3x4c-7xq6-9pq8** — next/image disk cache exhaustion (`>=10.0.0 <15.5.14`)

**Risk level:** All are DoS (denial of service), not RCE or data exfiltration.
The RSC deserialization CVE is the most relevant — SolarPro uses App Router/RSC extensively.

**Mitigation (current):**
- App Router is used but RSC data sources are DB-backed (Neon/PostgreSQL), not untrusted user-controlled RSC payloads.
- `remotePatterns` in `next.config.js` is already restricted to `api.mapbox.com` and `maps.googleapis.com` only.

**Recommended action:** Upgrade to `next@15.x` after testing the App Router migration.
This is a significant migration (documented in prior audit phases) — plan accordingly.
**Priority: MEDIUM** (DoS only; remotePatterns already restricted; no RCE vector)

---

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

---

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

**Recommended action:** Add `overrides` in package.json to force picomatch ≥2.3.2.
**Priority: LOW** (dev tooling only; no production exposure)

---

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

---

### 5. `glob` via `eslint-config-next` — Command Injection [HIGH] — DEV ONLY
**CVE:** GHSA-5j98-mcp5-4vw2 — glob CLI command injection via `-c/--cmd` option with `shell:true`

**Transitive path:** `eslint-config-next` → `@next/eslint-plugin-next` → `glob@10.2.0-10.4.5`

**Risk level:** NONE IN PRODUCTION
- This is the glob CLI binary vulnerability — requires running `glob -c "<cmd>"` from the command line
- SolarPro never runs the glob CLI in production or application code
- Only affects developers running eslint via CLI

**Recommended action:** Upgrade `eslint-config-next` when Next.js 15 migration is complete.
**Priority: NONE** (CLI tool vulnerability; no server-side exposure)

---

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

| Priority | Action | Effort |
|----------|--------|--------|
| **MEDIUM** | Upgrade Next.js to 15.x (resolves all Next.js CVEs) | High — breaking changes |
| **LOW** | Add `overrides` in package.json for picomatch >=2.3.2 | Low |
| **LOW** | Monitor recharts for lodash upgrade | Passive |
| **LOW** | `npm update vitest` to pull vite >=8.0.5 | Low |
| **NONE** | flatted/glob/eslint-config-next — update on next dep cycle | Trivial |

---

## Quick-Win Overrides

Add to `package.json` to force patched transitive versions:

```json
"overrides": {
  "picomatch": ">=2.3.2",
  "flatted": ">=3.4.2"
}
```

Note: `lodash` override is risky if recharts depends on specific lodash behaviors — test thoroughly before applying.
Note: `next` override would require a major version bump (15.x) — not a simple override.

---

*Generated: Phase 75 — Dependency Security Audit*
*All application-level vulnerabilities (XSS, SQLi, IDOR, SSRF, etc.) addressed in Phases 1–74.*