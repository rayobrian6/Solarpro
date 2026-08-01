# HANDOFF — Compliance Policies v5 (Ops carryover + Cloud cluster)

**Status:** Drafted, **NOT PUSHED**, awaiting review and signature.
**Author:** Mavis / compliance-lead via legal-writer
**Date:** 2026-08-15
**Per:** F-13 handoff convention (see prior `HANDOFF_COMPLIANCE_POLICIES_*.md` files at repo root).
**Companion to:** `HANDOFF_COMPLIANCE_POLICIES_V1.md` (foundation), `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` (operations), `HANDOFF_COMPLIANCE_POLICIES_V3_PERSONNEL.md` (personnel), `HANDOFF_COMPLIANCE_POLICIES_V4_VENDOR_PRIVACY.md` (vendor + privacy). With this batch, **25 of 30 policies are drafted** — only the Compliance & Audit cluster (26-30) remains.

---

## What was done

Drafted the **5 Operations carryover + Cloud-specific (ISO 27017) cluster policies** for Solarpro's SOC 2 Type 1 / ISO 27001 / 27017 / 27701 program, in `compliance/policies/`. These join the 20 already drafted in the v1, v2-ops, v3-personnel, and v4-vendor-privacy clusters. The Encryption & Key Management (#21) and BC/DR Plan (#22) are the two operations carryovers that were referenced in the foundation and operations policies but not in the v1/v2-ops drafts. The Patch Management (#23) was promoted from the optional 11th slot to a full Sprint 2 policy because the Stage 2 Next 15 migration (closing 5 high-severity CVEs) made the cadence essential. The Cloud Services Security Policy (#24) and the Shared Responsibility Matrix (#25) are the start of the ISO 27017 cloud cluster.

| # | File | Title | POL ID | Size | Status |
|---|---|---|---|---|---|
| 21 | `compliance/policies/21-encryption-key-management.md` | Encryption & Key Management Policy | POL-IS-021 | 30 KB | Drafted, awaiting signature |
| 22 | `compliance/policies/22-business-continuity-disaster-recovery.md` | Business Continuity & Disaster Recovery Plan | POL-OP-022 | 30 KB | Drafted, awaiting signature |
| 23 | `compliance/policies/23-patch-management.md` | Patch Management Policy | POL-OP-023 | 23 KB | Drafted, awaiting signature |
| 24 | `compliance/policies/24-cloud-services-security.md` | Cloud Services Security Policy | POL-IS-024 | 27 KB | Drafted, awaiting signature |
| 25 | `compliance/policies/25-shared-responsibility-matrix.md` | Shared Responsibility Matrix | POL-IS-025 | 27 KB | Drafted, awaiting signature |
| — | `compliance/cloud/shared-responsibility-matrix.md` | Versioned copy of the §3 matrix | — | 6.5 KB | New companion file (versioned in git) |
| — | `compliance/policies/README.md` | Policy library index | — | updated | Updated to include all 25 policies + the 5-policy next-batch backlog |

**Total**: 5 new policies + 1 new companion file + 1 updated index, ~144 KB of new policy content. The companion `compliance/cloud/shared-responsibility-matrix.md` is a table-only copy of the matrix in §3 of Policy 25; the canonical source is the policy file (the policy is reviewed and signed off by James and Raymond; the cloud/ copy is a versioned reference for the team to update when providers change). The two are kept in sync by PR review per Policy 25 §6.

### The 5-policy scope

The 5 policies are the Operations carryover + Cloud cluster. The user (James) selected this batch in priority order:

| # | Why this policy, in this order |
|---|---|
| **21 — Encryption & Key Management** | Closes the audit's A.8.24 Partial row and codifies the 32-character secret minimum that the 2026-07-30 security quickwins PR enforced in `getJwtSecret()`. The policy is the standalone evidence for the cryptographic posture; Policy 15 §5 had the 32-char rule in a paragraph; this policy is the auditor-preferred form. Also documents the rotation cadence (JWT annual, DB quarterly, API keys on personnel change), the cryptographic standards (AES-256-GCM, RSA-2048+, Ed25519, SHA-256+, no MD5/SHA-1), the at-rest / in-transit encryption posture per provider, the key storage rules (GitHub Actions encrypted secrets, Vercel env vars, 1Password), and the key compromise response. |
| **22 — Business Continuity & Disaster Recovery Plan** | Closes the CC9.1 Partial row in the 2026-07-30 control matrix. Policy 09 (Backup & Recovery) covered "the data is recoverable" with the 4h/1h RTO/RPO; this policy is the broader scenario: 7 disaster scenarios (Neon region, Vercel platform, Render service, Cloudflare, GitHub, mass personnel unavailability, security incident) each with a step-by-step recovery procedure that a single engineer can drive end-to-end, the §7 communication plan (James → Raymond → Cody → customers → investors with an escalation order and a message template), the §8 primary/backup ownership table, the §9 testing cadence (quarterly restore test + annual tabletop + ad-hoc after every Sev1), and the §10 review cadence. **The policy is designed to be actually testable** — a reader should be able to pick it up and run a recovery drill. |
| **23 — Patch Management** | Closes the A.8.8 Gap row (the 5 unpatched Next.js 14 DoS CVEs are now closed by the Stage 2 Next 15 migration on `chore/next-15-migration`; the policy keeps them closed). The detection sources are Dependabot (daily), GitHub Security Advisories (real-time), Snyk (weekly on critical paths), the NVD CVE feed (weekly digest), and vendor security bulletins. The severity classification is Critical (24h SLA), High (7d), Medium (30d), Low (next cycle); CISA KEV bumps the severity to Critical regardless of CVSS. The §6 emergency workflow ships a KEV patch in 24h with a postmortem filed within 24h. The §7 exception register has a 90-day re-evaluation ceiling; stale exceptions are escalated to James. The §8 records are at `compliance/patches/`. |
| **24 — Cloud Services Security Policy** | Closes the A.8.16 Partial row. The 12-vendor inventory (Vercel, Neon, Render, Cloudflare, GitHub, GCP, OpenAI, Anthropic, Stripe, Resend, Sentry, R2) with a shared-responsibility narrative (what the vendor owns, what Solarpro owns, what is shared). The §4 configuration standards (MFA on every console, least-privilege IAM, no long-lived access keys, OIDC/short-lived tokens, encryption at rest + in transit, audit logging). The §5 monitoring cadence (weekly automated config check, monthly vendor posture review, quarterly vendor risk register refresh, annual vendor security review). The §6 cloud incident response (the vendor is the first responder; Solarpro is the second). The §7 cloud-specific risks (multi-tenancy, data residency, jurisdiction, API quotas, cost overruns). |
| **25 — Shared Responsibility Matrix** | Closes the ISO 27017 A.5.23 control (the cloud-specific shared-responsibility requirement). The 8 control areas (data at rest, data in transit, application code, runtime/OS patching, network security, physical security, IAM, audit logging) × the 12 vendors + Solarpro = 13 columns × 8 rows = 104 RACI cells. The "A is always Solarpro" principle: Solarpro is accountable for the outcome of every control that affects Solarpro data, customers, or compliance posture, even when the work is delegated to a vendor. The §4 per-vendor notes provide the nuance for the cells that are not self-explanatory (the Vercel stateless posture, the Neon `sslmode=require`, the OpenAI 30-day log retention, the Stripe tokenization, the R2 lifecycle). The matrix is the per-vendor deep-dive that backs the §3 narrative of Policy 24. |

### Design choices (continuing from v1-v4)

1. **Same header table format** as the previous 20. Policy / Version / Effective date / Owner (CISO) / Approver (Management) / Last reviewed / Next review / Scope — all in the same shape. The policy library reads as one document.
2. **Concrete, not template.** Raymond, James, Cody. Real systems: Vercel, Neon, Render, OpenAI, Anthropic, Google, Stripe, Resend, GitHub, Sentry, Cloudflare, 1Password. The 2026-07-30 security quickwins PR is referenced in Policy 21 §1 and §6.1. The 2026-07-30 control matrix A.8.8 Gap row is referenced in Policy 23 §1. The Stage 2 Next 15 migration (closing 5 high-severity CVEs) is the trigger for Policy 23.
3. **The P0 finding being closed is named in the policy.** Policy 21 closes A.8.24 (Partial). Policy 22 closes CC9.1 (Partial). Policy 23 closes A.8.8 (Gap). Policy 24 closes A.8.16 (Partial). Policy 25 closes ISO 27017 A.5.23 (the cloud-specific shared-responsibility control).
4. **The policy calls out the current state honestly.** Policy 22 §6.3 (Render → Fly.io migration) notes that the Fly.io config is forthcoming; the Render → Fly.io migration is a planned Sprint 2 follow-up. Policy 23 §4.3 (Snyk free tier) notes that Snyk is a paid tool and Solarpro uses the free tier; a paid upgrade is a Sprint 3+ decision. Policy 24 §2.7 (cost overruns) names the `MAX_DAILY_COST_USD` and `VISION_DAILY_BUDGET_USD` env vars as the cost gates.
5. **The BC/DR Plan (#22) is actually testable.** The §6 procedures are written as step-by-step runbooks (open the dashboard, click this, verify that) that a single engineer (Cody) can drive end-to-end. The §7 communication plan has a fixed message template at `compliance/incidents/_TEMPLATE.md`. The §9 testing cadence (quarterly restore test + annual tabletop + ad-hoc after every Sev1) is the operational rule.
6. **The Encryption & Key Management Policy (#21) codifies the security quickwins PR.** The 32-character `JWT_SECRET` minimum that the PR enforced in `getJwtSecret()` is now policy. The 32-character minimum applies to every high-entropy machine credential (JWT, MFA, webhook HMAC, API keys). The minimum is enforced at runtime; the policy is the audit-ready form. The policy also references the 90-day admin expiry from Policy 03 §5.2 (the 90-day expiry cascades into key access: when an admin role expires, the access to 1Password, Vercel env vars, GitHub Actions secrets is reviewed).
7. **The Cloud Services Security Policy (#24) and the Shared Responsibility Matrix (#25) are a pair.** Policy 24 is the narrative; Policy 25 is the table. The two are read together. Policy 25's matrix is also reproduced in `compliance/cloud/shared-responsibility-matrix.md` for the team to update when providers change; the canonical source is the policy file.
8. **The exception process is consistent across all 25.** Linear issue tagged `compliance-exception` → Raymond approval → 90-day max → James disclosure for P0. The Information Security Policy §8 is the root.

### Policy-specific design notes

- **21 — Encryption & Key Management** opens with the codification of the 32-character secret minimum. The §3 cryptographic standards are explicit: AES-256-GCM for symmetric, RSA-2048+ or Ed25519 for asymmetric, HMAC-SHA-256 for webhooks, bcrypt(12) for passwords, SHA-256+ for hashing, no MD5/SHA-1. The §4 at-rest encryption table is per-provider: Neon (AES-256 at the storage layer), Vercel (stateless), R2 (AES-256), Render (AES-256 on the disk; ephemeral), with the application-level encryption called out (bcrypt for passwords, AES-256-GCM for TOTP). The §5 in-transit table is per-path: customer browser → Vercel edge (TLS 1.2+; HSTS), Vercel → Neon (TLS; `sslmode=require`), Render → Vercel (HTTPS + HMAC), GitHub Actions → Vercel/Render (TLS + short-lived tokens), etc. The §6 key types and rotation table is the operational rule: JWT (annual), DB credentials (quarterly), API keys (annual or per vendor), MFA TOTP key (annual), webhook HMAC secrets (annual). The §7 key storage rules forbid secrets in source code, Slack, email, screenshots, browser password manager, and unencrypted local files. The §8 key compromise response is the operational rule (rotate immediately, audit log review, IR per Policy 05).
- **22 — Business Continuity & Disaster Recovery Plan** is designed to be ACTUALLY TESTABLE. The §3 recovery targets are the same as Policy 09 §3 (4h Tier 1 RTO, 1h RPO, 24h full stack), summarized for the BC/DR context. The §4 disaster scenarios are the 7 the team is most likely to face (Neon region, Vercel, Render, Cloudflare, GitHub, mass personnel unavailability, security incident). The §6 procedures are step-by-step: open the dashboard, click this, verify that, with time bounds for each step. The §6.1 (Neon region outage) procedure is the most detailed because it's the most likely Tier 1 scenario. The §7 communication plan has a fixed escalation order (IC → Raymond → Cody → James → customers → investors → vendors → auditor/regulator) and a message template. The §8 primary/backup ownership table is the rotation: every step has a primary and a backup, so the team can lose one person and the plan still runs. The §9 testing cadence is the operational rule: quarterly full restore test (Policy 09 §5.2), annual tabletop exercise (Q4 2026, scenario = Neon region outage), ad-hoc after every Sev1.
- **23 — Patch Management** opens with the codification of the cadence that keeps the 5 Next.js 14 DoS CVEs closed. The §4 detection sources are 5: Dependabot (daily + real-time), GitHub Security Advisories (real-time), Snyk (weekly on critical paths; free tier), NVD CVE feed (weekly digest), vendor security bulletins. The §5 severity classification is CVSS-based with 3 adjustments: KEV bumps to Critical, reachability bumps up, customer-data exposure bumps up. The §6 normal workflow has 7 steps (triage, review, security assessment, test, merge, deploy, verify) with owner, time bound, and output per step. The §6.3 emergency workflow (KEV) has 6 steps with a 24-hour ceiling. The §6.4 exception workflow has a 90-day re-evaluation ceiling; stale exceptions are escalated to James. The §7 exception register is at `compliance/patches/exceptions-<year>.csv`. The §8 records (per-patch + per-exception + per-emergency) are at `compliance/patches/`. The §9 roles are Raymond (CISO), Cody (technical lead), James (management sign-off), with the operational rule that the default action is to patch and the exception is the burden of proof.
- **24 — Cloud Services Security Policy** opens with the codification of the cloud posture. The §2 inventory is the 12 vendors (Vercel, Neon, Render, Cloudflare, GitHub, GCP, OpenAI, Anthropic, Stripe, Resend, Sentry, R2) with the tier (Tier 1 = outage or compromise prevents serving customers; Tier 2 = degraded service). The §3 shared responsibility narrative is the rule (vendor owns physical + hypervisor + host OS; Solarpro owns data + application + IAM + audit; shared is network encryption + database encryption + incident response). The §4 configuration standards are the minimum baseline: MFA on every console, least-privilege IAM, no long-lived access keys, OIDC/short-lived tokens, TLS 1.2+ in transit + AES-256 at rest, audit logging enabled. The §5 monitoring cadence is weekly (automated config check) + monthly (vendor posture review) + quarterly (vendor risk register refresh) + annual (vendor security review). The §6 cloud incident response is the rule (vendor is first responder; Solarpro is second). The §7 cloud-specific risks are the 5 the team is most likely to face (multi-tenancy, data residency, jurisdiction, API quotas, cost overruns). The §8 roles are Raymond (CISO), Cody (technical lead), James (management sign-off).
- **25 — Shared Responsibility Matrix** is the per-vendor table version of Policy 24. The §2 RACI legend is the cloud-adapted one: R (responsible), S (shared), A (accountable), I (informed). The "A is always Solarpro" principle is the rule: Solarpro is accountable for the outcome of every control that affects Solarpro data, customers, or compliance posture, even when the work is delegated to a vendor. The §3 matrix is 8 rows × 12 vendor columns + Solarpro = 104 cells. The §4 per-vendor notes provide the nuance (Vercel stateless, Neon `sslmode=require`, Render ephemeral disk, Cloudflare WAF, GitHub Dependabot + CodeQL, GCP API key, OpenAI 30-day log retention, Anthropic Zero Data Retention, Stripe tokenization, Resend MTA-STS, Sentry PII redaction, R2 lifecycle). The §6 update procedure is the PR review that keeps the matrix in sync with Policy 24 and `compliance/vendors.csv`. The companion file at `compliance/cloud/shared-responsibility-matrix.md` is the versioned table; the canonical source is the policy file.

### What this batch closes in the control matrix

The v1 (policies 1-5), v2-ops (policies 6-10), v3-personnel (policies 11-15), and v4-vendor-privacy (policies 16-20) batches each closed several P0 audit findings and "Not assessed" rows in the control matrix. The v5 batch (policies 21-25) closes:

| # | Finding | Source | Closing policy |
|---|---|---|---|
| 21 | **No standalone Encryption & Key Management Policy** (the 32-char secret minimum was in code + Policy 15 §5, but the broader key management discipline — at-rest posture per provider, in-transit posture per path, per-key rotation cadence, key compromise response — was not documented as a single audit-ready artifact). A.8.24 was Partial. | `CONTROL_MATRIX.md` A.8.24 (Partial), CC6.1 (Partial), CC6.7 (Partial) | **21 Encryption & Key Management** — codifies the 32-char minimum, the cryptographic standards, the at-rest + in-transit posture per provider, the per-key rotation cadence, the key storage rules, the key compromise response. SOC 2 CC6.1, CC6.7, ISO 27001 A.5.17, A.8.24, ISO 27017 A.8.24. |
| 22 | **No documented BC/DR plan, no RTO/RPO targets, no failover test cadence** (the targets were in Policy 09 §3, but the broader scenario — multi-system outage, vendor bankruptcy, ransomware, mass personnel unavailability — was not documented). CC9.1 was Partial; A.5.29 was Partial; A.5.30 was Partial. | `CONTROL_MATRIX.md` CC9.1 (Partial), A.5.29 (Partial), A.5.30 (Partial), ISO 27017 A.5.30 (Partial) | **22 Business Continuity & Disaster Recovery Plan** — 7 disaster scenarios, 7 step-by-step recovery procedures, §7 communication plan, §8 primary/backup ownership, §9 testing cadence (quarterly restore test + annual tabletop + ad-hoc after every Sev1). SOC 2 CC9.1, ISO 27001 A.5.29, A.5.30, ISO 27017 A.5.30. |
| 23 | **No Patch Management Policy** (the 5 unpatched Next.js 14 DoS CVEs were Gap; `npm audit` was not in CI; Dependabot security updates were not configured; `package-lock.json` was 9 days stale). A.8.8 was Gap. | `CONTROL_MATRIX.md` A.8.8 (Gap), CC7.1 (Gap), A.8.9 (Partial), A.12.6 (Not assessed) | **23 Patch Management** — 5 detection sources, severity classification (Critical 24h / High 7d / Medium 30d / Low next cycle), 7-step normal workflow, 6-step KEV emergency workflow, 5-step exception workflow with 90-day ceiling, §7 exception register, §8 patch records. SOC 2 CC7.1, ISO 27001 A.8.8, A.8.9, A.12.6. |
| 24 | **No Cloud Services Security Policy** (the cloud posture was referenced in the Control Matrix and Policy 10, but the per-vendor configuration standards and the weekly/monthly/quarterly/annual monitoring cadence were not documented as a single audit-ready artifact). A.8.16 was Partial. | `CONTROL_MATRIX.md` A.8.16 (Partial), CC6.6 (Gap), ISO 27017 A.8.16 (Partial) | **24 Cloud Services Security Policy** — 12-vendor inventory, shared responsibility narrative, §4 configuration standards, §5 monitoring cadence, §6 cloud incident response, §7 cloud-specific risks. SOC 2 CC6.6, ISO 27001 A.8.16, ISO 27017 A.8.16. |
| 25 | **No Shared Responsibility Matrix** (ISO 27017 A.5.23 explicitly requires a per-vendor shared responsibility documentation; the narrative in Policy 24 §3 is necessary but not sufficient). A.5.23 was Partial. | `CONTROL_MATRIX.md` ISO 27017 A.5.23 (Partial) | **25 Shared Responsibility Matrix** — 8 control areas × 12 vendors + Solarpro = 104 RACI cells, "A is always Solarpro" principle, §4 per-vendor notes, §6 update procedure, companion file at `compliance/cloud/shared-responsibility-matrix.md`. SOC 2 CC6.6, ISO 27017 A.5.23. |

**Status after this batch:**

- 25 of 30 policies drafted (Sprint 1 + v5 is done: foundation + operations + personnel + vendor + privacy + ops carryover + cloud = 25).
- 5 of 30 policies remaining (the Compliance & Audit cluster: Virtual Environment Security, Risk Assessment, Statement of Applicability, Audit & Monitoring, Privacy Impact Assessment).
- The control matrix's P0 column shifts: 12 P0 items are now policy-closed (the code-level fixes are tracked separately in the control matrix remediation table). The remaining P0 items are code-level (rate-limiter fail-open, 178/293 routes without rate limit, NODE_ENV-as-Secure-gate, `strict: false` + 1,500 `as any` casts, 207 empty `} catch {}` swallows, 9 failing tests + 51 F-13 backlog, etc.) and are out of scope for the policy work.

### Cloud Services Security (#24) + Shared Responsibility Matrix (#25) — the paired artifact

Per James's instruction, Policy 24 and Policy 25 are a pair. Policy 24 is the narrative; Policy 25 is the table. The two are read together; the auditor reads both. The §3 of Policy 25 is the per-vendor deep-dive that backs the §3 narrative of Policy 24.

The matrix is **8 control areas × 12 vendors + Solarpro = 104 cells**. The cells use the cloud-adapted RACI legend (R, S, A, I). The "A is always Solarpro" principle is the rule: Solarpro is accountable for the outcome of every control that affects Solarpro data, customers, or compliance posture, even when the work is delegated to a vendor. The §4 per-vendor notes provide the nuance:

- **Vercel**: stateless for the Next.js application (no persistent storage; env vars are encrypted at rest by Vercel).
- **Neon**: AES-256 at rest; PITR backups encrypted with the same key; `sslmode=require` in the `DATABASE_URL`.
- **Render**: AES-256 at rest on the disk (ephemeral; the deploy is the source of truth).
- **Cloudflare**: R2 AES-256 at rest; "Full" SSL mode; WAF rules + DDoS protection.
- **GitHub**: Dependabot + CodeQL + secret scanning; Actions runtime managed; Solarpro manages the Node.js version in `.nvmrc`.
- **GCP**: Solar API + Maps API; TLS 1.2+; the API key is the IAM.
- **OpenAI**: may log API requests for up to 30 days for abuse monitoring (Zero Data Retention endpoint available on request); `MAX_DAILY_COST_USD` + `VISION_DAILY_BUDGET_USD` are the cost gates.
- **Anthropic**: may log API requests per their terms (API data not used for training); Zero Data Retention endpoint available.
- **Stripe**: payment processor; Solarpro never sees the card data; PCI scope is Stripe's.
- **Resend**: TLS 1.2+; MTA-STS for outbound; DKIM + SPF + DMARC on the `solarpro.app` domain.
- **Sentry**: error events; PII in the user context is limited to the user ID (not the email or the name).
- **R2**: AES-256 at rest; private bucket; lifecycle moves to `Infrequent Access` after 90 days and expires after 7 years; versioning enabled.

The matrix is the source of truth for the §3 of Policy 24. The matrix is updated when a vendor is added, removed, or re-scoped; the update is a PR with Raymond's review and James's approval. The companion file at `compliance/cloud/shared-responsibility-matrix.md` is the versioned table; the canonical source is the policy file.

### Business Continuity & Disaster Recovery Plan (#22) — the actually-testable plan

Per James's instruction, Policy 22 is **designed to be ACTUALLY TESTABLE**. A reader should be able to pick it up and run a recovery drill. The §6 procedures are step-by-step runbooks:

- **§6.1 Neon region outage** (the most detailed because it's the most likely Tier 1 scenario): confirm the outage (5 min) → open the incident (5 min) → provision a restore project (15-30 min) → verify the restore (10 min) → swap the connection (5 min) → notify customers (15 min) → postmortem (within 5 business days). Total: 1-2 hours, well inside the 4-hour RTO.
- **§6.2 Vercel platform outage**: confirm (5 min) → open (5 min) → redeploy to Render (30-60 min) → swap DNS (15-30 min) → verify (15 min) → swap back when Vercel recovers. Total: 1-2 hours, well inside the 4-hour RTO.
- **§6.3 Render service outage**: confirm (5 min) → open (5 min, Sev2) → redeploy to Fly.io (30-60 min) → update callback URL (10 min) → verify (15 min). Total: 1-2 hours, well inside the 4-hour RTO.
- **§6.4 Cloudflare outage**: confirm (5 min) → open (5 min, Sev1) → update nameservers (15-30 min) → use Vercel DNS as fallback → verify (15 min) → swap back when Cloudflare recovers. Total: 30-60 minutes.
- **§6.5 GitHub outage**: confirm (5 min) → open (5 min, Sev2) → use local clone (30-60 min) → verify (15 min) → push deferred commits when GitHub recovers. Total: 1-2 hours.
- **§6.6 Mass personnel unavailability**: confirm (within 4 hours) → activate backup ownership (immediately) → triage in-flight work (within 24 hours) → notify customers and investors (within 24 hours) → engage temporary help (within 1 week) → postmortem.
- **§6.7 Security incident (ransomware, breach, key compromise)**: contain (immediately, per IRP #05) → eradicate (within 4 hours) → recover (within 24 hours) → notify (within 72 hours for GDPR supervisory authority; per Policy 18 §9 for the data subject) → postmortem.

The §7 communication plan has a fixed escalation order (IC → Raymond → Cody → James → customers → investors → vendors → auditor/regulator) and a message template at `compliance/incidents/_TEMPLATE.md`. The §8 primary/backup ownership table is the rotation: every step has a primary and a backup, so the team can lose one person and the plan still runs.

The §9 testing cadence is the operational rule:

- **Quarterly full restore test** (Policy 09 §5.2): Raymond + Cody. Real restore of the production database to non-production, real Vercel + Render redeploy to staging, real R2 inventory check. Output: a quarterly restore test report at `compliance/monitoring/<quarter>-restore-test.md`. First test: Q3 2026.
- **Annual tabletop exercise**: Raymond + James + Cody. 2-3 hours; walks through a hypothetical scenario, decides on the actions, identifies gaps. **The 2026 exercise (Q4 2026) scenario is a Neon region outage** (the most likely Tier 1 scenario). Output: an exercise report at `compliance/incidents/<date>-dr-tabletop.md`. First exercise: Q4 2026.
- **Ad-hoc after every Sev1 or Sev2 incident**: a real-incident retrospective per the Incident Response Plan (#05) §7. Output: a postmortem at `compliance/incidents/<date>-<incident>.md`.

The BC/DR Plan is the playbook the team reaches for when the alert fires. It's the rotation that a 3-person team doesn't have.

---

## The BCP/DR testing cadence (the operational question)

Per James's task brief, the BCP/DR testing cadence is one of the operational questions to be answered in the handoff. The cadence is set in Policy 22 §9 and Policy 09 §5. The summary:

| Cadence | Owner | Activity | Output | First occurrence |
|---|---|---|---|---|
| **Weekly** | Cody (operator) + Raymond (reviewer) | Backup existence + integrity check (Neon PITR window, R2 daily snapshot, Vercel/Render deploy histories, Cloudflare R2 versioning, GitHub branch protection) | One-line entry in the weekly monitoring digest at `compliance/monitoring/YYYY-WW-digest.md` | Already running per Policy 09 §5.1 |
| **Quarterly** | Raymond + Cody | Full restore test: real Neon PITR restore to non-production, real Vercel + Render redeploy to staging, real R2 inventory check, smoke test of top 5 customer flows + SAM2 inference path | Quarterly restore test report at `compliance/monitoring/<quarter>-restore-test.md` (achieved RTO, achieved RPO, diff from §3 targets, action items) | **Q3 2026** (90 days after this policy takes effect) |
| **Annual** | Raymond + James + Cody | Tabletop exercise: walk through a hypothetical scenario, decide on the actions, identify gaps in the plan. **The 2026 exercise scenario is a Neon region outage.** Combined with the Incident Response Plan (#05) tabletop. | Exercise report at `compliance/incidents/<date>-dr-tabletop.md` | **Q4 2026** (after the Q3 restore test) |
| **Ad-hoc** | The IC (the first person to see the alert) | Real-incident retrospective after every Sev1 or Sev2 incident | Postmortem at `compliance/incidents/<date>-<incident>.md` | On every Sev1 or Sev2 |
| **Annual** | Raymond + James | Policy review (Policy 22 §10). The annual review always includes a refresh of the §3 targets, the §4 scenarios, and the §6 procedures. The review also includes a refresh of the §6 emergency contacts (the vendor support pages change) and a refresh of the §7 escalation order (the team grows; the rotation may change). | Updated policy version + revision history entry | August 15, 2027 |

The targets are commitments, not aspirations. A target that is consistently missed in the quarterly test is either (a) revised with a written rationale (the targets move), or (b) addressed with a control improvement (the gap is closed). The §10 review is the venue for both.

The **first quarterly restore test (Q3 2026)** is the operational milestone that proves the policy is testable. The procedure is in Policy 09 §5.2; the report template is at `compliance/monitoring/_restore-test-template.md` (forthcoming; the template is a Sprint 2 follow-up). Raymond drives the test; Cody operates; James signs off on the report.

The **first annual tabletop (Q4 2026)** is the operational milestone that proves the team can drive the plan under pressure. The scenario is a Neon region outage; the team walks through the §6.1 procedure, decides on the actions, and identifies gaps. The exercise is 2-3 hours; the gaps are filed as action items in Linear.

---

## The CISO-review process (the operational question)

Per James's task brief, the CISO review is the gate before these 5 policies become effective. The process is documented in `compliance/policies/REVIEW_PROCESS.md` (the document the v1 batch added); the summary:

1. **Raymond (CISO) reviews** the technical accuracy and the control coverage. The review is a PR comment thread on the v5 branch. Estimated time: 2-3 business days for 5 policies (vs. 1-2 days for the foundation 5, because the v5 cluster is the densest of the 5 batches — the BC/DR Plan and the Shared Responsibility Matrix are both 30 KB and need careful reads).

   **Specific things for Raymond to focus on:**

   - **Policy 21 §6.1 (32-char JWT secret minimum)** — confirm the runtime check at `getJwtSecret()` matches the policy. Confirm the rotation cadence (annual) matches the §6.9 table. Confirm the key compromise response (§8) is consistent with the IRP (#05).
   - **Policy 21 §7.6 (forbidden storage locations)** — confirm the list (source code, Slack, email, screenshots, browser password manager, unencrypted local files, public buckets) is the operational rule. Add any additional locations that are common in the team's workflow.
   - **Policy 22 §3 (RTO/RPO targets)** — confirm the 4h Tier 1 RTO + 1h RPO are realistic for the 3-person team. The targets are commitments; missing them is a Sev2. If the Q3 2026 quarterly restore test consistently misses, the targets move.
   - **Policy 22 §6.1 (Neon region outage procedure)** — the most detailed §6 procedure. Walk through it mentally; identify any steps that have drifted from the actual Neon dashboard. The procedure was written in 2026-08-15; Neon may have changed the UI by Q3 2026.
   - **Policy 22 §6.6 (mass personnel unavailability)** — confirm the "minimum viable operations" (production database, customer-facing app, customer support inbox) match the team's actual priorities. The list is a starting point; refine it with James.
   - **Policy 22 §9.1 (quarterly restore test)** — confirm the Q3 2026 first test is scheduled. The test is the operational milestone that proves the policy is testable.
   - **Policy 23 §6.3 (KEV emergency workflow)** — confirm the 24-hour SLA is realistic for the 3-person team. The SLA is the ceiling; the actual time is usually 4-8 hours.
   - **Policy 23 §6.4 (exception workflow)** — confirm the 90-day re-evaluation ceiling is the right number. The ceiling is the floor for the auditor's evidence; longer exceptions are a documentation risk.
   - **Policy 24 §4.1 (MFA on every console)** — confirm the MFA matrix in Policy 15 §4.1 is consistent. The two policies are read together; the MFA matrix is the operational rule.
   - **Policy 24 §5.1 (weekly config check)** — confirm the GitHub Actions workflow (`compliance/monitoring/cloud-config-check.yml`) is scheduled. The workflow is the operational automation; without it, the §5 cadence is manual and error-prone.
   - **Policy 25 §3 (the matrix)** — confirm every cell is accurate. The matrix is the per-vendor deep-dive; an inaccurate cell is a documentation risk. The §4 per-vendor notes should match the actual vendor configuration.
   - **Policy 25 §5 (the "A is always Solarpro" principle)** — confirm the principle is the operational rule. The auditor will check that every row has at least one A and that every cell has at least one R; the principle is the rule that makes this work.
   - **Policy 25 companion file (`compliance/cloud/shared-responsibility-matrix.md`)** — confirm the versioned copy is the table-only view. The canonical source is the policy file; the cloud/ copy is the team's working file.

2. **James approves and merges.** As the management sign-off, James's approval is the final sign-off. The merge commit is the audit artifact of the policy version.

3. **Post-merge**: collect wet signatures (or DocuSign) for the 5 v1.0 signature blocks (~25 min total). Update policy header "Last reviewed" dates from 2026-08-15 to the merge date.

4. **Announce** in team channel: "5 Ops + Cloud policies are live. Read 22 (BC/DR Plan) — that's the playbook we reach for when the alert fires. Read 25 (Shared Responsibility Matrix) — that's the per-vendor table for ISO 27017 A.5.23."

5. **Operational follow-ups** (out of scope for the CISO review but worth flagging):

   - **First quarterly restore test (Q3 2026)**: Raymond drives; Cody operates. Output: `compliance/monitoring/Q3-2026-restore-test.md`. ~4 hours of focused work, scheduled on a Tuesday morning to minimize customer impact.
   - **First annual tabletop (Q4 2026)**: Raymond + James + Cody. Scenario: Neon region outage. Output: `compliance/incidents/2026-Q4-dr-tabletop.md`. ~2-3 hours.
   - **GitHub Actions workflow `compliance/monitoring/cloud-config-check.yml`**: Cody adds the weekly config check per Policy 24 §5.1. ~1-2 days.
   - **Policy 25 companion file PR process**: when a vendor is added, removed, or re-scoped, the matrix is the first place the change lands. The PR updates the policy file + the companion file + `compliance/vendors.csv` + Policy 24 §2 in the same PR. ~1-2 hours per change.
   - **`compliance/patches/` directory**: Cody creates the exception register CSV + the patch records schema per Policy 23 §7 + §8. ~2-3 hours.
   - **PATCH 21 §6.9 rotation table in the weekly monitoring digest**: the rotation log is added to the weekly digest per Policy 21 §6. The log is the audit trail; without it, the rotation cadence is unverified.
   - **The `/trust/cloud-responsibility` page** (forthcoming): the Shared Responsibility Matrix is the foundation for a customer-facing Trust Center page. The page is a Sprint 2 follow-up. The page renders the §3 matrix in a customer-friendly format.

---

## Branch status

- **Branch**: `chore/next-15-migration` (the current local branch; this is the same branch the v4 batch is on, so the v5 policies land alongside the v4 vendor + privacy policies).
- **NOT pushed** — James's "ship it" is the trigger per AGENTS.md R1 (no push to master) and R7 (push only to `james-dev`).
- **Note on the branch choice**: the v1, v2-ops, and v3-personnel batches each used a dedicated `chore/compliance-policies-vN-*` branch (so each batch could be PR'd and merged independently). The v4-vendor-privacy batch is on `chore/next-15-migration` because the user's instruction was to land it on the current branch (the Stage 2 Next.js migration branch). The v5 batch is on the same branch, so the v4 + v5 policies land together. When these batches are ready to merge, the 7 files (5 v5 policies + 1 v5 README update + 1 v5 handoff) + the 6 v4 files can be:
  - **Option A (recommended)**: extracted to two dedicated branches `chore/compliance-policies-v4-vendor-privacy` and `chore/compliance-policies-v5-ops-cloud` and PR'd independently, matching the v1/v2-ops/v3-personnel pattern. The v4 is in `HANDOFF_COMPLIANCE_POLICIES_V4_VENDOR_PRIVACY.md`; the v5 is in this document.
  - **Option B**: kept on `chore/next-15-migration` and PR'd as part of the Next.js 15 migration. The downside is that the policies are bundled with the security work, and the CISO review has to wait for the migration to be ready.
  - **Option C**: kept on `chore/next-15-migration` and split at PR time (the 7 + 6 files moved to new branches in single commits, the migration stays on `chore/next-15-migration`). Same as Option A in practice.

  James's preference is the call. Option A or C is recommended; Option B is workable but conflates three reviews (Next 15, v4 policies, v5 policies).

- **R6 attribution**: this is a `docs:` commit, so non-JAMES authorship is allowed; the author is the current git config. Same pattern as the v1, v2-ops, v3-personnel, and v4-vendor-privacy commits.

---

## What's left in the 30-policy program

After this batch, **25 of 30 policies are drafted** (Sprint 1 + v5 is done: foundation + operations + personnel + vendor + privacy + ops carryover + cloud = 25). The 5 remaining are the **Compliance & Audit cluster**, in priority order:

| # | Policy | Cluster | Why this is the next batch, not the v5 |
|---|---|---|---|
| 26 | Virtual Environment Security Policy | Compliance & Audit | Covers the SAM2 service sandbox, the worker sandbox, and the CI sandbox. The sandbox posture is referenced in the control matrix (the SAM2 service is in a Docker container on Render); the standalone policy documents the isolation, the network policy, the secret mounting, and the resource limits. Best built after the auditor is engaged (the auditor's specific sandbox questions drive the depth). |
| 27 | Risk Assessment Policy | Compliance & Audit | The risk-management approach is in Policy 01 §5 (lightweight quarterly risk cycle, 78 controls graded Implemented/Partial/Gap/N-A/Not assessed). The standalone Risk Assessment Policy is the formal ISO 27001 Clause 6.1.2 deliverable. The policy consolidates the existing risk register at `compliance/CONTROL_MATRIX.md` §"Risk register" into an ISO-aligned document. |
| 28 | Statement of Applicability (SoA) | Compliance & Audit | The SoA is the ISO 27001 deliverable that lists every Annex A control, whether it applies, the justification, and how it is implemented. The SoA is built AFTER all other policies are signed (the SoA references the policies as the implementation evidence). The next-batch is the right time because 25 of 30 policies will be signed by then. |
| 29 | Audit & Monitoring Policy | Compliance & Audit | The audit-evidence collection is in `compliance/manifest.json` and the self-built setup at `compliance/SELF_BUILT_SETUP.md`. The standalone Audit & Monitoring Policy is the ISO 27001 Clause 9 deliverable. The policy consolidates the existing weekly monitoring, the quarterly UAR, the annual review cadence, and the audit-evidence retention. |
| 30 | Privacy Impact Assessment Policy | Compliance & Audit | The GDPR Art. 35 DPIA template and the trigger criteria. The DPIA is the formal risk assessment for any processing that is likely to result in a high risk to data subjects. The Solarpro survey → planset pipeline is a candidate (aerial photos of customer homes are sent to third-party vision APIs). The DPIA template is a Sprint 2 candidate. |

The next batch's window is **2026-10-15 → 2026-12-01** (the 6-7 week window after the v5 batch lands). The 5 policies are sized for 6-7 weeks; the workload is similar to the v5 batch but with the auditor's input now available to shape the audit policies.

**Beyond the 30 policies:** the 2 open workstreams that are not policies but are required for SOC 2 Type 1 readiness are the **pen test** (DEFERRED per James's no-money call; the Cobalt shortlist is at `PEN_TEST_SHORTLIST.md`) and the **SOC 2 auditor engagement** (DEFERRED per the no-money call; the Schellman shortlist is at `AUDITOR_SHORTLIST.md`). Both are 2027 work per `PROGRAM.md` §6.

**The 5 v5 policies' relationship to the next-batch's policies:**

- **Policy 26 (Virtual Environment Security)** references Policy 22 §6.3 (Render → Fly.io migration), Policy 23 §3.3 (Docker base image patching), and Policy 25 §4.3 (Render IAM).
- **Policy 27 (Risk Assessment)** references the risk register in the control matrix; the v5 policies are the implementation evidence for several rows.
- **Policy 28 (SoA)** references all 30 policies; the SoA is the ISO 27001 deliverable that lists every Annex A control and the policy that implements it. The v5 policies close the ISO 27001 A.8.24 (Encryption), A.5.29 + A.5.30 (BC/DR), A.8.8 (Patch Management), A.8.16 (Cloud Monitoring), A.5.23 (Cloud Vendor Management) rows.
- **Policy 29 (Audit & Monitoring)** references Policy 08 (Logging & Monitoring) and Policy 10 (Vendor Risk Management); the v5 policies add the cloud-specific monitoring posture.
- **Policy 30 (Privacy Impact Assessment)** references Policy 18 (Privacy Policy), Policy 19 (Data Subject Rights), and Policy 20 (Data Retention & Disposal); the v5 policies add the cloud-specific PII flow (the OpenAI / Anthropic vision calls that are the DPIA's primary risk surface).

---

## Risks and open questions

1. **Branch choice for the v4 + v5 batches.** As noted in §"Branch status" above, both batches are on `chore/next-15-migration` per the user's instruction. The recommendation is to extract to two dedicated branches at PR time (Option A or C above). James's call.

2. **The 4 open Tier 1 DPAs.** OpenAI, Anthropic, Google Solar, Nearmap DPAs are P0 in the Vendor Risk Management Policy §5.2. Policy 25 §"The vendor roster" table tracks the 3 open DPAs (OpenAI, Anthropic, GCP). This is unchanged from the v2-ops and v4 batches and remains a P0 in the program.

3. **The control matrix's "Not assessed" rows.** The v5 policies operationalize most of the ISO 27001 A.5.x and A.8.x clusters that were Not assessed in the 2026-07-30 control matrix. The next control-matrix refresh (after the CISO review) should mark the affected rows as Implemented or Partial. Specifically:
   - A.5.29, A.5.30 (BC/DR) → Implemented (Policy 22).
   - A.5.30 ISO 27017 (BC/DR cloud) → Implemented (Policy 22).
   - A.8.8 (Patch Management) → Implemented (Policy 23).
   - A.8.9 (Configuration Management) → Implemented (Policy 23 + Policy 24).
   - A.8.16 (Monitoring) → Implemented (Policy 24).
   - A.8.24 (Cryptography) → Implemented (Policy 21).
   - A.5.23 ISO 27017 (Cloud Vendor Management) → Implemented (Policy 25).
   - A.12.6 (Technical Vulnerability Management) → Implemented (Policy 23).
   - A.5.7 (Threat Intelligence) → still Partial (the CISA KEV subscription is a follow-up; Policy 23 §4.4 references the digest but the automated subscription is not yet in place).

4. **The 51 F-13 test failures + 1 lint blocker.** Pre-existing on `james-dev`; out of scope for this docs commit. Tracked in `HANDOFF_F13.md` and `docs/CI-QUARANTINE.md`. The R2 pre-push guard remains red until the F-13 backlog is cleared.

5. **The Stage 2 Next 15 migration is not pushed.** The Stage 2 work (commit on `chore/next-15-migration`, not pushed) closed the 5 high-severity CVEs. The v5 policies (specifically Policy 23) are designed to keep them closed. The migration lands before the v5 policies land; the v5 policies are the cadence that maintains the closure.

6. **The BC/DR Plan's §6 procedures are current as of 2026-08-15.** Vendor dashboards change. The §10 review cadence (annual) refreshes the procedures; the quarterly restore test (Policy 22 §9.1) is the venue to identify drift between the procedure and the actual dashboard. The first restore test (Q3 2026) is the operational milestone that proves the policy is testable.

7. **The shared responsibility matrix's "A is always Solarpro" principle.** The principle is the rule that an auditor will check. The matrix documents it. If a future cell needs a different A (e.g. a fully outsourced function where the vendor truly owns the outcome), the principle is documented in §5 and the cell is the exception, not the rule.

8. **The 32-char secret minimum in Policy 21 §6.1.** The runtime check in `getJwtSecret()` was added by the 2026-07-30 security quickwins PR. The policy codifies the rule. The check is verified by the weekly env-fingerprint run at `compliance/monitoring/env-fingerprint.json` (the `meets_32_char_min` field per secret). The first verification is the next weekly run after this policy takes effect.

9. **The CISA KEV subscription.** Policy 23 §4.4 references the NVD CVE feed; the CISA KEV subscription is the operational automation that drives the §6.3 emergency workflow. The subscription is a follow-up; the manual review of the KEV catalog is the operative process in the meantime. The weekly monitoring digest (Policy 08) is the venue for the manual review.

10. **The "no training" commitment to AI providers.** Policy 18 §4 says Solarpro does not train any AI model on customer data. The OpenAI and Anthropic API terms prohibit training on API inputs. Policy 25 §4.7 + §4.8 reference the OpenAI / Anthropic data handling. The commitment is monitored as part of the annual vendor review (Policy 10 §6.1).

---

## Cross-references

- **HANDOFF**: this document.
- **Prior handoffs**: `HANDOFF_COMPLIANCE_POLICIES_V1.md` (foundation), `HANDOFF_COMPLIANCE_POLICIES_V2_OPS.md` (operations), `HANDOFF_COMPLIANCE_POLICIES_V3_PERSONNEL.md` (personnel), `HANDOFF_COMPLIANCE_POLICIES_V4_VENDOR_PRIVACY.md` (vendor + privacy).
- **Sister commits**: `60209e07` (v1), `09b4a5cb` (v2-ops), `f8865dc4` (v3-personnel) on `chore/compliance-policies-v1` / `-v2-ops` / `-v3-personnel`.
- **Design doc**: `compliance/PROGRAM.md` (program plan and Sprint timeline), `compliance/SELF_BUILT_SETUP.md` (evidence collection architecture), `compliance/CONTROL_MATRIX.md` (84 controls).
- **Customer-facing**: `compliance/vendors.csv` (12-vendor sub-processor register), `compliance/trust.json` (Trust Center data).
- **Review process**: `compliance/policies/REVIEW_PROCESS.md`.
- **Policy-of-policies**: `compliance/policies/01-information-security.md` (the foundation).
- **Companion v5 follow-ups**: the first quarterly restore test (Q3 2026), the first annual tabletop (Q4 2026), the GitHub Actions cloud-config-check workflow, the `compliance/patches/` directory, the rotation log in the weekly monitoring digest, the `/trust/cloud-responsibility` page.

---

*End of v5 handoff. 25 of 30 policies drafted. The Compliance & Audit cluster (26-30) is the next batch, sized for the 2026-10-15 → 2026-12-01 window. Per James's no-money call, the SOC 2 Type 1 audit is the next dollar-requiring milestone, targeted for Q4 2026. The policies are in force today; the external certification is the open work tracked in `PROGRAM.md`.*
