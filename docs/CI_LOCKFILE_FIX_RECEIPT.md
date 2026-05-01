# CI Lockfile Fix — Receipt

**Date:** 2026-04-30
**Target branch:** master
**Commit:** `730db6b`
**Status:** ✅ All CI gates green, Vercel deploy READY

---

## 1. Problem

User reported: *"I got an email about CI failures. Went to test log in. Did not work."*

GitHub Actions CI was failing on master for 3 consecutive commits (`de51207`, `1ce74c0`, `28295d2`). All 4 gates (TypeScript, Vitest, ESLint, Build) were failing at the `npm ci` step:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json
  or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install`.
npm error Invalid: lock file's picomatch@2.3.1 does not satisfy picomatch@4.0.4
npm error Invalid: lock file's flatted@3.4.1 does not satisfy flatted@3.4.2
```

---

## 2. Root cause

Earlier in the session, to deploy the Upstash rate-limiter diagnostic instrumentation, I ran:

```bash
npm install --no-save jsonwebtoken
npm install --prefer-offline
```

These updated transitive dependencies in `node_modules` *and* silently drifted `package-lock.json` (even though `package.json` itself didn't change), then I committed the drifted lockfile by accident along with unrelated work.

CI uses `npm ci` which demands the lockfile be a byte-exact match of the resolved dep tree — unlike `npm install`, it won't repair.

**Note:** login investigation was unaffected by this — the login user-reported issue was already resolved by the Upstash 500ms timeout fix (`3f59387`). Login on production is verified fast (1.1-1.7s). The "login didn't work" in the user's report was likely the CI failure email making the user think deploys were broken.

---

## 3. Fix

```bash
git checkout dev
npm install --package-lock-only   # regenerates lockfile without touching node_modules
```

Result: 1 file changed, 13 insertions(+), 77 deletions(-).

Key changes:
- `picomatch`: top-level `2.3.1` → `4.0.4` (matches package.json)
- `flatted`: `3.4.1` → `3.4.2`
- 3 duplicate `picomatch@4.0.3` entries under `tinyglobby/`, `vite/`, `vitest/` deduped up to the new top-level `4.0.4`
- `"dev": true` metadata stripped from `esbuild` platform-specific binaries (cosmetic cleanup)

**No runtime source code was touched.**

---

## 4. Local verification (gate trio)

| Gate | Command | Result |
|---|---|---|
| `npm ci` | `npm ci --prefer-offline` | ✅ `added 819 packages in 18s` |
| Type-check | `npm run type-check` | ✅ exit 0 |
| Lint | `npm run lint` (next lint) | ✅ exit 0, warnings only |
| Tests | `npm test` (vitest run) | ✅ **68 files / 2583 tests passed** |

---

## 5. Commit & push

```
730db6b fix(ci): regenerate package-lock.json to satisfy npm ci
28295d2 chore(login): remove diagnostic timing instrumentation
3f59387 fix(login): hard 500ms timeout on Upstash rate limiter
```

- Committed to `dev` → pushed `28295d2..730db6b dev -> dev`
- Fast-forward merged `dev → master` → pushed `28295d2..730db6b master -> master`

---

## 6. CI verification

**Run:** https://github.com/rayobrian6/Solarpro/actions/runs/25140925722 (commit `730db6b`)

| Job | Before (28295d2) | After (730db6b) |
|---|---|---|
| TypeScript Type Check | ❌ failure | ✅ **success** |
| Unit Tests (vitest) | ❌ failure | ✅ **success** |
| ESLint | ❌ failure | ✅ **success** |
| Build Gate | ❌ failure | ✅ **success** |
| Env Var Audit | ✅ success | ✅ **success** |
| **CI Complete** | ❌ failure | ✅ **success** |

---

## 7. Vercel production deploy

- Project: `solarpro-v31` (prj_3z2bHLwC8PbzIivXWatE1GL2rp2n)
- Commit: `730db6b`
- State: **READY**
- Domain: `solarpro.solutions`

---

## 8. Post-deploy smoke tests (production)

| Check | Result |
|---|---|
| Admin login (raymond.obrian@yahoo.com) | ✅ 200 in **1727ms** |
| Reviewer login (googleplay.reviewer@solarpro.solutions) | ✅ 200 in **1288ms** |
| Bad password rejection | ✅ 401 in **1158ms** |
| `/api/auth/me` admin session | ✅ `super_admin`, `hasAccess: true`, `plan: contractor` |
| Env fingerprint | ✅ All 6 critical env vars present and not placeholders |

Login latency remains fast (1.1-1.7s), confirming the Upstash rate-limiter 500ms timeout fix (`3f59387`) is still active in the new build.

---

## 9. Lessons learned

- Never run `npm install` or `npm install --no-save` on a feature branch without committing `package-lock.json` alongside — always keep it in sync.
- For future transitive-dep upgrades, use `npm install --package-lock-only` (fast, no node_modules changes).
- Add a CI health check reminder: if `npm ci` fails, 100% of the time the answer is to regenerate the lockfile on dev and merge forward.

