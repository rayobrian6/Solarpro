# HANDOFF — Local DB Setup for save-client (worklaptop)

**Date:** 2026-06-30
**Branch:** `james-dev`
**Subject:** Make `POST /api/clients` actually save a client when running locally
(Neon HTTP driver can't reach plain `postgresql://localhost`, so the dev env
returned 503 `DB_CONFIG_ERROR` on every DB-touching route — including the one
that saves a client.)

---

## Standing Rules (restated for this work)

- **R1** — No push to `master`. This handoff lands on `james-dev`. JAMES
  decides when to push and merge.
- **R2** — Three-check suite (`tsc` / `eslint` / `vitest`) before any push.
  `tsc --noEmit --skipLibCheck` was run on `lib/db-ready.ts` only (clean);
  full project `tsc` was not re-run after the bundling-externals change.
  Re-run before pushing.
- **R3** — Terminology. No changes here.
- **R4** — Working branch = `james-dev` (JAMES's call).
- **R5** — No geometry artifact touched.
- **R6** — `feat:` commits attributed to JAMES. The work below is closer to
  `chore: enable local DB` and `docs: handoff` — author per usual practice;
  JAMES signs off.
- **Hard no-go §3** — None triggered (no master push, no secret rotation, no
  env-var mutation on Vercel/Render, no prod migration, no `REVIEW_ONLY`
  bypass, no force-push). Local-only changes; `.env.local` was the only
  config touched and it is git-ignored.

---

## What Was Done

Diagnosed "failing to save client" as a two-part problem and fixed both:

1. **Driver incompatibility:** `lib/db/core.ts` and `lib/db-ready.ts` use
   `neon(url)` from `@neondatabase/serverless`. That driver is **HTTP-only**
   and expects a Neon endpoint URL (`ep-…-pooler.region.azure.neon.tech`).
   It cannot talk to a plain `postgresql://127.0.0.1:5432/...` — every DB
   call returned `DbConfigError`. Authoritative Neon host is documented in
   `AI-AGENT-README.md:90`.

2. **Bundling collision:** `app/clients/new/page.tsx` is a `'use client'`
   component that transitively imports `lib/db-neon.ts` (via
   `components/ui/AppShell.tsx` → `lib/permissions.ts` → `lib/stripe.ts` →
   `lib/db-neon.ts` → `lib/db/core.ts` → `lib/db-ready.ts` →
   `pg`/`pg-connection-string`). Webpack tried to bundle `pg` (a Node-only
   library that needs `fs`, `net`, `pg-native`) for the browser, failed,
   and broke compilation for both client and server routes.

**Fix:**

A. **`lib/db-ready.ts`** — added local-URL auto-detection + a thin
`pg.Pool`-backed adapter that mimics `neon()`'s tagged-template API and
the one `sql.transaction(cb)` callsite in
`lib/siteSurveys/unifiedGeometry/promotionStore.ts`. Falls through to
`neon(url)` unchanged for non-local URLs (Neon prod / preview keeps
working as-is).

B. **`next.config.js`** — added `'pg'` and `'pg-connection-string'` to
both `experimental.serverComponentsExternalPackages` and the webpack
`config.externals` array, so webpack stops trying to bundle them for the
client. Server bundling behaviour unchanged.

C. **`.env.local`** — appended:
- `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/solarpro_dev`
  (Postgres 16 already installed locally; `solarpro_dev` database
  created; `pg_hba.conf` flipped to `trust` auth on localhost by the
  earlier session — leaving that in place, matches what we tested with)
- `MIGRATE_SECRET=local_dev_migrate_secret_2026` (for the
  `/api/migrate` route)
- `DEV_AUTH_USER_ID=d466c3e5-6cd0-4fa1-8f66-91297e96e5b0`,
  `DEV_AUTH_USER_EMAIL=carpenterjames88@gmail.com`,
  `DEV_AUTH_USER_NAME="JAMES (Dev Bypass)"` (see "Architecture Notes"
  for why)
- Required env-var reload: dev server restarted after appending

D. **Schema bootstrapped** against `solarpro_dev` by POSTing the local
`MIGRATE_SECRET` to `/api/migrate`. All `IF NOT EXISTS` migrations ran
clean (`productions`, `proposals`, `users` columns, `utility_policies`,
`bills`, `enterprise_leads`, `project_files`, etc.).

**Save-client verified**: JAMES confirmed `POST /api/clients` works end-to-
end on a separate box after Syncthing pulled the changes.

---

## Current State

- **Branch:** `james-dev`
- **Working tree (worklaptop, modified files):**
  - `lib/db-ready.ts` — Pool adapter (this work)
  - `next.config.js` — pg in externals + serverComponentsExternalPackages
  (this work)
  - `app/api/auth/login/route.ts` — **NOT touched in this handoff**,
  pre-existing modification carried in working tree
  - `app/auth/login/page.tsx` — same, pre-existing
  - `app/dashboard/page.tsx` — same, pre-existing
  - `package.json` — same, pre-existing (verify whether dev added
  anything; nothing I added goes through `npm install` — `pg` and
  `@neondatabase/serverless` were already in `package.json`)
  - `.next.bak.130508/` — leftover from a `.next/` cache move during
  the restart. Safe to `git clean -fd` it.
- **`.env.local`** — additions as listed above. Git-ignored.
- **DB:** `solarpro_dev` on local Postgres 16 (trust auth). Six real
  users preserved by migration step
  `Free pass updated (existing user, real password preserved)`:
  `raymond.obrian@yahoo.com` (super_admin),
  `carpenterjames88@gmail.com` (admin = JAMES),
  `cody@underthesun.solutions`, `angelique@lmdsolarllc.com`,
  `utsmarketing25@gmail.com`, `sarah@solfence.solar`.
- **Three-check status:**
  - `npx tsc --noEmit --skipLibCheck` on the new code: ✅ clean
  - `npx next lint`: not re-run after the changes
  - `npx vitest run`: not re-run after the changes
  - **Action for JAMES:** run all three before pushing.

---

## Files Modified (this handoff)

| File | Role |
|---|---|
| `lib/db-ready.ts` | Local-URL detection + `pg.Pool` adapter mirroring `neon()` + `sql.transaction()` |
| `next.config.js` | `pg` / `pg-connection-string` added to `experimental.serverComponentsExternalPackages` and webpack `config.externals` |
| `.env.local` | `DATABASE_URL`, `MIGRATE_SECRET`, `DEV_AUTH_USER_ID/EMAIL/NAME` appended |
| `HANDOFF_local_db_setup.md` | This file |

---

## Pending Work (priority order)

1. **Run the full three-check suite** (`tsc` / `eslint` / `vitest`)
   before pushing. Per R2.
2. **The architectural debt is still there.** `lib/permissions.ts`
   imports `getPlanPermissions` (pure) from `lib/stripe.ts`, but
   `lib/stripe.ts` also imports `getDbReady` from
   `lib/db-neon.ts`. Pulling the pure function drags the whole module
   — and the whole DB chain — into the client bundle. The pg-externals
   workaround unblocks the build; it does not fix the design. Suggested
   follow-up: split `lib/stripe.ts` into
   `lib/stripe/plans.ts` (pure, no DB) and `lib/stripe/server.ts`
   (DB-touching). Then `lib/permissions.ts` imports only the pure side.
3. **Local smoke test was never completed on this box.** JAMES verified
   save-client works on a separate box (changes picked up via
   Syncthing). The worklaptop dev server is currently NOT running —
   it was killed during a restart attempt, then the daemon crashed
   and a restart never happened. Restart with `next dev -p 3000`
   and run `POST /api/clients` locally to confirm parity.
4. **F-13 is still open** (`AI-AGENT-README.md:410`): the
   `carpenterjames88@gmail.com` hardcoded admin override in
   `users.ts`. The dev bypass now uses that user's real UUID, which
   is consistent with F-13's intent but doesn't close it.
5. **The pg_hba.conf trust-auth change.** It was made by an earlier
   session before this one. Fine for dev; flag for cleanup if you
   ever need to share the machine.

---

## Architecture Notes (for future agents)

- **Why the adapter, not a proxy.** Neon's HTTP driver wouldn't talk
  to local Postgres; running a `wsproxy`/Neon-local-proxy adds infra.
  A 70-line `pg.Pool` adapter in `lib/db-ready.ts` matches the
  existing `NeonQueryFunction<false, false>` shape closely enough
  that all 1615+ `await sql\`SELECT …\`` callsites work unchanged.
  The one `sql.transaction(cb)` callsite
  (`lib/siteSurveys/unifiedGeometry/promotionStore.ts:94`) also
  works because the adapter implements the array-overload form
  (`BEGIN`/`COMMIT`/`ROLLBACK` over a pooled `PoolClient`).

- **Why URL shape, not env var.** The adapter detects locality from
  the URL host (`@localhost` / `@127.0.0.1` / `@::1` /
  `@0.0.0.0`). No new env var required, and you can flip between
  local and a Neon dev branch by editing `DATABASE_URL` alone. Same
  code on prod (Neon HTTP) and dev (pg.Pool).

- **Why the dev bypass needed a real UUID.** Postgres `users.id` is
  `uuid`. The default `DEV_AUTH_USER_ID` was the string
  `"dev-user-bypass-001"`. Every query that filtered by
  `user_id = ${user.id}` died at the driver with
  `invalid input syntax for type uuid`. Pointing the bypass at
  JAMES's existing `carpenterjames88@gmail.com` admin row gives us
  a real UUID and a real user record (with plan/role) for free.
  This is a side-effect of F-13, which is why F-13 should still
  close eventually.

- **Server-only enforcement is still loose.** Per
  `lib/db-neon.ts:9-18`'s own warning, and per the chain under
  `lib/permissions.ts` (see Pending Work #2), nothing prevents a
  future client component from re-introducing the bundling error.
  Adding `import 'server-only'` at the top of `lib/db-ready.ts`
  would make the failure mode loud at build time. Hold for the
  architecture split so it doesn't churn alongside it.

---

## Next Steps (concrete, ordered)

1. `pnpm tsc --noEmit --skipLibCheck && pnpm next lint && pnpm vitest run`
   in the worklaptop `solar-pro` repo. Fix anything red.
2. `git -C "C:\Users\carpe\.minimax-agent\projects\solar-pro" add lib/db-ready.ts next.config.js HANDOFF_local_db_setup.md`
   then commit (suggested: `chore: enable local Postgres for dev (pg.Pool adapter + pg externals)`).
3. `git clean -fd .next.bak.130508` (untracked backup, no value kept).
4. Optional: decide whether to land JAMES's other in-flight changes
   (`app/api/auth/login/route.ts`, `app/auth/login/page.tsx`,
   `app/dashboard/page.tsx`, `package.json`) in the same push or
   separate. Per R4 / strict mode, your call.
5. Restart `next dev -p 3000` locally and POST to `/api/clients` to
   verify parity with what you saw on the other box.
6. Long-term: refactor `lib/stripe.ts` so
   `lib/permissions.ts` doesn't transitively pull DB code into the
   client bundle. Follow-up task, separate PR.
7. When you say "ship it" I push `james-dev` and surface the diff +
   three-check output. Until then, nothing leaves the box.

---

*Prepared by `manager` on 2026-06-30. JAMES verified save-client works on a
separate box after Syncthing pulled the changes; local smoke test on this
box was not completed before the daemon restart was interrupted.*
