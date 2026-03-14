// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.56';
export const APP_VERSION       = BUILD_VERSION; // alias used by health route
export const BUILD_DATE        = '2026-06-09';
export const BUILD_DESCRIPTION = 'v47.56: Pipeline Verification System — RUN PROJECT PIPELINE button, status panel for all subsystems (layout/engineering/artifacts/permit/client files/workflow), mismatch detection, expandable raw data sections, /api/pipeline/run, /api/debug/project endpoints.';
export const BUILD_FEATURES    = [
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