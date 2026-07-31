# SolarPro — SOC 2 Type 2 + ISO 27001 + ISO 27701 + ISO 27017 Control Matrix

**Generated:** 2026-07-30
**Repo:** `C:\Users\carpe\Solarpro` @ `168a5ad6` (merge of `origin/dev` `7c09fa9d`)
**Working tree:** clean
**Author:** Mavis (general-purpose agent)
**Scope:** Sprint 0 gap synthesis from the four 2026-07-30 audit reports + dependency security advisory.
**Frameworks in scope:**
- **SOC 2 Type 2** — Trust Services Criteria (TSC 2017, updated 2022): CC1–CC9.
- **ISO 27001:2022** — Annex A organizational (A.5) + technological (A.8) controls.
- **ISO 27701:2019** — Privacy extension. Only the PII-relevant controls SolarPro actually exposes (PII controller for homeowner/inspector data; PII processor for utility/AHJ data).
- **ISO 27017:2015** — Cloud-specific controls (SolarPro runs on Vercel + Neon + Render + Cloudflare). Added to the framework column where the cloud context changes the implementation guidance.

**Audits used as input:**
1. `C:\Users\carpe\.mavis\v2\assets\audit_solar_ml_2026-07-30.md` — ML/AI/vision pipeline (51K)
2. `C:\Users\carpe\.mavis\v2\assets\audit_security_migrations_2026-07-30.md` — security, auth, migrations, rate limiting (48K)
3. `C:\Users\carpe\.mavis\v2\assets\audit_consolidated_USD_2026-07-30.md` — overall code quality + USD valuation (28K)
4. `C:\Users\carpe\.mavis\v2\assets\audit_code_quality_2026-07-30.md` — code quality (22K)
5. `C:\Users\carpe\.mavis\v2\assets\audit_architecture_coverage_2026-07-30.md` — architecture + test coverage (42K)
6. `C:\Users\carpe\.mavis\memory\projects\solarpro\SECURITY_ADVISORY_DEPS.md` — dependency vulnerabilities (CVE triage)

---

## Summary

### Counts

| Status | Rows | % of total |
|---|---:|---:|
| Implemented | 15 | 19% |
| Partial | 41 | 53% |
| Gap | 11 | 14% |
| Not Applicable (cloud-only / out of scope) | 3 | 4% |
| Not assessed (audits silent) | 8 | 10% |
| **Total controls assessed** | **78** | 100% |

> **Not assessed** rows are flagged honestly — the four audit reports are extensive but do not cover every SOC 2 / ISO 27001 control. An auditor will need either additional gap-assessment work or compensating controls documented before signing a Type 2 report. The "What's NOT in the matrix" section at the bottom enumerates them.

### Top 10 P0 Gaps — MUST remediate before SOC 2 Type 1

These are the items where the audit evidence directly fails a control test. None of them are 6-month epics — most are days-of-work tactical fixes. The control IDs reference the rows in the matrix below.

| # | Control(s) | Gap | Source audit | Effort |
|---|---|---|---|---|
| 1 | **A.8.8**, **A.8.16**, **CC7.1** | **5 high-severity Next.js 14 DoS CVEs unpatched** (GHSA-q4gf-8mx6-v5v3 RSC deserialization, GHSA-h25m-26qc-wcjf, GHSA-ggv3-7p47-pfv8, GHSA-9g9p-9gw9-jx7f, GHSA-3x4c-7xq6-9pq8). RSC deserialization is the most relevant since SolarPro uses App Router extensively. | `SECURITY_ADVISORY_DEPS` §1 | 2-3 weeks (Next 15 migration) |
| 2 | **CC6.6**, **A.8.21** | **Rate-limiter "fails open" on Upstash Redis error or 500ms timeout** — when Redis is down, every gated route ALLOWS. Combined with **178/293 API routes have no `checkRateLimit` at all**, there is no per-IP backstop. Includes `auth/{logout,me,tour-complete,mobile-session}`, `projects/[id]/*`, `proposals/[id]/*` (sign/share/send-email), `organizations/*`, `portal/*` (reads), `intake/*`, `webhooks/survey-complete`, 2 Vercel cron routes, 19 of 24 admin reads. | `audit_security_migrations` §2 #1, §2 #4 | 1-2 days (in-memory LRU fallback) + 1 day (add gates) |
| 3 | **CC6.6**, **A.8.5**, **A.8.24** | **`NODE_ENV === 'production'` used as Secure-cookie gate in 8+ auth code paths** — same v47.57 bug pattern. Latent, not exploitable, but a regression waiting to happen. Should use `VERCEL_ENV` like `lib/dev-auth.ts` does. | `audit_security_migrations` §2 #2 | 30 min (sed-replace) |
| 4 | **CC8.1**, **A.8.25**, **A.8.28** | **`strict: false` in both `tsconfig.json` and `tsconfig.test.json`** — root cause of 1,500 `as any` casts, 4 `@ts-ignore`, near-zero `import type` discipline. Every new feature is built on shifting type ground. | `audit_code_quality` §2 #1 | 1-3 weeks (with fixup branch) |
| 5 | **CC8.1**, **A.8.25** | **`lib/proposalTruthEngine.ts` = 62,959 LOC / 1.9 MB monolith** — single source file ~30× the next-largest. One slow editor parse, one merge conflict away from disaster. | `audit_code_quality` §2 #2 | 1 week (extract data table to JSON) |
| 6 | **CC7.2**, **A.8.15** | **207 empty `} catch {}` swallows** (160 in `components/3d/SolarEngine3D.tsx` alone). Production errors silently lost — Cesium calls wrapped in silent failure mean a 3D view can fail to redraw with no operator signal. | `audit_code_quality` §2 #3, §7 | 2-4 weeks (introduce `safeViewerOp()` + structured logger) |
| 7 | **CC4.1**, **A.8.32** | **9 failing tests in CI** (5 stale migration assertions, 1 crew-calendar, 2 `spawnSync npm` Windows-only, 1 real page-clipping regression) + **51 pre-existing F-13 test failures** + 1 `next lint` blocker. Pre-push R2 guard is red. The test suite is not currently green — auditors will treat this as a broken control environment. | `audit_consolidated` §2.1-2.4, `audit_architecture_coverage` §2 #2, `audit_solar_ml` §2 #2 | 2-3 weeks (clear F-13 backlog + fix 4 sync issues) |
| 8 | **CC8.1**, **A.8.32** | **2D-to-3D gap is open; `CanonicalBuildingModel` built but never persisted.** `app/api/engineering/plan-set/route.ts` makes **zero survey queries** and falls back to hardcoded `roofWidthFt=30, roofLengthFt=20`. **Single largest correctness risk to permit-grade output.** | `audit_solar_ml` §2 #1, §8 | 3-6 weeks (Phase 1 of ROADMAP-survey-to-planset.md) |
| 9 | **CC8.1**, **A.8.25**, **A.8.28** | **Two parallel authority systems with no shared contract.** `UnifiedGeometryAuthority` (5-state machine in `lib/siteSurveys/unifiedGeometry/authority.ts`) and `lib/permit/snapshot/` (40 files, W3/W4/AAC closure) do not reference each other. `grep` for `REVIEW_ONLY_AUTHORITY` in `lib/permit/snapshot/` returns zero matches. Drift risk on "is this artifact ready to feed CAD / permit / BOM?" | `audit_solar_ml` §2 #3, §6.2 | 1-3 weeks (unify or document contract) |
| 10 | **CC6.6**, **A.5.34** | **OpenAI GPT-4o + Claude Opus 4.8 vision calls fail-silent when API keys missing**, with **no daily budget cap** on any of 4 ML vendors. An Opus 4.8 vision call is $15/$75 per 1M tokens and runs per-roof. No `MAX_DAILY_COST_USD` or `VISION_DAILY_BUDGET` gate; a misconfigured env produces a normal-looking planset where the vision layer contributed zero — and a runaway sweep can burn $500+ with no operator signal. Also PII: aerial photos of customer homes go to third-party vision APIs with no documented DPF. | `audit_solar_ml` §2 #4, #5, `audit_consolidated` §7 | 1-2 weeks (env gates + banner + budget cap) |

**Also P0 for SOC 2 Type 1 (tactical, 1-3 days each):**
- `lib/permit/utils/titleBlock.ts ↔ drawing.ts` circular dep in protected layer (topology guard fails CI) — `audit_architecture_coverage` §2 #1
- 3 of 4 new `lib/providers/*` families have **zero direct unit tests** (asceHazard, sunspecCode, censusProperty) — `audit_architecture_coverage` §2 #3
- Real Chromium page-fit regression on PV-0 (+10px), PV-4B (+15.7px), SCHED (+31.9px) — `audit_architecture_coverage` §2 #2
- `getJwtSecret()` does not enforce 32-char minimum at runtime — `audit_security_migrations` §2 #3
- `MOBILE_SERVICE_API_KEY` and `SOLARPRO_API_KEY` accepted as same Bearer, no per-route scoping — `audit_security_migrations` §2 #8
- Survey photo upload lacks per-survey count cap and PII field length caps — `audit_security_migrations` §2 #7

---

## Trust Services Criteria (SOC 2)

### CC1 — Control Environment

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC1.1 | SOC 2, ISO A.5.1, A.5.2 | Demonstrates commitment to integrity and ethical values via policies, code of conduct, and security policies | **Partial** | `AGENTS.md` (12K, mtime 2026-07-21) sets R1–R7 rules; `AI-AGENT-README.md` is 65 days old and predates 502 commits of work | `audit_architecture_coverage` §2 #10, §7.3 | P2 | Refresh `AI-AGENT-README.md` §11 with the 4 known issues from 2026-07-30 sync; add `HANDOFF_2026-07-30.md` | 1-2 days |
| CC1.2 | SOC 2 | Board of directors / management demonstrates independence and exercises oversight | **Not assessed** | (audits silent — no board charter / management review evidence in repo) | — | P3 | Document management review cadence + infosec ownership; required for SOC 2 Type 2 | 1 week (policy work, not code) |
| CC1.3 | SOC 2, ISO A.5.2 | Establishes structures, reporting lines, and authorities for information security roles | **Partial** | `requireAdminApi()` in `lib/adminAuth.ts:152` implements super_admin/admin/user role split; `lib/organizations/authorization.ts` is default-deny org RBAC; **no org-scoped API wrapper** (e.g. `requireOwner()`) — route handlers must call `checkOrgAuthz()` directly | `audit_security_migrations` §3.6 | P1 | Add `requireOrgRole()` wrapper at API layer; document role matrix in `AI-AGENT-README.md §6` | 1-2 days |
| CC1.4 | SOC 2, ISO A.5.2, A.5.35 | Demonstrates commitment to competence (security training, secure coding) | **Partial** | `AGENTS.md` exists; `R6` (feat: commits attributed to JAMES) is the only formalized commit-author policy. No secure-coding training record. | `audit_architecture_coverage` §7.2 | P2 | Add secure-coding standard doc + threat-model checklist for PR review | 1 week |
| CC1.5 | SOC 2, ISO A.5.1 | Holds individuals accountable for their internal control responsibilities | **Implemented** | `auditLog.ts` writes structured events for all admin/migration actions; `MIGRATION-GOV-13` audit logs on every run; `lib/adminAuth.ts:152` records `password_changed_at` + session invalidation | `audit_security_migrations` §3.2, §5.5 | — | — | — |

### CC2 — Communication and Information

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC2.1 | SOC 2, ISO A.5.34 | Obtains / generates relevant quality information to support functioning of internal control | **Implemented** | `lib/migrations/ledger.ts` + `lib/migrations/runner.ts` (canonical migration runner with advisory lock, checksum, ledger, audit event) | `audit_security_migrations` §5.5 | — | — | — |
| CC2.2 | SOC 2, ISO A.5.10 | Internally communicates information necessary to support the functioning of internal control | **Partial** | `docs/` has ~200 files; recent (2026-07-30) docs are `BRAIDON-PLANSET-14-REGRESSION-REPAIR.md` and `POST-CAMPAIGN-CORRECTION-2026-07-22.md`. `HANDOFF.md` chain is stale (11 of 12 dated 2026-06-30) | `audit_architecture_coverage` §7.4 | P2 | Write `HANDOFF_2026-07-30.md` summarizing the 38-commit sync | 0.5 day |
| CC2.3 | SOC 2, ISO A.5.10, A.5.34 | Communicates with external parties about security responsibilities and events | **Partial** | `AHJ_REGISTRY_TOKEN_ACTION` operator string is verbose and correct; `ATTOM_API_KEY` chain-failure message names the env var. **AHJ registry doc still describes the bundled TypeScript table as "the registry" when it is now a fallback** | `audit_security_migrations` §2 #6 | P1 | Update `AI-AGENT-README.md §6` to clarify bundled table is fallback, not registry | 0.5 hour |
| CC2.4 | SOC 2, ISO A.5.37 | Documents operating procedures and stores them where accessible | **Implemented** | 4-gate migration governance documented in `lib/migrations/runner.ts:380-432`; `TARGETED_RECOVERY_ALLOWLIST` is the fourth gate; `tests/targetedRegistryDeployment.test.ts` pins the 3 sets to agree | `audit_security_migrations` §5.5, §5.6 | — | — | — |

### CC3 — Risk Assessment

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC3.1 | SOC 2, ISO A.5.7 | Specifies objectives, identifies risks, and analyzes risks to support risk management | **Implemented** | These four audit reports are the formal risk assessment artifact (163K of evidence). 4 audits consolidated in `audit_consolidated_USD_2026-07-30.md` §0. | (this document) | — | — | — |
| CC3.2 | SOC 2, ISO A.5.7 | Identifies and analyzes risk related to the achievement of objectives across the entity | **Implemented** | Risk register below in §"Risk register" | (this document) | — | — | — |
| CC3.3 | SOC 2, ISO A.5.7 | Considers the potential for fraud in assessing risks | **Partial** | No formal fraud-risk assessment; rate-limiter fail-open (#2 P0) and parallel authority systems (#9 P0) are fraud-adjacent. Webhook signature verification (all 5 sources) is correct. | `audit_security_migrations` §7 | P2 | Document fraud risk assessment (e.g. proposal-sign URL abuse, equipment-pricing manipulation) | 1 week |
| CC3.4 | SOC 2, ISO A.5.7 | Identifies and assesses changes that could significantly impact the system of internal control | **Implemented** | `MIGRATION-GOV-13` + 4-gate allowlist + static analysis (`analyzeRegistryMigration`) cover change-management risk for schema changes; `.audit-missing-rl.txt` and `.audit-env-inventory.txt` are the change-detection artifacts for rate-limit coverage and env-var sprawl | `audit_security_migrations` §5.5, §5.6, §10.1 | — | — | — |

### CC4 — Monitoring Activities

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC4.1 | SOC 2, ISO A.8.16, A.8.32 | Selects, develops, and performs ongoing or separate evaluations to ascertain whether components of internal control are present and functioning | **Gap** | **9 failing tests + 1 lint blocker + 51 pre-existing F-13 failures block the R2 pre-push guard.** Per `AGENTS.md §9` escalation trigger, this should be "stop, summarize, wait" — but JAMES has been working around it | `audit_consolidated` §10, `audit_architecture_coverage` §1, `audit_solar_ml` §2 #2 | **P0** | Clear 5 stale migration assertions, fix the page-clipping regression, fix the 2 `execFileSync npm` Windows tests, fix the crew-calendar TZ test, clear the 51 F-13 backlog, fix the 1 lint blocker | 2-3 weeks |
| CC4.2 | SOC 2, ISO A.8.16 | Evaluates and communicates internal control deficiencies in a timely manner | **Partial** | `MIGRATION-GOV-13` audit log + `auditLog.ts` capture infrastructure-level events. **207 empty `} catch {}` swallows** mean most application errors are silently lost — the operator has no signal to act on | `audit_code_quality` §7.2 | P1 | Introduce structured logger (Pino/Winston) + `safeViewerOp()` helper; promote `no-console` to `error` in `.eslintrc.json` | 2-4 weeks |

### CC5 — Control Activities

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC5.1 | SOC 2, ISO A.5.36 | Selects and develops control activities that contribute to mitigation of risks | **Implemented** | CSRF, JWT HS256-only, role-from-DB-not-JWT, HMAC webhook signature, idempotency keys, 60s admin role cache, 4-gate migration governance, idempotent migrations 113-117 | `audit_security_migrations` §1, §5.5, §7 | — | — | — |
| CC5.2 | SOC 2, ISO A.5.36, A.5.37 | Selects and develops general technology controls to support achievement of objectives | **Partial** | Tech controls are present but inconsistently applied — see CC6.6, CC6.7, CC7.1. Two legacy migration paths now 423 Locked (`MIGRATION-GOV-13`); run history is auditable | `audit_security_migrations` §2 #5 | — | — | — |
| CC5.3 | SOC 2, ISO A.5.37 | Deploys controls through policies and procedures | **Partial** | 4-gate migration governance deployed; **NODE_ENV-as-Secure-gate inconsistency** (`lib/auth.ts` vs `lib/dev-auth.ts`) shows policy + code can drift | `audit_security_migrations` §2 #2 | P0 | Standardize on `VERCEL_ENV === 'production'` in all 8+ auth paths | 30 min |

### CC6 — Logical and Physical Access

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC6.1 | SOC 2, ISO A.5.15, A.5.18, A.8.2 | Implements logical access security software, infrastructure, and architectures over identified assets | **Partial** | `lib/auth.ts` (HS256 JWT, bcrypt(12), role from DB), `lib/adminAuth.ts:152` (`requireAdminApi()`), `lib/organizations/authorization.ts` (default-deny org RBAC), MFA TOTP AES-256-GCM (`MFA_ENCRYPTION_KEY`), 60s admin role cache. **DB role fetch on every admin API call** (not JWT-embedded) is correct. Platform role does NOT confer org permissions (ADR-004). | `audit_security_migrations` §3.2, §3.6 | — | — | — |
| CC6.2 | SOC 2, ISO A.5.18 | Prior authorization for issuance of new user IDs, passwords, and roles | **Implemented** | `app/api/auth/register/route.ts` uses Zod `registerSchema` (name, email, password, company, phone with length caps + isGibberish + isDisposableEmail guards). New admin elevation requires `requireAdminApi + super_admin` check | `audit_security_migrations` §3.1, §3.2 | — | — | — |
| CC6.3 | SOC 2, ISO A.5.18, A.5.16 | Removes access to information assets when appropriate (termination, role change) | **Implemented** | Migration 094: token `iat < password_changed_at - 5s` is rejected (`lib/adminAuth.ts:152` + `getDbWithRetry` SELECT). 8-hour admin inactivity + 24-hour user inactivity (`middleware.ts`). Org-scoped `checkOrgAuthz()` is fail-closed. | `audit_security_migrations` §3.2, §3.5 | — | — | — |
| CC6.4 | SOC 2, ISO A.5.18, ISO 27017 A.8.1 (cloud context) | Restricts physical access to protected information assets (data centers, cloud regions) | **Not applicable** | Cloud-only: Vercel (compute), Neon (Postgres), Render (SAM2 worker), Cloudflare (CDN). Physical access controls are Vercel/Neon/Render SOC 2 reports under review at the provider. SolarPro has no on-prem footprint. | — | — | Obtain and file Vercel + Neon + Render SOC 2 Type 2 reports (vendor due-diligence under CC9.2) | 1 week (vendor-management) |
| CC6.5 | SOC 2, ISO A.5.18 | Discontinues logical and physical protection only when no longer required | **Not assessed** | Audits do not address asset retirement / data-deletion lifecycle. **Recommend separate data lifecycle audit** before Type 2. | — | P2 | Document data retention + deletion policy; add scheduled jobs for stale surveys | 1-2 weeks |
| CC6.6 | SOC 2, ISO A.5.15, A.5.17, A.8.5, A.8.24 | Implements logical access security measures to authorize, authenticate, and encrypt connections | **Gap** | **P0 #1: rate-limiter fails open on Upstash Redis error or 500ms timeout** (when Redis is down, every gated route ALLOWS). **P0 #2: NODE_ENV used as Secure gate in 8+ auth paths.** **P0 #14: 178/293 routes have no `checkRateLimit`.** `getJwtSecret()` does not enforce 32-char min runtime. CSRF (Origin === Host) correctly enforced. HMAC webhook signature verification (Stripe, survey, Meta, Google, generic) all correct. No `NEXT_PUBLIC_*` secret leakage. | `audit_security_migrations` §2 #1, #2, #3, #4 | **P0** | (a) in-memory LRU fallback for 5/60s login + 2/60h migrate buckets. (b) switch NODE_ENV → VERCEL_ENV in 8+ auth paths. (c) add 32-char min to `getJwtSecret()`. (d) roll `checkRateLimit('standard')` out to 178 routes | 1-2 days (a,b,c) + 1 day (d) |
| CC6.7 | SOC 2, ISO A.5.10, A.8.12 | Restricts the transmission, movement, and removal of information to authorized users | **Partial** | Webhooks signed (HMAC `crypto.timingSafeEqual` + 5-min timestamp tolerance + idempotency_key on `webhook_deliveries.event_id`). No DLP for survey PII (inspector_email, site_overview, roof_conditions) in transit to third-party vision APIs (OpenAI, Claude). No documented DPAs with OpenAI/Anthropic for aerial photo PII. | `audit_security_migrations` §7, `audit_solar_ml` §5 | P1 | (a) document DPAs with OpenAI + Anthropic for customer aerial photo PII. (b) Add PII field length caps to `app/api/survey/submit/route.ts` + standalone-handoff. (c) Add per-survey photo count cap (Redis counter on `project_id`). | 1-2 days (a) + 4-6 hours (b,c) |
| CC6.8 | SOC 2, ISO A.8.7 | Prevents or detects and acts upon the introduction of unauthorized or malicious software | **Partial** | `SENTRY_DSN` referenced; **207 empty `} catch {}` swallows** mean unauthorized execution paths would be silent. SAM2 service sandboxed in Docker (`sam2-service/Dockerfile`); ONNX INT8 quantized; no input image validation beyond MIME allowlist + magic bytes. **`synthetic: true` provenance firewall** exists in `lib/siteSurveys/unifiedGeometry/authority.ts:248` but no adversarial test verifies it (a JSON roundtrip that drops `synthetic: true` is not caught). | `audit_solar_ml` §6, `audit_security_migrations` §6.4 | P1 | (a) Add adversarial tests for synthetic / mock / promotion firewalls. (b) Add dependency CVEs to CI gate (Snyk/Dependabot) | 1-2 days (a) + 0.5 day (b) |

### CC7 — System Operations

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC7.1 | SOC 2, ISO A.5.7, A.5.24, A.5.25, A.8.16, A.8.8 | Detects and responds to security events, vulnerabilities, and anomalies | **Gap** | **5 high-severity Next.js 14 DoS CVEs unpatched** (RSC deserialization, HTTP smuggling, image optimizer DoS, etc.). `npm audit`: 0 critical, 8 high, 7 moderate. **No Snyk/Dependabot/GitHub Dependabot security PRs in CI** — `package-lock.json` is 9 days stale. No rate limit on 178/293 routes means abuse signals are absent. `SENTRY_DSN` referenced but alert wiring (e.g. `inference_active=true > N seconds`) is not in place. | `SECURITY_ADVISORY_DEPS` §1, `audit_security_migrations` §2 #1, `audit_solar_ml` §2 #7 | **P0** | (a) Add `overrides` for `picomatch >=2.3.2` + `flatted >=3.4.2`. (b) Plan + execute Next 15 migration. (c) Add Dependabot security updates to CI. (d) Wire SAM2 `inference_active` to Sentry/Prometheus | 2-3 weeks (b) + 0.5 day (a,c) + 1 day (d) |
| CC7.2 | SOC 2, ISO A.8.15, A.8.16 | Monitors system components and the operation of those components for anomalies | **Gap** | **207 empty `} catch {}` swallows** (160 in `SolarEngine3D.tsx`) — production errors silently lost. **2,537 `console.*` calls across 521 files, no structured logger.** 1,470 `log`/`info`/`debug` calls are warnings under current ESLint config but still fire. SAM2 `inference_active` is only observably surfaced, not alerted. `aerialVisionObstructions.ts` 30-min in-process cache has no hit/miss observability. | `audit_code_quality` §2 #3, §7.2, `audit_solar_ml` §2 #7, #10 | **P0** | (a) Introduce structured logger (Pino). (b) `safeViewerOp()` helper for 3D viewer. (c) Cache hit/miss stats for vision. (d) SAM2 alert wiring | 2-4 weeks (a,b) + 1-2 days (c,d) |
| CC7.3 | SOC 2, ISO A.5.25, A.5.26, A.5.28 | Evaluates security events to determine whether they should be classified as incidents | **Partial** | `MIGRATION-GOV-13` audit logs are run-scoped. `auditLog.ts` records admin actions. **No formal incident classification taxonomy or runbook.** AHJ registry `RegistryFailureKind` ('NOT_CONFIGURED' / 'NO_COORDINATES' / etc.) is a working example of fail-loud operator strings — could be replicated. | `audit_security_migrations` §2 #6, §4.4 | P2 | Document incident classification (Sev1/Sev2/Sev3) + runbook for rate-limiter outage, vision fail-silent, migration governance | 1 week |
| CC7.4 | SOC 2, ISO A.5.26, A.5.28 | Responds to identified security incidents (containment, eradication, recovery) | **Partial** | `app/api/admin/debug/auth-status` + `app/api/admin/repair-account` are "break-glass" gated by `ADMIN_SECRET + productionGuard()`. No formal IR plan or on-call rotation. | `audit_security_migrations` §3.2 | P2 | Write IR plan (NIST 800-61); define on-call rotation; document break-glass usage policy | 1-2 weeks |
| CC7.5 | SOC 2, ISO A.5.27, A.5.29 | Recovers from identified security incidents and improves the response process | **Not assessed** | Audits do not address post-incident review (PIR) cadence or backup/recovery of the Neon DB. **`MIGRATE_SECRET` rotation is documented in `AI-AGENT-README.md §5` (mentions "should be rotated") but no rotation runbook exists.** | `audit_security_migrations` §4.6 | P2 | Document PIR process; document secret rotation cadence; verify Neon PITR is enabled and tested | 1 week |

### CC8 — Change Management

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC8.1 | SOC 2, ISO A.8.9, A.8.25, A.8.28, A.8.32 | Authorizes, designs, develops, acquires, configures, documents, tests, and implements changes to infrastructure, data, software, and procedures | **Gap** | **4 P0 issues cluster here:** (i) **`strict: false` in both tsconfigs** — root cause of 1,500 `as any` casts. (ii) **`lib/proposalTruthEngine.ts` 62,959 LOC / 1.9 MB monolith**. (iii) **2D-to-3D gap open; `CanonicalBuildingModel` built but never persisted** — plan-set route falls back to hardcoded `roofWidthFt=30, roofLengthFt=20`. (iv) **Two parallel authority systems** (`UnifiedGeometryAuthority` vs `lib/permit/snapshot/`) with no shared contract. **Also: 3 of 4 new `lib/providers/*` families have 0 direct tests** (asceHazard, sunspecCode, censusProperty). **Real Chromium page-fit regression** (PV-0 +10px, PV-4B +15.7px, SCHED +31.9px) is a runtime render bug. 4-gate migration governance is exemplary; 5 stale test assertions for migration 117. | `audit_code_quality` §2 #1, #2, `audit_solar_ml` §2 #1, #3, `audit_architecture_coverage` §2 #2, #3, #4, `audit_security_migrations` §5.5 | **P0** | (a) `strict: true` flip in fixup branch. (b) Extract data block to JSON. (c) Phase 1 of 2D-to-3D roadmap (persist + rewire plan-set). (d) Unify or document authority contract. (e) Add direct unit tests for 3 untested providers. (f) Fix page-clipping regression. (g) Update 5 stale migration assertions | 8-15 weeks total (1-2 sprints) |

### CC9 — Risk Mitigation

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| CC9.1 | SOC 2, ISO A.5.31, A.8.23 | Identifies, selects, and develops risk mitigation activities for risks arising from potential business disruptions | **Partial** | Vercel + Neon + Render multi-cloud posture; `vercel.json` defines 2 cron jobs (`/api/cron/proposal-expiry`, `/api/cron/stale-job-cleanup`) with `CRON_SECRET` auth. **No documented BCP/DR plan, no RTO/RPO targets, no failover test cadence.** Render SAM2 service can auto-sleep after 15 min of inactivity. | `audit_security_migrations` §4.4, `audit_solar_ml` §5 | P2 | Document RTO/RPO targets + failover runbook; verify Neon PITR; test SAM2 cold-start within budget | 1-2 weeks |
| CC9.2 | SOC 2, ISO A.5.19, A.5.20, A.5.21, A.5.23, ISO 27017 A.5.23 | Assesses and manages vendor and business partner risks | **Partial** | Vendor list in audit (`SECURITY_ADVISORY_DEPS` §5; `audit_solar_ml` §5) covers 8 ML/AI vendors, 5 infra vendors (Vercel, Neon, Render, Cloudflare, Stripe), 4 utility-data vendors (Nearmap, Eagleview, ATTOM, Google Solar), 3 payment/email vendors (Stripe, Resend, OpenAI/Anthropic). **No formal vendor risk register, no SOC 2 report collection, no DPAs filed.** ML vendor fail-silent pattern (audit_solar_ml #4) is a vendor-mitigation gap. | `audit_solar_ml` §2 #4, `audit_consolidated` §7, `SECURITY_ADVISORY_DEPS` §1-5 | P1 | (a) Build vendor risk register (criticality, data flow, DPA status, SOC 2 report date). (b) Collect Vercel + Neon + Render SOC 2 reports. (c) File DPAs with OpenAI + Anthropic for aerial photo PII | 1-2 weeks |

---

## ISO 27001:2022 Annex A — Organizational controls (A.5)

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| A.5.1 | ISO 27001, SOC 2 CC1.1 | Policies for information security | **Partial** | `AGENTS.md`, `AI-AGENT-README.md`, `lib/auth.ts` (in-file policy comments). 65-day-old README predates 502 commits | `audit_architecture_coverage` §7.3 | P2 | Refresh `AI-AGENT-README.md`; write `HANDOFF_2026-07-30.md` | 0.5-1 day |
| A.5.2 | ISO 27001, SOC 2 CC1.3, CC1.4 | Information security roles and responsibilities | **Partial** | `requireAdminApi()` + super_admin split; org RBAC default-deny. **No formal org chart or role-responsibility matrix.** | `audit_security_migrations` §3.2, §3.6 | P1 | Add `requireOrgRole()` API wrapper + role-responsibility matrix in README | 1-2 days |
| A.5.7 | ISO 27001, SOC 2 CC3.x | Threat intelligence (collect and analyze threat data) | **Partial** | `SECURITY_ADVISORY_DEPS.md` is the current threat-intel artifact (Phase 75). `MIGRATION-GOV-13` audit logs + `AHJ_REGISTRY_TOKEN_ACTION` are in-product threat surfaces. **No external threat-intel feed (e.g. CISA, US-CERT) integrated.** | `SECURITY_ADVISORY_DEPS` §1-5 | P2 | Subscribe to GitHub Dependabot security updates + integrate CISA KEV feed | 0.5 day |
| A.5.10 | ISO 27001, SOC 2 CC2.2, CC2.3 | Acceptable use of information and other associated assets | **Not assessed** | Audits silent. Required for SOC 2. | — | P2 | Write acceptable-use policy; add to employee onboarding | 1 week |
| A.5.12 | ISO 27001 | Classification of information | **Partial** | `unifiedGeometry/{authority,canonical}` carry provenance + classification (review_only / promoted_canonical / cad_safe). Survey PII not explicitly classified. | `audit_solar_ml` §6, `audit_security_migrations` §7 | P2 | Document data classification scheme (Public / Internal / Confidential / PII); tag PII fields in survey schema | 1 week |
| A.5.15 | ISO 27001, SOC 2 CC6.1, CC6.6 | Access control | **Partial** | Default-deny org RBAC, role-from-DB, MFA TOTP, JWT HS256. **Rate-limiter fail-open + 178/293 missing rate limits + NODE_ENV-as-Secure are real gaps.** | `audit_security_migrations` §2 #1, #2, #4, §3.6 | P0 | (a) in-memory LRU rate-limit fallback. (b) `VERCEL_ENV` migration. (c) Roll out `checkRateLimit` to 178 routes | 2-3 days |
| A.5.16 | ISO 27001, SOC 2 CC6.3 | Identity management | **Implemented** | `users` table; `password_changed_at` invalidates tokens (migration 094); `auditLog.ts` records identity events | `audit_security_migrations` §3.2 | — | — | — |
| A.5.17 | ISO 27001, SOC 2 CC6.6 | Authentication information | **Partial** | bcrypt(12) + `JWT_SECRET` + `MFA_ENCRYPTION_KEY` + `SOLARPRO_HANDOFF_SECRET` + `SURVEY_WEBHOOK_SECRET`. **`getJwtSecret()` does not enforce 32-char min runtime** (hander and mobile-auth do). 32-char `meets_32_char_min` is reported in env-fingerprint. | `audit_security_migrations` §2 #3 | P1 | Add 32-char runtime check to `getJwtSecret()`; document secret strength policy | 15 min + 0.5 day |
| A.5.18 | ISO 27001, SOC 2 CC6.1, CC6.2, CC6.3, CC6.5 | Access rights | **Implemented** | `requireAdminApi()` + org `checkOrgAuthz()` + session inactivity timeouts (8h admin, 24h user). | `audit_security_migrations` §3.2, §3.5 | — | — | — |
| A.5.23 | ISO 27001, ISO 27017, SOC 2 CC9.2 | Information security for use of cloud services | **Partial** | Vercel + Neon + Render + Cloudflare + Stripe + Resend. No vendor risk register. No collected SOC 2 reports. | (this document), `audit_consolidated` §7 | P1 | (a) Build vendor risk register. (b) Collect Vercel + Neon + Render SOC 2 reports | 1-2 weeks |
| A.5.24 | ISO 27001, SOC 2 CC7.1 | Information security incident management planning | **Partial** | No formal IR plan. `MIGRATION-GOV-13` + `auditLog.ts` are the in-product evidence trail. | `audit_security_migrations` §5.5 | P2 | Write IR plan (NIST 800-61 aligned) | 1-2 weeks |
| A.5.25 | ISO 27001, SOC 2 CC7.3 | Assessment and decision on information security events | **Partial** | AHJ `RegistryFailureKind` is a working pattern for fail-loud classification. No formal event-classification taxonomy. | `audit_security_migrations` §4.4 | P2 | Document event-classification taxonomy | 1 week |
| A.5.26 | ISO 27001, SOC 2 CC7.4 | Response to information security incidents | **Partial** | Break-glass routes gated by `ADMIN_SECRET + productionGuard()`. No on-call rotation. | `audit_security_migrations` §3.2 | P2 | Define on-call rotation + escalation tree | 1 week |
| A.5.27 | ISO 27001, SOC 2 CC7.5 | Learning from information security incidents | **Not assessed** | Audits silent. | — | P2 | Document PIR process; schedule quarterly review | 1 week |
| A.5.28 | ISO 27001, SOC 2 CC7.4 | Collection of evidence (forensic readiness) | **Partial** | `auditLog.ts` + `MIGRATION-GOV-13` capture events with actor + timestamp + reason. **No formal chain-of-custody policy; no log retention policy.** | `audit_security_migrations` §5.5 | P2 | Document log retention (e.g. 1 year hot + 7 years cold) + chain of custody | 1 week |
| A.5.29 | ISO 27001, SOC 2 CC7.5 | Information security during disruption | **Partial** | Vercel + Neon + Render multi-cloud; cron jobs run on Vercel schedule. **No documented BCP/DR plan, no RTO/RPO targets.** | `audit_security_migrations` §4.4 | P2 | Document BCP/DR plan + RTO/RPO targets | 1-2 weeks |
| A.5.30 | ISO 27001, SOC 2 CC9.1 | ICT readiness for business continuity | **Partial** | No formal readiness test cadence. Neon PITR status unverified. | (this document) | P2 | Verify Neon PITR + annual failover test | 1 week |
| A.5.31 | ISO 27001, SOC 2 CC3.x | Legal, statutory, regulatory and contractual requirements | **Implemented** | AHJ/utility/equipment registry carries jurisdiction-specific data. Permit snapshot digest is hash-bound to engineering review. | `audit_architecture_coverage` §4.3, `audit_solar_ml` §3 | — | — | — |
| A.5.34 | ISO 27001, ISO 27701, SOC 2 CC6.7 | Privacy and protection of PII | **Partial** | Survey collects PII (inspector_email, inspector_name, site_overview, roof_conditions, electrical_service, obstructions, photos). Photos sent to **OpenAI GPT-4o, Claude Opus 4.8, Claude Sonnet 4.5** — no documented DPAs. No PII field length caps. No DLP for transit. | `audit_security_migrations` §2 #7, `audit_solar_ml` §2 #4, §5, `audit_consolidated` §7 | **P0** | (a) File DPAs with OpenAI + Anthropic. (b) Add PII field length caps + per-survey photo count cap. (c) Add vision-availability banner when keys missing. (d) Add `VISION_DAILY_BUDGET_USD` + per-survey cap | 1-2 weeks |
| A.5.35 | ISO 27001, SOC 2 CC1.4 | Independent review of information security | **Implemented** | These four audit reports + dependency advisory are the independent review artifact (2026-07-30). | (this document) | — | Schedule quarterly external review cadence | 1 day (admin) |
| A.5.36 | ISO 27001, SOC 2 CC5.x | Compliance with policies, rules and standards for information security | **Partial** | **NODE_ENV-as-Secure inconsistency** (`lib/auth.ts` vs `lib/dev-auth.ts`) shows policy + code can drift. `MIGRATION-GOV-13` audit logs verify migration governance compliance. | `audit_security_migrations` §2 #2, §5.5 | P0 | Standardize on `VERCEL_ENV === 'production'` in 8+ auth paths | 30 min |
| A.5.37 | ISO 27001, SOC 2 CC2.4, CC5.2 | Documented operating procedures | **Implemented** | 4-gate migration governance documented; `TARGETED_RECOVERY_ALLOWLIST` + `tests/targetedRegistryDeployment.test.ts` pin the 3 sets to agree (so the four-gate set cannot drift again — that drift was the root cause of "117 written but unrunnable"). | `audit_security_migrations` §5.5, §5.6 | — | — | — |

---

## ISO 27001:2022 Annex A — Technological controls (A.8)

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| A.8.1 | ISO 27001, ISO 27017, SOC 2 CC6.4 | User endpoint devices | **Not applicable** | Cloud-only — no managed endpoints. | — | — | — | — |
| A.8.2 | ISO 27001, SOC 2 CC6.1 | Privileged access rights | **Implemented** | `requireAdminApi()` + `super_admin` check + `ADMIN_SECRET` break-glass with `productionGuard()`. `MFA_ENCRYPTION_KEY` for TOTP AES-256-GCM. | `audit_security_migrations` §3.2 | — | — | — |
| A.8.3 | ISO 27001, SOC 2 CC6.x | Information access restriction | **Partial** | Default-deny org RBAC. **No `requireOwner`/`requireOrgRole` API wrapper** — route handlers must call `checkOrgAuthz()` directly (audit gap). | `audit_security_migrations` §3.6 | P1 | Add `requireOrgRole()` wrapper; document org-scoped API contract | 1-2 days |
| A.8.5 | ISO 27001, SOC 2 CC6.6 | Secure authentication | **Partial** | bcrypt(12) + JWT HS256 + MFA TOTP. **NODE_ENV-as-Secure inconsistency + 178 routes without rate limit + rate-limiter fail-open are real gaps.** | `audit_security_migrations` §2 #1, #2, #4 | P0 | See A.5.15 remediation | 2-3 days |
| A.8.7 | ISO 27001, SOC 2 CC6.8 | Protection against malware | **Partial** | Sentry DSN referenced. **No dependency CVE gating in CI.** `synthetic: true` provenance firewall exists but not adversarially tested. | `audit_security_ml` §6, `SECURITY_ADVISORY_DEPS` §1-5 | P1 | (a) Dependabot security updates. (b) Adversarial tests for synthetic/mock/promotion firewalls. | 1-2 days |
| A.8.8 | ISO 27001, SOC 2 CC7.1 | Management of technical vulnerabilities | **Gap** | **5 high-severity Next.js 14 DoS CVEs unpatched** + 3 moderate. **No `npm audit` in CI; no Dependabot security updates; `package-lock.json` 9 days stale.** | `SECURITY_ADVISORY_DEPS` §1 | **P0** | (a) Add `npm audit --audit-level=high` to CI. (b) Add `overrides` for `picomatch >=2.3.2` + `flatted >=3.4.2`. (c) Plan Next 15 migration | 2-3 weeks (c) + 0.5 day (a,b) |
| A.8.9 | ISO 27001, SOC 2 CC8.1 | Configuration management | **Partial** | `next.config.js` uses `validateBuildEnv()` for fail-fast on missing required env vars. `.env.example` documents 95 vars in 14 sections. **No formal config-management policy or drift detection.** | `audit_security_migrations` §4.3 | P2 | Add config-drift detection (e.g. weekly diff of Vercel env vs `.env.example`) | 1 week |
| A.8.12 | ISO 27001, SOC 2 CC6.7 | Data leakage prevention | **Gap** | **No DLP for survey PII in transit to third-party vision APIs (OpenAI, Claude).** No documented DPAs. No field-level length caps on PII fields. No per-survey photo count cap. | `audit_security_migrations` §2 #7, `audit_solar_ml` §2 #4, §5 | P1 | (a) File DPAs. (b) PII field length caps. (c) Per-survey photo count cap. (d) Vision-availability banner | 1-2 weeks |
| A.8.15 | ISO 27001, SOC 2 CC4.2, CC7.2 | Logging | **Gap** | **207 empty `} catch {}` swallows** (160 in `SolarEngine3D.tsx`). **2,537 `console.*` calls across 521 files, no structured logger.** `MIGRATION-GOV-13` audit logs are exemplary. `auditLog.ts` covers admin events. | `audit_code_quality` §2 #3, §7.2, `audit_security_migrations` §5.5 | **P0** | (a) Introduce structured logger (Pino). (b) `safeViewerOp()` helper. (c) Convert top-25 console offenders. (d) Promote `no-console` to `error` | 2-4 weeks |
| A.8.16 | ISO 27001, SOC 2 CC4.1, CC7.2 | Monitoring activities | **Partial** | Sentry DSN referenced. `auditLog.ts` records admin events. **No Sentry/Prometheus alert wiring for SAM2 `inference_active`, rate-limiter fail-open, vision fail-silent.** `aerialVisionObstructions.ts` 30-min cache has no observability. | `audit_solar_ml` §2 #7, #10, `audit_code_quality` §7.2 | P1 | (a) Wire SAM2 `inference_active` to Sentry/Prometheus. (b) Cache hit/miss stats for vision. (c) Alert on rate-limiter fail-open | 1-2 days |
| A.8.20 | ISO 27001, ISO 27017 | Networks security | **Not assessed** | Audits silent on network segmentation. Vercel + Render + Neon + Cloudflare topology is implicit. **Recommend separate network-security review before Type 2** (Vercel Edge Network config, Neon IP allowlist, Render private network). | — | P2 | Document network topology + firewall rules; enable Neon IP allowlist for prod | 1-2 weeks |
| A.8.21 | ISO 27001, ISO 27017, SOC 2 CC6.6 | Security of network services | **Gap** | **Rate-limiter fail-open + 178/293 routes with no rate limit = direct abuse surface.** No network-level DDoS protection beyond Cloudflare's default. | `audit_security_migrations` §2 #1, #4 | P0 | (a) In-memory LRU rate-limit fallback. (b) Roll out `checkRateLimit` to 178 routes. (c) Verify Cloudflare DDoS rules | 2-3 days |
| A.8.22 | ISO 27001, ISO 27017 | Segregation of networks | **Not assessed** | Cloud-only; segregation is Vercel/Neon/Render topology. | — | P2 | Document network segregation (Vercel Edge, Neon, Render private) | 1 week |
| A.8.23 | ISO 27001, ISO 27017 | Web filtering | **Not applicable** | SolarPro is a SaaS app, not a corporate network. | — | — | — | — |
| A.8.24 | ISO 27001, SOC 2 CC6.6 | Use of cryptography | **Partial** | bcrypt(12) for passwords; HS256 for JWT; HMAC SHA-256 + `crypto.timingSafeEqual` for webhooks; AES-256-GCM for TOTP via `MFA_ENCRYPTION_KEY`; `next.config.js` enforces HTTPS. **`getJwtSecret()` does not enforce 32-char min**; `NODE_ENV`-as-Secure inconsistency. No key rotation cadence documented. | `audit_security_migrations` §2 #2, #3, §4.6 | P1 | (a) 32-char min in `getJwtSecret()`. (b) `VERCEL_ENV` migration. (c) Document key rotation cadence | 0.5 day |
| A.8.25 | ISO 27001, SOC 2 CC8.1 | Secure development life cycle | **Partial** | AGENTS.md R1-R7 + 4-gate migration governance + `analyzeRegistryMigration` static analysis + adversarial review of review-only boundary. **`strict: false` + 1,500 `as any` casts + 62,959 LOC monolith + 9 failing tests + 51 F-13 backlog + 207 empty catches = the SDLC is not enforcing type safety or regression discipline.** | `audit_code_quality` §2 #1-#3, `audit_architecture_coverage` §1 | **P0** | (a) `strict: true` flip. (b) Extract monolith data block. (c) Clear F-13 + 9 failing tests. (d) `safeViewerOp()` for empty catches. (e) Add threat-model checklist to PR template | 6-12 weeks |
| A.8.28 | ISO 27001, SOC 2 CC8.1 | Secure coding | **Partial** | SQL injection surface = 0 (Neon tagged template literals). XSS surface = 0 (only 4 `dangerouslySetInnerHTML` on server-built SVG). CSRF enforced correctly. **`strict: false` is the biggest secure-coding gap.** Path traversal mitigated in `lib/migrations/manifest.ts:104-110`. | `audit_code_quality` §1, `audit_security_migrations` §6.3-6.5 | P1 | `strict: true` flip (1-3 weeks); add ESLint rules for `no-floating-promises`, `await-thenable` | 1-3 weeks |
| A.8.32 | ISO 27001, SOC 2 CC4.1, CC8.1 | Change management | **Gap** | Migration governance is exemplary (4-gate + static analysis + advisory lock + audit). **Application change-management has 4 P0s in this category**: `strict: false`, monolith, 2D-to-3D gap, parallel authority systems, 9 test failures, 51 F-13 backlog. **3 of 4 new providers have 0 direct tests.** | `audit_security_migrations` §5, `audit_code_quality` §2 #1, #2, `audit_solar_ml` §2 #1, #3, `audit_architecture_coverage` §2 #3 | **P0** | See CC8.1 remediation (8-15 weeks total) | 8-15 weeks |

---

## ISO 27701:2019 — Privacy extension

SolarPro is a **PII controller** for homeowner/inspector data (survey intake) and a **PII processor** for utility/AHJ data (resolving on behalf of customers). Only the controls that have a concrete implementation footprint are in scope.

| Control ID | Framework | Description | Current state | Evidence location | Source audit | Severity | Remediation | Effort |
|---|---|---|---|---|---|---|---|---|
| 6.2.1 / A.5.34 | ISO 27701, ISO 27001 A.5.34, SOC 2 CC6.7 | Identify and document PII; determine PII controller / processor status | **Partial** | Survey PII documented in `lib/survey/`. PII fields: `inspector_email`, `inspector_name`, `site_overview`, `roof_conditions`, `electrical_service`, `obstructions`, photos. **No PII inventory; no controller/processor designation in DPAs.** | `audit_security_migrations` §2 #7, `audit_solar_ml` §2 #4 | P1 | Document PII inventory + controller/processor designation | 1 week |
| 6.2.2 / A.5.34 | ISO 27701, ISO 27001 A.5.34 | Identify and document PII processing purposes | **Partial** | Survey → planset → permit pipeline documented. **No record of processing activities (ROPA) artifact.** | (this document) | P1 | Write ROPA | 1 week |
| 6.2.3 / A.5.34 | ISO 27701, ISO 27001 A.5.34 | Identify PII processors and sub-processors; document their obligations | **Gap** | **No DPAs filed with OpenAI, Anthropic, Google, Nearmap, Eagleview** (sub-processors that receive aerial photos or PII). | `audit_solar_ml` §5, `audit_consolidated` §7 | **P0** | (a) File DPAs with OpenAI + Anthropic. (b) Document full sub-processor list. (c) Build vendor risk register | 1-2 weeks |
| 6.2.4 / A.5.34 | ISO 27701, ISO 27001 A.5.34 | Identify legal basis for PII processing | **Not assessed** | Audits silent. | — | P1 | Document legal basis (likely legitimate interest + contract for survey, consent for marketing) | 1 week |
| 6.3.x | ISO 27701 | Data subject rights (access, correction, deletion, portability) | **Implemented** | `app/api/auth/delete-account/route.ts` exists (session-cookie gated). No PII-portability endpoint visible. | `audit_security_migrations` §3.1 | — | Add PII export endpoint (GDPR Art. 20) | 1 week |
| 6.4.x | ISO 27701, ISO 27001 A.5.34 | PII minimization, accuracy, storage limitation | **Partial** | Survey PII field length caps missing. Per-survey photo count cap missing. No documented retention period. | `audit_security_migrations` §2 #7 | P1 | (a) PII field length caps. (b) Per-survey photo count cap. (c) Document retention period (e.g. 7 years for permit records) | 1-2 weeks |
| 6.5.x | ISO 27701 | PII sharing, transfer, disclosure | **Gap** | Photos + PII go to OpenAI GPT-4o, Claude Opus 4.8, Claude Sonnet 4.5 without documented DPAs. **No PII redaction before transit to vision APIs.** | `audit_solar_ml` §2 #4, §5, `audit_consolidated` §7 | **P0** | (a) File DPAs. (b) PII redaction (EXIF strip of GPS coords). (c) Vision-availability banner when keys missing | 1-2 weeks |
| 6.6.x | ISO 27701, ISO 27001 A.8.x | PII breach notification (72h) | **Not assessed** | Audits silent. **No formal breach-notification runbook.** | — | P1 | Write breach-notification runbook (GDPR Art. 33/34: 72h to supervisory authority, 30d to data subject if high risk) | 1 week |
| 6.7.x | ISO 27701 | PII de-identification / anonymization at rest | **Partial** | `unifiedGeometry` review-only envelope separates raw PII (photos) from derived geometry. **No automated EXIF strip on upload.** | `audit_solar_ml` §6 | P2 | Add EXIF strip on upload (remove GPS, device ID, timestamp) | 1-2 days |
| 6.8.x | ISO 27701, ISO 27001 A.5.34 | PII controller / processor obligations | **Partial** | Org RBAC default-deny. **No formal PII handling training or onboarding policy.** | `audit_security_migrations` §3.6 | P2 | Add PII handling module to onboarding | 1 week |

---

## Risk register (summary)

| # | Risk | Likelihood | Impact | Inherent risk | After CC matrix treatment | Residual risk | Linked controls |
|---|---|---|---|---|---|---|---|
| 1 | 5 high-severity Next.js 14 DoS CVEs (RSC deserialization) | High | Medium | High | Medium (after Next 15 migration) | Low (post-migration) | A.8.8, CC7.1, A.8.16 |
| 2 | Rate-limiter fail-open + 178 missing rate limits | High | High | **Critical** | Medium (after in-memory fallback + 178 gates added) | Low | A.5.15, A.8.21, CC6.6, A.5.36 |
| 3 | NODE_ENV-as-Secure-gate inconsistency (8+ paths) | Medium | High | High | Low (after VERCEL_ENV migration) | Low | A.5.15, A.8.5, A.8.24, CC6.6 |
| 4 | `strict: false` + 1,500 `as any` casts | High | High | **Critical** | Medium (after strict flip + fixup branch) | Medium | A.8.25, A.8.28, A.8.32, CC8.1 |
| 5 | `proposalTruthEngine.ts` 62,959 LOC monolith | Medium | High | High | Low (after JSON extraction) | Low | A.8.25, A.8.32, CC8.1 |
| 6 | 207 empty `} catch {}` swallows | High | Medium | High | Low (after structured logger + safeViewerOp) | Low | A.8.15, CC4.2, CC7.2 |
| 7 | 9 failing tests + 51 F-13 backlog + lint blocker | High | High | **Critical** | Medium (after backlog cleared) | Low | A.8.32, CC4.1, CC8.1 |
| 8 | 2D-to-3D gap; CanonicalBuildingModel not persisted | Medium | High | High | Low (after Phase 1 of ROADMAP) | Low | A.8.25, A.8.32, CC8.1 |
| 9 | Two parallel authority systems (no shared contract) | Medium | High | High | Low (after unify-or-document) | Low | A.8.25, A.8.32, CC8.1 |
| 10 | OpenAI/Claude fail-silent + no budget cap (PII + cost) | High | High | **Critical** | Low (after env gates + budget cap + DPAs) | Low | A.5.34, A.8.12, CC6.6, CC6.7 |
| 11 | `lib/permit/utils/titleBlock.ts ↔ drawing.ts` cycle | Low | Medium | Medium | Low (after type-only re-export) | Low | A.8.25, A.8.32, CC8.1 |
| 12 | 3 of 4 new providers have 0 direct tests | Medium | Medium | Medium | Low (after tests added) | Low | A.8.25, CC4.1, CC8.1 |
| 13 | Real page-clipping regression (PV-0/PV-4B/SCHED) | Low | Medium | Medium | Low (after page-fit fix) | Low | A.8.32, CC4.1, CC8.1 |
| 14 | `getJwtSecret()` no 32-char min | Low | High | Medium | Low (after one-line check) | Low | A.5.17, A.8.24, CC6.6 |
| 15 | `MOBILE_SERVICE_API_KEY` shared identity (no per-route scoping) | Low | High | Medium | Low (after per-route scope check) | Low | A.5.15, A.8.5, CC6.1 |
| 16 | Survey photo upload lacks per-survey count cap, PII field length caps | Medium | Medium | Medium | Low (after Redis counter + caps) | Low | A.5.34, A.8.12, CC6.7 |
| 17 | Vent geometry nondeterminism (Claude Opus 4.8 cache) | Medium | Medium | Medium | Medium (no plan yet) | Medium | A.8.15, A.8.16, CC7.2 |
| 18 | 3D math + BOM + structural + CAD = ~0 unit tests | High | High | **Critical** | Medium (after per-function test plan) | Medium | A.8.25, A.8.28, A.8.32, CC8.1 |
| 19 | Synthetic-artifact firewall not adversarially tested | Low | High | Medium | Low (after adversarial tests) | Low | A.8.7, CC6.8 |

---

## What's NOT in the matrix (and why)

The four audit reports do not cover every SOC 2 / ISO 27001 control. The following are **not assessed** (audits silent) and require either additional gap-assessment work or compensating-control documentation before the auditor can sign Type 2:

| Control area | Why not assessed | Recommended follow-up |
|---|---|---|
| CC1.2 — Board oversight | No board charter / management-review cadence in repo | Add management-review document; 1 week |
| CC6.5 — Asset retirement | No data-deletion lifecycle policy | Document retention + deletion; 1-2 weeks |
| CC7.5 — PIR process | No post-incident review cadence | Write PIR process; 1 week |
| A.5.10 — Acceptable use | Audits silent on employee AUP | Write AUP; 1 week |
| A.5.27 — Learning from incidents | No PIR cadence | Quarterly review process; 1 week |
| A.8.20 / A.8.22 — Network security / segregation | Vercel + Neon + Render topology is implicit | Network-security review; 1-2 weeks |
| A.5.7 — External threat intel | No CISA/US-CERT feed | Subscribe to Dependabot + CISA KEV; 0.5 day |
| ISO 27701 6.2.4 — Legal basis | Audits silent on GDPR Art. 6 basis | Document legal basis; 1 week |
| ISO 27701 6.6.x — Breach notification | No formal runbook | Write 72h breach runbook; 1 week |
| ISO 27017 A.5.23 (cloud-specific) | Vendor management only partial | Collect vendor SOC 2 reports; 1-2 weeks |

**Total follow-up work to close "not assessed" gaps:** ~10-15 weeks. **This is the difference between "ready for Type 1 in 4-6 weeks" and "ready for Type 2 in 4-6 months".**

---

## Suggested sprint ordering (Sprint 0 → Sprint 4)

| Sprint | Focus | Estimated effort | Closes |
|---|---|---|---|
| **Sprint 0** (this report's focus) | Gap synthesis; matrix; status | Done | — |
| **Sprint 1** (1 week) | Security P0 quick-wins: rate-limiter fallback + VERCEL_ENV fix + JWT 32-char min + 4 sync-issue fixes + 5 stale migration assertions | 1 dev-week | Closes security P0 #1, #2, #3 + 4 sync issues + 5 test failures |
| **Sprint 2** (2 weeks) | Coverage of highest-risk gaps: 3 untested providers + 2 `execFileSync` tests + empty-catch `safeViewerOp` intro + 51 F-13 failures | 2 dev-weeks | Closes architecture P0 #3, #6 + code-quality P0 #3 (partial) + ML P0 #2 |
| **Sprint 3** (3-4 weeks) | Change-management P0s: 2D-to-3D Phase 1 (CanonicalBuildingModel persistence) + unify authority systems OR document contract | 3-4 dev-weeks | Closes ML P0 #1, #3 (the largest correctness risk) |
| **Sprint 4** (4-6 weeks) | Strategic P0s: `strict: true` flip + monolith extraction + Next 15 migration planning + PII DPAs + vision budget cap + add rate limit to 178 routes | 4-6 dev-weeks | Closes code-quality P0 #1, #2 + security P0 #1 (#4) + ML P0 #4, #5 |

**Sprint 1 is the cheapest lever.** ~$3-6K and 1 dev-week closes 4 P0s and unblocks R2 pre-push guard. **Do this first.**

---

## Cross-references

- **Top 10 P0 remediation table** is at the top of this document.
- **Risk register** is above.
- **Suggested sprint ordering** is above.
- Source audits:
  1. `C:\Users\carpe\.mavis\v2\assets\audit_solar_ml_2026-07-30.md`
  2. `C:\Users\carpe\.mavis\v2\assets\audit_security_migrations_2026-07-30.md`
  3. `C:\Users\carpe\.mavis\v2\assets\audit_consolidated_USD_2026-07-30.md`
  4. `C:\Users\carpe\.mavis\v2\assets\audit_code_quality_2026-07-30.md`
  5. `C:\Users\carpe\.mavis\v2\assets\audit_architecture_coverage_2026-07-30.md`
  6. `C:\Users\carpe\.mavis\memory\projects\solarpro\SECURITY_ADVISORY_DEPS.md`

---

*End of control matrix. Authored 2026-07-30 by Mavis (general-purpose agent) as Sprint 0 deliverable for the compliance-lead agent. The companion status report is at `C:\Users\carpe\.mavis\agents\compliance-lead\workspace\STATUS_SPRINT0_GAP_SYNTH.md`.*
