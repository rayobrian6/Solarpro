/**
 * lib/envGuard.ts
 *
 * PIPELINE INTEGRITY GUARD — imported by app startup and health checks.
 *
 * Validates every environment variable that is load-bearing for the
 * survey → SolarPro ingest pipeline. Call assertPipelineEnv() at cold-start.
 *
 * DO NOT remove or bypass these checks. They exist because a misconfigured
 * env var silently breaks webhook verification or ingest with no obvious
 * error until a field worker submits a survey and it vanishes.
 *
 * Variables checked:
 *   SURVEY_WEBHOOK_SECRET        — HMAC verification of inbound webhooks
 *   SOLARPRO_HANDOFF_SECRET      — Mobile proxy JWT verification
 *   MOBILE_SERVICE_API_KEY       — Service-to-service key (Path B auth)
 *   MOBILE_SERVICE_USER_ID       — Fallback owner UUID for ingest
 *   SURVEY_INGEST_DEFAULT_USER_ID — Owner of auto-created projects
 *   DATABASE_URL                 — Neon DB connection
 *   JWT_SECRET                   — SolarPro session auth
 *   PARTNER_BASE_URL             — Render backend URL for survey payload fetch
 */

interface EnvCheck {
  name: string;
  status: "ok" | "missing" | "too_short" | "invalid_format";
  len?: number;
  note: string;
  fatal: boolean;
}

export interface EnvGuardResult {
  ok: boolean;
  checks: EnvCheck[];
  errors: string[];
  warnings: string[];
}

export function checkPipelineEnv(): EnvGuardResult {
  const checks: EnvCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  function check(
    name: string,
    opts: { minLen?: number; mustStartWith?: string; fatal: boolean; note: string }
  ) {
    const val = process.env[name]?.trim();
    if (!val) {
      const c: EnvCheck = { name, status: "missing", note: opts.note, fatal: opts.fatal };
      checks.push(c);
      const msg = `${name} is NOT SET — ${opts.note}`;
      if (opts.fatal) errors.push(msg); else warnings.push(msg);
      return;
    }
    if (opts.minLen && val.length < opts.minLen) {
      const c: EnvCheck = { name, status: "too_short", len: val.length, note: opts.note, fatal: opts.fatal };
      checks.push(c);
      const msg = `${name} is too short (${val.length} chars, need >=${opts.minLen}) — ${opts.note}`;
      if (opts.fatal) errors.push(msg); else warnings.push(msg);
      return;
    }
    if (opts.mustStartWith && !val.startsWith(opts.mustStartWith)) {
      const c: EnvCheck = { name, status: "invalid_format", len: val.length, note: opts.note, fatal: opts.fatal };
      checks.push(c);
      const msg = `${name} has invalid format (must start with "${opts.mustStartWith}") — ${opts.note}`;
      if (opts.fatal) errors.push(msg); else warnings.push(msg);
      return;
    }
    checks.push({ name, status: "ok", len: val.length, note: opts.note, fatal: opts.fatal });
  }

  // ── Database ─────────────────────────────────────────────────────────────
  check("DATABASE_URL", {
    minLen: 20, mustStartWith: "postgresql",
    note: "Neon DB. Do not change.",
    fatal: true,
  });

  // ── Auth ──────────────────────────────────────────────────────────────────
  check("JWT_SECRET", {
    minLen: 20,
    note: "SolarPro session auth. Do not change.",
    fatal: true,
  });

  // ── Shared secrets (MUST match Render) ────────────────────────────────────
  check("SURVEY_WEBHOOK_SECRET", {
    minLen: 20,
    note: "CRITICAL: Verifies HMAC on inbound webhooks. Must match SURVEY_WEBHOOK_SECRET on Render. " +
          "Changing this causes all webhooks to be rejected with 401 SIGNATURE_MISMATCH.",
    fatal: true,
  });
  check("SOLARPRO_HANDOFF_SECRET", {
    minLen: 32,
    note: "CRITICAL: Verifies mobile proxy JWTs. Must match SOLARPRO_HANDOFF_SECRET on Render. " +
          "Changing this breaks the mobile client dropdown immediately.",
    fatal: true,
  });

  // ── Mobile service auth ───────────────────────────────────────────────────
  const hasMobileKey =
    process.env.MOBILE_SERVICE_API_KEY?.trim() ||
    process.env.SOLARPRO_API_KEY?.trim();
  if (!hasMobileKey) {
    warnings.push(
      "Neither MOBILE_SERVICE_API_KEY nor SOLARPRO_API_KEY is set. " +
      "Path B service key auth is disabled (Path C JWT auth is still active)."
    );
  } else {
    check("MOBILE_SERVICE_API_KEY", {
      minLen: 16,
      note: "Service key for Path B mobile auth. Do not change.",
      fatal: false,
    });
  }

  // ── Ingest owner ──────────────────────────────────────────────────────────
  check("MOBILE_SERVICE_USER_ID", {
    minLen: 36,
    note: "UUID of fallback owner for ingest. Must be a real SolarPro user. Do not change.",
    fatal: false,
  });
  check("SURVEY_INGEST_DEFAULT_USER_ID", {
    minLen: 36,
    note: "UUID of owner for auto-created projects. Must match MOBILE_SERVICE_USER_ID. Do not change.",
    fatal: false,
  });

  // ── Partner backend ───────────────────────────────────────────────────────
  check("PARTNER_BASE_URL", {
    minLen: 10, mustStartWith: "https://",
    note: "Render backend URL for survey payload fetch. Do not change.",
    fatal: false,
  });

  const ok = errors.length === 0;
  return { ok, checks, errors, warnings };
}

/**
 * assertPipelineEnv()
 *
 * Call at cold-start (e.g. in a Next.js instrumentation.ts or layout.tsx server component).
 * Logs all results. Does NOT throw — Vercel serverless functions can't abort cold-start.
 * Fatal errors are logged as console.error so they surface in Vercel function logs.
 */
export function assertPipelineEnv(): void {
  const result = checkPipelineEnv();

  for (const c of result.checks) {
    if (c.status === "ok") {
      console.log(`[ENV_GUARD] OK    ${c.name} (len=${c.len})`);
    } else {
      const level = c.fatal ? "FATAL" : "WARN ";
      console.error(`[ENV_GUARD] ${level} ${c.name}: ${c.status.toUpperCase()} — ${c.note}`);
    }
  }

  for (const w of result.warnings) {
    console.warn(`[ENV_GUARD] WARN  ${w}`);
  }

  if (!result.ok) {
    console.error("[ENV_GUARD] ══════════════════════════════════════════════════");
    console.error("[ENV_GUARD] PIPELINE ENV INVALID — the following are fatal:");
    for (const e of result.errors) {
      console.error(`[ENV_GUARD]   ✗ ${e}`);
    }
    console.error("[ENV_GUARD] Fix these in the Vercel dashboard and redeploy.");
    console.error("[ENV_GUARD] ══════════════════════════════════════════════════");
    // Do not process.exit() in serverless — log only. The health endpoint
    // will surface this as HTTP 503 so monitoring catches it immediately.
  } else {
    console.log("[ENV_GUARD] All pipeline environment variables verified ✓");
  }
}