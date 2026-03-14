// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.62';
export const APP_VERSION       = BUILD_VERSION; // alias used by health route
export const BUILD_DATE        = '2026-03-14';
export const BUILD_DESCRIPTION = 'v47.62: Security fixes (proposals PUT auth, equipment/save auth, aerial API key, reset-raymond disabled). Pipeline await fix. Structured PIPELINE_STAGE_START/COMPLETE/ERROR logs in syncPipeline + pipeline/run. TypeScript 0 errors, ESLint 0 errors.';
export const BUILD_FEATURES    = [
  // v47.62 -- Security fixes + pipeline logging
  'SECURITY: PUT /api/proposals/[id] added auth check + ownership JOIN',
  'SECURITY: POST /api/equipment/save added session auth, removed body userId',
  'SECURITY: GET /api/debug/aerial removed hardcoded API key, added auth guard',
  'SECURITY: GET /api/admin/reset-raymond permanently disabled (410 Gone)',
  'PIPELINE: PIPELINE_STAGE_START/COMPLETE/ERROR logs in syncPipeline.ts and pipeline/run',
  // v47.61 -- Second-pass audit
  'AUDIT: v47.61 second-pass full codebase re-audit',
  // v47.60 -- Full system audit
  'AUDIT: Phase 1 (Static Analysis) — tsc --noEmit = 0 errors, ESLint 0 errors after .eslintrc.json setup and stray eslint-disable comment cleanup',
  'AUDIT: Phase 2 (Dependency Audit) — jspdf 2.5.2→4.2.0 (critical ReDoS CVE-2025-68428 fixed, browser-only usage, API compatible). Next.js 14.2.3→14.2.35 (9 vulns fixed). minimatch ReDoS fixed via npm audit fix. Remaining 4 HIGH (next DoS needs v16, glob in eslint devDep) documented as accepted risk.',
  'AUDIT: Phase 3 (Auth Flow) — login cookie confirmed: response.cookies.set(), httpOnly, sameSite=lax, path=/. VERCEL_ENV guard in dev-auth confirmed. Stale NODE_ENV comment fixed in middleware.ts.',
  'AUDIT: Phase 4 (DB Audit) — project_files schema confirmed in /api/migrate. upsertFile() column set and ON CONFLICT target match UNIQUE constraint (project_id, user_id, file_name). All DB query field names verified against schema.',
  'AUDIT: Phase 5 (API Routes) — 89 routes audited. All critical routes (pipeline/run, save-outputs, projects, clients, proposals, settings) have getUserFromRequest() auth guards.',
  'AUDIT: Phase 6 (Pipeline Logic) — buildAllArtifacts() confirmed generating real content: Engineering_Report (text), SLD (SVG), BOM (CSV), Permit_Packet (text), System_Estimate (text). BP-3 fix verified end-to-end.',
  'AUDIT: Phase 7 (Logging) — pipeline has 14 structured logs with projectId. Auth routes have 15 [AUTH_*] log codes. save-outputs has projectId in all log paths.',
  'AUDIT: Phase 8 (Final) — tsc --noEmit 0 errors, ESLint 0 errors/62 warnings (all intentional react-hooks/exhaustive-deps + import/no-anonymous-default-export).',
  // v47.59 -- Auth permanent fix
  'AUTH FIX: lib/dev-auth.ts — isDevAuthAllowed() now uses VERCEL_ENV !== production (not NODE_ENV). NODE_ENV=production on ALL Vercel deployments including preview — using it as a guard permanently blocked dev auth on all Vercel environments.',
  'AUTH FIX: VERCEL_ENV is the authoritative signal: production→block, preview→allow if DEV_AUTH_BYPASS=true, development→allow if DEV_AUTH_BYPASS=true, not_set→local dev→allow if DEV_AUTH_BYPASS=true',
  'AUTH FIX: /api/auth/me now logs JWT_SECRET fingerprint on every 401 (AUTH_COOKIE_MISSING) — previously only logged on login. Fingerprint mismatch between environments is now immediately visible in logs.',
  'AUTH FIX: /api/debug/auth — added devAuthAllowed, devAuthBypassed, devAuthBypassEnvSet, diagnosisHints[], nodeEnv/vercelEnv distinction explanation',
  'AUTH FIX: .env.example — JWT_SECRET section updated with Vercel multi-environment setup (Production+Preview+Development must use SAME secret). Dev auth bypass section rewritten with correct VERCEL_ENV guard explanation.',
  'AUTH FIX: Root cause documented — v47.57 isDevAuthAllowed() checked NODE_ENV!==production which is always false on Vercel, making DEV_AUTH_BYPASS=true completely ineffective for all Vercel preview deployments.',
  // v47.58 -- Pipeline audit and repair (BP-3 fix)
  'PIPELINE FIX: /api/pipeline/run steps 6-9 now WRITE real artifact files to project_files (previously only checked boolean flags, wrote nothing)',
  'PIPELINE FIX: buildAllArtifacts() from lib/engineering/artifactBuilders.ts generates Engineering_Report, SLD, BOM, Permit_Packet, System_Estimate server-side',
  'PIPELINE FIX: upsertFile() helper in pipeline/run mirrors save-outputs pattern — ON CONFLICT upsert with DELETE+INSERT fallback',
  'PIPELINE FIX: artifactResult now reports filesWritten (actual count) and fileNames (actual list) instead of flag booleans',
  'PIPELINE FIX: Client Files workspace populates from artifact registry immediately after RUN PROJECT PIPELINE click',
  'PIPELINE FIX: Mismatch PIPELINE_ARTIFACT_WRITE_FAILED fires if 0 files written; PIPELINE_ARTIFACT_REGISTRY_OUT_OF_SYNC if < 5 written',
  'PIPELINE FIX: lib/engineering/artifactBuilders.ts — SystemSummary.stateCode does not exist; fixed to use sys.address + sys.ahj (0 TS errors)',
  // v47.57 -- Dev auth bypass
  'DEV AUTH: lib/dev-auth.ts — single source of truth for bypass logic. Active only when NODE_ENV!==production AND VERCEL_ENV!==production AND DEV_AUTH_BYPASS=true.',
  'DEV AUTH: middleware.ts — checks dev bypass before JWT decode. Passes x-dev-auth-user-id/email headers downstream.',
  'DEV AUTH: lib/auth.ts getUserFromRequest() — checks dev bypass before cookie parse. Falls through to normal JWT auth if bypass inactive.',
  'DEV AUTH: /api/auth/me — returns full dev user response (super_admin, plan=pro, hasAccess=true) when bypass active. No DB call.',
  'DEV AUTH: Log code [DEV_AUTH_ACTIVE] — emitted on every bypassed request. Searchable in Vercel function logs.',
  'DEV AUTH: .env.example — full documentation for DEV_AUTH_BYPASS, DEV_AUTH_USER_ID, DEV_AUTH_USER_EMAIL, DEV_AUTH_USER_NAME.',
  'DEV AUTH: Production hard-block — isDevAuthAllowed() returns false when NODE_ENV=production OR VERCEL_ENV=production, regardless of env vars.',
  // v47.56 -- Pipeline Verification System
  'PIPELINE: RUN PROJECT PIPELINE button in Client Files tab — POST /api/pipeline/run, full 11-step orchestration',
  'PIPELINE: Status Panel — live subsystem rows for Layout, Engineering, Artifacts, Permit Sheets, Client Files, Workflow, Pipeline Steps',
  'PIPELINE: Mismatch detection — PIPELINE_MISMATCH_ENGINEERING_MODEL_STALE, PIPELINE_ARTIFACT_REGISTRY_OUT_OF_SYNC, PIPELINE_ARTIFACT_REGISTRY_EMPTY with severity ERROR/WARNING',
  'PIPELINE: Expandable raw data sections — click chevron on any subsystem row to expand full JSON',
  'PIPELINE: /api/pipeline/run — POST endpoint, all 11 steps, PipelineRunResult with steps[], layout, engineering, artifacts, permit, clientFiles, workflow, mismatches, errors',
  'PIPELINE: /api/debug/project?id=<projectId> — GET diagnostic endpoint, layout/engineering/artifact/permit/workflow summaries, isStale flag',
  'PIPELINE: Structured logs — LAYOUT_LOADED, ENGINEERING_REBUILD_STARTED, ENGINEERING_REBUILD_COMPLETED, ARTIFACT_GENERATION_STARTED, ARTIFACT_GENERATION_COMPLETED, PIPELINE_MISMATCH',
  'PIPELINE: Workflow completion from actual data (layout.panels, engineering.exists, permit.ready, files.count) — not p.status',
  'PIPELINE: Client Files sync from artifact registry after each pipeline run',
  // v47.55 -- Auth server-side investigation and fix
  'AUTH FIX: Remove "source":"/(.*)" Cache-Control: no-store from vercel.json — this header rule applied to /api/auth/login and caused Vercel edge proxy to strip Set-Cookie on login response',
  'AUTH FIX: Remove catch-all "/(.*)" from next.config.js async headers() — changed to "/((?!api|_next/static|_next/image|favicon.ico).*)" to exclude /api routes',
  'PHASE 1: Login route — AUTH_COOKIE_SET structured log: cookieName, hasSetCookieHeader, setCookiePreview, secure, sameSite, path, domain, maxAge, nodeEnv',
  'PHASE 2: Middleware — AUTH_REQUEST_COOKIES log: path, rawCookieHeaderPresent, rawCookiePreview, parsedCookieNames, expectedCookieName, hasExpectedCookie',
  'PHASE 2: Middleware — AUTH_SESSION_VALIDATION log: path, hasCookie, tokenParsed, tokenValid, userId, email',
  'PHASE 3: Cookie name confirmed — COOKIE_NAME="solarpro_session" used consistently in login route, middleware, /api/auth/me, and debug endpoint',
  'PHASE 4: Cookie config in production — secure=true (NODE_ENV=production), sameSite=lax, path=/, domain=omitted, maxAge=30days',
  'PHASE 5: AUTH_SECRET_FINGERPRINT log in login route — len, head[4], tail[4], charSum mod 9999 (no secret exposed) — confirms JWT_SECRET stability across deployments',
  'PHASE 6: GET /api/debug/auth — safe diagnostic endpoint: cookie presence, all cookie names, expected name, session validity, secret fingerprint, env. Added to PUBLIC_PATHS.',
  'PHASE 7: Preview deployment to verify before production push',
  'PHASE 8: Login page — after 200 OK, verify /api/debug/auth shows hasAuthCookie=true. If false, show "Authentication cookie was not issued" error instead of silently redirecting to broken session.',
  // v47.54 -- Full system audit
  'AUDIT: 10-phase full system audit (SYSTEM_AUDIT_v47.54.md)',
  'WORKFLOW: Fix design/engineering step checks to use layout.panels.length > 0',
  'PERMIT: ENGINEERING_MODEL_STALE guard + remove 9.6kW/24-panel silent defaults',
  // v47.53 -- Auth fix attempt 1
  'AUTH: response.cookies.set() replaces raw Set-Cookie header',
  'AUTH: removed vercel.json /api cache header override (partial — was only /api pattern, missed /(.*) catch-all)',
  'AUTH: removed router.refresh() race condition',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} - ${BUILD_DATE}`;
}